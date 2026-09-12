export default function Loading() {
  return (
    <div className="mx-auto max-w-xl px-4 pb-24 pt-6" role="status" aria-live="polite">
      <span className="sr-only">載入中…</span>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex flex-col gap-2">
          <div className="h-5 w-32 animate-pulse rounded bg-zinc-900" />
          <div className="h-3 w-16 animate-pulse rounded bg-zinc-900" />
        </div>
        <div className="h-10 w-24 animate-pulse rounded bg-zinc-900" />
      </div>
      <div className="mb-4 flex gap-2">
        <div className="h-6 w-20 animate-pulse rounded-full bg-zinc-900" />
        <div className="h-6 w-20 animate-pulse rounded-full bg-zinc-900" />
      </div>
      <div className="h-96 animate-pulse rounded-lg border border-zinc-800 bg-zinc-900/60" />
    </div>
  );
}
