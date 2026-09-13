"use client";

import { useEffect } from "react";
import Button from "@/components/ui/Button";

/**
 * Route-segment error boundary — catches an unhandled throw from any page/layout below the root
 * layout (so the header/nav around it still renders) and shows a retry button instead of Next's
 * default error overlay. Most pages already catch their own Redis/fetch failures and render an
 * inline empty-state, so this is a backstop for whatever isn't covered yet, not the primary error
 * handling path.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app/error.tsx] unhandled route error:", error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center gap-4 px-4 py-24 text-center">
      <p className="text-lg font-semibold text-zinc-100">發生錯誤</p>
      <p className="text-sm text-zinc-500">這個頁面暫時無法顯示，請稍後再試一次。</p>
      <Button onClick={reset}>重試</Button>
    </div>
  );
}
