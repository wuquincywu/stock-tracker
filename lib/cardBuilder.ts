import {
  analyzeBollinger,
  bollingerBands,
  classifyInstitutionalLevel,
  computeInstitutionalStreaks,
  latestMaSnapshot,
} from "./indicators";
import type { InstitutionalRow, MaLine, Market, PriceRow, WatchlistCardData } from "./types";

/** Structural subset of both WatchlistEntry and StockDirectoryEntry — both are already exactly
 * {code, name, market}, so one function can build a card for either without depending on either
 * type specifically. */
export interface CardIdentity {
  code: string;
  name: string;
  market: Market;
}

/**
 * Builds one rich stock card (institutional level/streaks, Bollinger signal, MA snapshot, latest
 * price/change) from already-fetched price + institutional series. Pure and Redis-free — no data
 * fetching happens here, which is what makes it directly unit-testable. This is the one shared
 * implementation for what used to be two hand-copied versions of this exact computation:
 * app/page.tsx's own buildCardData (watchlist) and lib/marketdata.ts's buildAllMarketCards map body
 * (所有股票).
 */
export function buildCard(
  entry: CardIdentity,
  priceSeries: PriceRow[],
  institutional: InstitutionalRow[],
  maLines: MaLine[],
): WatchlistCardData {
  const level = classifyInstitutionalLevel(institutional);
  const streaks = computeInstitutionalStreaks(institutional);
  const bollinger = priceSeries.length > 0 ? analyzeBollinger(priceSeries, bollingerBands(priceSeries)) : null;
  const maSnapshot = latestMaSnapshot(priceSeries, maLines);

  let price: number | null = null;
  let change: number | null = null;
  let changePct: number | null = null;
  if (priceSeries.length > 0) {
    price = priceSeries[priceSeries.length - 1].close;
    if (priceSeries.length > 1) {
      const prevClose = priceSeries[priceSeries.length - 2].close;
      change = price - prevClose;
      changePct = prevClose !== 0 ? (change / prevClose) * 100 : null;
    }
  }

  return {
    code: entry.code,
    name: entry.name,
    market: entry.market,
    latestInstitutional: institutional.length > 0 ? institutional[institutional.length - 1] : null,
    maSnapshot,
    level,
    streaks,
    bollinger,
    price,
    change,
    changePct,
  } satisfies WatchlistCardData;
}
