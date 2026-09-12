"use client";

import { useEffect } from "react";

/** Clears the PWA app-icon badge (set by public/sw.js on push) once the 通知 page is actually opened. */
export default function ClearAppBadge() {
  useEffect(() => {
    const nav = navigator as Navigator & { clearAppBadge?: () => Promise<void> };
    nav.clearAppBadge?.().catch(() => {});
  }, []);

  return null;
}
