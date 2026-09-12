import { NextRequest, NextResponse } from "next/server";
import { backfillMarketInstitutional, backfillTwseMarketPrices } from "@/lib/marketdata";

export const runtime = "nodejs";
// Vercel Hobby's hard cap is 60s regardless of what's declared here — a higher value either fails
// to deploy or gets silently clamped. Both backfill calls below are time-budgeted to stay inside
// this, so the route always returns before being cut off; it just may report `completed: false`.
export const maxDuration = 60;

// Leaves ~5s of the 60s hard cap for request/response overhead (auth check, JSON serialization).
const TOTAL_BUDGET_MS = 55_000;

/**
 * One-time (or manually re-run) market-wide backfill: 三大法人 history for every TWSE+TPEX stock
 * (free bulk sources) and price history for every TWSE stock (free per-stock, unlimited). TPEX
 * price history isn't handled here — it needs FinMind, which is rate-limited, so it runs via
 * scripts/backfill-tpex-prices.mjs instead. Protected by the same CRON_SECRET as the daily cron
 * since it's meant to be triggered manually/rarely, not exposed publicly.
 *
 * A full run over ~2,400 stocks can exceed the time budget in one call — check `completed` in the
 * response and call this again (safe to re-run: already-fresh stocks are skipped cheaply) until
 * both halves report `completed: true`.
 */
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  const institutional = await backfillMarketInstitutional(40, 70, start + TOTAL_BUDGET_MS / 2);
  const priceDeadline = Math.max(Date.now() + 5_000, start + TOTAL_BUDGET_MS);
  const prices = await backfillTwseMarketPrices(4, 6, priceDeadline);

  return NextResponse.json({
    institutional,
    prices,
    completed: institutional.completed && prices.completed,
  });
}
