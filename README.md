# stock-tracker

A Taiwan stock (TWSE listed + TPEX OTC) tracking PWA for a small trusted group (family/friends, under 5 people) — not a public product. Track stocks by code, see price/moving averages/Bollinger Bands, 三大法人 (foreign investors / investment trusts / dealers) net buy-sell with the per-category breakdown, and consecutive buy/sell streaks. Get browser push notifications when a stock crosses a moving average, its institutional flow hits a classification tier, or a buy/sell streak reaches a threshold. There's also an "All Stocks" browse page covering the whole market (~2,400 tickers including ETFs), using the same filters and card layout as the watchlist.

**Live**: https://stock-tracker-gray-beta.vercel.app

No sign-up, no passwords — the first visit shows a "who are you" screen where you either pick an existing name or type a new one to join. That name is then remembered on the device via a cookie. Each person's watchlist, push subscription, and notification settings are fully independent; things that aren't personal (the stock directory, price/institutional history, the market-wide card cache) are shared by everyone. See "Multi-user model" below.

## Features

### Watchlist (`/`)
- Search by code or Chinese name and add to your watchlist (`components/StockSearchInput.tsx`, autocomplete dropdown)
- Each card shows: latest price and % change, MA5/MA20/MA60 above/below state, Bollinger relative-strength badge, 三大法人 classification tier (big sell → big buy), and four streak badges (foreign / trust / dealer / combined consecutive buy or sell days)
- Filter panel: market, institutional tier, streak (category + direction + minimum days), MA above/below (MA5/20/60)
- The badge that matched an active filter gets an amber border so it's obvious why a card is showing

