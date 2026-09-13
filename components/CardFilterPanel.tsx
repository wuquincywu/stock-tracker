"use client";

import type { ReactNode } from "react";
import { isMaFilterActive, isStreakFilterActive } from "@/lib/cardFilters";
import type { CardFilterState, SortKey } from "@/lib/cardFilters";
import {
  ALL_MARKETS,
  INSTITUTIONAL_CATEGORY_LABEL,
  INSTITUTIONAL_CATEGORY_ORDER,
  INSTITUTIONAL_LEVEL_LABEL,
  INSTITUTIONAL_LEVEL_ORDER,
  MA_LINE_ORDER,
  MARKET_LABEL,
} from "@/lib/types";
import type { InstitutionalLevel, MaLine, Market } from "@/lib/types";

const SORT_ORDER: SortKey[] = ["code", "changePct", "institutionalNet", "streakLength", "percentB"];
const SORT_LABEL: Record<SortKey, string> = {
  code: "股號",
  changePct: "漲跌幅",
  institutionalNet: "法人買賣超",
  streakLength: "連續天數",
  percentB: "布林 %b",
};

function selectClass(active: boolean): string {
  return `rounded-md border px-2 py-1 text-xs outline-none focus:border-emerald-500 ${
    active ? "border-emerald-500 bg-emerald-500/10 text-emerald-300" : "border-zinc-700 bg-zinc-950 text-zinc-400"
  }`;
}

/**
 * Filter chips/selects + sort controls shared by the watchlist ("已追蹤股票") and market browse
 * ("所有股票") pages — these used to be two ~150-line hand-copied blocks of near-identical JSX
 * that had to be kept in sync by hand. `onChange` receives the full next state (the caller decides
 * how to apply it — e.g. resetting to page 1 via useCardFilterUrl's setState).
 */
export default function CardFilterPanel({
  state,
  onChange,
  onReset,
  filterActive,
  showMarketFilter = true,
  summary,
}: {
  state: CardFilterState;
  onChange: (next: CardFilterState) => void;
  onReset: () => void;
  filterActive: boolean;
  /** The watchlist page's own list is already scoped to what the user tracks, but still spans both
   * markets — keep this true there too unless a caller has a reason not to. */
  showMarketFilter?: boolean;
  summary: ReactNode;
}) {
  const streakFilterActive = isStreakFilterActive(state);
  const maFilterActive = isMaFilterActive(state);

  function toggleMarket(market: Market) {
    const next = new Set(state.markets);
    if (next.has(market)) next.delete(market);
    else next.add(market);
    onChange({ ...state, markets: next });
  }

  function toggleLevel(level: InstitutionalLevel) {
    const next = new Set(state.levels);
    if (next.has(level)) next.delete(level);
    else next.add(level);
    onChange({ ...state, levels: next });
  }

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
      {showMarketFilter && (
        <div className="flex flex-wrap items-center gap-1.5">
          {ALL_MARKETS.map((market) => (
            <button
              key={market}
              type="button"
              onClick={() => toggleMarket(market)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                state.markets.has(market)
                  ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                  : "border-zinc-700 text-zinc-400 hover:border-zinc-600"
              }`}
            >
              {MARKET_LABEL[market]}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {INSTITUTIONAL_LEVEL_ORDER.map((level) => (
          <button
            key={level}
            type="button"
            onClick={() => toggleLevel(level)}
            className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
              state.levels.has(level)
                ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                : "border-zinc-700 text-zinc-400 hover:border-zinc-600"
            }`}
          >
            {INSTITUTIONAL_LEVEL_LABEL[level]}
          </button>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
        <select
          value={state.streakCategory}
          onChange={(e) => onChange({ ...state, streakCategory: e.target.value as CardFilterState["streakCategory"] })}
          className={selectClass(streakFilterActive)}
        >
          {INSTITUTIONAL_CATEGORY_ORDER.map((category) => (
            <option key={category} value={category}>
              {INSTITUTIONAL_CATEGORY_LABEL[category]}
            </option>
          ))}
        </select>
        <select
          value={state.streakDirection}
          onChange={(e) => onChange({ ...state, streakDirection: e.target.value as CardFilterState["streakDirection"] })}
          className={selectClass(streakFilterActive)}
        >
          <option value="any">連買賣不限</option>
          <option value="buy">連買</option>
          <option value="sell">連賣</option>
        </select>
        <span>至少</span>
        <input
          type="number"
          min={0}
          value={state.minStreak}
          onChange={(e) => onChange({ ...state, minStreak: Math.max(0, Number(e.target.value) || 0) })}
          className={`w-14 ${selectClass(streakFilterActive)}`}
        />
        <span>天</span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
        <select
          value={state.maLine}
          onChange={(e) =>
            onChange({ ...state, maLine: e.target.value === "any" ? "any" : (Number(e.target.value) as MaLine) })
          }
          className={selectClass(maFilterActive)}
        >
          <option value="any">均線不限</option>
          {MA_LINE_ORDER.map((ma) => (
            <option key={ma} value={ma}>
              MA{ma}
            </option>
          ))}
        </select>
        <select
          value={state.maDirection}
          onChange={(e) => onChange({ ...state, maDirection: e.target.value as CardFilterState["maDirection"] })}
          disabled={state.maLine === "any"}
          className={`${selectClass(maFilterActive)} disabled:opacity-50`}
        >
          <option value="above">站上</option>
          <option value="below">低於</option>
        </select>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
        <span>排序</span>
        <select
          value={state.sort}
          onChange={(e) => onChange({ ...state, sort: e.target.value as SortKey })}
          className={selectClass(state.sort !== "code")}
        >
          {SORT_ORDER.map((key) => (
            <option key={key} value={key}>
              {SORT_LABEL[key]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => onChange({ ...state, dir: state.dir === "asc" ? "desc" : "asc" })}
          className={selectClass(state.dir !== "asc")}
        >
          {state.dir === "asc" ? "由小到大 ↑" : "由大到小 ↓"}
        </button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
        <span className="ml-auto text-zinc-600">{summary}</span>
        {filterActive && (
          <button type="button" onClick={onReset} className="text-zinc-500 hover:text-red-400">
            清除篩選
          </button>
        )}
      </div>
    </div>
  );
}
