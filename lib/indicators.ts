import type {
  BollingerPoint,
  BollingerSignal,
  CrossEvent,
  InstitutionalCategory,
  InstitutionalLevel,
  InstitutionalRow,
  InstitutionalStreak,
  InstitutionalStreakSet,
  MaLine,
  MaSnapshot,
  PriceRow,
  StreakDirection,
} from "./types";

export function sma(values: number[], period: number, endIndex: number): number | null {
  if (endIndex - period + 1 < 0) return null;
  let sum = 0;
  for (let i = endIndex - period + 1; i <= endIndex; i++) sum += values[i];
  return sum / period;
}

function stddev(values: number[], period: number, endIndex: number, mean: number): number | null {
  if (endIndex - period + 1 < 0) return null;
  let sumSq = 0;
  for (let i = endIndex - period + 1; i <= endIndex; i++) {
    const diff = values[i] - mean;
    sumSq += diff * diff;
  }
  return Math.sqrt(sumSq / period);
}

/** Bollinger Bands (SMA20 +/- 2 stddev) for every point in a chronologically-ascending price series. */
export function bollingerBands(prices: PriceRow[]): BollingerPoint[] {
  const closes = prices.map((p) => p.close);
  return prices.map((p, i) => {
    const middle = sma(closes, 20, i);
    if (middle === null) return { date: p.date, middle: null, upper: null, lower: null };
    const sd = stddev(closes, 20, i, middle);
    if (sd === null) return { date: p.date, middle, upper: null, lower: null };
    return { date: p.date, middle, upper: middle + 2 * sd, lower: middle - 2 * sd };
  });
}

const SQUEEZE_LOOKBACK = 60;

/**
 * Standard布林通道 trading-signal reads on the latest trading day:
 * - percentB (%b) = (close - lower) / (upper - lower): where price sits within the channel.
 *   %b > 1 = broke above the upper band, %b < 0 = broke below the lower band, %b > 0.5 = above
 *   the middle band (相對強勢), %b < 0.5 = below it (相對弱勢).
 * - bandPosition: derived from %b for badge display — above the upper band ("走上軌",
 *   strong/overbought) or below the lower band ("走下軌", weak/oversold) vs. simply inside.
 * - bandwidthPct = (upper - lower) / middle * 100: how wide the channel currently is.
 * - squeeze: today's bandwidth is a new N-day low — the classic "narrowing channel precedes a
 *   breakout" signal (John Bollinger's "the Squeeze"), a low-volatility state, not itself a
 *   buy/sell direction.
 */
export function analyzeBollinger(prices: PriceRow[], bands: BollingerPoint[]): BollingerSignal {
  const empty: BollingerSignal = { bandPosition: null, percentB: null, bandwidthPct: null, squeeze: false };
  if (prices.length === 0 || bands.length === 0) return empty;

  const lastPrice = prices[prices.length - 1].close;
  const lastBand = bands[bands.length - 1];
  if (lastBand.upper === null || lastBand.lower === null || !lastBand.middle) return empty;

  const percentB = (lastPrice - lastBand.lower) / (lastBand.upper - lastBand.lower);
  const bandPosition: BollingerSignal["bandPosition"] =
    lastPrice > lastBand.upper ? "above_upper" : lastPrice < lastBand.lower ? "below_lower" : "inside";
  const bandwidthPct = ((lastBand.upper - lastBand.lower) / lastBand.middle) * 100;

  const widths = bands
    .filter((b) => b.upper !== null && b.lower !== null && b.middle)
    .map((b) => ((b.upper! - b.lower!) / b.middle!) * 100)
    .slice(-SQUEEZE_LOOKBACK);
  const priorWidths = widths.slice(0, -1);
  const squeeze = priorWidths.length >= 19 && bandwidthPct <= Math.min(...priorWidths);

  return { bandPosition, percentB, bandwidthPct, squeeze };
}

/** Latest close vs. each requested MA line, for a simple "above/below MA" chip display. */
export function latestMaSnapshot(prices: PriceRow[], maLines: MaLine[]): MaSnapshot[] {
  if (prices.length === 0) return [];
  const closes = prices.map((p) => p.close);
  const tIdx = prices.length - 1;
  const latestClose = closes[tIdx];

  const snapshots: MaSnapshot[] = [];
  for (const ma of maLines) {
    const value = sma(closes, ma, tIdx);
    if (value === null) continue;
    snapshots.push({ ma, value, above: latestClose >= value });
  }
  return snapshots;
}

