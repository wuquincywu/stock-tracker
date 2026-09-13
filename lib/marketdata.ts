import { buildCard, type CardIdentity } from "./cardBuilder";
import { chunkedMap } from "./concurrency";
import * as finmind from "./finmind";
import { bollingerBands } from "./indicators";
import {
  DEFAULT_CHART_MONTHS,
  getCachedMarketCards,
  getCachedStockDirectory,
  getMaLines,
  getStoredInstitutionalHistory,
  getStoredInstitutionalHistoryBulk,
  getStoredPriceHistory,
  getStoredPriceHistoryBulk,
  getStoredShareholderConcentrationBulk,
  isHistoryFresh,
  isStockDirectoryFresh,
  markHistoryFresh,
  markStockDirectoryFresh,
  mergeStoredInstitutionalHistory,
  mergeStoredPriceHistory,
  mergeStoredShareholderConcentration,
  setCachedMarketCards,
  setCachedStockDirectory,
} from "./redis";
import * as tdcc from "./tdcc";
import * as tpex from "./tpex";
import * as twse from "./twse";
import type { BollingerPoint, InstitutionalRow, MaLine, Market, PriceRow, WatchlistCardData } from "./types";
import type { StockDirectoryEntry } from "./finmind";

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Read-only price history (for MA / Bollinger calculations), filtered to the last `months`.
 * Never hits a live data source — prices only change once a day after close, so page views don't
 * need to trigger an external API call; `refreshPriceSeries` (called only by the daily cron) is
 * what actually keeps this stock's stored history current. A stock nobody has refreshed yet (just
 * added to the watchlist before the next cron run, or a `months` range wider than what's stored)
 * simply returns however much stored history covers.
 */
export async function getPriceSeries(code: string, months: number): Promise<PriceRow[]> {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const cutoffStr = toIsoDate(cutoff);
  const stored = await getStoredPriceHistory(code);
  return stored.filter((r) => r.date >= cutoffStr);
}

/**
 * Read-only 三大法人 (foreign / investment trust / dealer) net buy-sell history — same read-only
 * contract as `getPriceSeries` above (see its doc comment); `refreshInstitutionalSeries` is what
 * actually updates the stored data. `days` means "how many of the most recent stored trading-day
 * rows to return".
 */
export async function getInstitutionalSeries(code: string, days = 10): Promise<InstitutionalRow[]> {
  const stored = await getStoredInstitutionalHistory(code);
  return stored.slice(-days);
}

/**
 * Live-fetches price history and merges it into Redis, returning the merged+filtered result.
 * Only the daily cron (`/api/cron/check-alerts`) calls this — it's the sole trigger that keeps a
 * tracked stock's stored price history current; page views read via `getPriceSeries` instead and
 * never trigger a live fetch.
 *
 * TWSE-listed stocks: prefer the official, free, unlimited STOCK_DAY endpoint (real per-stock
 * monthly history). TPEX has no equivalent per-stock history endpoint at all, so OTC stocks -
 * and any TWSE call that errors out - fall back to FinMind, which covers both markets with a
 * single date-ranged query.
 *
 * Always live-fetches — no freshness/staleness check gates WHETHER this runs, since callers (the
 * daily cron, and the chart's explicit "show more months" button) already control how often this
 * runs; a silent skip-if-recently-fetched check here previously caused real bugs (stale/wrong data
 * served without any way for the caller to tell), so there isn't one. What it fetches CAN still
 * shrink once a stock already has enough backfilled history (see INCREMENTAL_FETCH_MONTHS below) —
 * that's a different thing from skipping the fetch outright, and it only ever affects how much gets
 * re-fetched, never whether today's new row gets picked up.
 */
const MIN_STORED_DAYS_FOR_INCREMENTAL_FETCH = 70; // comfortably past MA60's warm-up plus slack for holidays
// Once a stock has that much history already, the daily cron only needs enough of the most recent
// calendar time to pick up new trading day(s) since the last run, not `months` (which a user can
// set as high as MAX_CHART_MONTHS = 24) — re-fetching the whole configured window from TWSE/FinMind
// every single day for every tracked stock was needlessly large: 2 months of daily overlap is far
// more than enough to cover any realistic gap (a missed cron run, a long weekend), while merging by
// date (mergeStoredPriceHistory) makes a wider-than-needed overlap harmless either way.
const INCREMENTAL_FETCH_MONTHS = 2;

