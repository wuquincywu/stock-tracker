export type Market = "TWSE" | "TPEX";

export const ALL_MARKETS: Market[] = ["TWSE", "TPEX"];

export interface WatchlistEntry {
  code: string;
  name: string;
  market: Market;
}

export interface PriceRow {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface InstitutionalRow {
  date: string; // YYYY-MM-DD
  foreignNet: number; // 外資 net shares (buy - sell)
  investmentTrustNet: number; // 投信 net shares
  dealerNet: number; // 自營商 net shares
}

export type MaLine = 5 | 20 | 60;
export type CrossDirection = "up" | "down";

/** One (MA line, direction) combination, e.g. "20:up" = 站上 MA20. */
export type MaAlertKey = `${MaLine}:${CrossDirection}`;

export const MA_LINE_ORDER: MaLine[] = [5, 20, 60];

export const ALL_MA_ALERT_KEYS: MaAlertKey[] = MA_LINE_ORDER.flatMap((ma) =>
  (["up", "down"] as CrossDirection[]).map((direction) => `${ma}:${direction}` as MaAlertKey),
);

export interface BollingerPoint {
  date: string;
  middle: number | null; // SMA20
  upper: number | null;
  lower: number | null;
}

export interface PushSubscriptionRecord {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export type InstitutionalLevel = "big_sell" | "small_sell" | "flat" | "small_buy" | "big_buy";

/** Canonical 大賣→大買 display/validation order — the single source of truth for every place
 * that needs "all valid levels" (used to be redefined per-file: lib/redis.ts, the market API
 * route, and both filter-panel client components each had their own copy). */
export const INSTITUTIONAL_LEVEL_ORDER: InstitutionalLevel[] = ["big_sell", "small_sell", "flat", "small_buy", "big_buy"];

export const INSTITUTIONAL_LEVEL_LABEL: Record<InstitutionalLevel, string> = {
  big_sell: "大賣",
  small_sell: "小賣",
  flat: "平盤",
  small_buy: "小買",
  big_buy: "大買",
};

export type StreakDirection = "buy" | "sell";

export interface InstitutionalStreak {
  direction: StreakDirection;
  length: number;
}

/** Which 三大法人 net-flow figure a streak/threshold applies to. */
export type InstitutionalCategory = "foreign" | "trust" | "dealer" | "combined";

export const INSTITUTIONAL_CATEGORY_LABEL: Record<InstitutionalCategory, string> = {
  foreign: "外資",
  trust: "投信",
  dealer: "自營商",
  combined: "合計",
};

export const INSTITUTIONAL_CATEGORY_ORDER: InstitutionalCategory[] = ["foreign", "trust", "dealer", "combined"];

/** Independently-computed streaks for each of the four 三大法人 net-flow figures. */
export type InstitutionalStreakSet = Record<InstitutionalCategory, InstitutionalStreak | null>;

export interface AlertConfig {
  /** 三大法人合計 level(s) that trigger a push notification. */
  levels: InstitutionalLevel[];
  /** Per-category consecutive same-direction days that trigger a push notification. 0 disables that category. */
  streakThresholds: Record<InstitutionalCategory, number>;
  /** Which MA-line/direction crosses (站上/跌破 MA5/20/60) trigger a push notification. */
  maAlerts: MaAlertKey[];
}

export type BollingerBandPosition = "above_upper" | "below_lower" | "inside";

export interface BollingerSignal {
  /** Price relative to the bands on the latest trading day. Null when bands can't be computed yet. */
  bandPosition: BollingerBandPosition | null;
  /** %b = (close - lower) / (upper - lower). >1 above the upper band, <0 below the lower band. */
  percentB: number | null;
  /** (upper - lower) / middle * 100 on the latest trading day. */
  bandwidthPct: number | null;
  /** Latest bandwidth is a new N-day low — classic "squeeze" (低波動、醞釀變盤) signal. */
  squeeze: boolean;
}

export interface MaSnapshot {
  ma: MaLine;
  value: number;
  above: boolean;
}

/**
 * One weekly snapshot of 千張大戶 (big-holder) concentration for a stock, from TDCC's free
 * 集保戶股權分散表 open data (持股分級 tier 15 = 1,000,001+ shares — see lib/tdcc.ts's doc comment
 * for the full tier table this was reverse-engineered against real data). TDCC only ever publishes
 * the LATEST week (no date-range query), so this app's own history for it can only accumulate
 * forward from whenever it's first captured, one week at a time.
 */
export interface ShareholderConcentrationRow {
  date: string; // Friday's date (YYYY-MM-DD) that this snapshot reflects
  bigHolderCount: number; // 人數 holding 1,000,001+ shares
  bigHolderShares: number; // 股數 held by that tier
  bigHolderPct: number; // that tier's 占集保庫存數比例%
}

/** Derived from a stock's ShareholderConcentrationRow[]: current 大戶 concentration and how much it
 * moved week-over-week. Both null until at least one weekly snapshot has been captured;
 * `weekChangePct` stays null for one additional week after that (needs two points to diff). */
export interface ShareholderConcentrationSignal {
  latestPct: number | null;
  weekChangePct: number | null;
}

export interface NotificationPart {
  text: string;
  /** Drives an outline highlight on the 通知 page — true only for an MA alert whose direction
   * actually flipped today (a genuine crossing moment, not just "still the same side as
   * yesterday"). Always false for 法人分級/連續買賣 parts. */
  highlight: boolean;
}

/** The rich per-stock card shown on both the watchlist ("已追蹤股票") and market browse ("所有股票") pages. */
export interface WatchlistCardData extends WatchlistEntry {
  latestInstitutional: InstitutionalRow | null;
  maSnapshot: MaSnapshot[];
  level: InstitutionalLevel | null;
  streaks: InstitutionalStreakSet;
  bollinger: BollingerSignal | null;
  price: number | null;
  change: number | null;
  changePct: number | null;
  shareholderConcentration: ShareholderConcentrationSignal | null;
}
