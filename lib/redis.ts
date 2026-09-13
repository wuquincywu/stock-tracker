import { Redis } from "@upstash/redis";
import { taipeiDateString } from "./date";
import type { StockDirectoryEntry } from "./finmind";
import type {
  AlertConfig,
  InstitutionalCategory,
  InstitutionalLevel,
  InstitutionalRow,
  MaAlertKey,
  MaLine,
  NotificationPart,
  PriceRow,
  PushSubscriptionRecord,
  WatchlistCardData,
  WatchlistEntry,
} from "./types";
import { ALL_MA_ALERT_KEYS, INSTITUTIONAL_CATEGORY_ORDER, INSTITUTIONAL_LEVEL_ORDER } from "./types";

const redis = Redis.fromEnv();

const KEYS = {
  maLines: "config:maLines",
  stockDirectory: "cache:stockDirectory",
  marketCards: "cache:marketCards",
  users: "users:list",
} as const;

const STOCK_DIRECTORY_TTL_SECONDS = 24 * 60 * 60; // stock list changes rarely — refresh once a day
// Matches marketdata.ts's in-process MARKET_CARDS_CACHE_TTL_MS — this is the cross-instance backing
// store for that same cache, so both should expire together.
const MARKET_CARDS_CACHE_TTL_SECONDS = 15 * 60;

const DEFAULT_MA_LINES: MaLine[] = [5, 20, 60];
const DEFAULT_ALERT_CONFIG: AlertConfig = {
  levels: ["big_buy", "big_sell"],
  streakThresholds: { foreign: 0, trust: 0, dealer: 0, combined: 0 },
  maAlerts: ALL_MA_ALERT_KEYS,
};
export const DEFAULT_CHART_MONTHS = 3;
const MIN_CHART_MONTHS = 1;
const MAX_CHART_MONTHS = 24;

// ---- Multi-user identity ----
// A small, fixed-trust group (personal tool for a handful of family/friends, not a public
// service) — no passwords, just a chosen display name registered here and remembered via a
// cookie (see lib/users.ts). Everything below this point that used to be one global record per
// kind (watchlist, push subscriptions, dedup, alert config, chart-months, notifications) is now
// namespaced per registered user; only truly market-wide data (stock directory, price/
// institutional history, the market-cards cache) stays global.

const MAX_USERS = 20; // sanity cap, not an auth mechanism — this is a small-group tool
const MAX_USER_NAME_LENGTH = 20;

export async function getRegisteredUsers(): Promise<string[]> {
  const raw = await redis.get<string[]>(KEYS.users);
  return Array.isArray(raw) ? raw : [];
}

/** Registers `name` if it's new; re-adding an already-registered name is a harmless no-op. */
export async function registerUser(name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, error: "請輸入名字" };
  if (trimmed.length > MAX_USER_NAME_LENGTH) return { ok: false, error: "名字太長了" };

  const users = await getRegisteredUsers();
  if (users.includes(trimmed)) return { ok: true };
  if (users.length >= MAX_USERS) return { ok: false, error: "使用者數量已達上限" };

  await redis.set(KEYS.users, [...users, trimmed]);
  return { ok: true };
}

function watchlistKey(userId: string): string {
  return `watchlist:${userId}`;
}

export async function getWatchlist(userId: string): Promise<WatchlistEntry[]> {
  const raw = await redis.hgetall<Record<string, WatchlistEntry>>(watchlistKey(userId));
  if (!raw) return [];
  return Object.values(raw).sort((a, b) => a.code.localeCompare(b.code));
}

export async function addToWatchlist(userId: string, entry: WatchlistEntry): Promise<void> {
  await redis.hset(watchlistKey(userId), { [entry.code]: entry });
}

export async function removeFromWatchlist(userId: string, code: string): Promise<void> {
  await redis.hdel(watchlistKey(userId), code);
}