export async function refreshPriceSeries(code: string, market: Market, months: number): Promise<PriceRow[]> {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const cutoffStr = toIsoDate(cutoff);

  const existing = await getStoredPriceHistory(code);
  const fetchMonths =
    existing.length >= MIN_STORED_DAYS_FOR_INCREMENTAL_FETCH ? Math.min(months, INCREMENTAL_FETCH_MONTHS) : months;

  let fresh: PriceRow[] = [];
  try {
    if (market === "TWSE") {
      fresh = await twse.getPriceHistory(code, fetchMonths);
    }
    if (fresh.length === 0) {
      const end = new Date();
      const start = new Date(end);
      start.setMonth(start.getMonth() - fetchMonths);
      fresh = await finmind.getPriceSeries(code, toIsoDate(start), toIsoDate(end));
    }
    // Marks this stock as recently-updated for backfillTwseMarketPrices's own resumability check
    // (skip re-fetching a stock that was already handled a moment ago) — unrelated to, and no
    // longer read by, this function itself.
    if (fresh.length > 0) await markHistoryFresh(code, "price");
  } catch (err) {
    console.error(`[refreshPriceSeries] live fetch failed for ${code} (${market}), serving stored history:`, err);
    fresh = [];
  }

  const merged = await mergeStoredPriceHistory(code, fresh);
  return merged.filter((r) => r.date >= cutoffStr);
}

/**
 * Live-fetches 三大法人 history and merges it into Redis — same cron-only contract as
 * `refreshPriceSeries` above (see its doc comment): always fetches, no freshness gate.
 *
 * TWSE's official T86 report only ever returns a single trading day at a time (no date-range
 * query), which can't produce the short trailing history this app needs for cross-detection and
 * the UI table. FinMind's institutional dataset supports real date ranges for both markets, so
 * it's used uniformly here rather than stitching together many single-day official calls.
 */
export async function refreshInstitutionalSeries(code: string, days = 10): Promise<InstitutionalRow[]> {
  let fresh: InstitutionalRow[] = [];
  try {
    const end = new Date();
    const start = new Date(end);
    start.setDate(start.getDate() - days * 3); // buffer for weekends/holidays
    fresh = await finmind.getInstitutionalSeries(code, toIsoDate(start), toIsoDate(end));
  } catch (err) {
    console.error(`[refreshInstitutionalSeries] live fetch failed for ${code}, serving stored history:`, err);
    fresh = [];
  }

  const merged = await mergeStoredInstitutionalHistory(code, fresh);
  return merged.slice(-days);
}

export interface ChartSeries {
  prices: PriceRow[];
  bands: BollingerPoint[];
}

// Bollinger needs a 20-day SMA warm-up and MA60 needs 60 days, so fetching only the displayed
// `months` window would leave the start of the chart without a band/MA60 line. This extra padding
// is fetched/read for the calculation only and trimmed back off before returning. Exported so
// callers needing the same warm-up for their own latest-day-only calc (e.g. the stock detail
// page's MA/Bollinger badges above the chart) can match it without duplicating the number.
export const CHART_CALC_BUFFER_MONTHS = 3;

// Rough trading-days-per-month conversion used to size the 三大法人 chart history to match
// whatever price-chart month range is currently selected. Previously the stock detail page and its
// month-range API both used an unrelated FIXED 40-day cap for institutional data regardless of the
// requested `months` — so picking "12個月" or "24個月" widened the price chart but left the
// institutional bar histogram stuck at the same ~40 days, visually stranded in a small sliver of
// the now-much-wider timeline. The 40-day floor here still covers classifyInstitutionalLevel's own
// MIN_HISTORY_FOR_LEVEL baseline for a short display range.
const TRADING_DAYS_PER_MONTH = 22;
export function institutionalDaysForMonths(months: number): number {
  return Math.max(40, months * TRADING_DAYS_PER_MONTH);
}

