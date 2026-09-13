import { isDefaultSort, matchesFilters, parseFilterParams, parsePageParam, sortCards } from "@/lib/cardFilters";
import { getAllMarketCards } from "@/lib/marketdata";
import { getWatchlist, hasUnreadNotifications } from "@/lib/redis";
import { getCurrentUser } from "@/lib/users";
import MarketOverviewClient from "@/components/MarketOverviewClient";
import WatchlistTabs from "@/components/WatchlistTabs";
import type { WatchlistCardData } from "@/lib/types";

const PAGE_SIZE = 50;

export default async function MarketPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return null; // layout renders the "who are you" picker instead

  // Reads the same filter/sort/page state the client will parse from this same URL on hydration,
  // so a reload or a shared link renders the right slice on the very first response instead of
  // flashing an unfiltered page-1 before the client re-fetches.
  const rawParams = await searchParams;
  const urlParams = new URLSearchParams();
  for (const [key, value] of Object.entries(rawParams)) {
    if (typeof value === "string") urlParams.set(key, value);
  }
  const filterState = parseFilterParams(urlParams);
  const page = parsePageParam(urlParams);

  let initialCards: WatchlistCardData[] = [];
  let initialTotal = 0;
  let trackedCodes: string[] = [];
  let unread = false;
  // Distinct from `initialCards.length === 0`, which can legitimately happen for a filter combo
  // nobody currently matches — that's not a data failure, and MarketOverviewClient already renders
  // its own "沒有符合條件的股票" message for it. This only turns true when the underlying market
  // card cache itself came back empty (or the whole read failed below).
  let hasMarketData = false;

  try {
    const [allCards, watchlist, unreadResult] = await Promise.all([
      getAllMarketCards(),
      getWatchlist(currentUser),
      hasUnreadNotifications(currentUser),
    ]);
    hasMarketData = allCards.length > 0;
    trackedCodes = watchlist.map((w) => w.code);
    const filtered = allCards.filter((card) => matchesFilters(card, filterState));
    // allCards is already code-sorted (see buildAllMarketCards) and filter() preserves order, so
    // the default sort never needs a redundant re-sort of the (possibly ~2,400-card) filtered result.
    const sorted = isDefaultSort(filterState)
      ? filtered
      : sortCards(filtered, filterState.sort, filterState.dir, filterState.streakCategory);
    initialTotal = sorted.length;
    initialCards = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    unread = unreadResult;
  } catch {
    // fall through to the empty-state below
  }

  return (
    <div className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <div className="mb-4">
        <WatchlistTabs active="all" hasUnreadNotifications={unread} />
      </div>
      <p className="mb-6 text-sm text-zinc-500">
        全市場上市＋上櫃股票，顯示方式跟已追蹤股票一致。部分股票的歷史資料仍在補齊中，補齊前只會顯示部分徽章。
      </p>

      {!hasMarketData ? (
        <p className="py-12 text-center text-sm text-zinc-500">資料暫時無法取得，請稍後再試。</p>
      ) : (
        <MarketOverviewClient initialCards={initialCards} initialTotal={initialTotal} trackedCodes={trackedCodes} />
      )}
    </div>
  );
}
