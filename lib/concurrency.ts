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
