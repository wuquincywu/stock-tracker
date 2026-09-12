import {
  analyzeBollinger,
  bollingerBands,
  classifyInstitutionalLevel,
  computeInstitutionalStreaks,
  latestMaSnapshot,
} from "./indicators";
import * as finmind from "./finmind";
import {
  DEFAULT_CHART_MONTHS,
  getCachedMarketCards,
  getCachedStockDirectory,
  getMaLines,
  getStoredInstitutionalHistory,
  getStoredInstitutionalHistoryBulk,
  getStoredPriceHistory,
  getStoredPriceHistoryBulk,
  isHistoryFresh,
  markHistoryFresh,
  mergeStoredInstitutionalHistory,
  mergeStoredPriceHistory,
  setCachedMarketCards,
  setCachedStockDirectory,
} from "./redis";
import * as tpex from "./tpex";
import * as twse from "./twse";
import type { BollingerPoint, InstitutionalRow, Market, PriceRow, WatchlistCardData } from "./types";
import type { StockDirectoryEntry } from "./finmind";

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function chunkedMap<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    results.push(...(await Promise.all(batch.map(fn))));
  }
  return results;
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
 * Always live-fetches — no freshness/staleness check gates this, since callers (the daily cron,
 * and the chart's explicit "show more months" button) already control how often this runs; a
 * silent skip-if-recently-fetched check here previously caused real bugs (stale/wrong data served
 * without any way for the caller to tell), so there isn't one.
 */
export async function refreshPriceSeries(code: string, market: Market, months: number): Promise<PriceRow[]> {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const cutoffStr = toIsoDate(cutoff);

  let fresh: PriceRow[] = [];
  try {
    if (market === "TWSE") {
      fresh = await twse.getPriceHistory(code, months);
    }
    if (fresh.length === 0) {
      const end = new Date();
      const start = new Date(end);
      start.setMonth(start.getMonth() - months);
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
 * an unreliable base for something the whole app depends on. Falls back to FinMind only if BOTH
 * official sources fail (e.g. a holiday with no daily quotes published yet).
 */
async function fetchStockDirectory(): Promise<StockDirectoryEntry[]> {
  const [twseRows, tpexRows] = await Promise.all([
    twse.getAllSecurities().catch((err) => {
      console.error("[fetchStockDirectory] TWSE getAllSecurities failed:", err);
      return [];
    }),
    tpex.getAllSecurities().catch((err) => {
      console.error("[fetchStockDirectory] TPEX getAllSecurities failed:", err);
      return [];
    }),
  ]);

  if (twseRows.length === 0 && tpexRows.length === 0) {
    return finmind.getAllStocks();
  }

  const byCode = new Map<string, StockDirectoryEntry>();
  for (const r of twseRows) byCode.set(r.code, { code: r.code, name: r.name, market: "TWSE" });
  for (const r of tpexRows) byCode.set(r.code, { code: r.code, name: r.name, market: "TPEX" });
  return [...byCode.values()];
}

export async function getStockDirectory(): Promise<StockDirectoryEntry[]> {
  const cached = await getCachedStockDirectory();
  if (cached) return cached;

  const fresh = await fetchStockDirectory();
  await setCachedStockDirectory(fresh);
  return fresh;
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

async function buildAllMarketCards(): Promise<WatchlistCardData[]> {
  // This builds the shared "所有股票" cache (not any one user's view), so chartMonths — now a
  // per-user setting — can't apply here; it always uses the app default.
  const [directory, maLines] = await Promise.all([getStockDirectory(), getMaLines()]);
  const chartMonths = DEFAULT_CHART_MONTHS;

  // Reads whatever's already stored (from the market-wide backfill + tracked-stock views) — never
  // a live per-stock fetch, since that would mean thousands of live API calls on every page view.
  // Some stocks' history may still be incomplete or missing; their badges just don't show yet
  // until the backfill reaches them.
  const codes = directory.map((d) => d.code);
  const [priceMap, institutionalMap] = await Promise.all([
    getStoredPriceHistoryBulk(codes),
    getStoredInstitutionalHistoryBulk(codes),
  ]);

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - chartMonths);
  const cutoffStr = toIsoDate(cutoff);

  return directory.map((entry) => {
    const priceSeries = (priceMap.get(entry.code) ?? []).filter((p) => p.date >= cutoffStr);
    const institutional = institutionalMap.get(entry.code) ?? [];

    const level = classifyInstitutionalLevel(institutional);
    const streaks = computeInstitutionalStreaks(institutional);
    const bollinger = priceSeries.length > 0 ? analyzeBollinger(priceSeries, bollingerBands(priceSeries)) : null;
    const maSnapshot = latestMaSnapshot(priceSeries, maLines);

    let price: number | null = null;
    let change: number | null = null;
    let changePct: number | null = null;
    if (priceSeries.length > 0) {
      price = priceSeries[priceSeries.length - 1].close;
      if (priceSeries.length > 1) {
        const prevClose = priceSeries[priceSeries.length - 2].close;
        change = price - prevClose;
        changePct = prevClose !== 0 ? (change / prevClose) * 100 : null;
      }
    }

    return {
      code: entry.code,
      name: entry.name,
      market: entry.market,
      latestInstitutional: institutional.length > 0 ? institutional[institutional.length - 1] : null,
      maSnapshot,
      level,
      streaks,
      bollinger,
      price,
      change,
      changePct,
    } satisfies WatchlistCardData;
  });
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
