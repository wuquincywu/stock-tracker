export type Market = "TWSE" | "TPEX";

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

export interface NotificationPart {
  text: string;
  /** Drives an outline highlight on the 通知 page for a part that reports something freshly true
   * right now, as opposed to an unchanged, ongoing state. True for: an MA alert whose direction
   * actually flipped today (not just "still the same side as yesterday"); every 連續買賣 streak
   * part, since the streak length itself is a new fact each day it continues. False for 法人分級,
   * whose category (大買/小賣/...) can repeat identically across days without anything new. */
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
}
