"use client";

import { useState } from "react";
import {
  INSTITUTIONAL_CATEGORY_LABEL,
  INSTITUTIONAL_CATEGORY_ORDER,
  INSTITUTIONAL_LEVEL_LABEL,
  INSTITUTIONAL_LEVEL_ORDER,
  MA_LINE_ORDER,
} from "@/lib/types";
import type { AlertConfig, InstitutionalCategory, InstitutionalLevel, MaAlertKey } from "@/lib/types";

/** Digits-only text state for a numeric field, so it can briefly be empty while the user is
 * clearing it to type a new value — a controlled <input type="number"> that eagerly coerces every
 * keystroke (e.g. Number("") -> 0) snaps back to "0" the instant the field is cleared, and then new
 * digits land *after* that stuck 0 (typing "71" produces "071") instead of replacing it. */
export function toDigitsString(n: number): string {
  return String(Math.max(0, Math.floor(n)));
}

export function parseDigitsString(raw: string, fallback: number): number {
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? Math.max(0, n) : fallback;
}

function streakThresholdsToStrings(t: Record<InstitutionalCategory, number>): Record<InstitutionalCategory, string> {
  return { foreign: toDigitsString(t.foreign), trust: toDigitsString(t.trust), dealer: toDigitsString(t.dealer), combined: toDigitsString(t.combined) };
}

/**
 * State + handlers for the three alert-config sections, shared by the account-wide Settings page
 * and the per-stock notification-settings page so the same "toggle a checkbox / edit a threshold"
 * logic isn't duplicated between them. `onDirty` fires on every change (both callers use it to
 * clear their own "已儲存" indicator) — `reset` re-populates every field from a new config, used
 * when reverting a stock to the shared settings after clearing its override.
 */
export function useAlertConfigState(initialConfig: AlertConfig, onDirty?: () => void) {
  const [levels, setLevels] = useState<Set<InstitutionalLevel>>(new Set(initialConfig.levels));
  const [streakThresholds, setStreakThresholds] = useState<Record<InstitutionalCategory, string>>(() =>
    streakThresholdsToStrings(initialConfig.streakThresholds),
  );
  const [maAlerts, setMaAlerts] = useState<Set<MaAlertKey>>(new Set(initialConfig.maAlerts));

  function toggleLevel(level: InstitutionalLevel) {
    onDirty?.();
    setLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }

  function toggleMaAlert(key: MaAlertKey) {
    onDirty?.();
    setMaAlerts((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function updateStreakThreshold(category: InstitutionalCategory, raw: string) {
    if (raw !== "" && !/^[0-9]+$/.test(raw)) return; // reject anything but digits (and empty, while editing)
    onDirty?.();
    setStreakThresholds((prev) => ({ ...prev, [category]: raw }));
  }

  function blurStreakThreshold(category: InstitutionalCategory) {
    setStreakThresholds((prev) => ({ ...prev, [category]: toDigitsString(parseDigitsString(prev[category], 0)) }));
  }

  /** Re-populates every field from `config` — e.g. after "恢復共同設定" clears this stock's
   * override, the form should reflect the shared settings it now falls back to. */
  function reset(config: AlertConfig) {
    setLevels(new Set(config.levels));
    setStreakThresholds(streakThresholdsToStrings(config.streakThresholds));
    setMaAlerts(new Set(config.maAlerts));
  }

  function getConfig(): AlertConfig {
    return {
      levels: [...levels],
      streakThresholds: {
        foreign: parseDigitsString(streakThresholds.foreign, 0),
        trust: parseDigitsString(streakThresholds.trust, 0),
        dealer: parseDigitsString(streakThresholds.dealer, 0),
        combined: parseDigitsString(streakThresholds.combined, 0),
      },
      maAlerts: [...maAlerts],
    };
  }

  return {
    levels,
    toggleLevel,
    maAlerts,
    toggleMaAlert,
    streakThresholds,
    updateStreakThreshold,
    blurStreakThreshold,
    reset,
    getConfig,
  };
}

/**
 * 法人分級／均線提醒／連續買賣門檻 — the three alert-config sections shared by the account-wide
 * Settings page (components/SettingsClient.tsx) and the per-stock notification-settings page
 * (components/StockAlertConfigClient.tsx). Deliberately excludes chart-months and the test-
 * notification button, which aren't alert-config fields and don't make sense per-stock. Fully
 * controlled — the two callers each own their own useState and pass handlers down, so this stays a
 * plain presentational component with no save/API logic of its own.
 */
export function AlertConfigFields({
  levels,
  onToggleLevel,
  maAlerts,
  onToggleMaAlert,
  streakThresholds,
  onStreakThresholdChange,
  onStreakThresholdBlur,
}: {
  levels: Set<InstitutionalLevel>;
  onToggleLevel: (level: InstitutionalLevel) => void;
  maAlerts: Set<MaAlertKey>;
  onToggleMaAlert: (key: MaAlertKey) => void;
  streakThresholds: Record<InstitutionalCategory, string>;
  onStreakThresholdChange: (category: InstitutionalCategory, raw: string) => void;
  onStreakThresholdBlur: (category: InstitutionalCategory) => void;
}) {
  return (
    <>
      <section>
        <h2 className="mb-3 text-sm font-semibold text-zinc-300">法人買賣超分級時通知</h2>
        <div className="flex flex-col gap-2">
          {INSTITUTIONAL_LEVEL_ORDER.map((level) => (
            <label
              key={level}
              className="flex cursor-pointer items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3"
            >
              <input
                type="checkbox"
                checked={levels.has(level)}
                onChange={() => onToggleLevel(level)}
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
                  onChange={() => onToggleMaAlert(`${ma}:up`)}
                  className="h-4 w-4 accent-emerald-500"
                />
                <span className="text-sm">站上</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={maAlerts.has(`${ma}:down`)}
                  onChange={() => onToggleMaAlert(`${ma}:down`)}
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
                onChange={(e) => onStreakThresholdChange(category, e.target.value)}
                onBlur={() => onStreakThresholdBlur(category)}
                className="w-20 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm outline-none focus:border-emerald-500"
              />
              <span className="text-sm text-zinc-400">天</span>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
