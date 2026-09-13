import Link from "next/link";
import { notFound } from "next/navigation";
import {
  analyzeBollinger,
  bollingerBands,
  classifyInstitutionalLevel,
  computeInstitutionalStreaks,
  latestMaSnapshot,
} from "@/lib/indicators";
import {
  CHART_CALC_BUFFER_MONTHS,
  getChartSeries,
  getInstitutionalSeries,
  getPriceSeries,
  institutionalDaysForMonths,
  lookupStock,
} from "@/lib/marketdata";
import { isInWatchlist } from "@/lib/redis";
import { getCurrentUser } from "@/lib/users";
import { MARKET_LABEL } from "@/lib/types";
import type { PriceRow } from "@/lib/types";
import { BollingerDetailBadges } from "@/components/BollingerBadges";
import { InstitutionalLevelBadge, StreakBadges } from "@/components/InstitutionalBadges";
import StockChartSection from "@/components/StockChartSection";
import BackButton from "@/components/ui/BackButton";

// The chart's own default display window — see components/StockChartSection.tsx, which lets the
// user pick a wider range interactively instead of this being driven by the global chart-months
// setting (that setting still governs the watchlist/market cards' calc window, just not this page).
const DEFAULT_DISPLAY_MONTHS = 3;

function sharesToLots(shares: number): string {
  const lots = shares / 1000;
  const sign = lots > 0 ? "+" : "";
  return `${sign}${lots.toLocaleString("zh-Hant", { maximumFractionDigits: 0 })}`;
}

function netColor(value: number): string {
  return value > 0 ? "text-red-400" : value < 0 ? "text-emerald-400" : "text-zinc-400";
}

