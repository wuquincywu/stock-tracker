import { NextRequest, NextResponse } from "next/server";
import { EMPTY_ALERT_SUMMARY, processUserAlerts, type UserAlertSummary } from "@/lib/alerts";
import { getMaLines, getRegisteredUsers } from "@/lib/redis";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [users, maLines] = await Promise.all([getRegisteredUsers(), getMaLines()]);

  // Sequential, not parallel — each user's checkOne loop already hits TWSE/FinMind per tracked
  // stock, and running every user's batch at once would multiply that concurrent external load
  // (this app has already hit TWSE's WAF from bursty traffic before; see lib/httpFetch.ts).
  const perUser: Record<string, UserAlertSummary> = {};
  for (const userId of users) {
    try {
      perUser[userId] = await processUserAlerts(userId, maLines);
    } catch (err) {
      console.error(`[check-alerts] failed for user ${userId}:`, err);
      perUser[userId] = EMPTY_ALERT_SUMMARY;
    }
  }

  const totals = Object.values(perUser).reduce<UserAlertSummary>(
    (acc, r) => ({
      checked: acc.checked + r.checked,
      crosses: acc.crosses + r.crosses,
      levelAlerts: acc.levelAlerts + r.levelAlerts,
      streakAlerts: acc.streakAlerts + r.streakAlerts,
      sent: acc.sent + r.sent,
      pruned: acc.pruned + r.pruned,
      failed: acc.failed + r.failed,
    }),
    { ...EMPTY_ALERT_SUMMARY },
  );

  return NextResponse.json({ users: users.length, ...totals, perUser });
}
