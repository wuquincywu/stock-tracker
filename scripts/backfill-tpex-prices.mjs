#!/usr/bin/env node
// Backfills price history for every TPEX (上櫃) stock via FinMind, since TPEX has no free
// per-stock history endpoint (unlike TWSE's STOCK_DAY). FinMind's documented free tier is
// "300 req/hr, 600/hr with a token", but observed behavior is actually a small burst bucket that
// empties after a handful of requests and refills within roughly a minute or two — NOT a clean
// hourly window. So instead of tracking a 300/hr sliding window (which would wait up to a full
// hour on the first 402, far longer than actually necessary), this paces every request with a
// small fixed delay and, on a 402, backs off with a short-then-growing wait — showing a live
// countdown on screen the whole time — and retries.
//
// Usage: node --env-file=.env.local scripts/backfill-tpex-prices.mjs

import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

const FINMIND_BASE = "https://api.finmindtrade.com/api/v4/data";
const FINMIND_TOKEN = process.env.FINMIND_TOKEN || "";
const MONTHS_BACK = 4; // matches the MA60/Bollinger warm-up buffer used elsewhere in the app
const HISTORY_CAP_DAYS = 400;
const FRESHNESS_TTL_SECONDS = 4 * 60 * 60;
const REQUEST_TIMEOUT_MS = 15_000;
const REQUEST_DELAY_MS = 400; // pace between successful requests, to avoid re-tripping the burst limit
const BACKOFF_START_MS = 20 * 1000; // first wait on a 402: 20s (observed recovery is fast, ~1-2 min)
const BACKOFF_MAX_MS = 5 * 60 * 1000; // cap: 5 minutes

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

async function fetchFinMindPrice(code, startDate, endDate) {
  const qs = new URLSearchParams({
    dataset: "TaiwanStockPrice",
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
    // Treat a network-level failure the same as a rate-limit block: back off and retry rather
    // than giving up on the stock permanently.
    return { rateLimited: true };
  }

  if (res.status === 429) return { rateLimited: true };
  const json = await res.json().catch(() => null);
  if (json && json.status === 402) return { rateLimited: true }; // FinMind's quota-exceeded status
  if (!res.ok || !json || json.status !== 200) {
    return { error: json?.msg ?? `HTTP ${res.status}` };
  }

  const rows = (json.data ?? []).map((r) => ({
    date: r.date,
    open: r.open,
    high: r.max,
    low: r.min,
    close: r.close,
    volume: r.Trading_Volume,
  }));
  return { rows };
}

async function mergePriceHistory(code, freshRows) {
  if (freshRows.length === 0) return;
  const key = `history:price:${code}`;
  const existing = (await redis.get(key)) ?? [];
  const byDate = new Map(existing.map((r) => [r.date, r]));
  for (const row of freshRows) byDate.set(row.date, row);
  const merged = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-HISTORY_CAP_DAYS);
  await redis.set(key, merged);
  await redis.set(`history:fresh:price:${code}`, 1, { ex: FRESHNESS_TTL_SECONDS });
}

async function main() {
  console.log("讀取股票清單...");
  const directory = await redis.get("cache:stockDirectory");
  if (!Array.isArray(directory) || directory.length === 0) {
    console.error("找不到股票清單快取（cache:stockDirectory）。請先在網站上開啟一次「所有股票」頁面讓它建立快取，再重新執行這個腳本。");
    process.exit(1);
  }

  const tpexStocks = directory.filter((s) => s.market === "TPEX");
  console.log(`共 ${tpexStocks.length} 檔上櫃股票，開始補股價歷史（最近 ${MONTHS_BACK} 個月）...`);

  const end = new Date();
  const start = new Date(end);
  start.setMonth(start.getMonth() - MONTHS_BACK);
  const startDate = start.toISOString().slice(0, 10);
  const endDate = end.toISOString().slice(0, 10);

  let ok = 0;
  let failed = 0;
  let skipped = 0;
  let backoffMs = BACKOFF_START_MS;

  for (let i = 0; i < tpexStocks.length; i++) {
    const stock = tpexStocks[i];

    // Skip stocks a previous run already backfilled recently — the data from last time is still
    // there (merges are additive), this just avoids redoing the whole list from scratch on restart.
    const alreadyFresh = await redis.get(`history:fresh:price:${stock.code}`);
    if (alreadyFresh) {
      skipped++;
      process.stdout.write(`\r[${i + 1}/${tpexStocks.length}] 已處理 ${i} 檔（成功 ${ok}／略過 ${skipped}／失敗 ${failed}） — 略過已完成：${stock.code} ${stock.name}          `);
      continue;
    }

    process.stdout.write(`\r[${i + 1}/${tpexStocks.length}] 已處理 ${i} 檔（成功 ${ok}／略過 ${skipped}／失敗 ${failed}） — 目前：${stock.code} ${stock.name}          `);

    let result = await fetchFinMindPrice(stock.code, startDate, endDate);
    while (result.rateLimited) {
      await waitWithCountdown(backoffMs, "已達 FinMind 額度上限，暫停等待");
      backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
      result = await fetchFinMindPrice(stock.code, startDate, endDate);
    }
    backoffMs = BACKOFF_START_MS; // reset once a request goes through cleanly

    if (result.error) {
      failed++;
      console.log(`\n[${i + 1}/${tpexStocks.length}] ${stock.code} ${stock.name} 失敗：${result.error}`);
    } else {
      await mergePriceHistory(stock.code, result.rows);
      ok++;
    }
    await sleep(REQUEST_DELAY_MS);
  }

  console.log(`\n完成。共 ${tpexStocks.length} 檔，成功 ${ok} 檔，略過(已完成) ${skipped} 檔，失敗 ${failed} 檔。`);
}

main().catch((err) => {
  console.error("\n腳本執行失敗：", err);
  process.exit(1);
});
