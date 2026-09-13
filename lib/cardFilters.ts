import {
  ALL_MARKETS,
  INSTITUTIONAL_CATEGORY_ORDER,
  INSTITUTIONAL_LEVEL_ORDER,
  MA_LINE_ORDER,
} from "./types";
import type {
  InstitutionalCategory,
  InstitutionalLevel,
  MaLine,
  Market,
  StreakDirection,
  WatchlistCardData,
} from "./types";

export type SortKey = "code" | "changePct" | "institutionalNet" | "streakLength" | "percentB";
export type SortDir = "asc" | "desc";
export type MaFilterDirection = "above" | "below";
export type StreakFilterDirection = StreakDirection | "any";

export const ALL_SORT_KEYS: SortKey[] = ["code", "changePct", "institutionalNet", "streakLength", "percentB"];

/**
 * Everything needed to filter, sort, and (for the market page) paginate the shared card list —
 * one shape used by both the watchlist's client-side filter and /api/market's server-side
 * filter/sort, which used to be two hand-synced copies (see the "duplicated filter predicate"
 * writeup in the optimization plan). Also the shape mirrored into the URL query string so filters
 * survive a reload/back-navigation/shared link.
 */
export interface CardFilterState {
  query: string;
  markets: Set<Market>;
  levels: Set<InstitutionalLevel>;
  streakCategory: InstitutionalCategory;
  streakDirection: StreakFilterDirection;
  minStreak: number;
  maLine: MaLine | "any";
  maDirection: MaFilterDirection;
  sort: SortKey;
  dir: SortDir;
}

export const DEFAULT_FILTER_STATE: CardFilterState = {
  query: "",
  markets: new Set(),
  levels: new Set(),
  streakCategory: "combined",
  streakDirection: "any",
  minStreak: 0,
  maLine: "any",
  maDirection: "above",
  sort: "code",
  dir: "asc",
};

export function isFilterActive(state: CardFilterState): boolean {
  return (
    state.query.trim() !== "" ||
    state.markets.size > 0 ||
    state.levels.size > 0 ||
    state.streakDirection !== "any" ||
    state.minStreak > 0 ||
    state.maLine !== "any"
  );
}

export function isStreakFilterActive(state: Pick<CardFilterState, "streakDirection" | "minStreak">): boolean {
  return state.streakDirection !== "any" || state.minStreak > 0;
}

export function isMaFilterActive(state: Pick<CardFilterState, "maLine">): boolean {
  return state.maLine !== "any";
}

/**
 * Single predicate shared by the watchlist's client-side filter and /api/market's server-side
 * filter — replaces two hand-synced copies of the same logic.
 */
export function matchesFilters(card: WatchlistCardData, state: CardFilterState): boolean {
  if (state.markets.size > 0 && !state.markets.has(card.market)) return false;
  if (state.levels.size > 0 && (!card.level || !state.levels.has(card.level))) return false;

  const streak = card.streaks[state.streakCategory];
  if (state.streakDirection !== "any" && streak?.direction !== state.streakDirection) return false;
  if (state.minStreak > 0 && (!streak || streak.length < state.minStreak)) return false;

  if (state.maLine !== "any") {
    const snapshot = card.maSnapshot.find((s) => s.ma === state.maLine);
    if (!snapshot) return false;
    if (snapshot.above !== (state.maDirection === "above")) return false;
  }

  const query = state.query.trim();
  if (query) {
    const queryLower = query.toLowerCase();
    if (!card.code.toLowerCase().includes(queryLower) && !card.name.includes(query)) return false;
  }

  return true;
}

function combinedInstitutionalNet(card: WatchlistCardData): number | null {
  if (!card.latestInstitutional) return null;
  const { foreignNet, investmentTrustNet, dealerNet } = card.latestInstitutional;
  return foreignNet + investmentTrustNet + dealerNet;
}

/** Signed streak length for sorting: positive for a buy streak, negative for a sell streak, so a
 * single asc/desc sort surfaces "longest buy streak" on one end and "longest sell streak" on the
 * other instead of needing separate sort keys per direction. */
function signedStreakLength(card: WatchlistCardData, category: InstitutionalCategory): number | null {
  const streak = card.streaks[category];
  if (!streak) return null;
  return streak.direction === "buy" ? streak.length : -streak.length;
}

function sortValue(card: WatchlistCardData, sort: SortKey, streakCategory: InstitutionalCategory): number | null {
  switch (sort) {
    case "code":
      return null; // code sorts lexicographically below, not through this numeric comparator
    case "changePct":
      return card.changePct;
    case "institutionalNet":
      return combinedInstitutionalNet(card);
    case "streakLength":
      return signedStreakLength(card, streakCategory);
    case "percentB":
      return card.bollinger?.percentB ?? null;
  }
}