/**
 * Chart-ready price series + Bollinger bands for the stock detail page's chart and its month-range
 * API (`/api/stock/[code]?months=`). `live: true` uses `refreshPriceSeries` (live-fetches and
 * merges into Redis); `live: false` uses the read-only `getPriceSeries`. Callers decide which based
 * on how many months are being requested — see the API route for the actual threshold.
 */
export async function getChartSeries(code: string, market: Market, months: number, live: boolean): Promise<ChartSeries> {
  const fetchMonths = months + CHART_CALC_BUFFER_MONTHS;
  const calcPrices = live ? await refreshPriceSeries(code, market, fetchMonths) : await getPriceSeries(code, fetchMonths);
  const calcBands = bollingerBands(calcPrices);

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const cutoffStr = toIsoDate(cutoff);

  return {
    prices: calcPrices.filter((p) => p.date >= cutoffStr),
    bands: calcBands.filter((b) => b.date >= cutoffStr),
  };
}

const SEARCH_RESULT_LIMIT = 8;

/**
 * Builds the stock directory from TWSE's and TPEX's own daily-quotes reports (free, unlimited,
 * warrant-free-or-filtered) rather than FinMind's bulk TaiwanStockInfo endpoint — that endpoint
 * turned out to be throttled far more aggressively than FinMind's per-stock endpoints (a single
 * "get everything" call kept getting rejected long after per-stock calls had recovered), making it
 * an unreliable base for something the whole app depends on.
 *
 * Falls back to FinMind **per market**, not only when both fail — a real incident showed why
 * this matters: TPEX's own endpoint started truncating its response mid-stream (a connection
 * reset partway through the body, not an HTTP error status, so fetchWithRetry's retries didn't
 * help either) while TWSE's kept working fine. With the old "only fall back if BOTH are empty"
 * check, that silently produced a directory with TWSE stocks only — 所有股票, search, and this
 * app's other free whole-market data sources (T86 market-wide institutional backfill, TDCC
 * big-holder concentration) all filter against this directory, so losing an entire market from it
 * doesn't fail loudly, it just makes every TPEX stock invisible to those features. Falling back
 * independently for whichever market's own source came back empty keeps one market's outage from
 * taking out the other's directory coverage.
 */
async function fetchStockDirectory(): Promise<StockDirectoryEntry[]> {
  const [twseRows, tpexRows, emergingRows] = await Promise.all([
    twse.getAllSecurities().catch((err) => {
      console.error("[fetchStockDirectory] TWSE getAllSecurities failed:", err);
      return [];
    }),
    tpex.getAllSecurities().catch((err) => {
      console.error("[fetchStockDirectory] TPEX getAllSecurities failed:", err);
      return [];
    }),
    tpex.getEmergingDailyQuotes().catch((err) => {
      console.error("[fetchStockDirectory] TPEX emerging (興櫃) getEmergingDailyQuotes failed:", err);
      return [];
    }),
  ]);

  const byCode = new Map<string, StockDirectoryEntry>();
  for (const r of twseRows) byCode.set(r.code, { code: r.code, name: r.name, market: "TWSE" });
  for (const r of tpexRows) byCode.set(r.code, { code: r.code, name: r.name, market: "TPEX" });
  for (const r of emergingRows) byCode.set(r.code, { code: r.code, name: r.name, market: "EMERGING" });

  if (twseRows.length === 0 || tpexRows.length === 0 || emergingRows.length === 0) {
    try {
      const finmindAll = await finmind.getAllStocks();
      if (twseRows.length === 0) {
        for (const r of finmindAll) if (r.market === "TWSE") byCode.set(r.code, r);
      }
      if (tpexRows.length === 0) {
        for (const r of finmindAll) if (r.market === "TPEX") byCode.set(r.code, r);
      }
      if (emergingRows.length === 0) {
        for (const r of finmindAll) if (r.market === "EMERGING") byCode.set(r.code, r);
      }
    } catch (err) {
      console.error("[fetchStockDirectory] FinMind per-market fallback failed:", err);
    }
  }

  // Free side benefit: getEmergingDailyQuotes() already fetched today's price for every 興櫃 stock
  // just to build the directory above — merge it into stored price history too, the same call
  // doing double duty. Without this, a 興櫃 stock would show no price/MA/Bollinger on 所有股票 until
  // someone happens to track it (triggering the per-stock FinMind fallback in refreshPriceSeries) —
  // 興櫃 has no free per-stock history endpoint, so there's no other free whole-market backfill for
  // it the way T86/TPEX's daily report covers price+institutional for the other two markets.
  if (emergingRows.length > 0) {
    await chunkedMap(emergingRows, 20, (r) =>
      mergeStoredPriceHistory(r.code, [r.price]).catch((err) => {
        console.error(`[fetchStockDirectory] failed to seed 興櫃 price for ${r.code}:`, err);
      }),
    );
  }

  return [...byCode.values()];
}

