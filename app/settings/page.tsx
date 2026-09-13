import { DEFAULT_CHART_MONTHS, getAlertConfig, getChartMonths, getCronStatus } from "@/lib/redis";
import { getCurrentUser } from "@/lib/users";
import { ALL_MA_ALERT_KEYS } from "@/lib/types";
import SettingsClient from "@/components/SettingsClient";
import BackButton from "@/components/ui/BackButton";

/** Taipei-local "YYYY-MM-DD HH:mm" for the cron-status line below — matches how dates are
 * displayed elsewhere in the app (taipeiDateString), just with the time kept too. */
function formatTaipeiDateTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 16).replace("T", " ");
}

export default async function SettingsPage() {
  const currentUser = await getCurrentUser();
  if (!currentUser) return null; // layout renders the "who are you" picker instead

  let config = {
    levels: [],
    streakThresholds: { foreign: 0, trust: 0, dealer: 0, combined: 0 },
    maAlerts: ALL_MA_ALERT_KEYS,
  } as Awaited<ReturnType<typeof getAlertConfig>>;
  let chartMonths = DEFAULT_CHART_MONTHS;
  let cronStatus: Awaited<ReturnType<typeof getCronStatus>> = null;
  try {
    [config, chartMonths, cronStatus] = await Promise.all([
      getAlertConfig(currentUser),
      getChartMonths(currentUser),
      getCronStatus(),
    ]);
  } catch {
    // fall back to the defaults above if Redis isn't reachable
  }

  return (
    <div className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <BackButton />
      <div className="mb-6">
        <h1 className="mb-1 text-xl font-semibold">通知設定</h1>
        <p className="text-sm text-zinc-500">
          套用在整個追蹤清單。等級分類只看三大法人合計，連續買賣天數可分別對外資／投信／自營商／合計各自設定門檻。
        </p>
      </div>
      <SettingsClient initialConfig={config} initialChartMonths={chartMonths} />

      <div className="mt-8 border-t border-zinc-800 pt-4 text-xs text-zinc-600">
        {cronStatus ? (
          <p>
            上次每日檢查：{formatTaipeiDateTime(cronStatus.at)}
            {cronStatus.ok ? (
              <span className="text-zinc-500">
                {" "}
                · 成功（{cronStatus.summary?.users ?? 0} 位使用者、{cronStatus.summary?.checked ?? 0} 檔）
              </span>
            ) : (
              <span className="text-red-400"> · 失敗：{cronStatus.error}</span>
            )}
          </p>
        ) : (
          <p>尚無每日檢查紀錄。</p>
        )}
      </div>
    </div>
  );
}
