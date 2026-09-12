"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import WatchlistCard, { type CardHighlight } from "@/components/WatchlistCard";
import {
  INSTITUTIONAL_CATEGORY_LABEL,
  INSTITUTIONAL_CATEGORY_ORDER,
  INSTITUTIONAL_LEVEL_LABEL,
  MA_LINE_ORDER,
} from "@/lib/types";
import type { InstitutionalCategory, InstitutionalLevel, MaLine, Market, StreakDirection, WatchlistCardData } from "@/lib/types";

const LEVEL_ORDER: InstitutionalLevel[] = ["big_sell", "small_sell", "flat", "small_buy", "big_buy"];
const MARKET_ORDER: Market[] = ["TWSE", "TPEX"];
const MARKET_LABEL: Record<Market, string> = { TWSE: "上市", TPEX: "上櫃" };
const PAGE_SIZE = 50;
type StreakFilterDirection = StreakDirection | "any";
type MaFilterDirection = "above" | "below";

/** First page, last page, current page ± 1, "…" for the gaps — keeps the pager short even at ~48 pages. */
function pageNumbers(current: number, total: number): (number | "…")[] {
  const pages: (number | "…")[] = [];
  let prev = 0;
  for (let p = 1; p <= total; p++) {
    if (p === 1 || p === total || (p >= current - 1 && p <= current + 1)) {
      if (prev && p - prev > 1) pages.push("…");
      pages.push(p);
      prev = p;
    }
  }
  return pages;
}

