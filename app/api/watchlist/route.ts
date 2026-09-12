import { NextRequest, NextResponse } from "next/server";
import { lookupStock, searchStocks } from "@/lib/marketdata";
import { addToWatchlist, getWatchlist, removeFromWatchlist } from "@/lib/redis";
import { getCurrentUser } from "@/lib/users";

export async function GET() {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const watchlist = await getWatchlist(currentUser);
  return NextResponse.json({ watchlist });
}

export async function POST(req: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json()) as { code?: string };
  const code = body.code?.trim();
  if (!code) {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }

  let resolvedCode = code;
  let info: Awaited<ReturnType<typeof lookupStock>>;
  try {
    info = await lookupStock(code);
    // Not a valid code as-is (e.g. a Chinese name typed and submitted without using the
    // autocomplete dropdown) — fall back to a name/code search and accept it only if unambiguous.
    if (!info) {
      const matches = await searchStocks(code);
      if (matches.length === 1) {
        resolvedCode = matches[0].code;
        info = { name: matches[0].name, market: matches[0].market };
      }
    }
  } catch {
    return NextResponse.json({ error: "資料來源暫時無法連線，請稍後再試一次" }, { status: 503 });
  }
  if (!info) {
    return NextResponse.json({ error: `找不到股票「${code}」，請從建議清單選擇` }, { status: 404 });
  }

  const entry = { code: resolvedCode, name: info.name, market: info.market };
  await addToWatchlist(currentUser, entry);
  return NextResponse.json({ entry });
}

export async function DELETE(req: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  if (!code) {
    return NextResponse.json({ error: "code is required" }, { status: 400 });
  }
  await removeFromWatchlist(currentUser, code);
  return NextResponse.json({ ok: true });
}
