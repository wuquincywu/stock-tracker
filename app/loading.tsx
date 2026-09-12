export default function Loading() {
  return (
    <div className="mx-auto max-w-xl px-4 pb-24 pt-6" role="status" aria-live="polite">
      <span className="sr-only">載入中…</span>
      <div className="flex flex-col gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/60" />
        ))}
      </div>
    </div>
  );
}
