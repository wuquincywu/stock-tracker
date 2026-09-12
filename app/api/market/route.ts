import { NextRequest, NextResponse } from "next/server";
import { getAllMarketCards } from "@/lib/marketdata";
import { INSTITUTIONAL_CATEGORY_ORDER, MA_LINE_ORDER } from "@/lib/types";
import type { InstitutionalCategory, InstitutionalLevel, MaLine, Market, StreakDirection } from "@/lib/types";

const ALL_LEVELS: InstitutionalLevel[] = ["big_sell", "small_sell", "flat", "small_buy", "big_buy"];
const ALL_MARKETS: Market[] = ["TWSE", "TPEX"];
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * Server-side search/filter/sort/pagination over the full "所有股票" card set, so the browser
 * never has to hydrate/keep ~2400 full stock objects in memory just to show 50 at a time — that
 * was making the page noticeably slow to open. Mirrors the same filter semantics as the watchlist
 * page's client-side filters (level/streak-category+direction+min/MA-line+direction), just applied
 * server-side over a much bigger data set.
 */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;

  const query = (params.get("q") ?? "").trim().toLowerCase();
  const queryOriginal = (params.get("q") ?? "").trim();
  const markets = new Set(
    (params.get("markets") ?? "")
      .split(",")
      .filter((m): m is Market => ALL_MARKETS.includes(m as Market)),
  );
  const levels = new Set(
    (params.get("levels") ?? "")
      .split(",")
      .filter((l): l is InstitutionalLevel => ALL_LEVELS.includes(l as InstitutionalLevel)),
  );
  const streakCategoryParam = params.get("streakCategory") ?? "combined";
  const streakCategory: InstitutionalCategory = INSTITUTIONAL_CATEGORY_ORDER.includes(
    streakCategoryParam as InstitutionalCategory,
  )
    ? (streakCategoryParam as InstitutionalCategory)
    : "combined";
  const streakDirectionParam = params.get("streakDirection") ?? "any";
  const streakDirection: StreakDirection | "any" =
    streakDirectionParam === "buy" || streakDirectionParam === "sell" ? streakDirectionParam : "any";
  const minStreak = Math.max(0, Number(params.get("minStreak")) || 0);

  const maLineParam = Number(params.get("maLine"));
  const maLine: MaLine | null = MA_LINE_ORDER.includes(maLineParam as MaLine) ? (maLineParam as MaLine) : null;
  const maDirection = params.get("maDirection") === "below" ? "below" : "above";

  const offset = Math.max(0, Number(params.get("offset")) || 0);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(params.get("limit")) || DEFAULT_LIMIT));

  const allCards = await getAllMarketCards();

  const filtered = allCards.filter((card) => {
    if (markets.size > 0 && !markets.has(card.market)) return false;
    if (levels.size > 0 && (!card.level || !levels.has(card.level))) return false;
    const streak = card.streaks[streakCategory];
    if (streakDirection !== "any" && streak?.direction !== streakDirection) return false;
    if (minStreak > 0 && (!streak || streak.length < minStreak)) return false;
    if (maLine !== null) {
      const snapshot = card.maSnapshot.find((s) => s.ma === maLine);
      if (!snapshot) return false;
      if (snapshot.above !== (maDirection === "above")) return false;
    }
    if (query && !card.code.toLowerCase().includes(query) && !card.name.includes(queryOriginal)) return false;
    return true;
  });

  filtered.sort((a, b) => a.code.localeCompare(b.code));

  const page = filtered.slice(offset, offset + limit);

  return NextResponse.json({ cards: page, total: filtered.length });
}
