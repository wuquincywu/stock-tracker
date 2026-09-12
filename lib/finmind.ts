import { fetchWithRetry, USER_AGENT } from "./httpFetch";
import type { InstitutionalRow, Market, PriceRow } from "./types";

const BASE_URL = "https://api.finmindtrade.com/api/v4/data";

function authParam(): string {
  const token = process.env.FINMIND_TOKEN;
  return token ? `&token=${encodeURIComponent(token)}` : "";
}

async function finmindGet<T>(dataset: string, params: Record<string, string>): Promise<T[]> {
  const qs = new URLSearchParams({ dataset, ...params }).toString();
  const res = await fetchWithRetry(
    `${BASE_URL}?${qs}${authParam()}`,
    { headers: { "User-Agent": USER_AGENT }, cache: "no-store" },
    { label: `FinMind ${dataset}` },
  );
  if (!res.ok) throw new Error(`FinMind ${dataset} HTTP ${res.status}`);
  const json = (await res.json()) as { status: number; msg: string; data: T[] };
  if (json.status !== 200) throw new Error(`FinMind ${dataset} error: ${json.msg}`);
  return json.data;
}

interface FinMindPriceRow {
  date: string;
  stock_id: string;
  open: number;
  max: number;
  min: number;
  close: number;
  Trading_Volume: number;
}

export async function getPriceSeries(code: string, startDate: string, endDate: string): Promise<PriceRow[]> {
  const rows = await finmindGet<FinMindPriceRow>("TaiwanStockPrice", {
    data_id: code,
    start_date: startDate,
    end_date: endDate,
  });
  return rows
    .map((r) => ({
      date: r.date,
      open: r.open,
      high: r.max,
      low: r.min,
      close: r.close,
      volume: r.Trading_Volume,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

interface FinMindInstitutionalRow {
  date: string;
  stock_id: string;
  name: string;
  buy: number;
  sell: number;
}

const FOREIGN_CATEGORIES = new Set(["Foreign_Investor", "Foreign_Dealer_Self"]);
const TRUST_CATEGORIES = new Set(["Investment_Trust"]);
const DEALER_CATEGORIES = new Set(["Dealer_self", "Dealer_Hedging"]);

export async function getInstitutionalSeries(
  code: string,
  startDate: string,
  endDate: string,
): Promise<InstitutionalRow[]> {
  const rows = await finmindGet<FinMindInstitutionalRow>("TaiwanStockInstitutionalInvestorsBuySell", {
    data_id: code,
    start_date: startDate,
    end_date: endDate,
  });

  const byDate = new Map<string, InstitutionalRow>();
  for (const r of rows) {
    const net = r.buy - r.sell;
    const entry = byDate.get(r.date) ?? {
      date: r.date,
      foreignNet: 0,
      investmentTrustNet: 0,
      dealerNet: 0,
    };
    if (FOREIGN_CATEGORIES.has(r.name)) entry.foreignNet += net;
    else if (TRUST_CATEGORIES.has(r.name)) entry.investmentTrustNet += net;
    else if (DEALER_CATEGORIES.has(r.name)) entry.dealerNet += net;
    byDate.set(r.date, entry);
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

interface FinMindStockInfoRow {
  stock_id: string;
  stock_name: string;
  type: "twse" | "tpex";
  industry_category: string;
}

// FinMind buckets warrants (權證) under this generic category — the only reliable way to tell
// them apart from real stocks/ETFs/bond-ETFs in this dataset (there's no separate `type` value).
const NON_STOCK_CATEGORY = "所有證券";

export async function lookupStock(code: string): Promise<{ name: string; market: Market } | null> {
  const rows = await finmindGet<FinMindStockInfoRow>("TaiwanStockInfo", { data_id: code });
  if (rows.length === 0) return null;
  const row = rows[0];
  return { name: row.stock_name, market: row.type === "twse" ? "TWSE" : "TPEX" };
}

export interface StockDirectoryEntry {
  code: string;
  name: string;
  market: Market;
}

/**
 * Full TWSE+TPEX stock directory (code/name/market), for search/autocomplete and market-wide
 * backfills. Deduped by code, and warrants (權證) excluded — they're derivative instruments with
 * short lifespans, not something this app's per-stock indicators (MA/Bollinger/三大法人) are
 * meaningful for, and there are thousands of them cluttering the raw dataset.
 */
export async function getAllStocks(): Promise<StockDirectoryEntry[]> {
  const rows = await finmindGet<FinMindStockInfoRow>("TaiwanStockInfo", {});
  const byCode = new Map<string, StockDirectoryEntry>();
  for (const r of rows) {
    if (r.industry_category === NON_STOCK_CATEGORY) continue;
    if (byCode.has(r.stock_id)) continue;
    byCode.set(r.stock_id, { code: r.stock_id, name: r.stock_name, market: r.type === "twse" ? "TWSE" : "TPEX" });
  }
  return [...byCode.values()];
}
