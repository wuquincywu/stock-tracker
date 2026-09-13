import { buildCardsForEntries } from "@/lib/marketdata";
import { DEFAULT_CHART_MONTHS, getChartMonths, getMaLines, getWatchlist, hasUnreadNotifications } from "@/lib/redis";
import { getCurrentUser } from "@/lib/users";
import type { MaLine, WatchlistCardData, WatchlistEntry } from "@/lib/types";
import WatchlistClient from "@/components/WatchlistClient";
import WatchlistTabs from "@/components/WatchlistTabs";

export default async function Home() {
  const currentUser = await getCurrentUser();
  if (!currentUser) return null; // layout renders the "who are you" picker instead

  let watchlist: WatchlistEntry[] = [];
  let chartMonths = DEFAULT_CHART_MONTHS;
  let maLines: MaLine[] = [5, 20, 60];
  let unread = false;
  try {
    [watchlist, chartMonths, maLines, unread] = await Promise.all([
      getWatchlist(currentUser),
      getChartMonths(currentUser),
      getMaLines(),
      hasUnreadNotifications(currentUser),
    ]);
  } catch {
    watchlist = [];
  }

  // Two bulk Redis reads (buildCardsForEntries) regardless of watchlist size, instead of the old
  // per-stock pair of round-trips (institutional + price) that used to run once per tracked stock —
  // a 20-stock watchlist meant 40 separate Upstash REST calls just to open this page.
  let cards: WatchlistCardData[] = [];
  try {
    cards = await buildCardsForEntries(watchlist, chartMonths, maLines);
  } catch {
    cards = [];
  }

  const dataDate = cards.reduce<string | null>((latest, card) => {
    const d = card.latestInstitutional?.date;
    if (!d) return latest;
    return !latest || d > latest ? d : latest;
  }, null);

  return (
    <div className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <div className="mb-4">
        <WatchlistTabs active="tracked" hasUnreadNotifications={unread} />
      </div>
      <WatchlistClient initialCards={cards} dataDate={dataDate} />
    </div>
  );
}
