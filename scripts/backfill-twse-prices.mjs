#!/usr/bin/env node
// Backfills price history for every TWSE (上市) stock via the free, unlimited STOCK_DAY endpoint.
// An earlier attempt fired this with high concurrency (multiple stocks x multiple months at once)
// and tripped TWSE's WAF (HiNetCDN), which started returning 403s — and even at a gentler paced
// rate, sustained volume eventually trips it again, sometimes as 428 instead of 403. This version
// runs one stock at a time, one month at a time, with a delay between requests, and backs off with
// a visible countdown on any block-looking status (403/428/429/503) instead of treating it as a
// per-stock failure.
//
// Usage: node --env-file=.env.local scripts/backfill-twse-prices.mjs

import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();

const MONTHS_BACK = 4; // matches the MA60/Bollinger warm-up buffer used elsewhere in the app
const REQUEST_DELAY_MS = 1000; // pace between individual STOCK_DAY calls — 500ms tripped the WAF after ~24 reqs; 1 req/sec confirmed safe over a 15s manual probe
const REQUEST_TIMEOUT_MS = 15_000;
const HISTORY_CAP_DAYS = 400;
const FRESHNESS_TTL_SECONDS = 4 * 60 * 60;
const BACKOFF_START_MS = 3 * 60 * 1000; // first wait on a block: 3 minutes
const BACKOFF_MAX_MS = 20 * 60 * 1000; // cap: 20 minutes

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

function rocDateToIso(roc) {
  const [yStr, mStr, dStr] = roc.split("/");
  return `${Number(yStr) + 1911}-${mStr.padStart(2, "0")}-${dStr.padStart(2, "0")}`;
}

function parseNumber(raw) {
  return Number(String(raw).replace(/,/g, ""));
}

/** One calendar month of daily OHLC for one stock. Returns {rateLimited:true} on a WAF 403. */
async function fetchStockDayMonth(code, month) {
  const yyyymm = `${month.getFullYear()}${String(month.getMonth() + 1).padStart(2, "0")}01`;
  const url = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${yyyymm}&stockNo=${encodeURIComponent(code)}`;
  let res;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    // Under heavy WAF pressure this shows up as a network-level failure (connection reset/refused)
    // rather than a clean HTTP status — treat it the same as a block: back off and retry, don't
    // give up on the stock permanently.
    return { rateLimited: true };
  }
  // The WAF has been observed blocking with multiple different status codes under load (403,
  // 428, presumably others) rather than one consistent code — treat any of that class as a
  // rate-limit signal to back off from, not a genuine per-stock failure.
  if (res.status === 403 || res.status === 428 || res.status === 429 || res.status === 503) {
    return { rateLimited: true };
  }
  if (!res.ok) return { error: `HTTP ${res.status}` };
  const json = await res.json().catch(() => null);
  if (!json || json.stat !== "OK" || !Array.isArray(json.data)) return { rows: [] };
  const rows = json.data.map((row) => ({
    date: rocDateToIso(row[0]),
    volume: parseNumber(row[1]),
    open: parseNumber(row[3]),
    high: parseNumber(row[4]),
    low: parseNumber(row[5]),
    close: parseNumber(row[6]),
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

  const twseStocks = directory.filter((s) => s.market === "TWSE");
  console.log(`共 ${twseStocks.length} 檔上市股票，開始補股價歷史（最近 ${MONTHS_BACK} 個月，逐檔逐月抓取，請求間隔 ${REQUEST_DELAY_MS}ms）...`);

  const now = new Date();
  const months = Array.from({ length: MONTHS_BACK }, (_, i) => new Date(now.getFullYear(), now.getMonth() - i, 1));

  let ok = 0;
  let failed = 0;
  let backoffMs = BACKOFF_START_MS;

  let skipped = 0;

  for (let i = 0; i < twseStocks.length; i++) {
    const stock = twseStocks[i];

    // Skip stocks a previous run of this script already backfilled recently — without this, every
    // restart redoes the whole list from scratch even though the data from last time is still
    // there (merges are additive, never lost), which makes progress look like it reset.
    const alreadyFresh = await redis.get(`history:fresh:price:${stock.code}`);
    if (alreadyFresh) {
      skipped++;
      process.stdout.write(`\r[${i + 1}/${twseStocks.length}] 已處理 ${i} 檔（成功 ${ok}／略過 ${skipped}／失敗 ${failed}） — 略過已完成：${stock.code} ${stock.name}          `);
      continue;
    }

    process.stdout.write(`\r[${i + 1}/${twseStocks.length}] 已處理 ${i} 檔（成功 ${ok}／略過 ${skipped}／失敗 ${failed}） — 目前：${stock.code} ${stock.name}          `);

    const rows = [];
    let stockFailed = false;
    for (const month of months) {
      let result = await fetchStockDayMonth(stock.code, month);
      while (result.rateLimited) {
        await waitWithCountdown(backoffMs, "TWSE 回應 403（WAF 封鎖），暫停等待");
        backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
        result = await fetchStockDayMonth(stock.code, month);
      }
      backoffMs = BACKOFF_START_MS; // reset once a request goes through cleanly
      if (result.error) {
        stockFailed = true;
        console.log(`\n[${i + 1}/${twseStocks.length}] ${stock.code} ${stock.name} 失敗：${result.error}`);
        break;
      }
      rows.push(...result.rows);
      await sleep(REQUEST_DELAY_MS);
    }

    if (stockFailed) {
      failed++;
    } else {
      await mergePriceHistory(stock.code, rows);
      ok++;
    }
  }

  console.log(`\n完成。共 ${twseStocks.length} 檔，成功 ${ok} 檔，略過(已完成) ${skipped} 檔，失敗 ${failed} 檔。`);
}

main().catch((err) => {
  console.error("\n腳本執行失敗：", err);
  process.exit(1);
});
