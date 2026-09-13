import { notFound } from "next/navigation";
import { runHealthChecks } from "@/lib/health";
import { getCurrentUser } from "@/lib/users";
import BackButton from "@/components/ui/BackButton";

// This app has no real role/permission system (see README's multi-user model — every registered
// name is an equal, independent identity, by design for a small trusted group). "Admin" here is
// just the literal name of the one identity that should see this diagnostic page, not a role —
// good enough for a personal tool with a handful of users, not something to build real RBAC for.
const HEALTH_CHECK_USER = "Admin";

export default async function HealthPage() {
  const currentUser = await getCurrentUser();
  if (currentUser !== HEALTH_CHECK_USER) notFound();

  const results = await runHealthChecks();
  const allOk = results.every((r) => r.ok);

  return (
    <div className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <BackButton />
      <div className="mb-6">
        <h1 className="mb-1 text-xl font-semibold">系統健康檢查</h1>
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
