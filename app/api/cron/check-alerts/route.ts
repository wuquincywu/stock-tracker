import { NextRequest, NextResponse } from "next/server";
import { taipeiDateString } from "@/lib/date";
import { classifyInstitutionalLevel, computeInstitutionalStreaks, detectCrosses } from "@/lib/indicators";
import { refreshInstitutionalSeries, refreshPriceSeries } from "@/lib/marketdata";
import { broadcastPush } from "@/lib/push";
import {
  getAlertConfig,
  getChartMonths,
  getMaLines,
  getRegisteredUsers,
  getWatchlist,
  markAlerted,
  markLevelAlerted,
  markStreakAlerted,
  setDailyNotifications,
  wasAlreadyAlerted,
  wasLevelAlerted,
  wasStreakAlerted,
} from "@/lib/redis";
import { INSTITUTIONAL_CATEGORY_LABEL, INSTITUTIONAL_CATEGORY_ORDER, INSTITUTIONAL_LEVEL_LABEL } from "@/lib/types";
import type { CrossEvent, InstitutionalStreakSet, MaAlertKey, WatchlistEntry } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const INSTITUTIONAL_HISTORY_DAYS = 40; // enough trading rows for a meaningful level baseline (min 20)
const BATCH_SIZE = 5;

async function chunkedMap<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    results.push(...(await Promise.all(batch.map(fn))));
  }
  return results;
}

interface StockCheckResult {
  code: string;
  crosses: CrossEvent[];
  todayDate: string | null;
  level: ReturnType<typeof classifyInstitutionalLevel>;
  streaks: InstitutionalStreakSet;
}

const EMPTY_STREAKS: InstitutionalStreakSet = { foreign: null, trust: null, dealer: null, combined: null };

async function checkOne(entry: WatchlistEntry, maLines: number[], chartMonths: number): Promise<StockCheckResult> {
  const empty: StockCheckResult = { code: entry.code, crosses: [], todayDate: null, level: null, streaks: EMPTY_STREAKS };
  try {
    const [prices, institutional] = await Promise.all([
      refreshPriceSeries(entry.code, entry.market, chartMonths),
      refreshInstitutionalSeries(entry.code, INSTITUTIONAL_HISTORY_DAYS),
    ]);

    const crosses = prices.length >= 2 ? detectCrosses(entry.code, prices, maLines as (5 | 20 | 60)[]) : [];
    const todayDate = institutional.length > 0 ? institutional[institutional.length - 1].date : null;
    const level = classifyInstitutionalLevel(institutional);
    const streaks = computeInstitutionalStreaks(institutional);

    return { code: entry.code, crosses, todayDate, level, streaks };
  } catch {
    return empty;
  }
}

const MA_LABEL: Record<number, string> = { 5: "MA5", 20: "MA20", 60: "MA60" };

interface UserAlertSummary {
  checked: number;
  crosses: number;
  levelAlerts: number;
  streakAlerts: number;
  sent: number;
  pruned: number;
  failed: number;
}

const EMPTY_SUMMARY: UserAlertSummary = {
  checked: 0,
  crosses: 0,
  levelAlerts: 0,
  streakAlerts: 0,
  sent: 0,
  pruned: 0,
  failed: 0,
};

/** Runs the full check → notify pipeline for one user's watchlist. `maLines` is shared app-wide
 * config (not user-configurable); everything else here (watchlist, alert thresholds, chart-months,
 * dedup, notification history, push subscriptions) is this user's own. */
