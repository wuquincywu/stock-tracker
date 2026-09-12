"use client";

import { useState, useTransition } from "react";
import type { BollingerPoint, InstitutionalRow, PriceRow } from "@/lib/types";
import BollingerChart from "./BollingerChart";

const MONTH_OPTIONS = [3, 6, 12, 24];

/**
 * Stock detail page's chart + month-range buttons. The default (3 months) is whatever the server
 * already rendered — no fetch needed. Picking a larger range calls `/api/stock/[code]?months=`,
 * which live-fetches and merges into Redis on the server for anything beyond 3 months (see that
 * route) — a deliberate, explicit action instead of every page view silently hitting TWSE/FinMind.
 */
export default function StockChartSection({
  code,
  initialPrices,
  initialBands,
  institutional,
}: {
  code: string;
  initialPrices: PriceRow[];
  initialBands: BollingerPoint[];
  institutional: InstitutionalRow[];
}) {
  const [months, setMonths] = useState(3);
  const [prices, setPrices] = useState(initialPrices);
  const [bands, setBands] = useState(initialBands);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function selectMonths(next: number) {
    if (next === months || isPending) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/stock/${code}?months=${next}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        setMonths(next);
        setPrices(json.prices);
        setBands(json.bands);
      } catch {
        setError("資料抓取失敗，請稍後再試一次");
      }
    });
  }

  return (
    <div>
      {prices.length > 0 ? (
        <BollingerChart prices={prices} bands={bands} institutional={institutional} />
      ) : (
        <p className="py-12 text-center text-sm text-zinc-500">目前沒有價格資料</p>
      )}

      <div className="mt-2 flex items-center gap-2">
        {MONTH_OPTIONS.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => selectMonths(m)}
            disabled={isPending}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
              months === m ? "bg-zinc-100 text-zinc-900" : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
            }`}
          >
            {m}個月
          </button>
        ))}
        {isPending && <span className="text-xs text-zinc-500">載入中…</span>}
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