/**
 * Reads the stored directory and, once a day, refreshes it — but by merging the fresh fetch INTO
 * the stored one (fresh entries overwrite matching codes; anything fresh didn't cover is left
 * untouched), never by replacing the stored directory outright. See setCachedStockDirectory's doc
 * comment for why a straight replace is dangerous: one market's source failing shouldn't blank that
 * market out of the app. The tradeoff is that a genuinely delisted stock lingers in the directory
 * rather than disappearing the moment it stops appearing in fresh data — acceptable; the failure
 * mode this avoids (an entire market vanishing from search/所有股票/every free whole-market
 * feature that filters against this directory) is far worse than a stale entry or two.
 */
export async function getStockDirectory(): Promise<StockDirectoryEntry[]> {
  const stored = await getCachedStockDirectory();
  if (stored && (await isStockDirectoryFresh())) return stored;

  const fetched = await fetchStockDirectory();
  const byCode = new Map((stored ?? []).map((e) => [e.code, e]));
  for (const entry of fetched) byCode.set(entry.code, entry);
  const merged = [...byCode.values()];

  if (merged.length > 0) {
    await setCachedStockDirectory(merged);
    await markStockDirectoryFresh();
  }
  return merged;
}

/**
 * Looks up a stock's name/market for the detail page header. Reads from the (already-cached)
 * stock directory instead of hitting FinMind live on every single page view — this used to call
 * FinMind directly every time, which broke the stock page whenever FinMind's shared rate limit
 * was busy elsewhere (e.g. a backfill script running). Falls back to a live FinMind lookup only
 * for a code that genuinely isn't in the directory yet (very recently listed).
 */
export async function lookupStock(code: string): Promise<{ name: string; market: Market } | null> {
  const directory = await getStockDirectory();
  const entry = directory.find((d) => d.code === code);
  if (entry) return { name: entry.name, market: entry.market };
  return finmind.lookupStock(code);
}

/**
 * Search the full TWSE+TPEX stock directory by code prefix or (Chinese) name substring, for the
 * watchlist add-stock autocomplete. Exact code matches rank first, then code-prefix matches, then
 * name matches.
 */
export async function searchStocks(query: string): Promise<StockDirectoryEntry[]> {
  const q = query.trim();
  if (!q) return [];
  const qLower = q.toLowerCase();

  const directory = await getStockDirectory();

  const exact: StockDirectoryEntry[] = [];
  const codePrefix: StockDirectoryEntry[] = [];
  const nameMatch: StockDirectoryEntry[] = [];

  for (const entry of directory) {
    if (entry.code.toLowerCase() === qLower) {
      exact.push(entry);
    } else if (entry.code.toLowerCase().startsWith(qLower)) {
      codePrefix.push(entry);
    } else if (entry.name.includes(q)) {
      nameMatch.push(entry);
    }
  }

  return [...exact, ...codePrefix, ...nameMatch].slice(0, SEARCH_RESULT_LIMIT);
}

export interface MarketInstitutionalBackfillSummary {
  tradingDaysCollected: number;
  stocksUpdated: number;
  /** false if the time budget ran out before the trading-days target / calendar window was reached — call again to continue. */
  completed: boolean;
}

