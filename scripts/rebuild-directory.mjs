#!/usr/bin/env node
// One-off: rebuild the cached stock directory (cache:stockDirectory) directly, bypassing the app's
// request cycle (which silently swallows the fetch failure and returns an empty result). Retries
// FinMind's bulk TaiwanStockInfo call with the same short backoff as the other backfill scripts,
// since it's rate-limited the same way. Filters out warrants (industry_category "所有證券"), same
// as lib/finmind.ts's getAllStocks().
//
// Usage: node --env-file=.env.local scripts/rebuild-directory.mjs

import { Redis } from "@upstash/redis";

const redis = Redis.fromEnv();
const FINMIND_TOKEN = process.env.FINMIND_TOKEN || "";
const BACKOFF_START_MS = 20 * 1000;
const BACKOFF_MAX_MS = 5 * 60 * 1000;
const STOCK_DIRECTORY_TTL_SECONDS = 24 * 60 * 60;
const NON_STOCK_CATEGORY = "所有證券";

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

async function main() {
  const tokenParam = FINMIND_TOKEN ? `&token=${encodeURIComponent(FINMIND_TOKEN)}` : "";
  let backoffMs = BACKOFF_START_MS;
  let json = null;

  while (!json) {
    console.log("正在抓取完整股票清單 (FinMind TaiwanStockInfo)...");
    const res = await fetch(`https://api.finmindtrade.com/api/v4/data?dataset=TaiwanStockInfo${tokenParam}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(30_000),
    });
    const body = await res.json().catch(() => null);
    if (body && body.status === 200) {
      json = body;
      break;
    }
    await waitWithCountdown(backoffMs, `取得失敗（${body?.msg ?? res.status}），暫停等待`);
    backoffMs = Math.min(backoffMs * 2, BACKOFF_MAX_MS);
  }

  const byCode = new Map();
  for (const r of json.data) {
    if (r.industry_category === NON_STOCK_CATEGORY) continue;
    if (byCode.has(r.stock_id)) continue;
    byCode.set(r.stock_id, { code: r.stock_id, name: r.stock_name, market: r.type === "twse" ? "TWSE" : "TPEX" });
  }
  const directory = [...byCode.values()];
  const twseCount = directory.filter((d) => d.market === "TWSE").length;
  const tpexCount = directory.filter((d) => d.market === "TPEX").length;

  await redis.set("cache:stockDirectory", directory, { ex: STOCK_DIRECTORY_TTL_SECONDS });
  console.log(`完成。共 ${directory.length} 檔（上市 ${twseCount}、上櫃 ${tpexCount}），已寫入 cache:stockDirectory。`);
}

main().catch((err) => {
  console.error("\n腳本執行失敗：", err);
  process.exit(1);
});