async function processUserAlerts(userId: string, maLines: number[]): Promise<UserAlertSummary> {
  const [watchlist, alertConfig, chartMonths] = await Promise.all([
    getWatchlist(userId),
    getAlertConfig(userId),
    getChartMonths(userId),
  ]);
  if (watchlist.length === 0) return EMPTY_SUMMARY;

  const results = await chunkedMap(watchlist, BATCH_SIZE, (entry) => checkOne(entry, maLines, chartMonths));

  // Build each stock's notification message parts, applying per-alert-type dedup checks along the
  // way — but the actual dedup *mark* is deferred until after that stock's push has gone out (see
  // the loop below). Marking dedup up front and pushing after meant a crash/timeout between the
  // two left the dedup key permanently set with no notification ever sent for that event, since
  // MA-cross events don't repeat on a later day. Deferring the mark means a failed push simply
  // gets retried on the next cron run (or a manual re-run of the same day) instead of being
  // silently and permanently swallowed.
  const messagesByCode = new Map<string, string[]>();
  const pendingMarksByCode = new Map<string, Array<() => Promise<void>>>();
  let crossCount = 0;
  let levelAlertCount = 0;
  let streakAlertCount = 0;

  function appendMessage(code: string, text: string, mark: () => Promise<void>) {
    const messages = messagesByCode.get(code) ?? [];
    messages.push(text);
    messagesByCode.set(code, messages);

    const marks = pendingMarksByCode.get(code) ?? [];
    marks.push(mark);
    pendingMarksByCode.set(code, marks);
  }

  for (const result of results) {
    for (const event of result.crosses) {
      const alertKey: MaAlertKey = `${event.ma}:${event.direction}`;
      if (!alertConfig.maAlerts.includes(alertKey)) continue;

      const already = await wasAlreadyAlerted(userId, event.code, event.ma, event.direction, event.date);
      if (already) continue;
      appendMessage(event.code, `${event.direction === "up" ? "站上" : "跌破"} ${MA_LABEL[event.ma]}`, () =>
        markAlerted(userId, event.code, event.ma, event.direction, event.date),
      );
      crossCount++;
    }

    if (!result.todayDate) continue;
    const todayDate = result.todayDate;

    if (result.level && alertConfig.levels.includes(result.level)) {
      const level = result.level;
      const already = await wasLevelAlerted(userId, result.code, level, todayDate);
      if (!already) {
        appendMessage(result.code, `法人${INSTITUTIONAL_LEVEL_LABEL[level]}`, () =>
          markLevelAlerted(userId, result.code, level, todayDate),
        );
        levelAlertCount++;
      }
    }

    for (const category of INSTITUTIONAL_CATEGORY_ORDER) {
      const threshold = alertConfig.streakThresholds[category];
      const streak = result.streaks[category];
      if (threshold <= 0 || !streak || streak.length < threshold) continue;

      const already = await wasStreakAlerted(userId, result.code, category, streak.direction, todayDate);
      if (!already) {
        appendMessage(
          result.code,
          `${INSTITUTIONAL_CATEGORY_LABEL[category]}連${streak.length}${streak.direction === "buy" ? "買" : "賣"}`,
          () => markStreakAlerted(userId, result.code, category, streak.direction, todayDate),
        );
        streakAlertCount++;
      }
    }
  }

  const nameByCode = new Map(watchlist.map((w) => [w.code, w.name]));
  let sent = 0;
  let pruned = 0;
  let failed = 0;

  // The push itself is just a lightweight "you have alerts today" nudge — the actual per-stock
  // detail (one entry per stock, e.g. "2330 台積電" / "站上 MA20、法人大買、外資連5買") is written
  // to Redis for the in-app 通知 page instead, so it's visible even if the push never arrives
  // (permission not granted, browser/app closed, etc), not just squeezed into a notification body.
  if (messagesByCode.size > 0) {
    const items = [...messagesByCode.entries()].map(([code, parts]) => ({
      code,
      name: nameByCode.get(code) ?? code,
      parts,
    }));
    const today = taipeiDateString();
    await setDailyNotifications(userId, today, items);

    try {
      const result = await broadcastPush(userId, {
        title: "股票追蹤",
        body: `今天有 ${items.length} 檔股票觸發提醒，點擊查看詳情`,
        url: "/notifications",
      });
      sent = result.sent;
      pruned = result.pruned;
      failed = result.failed;

      const allMarks = [...pendingMarksByCode.values()].flat();
      await Promise.all(allMarks.map((mark) => mark()));
    } catch (err) {
      console.error(`[check-alerts] combined push failed for user ${userId}, leaving dedup unmarked for retry:`, err);
    }
  }

  return {
    checked: watchlist.length,
    crosses: crossCount,
    levelAlerts: levelAlertCount,
    streakAlerts: streakAlertCount,
    sent,
    pruned,
    failed,
  };
}

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
      perUser[userId] = EMPTY_SUMMARY;
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
    { ...EMPTY_SUMMARY },
  );

  return NextResponse.json({ users: users.length, ...totals, perUser });
}