function subscriptionsKey(userId: string): string {
  return `push:subscriptions:${userId}`;
}

export async function getSubscriptions(userId: string): Promise<PushSubscriptionRecord[]> {
  const raw = await redis.hgetall<Record<string, PushSubscriptionRecord>>(subscriptionsKey(userId));
  return raw ? Object.values(raw) : [];
}

/**
 * Registers `sub` for `userId`, first stripping it from every OTHER registered user's own
 * subscription hash. A push subscription is a browser/Service-Worker-level object — the same
 * physical device keeps the same subscription endpoint even after the app's own identity switches
 * (via UserSwitcher). Without this, a device that subscribed under user A and later switched to
 * user B would silently go on receiving A's pushes forever (the endpoint would still be sitting in
 * A's hash, and PushSetup.tsx has no way to know that from the browser side alone) — this makes
 * "one endpoint belongs to exactly one identity, whichever last claimed it" an invariant enforced
 * here rather than something callers have to get right.
 */
export async function addSubscription(userId: string, sub: PushSubscriptionRecord): Promise<void> {
  const users = await getRegisteredUsers();
  await Promise.all(
    users.filter((u) => u !== userId).map((otherUserId) => redis.hdel(subscriptionsKey(otherUserId), sub.endpoint)),
  );
  await redis.hset(subscriptionsKey(userId), { [sub.endpoint]: sub });
}

export async function removeSubscription(userId: string, endpoint: string): Promise<void> {
  await redis.hdel(subscriptionsKey(userId), endpoint);
}


export async function getMaLines(): Promise<MaLine[]> {
  const raw = await redis.get<string>(KEYS.maLines);
  if (!raw) return DEFAULT_MA_LINES;
  const parsed = raw
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n): n is MaLine => n === 5 || n === 20 || n === 60);
  return parsed.length > 0 ? parsed : DEFAULT_MA_LINES;
}

/** Reads the per-category thresholds, migrating the old single-`streakThreshold` shape (合計 only) if found. */
function parseStreakThresholds(raw: Record<string, unknown>): Record<InstitutionalCategory, number> {
  const result: Record<InstitutionalCategory, number> = { foreign: 0, trust: 0, dealer: 0, combined: 0 };
  const source = raw.streakThresholds;
  if (source && typeof source === "object") {
    for (const category of INSTITUTIONAL_CATEGORY_ORDER) {
      const value = (source as Record<string, unknown>)[category];
      if (typeof value === "number" && Number.isFinite(value)) result[category] = Math.max(0, Math.floor(value));
    }
  } else if (typeof raw.streakThreshold === "number" && Number.isFinite(raw.streakThreshold)) {
    result.combined = Math.max(0, Math.floor(raw.streakThreshold));
  }
  return result;
}

/**
 * Which MA-cross combos trigger a notification. Older stored configs predate this field entirely
 * (MA crosses used to always notify, unconditionally) — treat a missing/invalid value as "all
 * enabled" so existing users' notifications don't silently stop until they touch this setting.
 */
function parseMaAlerts(raw: Record<string, unknown>): MaAlertKey[] {
  if (!Array.isArray(raw.maAlerts)) return ALL_MA_ALERT_KEYS;
  const valid = (raw.maAlerts as unknown[]).filter((k): k is MaAlertKey => ALL_MA_ALERT_KEYS.includes(k as MaAlertKey));
  return valid;
}

function alertConfigKey(userId: string): string {
  return `config:alerts:${userId}`;
}

export async function getAlertConfig(userId: string): Promise<AlertConfig> {
  const raw = await redis.get<Record<string, unknown>>(alertConfigKey(userId));
  if (!raw) return DEFAULT_ALERT_CONFIG;
  const levels = Array.isArray(raw.levels)
    ? (raw.levels as InstitutionalLevel[]).filter((l) => INSTITUTIONAL_LEVEL_ORDER.includes(l))
    : [];
  return { levels, streakThresholds: parseStreakThresholds(raw), maAlerts: parseMaAlerts(raw) };
}