/**
 * Sorts a card array by the given key/direction. A card missing the sorted field (history not
 * backfilled yet) always sorts to the end regardless of direction — otherwise a null would compare
 * as the smallest value and those cards would wrongly cluster at the "biggest gainer" /
 * "longest streak" end of a descending sort.
 */
export function sortCards(
  cards: WatchlistCardData[],
  sort: SortKey,
  dir: SortDir,
  streakCategory: InstitutionalCategory = "combined",
): WatchlistCardData[] {
  const sorted = [...cards];
  if (sort === "code") {
    sorted.sort((a, b) => (dir === "asc" ? a.code.localeCompare(b.code) : b.code.localeCompare(a.code)));
    return sorted;
  }

  sorted.sort((a, b) => {
    const va = sortValue(a, sort, streakCategory);
    const vb = sortValue(b, sort, streakCategory);
    if (va === null && vb === null) return a.code.localeCompare(b.code);
    if (va === null) return 1;
    if (vb === null) return -1;
    return dir === "asc" ? va - vb : vb - va;
  });
  return sorted;
}

// ---- URL <-> state ----
// The native History API (window.history.pushState/replaceState) is what actually keeps these in
// the address bar without a Next.js navigation/RSC re-render — see the callers in
// components/useCardFilterUrl.ts. This module just handles the pure parse/serialize.

function parseSet<T extends string>(raw: string | null, allowed: readonly T[]): Set<T> {
  if (!raw) return new Set();
  return new Set(raw.split(",").filter((v): v is T => (allowed as readonly string[]).includes(v)));
}

export function parseFilterParams(params: URLSearchParams): CardFilterState {
  const streakCategoryRaw = params.get("streakCategory");
  const streakCategory: InstitutionalCategory = INSTITUTIONAL_CATEGORY_ORDER.includes(
    streakCategoryRaw as InstitutionalCategory,
  )
    ? (streakCategoryRaw as InstitutionalCategory)
    : DEFAULT_FILTER_STATE.streakCategory;

  const streakDirectionRaw = params.get("streakDirection");
  const streakDirection: StreakFilterDirection =
    streakDirectionRaw === "buy" || streakDirectionRaw === "sell" ? streakDirectionRaw : "any";

  const maLineRaw = Number(params.get("maLine"));
  const maLine: MaLine | "any" = MA_LINE_ORDER.includes(maLineRaw as MaLine) ? (maLineRaw as MaLine) : "any";

  const sortRaw = params.get("sort");
  const sort: SortKey = ALL_SORT_KEYS.includes(sortRaw as SortKey) ? (sortRaw as SortKey) : "code";

  return {
    query: params.get("q") ?? "",
    markets: parseSet(params.get("markets"), ALL_MARKETS),
    levels: parseSet(params.get("levels"), INSTITUTIONAL_LEVEL_ORDER),
    streakCategory,
    streakDirection,
    minStreak: Math.max(0, Number(params.get("minStreak")) || 0),
    maLine,
    maDirection: params.get("maDirection") === "below" ? "below" : "above",
    sort,
    dir: params.get("dir") === "desc" ? "desc" : "asc",
  };
}

/** Parses just the 1-based page number, kept separate from CardFilterState since only the market
 * page paginates (the watchlist shows everything at once). */
export function parsePageParam(params: URLSearchParams): number {
  return Math.max(1, Math.floor(Number(params.get("page"))) || 1);
}

/**
 * Serializes filter/sort (+ optional page) state into query params — only non-default values are
 * included, so a fully-cleared filter produces a clean URL instead of a wall of default params.
 */
export function filterStateToSearchParams(state: CardFilterState, page?: number): URLSearchParams {
  const params = new URLSearchParams();
  if (state.query.trim()) params.set("q", state.query.trim());
  if (state.markets.size > 0) params.set("markets", [...state.markets].join(","));
  if (state.levels.size > 0) params.set("levels", [...state.levels].join(","));
  if (state.streakCategory !== DEFAULT_FILTER_STATE.streakCategory) params.set("streakCategory", state.streakCategory);
  if (state.streakDirection !== "any") params.set("streakDirection", state.streakDirection);
  if (state.minStreak > 0) params.set("minStreak", String(state.minStreak));
  if (state.maLine !== "any") {
    params.set("maLine", String(state.maLine));
    params.set("maDirection", state.maDirection);
  }
  if (state.sort !== "code") params.set("sort", state.sort);
  if (state.dir !== "asc") params.set("dir", state.dir);
  if (page && page > 1) params.set("page", String(page));
  return params;
}
