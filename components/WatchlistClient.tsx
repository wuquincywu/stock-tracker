"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import StockSearchInput from "@/components/StockSearchInput";
import WatchlistCard, { type CardHighlight, type WatchlistCardData } from "@/components/WatchlistCard";
import {
  INSTITUTIONAL_CATEGORY_LABEL,
  INSTITUTIONAL_CATEGORY_ORDER,
  INSTITUTIONAL_LEVEL_LABEL,
  MA_LINE_ORDER,
} from "@/lib/types";
import type { InstitutionalCategory, InstitutionalLevel, MaLine, Market, StreakDirection } from "@/lib/types";

export type { WatchlistCardData } from "@/components/WatchlistCard";

const LEVEL_ORDER: InstitutionalLevel[] = ["big_sell", "small_sell", "flat", "small_buy", "big_buy"];
const MARKET_ORDER: Market[] = ["TWSE", "TPEX"];
const MARKET_LABEL: Record<Market, string> = { TWSE: "上市", TPEX: "上櫃" };
type StreakFilterDirection = StreakDirection | "any";
type MaFilterDirection = "above" | "below";

export default function WatchlistClient({
  initialCards,
  dataDate,
}: {
  initialCards: WatchlistCardData[];
  dataDate?: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [filterLevels, setFilterLevels] = useState<Set<InstitutionalLevel>>(new Set());
  const [filterMarkets, setFilterMarkets] = useState<Set<Market>>(new Set());
  const [streakCategory, setStreakCategory] = useState<InstitutionalCategory>("combined");
  const [streakDirection, setStreakDirection] = useState<StreakFilterDirection>("any");
  const [minStreak, setMinStreak] = useState(0);
  const [maFilterLine, setMaFilterLine] = useState<MaLine | "any">("any");
  const [maFilterDirection, setMaFilterDirection] = useState<MaFilterDirection>("above");

  const filterActive =
    filterLevels.size > 0 ||
    filterMarkets.size > 0 ||
    streakDirection !== "any" ||
    minStreak > 0 ||
    maFilterLine !== "any";
  const streakFilterActive = streakDirection !== "any" || minStreak > 0;
  const maFilterActive = maFilterLine !== "any";
  const selectClass = (active: boolean) =>
    `rounded-md border px-2 py-1 text-xs outline-none focus:border-emerald-500 ${
      active ? "border-emerald-500 bg-emerald-500/10 text-emerald-300" : "border-zinc-700 bg-zinc-950 text-zinc-400"
    }`;
  const cardHighlight: CardHighlight = {
    levels: filterLevels,
    streakCategory: streakFilterActive ? streakCategory : null,
    maLine: maFilterLine !== "any" ? maFilterLine : null,
  };

  function toggleFilterLevel(level: InstitutionalLevel) {
    setFilterLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
  }

  function toggleFilterMarket(market: Market) {
    setFilterMarkets((prev) => {
      const next = new Set(prev);
      if (next.has(market)) next.delete(market);
      else next.add(market);
      return next;
    });
  }

  function resetFilters() {
    setFilterLevels(new Set());
    setFilterMarkets(new Set());
    setStreakCategory("combined");
    setStreakDirection("any");
    setMinStreak(0);
    setMaFilterLine("any");
    setMaFilterDirection("above");
  }

  const visibleCards = useMemo(() => {
    if (!filterActive) return initialCards;
    return initialCards.filter((card) => {
      if (filterMarkets.size > 0 && !filterMarkets.has(card.market)) return false;
      if (filterLevels.size > 0 && (!card.level || !filterLevels.has(card.level))) return false;
      const streak = card.streaks[streakCategory];
      if (streakDirection !== "any" && streak?.direction !== streakDirection) return false;
      if (minStreak > 0 && (!streak || streak.length < minStreak)) return false;
      if (maFilterLine !== "any") {
        const snapshot = card.maSnapshot.find((s) => s.ma === maFilterLine);
        if (!snapshot) return false;
        if (snapshot.above !== (maFilterDirection === "above")) return false;
      }
      return true;
    });
  }, [
    initialCards,
    filterActive,
    filterLevels,
    filterMarkets,
    streakCategory,
    streakDirection,
    minStreak,
    maFilterLine,
    maFilterDirection,
  ]);

  async function addStock(code: string) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "新增失敗");
        return;
      }
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function removeStock(targetCode: string) {
    await fetch(`/api/watchlist?code=${encodeURIComponent(targetCode)}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <StockSearchInput onAdd={addStock} submitting={submitting} />
      {error && <p className="text-sm text-red-400">{error}</p>}
      {dataDate && <p className="text-xs text-zinc-600">資料更新至 {dataDate}</p>}

      {initialCards.length === 0 && (
        <p className="py-12 text-center text-sm text-zinc-500">尚未追蹤任何股票，輸入股號開始追蹤。</p>
      )}

      {initialCards.length > 0 && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
          <div className="flex flex-wrap gap-1.5">
            {MARKET_ORDER.map((market) => (
              <button
                key={market}
                type="button"
                onClick={() => toggleFilterMarket(market)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  filterMarkets.has(market)
                    ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                    : "border-zinc-700 text-zinc-400 hover:border-zinc-600"
                }`}
              >
                {MARKET_LABEL[market]}
              </button>
            ))}
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {LEVEL_ORDER.map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => toggleFilterLevel(level)}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                  filterLevels.has(level)
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
              value={streakCategory}
              onChange={(e) => setStreakCategory(e.target.value as InstitutionalCategory)}
              className={selectClass(streakFilterActive)}
            >
              {INSTITUTIONAL_CATEGORY_ORDER.map((category) => (
                <option key={category} value={category}>
                  {INSTITUTIONAL_CATEGORY_LABEL[category]}
                </option>
              ))}
            </select>
            <select
              value={streakDirection}
              onChange={(e) => setStreakDirection(e.target.value as StreakFilterDirection)}
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
              value={minStreak}
              onChange={(e) => setMinStreak(Math.max(0, Number(e.target.value) || 0))}
              className={`w-14 ${selectClass(streakFilterActive)}`}
            />
            <span>天</span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
            <select
              value={maFilterLine}
              onChange={(e) => setMaFilterLine(e.target.value === "any" ? "any" : (Number(e.target.value) as MaLine))}
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
              value={maFilterDirection}
              onChange={(e) => setMaFilterDirection(e.target.value as MaFilterDirection)}
              disabled={maFilterLine === "any"}
              className={`${selectClass(maFilterActive)} disabled:opacity-50`}
            >
              <option value="above">站上</option>
              <option value="below">低於</option>
            </select>

            <span className="ml-auto text-zinc-600">
              顯示 {visibleCards.length} / {initialCards.length} 檔
            </span>
            {filterActive && (
              <button type="button" onClick={resetFilters} className="text-zinc-500 hover:text-red-400">
                清除篩選
              </button>
            )}
          </div>
        </div>
      )}

      {initialCards.length > 0 && visibleCards.length === 0 && (
        <p className="py-8 text-center text-sm text-zinc-500">沒有符合篩選條件的股票。</p>
      )}

      <ul className="flex flex-col gap-3">
        {visibleCards.map((card) => (
          <WatchlistCard
            key={card.code}
            card={card}
            highlight={cardHighlight}
            actionSlot={
              <button
                onClick={() => removeStock(card.code)}
                className="text-xs text-zinc-600 hover:text-red-400"
                aria-label={`移除 ${card.code}`}
              >
                移除
              </button>
            }
          />
        ))}
      </ul>
    </div>
  );
}
