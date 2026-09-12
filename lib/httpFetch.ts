const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 500;

// TWSE's WAF returns 403 (or other unexpected statuses) on burst traffic; FinMind's free quota is
// a small bucket that refills in ~1-2 minutes once exhausted (surfaces as 429). Both are transient
// and worth a short retry instead of failing the whole page/backfill on one bad request.
const RETRYABLE_STATUS = new Set([403, 429, 500, 502, 503, 504]);

export const USER_AGENT = "Mozilla/5.0";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface FetchWithRetryOptions {
  /** Identifies the call site in retry/failure logs, e.g. "TWSE STOCK_DAY 2330". */
  label: string;
  timeoutMs?: number;
  retries?: number;
  baseDelayMs?: number;
}

/**
 * fetch() with a per-attempt timeout and a few retries (exponential backoff + jitter) for
 * transient failures. Non-retryable HTTP statuses (e.g. 404) are returned on the first attempt
 * without retrying — callers decide how to interpret those (some treat a holiday's empty response
 * as a normal `[]`, not an error), so this only ever short-circuits status codes it recognizes as
 * likely-transient (see RETRYABLE_STATUS).
 */
export async function fetchWithRetry(url: string, init: RequestInit, options: FetchWithRetryOptions): Promise<Response> {
  const { label, timeoutMs = DEFAULT_TIMEOUT_MS, retries = DEFAULT_RETRIES, baseDelayMs = DEFAULT_BASE_DELAY_MS } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
      if (res.ok || !RETRYABLE_STATUS.has(res.status) || attempt === retries) return res;
      lastError = new Error(`${label} HTTP ${res.status}`);
    } catch (err) {
      lastError = err;
      if (attempt === retries) break;
    }
    const delay = baseDelayMs * 2 ** attempt + Math.random() * baseDelayMs;
    console.error(`[${label}] attempt ${attempt + 1}/${retries + 1} failed, retrying in ${Math.round(delay)}ms:`, lastError);
    await sleep(delay);
  }
  console.error(`[${label}] failed after ${retries + 1} attempts:`, lastError);
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
