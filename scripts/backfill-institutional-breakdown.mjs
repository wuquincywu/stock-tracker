#!/usr/bin/env node
// Backfills the REAL 外資／投信／自營商 breakdown (via FinMind) for EVERY stock in both markets,
// overwriting the combined-only placeholder rows that the free T86/TPEX bulk backfill produced
// (those sources only ever give a single combined total, with no per-category split — see
// backfillMarketInstitutional in lib/marketdata.ts). Same pacing/backoff pattern as the price
// backfill scripts, since this also goes through FinMind's per-stock endpoint.
//
// Uses its own skip-marker (separate from the app's regular `history:fresh:institutional:{code}`
// key, which is already set for every stock from the earlier bulk pass and would make every stock
// look "done" if reused here) so restarts skip only what THIS script has already fixed.
//
// Usage: node --env-file=.env.local scripts/backfill-institutional-breakdown.mjs

import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

const FINMIND_BASE = "https://api.finmindtrade.com/api/v4/data";
const FINMIND_TOKEN = process.env.FINMIND_TOKEN || "";
const DAYS_BACK = 60; // calendar days — enough buffer for ~40 trading days, matching the level/streak baseline
const HISTORY_CAP_DAYS = 400;
const REQUEST_TIMEOUT_MS = 15_000;
const REQUEST_DELAY_MS = 400;
const BACKOFF_START_MS = 20 * 1000;
const BACKOFF_MAX_MS = 5 * 60 * 1000;
const DONE_MARKER_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days — this is a one-off correction, not routine freshness

const FOREIGN_CATEGORIES = new Set(["Foreign_Investor", "Foreign_Dealer_Self"]);
const TRUST_CATEGORIES = new Set(["Investment_Trust"]);
const DEALER_CATEGORIES = new Set(["Dealer_self", "Dealer_Hedging"]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fmtDuration(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

async function waitWithCountdown(ms, label) {
  const target = Date.now() + ms;
  while (Date.now() < target) {
    process.stdout.write(`\r${label}... 剩餘 ${fmtDuration(target - Date.now())}   `);
    await sleep(1000);
  }
  process.stdout.write(`\r${" ".repeat(70)}\r`);
}

async function fetchFinMindInstitutional(code, startDate, endDate) {
  const qs = new URLSearchParams({
    dataset: "TaiwanStockInstitutionalInvestorsBuySell",
    data_id: code,
    start_date: startDate,
    end_date: endDate,
  }).toString();
  const tokenParam = FINMIND_TOKEN ? `&token=${encodeURIComponent(FINMIND_TOKEN)}` : "";

  let res;
  try {
    res = await fetch(`${FINMIND_BASE}?${qs}${tokenParam}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    return { rateLimited: true };
  }

  if (res.status === 429) return { rateLimited: true };
  const json = await res.json().catch(() => null);
  if (json && json.status === 402) return { rateLimited: true };
  if (!res.ok || !json || json.status !== 200) {
    return { error: json?.msg ?? `HTTP ${res.status}` };
  }

  const byDate = new Map();
  for (const r of json.data ?? []) {
    const net = r.buy - r.sell;
    const entry = byDate.get(r.date) ?? { date: r.date, foreignNet: 0, investmentTrustNet: 0, dealerNet: 0 };
    if (FOREIGN_CATEGORIES.has(r.name)) entry.foreignNet += net;
    else if (TRUST_CATEGORIES.has(r.name)) entry.investmentTrustNet += net;
    else if (DEALER_CATEGORIES.has(r.name)) entry.dealerNet += net;
    byDate.set(r.date, entry);
  }
  return { rows: [...byDate.values()] };
}

async function mergeInstitutionalHistory(code, freshRows) {
  if (freshRows.length === 0) return;
  const key = `history:institutional:${code}`;
  const existing = (await redis.get(key)) ?? [];
  const byDate = new Map(existing.map((r) => [r.date, r]));
  for (const row of freshRows) byDate.set(row.date, row); // real breakdown overwrites the combined-only placeholder
  const merged = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-HISTORY_CAP_DAYS);
  await redis.set(key, merged);
}

async function main() {
  console.log("讀取股票清單...");
  const directory = await redis.get("cache:stockDirectory");
  if (!Array.isArray(directory) || directory.length === 0) {
    console.error("找不到股票清單快取（cache:stockDirectory）。請先在網站上開啟一次「所有股票」頁面讓它建立快取，再重新執行這個腳本。");
    process.exit(1);
  }

  console.log(`共 ${directory.length} 檔股票，開始補三大法人拆分數字（外資／投信／自營商，最近 ${DAYS_BACK} 天）...`);

  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - DAYS_BACK);
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);

  let ok = 0;
  let failed = 0;
  let skipped = 0;
  let backoffMs = BACKOFF_START_MS;

  for (let i = 0; i < directory.length; i++) {
    const stock = directory[i];

    const doneMarkerKey = `history:institutional:breakdown-done:${stock.code}`;
    const alreadyDone = await redis.get(doneMarkerKey);
    if (alreadyDone) {
      skipped++;
      process.stdout.write(`\r[${i + 1}/${directory.length}] 已處理 ${i} 檔（成功 ${ok}／略過 ${skipped}／失敗 ${failed}） — 略過已完成：${stock.code} ${stock.name}          `);
      continue;
    }

    process.stdout.write(`\r[${i + 1}/${directory.length}] 已處理 ${i} 檔（成功 ${ok}／略過 ${skipped}／失敗 ${failed}） — 目前：${stock.code} ${stock.name}          `);

    let result = await fetchFinMindInstitutional(stock.code, startDate, endDate);
    while (result.rateLimited) {
      await waitWithCountdown(backoffMs, "已達 FinMind 額度上限，暫停等待");
      backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
      result = await fetchFinMindInstitutional(stock.code, startDate, endDate);
    }
    backoffMs = BACKOFF_START_MS;

    if (result.error) {
      failed++;
      console.log(`\n[${i + 1}/${directory.length}] ${stock.code} ${stock.name} 失敗：${result.error}`);
    } else {
      await mergeInstitutionalHistory(stock.code, result.rows);
      await redis.set(doneMarkerKey, 1, { ex: DONE_MARKER_TTL_SECONDS });
      ok++;
    }
    await sleep(REQUEST_DELAY_MS);
  }

  console.log(`\n完成。共 ${directory.length} 檔，成功 ${ok} 檔，略過(已完成) ${skipped} 檔，失敗 ${failed} 檔。`);
}

main().catch((err) => {
  console.error("\n腳本執行失敗：", err);
  process.exit(1);
});