/**
 * Detect MA cross events between the last two rows of a chronologically-ascending price series.
 * Returns at most one event per requested MA line.
 */
export function detectCrosses(code: string, prices: PriceRow[], maLines: MaLine[]): CrossEvent[] {
  if (prices.length < 2) return [];
  const closes = prices.map((p) => p.close);
  const tIdx = prices.length - 1;
  const prevIdx = tIdx - 1;
  const events: CrossEvent[] = [];

  for (const ma of maLines) {
    const maPrev = sma(closes, ma, prevIdx);
    const maT = sma(closes, ma, tIdx);
    if (maPrev === null || maT === null) continue;

    const closePrev = closes[prevIdx];
    const closeT = closes[tIdx];

    if (closePrev <= maPrev && closeT > maT) {
      events.push({ code, ma, direction: "up", date: prices[tIdx].date, close: closeT, maValue: maT });
    } else if (closePrev >= maPrev && closeT < maT) {
      events.push({ code, ma, direction: "down", date: prices[tIdx].date, close: closeT, maValue: maT });
    }
  }

  return events;
}

function combinedNet(row: InstitutionalRow): number {
  return row.foreignNet + row.investmentTrustNet + row.dealerNet;
}

/** z-score bounds separating 平盤 from 小買/小賣, and 小買/小賣 from 大買/大賣. */
const LEVEL_Z_SMALL = 0.2;
const LEVEL_Z_BIG = 1;
const MIN_HISTORY_FOR_LEVEL = 20;

/**
 * Classifies today's 三大法人合計買賣超 as 大賣/小賣/平盤/小買/大買, relative to this stock's
 * own trailing distribution (z-score) rather than an absolute share count — a large-cap stock's
 * "normal" daily flow dwarfs a small-cap's, so an absolute threshold would misclassify one of them.
 * Returns null when there isn't enough history yet to establish a meaningful baseline.
 */
export function classifyInstitutionalLevel(series: InstitutionalRow[]): InstitutionalLevel | null {
  if (series.length < MIN_HISTORY_FOR_LEVEL) return null;
  const nets = series.map(combinedNet);
  const today = nets[nets.length - 1];
  const mean = nets.reduce((a, b) => a + b, 0) / nets.length;
  const variance = nets.reduce((a, b) => a + (b - mean) ** 2, 0) / nets.length;
  const sd = Math.sqrt(variance);
  if (sd === 0) return "flat";

  const z = (today - mean) / sd;
  if (z > LEVEL_Z_BIG) return "big_buy";
  if (z > LEVEL_Z_SMALL) return "small_buy";
  if (z < -LEVEL_Z_BIG) return "big_sell";
  if (z < -LEVEL_Z_SMALL) return "small_sell";
  return "flat";
}

function netByCategory(row: InstitutionalRow, category: InstitutionalCategory): number {
  switch (category) {
    case "foreign":
      return row.foreignNet;
    case "trust":
      return row.investmentTrustNet;
    case "dealer":
      return row.dealerNet;
    case "combined":
      return combinedNet(row);
  }
}

/**
 * Consecutive most-recent days (ending today) where the given category's net flow stayed net-buy
 * or net-sell. Returns null once today itself is exactly flat (0), since there's no active streak
 * to report.
 */
export function computeInstitutionalStreak(
  series: InstitutionalRow[],
  category: InstitutionalCategory = "combined",
): InstitutionalStreak | null {
  if (series.length === 0) return null;
  const nets = series.map((row) => netByCategory(row, category));
  const latest = nets[nets.length - 1];
  if (latest === 0) return null;

  const direction: StreakDirection = latest > 0 ? "buy" : "sell";
  let length = 0;
  for (let i = nets.length - 1; i >= 0; i--) {
    const sameDirection = nets[i] !== 0 && (nets[i] > 0) === (latest > 0);
    if (!sameDirection) break;
    length++;
  }
  return { direction, length };
}

/** `computeInstitutionalStreak` run independently for all four categories at once. */
export function computeInstitutionalStreaks(series: InstitutionalRow[]): InstitutionalStreakSet {
  return {
    foreign: computeInstitutionalStreak(series, "foreign"),
    trust: computeInstitutionalStreak(series, "trust"),
    dealer: computeInstitutionalStreak(series, "dealer"),
    combined: computeInstitutionalStreak(series, "combined"),
  };
}
