import { NextRequest, NextResponse } from "next/server";
import { clearStockAlertConfig, getAlertConfig, isInWatchlist, setStockAlertConfig } from "@/lib/redis";
import { getCurrentUser } from "@/lib/users";
import type { AlertConfig } from "@/lib/types";

/**
 * Per-stock notification-settings override — see lib/redis.ts's setStockAlertConfig doc comment:
 * whole-stock, not per-field, so "customized or not" is just "does this key exist". POST
 * sets/replaces this stock's own full AlertConfig; DELETE reverts it back to the account-wide
 * shared settings. Both rely on setStockAlertConfig/getAlertConfig's own sanitization (same as
 * /api/settings does for the account-wide config) rather than re-validating the shape here.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { code } = await params;
  // A per-stock override only means anything for a stock this user actually tracks — the alert
  // pipeline only ever looks one up for codes in the user's own watchlist (see lib/alerts.ts).
  if (!(await isInWatchlist(currentUser, code))) {
    return NextResponse.json({ error: "not tracking this stock" }, { status: 404 });
  }

  const config = (await req.json()) as AlertConfig;
  await setStockAlertConfig(currentUser, code, config);
  return NextResponse.json({ config });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { code } = await params;
  await clearStockAlertConfig(currentUser, code);
  const sharedConfig = await getAlertConfig(currentUser);
  return NextResponse.json({ config: sharedConfig });
}
