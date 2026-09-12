import Link from "next/link";
import type { ReactNode } from "react";
import { BollingerCompactBadges } from "@/components/BollingerBadges";
import { InstitutionalLevelBadge, StreakBadges } from "@/components/InstitutionalBadges";
import type { InstitutionalCategory, InstitutionalLevel, MaLine, WatchlistCardData } from "@/lib/types";

export type { WatchlistCardData } from "@/lib/types";

/** Which currently-active filter values should get a highlight border on this card's badges. */
export interface CardHighlight {
  levels: Set<InstitutionalLevel>;
  streakCategory: InstitutionalCategory | null;
  maLine: MaLine | null;
}

export const NO_HIGHLIGHT: CardHighlight = { levels: new Set(), streakCategory: null, maLine: null };

const MA_HIGHLIGHT_BORDER = "border-2 border-amber-400";
const MA_NO_HIGHLIGHT_BORDER = "border-2 border-transparent";

/**
 * The rich stock card shared by the watchlist ("已追蹤股票") and market browse ("所有股票")
 * pages — same price/MA/level/streak/bollinger badges either way, only the top-right action
 * differs (移除 vs +追蹤), passed in via `actionSlot`. `highlight` marks which badge(s) matched
 * the currently-active filter, if any, with an amber border.
 */
export default function WatchlistCard({
  card,
  actionSlot,
  highlight = NO_HIGHLIGHT,
}: {
  card: WatchlistCardData;
  actionSlot: ReactNode;
  highlight?: CardHighlight;
}) {
  return (
    <li className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <Link href={`/stock/${card.code}`} className="flex flex-col">
          <span className="font-semibold">
            {card.code} {card.name}
          </span>
          <span className="text-xs text-zinc-500">{card.market === "TWSE" ? "上市" : "上櫃"}</span>
        </Link>
        <div className="flex items-center gap-2">
          {actionSlot}
          {card.price !== null && (
            <div className="flex flex-col items-end leading-none">
              <span
                className={`text-4xl font-bold tabular-nums ${
                  card.change === null || card.change === 0
                    ? "text-zinc-100"
                    : card.change > 0
                      ? "text-red-400"
                      : "text-emerald-400"
                }`}
              >
                {card.price.toFixed(2)}
              </span>
              {card.change !== null && card.changePct !== null && (
                <span
                  className={`mt-1.5 text-sm font-medium tabular-nums ${
                    card.change === 0
                      ? "text-zinc-500"
                      : card.change > 0
                        ? "text-red-400"
                        : "text-emerald-400"
                  }`}
                >
                  {card.change > 0 ? "+" : ""}
                  {card.change.toFixed(2)} ({card.change > 0 ? "+" : ""}
                  {card.changePct.toFixed(2)}%)
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {(card.maSnapshot.length > 0 ||
        card.level ||
        Object.values(card.streaks).some((s) => s && s.length >= 2) ||
        (card.bollinger && card.bollinger.percentB !== null)) && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {card.level && <InstitutionalLevelBadge level={card.level} highlighted={highlight.levels.has(card.level)} />}
          <StreakBadges streaks={card.streaks} highlightCategory={highlight.streakCategory} />
          {card.bollinger && <BollingerCompactBadges signal={card.bollinger} />}
          {card.maSnapshot.map((s) => (
            <span
              key={s.ma}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                s.above ? "bg-red-500/15 text-red-300" : "bg-emerald-500/15 text-emerald-300"
              } ${s.ma === highlight.maLine ? MA_HIGHLIGHT_BORDER : MA_NO_HIGHLIGHT_BORDER}`}
            >
              {s.above ? "站上" : "低於"}MA{s.ma}
            </span>
          ))}
        </div>
      )}
    </li>
  );
}
