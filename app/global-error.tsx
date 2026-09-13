"use client";

import { useEffect } from "react";

/**
 * Catches an error thrown by the ROOT layout itself (app/layout.tsx) — app/error.tsx can't catch
 * that, since it renders inside the layout it would need to replace. Next requires this file to
 * render its own complete <html>/<body> since the layout that normally provides them is exactly
 * what's failing. Deliberately minimal (no fonts/Tailwind classes from globals.css relied on) so it
 * has the best chance of rendering even if the failure is more fundamental than a single page.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app/global-error.tsx] root layout error:", error);
  }, [error]);

  return (
    <html lang="zh-Hant">
      <body style={{ background: "#0a0a0a", color: "#f4f4f5", fontFamily: "sans-serif" }}>
        <div style={{ maxWidth: 480, margin: "0 auto", padding: "6rem 1rem", textAlign: "center" }}>
          <p style={{ fontSize: "1.125rem", fontWeight: 600, marginBottom: "0.5rem" }}>發生錯誤</p>
          <p style={{ fontSize: "0.875rem", color: "#a1a1aa", marginBottom: "1.5rem" }}>
            應用程式暫時無法載入，請稍後再試一次。
          </p>
          <button
            onClick={reset}
            style={{
              borderRadius: 9999,
              padding: "0.5rem 1.25rem",
              fontSize: "0.875rem",
              fontWeight: 500,
              background: "#10b981",
              color: "#09090b",
              border: "none",
              cursor: "pointer",
            }}
          >
            重試
          </button>
        </div>
      </body>
    </html>
  );
}
