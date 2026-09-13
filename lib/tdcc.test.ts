import { describe, expect, it } from "vitest";
import { parseShareholderConcentrationLine } from "./tdcc";

describe("parseShareholderConcentrationLine", () => {
  it("parses a real tier-15 (大戶) row, converting the date and trimming the padded code", () => {
    // Real row, 2330 (TSMC), 2026-09-11 snapshot.
    const line = "20260911,2330  ,15,1485,21996993078,84.82";
    expect(parseShareholderConcentrationLine(line)).toEqual({
      code: "2330",
      row: { date: "2026-09-11", bigHolderCount: 1485, bigHolderShares: 21996993078, bigHolderPct: 84.82 },
    });
  });

  it("ignores every tier except 15 (smaller bands, the adjustment row, and the total row)", () => {
    expect(parseShareholderConcentrationLine("20260911,2330  ,14,215,192002553,0.74")).toBeNull();
    expect(parseShareholderConcentrationLine("20260911,2330  ,16,0,0,0.00")).toBeNull();
    expect(parseShareholderConcentrationLine("20260911,2330  ,17,3019610,25932370067,100.00")).toBeNull();
  });

  it("returns null for a malformed line instead of throwing", () => {
    expect(parseShareholderConcentrationLine("")).toBeNull();
    expect(parseShareholderConcentrationLine("not,enough,fields")).toBeNull();
  });
});
