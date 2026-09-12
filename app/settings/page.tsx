import { DEFAULT_CHART_MONTHS, getAlertConfig, getChartMonths } from "@/lib/redis";
import { ALL_MA_ALERT_KEYS } from "@/lib/types";
import SettingsClient from "@/components/SettingsClient";
import BackButton from "@/components/ui/BackButton";

export default async function SettingsPage() {
  let config = {
    levels: [],
    streakThresholds: { foreign: 0, trust: 0, dealer: 0, combined: 0 },
    maAlerts: ALL_MA_ALERT_KEYS,
  } as Awaited<ReturnType<typeof getAlertConfig>>;
  let chartMonths = DEFAULT_CHART_MONTHS;
  try {
    [config, chartMonths] = await Promise.all([getAlertConfig(), getChartMonths()]);
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
    </div>
  );
}
