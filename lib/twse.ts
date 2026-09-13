import { chunkedMap } from "./concurrency";
import { fetchWithRetry, USER_AGENT } from "./httpFetch";
import type { PriceRow } from "./types";

interface StockDayResponse {
  stat: string;
  fields: string[];
  data: string[][];
}

export function parseNumber(raw: string): number {
  return Number(raw.replace(/,/g, ""));
}

/** TWSE STOCK_DAY dates are ROC calendar, e.g. "115/09/01" -> "2026-09-01". Exported for testing —
 * an off-by-one here (or TWSE ever switching format) would silently corrupt every stored date. */
export function rocDateToIso(roc: string): string {
  const [yStr, mStr, dStr] = roc.split("/");
  const year = Number(yStr) + 1911;
  return `${year}-${mStr.padStart(2, "0")}-${dStr.padStart(2, "0")}`;
}

/** One STOCK_DAY row -> PriceRow. Exported so the column mapping (fragile — TWSE gives no field
 * names, just positional columns) can be tested with a fixture row instead of only ever being
 * exercised by a live network call. */
export function parseStockDayRow(row: string[]): PriceRow {
  return {
    date: rocDateToIso(row[0]),
    volume: parseNumber(row[1]),
    open: parseNumber(row[3]),
    high: parseNumber(row[4]),
    low: parseNumber(row[5]),
    close: parseNumber(row[6]),
  };
}

/** One calendar month of daily OHLC for a single TWSE-listed stock. `month` is any date within that month. */
async function fetchStockDayMonth(code: string, month: Date): Promise<PriceRow[]> {
  const yyyymm = `${month.getFullYear()}${String(month.getMonth() + 1).padStart(2, "0")}01`;
  const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${yyyymm}&stockNo=${encodeURIComponent(code)}`;
  const res = await fetchWithRetry(
    url,
    { headers: { "User-Agent": USER_AGENT }, cache: "no-store" },
    { label: `TWSE STOCK_DAY ${code}` },
  );
  if (!res.ok) throw new Error(`TWSE STOCK_DAY HTTP ${res.status}`);
  const json = (await res.json()) as StockDayResponse;
  if (json.stat !== "OK" || !Array.isArray(json.data)) return [];

  return json.data.map(parseStockDayRow);
}

// STOCK_DAY is one HTTP request per calendar month, and `monthsBack` can be as large as
// MAX_CHART_MONTHS (24, see lib/redis.ts) for a user who wants a long chart-months window — firing
// all of them at once for a single stock, on top of several stocks being checked concurrently
// (lib/alerts.ts's own per-stock batching), is exactly the kind of burst that trips TWSE's WAF (see
// this file's header comment). Bounding it here decouples "how many months a caller asks for" from
// "how many requests actually hit TWSE at once", regardless of what any caller passes in.
const MONTH_FETCH_CONCURRENCY = 3;

/**
 * Daily OHLC history for a TWSE-listed stock, spanning the last `monthsBack` calendar months
 * (enough trading days for MA60 in all but pathological holiday clustering).
 */
export async function getPriceHistory(code: string, monthsBack = 3): Promise<PriceRow[]> {
  const now = new Date();
  const months = Array.from({ length: monthsBack }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return d;
  });

  const results = await chunkedMap(months, MONTH_FETCH_CONCURRENCY, (m) => fetchStockDayMonth(code, m));
  const merged = results.flat();
  merged.sort((a, b) => a.date.localeCompare(b.date));
  return merged;
}

interface T86Response {
  stat: string;
  data?: string[][];
}

function yyyymmdd(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

export interface T86InstitutionalRow {
  code: string;
  name: string;
  foreignNet: number;
  investmentTrustNet: number;
  dealerNet: number;
}

// Column layout (verified against FinMind's TaiwanStockInstitutionalInvestorsBuySell for 2330 —
// exact match): [0]代號 [1]名稱 [2-4]外陸資(不含外資自營商)買/賣/買賣超 [5-7]外資自營商買/賣/買賣超
// [8-10]投信買/賣/買賣超 [11]自營商買賣超合計(自行+避險) [12-14]自營商(自行) [15-17]自營商(避險) [18]三大法人合計.
// 外資 = 不含自營商 + 外資自營商 (matches FinMind's Foreign_Investor + Foreign_Dealer_Self).
/** One T86 row -> T86InstitutionalRow. Exported for testing — this positional column mapping (no
 * field names in the response) is the single most upstream-fragile part of the app; a silent
 * column-order change would misclassify every stock's institutional flow with no error raised. */
export function parseT86Row(row: string[]): T86InstitutionalRow {
  return {
    code: row[0],
    name: row[1].trim(),
    foreignNet: parseNumber(row[4]) + parseNumber(row[7]),
    investmentTrustNet: parseNumber(row[10]),
    dealerNet: parseNumber(row[11]),
  };
}

/** T86 for one exact calendar date — [] on weekends/holidays/no-data-yet, never throws for that case. */
async function fetchT86ForDate(d: Date): Promise<T86InstitutionalRow[]> {
  const url = `https://www.twse.com.tw/rwd/zh/fund/T86?response=json&date=${yyyymmdd(d)}&selectType=ALL`;
  const res = await fetchWithRetry(
    url,
    { headers: { "User-Agent": USER_AGENT }, cache: "no-store" },
    { label: `TWSE T86 ${yyyymmdd(d)}` },
  );
  if (!res.ok) return [];
  const json = (await res.json()) as T86Response;
  if (json.stat !== "OK" || !Array.isArray(json.data) || json.data.length === 0) return [];
  return json.data.map(parseT86Row);
}

/**
 * T86 for one exact calendar date, for market-wide historical backfill — includes the real
 * foreign/investment-trust/dealer split (not just the combined total), free and unlimited, no
 * FinMind dependency needed. Returns `[]` on weekends/holidays/no-data-yet — callers walk back
 * days themselves if they need "the latest available day". T86 includes thousands of warrant rows
 * alongside real stocks, so callers should filter the result down to `code`s present in the app's
 * stock directory.
 */
export async function getT86ForDate(d: Date): Promise<T86InstitutionalRow[]> {
  return fetchT86ForDate(d);
}

/**
 * Every TWSE-traded security (ordinary stocks + ETFs) from today's after-trading report — one
 * free, unlimited call covering the whole tradeable universe, no warrants included. Used to build
 * the app's stock directory instead of FinMind's bulk TaiwanStockInfo endpoint, which turned out
 * to be throttled much more aggressively than FinMind's per-stock endpoints (a single "get
 * everything" call kept getting rejected even after per-stock calls had recovered).
 *
 * Returns CSV text (not JSON, despite `response=json`), so this parses it directly.
 */
export async function getAllSecurities(): Promise<{ code: string; name: string }[]> {
  const res = await fetchWithRetry(
    "https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY_ALL?response=json",
    { headers: { "User-Agent": USER_AGENT }, cache: "no-store" },
    { label: "TWSE STOCK_DAY_ALL" },
  );
  if (!res.ok) throw new Error(`TWSE STOCK_DAY_ALL HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.trim().split("\n").slice(1); // skip the header row
  const rows: { code: string; name: string }[] = [];
  for (const line of lines) {
    const fields = line.split(",").map((f) => f.trim().replace(/^"|"$/g, ""));
    if (fields.length < 3 || !fields[1]) continue;
    rows.push({ code: fields[1], name: fields[2] });
  }
  return rows;
}
