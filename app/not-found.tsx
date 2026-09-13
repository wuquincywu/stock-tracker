import Link from "next/link";

/**
 * Shown for an unmatched route, or when a page calls Next's notFound() with no nearer not-found.tsx
 * — e.g. app/stock/[code]/page.tsx does this for a code that isn't in the stock directory.
 */
export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 py-24 text-center">
      <p className="text-lg font-semibold text-zinc-100">找不到這個頁面</p>
      <p className="text-sm text-zinc-500">網址可能有誤，或這檔股票不在追蹤範圍內。</p>
      <Link
        href="/"
        className="rounded-full bg-emerald-500 px-5 py-2 text-sm font-medium text-zinc-950 transition-opacity hover:opacity-90"
      >
        回首頁
      </Link>
    </div>
  );
}
