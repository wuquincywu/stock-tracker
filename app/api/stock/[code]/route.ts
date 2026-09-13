import { NextRequest, NextResponse } from "next/server";
import { classifyInstitutionalLevel, computeInstitutionalStreaks } from "@/lib/indicators";
import { getChartSeries, getInstitutionalSeries, institutionalDaysForMonths, lookupStock } from "@/lib/marketdata";
import { clampChartMonths, DEFAULT_CHART_MONTHS } from "@/lib/redis";

// Matches the stock detail page's default chart window (see app/stock/[code]/page.tsx and
// components/StockChartSection.tsx). A request for this many months or fewer is always served
// from whatever's already stored (populated by the daily cron / backfills) — only a request for
// MORE triggers a live fetch, since that's an explicit "show me further back" action from the
// month-range buttons, not something that should happen silently on every page view.
const LIVE_FETCH_THRESHOLD_MONTHS = 3;

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const monthsParam = req.nextUrl.searchParams.get("months");

  try {
    const info = await lookupStock(code);
    if (!info) {
      return NextResponse.json({ error: `找不到股號 ${code}` }, { status: 404 });
    }

    const months = monthsParam !== null ? clampChartMonths(Number(monthsParam)) : DEFAULT_CHART_MONTHS;
    const [{ prices, bands }, institutional] = await Promise.all([
      getChartSeries(code, info.market, months, months > LIVE_FETCH_THRESHOLD_MONTHS),
      // Sized to match `months` (not a fixed cap) so the institutional bar histogram covers the
      // same timeline as the price chart it's rendered underneath, however wide that gets.
      getInstitutionalSeries(code, institutionalDaysForMonths(months)),
    ]);

    const level = classifyInstitutionalLevel(institutional);
    const streaks = computeInstitutionalStreaks(institutional);

    return NextResponse.json({
      code,
      name: info.name,
      market: info.market,
      prices,
      bands,
      institutional,
      level,
      streaks,
    });
  } catch {
    return NextResponse.json({ error: "資料來源暫時無法連線，請稍後再試一次" }, { status: 503 });
  }
}
