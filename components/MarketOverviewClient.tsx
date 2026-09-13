"use client";

import { useEffect, useRef, useState, Suspense } from "react";
import { useRouter } from "next/navigation";
import CardFilterPanel from "@/components/CardFilterPanel";
import { useCardFilterUrl } from "@/components/useCardFilterUrl";
import WatchlistCard, { type CardHighlight } from "@/components/WatchlistCard";
import type { StockOption } from "@/components/StockSearchInput";
import { filterStateToSearchParams, isFilterActive, isStreakFilterActive } from "@/lib/cardFilters";
import { MARKET_LABEL } from "@/lib/types";
import type { WatchlistCardData } from "@/lib/types";

const SUGGEST_DEBOUNCE_MS = 250;
const QUERY_COMMIT_DEBOUNCE_MS = 250;
const PAGE_SIZE = 50;

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

function MarketOverviewFilterable({
  initialCards,
  initialTotal,
  trackedCodes,
}: {
  initialCards: WatchlistCardData[];
  initialTotal: number;
  trackedCodes: string[];
}) {
  const router = useRouter();
  const { state, page, setState, setPage, reset } = useCardFilterUrl();

  const [cards, setCards] = useState(initialCards);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [tracked, setTracked] = useState<Set<string>>(new Set(trackedCodes));
  const [pendingCode, setPendingCode] = useState<string | null>(null);

  // The text field updates instantly on every keystroke; committing it into `state` (and thus the
  // URL + /api/market fetch below) is debounced separately, same as the old behavior. This is only
  // ever written to from user typing, picking a suggestion, or "清除篩選" — not re-synced from
  // `state.query` when it changes some other way (e.g. the browser back/forward buttons), which
  // would require either a setState-in-effect or a ref read during render, both of which this
  // project's lint config forbids. Worst case the box's text and the actually-applied filter
  // (which does always follow the URL correctly) briefly disagree until the user types again.
  const [queryInput, setQueryInput] = useState(state.query);

  // Autocomplete dropdown for the search box — same UX as StockSearchInput on the watchlist page
  // (type to see matching stocks), except choosing one filters this page's list down to it instead
  // of adding it to the watchlist (each card already has its own "+ 追蹤" button for that).
  const [suggestOptions, setSuggestOptions] = useState<StockOption[]>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestHighlighted, setSuggestHighlighted] = useState(0);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  const filterActive = isFilterActive(state);
  const streakFilterActive = isStreakFilterActive(state);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const cardHighlight: CardHighlight = {
    levels: state.levels,
    streakCategory: streakFilterActive ? state.streakCategory : null,
    maLine: state.maLine !== "any" ? state.maLine : null,
  };

  // Commits the debounced query text into the shared filter state (resets to page 1, like any
  // other filter change).
  useEffect(() => {
    if (queryInput === state.query) return;
    const handle = setTimeout(() => {
      setState({ ...state, query: queryInput });
    }, QUERY_COMMIT_DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when the debounced text itself changes
  }, [queryInput]);

  // Fetches the current filtered/sorted/paginated page from the server whenever the URL-backed
  // filter/sort/page state changes. Skipped on the very first render — the server already computed
  // a matching initial page from the same URL, so refetching immediately would just repeat that
  // work (see app/market/page.tsx).
  const isFirstRun = useRef(true);
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    let cancelled = false;
    setLoading(true);
    const params = filterStateToSearchParams(state, page);
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
    return () => {
      cancelled = true;
    };
  }, [state, page]);

  // Suggestion dropdown fetch — independent of the filter fetch above (different endpoint, own
  // debounce, reacts to the un-debounced queryInput so it feels instant while typing).
  useEffect(() => {
    const trimmed = queryInput.trim();
    if (!trimmed) return; // the input's onChange already clears suggestOptions/suggestOpen when the field empties
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/stocks/search?q=${encodeURIComponent(trimmed)}`);
        const data = (await res.json()) as { results?: StockOption[] };
        if (cancelled) return;
        const results = data.results ?? [];
        setSuggestOptions(results);
        setSuggestOpen(results.length > 0);
        setSuggestHighlighted(0);
      } catch {
        if (!cancelled) {
          setSuggestOptions([]);
          setSuggestOpen(false);
        }
      }
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [queryInput]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setSuggestOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function selectSuggestion(option: StockOption) {
    setQueryInput(option.code);
    setSuggestOptions([]);
    setSuggestOpen(false);
    setState({ ...state, query: option.code });
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!suggestOpen || suggestOptions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSuggestHighlighted((h) => (h + 1) % suggestOptions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSuggestHighlighted((h) => (h - 1 + suggestOptions.length) % suggestOptions.length);
    } else if (e.key === "Escape") {
      setSuggestOpen(false);
    } else if (e.key === "Enter") {
      e.preventDefault();
      selectSuggestion(suggestOptions[suggestHighlighted]);
    }
  }

  function handleResetFilters() {
    setQueryInput("");
    setSuggestOptions([]);
    setSuggestOpen(false);
    reset();
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

  function goToPage(next: number) {
    setPage(Math.min(totalPages, Math.max(1, next)));
    window.scrollTo({ top: 0 });
  }

  return (
    <div className="flex flex-col gap-4">
      <div ref={searchContainerRef} className="relative">
        <input
          value={queryInput}
          onChange={(e) => {
            const value = e.target.value;
            setQueryInput(value);
            if (!value.trim()) {
              setSuggestOptions([]);
              setSuggestOpen(false);
            }
          }}
          onKeyDown={handleSearchKeyDown}
          onFocus={() => suggestOptions.length > 0 && setSuggestOpen(true)}
          placeholder="輸入股號或名稱，例如 2330 或 台積電"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
        {suggestOpen && (
          <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-lg">
            {suggestOptions.map((option, i) => (
              <li key={option.code}>
                <button
                  type="button"
                  onClick={() => selectSuggestion(option)}
                  onMouseEnter={() => setSuggestHighlighted(i)}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                    i === suggestHighlighted ? "bg-zinc-800" : ""
                  }`}
                >
                  <span>{option.name}</span>
                  <span className="text-xs text-zinc-500">
                    {option.code} · {MARKET_LABEL[option.market]}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <CardFilterPanel
        state={state}
        onChange={setState}
        onReset={handleResetFilters}
        filterActive={filterActive}
        summary={loading ? "查詢中…" : `共 ${total} 檔 · 第 ${page}/${totalPages} 頁`}
      />

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
            onClick={() => goToPage(page - 1)}
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
                onClick={() => goToPage(p)}
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
            onClick={() => goToPage(page + 1)}
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

/** See WatchlistClient.tsx's identical Suspense wrapper doc comment — useCardFilterUrl needs one,
 * and this page is force-dynamic (cookie-gated) so the fallback never actually shows. */
export default function MarketOverviewClient(props: {
  initialCards: WatchlistCardData[];
  initialTotal: number;
  trackedCodes: string[];
}) {
  return (
    <Suspense fallback={null}>
      <MarketOverviewFilterable {...props} />
    </Suspense>
  );
}