### All Stocks (`/market`)
- The whole market, ~2,400 tickers (TWSE + TPEX, ETFs included, warrants excluded), same card layout as the watchlist
- Autocomplete search (same UX as the watchlist's search — type to see a dropdown of matches; picking one filters the list down to that stock), market/tier/streak/MA filters, sorted by stock code, standard pagination (50 per page)
- Filtering/sorting/pagination all happen server-side (`/api/market`) — the browser never has to hold the full ~2,400-card dataset

### Stock Detail (`/stock/[code]`)
- Candlestick chart + MA20 + Bollinger upper/lower bands, with a combined 三大法人 net buy-sell bar chart underneath (red = buy, green = sell)
- Bollinger %b, bandwidth, and squeeze signal badges
- 三大法人 history table (foreign / trust / dealer / combined, last 10 days)
- Chart defaults to 3 months and is read-only (no live fetch); buttons below it (`components/StockChartSection.tsx`) let you switch to 6/12/24 months — only requesting more than 3 months triggers a live fetch that also gets merged back into Redis

### Notifications (`/notifications`)
- Shows what triggered today, one entry per stock, each condition colored red (buy/above) or green (sell/below); an MA alert that's a genuine crossing moment (flipped from yesterday, not just still on the same side) gets an outline around it
- Opening this page marks today as read, which clears the red dot on the "通知" tab and the PWA home-screen icon badge (`components/ClearAppBadge.tsx`)
- The push notification itself is a lightweight "N stocks triggered today, tap for details" nudge — the actual detail always lives here, so it's visible even if the push never arrives (permission not granted, app closed, etc.)

### Settings (`/settings`)
- Toggle which 三大法人 tiers (big sell → big buy) trigger a notification
- Independent streak-day thresholds for foreign / trust / dealer / combined (0 disables that category)
- Independent toggles for MA5/20/60 above/below
- Chart months (1–24) for your own watchlist card calculations — this is per-user; the All Stocks page uses a fixed shared value since its card cache isn't per-user
- A "測試通知" (test notification) button: immediately re-runs the full check → notify pipeline for your own watchlist right now. A real qualifying alert gets pushed as usual; if nothing currently qualifies, a distinct confirmation push is sent instead, so pressing it always produces a visible result

### FAQ (`/faq`)
How every indicator/threshold is actually computed, including an honest note that the big-buy/big-sell z-score cutoffs are made up, not an industry standard.

### Multi-user model
- No identity cookie yet → `app/layout.tsx` blocks every page and renders a "who are you" picker (`components/UserPicker.tsx`) instead — pick an existing name or type a new one (no password)
- Chosen name is written to a 1-year cookie; `components/UserSwitcher.tsx` in the header lets you switch identities
- Per-user data: watchlist, push subscription, alert settings, notification history/read-state. Shared data: stock directory, price/institutional history, the market-cards cache, the MA-line config (never had a per-user UI to begin with)
- `scripts/migrate-to-multiuser.mjs` was a one-time script (already run against production) that moved the pre-multi-user global watchlist/subscription/settings data to a user named "Admin"

## Tech stack

**Framework**: Next.js 16 (App Router + TypeScript, Turbopack), React 19, Tailwind CSS v4
**Database**: Upstash Redis (`@upstash/redis`, REST interface)
**Charts**: `lightweight-charts` (TradingView)
**Push**: Web Push (`web-push` package) + a hand-written Service Worker (`public/sw.js`)
**Hosting**: Vercel (Hobby plan)

```
app/
  layout.tsx                    Root layout — blocks all children behind UserPicker if no user cookie
  actions.ts                    Server actions: selectUser / addUser / switchUser
  page.tsx                      Watchlist (home)
  market/page.tsx                All Stocks browse page
  stock/[code]/page.tsx          Stock detail (read-only, never live-fetches)
  notifications/page.tsx         Today's notification detail + read-state marking
  settings/page.tsx              Notification settings + test-notification button
  faq/page.tsx
  loading.tsx / */loading.tsx    Per-route loading skeletons (with aria-live for screen readers)
  api/
    watchlist/                  Watchlist CRUD
    stock/[code]/                Stock data API — read-only by default; `?months=` over 3 triggers a live fetch
    stocks/search/               Stock search (autocomplete, used by both the watchlist and market pages)
    market/                     Filter/sort/pagination API for the All Stocks page
    settings/                   Read/write notification settings
    notifications/test/          On-demand "測試通知" endpoint (Settings page button)
    push/subscribe|unsubscribe/  Web Push subscription management
    cron/check-alerts/           Daily schedule: live-refreshes every registered user's watchlist and notifies
    admin/backfill-market/       Manual market-wide backfill trigger (see "Market-wide backfill" below); CRON_SECRET-protected, time-budgeted to Vercel Hobby's 60s cap
lib/
  types.ts                      Shared types (including WatchlistCardData, NotificationPart)
  indicators.ts                 Pure functions: MA, Bollinger, institutional tier, streaks (unit-tested in indicators.test.ts)
  alerts.ts                     processUserAlerts — the check→notify pipeline shared by the cron and the test-notification endpoint
  marketdata.ts                 Data access entry point: per-market source dispatch, getChartSeries (warm-up buffer + Bollinger calc), market-cards cache, market-wide backfill (all shared, not per-user)
  httpFetch.ts                  Shared fetch-with-retry/backoff wrapper — every TWSE/TPEX/FinMind call goes through this
  twse.ts / tpex.ts / finmind.ts  Per-source API clients
  redis.ts                      All Redis reads/writes. Per-user functions (watchlist, push subscription, alert settings, notification history) take a userId as their first argument; market-wide data (stock directory, history, card cache) doesn't
  users.ts                      Current-device identity lookup (cookie + registry check), wrapped in React's cache() so one request only pays for one lookup
  date.ts                       taipeiDateString() — Taiwan has no DST, so a fixed +8h offset is enough to get the local calendar date without a timezone library
  push.ts                       web-push wrapper (broadcastPush(userId, payload) — only sends to that user's own subscriptions)
components/
  UserPicker.tsx / UserSwitcher.tsx  "Who are you" picker / header identity switcher
  WatchlistCard.tsx              Shared stock card (watchlist + market page)
  WatchlistClient.tsx             Watchlist page's filter + list logic
  MarketOverviewClient.tsx        Market page's filter + search + pagination logic (calls /api/market)
  StockChartSection.tsx           Stock detail page's chart + month-range buttons
  ClearAppBadge.tsx               Clears the PWA app-icon badge when the notifications page opens
  BollingerChart.tsx              Candlestick + MA + Bollinger + institutional bar chart
  InstitutionalBadges.tsx / BollingerBadges.tsx  Various badges
  SettingsClient.tsx / StockSearchInput.tsx / WatchlistTabs.tsx / ui/
scripts/
  migrate-to-multiuser.mjs                 One-time migration to the "Admin" user (already run against production)
  rebuild-directory.mjs                    Rebuild the market-wide stock directory cache
  backfill-twse-prices.mjs                 Backfill all TWSE stock prices (free, official source)
  backfill-tpex-prices.mjs                 Backfill all TPEX stock prices (via FinMind)
  backfill-institutional-breakdown.mjs     Obsolete — see "Data source strategy" below
```

## Data source strategy

Three external sources, `lib/marketdata.ts` decides which to use for what:

| Data | Primary source | Fallback | Notes |
|---|---|---|---|
| TWSE stock prices | TWSE `STOCK_DAY` (free, unlimited, no token) | FinMind | Only TWSE has a free per-stock history endpoint |
| TPEX stock prices | FinMind `TaiwanStockPrice` | — | TPEX has no free per-stock history endpoint |
| 三大法人 for tracked stocks (daily cron refresh) | FinMind `TaiwanStockInstitutionalInvestorsBuySell` | — | Small volume (just the watchlist), not rate-limit sensitive |
| 三大法人 for the whole market (backfill) | TWSE T86 + TPEX daily report (free, whole-market-per-call) | — | Originally assumed these only gave a combined total — turned out they **already carry the full foreign/trust/dealer split**, just in columns the code wasn't reading. Fixing that made market-wide backfill free and fast (tens of seconds for the whole market), retiring the FinMind-based script below |
| Stock directory (code/name/market) | TWSE + TPEX daily-quotes reports (free) | FinMind `TaiwanStockInfo` | FinMind's bulk list endpoint turned out to be rate-limited more aggressively than its per-stock endpoints; the official reports naturally exclude (TWSE) or can be filtered out (TPEX, by code pattern) warrants |

**FinMind's real free-tier behavior**: officially 300 req/hr (600 with a token), but in practice it's a small bucket that burns through fast and refills over roughly 1–2 minutes — not a clean hourly window. `backfill-tpex-prices.mjs` (the only backfill script still heavily dependent on FinMind) handles this with short, increasing waits (starting at 20s, capped at 5 minutes) and a live countdown, instead of blindly waiting an hour. Every external call (TWSE/TPEX/FinMind) goes through `lib/httpFetch.ts`'s shared retry/backoff wrapper.

**TWSE's WAF**: blocks bursty traffic outright (403 or other unexpected status codes), and the block can persist for a while even after slowing down. `backfill-twse-prices.mjs` paces itself conservatively (serial, one stock-month per second) and treats any unexpected response as a rate-limit signal to retry rather than giving up on that stock.

## Runtime logic

### Reading vs. live-fetching are separate function pairs
`lib/marketdata.ts` splits "read" from "live-fetch + backfill" so that just browsing a page never silently triggers an external API call:

- `getPriceSeries` / `getInstitutionalSeries` — **read-only**, only reads what's already stored in Redis (`history:price:{code}` / `history:institutional:{code}`), never live-fetches. Used by the watchlist, stock detail page, and `/api/stock/[code]`.
- `refreshPriceSeries` / `refreshInstitutionalSeries` — live-fetches and merges the result back into Redis (merged by date key, new data overwrites same-date old data, capped at 400 days kept). **Only called from `lib/alerts.ts`'s `processUserAlerts`**, which itself is only invoked by the daily cron and the Settings page's test-notification button — i.e. the only two places the app ever live-fetches a tracked stock's data.
- `getChartSeries` — used by the stock detail chart: fetches a few extra months as warm-up (Bollinger needs 20 days, MA60 needs 60) before computing indicators, then trims back to the requested window; a `live` flag picks read-only vs. live-refresh.

The stock detail chart defaults to the most recent 3 months, read-only; picking a wider range via its own buttons calls `/api/stock/[code]?months=`, which decides whether that specific request needs a live fetch.

### Alert logic: re-evaluated every run, no "already notified" guard
`lib/alerts.ts`'s `processUserAlerts(userId, maLines)` is the whole check → notify pipeline, shared by the daily cron (looped over every registered user) and the Settings page's on-demand test button (just the current user):

- **MA alerts** fire on current state (above/below), not just the moment of crossing — comparing today's snapshot against yesterday's tells whether it's a genuine crossing moment (flipped) or just persisting on the same side; either way it notifies, but only a genuine flip gets the outline highlight on the notifications page.
- **Institutional-tier and streak alerts** fire whenever the current tier/streak matches an enabled setting.
- **No dedup** — every run re-evaluates the truth and reports whatever currently qualifies, even if the exact same thing was already reported earlier that day. The daily cron only runs once a day anyway, and the whole point of the test button is to show live state on every press, not be silently suppressed by an earlier check.
- The push notification is a lightweight nudge; the actual per-stock detail is written to `notifications:{userId}:{date}` in Redis for the `/notifications` page to show.

### All Stocks page (`getAllMarketCards`)
Never live-fetches for the ~2,400-stock overview. Instead:
1. Batch-reads everyone's already-stored price/institutional history via Redis `MGET` (not one round-trip per stock)
2. The assembled card array is cached in Redis (`cache:marketCards`), with a single-flight guard so concurrent requests don't all rebuild it at once when the cache expires
3. `/api/market` filters/sorts/paginates the cached data and returns only the current page (50 cards) to the browser

### Push notifications (`/api/cron/check-alerts`)
Triggered once per trading day at UTC 00:15 = Taipei 08:15, before the market opens, evaluating the previous session's already-published data. Requires `CRON_SECRET`. Triggered by a GitHub Actions schedule (`.github/workflows/check-alerts-cron.yml`) rather than Vercel Cron — Vercel Hobby only guarantees per-hour precision (±59 min) for cron invocations, which was firing this anywhere up to an hour late; GitHub Actions' scheduler is tighter and free regardless of plan:
1. Loops over every registered user **sequentially** (not in parallel — parallelizing would multiply concurrent load on TWSE/FinMind)
2. For each user, runs `processUserAlerts` over their watchlist and sends one bundled push if anything qualifies

### On-demand test notification (`/api/notifications/test`)
Same `processUserAlerts` pipeline, but immediate and scoped to just the currently logged-in user — used by the Settings page's "測試通知" button.

### Market-wide backfill
Manual, occasional maintenance — not something that runs automatically every day:
- `POST /api/admin/backfill-market` (needs `CRON_SECRET`): backfills market-wide 三大法人 (free source, full split, done in well under a minute) + all TWSE stock prices (free source). Time-budgeted to Vercel Hobby's 60s limit; if it can't finish in time it returns `completed: false` and can simply be called again to continue.
- `node --env-file=.env.local scripts/backfill-twse-prices.mjs`: backfills all TWSE prices (free, official source — mind the WAF, see above)
- `node --env-file=.env.local scripts/backfill-tpex-prices.mjs`: backfills all TPEX prices (via FinMind, slow — mind the quota bucket)

Both price-backfill scripts are safe to re-run: already-backfilled stocks are skipped (tracked via their own completion markers), not re-fetched from scratch every time.

## Environment variables

See `.env.local.example`:

| Variable | Purpose |
|---|---|
| `FINMIND_TOKEN` | Optional FinMind registration token; raises the free-tier ceiling to 600/hr (still a bursty bucket in practice, not a clean hourly window) |
| `VAPID_PUBLIC_KEY` / `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push keys, generate with `npx web-push generate-vapid-keys` |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis — auto-injected when deployed via the Vercel Marketplace integration |
| `CRON_SECRET` | Protects `/api/cron/check-alerts` and `/api/admin/backfill-market`; Vercel Cron calls with `Authorization: Bearer <value>` |

## Local development

```bash
npm install
npm run dev        # http://localhost:3000
npm run lint
npm run typecheck  # tsc --noEmit
npx vitest run     # unit tests for lib/indicators.ts
npm run build && npm run start   # production mode
```

**Known issue on this machine**: `npm run dev` (Turbopack or `--webpack`) can't establish its Fast Refresh WebSocket, and when that happens React never hydrates at all — not just "no hot reload," but every button/input/filter on the whole site looks correct in the static HTML and does nothing when clicked. This is not an app bug: `npm run build && npm run start` (production mode) works correctly. **Always verify interactive features (clicks, typing, filters) in production mode** — dev mode is only reliable for checking layout, not for confirming a feature actually works.

## Deployment

Deployed on Vercel's free (Hobby) plan, live at https://stock-tracker-gray-beta.vercel.app:
- Redis via the Vercel Marketplace Upstash integration (env vars auto-injected)
- Git-connected to this GitHub repository — pushing to `master` auto-deploys
- Weekly shareholder-concentration refresh scheduled via `vercel.json` (Hobby allows once per day per cron, hence the fixed trigger time rather than real-time market watching); the daily `check-alerts` cron instead runs via GitHub Actions (see above) since its timing matters more and Vercel Hobby's cron precision is only ±59 min
- `app/api/admin/backfill-market/route.ts`'s `maxDuration` is capped at Hobby's hard 60-second limit; both backfill calls it makes are time-budgeted and safely resumable rather than assuming they'll finish in one invocation
