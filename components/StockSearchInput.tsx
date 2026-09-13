"use client";

import { useEffect, useRef, useState } from "react";
import Button from "@/components/ui/Button";
import { MARKET_LABEL } from "@/lib/types";
import type { Market } from "@/lib/types";

export interface StockOption {
  code: string;
  name: string;
  market: Market;
}

const DEBOUNCE_MS = 250;

export default function StockSearchInput({
  onAdd,
  submitting,
}: {
  onAdd: (code: string) => void;
  submitting: boolean;
}) {
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<StockOption[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/stocks/search?q=${encodeURIComponent(trimmed)}`);
        const data = (await res.json()) as { results?: StockOption[] };
        if (cancelled) return;
        const results = data.results ?? [];
        setOptions(results);
        setOpen(results.length > 0);
        setHighlighted(0);
      } catch {
        if (!cancelled) {
          setOptions([]);
          setOpen(false);
        }
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function choose(option: StockOption) {
    setQuery("");
    setOptions([]);
    setOpen(false);
    onAdd(option.code);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (open && options.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlighted((h) => (h + 1) % options.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlighted((h) => (h - 1 + options.length) % options.length);
        return;
      }
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (open && options.length > 0) {
        choose(options[highlighted]);
      } else if (query.trim()) {
        const trimmed = query.trim();
        setQuery("");
        onAdd(trimmed);
      }
    }
  }

  function handleSubmitClick() {
    if (open && options.length > 0) {
      choose(options[highlighted]);
    } else if (query.trim()) {
      const trimmed = query.trim();
      setQuery("");
      onAdd(trimmed);
    }
  }

  return (
    <div ref={containerRef} className="relative flex gap-2">
      <div className="relative flex-1">
        <input
          value={query}
          onChange={(e) => {
            const value = e.target.value;
            setQuery(value);
            if (!value.trim()) {
              setOptions([]);
              setOpen(false);
            }
          }}
          onKeyDown={handleKeyDown}
          onFocus={() => options.length > 0 && setOpen(true)}
          placeholder="輸入股號或名稱，例如 2330 或 台積電"
          className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-emerald-500"
        />
        {open && (
          <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900 shadow-lg">
            {options.map((option, i) => (
              <li key={option.code}>
                <button
                  type="button"
                  onClick={() => choose(option)}
                  onMouseEnter={() => setHighlighted(i)}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm ${
                    i === highlighted ? "bg-zinc-800" : ""
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
      <Button type="button" onClick={handleSubmitClick} disabled={submitting}>
        {submitting ? "新增中…" : "新增"}
      </Button>
    </div>
  );
}
