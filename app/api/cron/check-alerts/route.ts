import { NextRequest, NextResponse } from "next/server";
import { EMPTY_ALERT_SUMMARY, processUserAlerts, type UserAlertSummary } from "@/lib/alerts";
import { getMaLines, getRegisteredUsers, setCronStatus } from "@/lib/redis";

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

  // Records whether today's run actually happened and whether it worked — previously nothing did,
  // so a run silently failing for days (TWSE WAF, FinMind quota, a 60s timeout) had no visible
  // symptom beyond stale prices. Shown on the Settings page. Wraps the whole handler, not just the
  // per-user loop below (which already has its own per-user try/catch, unaffected by this).
  try {
    const [users, maLines] = await Promise.all([getRegisteredUsers(), getMaLines()]);

    // One Set shared across every user's call this run: small trusted groups tend to have
    // overlapping watchlists (everyone tracking 2330), and without this, a stock tracked by N users
    // would get live-fetched from TWSE/FinMind N times in a single cron run instead of once — the
    // first user to touch a code live-refreshes it, every later user this run reads it back
    // read-only. See processUserAlerts's doc comment in lib/alerts.ts.
    const refreshedCodes = new Set<string>();

    // Sequential, not parallel — each user's checkOne loop already hits TWSE/FinMind per tracked
    // stock, and running every user's batch at once would multiply that concurrent external load
    // (this app has already hit TWSE's WAF from bursty traffic before; see lib/httpFetch.ts). It's
    // also what makes the shared `refreshedCodes` set above safe to use without a lock: one user's
    // batch always fully finishes before the next one starts.
    const perUser: Record<string, UserAlertSummary> = {};
    for (const userId of users) {
      try {
        perUser[userId] = await processUserAlerts(userId, maLines, refreshedCodes);
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

    await setCronStatus({
      at: new Date().toISOString(),
      ok: true,
      summary: { users: users.length, checked: totals.checked, sent: totals.sent, failed: totals.failed },
    }).catch((err) => console.error("[check-alerts] failed to record cron status:", err));

    return NextResponse.json({ users: users.length, ...totals, perUser });
  } catch (err) {
    console.error("[check-alerts] run failed:", err);
    await setCronStatus({
      at: new Date().toISOString(),
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }).catch((statusErr) => console.error("[check-alerts] failed to record cron status:", statusErr));
    return NextResponse.json({ error: "cron run failed" }, { status: 500 });
  }
}