/**
 * Backfills REAL 三大法人買賣超 history — foreign/investment-trust/dealer split, not just the
 * combined total — for EVERY stock in the directory (not just tracked ones), using T86 (TWSE) +
 * TPEX's daily report. Both free, unlimited, whole-market-per-call sources turn out to already
 * carry the full per-category breakdown in columns this app wasn't previously parsing (verified
 * against FinMind's TaiwanStockInstitutionalInvestorsBuySell numbers — exact match for known
 * stocks/dates; see the column-mapping comments in lib/twse.ts's getT86ForDate and lib/tpex.ts's
 * getInstitutionalForDate). This means the whole market's real split, for as many days back as
 * needed, costs only ~2 HTTP calls per trading day walked back — no FinMind dependency, no rate
 * limit, regardless of how many stocks exist. (scripts/backfill-institutional-breakdown.mjs, which
 * used FinMind per-stock for this, is now obsolete for market-wide use — FinMind is still used by
 * the daily cron's refreshInstitutionalSeries, but that's only ever a handful of tracked stocks.)
 *
 * `deadline` (a `Date.now()`-style timestamp) stops the calendar-day walk early so this stays
 * inside a serverless function's time budget (e.g. Vercel Hobby's 60s cap) — whatever's been
 * collected so far is still merged into Redis, and `completed: false` tells the caller to invoke
 * this again to keep walking back.
 */
export async function backfillMarketInstitutional(
  tradingDaysTarget = 40,
  calendarDaysWindow = 70,
  deadline = Date.now() + 50_000,
): Promise<MarketInstitutionalBackfillSummary> {
  const directory = await getStockDirectory();
  const directoryByCode = new Map(directory.map((d) => [d.code, d]));

  const byCode = new Map<string, InstitutionalRow[]>();
  let tradingDaysCollected = 0;
  const now = new Date();

  let daysBack = 0;
  for (; daysBack < calendarDaysWindow && tradingDaysCollected < tradingDaysTarget; daysBack++) {
    if (Date.now() >= deadline) break;
    const d = new Date(now);
    d.setDate(d.getDate() - daysBack);
    const dateStr = toIsoDate(d);

    const [twseRows, tpexRows] = await Promise.all([
      twse.getT86ForDate(d).catch((err) => {
        console.error(`[backfillMarketInstitutional] TWSE T86 failed for ${dateStr}:`, err);
        return [];
      }),
      tpex.getInstitutionalForDate(d).catch((err) => {
        console.error(`[backfillMarketInstitutional] TPEX institutional failed for ${dateStr}:`, err);
        return [];
      }),
    ]);
    if (twseRows.length === 0 && tpexRows.length === 0) continue; // weekend/holiday — doesn't count toward the target

    tradingDaysCollected++;
    for (const row of [...twseRows.map((r) => ({ ...r, market: "TWSE" as const })), ...tpexRows.map((r) => ({ ...r, market: "TPEX" as const }))]) {
      const dirEntry = directoryByCode.get(row.code);
      if (!dirEntry || dirEntry.market !== row.market) continue;
      const list = byCode.get(row.code) ?? [];
      list.push({
        date: dateStr,
        foreignNet: row.foreignNet,
        investmentTrustNet: row.investmentTrustNet,
        dealerNet: row.dealerNet,
      });
      byCode.set(row.code, list);
    }
  }

  const codes = [...byCode.keys()];
  await chunkedMap(codes, 20, async (code) => {
    const rows = byCode.get(code)!.sort((a, b) => a.date.localeCompare(b.date));
    await mergeStoredInstitutionalHistory(code, rows);
  });

  const completed = tradingDaysCollected >= tradingDaysTarget || daysBack >= calendarDaysWindow;
  return { tradingDaysCollected, stocksUpdated: codes.length, completed };
}

export interface MarketPriceBackfillSummary {
  attempted: number;
  updated: number;
  skipped: number;
  failed: number;
  /** false if the time budget ran out before every TWSE stock was visited — call again to continue. */
  completed: boolean;
}