export async function setAlertConfig(userId: string, config: AlertConfig): Promise<void> {
  const levels = config.levels.filter((l) => INSTITUTIONAL_LEVEL_ORDER.includes(l));
  const streakThresholds: Record<InstitutionalCategory, number> = { foreign: 0, trust: 0, dealer: 0, combined: 0 };
  for (const category of INSTITUTIONAL_CATEGORY_ORDER) {
    const value = config.streakThresholds?.[category];
    streakThresholds[category] = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  }
  const maAlerts = (config.maAlerts ?? []).filter((k) => ALL_MA_ALERT_KEYS.includes(k));
  await redis.set(alertConfigKey(userId), { levels, streakThresholds, maAlerts });
}

export function clampChartMonths(months: number): number {
  return Math.min(MAX_CHART_MONTHS, Math.max(MIN_CHART_MONTHS, Math.floor(months) || DEFAULT_CHART_MONTHS));
}

function chartMonthsKey(userId: string): string {
  return `config:chartMonths:${userId}`;
}

/** How many months of price/chart history to fetch — user-configurable, defaults to 3. */
export async function getChartMonths(userId: string): Promise<number> {
  const raw = await redis.get<number>(chartMonthsKey(userId));
  return Number.isFinite(raw) ? clampChartMonths(raw as number) : DEFAULT_CHART_MONTHS;
}

export async function setChartMonths(userId: string, months: number): Promise<void> {
  await redis.set(chartMonthsKey(userId), clampChartMonths(months));
}

export async function getCachedStockDirectory(): Promise<StockDirectoryEntry[] | null> {
  const raw = await redis.get<StockDirectoryEntry[]>(KEYS.stockDirectory);
  return Array.isArray(raw) && raw.length > 0 ? raw : null;
}

export async function setCachedStockDirectory(entries: StockDirectoryEntry[]): Promise<void> {
  await redis.set(KEYS.stockDirectory, entries, { ex: STOCK_DIRECTORY_TTL_SECONDS });
}

/** Cross-instance backing store for marketdata.ts's in-process "所有股票" cards cache. */
export async function getCachedMarketCards(): Promise<WatchlistCardData[] | null> {
  const raw = await redis.get<WatchlistCardData[]>(KEYS.marketCards);
  return Array.isArray(raw) && raw.length > 0 ? raw : null;
}

export async function setCachedMarketCards(cards: WatchlistCardData[]): Promise<void> {
  await redis.set(KEYS.marketCards, cards, { ex: MARKET_CARDS_CACHE_TTL_SECONDS });
}

// ---- Per-stock history accumulation ----
// Every live price/institutional fetch gets merged into these on top of whatever's already
// stored, so a stock's available history keeps growing the more it's viewed/tracked — well
// beyond what any single upstream call returns — and stays readable even when the live source
// is temporarily unreachable (serves the last-known merged history instead of failing).

const HISTORY_CAP_DAYS = 400; // ~1 year of trading days plus slack

// Purely a resumability optimization for the market-wide price backfill (backfillTwseMarketPrices)
// — lets a deadline-cut-short backfill call skip stocks it (or the daily cron) already fetched in
// the last few hours on re-invocation, instead of re-fetching the whole TWSE universe every call.
// NOT a display-facing staleness cache: nothing on the read path (getPriceSeries,
// refreshPriceSeries) checks this — that kind of check previously caused stale/wrong data to be
// served silently with no way for the caller to tell, so it was removed from the read path. Price
// is the only kind left since nothing else consumes an institutional-history marker anymore.
const FRESHNESS_TTL_SECONDS = 4 * 60 * 60;

function historyPriceKey(code: string): string {
  return `history:price:${code}`;
}

function historyInstitutionalKey(code: string): string {
  return `history:institutional:${code}`;
}

