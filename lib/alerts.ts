import { taipeiDateString } from "./date";
import { classifyInstitutionalLevel, computeInstitutionalStreaks, latestMaSnapshot } from "./indicators";
import { refreshInstitutionalSeries, refreshPriceSeries } from "./marketdata";
import { broadcastPush } from "./push";
import {
  getAlertConfig,
  getChartMonths,
  getWatchlist,
  markAlerted,
  markLevelAlerted,
  markStreakAlerted,
  setDailyNotifications,
  wasAlreadyAlerted,
  wasLevelAlerted,
  wasStreakAlerted,
} from "./redis";
import { INSTITUTIONAL_CATEGORY_LABEL, INSTITUTIONAL_CATEGORY_ORDER, INSTITUTIONAL_LEVEL_LABEL } from "./types";
import type { CrossDirection, InstitutionalStreakSet, MaAlertKey, MaLine, MaSnapshot, WatchlistEntry } from "./types";

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
  priceDate: string | null;
  maSnapshot: MaSnapshot[];
  institutionalDate: string | null;
  level: ReturnType<typeof classifyInstitutionalLevel>;
  streaks: InstitutionalStreakSet;
}

const EMPTY_STREAKS: InstitutionalStreakSet = { foreign: null, trust: null, dealer: null, combined: null };

async function checkOne(entry: WatchlistEntry, maLines: number[], chartMonths: number): Promise<StockCheckResult> {
  const empty: StockCheckResult = {
    code: entry.code,
    priceDate: null,
    maSnapshot: [],
    institutionalDate: null,
    level: null,
    streaks: EMPTY_STREAKS,
  };
  try {
    const [prices, institutional] = await Promise.all([
      refreshPriceSeries(entry.code, entry.market, chartMonths),
      refreshInstitutionalSeries(entry.code, INSTITUTIONAL_HISTORY_DAYS),
    ]);

    const priceDate = prices.length > 0 ? prices[prices.length - 1].date : null;
    const maSnapshot = latestMaSnapshot(prices, maLines as MaLine[]);
    const institutionalDate = institutional.length > 0 ? institutional[institutional.length - 1].date : null;
    const level = classifyInstitutionalLevel(institutional);
    const streaks = computeInstitutionalStreaks(institutional);

    return { code: entry.code, priceDate, maSnapshot, institutionalDate, level, streaks };
  } catch {
    return empty;
  }
}

const MA_LABEL: Record<number, string> = { 5: "MA5", 20: "MA20", 60: "MA60" };

export interface UserAlertSummary {
  checked: number;
  crosses: number;
  levelAlerts: number;
  streakAlerts: number;
  sent: number;
  pruned: number;
  failed: number;
}

export const EMPTY_ALERT_SUMMARY: UserAlertSummary = {
  checked: 0,
  crosses: 0,
  levelAlerts: 0,
  streakAlerts: 0,
  sent: 0,
  pruned: 0,
  failed: 0,
};

/**
 * Runs the full check → notify pipeline for one user's watchlist: live-refreshes each tracked
 * stock's price/institutional data, evaluates it against this user's own alert thresholds, and —
 * if anything newly qualifies — writes today's notification record and sends one bundled push.
 * Used by both the daily cron (app/api/cron/check-alerts/route.ts, looped over every registered
 * user) and the Settings page's on-demand "測試通知" button (app/api/notifications/test/route.ts,
 * for just the current user). `maLines` is shared app-wide config (not user-configurable);
 * everything else here (watchlist, alert thresholds, chart-months, dedup, notification history,
 * push subscriptions) is this user's own.
 */
export async function processUserAlerts(userId: string, maLines: number[]): Promise<UserAlertSummary> {
  const [watchlist, alertConfig, chartMonths] = await Promise.all([
    getWatchlist(userId),
    getAlertConfig(userId),
    getChartMonths(userId),
  ]);
  if (watchlist.length === 0) return EMPTY_ALERT_SUMMARY;

  const results = await chunkedMap(watchlist, BATCH_SIZE, (entry) => checkOne(entry, maLines, chartMonths));

  // Build each stock's notification message parts, applying per-alert-type dedup checks along the
  // way — but the actual dedup *mark* is deferred until after that stock's push has gone out (see
  // the loop below). Marking dedup up front and pushing after meant a crash/timeout between the
  // two left the dedup key permanently set with no notification ever sent for that event — and
  // since dedup is keyed by date, that day's occurrence would never be retried once the date moves
  // on. Deferring the mark means a failed push simply gets retried on the next run (cron, or a
  // manual re-run via the test button) instead of being silently and permanently swallowed.
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
    // MA alerts fire on current state (站上/低於), not just the crossing moment — re-evaluated
    // every run, so as long as the condition still holds on a new trading day (a new priceDate),
    // it fires again, the same way the level/streak checks below already behave. The per-day dedup
    // key still blocks re-firing twice for the *same* priceDate.
    if (result.priceDate) {
      const priceDate = result.priceDate;
      for (const snap of result.maSnapshot) {
        const direction: CrossDirection = snap.above ? "up" : "down";
        const alertKey: MaAlertKey = `${snap.ma}:${direction}`;
        if (!alertConfig.maAlerts.includes(alertKey)) continue;

        const already = await wasAlreadyAlerted(userId, result.code, snap.ma, direction, priceDate);
        if (already) continue;
        appendMessage(result.code, `${direction === "up" ? "站上" : "低於"} ${MA_LABEL[snap.ma]}`, () =>
          markAlerted(userId, result.code, snap.ma, direction, priceDate),
        );
        crossCount++;
      }
    }

    if (!result.institutionalDate) continue;
    const todayDate = result.institutionalDate;

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
      console.error(`[processUserAlerts] combined push failed for user ${userId}, leaving dedup unmarked for retry:`, err);
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
