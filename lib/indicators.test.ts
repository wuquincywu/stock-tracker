import { describe, expect, it } from "vitest";
import {
  analyzeBollinger,
  bollingerBands,
  classifyInstitutionalLevel,
  computeInstitutionalStreak,
  computeShareholderConcentrationSignal,
} from "./indicators";
import type { InstitutionalRow, PriceRow, ShareholderConcentrationRow } from "./types";

function makePrices(closes: number[]): PriceRow[] {
  return closes.map((close, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, "0")}`,
    open: close,
    high: close,
    low: close,
    close,
    volume: 1000,
  }));
}

function makeInstitutionalRow(date: string, net: number): InstitutionalRow {
  return { date, foreignNet: net, investmentTrustNet: 0, dealerNet: 0 };
}

describe("bollingerBands / analyzeBollinger", () => {
  it("returns null bands before the 20-day warm-up period", () => {
    const bands = bollingerBands(makePrices(Array.from({ length: 19 }, () => 100)));
    expect(bands[18].middle).toBeNull();
  });

  it("computes bands exactly at the 20-day boundary", () => {
    const bands = bollingerBands(makePrices(Array.from({ length: 20 }, () => 100)));
    // Constant price series -> stddev 0 -> upper/lower collapse onto the middle band.
    expect(bands[19].middle).toBe(100);
    expect(bands[19].upper).toBe(100);
    expect(bands[19].lower).toBe(100);
  });

  it("flags bandPosition above_upper when the close breaks above the upper band", () => {
    const closes = [...Array.from({ length: 19 }, () => 100), 200];
    const prices = makePrices(closes);
    const signal = analyzeBollinger(prices, bollingerBands(prices));
    expect(signal.bandPosition).toBe("above_upper");
    expect(signal.percentB).not.toBeNull();
    expect(signal.percentB!).toBeGreaterThan(1);
  });

  it("returns the empty signal when there isn't enough history yet", () => {
    const prices = makePrices([100, 101]);
    const signal = analyzeBollinger(prices, bollingerBands(prices));
    expect(signal).toEqual({ bandPosition: null, percentB: null, bandwidthPct: null, squeeze: false });
  });
});

describe("classifyInstitutionalLevel", () => {
  it("returns null with fewer than 20 days of history", () => {
    const series = Array.from({ length: 19 }, (_, i) => makeInstitutionalRow(`d${i}`, 100));
    expect(classifyInstitutionalLevel(series)).toBeNull();
  });

  it("classifies flat when net flow never varies (zero stddev)", () => {
    const series = Array.from({ length: 20 }, (_, i) => makeInstitutionalRow(`d${i}`, 500));
    expect(classifyInstitutionalLevel(series)).toBe("flat");
  });

  it("classifies today as big_buy when it's a clear outlier above the trailing distribution", () => {
    const series = [
      ...Array.from({ length: 19 }, (_, i) => makeInstitutionalRow(`d${i}`, i % 2 === 0 ? 100 : -100)),
      makeInstitutionalRow("today", 100_000),
    ];
    expect(classifyInstitutionalLevel(series)).toBe("big_buy");
  });

  it("classifies today as big_sell when it's a clear outlier below the trailing distribution", () => {
    const series = [
      ...Array.from({ length: 19 }, (_, i) => makeInstitutionalRow(`d${i}`, i % 2 === 0 ? 100 : -100)),
      makeInstitutionalRow("today", -100_000),
    ];
    expect(classifyInstitutionalLevel(series)).toBe("big_sell");
  });
});

describe("computeInstitutionalStreak", () => {
  it("returns null when there's no history", () => {
    expect(computeInstitutionalStreak([])).toBeNull();
  });

  it("returns null when today is exactly flat", () => {
    const series = [makeInstitutionalRow("d1", 100), makeInstitutionalRow("d2", 0)];
    expect(computeInstitutionalStreak(series)).toBeNull();
  });

  it("counts a single-day streak as length 1", () => {
    const series = [makeInstitutionalRow("d1", -50), makeInstitutionalRow("d2", 100)];
    expect(computeInstitutionalStreak(series)).toEqual({ direction: "buy", length: 1 });
  });

  it("stops the streak at the first opposite-direction (or flat) day walking backward", () => {
    const series = [
      makeInstitutionalRow("d1", 100),
      makeInstitutionalRow("d2", -100),
      makeInstitutionalRow("d3", 100),
      makeInstitutionalRow("d4", 100),
      makeInstitutionalRow("d5", 100),
    ];
    expect(computeInstitutionalStreak(series)).toEqual({ direction: "buy", length: 3 });
  });

  it("breaks a streak on an exact-zero day in the middle, not just at the end", () => {
    const series = [
      makeInstitutionalRow("d1", 100),
      makeInstitutionalRow("d2", 0),
      makeInstitutionalRow("d3", 100),
      makeInstitutionalRow("d4", 100),
    ];
    expect(computeInstitutionalStreak(series)).toEqual({ direction: "buy", length: 2 });
  });
});

function makeConcentrationRow(date: string, bigHolderPct: number, bigHolderCount = 100): ShareholderConcentrationRow {
  return { date, bigHolderCount, bigHolderShares: 1_000_000, bigHolderPct };
}

describe("computeShareholderConcentrationSignal", () => {
  it("returns all-null with no history yet", () => {
    expect(computeShareholderConcentrationSignal([])).toEqual({ latestPct: null, weekChangePct: null });
  });

  it("returns the latest % with a null week-over-week change after only one snapshot", () => {
    const series = [makeConcentrationRow("2026-09-04", 60)];
    expect(computeShareholderConcentrationSignal(series)).toEqual({ latestPct: 60, weekChangePct: null });
  });

  it("computes the percentage-point change from the previous week once there are two snapshots", () => {
    const series = [makeConcentrationRow("2026-09-04", 60), makeConcentrationRow("2026-09-11", 62.5)];
    expect(computeShareholderConcentrationSignal(series)).toEqual({ latestPct: 62.5, weekChangePct: 2.5 });
  });

  it("reports a negative change when concentration drops", () => {
    const series = [makeConcentrationRow("2026-09-04", 60), makeConcentrationRow("2026-09-11", 58)];
    expect(computeShareholderConcentrationSignal(series).weekChangePct).toBeCloseTo(-2);
  });

  it("returns all-null for a stock that has never had anyone in the big-holder tier (e.g. a small-cap where the whole share count sits below the threshold)", () => {
    const series = [makeConcentrationRow("2026-09-04", 0, 0), makeConcentrationRow("2026-09-11", 0, 0)];
    expect(computeShareholderConcentrationSignal(series)).toEqual({ latestPct: null, weekChangePct: null });
  });

  it("still reports a real 0% when a stock DID have a big holder before and doesn't anymore", () => {
    const series = [makeConcentrationRow("2026-09-04", 55, 3), makeConcentrationRow("2026-09-11", 0, 0)];
    expect(computeShareholderConcentrationSignal(series)).toEqual({ latestPct: 0, weekChangePct: -55 });
  });
});
