import { runApiStatusChecks } from "@/lib/apiStatus";
import { getCurrentUser } from "@/lib/users";
import BackButton from "@/components/ui/BackButton";

export default async function ApiStatusPage() {
  // Still requires a chosen identity, same as every other page (app/layout.tsx gates all children
  // behind UserPicker until one is picked) — but unlike the daily-check/大戶更新 cron statuses on
  // the Settings page, this isn't scoped to any one person's data, so any registered user can view
  // it, not just a specific one.
  const currentUser = await getCurrentUser();
  if (!currentUser) return null; // layout renders the "who are you" picker instead

  const results = await runApiStatusChecks();
  const allOk = results.every((r) => r.ok);

  return (
    <div className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <BackButton />
      <div className="mb-6">
        <h1 className="mb-1 text-xl font-semibold">API 存取狀況</h1>
        <p className="text-sm text-zinc-500">
          即時檢查 Redis 與每個外部資料源現在是否連得上——每次打開這頁都是即時檢查，不是快取結果。
        </p>
      </div>

      <p className={`mb-4 text-sm font-medium ${allOk ? "text-emerald-400" : "text-red-400"}`}>
        {allOk ? "全部正常" : "有項目異常"}
      </p>

      <ul className="flex flex-col gap-2">
        {results.map((r) => (
          <li
            key={r.name}
            className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3"
          >
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${r.ok ? "bg-emerald-400" : "bg-red-400"}`}
                aria-hidden
              />
              <span className="text-sm font-medium">{r.name}</span>
            </div>
            <div className="text-right text-xs">
              <div className={r.ok ? "text-zinc-500" : "text-red-400"}>{r.ok ? `${r.latencyMs}ms` : "失敗"}</div>
              {r.error && <div className="max-w-52 text-red-400/80">{r.error}</div>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
