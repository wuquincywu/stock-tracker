import { NextRequest, NextResponse } from "next/server";
import { refreshMarketShareholderConcentration } from "@/lib/marketdata";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Weekly refresh of 集保戶股權分散表 (千張大戶/big-holder concentration) — TDCC only publishes a
 * new snapshot once a week (Friday close, ~16:00), so this runs on its own weekly schedule
 * (vercel.json) rather than piggybacking on the daily check-alerts cron. Whole-market, one HTTP
 * call (lib/tdcc.ts) + Redis writes for ~1,800 real stocks — comfortably inside the 60s budget (see
 * lib/marketdata.ts's refreshMarketShareholderConcentration).
 */
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const summary = await refreshMarketShareholderConcentration();
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error("[refresh-shareholder-concentration] run failed:", err);
    return NextResponse.json({ error: "refresh failed" }, { status: 500 });
  }
}
