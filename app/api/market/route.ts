import { NextRequest, NextResponse } from "next/server";
import { isDefaultSort, matchesFilters, parseFilterParams, parsePageParam, sortCards } from "@/lib/cardFilters";
import { getAllMarketCards } from "@/lib/marketdata";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Server-side search/filter/sort/pagination over the full "所有股票" card set, so the browser
 * never has to hydrate/keep ~2400 full stock objects in memory just to show 50 at a time — that
 * was making the page noticeably slow to open. Filtering and sorting go through lib/cardFilters.ts,
 * the same module the watchlist page's client-side filter uses, so the two can't drift apart.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;

  const state = parseFilterParams(params);
  const page = parsePageParam(params);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(params.get("limit")) || DEFAULT_LIMIT));
  const offset = (page - 1) * limit;

  const allCards = await getAllMarketCards();
  const filtered = allCards.filter((card) => matchesFilters(card, state));
  // allCards is already code-sorted (see buildAllMarketCards) and filter() preserves order, so the
  // default sort never needs a redundant re-sort of the (possibly ~2,400-card) filtered result.
  const sorted = isDefaultSort(state) ? filtered : sortCards(filtered, state.sort, state.dir, state.streakCategory);
  const pageCards = sorted.slice(offset, offset + limit);

  return NextResponse.json({ cards: pageCards, total: filtered.length });
}
