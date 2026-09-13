import { describe, expect, it } from "vitest";
import { buildCard } from "./cardBuilder";
import type { InstitutionalRow, PriceRow } from "./types";

const entry = { code: "2330", name: "台積電", market: "TWSE" as const };

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

describe("buildCard", () => {
  it("returns all-null price fields when there's no price history yet", () => {
    const card = buildCard(entry, [], [], [5, 20, 60]);
    expect(card).toMatchObject({
      code: "2330",
      name: "台積電",
      market: "TWSE",
      price: null,
      change: null,
      changePct: null,
      bollinger: null,
      maSnapshot: [],
      latestInstitutional: null,
    });
  });

  it("computes latest price, change, and changePct from the last two rows", () => {
    const card = buildCard(entry, makePrices([100, 110]), [], [5, 20, 60]);
    expect(card.price).toBe(110);
    expect(card.change).toBe(10);
    expect(card.changePct).toBeCloseTo(10);
  });

  it("carries through the latest institutional row and derives level/streaks from the full series", () => {
    const institutional: InstitutionalRow[] = Array.from({ length: 20 }, (_, i) => ({
      date: `d${i}`,
      foreignNet: i === 19 ? 100_000 : 0,
      investmentTrustNet: 0,
      dealerNet: 0,
    }));
    const card = buildCard(entry, [], institutional, [5, 20, 60]);
    expect(card.latestInstitutional).toEqual(institutional[19]);
    expect(card.level).toBe("big_buy");
    expect(card.streaks.foreign).toEqual({ direction: "buy", length: 1 });
  });

  it("only includes MA snapshots for lines with enough warm-up history", () => {
    const card = buildCard(entry, makePrices(Array.from({ length: 5 }, () => 100)), [], [5, 20, 60]);
    expect(card.maSnapshot.map((s) => s.ma)).toEqual([5]); // not enough rows yet for MA20/MA60
  });
});