type HistoryKind = "price";

function freshnessKey(code: string, kind: HistoryKind): string {
  return `history:fresh:${kind}:${code}`;
}

/** Whether `code`'s stored price history was fetched recently enough for backfillTwseMarketPrices to skip it. */
export async function isHistoryFresh(code: string, kind: HistoryKind): Promise<boolean> {
  const marker = await redis.get(freshnessKey(code, kind));
  return marker !== null;
}

export async function markHistoryFresh(code: string, kind: HistoryKind): Promise<void> {
  await redis.set(freshnessKey(code, kind), 1, { ex: FRESHNESS_TTL_SECONDS });
}

export async function getStoredPriceHistory(code: string): Promise<PriceRow[]> {
  const raw = await redis.get<PriceRow[]>(historyPriceKey(code));
  return Array.isArray(raw) ? raw : [];
}

/** Merges `fresh` rows into the stored history (same-date rows are overwritten by `fresh`), caps
 * it at `HISTORY_CAP_DAYS`, persists it, and returns the merged result. */
export async function mergeStoredPriceHistory(code: string, fresh: PriceRow[]): Promise<PriceRow[]> {
  if (fresh.length === 0) return getStoredPriceHistory(code);

  const existing = await getStoredPriceHistory(code);
  const byDate = new Map(existing.map((r) => [r.date, r]));
  for (const row of fresh) byDate.set(row.date, row);
  const merged = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-HISTORY_CAP_DAYS);

  await redis.set(historyPriceKey(code), merged);
  return merged;
}

export async function getStoredInstitutionalHistory(code: string): Promise<InstitutionalRow[]> {
  const raw = await redis.get<InstitutionalRow[]>(historyInstitutionalKey(code));
  return Array.isArray(raw) ? raw : [];
}

export async function mergeStoredInstitutionalHistory(
  code: string,
  fresh: InstitutionalRow[],
): Promise<InstitutionalRow[]> {
  if (fresh.length === 0) return getStoredInstitutionalHistory(code);

  const existing = await getStoredInstitutionalHistory(code);
  const byDate = new Map(existing.map((r) => [r.date, r]));
  for (const row of fresh) byDate.set(row.date, row);
  const merged = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-HISTORY_CAP_DAYS);

  await redis.set(historyInstitutionalKey(code), merged);
  return merged;
}

const MGET_CHUNK_SIZE = 200; // keep individual Upstash REST calls reasonably sized

async function mgetChunked<T>(keys: string[]): Promise<(T | null)[]> {
  if (keys.length === 0) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < keys.length; i += MGET_CHUNK_SIZE) chunks.push(keys.slice(i, i + MGET_CHUNK_SIZE));
  const chunkResults = await Promise.all(chunks.map((chunk) => redis.mget<(T | null)[]>(...chunk)));
  return chunkResults.flat();
}

/**
 * Bulk-reads stored (never live-fetched) price history for many stocks at once, via chunked
 * MGET — for pages like "所有股票" that need to show hundreds/thousands of stocks' indicators
 * without doing a separate round-trip per stock.
 */
export async function getStoredPriceHistoryBulk(codes: string[]): Promise<Map<string, PriceRow[]>> {
  const values = await mgetChunked<PriceRow[]>(codes.map(historyPriceKey));
  const map = new Map<string, PriceRow[]>();
  codes.forEach((code, i) => map.set(code, Array.isArray(values[i]) ? values[i]! : []));
  return map;
}

/** Same as `getStoredPriceHistoryBulk` but for institutional history. */
export async function getStoredInstitutionalHistoryBulk(codes: string[]): Promise<Map<string, InstitutionalRow[]>> {
  const values = await mgetChunked<InstitutionalRow[]>(codes.map(historyInstitutionalKey));
  const map = new Map<string, InstitutionalRow[]>();
  codes.forEach((code, i) => map.set(code, Array.isArray(values[i]) ? values[i]! : []));
  return map;
}

