import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTER_STATE,
  filterStateToSearchParams,
  matchesFilters,
  parseFilterParams,
  parsePageParam,
  sortCards,
} from "./cardFilters";
import type { CardFilterState } from "./cardFilters";
import type { WatchlistCardData } from "./types";

function makeCard(overrides: Partial<WatchlistCardData> = {}): WatchlistCardData {
  return {
    code: "2330",
    name: "台積電",
    market: "TWSE",
    latestInstitutional: null,
    maSnapshot: [],
    level: null,
    streaks: { foreign: null, trust: null, dealer: null, combined: null },
    bollinger: null,
    price: null,
    change: null,
    changePct: null,
    ...overrides,
  };
}

function state(overrides: Partial<CardFilterState> = {}): CardFilterState {
  return { ...DEFAULT_FILTER_STATE, ...overrides };
}

describe("matchesFilters", () => {
  it("passes everything through the default (no-op) filter", () => {
    expect(matchesFilters(makeCard(), DEFAULT_FILTER_STATE)).toBe(true);
  });

  it("filters by market", () => {
    const card = makeCard({ market: "TPEX" });
    expect(matchesFilters(card, state({ markets: new Set(["TWSE"]) }))).toBe(false);
    expect(matchesFilters(card, state({ markets: new Set(["TPEX"]) }))).toBe(true);
  });

  it("filters by institutional level, excluding cards with no level yet", () => {
    const noLevel = makeCard({ level: null });
    const bigBuy = makeCard({ level: "big_buy" });
    const s = state({ levels: new Set(["big_buy"]) });
    expect(matchesFilters(noLevel, s)).toBe(false);
    expect(matchesFilters(bigBuy, s)).toBe(true);
  });

  it("filters by streak direction and minimum length for the selected category", () => {
    const card = makeCard({
      streaks: { foreign: { direction: "buy", length: 3 }, trust: null, dealer: null, combined: null },
    });
    expect(matchesFilters(card, state({ streakCategory: "foreign", streakDirection: "sell" }))).toBe(false);
    expect(matchesFilters(card, state({ streakCategory: "foreign", streakDirection: "buy", minStreak: 5 }))).toBe(
      false,
    );
    expect(matchesFilters(card, state({ streakCategory: "foreign", streakDirection: "buy", minStreak: 3 }))).toBe(
      true,
    );
    // Wrong category has no streak recorded -> excluded even though "foreign" would match.
    expect(matchesFilters(card, state({ streakCategory: "trust", streakDirection: "buy" }))).toBe(false);
  });

  it("filters by MA line + direction", () => {
    const card = makeCard({ maSnapshot: [{ ma: 20, value: 100, above: true }] });
    expect(matchesFilters(card, state({ maLine: 20, maDirection: "below" }))).toBe(false);
    expect(matchesFilters(card, state({ maLine: 20, maDirection: "above" }))).toBe(true);
    expect(matchesFilters(card, state({ maLine: 60, maDirection: "above" }))).toBe(false); // no MA60 snapshot yet
  });

  it("filters by code prefix or Chinese name substring", () => {
    const card = makeCard({ code: "2330", name: "台積電" });
    expect(matchesFilters(card, state({ query: "2330" }))).toBe(true);
    expect(matchesFilters(card, state({ query: "積電" }))).toBe(true);
    expect(matchesFilters(card, state({ query: "2454" }))).toBe(false);
  });
});

