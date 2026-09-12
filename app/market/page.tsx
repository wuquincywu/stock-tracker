import { getAllMarketCards } from "@/lib/marketdata";
import { getWatchlist, hasUnreadNotifications } from "@/lib/redis";
import { getCurrentUser } from "@/lib/users";
import MarketOverviewClient from "@/components/MarketOverviewClient";
import WatchlistTabs from "@/components/WatchlistTabs";
import type { WatchlistCardData } from "@/lib/types";

const PAGE_SIZE = 50;

function netOf(card: WatchlistCardData): number {
  if (!card.latestInstitutional) return 0;
  return (
    card.latestInstitutional.foreignNet + card.latestInstitutional.investmentTrustNet + card.latestInstitutional.dealerNet
  );
}

export default async function MarketPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) return null; // layout renders the "who are you" picker instead

  let initialCards: WatchlistCardData[] = [];
  let initialTotal = 0;
  let trackedCodes: string[] = [];
  let unread = false;

  try {
    const [allCards, watchlist, unreadResult] = await Promise.all([
      getAllMarketCards(),
      getWatchlist(currentUser),
      hasUnreadNotifications(currentUser),
    ]);
    trackedCodes = watchlist.map((w) => w.code);
    const sorted = [...allCards].sort((a, b) => netOf(b) - netOf(a));
    initialTotal = sorted.length;
    initialCards = sorted.slice(0, PAGE_SIZE);
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

      {initialCards.length === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-500">資料暫時無法取得，請稍後再試。</p>
      ) : (
        <MarketOverviewClient initialCards={initialCards} initialTotal={initialTotal} trackedCodes={trackedCodes} />
      )}
    </div>
  );
}
