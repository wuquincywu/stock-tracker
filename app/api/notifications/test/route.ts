import { NextResponse } from "next/server";
import { processUserAlerts } from "@/lib/alerts";
import { broadcastPush } from "@/lib/push";
import { getMaLines } from "@/lib/redis";
import { getCurrentUser } from "@/lib/users";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * On-demand "測試通知" button on the Settings page: runs the exact same check → notify pipeline as
 * the daily cron (lib/alerts.ts), but immediately and for just the current user. If something
 * genuinely qualifies, that real alert gets pushed as usual. If nothing does (the common case —
 * most days won't have a fresh cross/level/streak to report), a distinct confirmation push is sent
 * instead so tapping the button always produces a visible result, confirming the whole pipeline
 * (data refresh → push delivery) actually works rather than looking like it did nothing.
 */
export async function POST() {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const maLines = await getMaLines();
  const summary = await processUserAlerts(currentUser, maLines);

  const hasRealAlert = summary.crosses + summary.levelAlerts + summary.streakAlerts > 0;
  if (hasRealAlert) {
    return NextResponse.json({ ...summary, testPushSent: false });
  }

  const result = await broadcastPush(currentUser, {
    title: "股票追蹤",
    body: "測試推播：資料已更新，目前沒有觸發任何提醒",
    url: "/notifications",
  });
  return NextResponse.json({
    ...summary,
    testPushSent: true,
    sent: result.sent,
    pruned: result.pruned,
    failed: result.failed,
  });
}