/**
 * Backfills price history for every TWSE-listed stock (free, unlimited STOCK_DAY endpoint) so the
 * "所有股票" page can eventually show the same MA / Bollinger / price-change info as the
 * watchlist, without a live per-stock fetch on every page view. TPEX stocks have no free per-stock
 * history endpoint (would need FinMind, which is rate-limited) — handled by a separate script.
 *
 * Skips a stock entirely (cheap Redis GET, no HTTP call) if it was already fetched within the last
 * few hours — by this same function on a previous (deadline-cut-short) call, or by the daily cron's
 * `refreshPriceSeries` for a tracked stock — via the `price` marker `markHistoryFresh` sets after a
 * successful fetch. This is purely a resumability optimization for THIS backfill run; it's not a
 * display-facing staleness cache (nothing on the read path checks it).
 */
export async function backfillTwseMarketPrices(
  months = 4,
  concurrency = 6,
  deadline = Date.now() + 50_000,
): Promise<MarketPriceBackfillSummary> {
  const directory = await getStockDirectory();
  const twseStocks = directory.filter((d) => d.market === "TWSE");

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let attempted = 0;

  for (let i = 0; i < twseStocks.length; i += concurrency) {
    if (Date.now() >= deadline) break;
    const batch = twseStocks.slice(i, i + concurrency);
    attempted += batch.length;
    await Promise.all(
      batch.map(async (stock) => {
        try {
          if (await isHistoryFresh(stock.code, "price")) {
            skipped++;
            return;
          }
          const fresh = await twse.getPriceHistory(stock.code, months);
          if (fresh.length > 0) {
            await mergeStoredPriceHistory(stock.code, fresh);
            await markHistoryFresh(stock.code, "price");
            updated++;
          } else {
            failed++;
          }
        } catch (err) {
          console.error(`[backfillTwseMarketPrices] ${stock.code} failed:`, err);
          failed++;
        }
      }),
    );
  }

  return { attempted, updated, skipped, failed, completed: attempted >= twseStocks.length };
}

export interface ShareholderConcentrationRefreshSummary {
  stocksUpdated: number;
}

/**
 * Weekly whole-market refresh of 集保戶股權分散表 (big-holder / 千張大戶 concentration, tier 15 —
 * see lib/tdcc.ts). TDCC's free open-data endpoint only ever serves the latest week's snapshot (no
 * date-range query, unlike TWSE's per-stock STOCK_DAY), so this app's own history for it can only
 * ever grow forward from whenever this first runs — same "free, whole-market-per-call" shape as
 * backfillMarketInstitutional above, just triggered weekly instead of daily (see
 * app/api/cron/refresh-shareholder-concentration/route.ts) since the underlying data itself only
 * changes once a week (Friday close, published ~16:00).
 */
export async function refreshMarketShareholderConcentration(): Promise<ShareholderConcentrationRefreshSummary> {
  const [snapshot, directory] = await Promise.all([tdcc.getShareholderConcentrationSnapshot(), getStockDirectory()]);
  const directoryCodes = new Set(directory.map((d) => d.code));

  // TDCC's feed covers every deposited security (ETFs, bonds, etc.), not just this app's stock
  // directory — only merge in codes this app actually tracks/shows, same filtering approach as
  // backfillMarketInstitutional does against T86/TPEX's own whole-market rows.
  const codes = [...snapshot.keys()].filter((code) => directoryCodes.has(code));
  await chunkedMap(codes, 20, (code) => mergeStoredShareholderConcentration(code, [snapshot.get(code)!]));

  return { stocksUpdated: codes.length };
}

interface MarketCardsCache {
  cards: WatchlistCardData[];
  builtAt: number;
}

let marketCardsCache: MarketCardsCache | null = null;
// Rebuilding this involves 2 bulk Redis reads (~2400 keys each) plus per-stock indicator math over
// the whole directory, which takes several seconds — noticeable as "stuck" on page navigation
// without a loading state. 15 minutes keeps that cost rare (prices/institutional data only change
// once a day after close anyway) while still picking up a fresh backfill reasonably soon.
const MARKET_CARDS_CACHE_TTL_MS = 15 * 60 * 1000;

