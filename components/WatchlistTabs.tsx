import Link from "next/link";

type Tab = "tracked" | "all" | "notifications";

export default function WatchlistTabs({ active }: { active: Tab }) {
  const tabClass = (tab: Tab) =>
    `flex-1 rounded-lg py-2 text-center text-sm font-medium transition-colors ${
      active === tab ? "bg-emerald-500 text-zinc-950" : "bg-zinc-900 text-zinc-400 hover:text-zinc-100"
    }`;

  return (
    <div className="flex gap-2 rounded-lg border border-zinc-800 p-1">
      <Link href="/" className={tabClass("tracked")}>
        已追蹤股票
      </Link>
      <Link href="/market" className={tabClass("all")}>
        所有股票
      </Link>
      <Link href="/notifications" className={tabClass("notifications")}>
        通知
      </Link>
    </div>
  );
}
