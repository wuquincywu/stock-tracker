/**
 * Merges `fresh` rows into `existing` (same-date rows are overwritten by `fresh`), sorts
 * chronologically, and caps the result to the most recent `capDays` rows. Pure — no Redis
 * dependency — so it's directly unit-testable; lib/redis.ts's mergeStoredPriceHistory and
 * mergeStoredInstitutionalHistory are thin Redis-IO wrappers around this same logic, which used to
 * be duplicated between them.
 */
export function mergeHistory<T extends { date: string }>(existing: T[], fresh: T[], capDays: number): T[] {
  const byDate = new Map(existing.map((r) => [r.date, r]));
  for (const row of fresh) byDate.set(row.date, row);
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-capDays);
}
