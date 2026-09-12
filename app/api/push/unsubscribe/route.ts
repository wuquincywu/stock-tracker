import { NextRequest, NextResponse } from "next/server";
import { removeSubscription } from "@/lib/redis";
import { getCurrentUser } from "@/lib/users";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json()) as { endpoint?: string };
  if (!body.endpoint) {
    return NextResponse.json({ error: "endpoint is required" }, { status: 400 });
  }
  await removeSubscription(currentUser, body.endpoint);
  return NextResponse.json({ ok: true });
}
