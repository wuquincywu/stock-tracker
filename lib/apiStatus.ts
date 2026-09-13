import * as finmind from "./finmind";
import { getRegisteredUsers } from "./redis";
import * as tdcc from "./tdcc";
import * as tpex from "./tpex";
import * as twse from "./twse";

export interface ApiStatusCheckResult {
  name: string;
  ok: boolean;
  latencyMs: number;
  error?: string;
}

async function timed(name: string, fn: () => Promise<unknown>): Promise<ApiStatusCheckResult> {
  const start = Date.now();
  try {
    await fn();
    return { name, ok: true, latencyMs: Date.now() - start };
  } catch (err) {
    return { name, ok: false, latencyMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
  }
}

// A known, always-listed real stock for the per-source probes below — picking one real code (2330)
// keeps each check honest (a genuine round-trip against that source, not just "did DNS resolve")
// while staying cheap: a single-stock/single-month call, not a whole-market fetch, for the two
// sources (TWSE, FinMind) that support that. TPEX/TDCC's own free APIs only offer whole-market
// snapshots (see their own doc comments), so those two checks are inherently heavier — acceptable
// here since this page is only ever opened manually, not polled.
const PROBE_CODE = "2330";

/**
 * Round-trips against Redis and every external data source this app depends on, each independently
 * timed and error-isolated (one source failing doesn't block checking the others) — for the
 * /api-status page. Nothing here is cached: every visit is a live check, by design (the whole point
 * is "is it working right now").
 */
export async function runApiStatusChecks(): Promise<ApiStatusCheckResult[]> {
  const checks: { name: string; fn: () => Promise<unknown> }[] = [
    { name: "Redis", fn: () => getRegisteredUsers() },
    { name: "TWSE（上市價格）", fn: () => twse.getPriceHistory(PROBE_CODE, 1) },
    { name: "TPEX（上櫃清單）", fn: () => tpex.getAllSecurities() },
    { name: "TPEX（興櫃行情）", fn: () => tpex.getEmergingDailyQuotes() },
    { name: "FinMind", fn: () => finmind.lookupStock(PROBE_CODE) },
    { name: "TDCC（集保股權分散表）", fn: () => tdcc.getShareholderConcentrationSnapshot() },
  ];
  return Promise.all(checks.map((c) => timed(c.name, c.fn)));
}
