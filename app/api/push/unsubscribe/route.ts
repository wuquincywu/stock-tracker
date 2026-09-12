import { NextRequest, NextResponse } from "next/server";
import { removeSubscription } from "@/lib/redis";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { endpoint?: string };
  if (!body.endpoint) {
    return NextResponse.json({ error: "endpoint is required" }, { status: 400 });
  }
  await removeSubscription(body.endpoint);
  return NextResponse.json({ ok: true });
}
