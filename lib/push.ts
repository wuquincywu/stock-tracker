import webpush from "web-push";
import { getSubscriptions, removeSubscription } from "./redis";

let configured = false;

function ensureConfigured(): void {
  if (configured) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    throw new Error("Missing VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT env vars");
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
}

export interface BroadcastResult {
  sent: number;
  pruned: number;
  failed: number;
}

/** Sends `payload` to every subscription stored for `userId`, pruning any that report gone (410/404). */
export async function broadcastPush(userId: string, payload: PushPayload): Promise<BroadcastResult> {
  ensureConfigured();
  const subscriptions = await getSubscriptions(userId);
  let sent = 0;
  let pruned = 0;
  let failed = 0;

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(sub, JSON.stringify(payload));
        sent += 1;
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 410 || statusCode === 404) {
          await removeSubscription(userId, sub.endpoint);
          pruned += 1;
        } else {
          failed += 1;
          console.error(`web push failed for ${sub.endpoint}:`, err);
        }
      }
    }),
  );

  return { sent, pruned, failed };
}
