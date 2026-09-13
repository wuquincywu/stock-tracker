"use client";

import { useRouter } from "next/navigation";
import { Suspense, useMemo, useState } from "react";
import CardFilterPanel from "@/components/CardFilterPanel";
import StockSearchInput from "@/components/StockSearchInput";
import { useCardFilterUrl } from "@/components/useCardFilterUrl";
import WatchlistCard, { type CardHighlight, type WatchlistCardData } from "@/components/WatchlistCard";
import { isFilterActive, isStreakFilterActive, matchesFilters, sortCards } from "@/lib/cardFilters";

export type { WatchlistCardData } from "@/components/WatchlistCard";

function WatchlistFilterableList({
  initialCards,
  dataDate,
}: {
  initialCards: WatchlistCardData[];
  dataDate?: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { state, setState, reset } = useCardFilterUrl();

  const filterActive = isFilterActive(state);
  const cardHighlight: CardHighlight = {
    levels: state.levels,
    streakCategory: isStreakFilterActive(state) ? state.streakCategory : null,
    maLine: state.maLine !== "any" ? state.maLine : null,
  };

  const visibleCards = useMemo(() => {
    const filtered = filterActive ? initialCards.filter((card) => matchesFilters(card, state)) : initialCards;
    return sortCards(filtered, state.sort, state.dir, state.streakCategory);
  }, [initialCards, filterActive, state]);

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
        <CardFilterPanel
          state={state}
          onChange={setState}
          onReset={reset}
          filterActive={filterActive}
          summary={`顯示 ${visibleCards.length} / ${initialCards.length} 檔`}
        />
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

/**
 * `useCardFilterUrl` reads `useSearchParams()`, which Next requires to sit under a `<Suspense>`
 * boundary — see components/useCardFilterUrl.ts's doc comment. `fallback={null}` is fine here:
 * this page is already forced into dynamic rendering (the layout reads the user's identity cookie),
 * so the real search params are available on the very first server render and this boundary never
 * actually shows its fallback in practice.
 */
export default function WatchlistClient(props: { initialCards: WatchlistCardData[]; dataDate?: string | null }) {
  return (
    <Suspense fallback={null}>
      <WatchlistFilterableList {...props} />
    </Suspense>
  );
}
