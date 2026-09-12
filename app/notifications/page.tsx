import Link from "next/link";
import { taipeiDateString } from "@/lib/date";
import { getDailyNotifications, markNotificationsRead } from "@/lib/redis";
import { getCurrentUser } from "@/lib/users";
import ClearAppBadge from "@/components/ClearAppBadge";
import WatchlistTabs from "@/components/WatchlistTabs";

/** 買進／站上 = 紅 (bullish, matches this app's price-up/buy color elsewhere); 賣出／跌破 = 綠
 * (bearish); anything else (e.g. 平盤) stays neutral. */
function partColor(part: string): string {
  if (part.includes("買") || part.includes("站上")) return "text-red-400";
  if (part.includes("賣") || part.includes("跌破")) return "text-emerald-400";
  return "text-zinc-400";
}

export default async function NotificationsPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) return null; // layout renders the "who are you" picker instead

  const today = taipeiDateString();

  let items: Awaited<ReturnType<typeof getDailyNotifications>> = [];
  try {
    items = await getDailyNotifications(currentUser, today);
    // Opening this page is what "reads" today's notifications — clears the tab's red dot and the
    // PWA app-icon badge (the latter via ClearAppBadge below) for next time.
    if (items.length > 0) await markNotificationsRead(currentUser, today);
  } catch {
    // Redis unreachable — falls through to the empty state below
  }

  return (
    <div className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <ClearAppBadge />
      <div className="mb-4">
        <WatchlistTabs active="notifications" hasUnreadNotifications={false} />
      </div>
      <h1 className="mb-3 text-sm font-semibold text-zinc-300">今日通知（{today}）</h1>

      {items.length === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-500">今天還沒有觸發任何提醒</p>
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((item) => (
            <Link
              key={item.code}
              href={`/stock/${item.code}`}
              className="block rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 transition-colors hover:border-zinc-700"
            >
              <p className="mb-1 text-sm font-medium text-zinc-100">
                {item.code} {item.name}
              </p>
              <p className="text-sm">
                {item.parts.map((part, i) => (
                  <span key={part}>
                    {i > 0 && <span className="text-zinc-600">、</span>}
                    <span className={partColor(part)}>{part}</span>
                  </span>
                ))}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
