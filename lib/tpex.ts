import { fetchWithRetry, USER_AGENT } from "./httpFetch";

interface TpexInstiResponse {
  tables?: { fields: string[]; data: string[][] }[];
}

export function parseNumber(raw: string): number {
  return Number(raw.replace(/,/g, ""));
}

function toRocDate(d: Date): string {
  const roc = d.getFullYear() - 1911;
  return `${roc}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

export interface TpexInstitutionalRow {
  code: string;
  name: string;
  foreignNet: number;
  investmentTrustNet: number;
  dealerNet: number;
}

// This endpoint's `fields` are all generically labeled "買進/賣出/買賣超股數" with no category
// names, so the mapping below was reverse-engineered by cross-checking subtotal arithmetic against
// two real stocks (00411A, 3105): col 10 (外資合計) = col 4 (不含自營商) + col 7 (外資自營商); col
// 22 (自營商合計) = col 16 (自行) + col 19 (避險); and the final column (三大法人合計) = col10 +
// col13(投信) + col22 — confirmed exact on both, and col10/col13/col22 match FinMind's
// TaiwanStockInstitutionalInvestorsBuySell numbers for the same stock/date exactly.
/** One row of this endpoint's data table -> TpexInstitutionalRow. Exported for testing — see the
 * reverse-engineering note above; this is the most upstream-fragile part of the TPEX integration. */
export function parseTpexInstitutionalRow(row: string[]): TpexInstitutionalRow {
  return {
    code: row[0],
    name: row[1],
    foreignNet: parseNumber(row[10]),
    investmentTrustNet: parseNumber(row[13]),
    dealerNet: parseNumber(row[22]),
  };
}

/** TPEX 三大法人買賣超日報 for one exact calendar date — [] on weekends/holidays/no-data. */
async function fetchInstitutionalForDate(d: Date): Promise<TpexInstitutionalRow[]> {
  const url = `https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php?l=zh-tw&d=${toRocDate(d)}&t=D&o=json`;
  const res = await fetchWithRetry(
    url,
    { headers: { "User-Agent": USER_AGENT }, cache: "no-store" },
    { label: `TPEX 3insti ${toRocDate(d)}` },
  );
  if (!res.ok) return [];
  const json = (await res.json()) as TpexInstiResponse;
  const table = json.tables?.[0];
  if (!table || !Array.isArray(table.data) || table.data.length === 0) return [];
  return table.data.map(parseTpexInstitutionalRow);
}

/**
 * TPEX 三大法人買賣超日報 for one exact calendar date, for market-wide historical backfill —
 * includes the real foreign/investment-trust/dealer split (not just the combined total), free and
 * unlimited, no FinMind dependency needed. Returns `[]` on weekends/holidays. Uses TPEX's legacy
 * report endpoint (not the openapi.tpex.org.tw snapshot, which ignores date params and only ever
 * returns "today") since this one actually respects the `d` (ROC date) parameter.
 */
export async function getInstitutionalForDate(d: Date): Promise<TpexInstitutionalRow[]> {
  return fetchInstitutionalForDate(d);
}

interface TpexDailyQuoteRow {
  SecuritiesCompanyCode: string;
  CompanyName: string;
}

// Ordinary TPEX stocks are exactly 4 numeric digits; ETFs (incl. bond ETFs) start with "00".
// Everything else in this feed (6-digit codes etc.) is warrants, which this app has no use for.
const REAL_SECURITY_CODE = /^([0-9]{4}|00[0-9A-Z]{2,4})$/;

/**
 * Every TPEX-traded security (ordinary stocks + ETFs) from today's daily quotes — one free,
 * unlimited call covering the whole OTC tradeable universe. Unlike TWSE's equivalent report, this
 * feed does include warrants, so results are filtered down to real stock/ETF code patterns.
 */
export async function getAllSecurities(): Promise<{ code: string; name: string }[]> {
  const res = await fetchWithRetry(
    "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",
    { headers: { "User-Agent": USER_AGENT }, cache: "no-store" },
    { label: "TPEX daily quotes" },
  );
  if (!res.ok) throw new Error(`TPEX daily quotes HTTP ${res.status}`);
  const json = (await res.json()) as TpexDailyQuoteRow[];
  if (!Array.isArray(json)) return [];

  const byCode = new Map<string, { code: string; name: string }>();
  for (const row of json) {
    const code = row.SecuritiesCompanyCode;
    if (!REAL_SECURITY_CODE.test(code) || byCode.has(code)) continue;
    byCode.set(code, { code, name: row.CompanyName });
  }
  return [...byCode.values()];
}
