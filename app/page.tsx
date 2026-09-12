import {
  analyzeBollinger,
  bollingerBands,
  classifyInstitutionalLevel,
  computeInstitutionalStreaks,
  latestMaSnapshot,
} from "@/lib/indicators";
import { getInstitutionalSeries, getPriceSeries } from "@/lib/marketdata";
import { DEFAULT_CHART_MONTHS, getChartMonths, getMaLines, getWatchlist } from "@/lib/redis";
import type { InstitutionalRow, MaLine, WatchlistEntry } from "@/lib/types";
import WatchlistClient, { type WatchlistCardData } from "@/components/WatchlistClient";
import WatchlistTabs from "@/components/WatchlistTabs";

const INSTITUTIONAL_HISTORY_DAYS = 40; // enough trading rows for classifyInstitutionalLevel's baseline

async function buildCardData(entry: WatchlistEntry, chartMonths: number, maLines: MaLine[]): Promise<WatchlistCardData> {
  // Independent data sources — fetch in parallel so one slow/hung call doesn't add its full
  // timeout on top of the others' (they'd otherwise stack up sequentially, one card at a time).
  const [institutionalResult, priceResult] = await Promise.allSettled([
    getInstitutionalSeries(entry.code, INSTITUTIONAL_HISTORY_DAYS),
    getPriceSeries(entry.code, chartMonths),
  ]);

  let latest: InstitutionalRow | null = null;
  let level: WatchlistCardData["level"] = null;
  let streaks: WatchlistCardData["streaks"] = { foreign: null, trust: null, dealer: null, combined: null };
  if (institutionalResult.status === "fulfilled") {
    const series = institutionalResult.value;
    latest = series.length > 0 ? series[series.length - 1] : null;
    level = classifyInstitutionalLevel(series);
    streaks = computeInstitutionalStreaks(series);
  }

  let bollinger: WatchlistCardData["bollinger"] = null;
  let price: WatchlistCardData["price"] = null;
  let change: WatchlistCardData["change"] = null;
  let changePct: WatchlistCardData["changePct"] = null;
  let maSnapshot: WatchlistCardData["maSnapshot"] = [];
  if (priceResult.status === "fulfilled") {
    const series = priceResult.value;
    bollinger = analyzeBollinger(series, bollingerBands(series));
    maSnapshot = latestMaSnapshot(series, maLines);
    if (series.length > 0) {
      price = series[series.length - 1].close;
      if (series.length > 1) {
        const prevClose = series[series.length - 2].close;
        change = price - prevClose;
        changePct = prevClose !== 0 ? (change / prevClose) * 100 : null;
      }
    }
  }

  return {
    ...entry,
    latestInstitutional: latest,
    maSnapshot,
    level,
    streaks,
    bollinger,
    price,
    change,
    changePct,
  };
}

export default async function Home() {
  let watchlist: WatchlistEntry[] = [];
  let chartMonths = DEFAULT_CHART_MONTHS;
  let maLines: MaLine[] = [5, 20, 60];
  try {
    [watchlist, chartMonths, maLines] = await Promise.all([getWatchlist(), getChartMonths(), getMaLines()]);
  } catch {
    watchlist = [];
  }
  const cards = await Promise.all(watchlist.map((entry) => buildCardData(entry, chartMonths, maLines)));
  const dataDate = cards.reduce<string | null>((latest, card) => {
    const d = card.latestInstitutional?.date;
    if (!d) return latest;
    return !latest || d > latest ? d : latest;
  }, null);

  return (
    <div className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <div className="mb-4">
        <WatchlistTabs active="tracked" />
      </div>
      <WatchlistClient initialCards={cards} dataDate={dataDate} />
    </div>
  );
}