// Vercel serverless instances don't share memory, so the in-process cache above only helps within
// a single warm instance. This mirrors the built cards into Redis (same TTL) so concurrent/cold
// instances can reuse a build another instance already did instead of every one of them recomputing
// it independently.
let inFlightBuild: Promise<WatchlistCardData[]> | null = null;

/**
 * Bulk-reads stored price/institutional/big-holder history for `entries` and builds a rich card for
 * each via `buildCard` (lib/cardBuilder.ts) — the shared implementation used by both the watchlist
 * page (per-user tracked stocks) and the market-wide cache below (the whole directory). Three bulk
 * MGETs total, regardless of how many entries — never a per-stock round-trip, and never a live
 * fetch (reads only what's already stored; see getPriceSeries/getInstitutionalSeries's own doc
 * comments — the big-holder history is likewise only ever updated by the weekly refresh below).
 */
export async function buildCardsForEntries(
  entries: CardIdentity[],
  chartMonths: number,
  maLines: MaLine[],
): Promise<WatchlistCardData[]> {
  const codes = entries.map((e) => e.code);
  const [priceMap, institutionalMap, concentrationMap] = await Promise.all([
    getStoredPriceHistoryBulk(codes),
    getStoredInstitutionalHistoryBulk(codes),
    getStoredShareholderConcentrationBulk(codes),
  ]);

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - chartMonths);
  const cutoffStr = toIsoDate(cutoff);

  return entries.map((entry) => {
    const priceSeries = (priceMap.get(entry.code) ?? []).filter((p) => p.date >= cutoffStr);
    const institutional = institutionalMap.get(entry.code) ?? [];
    const concentration = concentrationMap.get(entry.code) ?? [];
    return buildCard(entry, priceSeries, institutional, maLines, concentration);
  });
}

async function buildAllMarketCards(): Promise<WatchlistCardData[]> {
  // This builds the shared "所有股票" cache (not any one user's view), so chartMonths — now a
  // per-user setting — can't apply here; it always uses the app default.
  const [directory, maLines] = await Promise.all([getStockDirectory(), getMaLines()]);
  // Some stocks' history may still be incomplete or missing (market-wide backfill still catching
  // up); their badges just don't show yet until it reaches them.
  const cards = await buildCardsForEntries(directory, DEFAULT_CHART_MONTHS, maLines);

  // Sorted once here (this only reruns every MARKET_CARDS_CACHE_TTL_MS, not per request) instead of
  // by every reader — the default view (no filter, sort=code asc, by far the most common case) can
  // then just filter+slice this array as-is without a redundant re-sort of its own. See
  // app/api/market/route.ts and app/market/page.tsx.
  return cards.sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * All ~2400 TWSE+TPEX stocks as rich cards (same shape as the watchlist), for the "所有股票"
 * browse page. Building this involves a couple of bulk Redis reads plus per-stock indicator math
 * over the whole directory, so it's cached in-process for a couple of minutes — filtering/sorting/
 * paginating that page shouldn't redo this work on every request.
 */
export async function getAllMarketCards(): Promise<WatchlistCardData[]> {
  if (marketCardsCache && Date.now() - marketCardsCache.builtAt < MARKET_CARDS_CACHE_TTL_MS) {
    return marketCardsCache.cards;
  }

  // A single in-flight build is shared by any concurrent callers on this instance, so a cache
  // expiry under real traffic doesn't trigger N simultaneous rebuilds.
  if (inFlightBuild) return inFlightBuild;

  inFlightBuild = (async () => {
    const sharedCards = await getCachedMarketCards();
    if (sharedCards) {
      marketCardsCache = { cards: sharedCards, builtAt: Date.now() };
      return sharedCards;
    }

    const cards = await buildAllMarketCards();
    marketCardsCache = { cards, builtAt: Date.now() };
    await setCachedMarketCards(cards);
    return cards;
  })();

  try {
    return await inFlightBuild;
  } finally {
    inFlightBuild = null;
  }
}