export default async function StockDetailPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  let info: Awaited<ReturnType<typeof lookupStock>>;
  try {
    info = await lookupStock(code);
  } catch {
    return (
      <div className="mx-auto max-w-xl px-4 pb-24 pt-6">
        <BackButton />
        <p className="py-12 text-center text-sm text-zinc-500">
          資料來源暫時無法連線，請稍後再試一次。
        </p>
      </div>
    );
  }
  if (!info) notFound();

  // Per-stock notification settings only make sense for a stock this user actually tracks (see
  // app/settings/[code]/page.tsx and its API route) — untracked stocks browsed from 所有股票 just
  // don't show the shortcut, same as how they don't show a "移除" button either.
  const currentUser = await getCurrentUser();
  const tracked = currentUser ? await isInWatchlist(currentUser, code) : false;

  // Page load never live-fetches — it's always served from whatever's already stored (kept
  // current by the daily cron / backfills). The chart's own month-range buttons
  // (components/StockChartSection.tsx) are the only thing that can trigger a live fetch, and only
  // when the user explicitly asks for more than DEFAULT_DISPLAY_MONTHS.
  let prices: PriceRow[] = [];
  let bands: Awaited<ReturnType<typeof getChartSeries>>["bands"] = [];
  let institutional: Awaited<ReturnType<typeof getInstitutionalSeries>> = [];
  let badgePrices: PriceRow[] = [];
  try {
    const [chartSeries, institutionalSeries, badgeSeries] = await Promise.all([
      getChartSeries(code, info.market, DEFAULT_DISPLAY_MONTHS, false),
      getInstitutionalSeries(code, institutionalDaysForMonths(DEFAULT_DISPLAY_MONTHS)),
      // MA/Bollinger badges above the chart need enough trailing history for a correct
      // latest-day read (MA60 needs 60 trading days) regardless of the chart's own display range.
      getPriceSeries(code, DEFAULT_DISPLAY_MONTHS + CHART_CALC_BUFFER_MONTHS),
    ]);
    prices = chartSeries.prices;
    bands = chartSeries.bands;
    institutional = institutionalSeries;
    badgePrices = badgeSeries;
  } catch {
    // fall through with empty series — the sections below already handle the empty case
  }

  const badgeBands = bollingerBands(badgePrices);
  const bollingerSignal = analyzeBollinger(badgePrices, badgeBands);
  const maSnapshot = latestMaSnapshot(badgePrices, [5, 20, 60]);
  const level = classifyInstitutionalLevel(institutional);
  const streaks = computeInstitutionalStreaks(institutional);
  const recentInstitutional = [...institutional].reverse().slice(0, 10);

  const latestPrice = prices.length > 0 ? prices[prices.length - 1].close : null;
  const priceChange = prices.length > 1 ? latestPrice! - prices[prices.length - 2].close : null;
  const prevClose = prices.length > 1 ? prices[prices.length - 2].close : null;
  const priceChangePct = priceChange !== null && prevClose ? (priceChange / prevClose) * 100 : null;

  const latestPriceDate = prices.length > 0 ? prices[prices.length - 1].date : null;
  const latestInstitutionalDate = institutional.length > 0 ? institutional[institutional.length - 1].date : null;
  const latestDataDate =
    latestPriceDate && latestInstitutionalDate
      ? latestPriceDate > latestInstitutionalDate
        ? latestPriceDate
        : latestInstitutionalDate
      : (latestPriceDate ?? latestInstitutionalDate);

  return (
    <div className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <BackButton />
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            {code} {info.name}
          </h1>
          <p className="text-xs text-zinc-500">
            {MARKET_LABEL[info.market]}
            {latestDataDate && <span className="ml-2 text-zinc-600">資料更新至 {latestDataDate}</span>}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          {tracked && (
            <Link href={`/settings/${code}`} className="text-xs text-zinc-500 hover:text-zinc-100">
              個股通知設定
            </Link>
          )}
          {latestPrice !== null && (
            <div className="flex flex-col items-end leading-none">
              <span
                className={`text-4xl font-bold tabular-nums ${
                  priceChange === null || priceChange === 0
                    ? "text-zinc-100"
                    : priceChange > 0
                      ? "text-red-400"
                      : "text-emerald-400"
                }`}
              >
                {latestPrice.toFixed(2)}
              </span>
              {priceChange !== null && priceChangePct !== null && (
                <span
                  className={`mt-1.5 text-sm font-medium tabular-nums ${
                    priceChange === 0
                      ? "text-zinc-500"
                      : priceChange > 0
                        ? "text-red-400"
                        : "text-emerald-400"
                  }`}
                >
                  {priceChange > 0 ? "+" : ""}
                  {priceChange.toFixed(2)} ({priceChange > 0 ? "+" : ""}
                  {priceChangePct.toFixed(2)}%)
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {(level || Object.values(streaks).some((s) => s && s.length >= 2)) && (
        <div className="mb-3 flex flex-wrap gap-2">
          {level && <InstitutionalLevelBadge level={level} />}
          <StreakBadges streaks={streaks} />
        </div>
      )}

      {maSnapshot.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          {maSnapshot.map((s) => (
            <span
              key={s.ma}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                s.above ? "bg-red-500/15 text-red-300" : "bg-emerald-500/15 text-emerald-300"
              }`}
            >
              {s.above ? "站上" : "低於"}MA{s.ma}
            </span>
          ))}
        </div>
      )}

      {bollingerSignal.percentB !== null && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <BollingerDetailBadges signal={bollingerSignal} />
        </div>
      )}

      <StockChartSection code={code} initialPrices={prices} initialBands={bands} institutional={institutional} />

      <h2 className="mb-2 mt-6 text-sm font-semibold text-zinc-300">三大法人買賣超（近 10 日，單位：張）</h2>
      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-right text-xs">
          <thead>
            <tr className="border-b border-zinc-800 text-zinc-500">
              <th className="px-2 py-2 text-left font-normal">日期</th>
              <th className="px-2 py-2 font-normal">外資</th>
              <th className="px-2 py-2 font-normal">投信</th>
              <th className="px-2 py-2 font-normal">自營商</th>
              <th className="px-2 py-2 font-normal">合計</th>
            </tr>
          </thead>
          <tbody>
            {recentInstitutional.map((row) => {
              const net = row.foreignNet + row.investmentTrustNet + row.dealerNet;
              return (
                <tr key={row.date} className="border-b border-zinc-900 last:border-0">
                  <td className="px-2 py-1.5 text-left text-zinc-400">{row.date}</td>
                  <td className={`px-2 py-1.5 tabular-nums ${netColor(row.foreignNet)}`}>
                    {sharesToLots(row.foreignNet)}
                  </td>
                  <td className={`px-2 py-1.5 tabular-nums ${netColor(row.investmentTrustNet)}`}>
                    {sharesToLots(row.investmentTrustNet)}
                  </td>
                  <td className={`px-2 py-1.5 tabular-nums ${netColor(row.dealerNet)}`}>
                    {sharesToLots(row.dealerNet)}
                  </td>
                  <td className={`px-2 py-1.5 font-medium tabular-nums ${netColor(net)}`}>{sharesToLots(net)}</td>
                </tr>
              );
            })}
            {recentInstitutional.length === 0 && (
              <tr>
                <td colSpan={5} className="px-2 py-6 text-center text-zinc-600">
                  暫無資料
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
