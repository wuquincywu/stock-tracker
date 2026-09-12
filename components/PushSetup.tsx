"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";

type Status = "loading" | "unsupported" | "needs-install" | "default" | "subscribing" | "subscribed" | "denied" | "error";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function computeStatus(): Status {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return "unsupported";
  if (!isStandalone()) return "needs-install";
  if (Notification.permission === "denied") return "denied";
  return "default";
}

export default function PushSetup() {
  // Starts as "loading" (renders null) on both server and client's first paint, so there's
  // nothing here for hydration to mismatch on — the real, browser-only status is only known
  // after mount.
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    // Browser-only capability detection (Push API support, standalone mode, notification
    // permission) can't be known during SSR — this has to run once after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus(computeStatus());
  }, []);

  useEffect(() => {
    if (status !== "default") return;
    navigator.serviceWorker.register("/sw.js").then((reg) =>
      reg.pushManager.getSubscription().then((sub) => {
        if (sub) setStatus("subscribed");
      }),
    );
  }, [status]);

  async function enableNotifications() {
    setStatus("subscribing");
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "default");
        return;
      }
      const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!publicKey) throw new Error("missing VAPID public key");

      const subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });

      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(subscription.toJSON()),
      });

      setStatus("subscribed");
    } catch {
      setStatus("error");
    }
  }

  if (status === "loading" || status === "unsupported" || status === "subscribed") return null;

  if (status === "needs-install") {
    return (
      <div className="fixed inset-x-0 bottom-0 border-t border-zinc-800 bg-zinc-900 px-4 py-3 text-sm text-zinc-300">
        將本頁「加入主畫面」後重新開啟，才能啟用推播通知。
      </div>
    );
  }

  return (
    <div className="fixed inset-x-0 bottom-0 flex items-center justify-between border-t border-zinc-800 bg-zinc-900 px-4 py-3 text-sm">
      <span className="text-zinc-300">
        {status === "denied" && "通知權限已被拒絕，請至系統設定開啟"}
        {status === "error" && "啟用通知時發生錯誤，請再試一次"}
        {(status === "default" || status === "subscribing") && "啟用推播通知，均線突破時主動提醒你"}
      </span>
      {status !== "denied" && (
        <Button onClick={enableNotifications} disabled={status === "subscribing"}>
          {status === "subscribing" ? "啟用中…" : "啟用通知"}
        </Button>
      )}
    </div>
  );
}
