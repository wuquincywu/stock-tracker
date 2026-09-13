import { DEFAULT_CHART_MONTHS, getAlertConfig, getChartMonths, getCronStatus } from "@/lib/redis";
import type { CronStatus } from "@/lib/redis";
import { getCurrentUser } from "@/lib/users";
import { ALL_MA_ALERT_KEYS } from "@/lib/types";
import SettingsClient from "@/components/SettingsClient";
import BackButton from "@/components/ui/BackButton";

/** Taipei-local "YYYY-MM-DD HH:mm" for the cron-status lines below — matches how dates are
 * displayed elsewhere in the app (taipeiDateString), just with the time kept too. */
function formatTaipeiDateTime(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 8 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function CronStatusLine({ label, status, none }: { label: string; status: CronStatus | null; none: string }) {
  if (!status) return <p>{none}</p>;
  return (
    <p>
      {label}：{formatTaipeiDateTime(status.at)}
      {status.ok ? (
        <span className="text-zinc-500">
          {" "}
          · 成功（
          {Object.entries(status.summary ?? {})
            .map(([key, value]) => `${key} ${value}`)
            .join("、")}
          ）
        </span>
      ) : (
        <span className="text-red-400"> · 失敗：{status.error}</span>
      )}
    </p>
  );
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
  let checkAlertsStatus: CronStatus | null = null;
  let concentrationStatus: CronStatus | null = null;
  try {
    [config, chartMonths, checkAlertsStatus, concentrationStatus] = await Promise.all([
      getAlertConfig(currentUser),
      getChartMonths(currentUser),
      getCronStatus("checkAlerts"),
      getCronStatus("shareholderConcentration"),
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

      <div className="mt-8 flex flex-col gap-1 border-t border-zinc-800 pt-4 text-xs text-zinc-600">
        <CronStatusLine label="上次每日檢查" status={checkAlertsStatus} none="尚無每日檢查紀錄。" />
        <CronStatusLine label="上次大戶資料更新" status={concentrationStatus} none="尚無大戶資料更新紀錄。" />
      </div>
    </div>
  );
}
