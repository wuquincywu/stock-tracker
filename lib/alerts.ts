import { taipeiDateString } from "./date";
import { classifyInstitutionalLevel, computeInstitutionalStreaks, latestMaSnapshot } from "./indicators";
import { refreshInstitutionalSeries, refreshPriceSeries } from "./marketdata";
import { broadcastPush } from "./push";
import { getAlertConfig, getChartMonths, getWatchlist, setDailyNotifications } from "./redis";
import { INSTITUTIONAL_CATEGORY_LABEL, INSTITUTIONAL_CATEGORY_ORDER, INSTITUTIONAL_LEVEL_LABEL } from "./types";
import type {
  CrossDirection,
  InstitutionalStreakSet,
  MaAlertKey,
  MaLine,
  MaSnapshot,
  NotificationPart,
  WatchlistEntry,
} from "./types";

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
  /** Yesterday's snapshot (same MA lines, one day less of price history) — compared against
   * `maSnapshot` to tell a genuine crossing moment (side flipped) from just persisting on the same
   * side as before. */
  prevMaSnapshot: MaSnapshot[];
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
    prevMaSnapshot: [],
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
    const prevMaSnapshot = prices.length > 1 ? latestMaSnapshot(prices.slice(0, -1), maLines as MaLine[]) : [];
    const institutionalDate = institutional.length > 0 ? institutional[institutional.length - 1].date : null;
    const level = classifyInstitutionalLevel(institutional);
    const streaks = computeInstitutionalStreaks(institutional);

    return { code: entry.code, priceDate, maSnapshot, prevMaSnapshot, institutionalDate, level, streaks };
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
 * if anything currently qualifies — writes today's notification record and sends one bundled
 * push. Used by both the daily cron (app/api/cron/check-alerts/route.ts, looped over every
 * registered user) and the Settings page's on-demand "測試通知" button
 * (app/api/notifications/test/route.ts, for just the current user).
 *
 * No dedup: every call re-evaluates current truth and notifies about everything that qualifies
 * right now, even if an identical condition was already reported earlier the same day — the daily
 * cron only runs once a day anyway, and the whole point of the test button is to show current
 * state on demand, every time it's pressed, not to be silently suppressed by an earlier check.
 *
 * `maLines` is shared app-wide config (not user-configurable); everything else here (watchlist,
 * alert thresholds, chart-months, notification history, push subscriptions) is this user's own.
 */
export async function processUserAlerts(userId: string, maLines: number[]): Promise<UserAlertSummary> {
  const [watchlist, alertConfig, chartMonths] = await Promise.all([
    getWatchlist(userId),
    getAlertConfig(userId),
    getChartMonths(userId),
  ]);
  if (watchlist.length === 0) return EMPTY_ALERT_SUMMARY;

  const results = await chunkedMap(watchlist, BATCH_SIZE, (entry) => checkOne(entry, maLines, chartMonths));

  const messagesByCode = new Map<string, NotificationPart[]>();
  let crossCount = 0;
  let levelAlertCount = 0;
  let streakAlertCount = 0;

  function appendMessage(code: string, text: string, isCrossMoment = false) {
    const parts = messagesByCode.get(code) ?? [];
    parts.push({ text, isCrossMoment });
    messagesByCode.set(code, parts);
  }

  for (const result of results) {
    // MA alerts fire on current state (站上/低於), not just the crossing moment — comparing
    // against yesterday's snapshot (prevMaSnapshot) tells a genuine crossing moment (side flipped)
    // from just persisting on the same side, surfaced as `isCrossMoment` for the 通知 page's
    // outline, but both cases notify.
    if (result.priceDate) {
      for (const snap of result.maSnapshot) {
        const direction: CrossDirection = snap.above ? "up" : "down";
        const alertKey: MaAlertKey = `${snap.ma}:${direction}`;
        if (!alertConfig.maAlerts.includes(alertKey)) continue;

        const prevSnap = result.prevMaSnapshot.find((p) => p.ma === snap.ma);
        const isCrossMoment = prevSnap ? prevSnap.above !== snap.above : false;

        appendMessage(result.code, `${direction === "up" ? "站上" : "低於"} ${MA_LABEL[snap.ma]}`, isCrossMoment);
        crossCount++;
      }
    }

    if (!result.institutionalDate) continue;

    if (result.level && alertConfig.levels.includes(result.level)) {
      appendMessage(result.code, `法人${INSTITUTIONAL_LEVEL_LABEL[result.level]}`);
      levelAlertCount++;
    }

    for (const category of INSTITUTIONAL_CATEGORY_ORDER) {
      const threshold = alertConfig.streakThresholds[category];
      const streak = result.streaks[category];
      if (threshold <= 0 || !streak || streak.length < threshold) continue;

      appendMessage(
        result.code,
        `${INSTITUTIONAL_CATEGORY_LABEL[category]}連${streak.length}${streak.direction === "buy" ? "買" : "賣"}`,
      );
      streakAlertCount++;
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
    } catch (err) {
      console.error(`[processUserAlerts] combined push failed for user ${userId}:`, err);
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
