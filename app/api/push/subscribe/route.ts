import { NextRequest, NextResponse } from "next/server";
import { addSubscription } from "@/lib/redis";
import { getCurrentUser } from "@/lib/users";
import type { PushSubscriptionRecord } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const currentUser = await getCurrentUser();
  if (!currentUser) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const sub = (await req.json()) as PushSubscriptionRecord;
  if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return NextResponse.json({ error: "invalid subscription" }, { status: 400 });
  }
  await addSubscription(currentUser, sub);
  return NextResponse.json({ ok: true });
}
