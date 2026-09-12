import Link from "next/link";
import { getDailyNotifications } from "@/lib/redis";
import WatchlistTabs from "@/components/WatchlistTabs";

export default async function NotificationsPage() {
  const today = new Date().toISOString().slice(0, 10);

  let items: Awaited<ReturnType<typeof getDailyNotifications>> = [];
  try {
    items = await getDailyNotifications(today);
  } catch {
    // Redis unreachable — falls through to the empty state below
  }

  return (
    <div className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <div className="mb-4">
        <WatchlistTabs active="notifications" />
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
              <p className="text-sm text-zinc-400">{item.message}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
