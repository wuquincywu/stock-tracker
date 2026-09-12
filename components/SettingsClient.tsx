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

// Digits-only text state for a numeric field, so it can briefly be empty while the user is
// clearing it to type a new value — a controlled <input type="number"> that eagerly coerces
// every keystroke (e.g. Number("") -> 0) snaps back to "0" the instant the field is cleared, and
// then new digits land *after* that stuck 0 (typing "71" produces "071") instead of replacing it.
function toDigitsString(n: number): string {
  return String(Math.max(0, Math.floor(n)));
}

function parseDigitsString(raw: string, fallback: number): number {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? Math.max(0, n) : fallback;
}

export default function SettingsClient({
  initialConfig,
  initialChartMonths,
}: {
  initialConfig: AlertConfig;
  initialChartMonths: number;
}) {
  const [levels, setLevels] = useState<Set<InstitutionalLevel>>(new Set(initialConfig.levels));
  const [streakThresholds, setStreakThresholds] = useState<Record<InstitutionalCategory, string>>(() => ({
    foreign: toDigitsString(initialConfig.streakThresholds.foreign),
    trust: toDigitsString(initialConfig.streakThresholds.trust),
    dealer: toDigitsString(initialConfig.streakThresholds.dealer),
    combined: toDigitsString(initialConfig.streakThresholds.combined),
  }));
  const [maAlerts, setMaAlerts] = useState<Set<MaAlertKey>>(new Set(initialConfig.maAlerts));
  const [chartMonths, setChartMonths] = useState(() => toDigitsString(initialChartMonths));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  function updateStreakThreshold(category: InstitutionalCategory, raw: string) {
    if (raw !== "" && !/^[0-9]+$/.test(raw)) return; // reject anything but digits (and empty, while editing)
    setSaved(false);
    setStreakThresholds((prev) => ({ ...prev, [category]: raw }));
  }

  function blurStreakThreshold(category: InstitutionalCategory) {
    setStreakThresholds((prev) => ({ ...prev, [category]: toDigitsString(parseDigitsString(prev[category], 0)) }));
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
      const parsedStreakThresholds = {
        foreign: parseDigitsString(streakThresholds.foreign, 0),
        trust: parseDigitsString(streakThresholds.trust, 0),
        dealer: parseDigitsString(streakThresholds.dealer, 0),
        combined: parseDigitsString(streakThresholds.combined, 0),
      };
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          levels: [...levels],
          streakThresholds: parsedStreakThresholds,
          maAlerts: [...maAlerts],
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
        <h2 className="mb-3 text-sm font-semibold text-zinc-300">股價站上／低於均線時通知</h2>
        <p className="mb-2 text-xs text-zinc-500">只要條件持續成立，每個交易日都會再通知一次，不是只有剛穿越的那一天。</p>
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
                <span className="text-sm">低於</span>
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
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={streakThresholds[category]}
                onChange={(e) => updateStreakThreshold(category, e.target.value)}
                onBlur={() => blurStreakThreshold(category)}
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
