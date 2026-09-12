// Taiwan has no daylight saving time, so its UTC offset is a fixed +8 hours — shifting the
// timestamp by that much before reading off the UTC date components gives the Taipei calendar
// date without needing a timezone database. Used wherever "today" means the user's local
// (Taipei) day, not the server's UTC day — e.g. the check-alerts cron's per-day notification key,
// which would otherwise land on the wrong date for the ~8 hours after Taipei midnight.
const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

export function taipeiDateString(d: Date = new Date()): string {
  return new Date(d.getTime() + TAIPEI_OFFSET_MS).toISOString().slice(0, 10);
}
