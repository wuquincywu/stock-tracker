import { NextRequest, NextResponse } from "next/server";
import { classifyInstitutionalLevel, computeInstitutionalStreaks, detectCrosses } from "@/lib/indicators";
import { refreshInstitutionalSeries, refreshPriceSeries } from "@/lib/marketdata";
import { broadcastPush } from "@/lib/push";
import {
  getAlertConfig,
  getChartMonths,
  getMaLines,
  getWatchlist,
  markAlerted,
  markLevelAlerted,
  markStreakAlerted,
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

export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [watchlist, maLines, alertConfig, chartMonths] = await Promise.all([
    getWatchlist(),
    getMaLines(),
    getAlertConfig(),
    getChartMonths(),
  ]);
  if (watchlist.length === 0) {
    return NextResponse.json({ checked: 0, crosses: 0, levelAlerts: 0, streakAlerts: 0, sent: 0, pruned: 0 });
  }

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

      const already = await wasAlreadyAlerted(event.code, event.ma, event.direction, event.date);
      if (already) continue;
      appendMessage(event.code, `${event.direction === "up" ? "站上" : "跌破"} ${MA_LABEL[event.ma]}`, () =>
        markAlerted(event.code, event.ma, event.direction, event.date),
      );
      crossCount++;
    }

    if (!result.todayDate) continue;
    const todayDate = result.todayDate;

    if (result.level && alertConfig.levels.includes(result.level)) {
      const level = result.level;
      const already = await wasLevelAlerted(result.code, level, todayDate);
      if (!already) {
        appendMessage(result.code, `法人${INSTITUTIONAL_LEVEL_LABEL[level]}`, () =>
          markLevelAlerted(result.code, level, todayDate),
        );
        levelAlertCount++;
      }
    }

    for (const category of INSTITUTIONAL_CATEGORY_ORDER) {
      const threshold = alertConfig.streakThresholds[category];
      const streak = result.streaks[category];
      if (threshold <= 0 || !streak || streak.length < threshold) continue;

      const already = await wasStreakAlerted(result.code, category, streak.direction, todayDate);
      if (!already) {
        appendMessage(
          result.code,
          `${INSTITUTIONAL_CATEGORY_LABEL[category]}連${streak.length}${streak.direction === "buy" ? "買" : "賣"}`,
          () => markStreakAlerted(result.code, category, streak.direction, todayDate),
        );
        streakAlertCount++;
      }
    }
  }

  const nameByCode = new Map(watchlist.map((w) => [w.code, w.name]));
  let sent = 0;
  let pruned = 0;
  let failed = 0;

  for (const [code, parts] of messagesByCode) {
    const name = nameByCode.get(code) ?? code;
    try {
      const result = await broadcastPush({
        title: `${code} ${name}`,
        body: parts.join("、"),
        url: `/stock/${code}`,
      });
      sent += result.sent;
      pruned += result.pruned;
      failed += result.failed;

      const marks = pendingMarksByCode.get(code) ?? [];
      await Promise.all(marks.map((mark) => mark()));
    } catch (err) {
      console.error(`[check-alerts] push failed for ${code}, leaving dedup unmarked for retry:`, err);
    }
  }

  return NextResponse.json({
    checked: watchlist.length,
    crosses: crossCount,
    levelAlerts: levelAlertCount,
    streakAlerts: streakAlertCount,
    sent,
    pruned,
    failed,
  });
}
