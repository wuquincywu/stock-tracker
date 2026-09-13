import { INSTITUTIONAL_CATEGORY_LABEL, INSTITUTIONAL_CATEGORY_ORDER, INSTITUTIONAL_LEVEL_LABEL } from "@/lib/types";
import type {
  InstitutionalCategory,
  InstitutionalLevel,
  InstitutionalStreakSet,
  ShareholderConcentrationSignal,
} from "@/lib/types";

const LEVEL_CLASS: Record<InstitutionalLevel, string> = {
  big_buy: "bg-red-500/20 text-red-300",
  small_buy: "bg-red-500/10 text-red-300/80",
  flat: "bg-zinc-700/40 text-zinc-400",
  small_sell: "bg-emerald-500/10 text-emerald-300/80",
  big_sell: "bg-emerald-500/20 text-emerald-300",
};

// A badge whose value matches the currently-active filter gets this border, so it's obvious which
// tag is the reason a card showed up under that filter. Amber on purpose — distinct from the
// red/emerald buy-sell semantics the badges themselves already use.
const HIGHLIGHT_BORDER = "border-2 border-amber-400";
const NO_HIGHLIGHT_BORDER = "border-2 border-transparent";

export function InstitutionalLevelBadge({ level, highlighted }: { level: InstitutionalLevel; highlighted?: boolean }) {
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium ${LEVEL_CLASS[level]} ${
        highlighted ? HIGHLIGHT_BORDER : NO_HIGHLIGHT_BORDER
      }`}
    >
      法人{INSTITUTIONAL_LEVEL_LABEL[level]}
    </span>
  );
}

/** Renders one badge per category (外資/投信/自營商/合計) that has an active streak of >=2 days. */
export function StreakBadges({
  streaks,
  highlightCategory,
}: {
  streaks: InstitutionalStreakSet;
  highlightCategory?: InstitutionalCategory | null;
}) {
  return (
    <>
      {INSTITUTIONAL_CATEGORY_ORDER.map((category) => {
        const streak = streaks[category];
        if (!streak || streak.length < 2) return null;
        const color =
          streak.direction === "buy" ? "bg-red-500/10 text-red-300/80" : "bg-emerald-500/10 text-emerald-300/80";
        const border = category === highlightCategory ? HIGHLIGHT_BORDER : NO_HIGHLIGHT_BORDER;
        return (
          <span key={category} className={`rounded-full px-2 py-0.5 text-xs font-medium ${color} ${border}`}>
            {INSTITUTIONAL_CATEGORY_LABEL[category]}連{streak.length}
            {streak.direction === "buy" ? "買" : "賣"}
          </span>
        );
      })}
    </>
  );
}

/**
 * Two badges for 千張大戶 (big-holder, TDCC tier 15) concentration: current % and the
 * week-over-week percentage-point change. Renders nothing until the weekly refresh has captured at
 * least one snapshot for this stock (see lib/marketdata.ts's refreshMarketShareholderConcentration);
 * the WoW badge specifically waits for a second snapshot to diff against.
 */
export function ShareholderConcentrationBadges({ signal }: { signal: ShareholderConcentrationSignal | null }) {
  if (!signal || signal.latestPct === null) return null;
  const change = signal.weekChangePct;
  // Rising big-holder concentration (accumulation) is read as bullish here, same red=buy/emerald=sell
  // convention this app uses everywhere else (institutional net buy, price change, MA badges).
  const changeColor = change === null || change === 0 ? "text-zinc-400" : change > 0 ? "text-red-300/80" : "text-emerald-300/80";

  return (
    <>
      <span className="rounded-full bg-zinc-700/40 px-2 py-0.5 text-xs font-medium text-zinc-300">
        大戶 {signal.latestPct.toFixed(1)}%
      </span>
      {change !== null && (
        <span className={`rounded-full bg-zinc-700/40 px-2 py-0.5 text-xs font-medium ${changeColor}`}>
          WoW {change > 0 ? "+" : ""}
          {change.toFixed(2)}%
        </span>
      )}
    </>
  );
}
