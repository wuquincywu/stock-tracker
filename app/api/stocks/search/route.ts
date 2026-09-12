import { NextRequest, NextResponse } from "next/server";
import { searchStocks } from "@/lib/marketdata";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") ?? "";
  try {
    const results = await searchStocks(q);
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [] });
  }
}