describe("sortCards", () => {
  it("sorts by code ascending/descending", () => {
    const cards = [makeCard({ code: "2454" }), makeCard({ code: "2330" }), makeCard({ code: "1101" })];
    expect(sortCards(cards, "code", "asc").map((c) => c.code)).toEqual(["1101", "2330", "2454"]);
    expect(sortCards(cards, "code", "desc").map((c) => c.code)).toEqual(["2454", "2330", "1101"]);
  });

  it("sorts by changePct, pushing cards with no price data to the end regardless of direction", () => {
    const cards = [
      makeCard({ code: "A", changePct: 1.5 }),
      makeCard({ code: "B", changePct: null }),
      makeCard({ code: "C", changePct: -3 }),
    ];
    expect(sortCards(cards, "changePct", "desc").map((c) => c.code)).toEqual(["A", "C", "B"]);
    expect(sortCards(cards, "changePct", "asc").map((c) => c.code)).toEqual(["C", "A", "B"]);
  });

  it("sorts by combined institutional net buy-sell", () => {
    const cards = [
      makeCard({ code: "A", latestInstitutional: { date: "d", foreignNet: 100, investmentTrustNet: 0, dealerNet: 0 } }),
      makeCard({ code: "B", latestInstitutional: { date: "d", foreignNet: -50, investmentTrustNet: -10, dealerNet: 0 } }),
      makeCard({ code: "C", latestInstitutional: null }),
    ];
    expect(sortCards(cards, "institutionalNet", "desc").map((c) => c.code)).toEqual(["A", "B", "C"]);
  });

  it("sorts by streak length using a signed value so buy/sell streaks land on opposite ends", () => {
    const cards = [
      makeCard({ code: "BUY5", streaks: { foreign: null, trust: null, dealer: null, combined: { direction: "buy", length: 5 } } }),
      makeCard({ code: "SELL3", streaks: { foreign: null, trust: null, dealer: null, combined: { direction: "sell", length: 3 } } }),
      makeCard({ code: "NONE", streaks: { foreign: null, trust: null, dealer: null, combined: null } }),
    ];
    expect(sortCards(cards, "streakLength", "desc", "combined").map((c) => c.code)).toEqual(["BUY5", "SELL3", "NONE"]);
    expect(sortCards(cards, "streakLength", "asc", "combined").map((c) => c.code)).toEqual(["SELL3", "BUY5", "NONE"]);
  });

  it("sorts by Bollinger %b", () => {
    const cards = [
      makeCard({ code: "A", bollinger: { bandPosition: "inside", percentB: 0.5, bandwidthPct: 1, squeeze: false } }),
      makeCard({ code: "B", bollinger: { bandPosition: "above_upper", percentB: 1.2, bandwidthPct: 1, squeeze: false } }),
      makeCard({ code: "C", bollinger: null }),
    ];
    expect(sortCards(cards, "percentB", "desc").map((c) => c.code)).toEqual(["B", "A", "C"]);
  });
});

describe("parseFilterParams / filterStateToSearchParams round-trip", () => {
  it("round-trips a non-default state through the URL", () => {
    const original = state({
      query: "台積",
      markets: new Set(["TWSE"]),
      levels: new Set(["big_buy", "big_sell"]),
      streakCategory: "foreign",
      streakDirection: "buy",
      minStreak: 5,
      maLine: 20,
      maDirection: "below",
      sort: "changePct",
      dir: "desc",
    });
    const params = filterStateToSearchParams(original, 3);
    expect(params.get("page")).toBe("3");
    const parsed = parseFilterParams(params);
    const page = parsePageParam(params);

    expect(page).toBe(3);
    expect(parsed.query).toBe(original.query);
    expect(parsed.markets).toEqual(original.markets);
    expect(parsed.levels).toEqual(original.levels);
    expect(parsed.streakCategory).toBe(original.streakCategory);
    expect(parsed.streakDirection).toBe(original.streakDirection);
    expect(parsed.minStreak).toBe(original.minStreak);
    expect(parsed.maLine).toBe(original.maLine);
    expect(parsed.maDirection).toBe(original.maDirection);
    expect(parsed.sort).toBe(original.sort);
    expect(parsed.dir).toBe(original.dir);
  });

  it("produces an empty query string for the default state and page 1", () => {
    const params = filterStateToSearchParams(DEFAULT_FILTER_STATE, 1);
    expect(params.toString()).toBe("");
  });

  it("ignores invalid/unknown values instead of throwing", () => {
    const params = new URLSearchParams(
      "markets=BOGUS&levels=not_a_level&streakCategory=nope&streakDirection=sideways&maLine=999&sort=unknown&dir=inside-out&page=-5",
    );
    const parsed = parseFilterParams(params);
    expect(parsed.markets.size).toBe(0);
    expect(parsed.levels.size).toBe(0);
    expect(parsed.streakCategory).toBe("combined");
    expect(parsed.streakDirection).toBe("any");
    expect(parsed.maLine).toBe("any");
    expect(parsed.sort).toBe("code");
    expect(parsed.dir).toBe("asc");
    expect(parsePageParam(params)).toBe(1);
  });
});