export default function MarketOverviewClient({
  initialCards,
  initialTotal,
  trackedCodes,
}: {
  initialCards: WatchlistCardData[];
  initialTotal: number;
  trackedCodes: string[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [markets, setMarkets] = useState<Set<Market>>(new Set());
  const [levels, setLevels] = useState<Set<InstitutionalLevel>>(new Set());
  const [streakCategory, setStreakCategory] = useState<InstitutionalCategory>("combined");
  const [streakDirection, setStreakDirection] = useState<StreakFilterDirection>("any");
  const [minStreak, setMinStreak] = useState(0);
  const [maFilterLine, setMaFilterLine] = useState<MaLine | "any">("any");
  const [maFilterDirection, setMaFilterDirection] = useState<MaFilterDirection>("above");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [page, setPage] = useState(1);

  const [cards, setCards] = useState(initialCards);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [tracked, setTracked] = useState<Set<string>>(new Set(trackedCodes));
  const [pendingCode, setPendingCode] = useState<string | null>(null);

  const filterActive =
    markets.size > 0 ||
    levels.size > 0 ||
    streakDirection !== "any" ||
    minStreak > 0 ||
    maFilterLine !== "any" ||
    query.trim() !== "";
  const streakFilterActive = streakDirection !== "any" || minStreak > 0;
  const maFilterActive = maFilterLine !== "any";
  const selectClass = (active: boolean) =>
    `rounded-md border px-2 py-1 text-xs outline-none focus:border-emerald-500 ${
      active ? "border-emerald-500 bg-emerald-500/10 text-emerald-300" : "border-zinc-700 bg-zinc-950 text-zinc-400"
    }`;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const cardHighlight: CardHighlight = {
    levels,
    streakCategory: streakFilterActive ? streakCategory : null,
    maLine: maFilterLine !== "any" ? maFilterLine : null,
  };

  const isFirstRun = useRef(true);
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    let cancelled = false;
    const handle = setTimeout(
      () => {
        setLoading(true);
        const params = new URLSearchParams();
        if (query.trim()) params.set("q", query.trim());
        if (markets.size > 0) params.set("markets", [...markets].join(","));
        if (levels.size > 0) params.set("levels", [...levels].join(","));
        params.set("streakCategory", streakCategory);
        if (streakDirection !== "any") params.set("streakDirection", streakDirection);
        if (minStreak > 0) params.set("minStreak", String(minStreak));
        if (maFilterLine !== "any") {
          params.set("maLine", String(maFilterLine));
          params.set("maDirection", maFilterDirection);
        }
        params.set("sortDir", sortDir);
        params.set("offset", String((page - 1) * PAGE_SIZE));
        params.set("limit", String(PAGE_SIZE));

        fetch(`/api/market?${params.toString()}`)
          .then((res) => res.json())
          .then((data) => {
            if (cancelled) return;
            setCards(data.cards ?? []);
            setTotal(data.total ?? 0);
          })
          .finally(() => {
            if (!cancelled) setLoading(false);
          });
      },
      query !== "" ? 250 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [query, markets, levels, streakCategory, streakDirection, minStreak, maFilterLine, maFilterDirection, sortDir, page]);

  function toggleMarket(market: Market) {
    setMarkets((prev) => {
      const next = new Set(prev);
      if (next.has(market)) next.delete(market);
      else next.add(market);
      return next;
    });
    setPage(1);
  }

  function toggleLevel(level: InstitutionalLevel) {
    setLevels((prev) => {
      const next = new Set(prev);
      if (next.has(level)) next.delete(level);
      else next.add(level);
      return next;
    });
    setPage(1);
  }

  function resetFilters() {
    setQuery("");
    setMarkets(new Set());
    setLevels(new Set());
    setStreakCategory("combined");
    setStreakDirection("any");
    setMinStreak(0);
    setMaFilterLine("any");
    setMaFilterDirection("above");
    setPage(1);
  }

  async function addStock(code: string) {
    setPendingCode(code);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (res.ok) {
        setTracked((prev) => new Set(prev).add(code));
        router.refresh();
      }
    } finally {
      setPendingCode(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setPage(1);
        }}
        placeholder="搜尋股號或名稱"
        className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
      />

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {MARKET_ORDER.map((market) => (
            <button
              key={market}
              type="button"
              onClick={() => toggleMarket(market)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                markets.has(market)
                  ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                  : "border-zinc-700 text-zinc-400 hover:border-zinc-600"
              }`}
            >
              {MARKET_LABEL[market]}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
            className="ml-auto rounded-full border border-zinc-700 px-2.5 py-1 text-xs font-medium text-zinc-400 hover:border-zinc-600"
          >
            {sortDir === "desc" ? "買超優先 ↓" : "賣超優先 ↑"}
          </button>
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          {LEVEL_ORDER.map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => toggleLevel(level)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                levels.has(level)
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
            onChange={(e) => {
              setStreakCategory(e.target.value as InstitutionalCategory);
              setPage(1);
            }}
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
            onChange={(e) => {
              setStreakDirection(e.target.value as StreakFilterDirection);
              setPage(1);
            }}
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
            onChange={(e) => {
              setMinStreak(Math.max(0, Number(e.target.value) || 0));
              setPage(1);
            }}
            className={`w-14 ${selectClass(streakFilterActive)}`}
          />
          <span>天</span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-400">
          <select
            value={maFilterLine}
            onChange={(e) => {
              setMaFilterLine(e.target.value === "any" ? "any" : (Number(e.target.value) as MaLine));
              setPage(1);
            }}
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
            onChange={(e) => {
              setMaFilterDirection(e.target.value as MaFilterDirection);
              setPage(1);
            }}
            disabled={maFilterLine === "any"}
            className={`${selectClass(maFilterActive)} disabled:opacity-50`}
          >
            <option value="above">站上</option>
            <option value="below">低於</option>
          </select>

          <span className="ml-auto text-zinc-600">
            {loading ? "查詢中…" : `共 ${total} 檔 · 第 ${page}/${totalPages} 頁`}
          </span>
          {filterActive && (
            <button type="button" onClick={resetFilters} className="text-zinc-500 hover:text-red-400">
              清除篩選
            </button>
          )}
        </div>
      </div>

      <ul className="flex flex-col gap-3">
        {cards.map((card) => (
          <WatchlistCard
            key={card.code}
            card={card}
            highlight={cardHighlight}
            actionSlot={
              tracked.has(card.code) ? (
                <span className="text-xs text-zinc-600">已追蹤</span>
              ) : (
                <button
                  type="button"
                  onClick={() => addStock(card.code)}
                  disabled={pendingCode === card.code}
                  className="rounded-full bg-emerald-500 px-3 py-1 text-xs font-medium text-zinc-950 transition-opacity disabled:opacity-60"
                >
                  + 追蹤
                </button>
              )
            }
          />
        ))}
        {!loading && cards.length === 0 && (
          <p className="py-8 text-center text-sm text-zinc-500">沒有符合條件的股票。</p>
        )}
      </ul>

      {totalPages > 1 && (
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setPage((p) => Math.max(1, p - 1));
              window.scrollTo({ top: 0 });
            }}
            disabled={loading || page <= 1}
            className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 hover:border-zinc-600 disabled:opacity-40"
          >
            ‹
          </button>
          {pageNumbers(page, totalPages).map((p, i) =>
            p === "…" ? (
              <span key={`ellipsis-${i}`} className="px-1 text-xs text-zinc-600">
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setPage(p);
                  window.scrollTo({ top: 0 });
                }}
                disabled={loading}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium ${
                  p === page
                    ? "border-emerald-500 bg-emerald-500/15 text-emerald-300"
                    : "border-zinc-700 text-zinc-400 hover:border-zinc-600"
                }`}
              >
                {p}
              </button>
            ),
          )}
          <button
            type="button"
            onClick={() => {
              setPage((p) => Math.min(totalPages, p + 1));
              window.scrollTo({ top: 0 });
            }}
            disabled={loading || page >= totalPages}
            className="rounded-md border border-zinc-700 px-2.5 py-1 text-xs text-zinc-400 hover:border-zinc-600 disabled:opacity-40"
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}
