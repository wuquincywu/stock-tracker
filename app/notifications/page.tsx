import Link from "next/link";
import { taipeiDateString } from "@/lib/date";
import { getNotificationHistory, markNotificationsRead } from "@/lib/redis";
import type { DailyNotificationGroup, DailyNotificationItem } from "@/lib/redis";
import { getCurrentUser } from "@/lib/users";
import ClearAppBadge from "@/components/ClearAppBadge";
import WatchlistTabs from "@/components/WatchlistTabs";

const HISTORY_DAYS = 30;

/** 買進／站上 = 紅 (bullish, matches this app's price-up/buy color elsewhere); 賣出／低於 = 綠
 * (bearish); anything else (e.g. 平盤) stays neutral. */
function partColor(text: string): string {
  if (text.includes("買") || text.includes("站上")) return "text-red-400";
  if (text.includes("賣") || text.includes("低於")) return "text-emerald-400";
  return "text-zinc-400";
}

/**
 * True only for a genuine 均線 crossing alert's text ("站上 MA20" / "低於 MA5", the exact format
 * lib/alerts.ts builds it in) — the outline box on this page should only ever mark "today is the
 * day it actually crossed", never a 法人分級 or 連續買賣 line. `lib/alerts.ts`'s `processUserAlerts`
 * already only sets `highlight: true` for that same case, but this page can now show up to 30 days
 * of history (see getNotificationHistory below) — long enough to resurface a record written before
 * that behavior was settled (see commits e88912f/480cd40) with `highlight: true` baked into a
 * streak line. Checking the text here too means a stale stored value can never show the wrong box,
 * regardless of which app version originally wrote it.
 */
function isMaCrossText(text: string): boolean {
  return /^(站上|低於) MA\d+$/.test(text);
}

function NotificationItemList({ items }: { items: DailyNotificationItem[] }) {
  return (
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
          <p className="flex flex-wrap items-center gap-x-1 text-sm">
            {item.parts.map((part, i) => (
              <span key={part.text} className="flex items-center gap-1">
                {i > 0 && <span className="text-zinc-600">、</span>}
                <span
                  className={`${partColor(part.text)}${
                    part.highlight && isMaCrossText(part.text) ? " rounded border border-current px-1.5 py-0.5" : ""
                  }`}
                >
                  {part.text}
                </span>
              </span>
            ))}
          </p>
        </Link>
      ))}
    </div>
  );
}

export default async function NotificationsPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) return null; // layout renders the "who are you" picker instead

  const today = taipeiDateString();

  let history: DailyNotificationGroup[] = [];
  try {
    // Notifications are kept for 30 days (see NOTIFICATIONS_TTL_SECONDS in lib/redis.ts) but this
    // page used to only ever read today's — the other ~29 days were written and then never shown
    // to anyone. One call covers both today's detail and the history list below it.
    history = await getNotificationHistory(currentUser, HISTORY_DAYS);
    const todayItems = history.find((g) => g.date === today)?.items ?? [];
    // Opening this page is what "reads" today's notifications — clears the tab's red dot and the
    // PWA app-icon badge (the latter via ClearAppBadge below) for next time.
    if (todayItems.length > 0) await markNotificationsRead(currentUser, today);
  } catch {
    // Redis unreachable — falls through to the empty state below
  }

  const todayItems = history.find((g) => g.date === today)?.items ?? [];
  const pastGroups = history.filter((g) => g.date !== today);

  return (
    <div className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <ClearAppBadge />
      <div className="mb-4">
        <WatchlistTabs active="notifications" hasUnreadNotifications={false} />
      </div>

      <h1 className="mb-3 text-sm font-semibold text-zinc-300">今日通知（{today}）</h1>
      {todayItems.length === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-500">今天還沒有觸發任何提醒</p>
      ) : (
        <NotificationItemList items={todayItems} />
      )}

      {pastGroups.length > 0 && (
        <div className="mt-6 flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-zinc-300">過去 {HISTORY_DAYS} 天</h2>
          {pastGroups.map((group) => (
            <details key={group.date} className="rounded-xl border border-zinc-800 bg-zinc-900/40">
              <summary className="cursor-pointer select-none px-4 py-3 text-sm text-zinc-400 hover:text-zinc-200">
                {group.date} · {group.items.length} 檔觸發
              </summary>
              <div className="border-t border-zinc-800 p-3">
                <NotificationItemList items={group.items} />
              </div>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
