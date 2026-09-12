import type { BollingerSignal } from "@/lib/types";

/**
 * Compact badges for the watchlist card — always shows a band-position read (站上上軌 / 跌破下軌
 * / 相對強勢 / 相對弱勢) whenever it can be computed, plus a squeeze chip when that also applies.
 */
export function BollingerCompactBadges({ signal }: { signal: BollingerSignal }) {
  if (signal.percentB === null || !signal.bandPosition) return null;
  return (
    <>
      {signal.bandPosition === "above_upper" && (
        <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-medium text-red-300">站上布林上軌</span>
      )}
      {signal.bandPosition === "below_lower" && (
        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300">
          跌破布林下軌
        </span>
      )}
      {signal.bandPosition === "inside" && (
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            signal.percentB >= 0.5 ? "bg-red-500/10 text-red-300/80" : "bg-emerald-500/10 text-emerald-300/80"
          }`}
        >
          {signal.percentB >= 0.5 ? "相對強勢" : "相對弱勢"}
        </span>
      )}
      {signal.squeeze && (
        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-300">通道收縮</span>
      )}
    </>
  );
}

/** Full detail — includes the routine "相對強勢/弱勢" inside-band read plus %B and bandwidth numbers. */
export function BollingerDetailBadges({ signal }: { signal: BollingerSignal }) {
  if (signal.percentB === null) return null;
  return (
    <>
      {signal.bandPosition === "above_upper" && (
        <span className="rounded-full bg-red-500/15 px-3 py-1 text-xs font-medium text-red-300">站上布林上軌</span>
      )}
      {signal.bandPosition === "below_lower" && (
        <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-300">
          跌破布林下軌
        </span>
      )}
      {signal.bandPosition === "inside" && (
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            signal.percentB >= 0.5 ? "bg-red-500/10 text-red-300/80" : "bg-emerald-500/10 text-emerald-300/80"
          }`}
        >
          {signal.percentB >= 0.5 ? "相對強勢" : "相對弱勢"}
        </span>
      )}
      {signal.squeeze && (
        <span className="rounded-full bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-300">
          通道收縮（近期最窄）
        </span>
      )}
      <span className="text-xs text-zinc-600">
        %B {signal.percentB.toFixed(2)}
        {signal.bandwidthPct !== null && ` · 通道寬度 ${signal.bandwidthPct.toFixed(1)}%`}
      </span>
    </>
  );
}
