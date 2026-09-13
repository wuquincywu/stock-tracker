import { fetchWithRetry, USER_AGENT } from "./httpFetch";
import type { ShareholderConcentrationRow } from "./types";

// TDCC's 集保戶股權分散表 (shareholder distribution by holding-size tier), free open data, no
// token needed. One call returns the WHOLE market's latest weekly snapshot (~4,000 securities x 17
// rows each) — like TWSE's T86/TPEX's institutional report, free and unlimited but only ever "the
// current snapshot", no date-range query. Verified against the real feed (2026-09-11 data):
//
// 資料日期(YYYYMMDD),證券代號,持股分級,人數,股數,占集保庫存數比例%
//
// 持股分級 (holding tier) — reverse-engineered from real rows, not just secondhand docs:
//   1-14: graduated share-count bands from 1-999 up to 800,001-1,000,000
//   15:   1,000,001+ shares — this is what "千張大戶" (big holder) means in this dataset
//   16:   reconciliation/rounding-adjustment row (usually 0, not a real tier)
//   17:   grand-total row across all tiers (percentage always 100%, not a real tier)
// Confirmed against 2330 (TSMC): tier 15 = 1,485 holders, 84.82% of all deposited shares; tier 17's
// 人數 (3,019,610) matches the sum of tiers 1-16, and its percentage is exactly 100.00.
const BIG_HOLDER_TIER = 15;
const TDCC_URL = "https://opendata.tdcc.com.tw/getOD.ashx?id=1-5";

/** One CSV row -> {code, row}, or null for a row this app doesn't care about (any tier besides 15,
 * or a line that doesn't parse). Exported for testing — this is the only place that has to keep up
 * with TDCC's column layout. */
export function parseShareholderConcentrationLine(
  line: string,
): { code: string; row: ShareholderConcentrationRow } | null {
  const fields = line.split(",").map((f) => f.trim());
  if (fields.length < 6) return null;

  const tier = Number(fields[2]);
  if (tier !== BIG_HOLDER_TIER) return null;

  const rawDate = fields[0]; // YYYYMMDD
  if (rawDate.length !== 8) return null;
  const date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`;

  return {
    code: fields[1],
    row: {
      date,
      bigHolderCount: Number(fields[3]),
      bigHolderShares: Number(fields[4]),
      bigHolderPct: Number(fields[5]),
    },
  };
}

/**
 * This week's whole-market big-holder concentration snapshot, keyed by stock code. Only tier-15
 * rows are kept (everything else is a smaller tier, the adjustment row, or the total row — see the
 * tier table above); a code not present just hasn't published a big-holder tier yet (e.g. brand-new
 * listing) or isn't a real stock (warrant codes etc., filtered out by the caller against the app's
 * own stock directory instead of here, matching how TWSE/TPEX's whole-market feeds are handled).
 */
export async function getShareholderConcentrationSnapshot(): Promise<Map<string, ShareholderConcentrationRow>> {
  const res = await fetchWithRetry(
    TDCC_URL,
    { headers: { "User-Agent": USER_AGENT }, cache: "no-store" },
    { label: "TDCC shareholder distribution" },
  );
  if (!res.ok) throw new Error(`TDCC shareholder distribution HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.trim().split(/\r?\n/).slice(1); // skip the header row (also strips its BOM)

  const byCode = new Map<string, ShareholderConcentrationRow>();
  for (const line of lines) {
    const parsed = parseShareholderConcentrationLine(line);
    if (parsed) byCode.set(parsed.code, parsed.row);
  }
  return byCode;
}
