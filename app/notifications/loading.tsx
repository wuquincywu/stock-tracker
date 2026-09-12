export default function Loading() {
  return (
    <div className="mx-auto max-w-xl px-4 pb-24 pt-6" role="status" aria-live="polite">
      <span className="sr-only">載入中…</span>
      <div className="mb-4 flex gap-2 rounded-lg border border-zinc-800 p-1">
        <div className="h-9 flex-1 rounded-lg bg-zinc-900" />
        <div className="h-9 flex-1 rounded-lg bg-zinc-900" />
        <div className="h-9 flex-1 rounded-lg bg-zinc-900" />
      </div>
      <div className="mb-3 h-4 w-32 animate-pulse rounded bg-zinc-900" />
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-16 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/60" />
        ))}
      </div>
    </div>
  );
}