// ---- Daily notification record (for the in-app 通知 page) ----
// The push notification itself is a lightweight "you have alerts today" nudge (see
// check-alerts/route.ts) — the actual per-stock detail is written here instead, so the 通知 page
// can show it even if the push never arrived (permission not granted, browser closed, etc).

export interface DailyNotificationItem {
  code: string;
  name: string;
  /** Kept as separate parts (rather than pre-joined) so the 通知 page can color each one by
   * buy/sell (紅/綠) individually instead of rendering one flat-colored string. */
  parts: NotificationPart[];
}

const NOTIFICATIONS_TTL_SECONDS = 30 * 24 * 60 * 60; // one-off daily record, not routine cache — keep a month of history

function notificationsKey(userId: string, date: string): string {
  return `notifications:${userId}:${date}`;
}

export async function setDailyNotifications(userId: string, date: string, items: DailyNotificationItem[]): Promise<void> {
  await redis.set(notificationsKey(userId, date), items, { ex: NOTIFICATIONS_TTL_SECONDS });
}

export async function getDailyNotifications(userId: string, date: string): Promise<DailyNotificationItem[]> {
  const raw = await redis.get<DailyNotificationItem[]>(notificationsKey(userId, date));
  return Array.isArray(raw) ? raw : [];
}

export interface DailyNotificationGroup {
  date: string;
  items: DailyNotificationItem[];
}

/**
 * Notification history for the past `days` calendar days (Taipei calendar, most-recent-first),
 * skipping any day with nothing recorded (weekend/holiday, or a day nothing triggered). The dates
 * are computed directly rather than discovered via Redis KEYS/SCAN — NOTIFICATIONS_TTL_SECONDS
 * already bounds how far back a record can exist, so "today back to N days ago" is a fixed,
 * cheap-to-compute key list — then read in one chunked MGET (mgetChunked, used the same way by
 * getStoredPriceHistoryBulk above) instead of one round-trip per day.
 */
export async function getNotificationHistory(userId: string, days = 30): Promise<DailyNotificationGroup[]> {
  const now = new Date();
  const dates = Array.from({ length: days }, (_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    return taipeiDateString(d);
  });

  const values = await mgetChunked<DailyNotificationItem[]>(dates.map((date) => notificationsKey(userId, date)));

  const groups: DailyNotificationGroup[] = [];
  dates.forEach((date, i) => {
    const items = values[i];
    if (Array.isArray(items) && items.length > 0) groups.push({ date, items });
  });
  return groups;
}

function notificationsReadKey(userId: string): string {
  return `notifications:lastRead:${userId}`;
}

/** The most recent date (YYYY-MM-DD, Taipei calendar) this user has opened the 通知 page. */
export async function getLastReadNotificationDate(userId: string): Promise<string | null> {
  const raw = await redis.get<string>(notificationsReadKey(userId));
  return typeof raw === "string" ? raw : null;
}

export async function markNotificationsRead(userId: string, date: string): Promise<void> {
  await redis.set(notificationsReadKey(userId), date);
}

/** Whether today's notifications (if any) haven't been opened yet — drives the red-dot badge on
 * the 通知 tab and the PWA app-icon badge. Called on every home/market page render, so this uses a
 * pipeline (one HTTP round-trip for both GETs) rather than Promise.all-ing two separate REST calls
 * — Upstash's REST API means every command is its own HTTPS request, and this pair runs on the hot
 * path for page navigation latency. */
export async function hasUnreadNotifications(userId: string): Promise<boolean> {
  const today = taipeiDateString();
  const [items, lastRead] = await redis
    .pipeline()
    .get<DailyNotificationItem[]>(notificationsKey(userId, today))
    .get<string>(notificationsReadKey(userId))
    .exec();
  return Array.isArray(items) && items.length > 0 && lastRead !== today;
}
