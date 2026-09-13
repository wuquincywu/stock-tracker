"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertConfigFields, parseDigitsString, toDigitsString, useAlertConfigState } from "@/components/AlertConfigFields";
import Button from "@/components/ui/Button";
import type { AlertConfig, WatchlistEntry } from "@/lib/types";

export default function SettingsClient({
  initialConfig,
  initialChartMonths,
  watchlist,
  overriddenCodes,
}: {
  initialConfig: AlertConfig;
  initialChartMonths: number;
  watchlist: WatchlistEntry[];
  overriddenCodes: string[];
}) {
  const [saved, setSaved] = useState(false);
  const alertFields = useAlertConfigState(initialConfig, () => setSaved(false));
  const [chartMonths, setChartMonths] = useState(() => toDigitsString(initialChartMonths));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [stocksOpen, setStocksOpen] = useState(false);

  const overriddenSet = new Set(overriddenCodes);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...alertFields.getConfig(),
          chartMonths: parseDigitsString(chartMonths, 3),
        }),
      });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  async function testNotification() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/notifications/test", { method: "POST" });
      if (!res.ok) throw new Error();
      const data = await res.json();
      const triggered = data.crosses + data.levelAlerts + data.streakAlerts;
      setTestResult(
        data.testPushSent
          ? "資料已更新，目前沒有觸發任何提醒，已送出測試推播"
          : `資料已更新，觸發了 ${triggered} 項提醒並送出推播`,
      );
    } catch {
      setTestResult("測試失敗，請稍後再試一次");
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <AlertConfigFields
        levels={alertFields.levels}
        onToggleLevel={alertFields.toggleLevel}
        maAlerts={alertFields.maAlerts}
        onToggleMaAlert={alertFields.toggleMaAlert}
        streakThresholds={alertFields.streakThresholds}
        onStreakThresholdChange={alertFields.updateStreakThreshold}
        onStreakThresholdBlur={alertFields.blurStreakThreshold}
      />

      <section>
        <h2 className="mb-3 text-sm font-semibold text-zinc-300">股價圖表資料範圍</h2>
        <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3">
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={chartMonths}
            onChange={(e) => {
              if (e.target.value !== "" && !/^[0-9]+$/.test(e.target.value)) return;
              setSaved(false);
              setChartMonths(e.target.value);
            }}
            onBlur={() => setChartMonths(toDigitsString(Math.min(24, Math.max(1, parseDigitsString(chartMonths, 3)))))}
            className="w-20 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm outline-none focus:border-emerald-500"
          />
          <span className="text-sm text-zinc-400">
            個月（1～24，預設 3。少於 3 個月時 MA60／布林通道可能因資料不足而無法顯示）
          </span>
        </div>
      </section>

      {watchlist.length > 0 && (
        <section>
          <button
            type="button"
            onClick={() => setStocksOpen((v) => !v)}
            className="flex w-full items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-left"
          >
            <span className="text-sm font-semibold text-zinc-300">已追蹤的股票（可個別設定通知門檻）</span>
            <span className="text-xs text-zinc-500">{stocksOpen ? "收合 ▲" : "展開 ▼"}</span>
          </button>
          {stocksOpen && (
            <ul className="mt-2 flex flex-col gap-2">
              {watchlist.map((entry) => (
                <li key={entry.code}>
                  <Link
                    href={`/settings/${entry.code}`}
                    className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm transition-colors hover:border-zinc-700"
                  >
                    <span>
                      {entry.code} {entry.name}
                    </span>
                    {overriddenSet.has(entry.code) ? (
                      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300">
                        已自訂
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-600">共同設定</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving}>
          {saving ? "儲存中…" : "儲存設定"}
        </Button>
        {saved && <span className="text-sm text-emerald-400">已儲存</span>}
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-zinc-300">測試通知</h2>
        <p className="mb-3 text-xs text-zinc-500">
          立即重新抓取追蹤股票的最新資料並檢查一次——真的觸發提醒就送出真實推播，沒有的話會送一則測試推播確認功能正常。
        </p>
        <div className="flex items-center gap-3">
          <Button onClick={testNotification} disabled={testing}>
            {testing ? "測試中…" : "測試通知"}
          </Button>
          {testResult && <span className="text-sm text-zinc-400">{testResult}</span>}
        </div>
      </section>
    </div>
  );
}
