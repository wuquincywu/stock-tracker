"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import {
  INSTITUTIONAL_CATEGORY_LABEL,
  INSTITUTIONAL_CATEGORY_ORDER,
  INSTITUTIONAL_LEVEL_LABEL,
  MA_LINE_ORDER,
} from "@/lib/types";
import type { AlertConfig, InstitutionalCategory, InstitutionalLevel, MaAlertKey } from "@/lib/types";

const LEVEL_ORDER: InstitutionalLevel[] = ["big_sell", "small_sell", "flat", "small_buy", "big_buy"];

export default function SettingsClient({
  initialConfig,
  initialChartMonths,
}: {
  initialConfig: AlertConfig;
  initialChartMonths: number;
}) {
  const [levels, setLevels] = useState<Set<InstitutionalLevel>>(new Set(initialConfig.levels));
  const [streakThresholds, setStreakThresholds] = useState(initialConfig.streakThresholds);
  const [maAlerts, setMaAlerts] = useState<Set<MaAlertKey>>(new Set(initialConfig.maAlerts));
  const [chartMonths, setChartMonths] = useState(initialChartMonths);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  function updateStreakThreshold(category: InstitutionalCategory, value: number) {
    setSaved(false);
    setStreakThresholds((prev) => ({ ...prev, [category]: Math.max(0, value || 0) }));
  }

  function toggleLevel(level: InstitutionalLevel) {
    setSaved(false);
    setLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }

  function toggleMaAlert(key: MaAlertKey) {
    setSaved(false);
    setMaAlerts((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ levels: [...levels], streakThresholds, maAlerts: [...maAlerts], chartMonths }),
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
      <section>
        <h2 className="mb-3 text-sm font-semibold text-zinc-300">法人買賣超分級時通知</h2>
        <div className="flex flex-col gap-2">
          {LEVEL_ORDER.map((level) => (
            <label
              key={level}
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3"
            >
              <input
                type="checkbox"
                checked={levels.has(level)}
                onChange={() => toggleLevel(level)}
                className="h-4 w-4 accent-emerald-500"
              />
              <span className="text-sm">{INSTITUTIONAL_LEVEL_LABEL[level]}</span>
            </label>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-zinc-300">股價站上／跌破均線時通知</h2>
        <div className="flex flex-col gap-2">
          {MA_LINE_ORDER.map((ma) => (
            <div
              key={ma}
              className="flex items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3"
            >
              <span className="w-14 text-sm text-zinc-300">MA{ma}</span>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={maAlerts.has(`${ma}:up`)}
                  onChange={() => toggleMaAlert(`${ma}:up`)}
                  className="h-4 w-4 accent-emerald-500"
                />
                <span className="text-sm">站上</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={maAlerts.has(`${ma}:down`)}
                  onChange={() => toggleMaAlert(`${ma}:down`)}
                  className="h-4 w-4 accent-emerald-500"
                />
                <span className="text-sm">跌破</span>
              </label>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-zinc-300">連續同向買賣天數達到時通知</h2>
        <p className="mb-2 text-xs text-zinc-500">可分別針對外資／投信／自營商／合計各自設定門檻，0 表示該項停用。</p>
        <div className="flex flex-col gap-2">
          {INSTITUTIONAL_CATEGORY_ORDER.map((category) => (
            <div
              key={category}
              className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3"
            >
              <span className="w-14 text-sm text-zinc-300">{INSTITUTIONAL_CATEGORY_LABEL[category]}</span>
              <input
                type="number"
                min={0}
                value={streakThresholds[category]}
                onChange={(e) => updateStreakThreshold(category, Number(e.target.value))}
                className="w-20 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm outline-none focus:border-emerald-500"
              />
              <span className="text-sm text-zinc-400">天</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-zinc-300">股價圖表資料範圍</h2>
        <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3">
          <input
            type="number"
            min={1}
            max={24}
            value={chartMonths}
            onChange={(e) => {
              setSaved(false);
              setChartMonths(Math.min(24, Math.max(1, Number(e.target.value) || 1)));
            }}
            className="w-20 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm outline-none focus:border-emerald-500"
          />
          <span className="text-sm text-zinc-400">
            個月（1～24，預設 3。少於 3 個月時 MA60／布林通道可能因資料不足而無法顯示）
          </span>
        </div>
      </section>

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
