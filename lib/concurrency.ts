/**
 * Runs `fn` over `items`, `size` at a time (each batch fully awaited before the next starts)
 * instead of one `Promise.all` across the whole array — bounds how many concurrent calls (usually
 * external HTTP requests) are in flight at once. Previously defined twice (lib/alerts.ts and
 * lib/marketdata.ts had identical copies); also used by lib/twse.ts to bound how many STOCK_DAY
 * month-requests run in parallel for a single stock.
 */
export async function chunkedMap<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const batch = items.slice(i, i + size);
    results.push(...(await Promise.all(batch.map(fn))));
  }
  return results;
}

/** Splits `items` into consecutive groups of at most `size` — used by lib/redis.ts to split the
 * "所有股票" market-cards cache across several Redis values instead of one giant one (see
 * MARKET_CARDS_CHUNK_SIZE's doc comment). Always returns at least one (possibly empty) chunk. */
export function chunkArray<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [[]];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}
