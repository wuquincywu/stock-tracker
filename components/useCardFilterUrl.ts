"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import {
  DEFAULT_FILTER_STATE,
  filterStateToSearchParams,
  parseFilterParams,
  parsePageParam,
} from "@/lib/cardFilters";
import type { CardFilterState } from "@/lib/cardFilters";

export interface UseCardFilterUrl {
  state: CardFilterState;
  page: number;
  /** Applies a new filter/sort state and resets the page back to 1 — any filter/sort change makes
   * the previous page number meaningless. */
  setState: (next: CardFilterState) => void;
  /** Changes only the page (pager buttons), leaving the current filters untouched. */
  setPage: (page: number) => void;
  reset: () => void;
}

/**
 * Mirrors filter/sort/page state into the URL via the native History API
 * (window.history.replaceState) rather than next/navigation's router.replace — this updates the
 * address bar (and is picked up by useSearchParams on the next render, per Next's own docs on
 * syncing history calls with useSearchParams/usePathname) without triggering a server round-trip
 * for a Server Component page whose own render doesn't otherwise depend on these params. Clicking
 * a filter chip should feel instant, not wait on a fresh RSC payload.
 */
export function useCardFilterUrl(): UseCardFilterUrl {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state = useMemo(() => parseFilterParams(searchParams), [searchParams]);
  const page = useMemo(() => parsePageParam(searchParams), [searchParams]);

  const applyParams = useCallback(
    (nextState: CardFilterState, nextPage: number) => {
      const params = filterStateToSearchParams(nextState, nextPage);
      const query = params.toString();
      window.history.replaceState(null, "", query ? `${pathname}?${query}` : pathname);
    },
    [pathname],
  );

  const setState = useCallback((next: CardFilterState) => applyParams(next, 1), [applyParams]);
  const setPage = useCallback((next: number) => applyParams(state, next), [applyParams, state]);
  const reset = useCallback(() => applyParams(DEFAULT_FILTER_STATE, 1), [applyParams]);

  return { state, page, setState, setPage, reset };
}
