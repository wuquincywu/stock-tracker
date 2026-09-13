"use client";

import { useState } from "react";
import { AlertConfigFields, useAlertConfigState } from "@/components/AlertConfigFields";
import Button from "@/components/ui/Button";
import type { AlertConfig } from "@/lib/types";

export default function StockAlertConfigClient({
  code,
  sharedConfig,
  initialOverride,
}: {
  code: string;
  sharedConfig: AlertConfig;
  initialOverride: AlertConfig | null;
}) {
  const [isOverridden, setIsOverridden] = useState(initialOverride !== null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  // Starts from the override if one exists, otherwise from the shared config — so a stock that's
  // never been customized shows exactly what it's currently actually following, not a blank form.
  const fields = useAlertConfigState(initialOverride ?? sharedConfig, () => setSaved(false));

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      await fetch(`/api/settings/stock/${code}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fields.getConfig()),
      });
      setIsOverridden(true);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  async function resetToShared() {
    setResetting(true);
    try {
      const res = await fetch(`/api/settings/stock/${code}`, { method: "DELETE" });
      const data = (await res.json()) as { config: AlertConfig };
      fields.reset(data.config);
      setIsOverridden(false);
      setSaved(false);
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <p className={`rounded-lg border px-4 py-3 text-xs ${isOverridden ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-zinc-800 bg-zinc-900/60 text-zinc-500"}`}>
        {isOverridden
          ? "這檔股票目前使用自訂的通知設定，不受共同設定變動影響。"
          : "這檔股票目前套用共同設定——以下顯示的就是共同設定的內容，修改後儲存才會變成只套用在這一檔的自訂設定。"}
      </p>

      <AlertConfigFields
        levels={fields.levels}
        onToggleLevel={fields.toggleLevel}
        maAlerts={fields.maAlerts}
        onToggleMaAlert={fields.toggleMaAlert}
        streakThresholds={fields.streakThresholds}
        onStreakThresholdChange={fields.updateStreakThreshold}
        onStreakThresholdBlur={fields.blurStreakThreshold}
      />

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving}>
          {saving ? "儲存中…" : "儲存個股設定"}
        </Button>
        {isOverridden && (
          <Button variant="ghost" onClick={resetToShared} disabled={resetting}>
            {resetting ? "還原中…" : "恢復共同設定"}
          </Button>
        )}
        {saved && <span className="text-sm text-emerald-400">已儲存</span>}
      </div>
    </div>
  );
}
