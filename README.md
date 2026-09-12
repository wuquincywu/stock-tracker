# 股票追蹤（stock-tracker）

個人用的台股（上市 TWSE ＋ 上櫃 TPEX）追蹤 PWA。輸入股號追蹤股票後，可以看到股價、均線、布林通道、三大法人買賣超（拆分外資／投信／自營商）、連續買賣天數，並在股價站上／跌破均線、法人分級、連續買賣達標時收到瀏覽器推播通知。也有一個涵蓋全市場約 2,400 檔股票（含 ETF）的「所有股票」瀏覽頁，篩選方式跟已追蹤股票頁面一致。

不是要上架的產品，是寫給自己用的工具，所以資料源全部走免費管道、沒有登入機制、也沒有多使用者概念。

## 功能

### 已追蹤股票（首頁 `/`）
- 輸入股號／中文名稱搜尋並加入追蹤（`components/StockSearchInput.tsx`）
- 每檔卡片顯示：最新股價與漲跌幅、MA5／MA20／MA60 現在值與站上／低於、布林通道相對強弱徽章、三大法人等級（大賣～大買）、外資／投信／自營商／合計四種連續買賣天數徽章
- 篩選面板：市場別、法人等級、連買賣（可選外資／投信／自營商／合計＋方向＋最少天數）、均線站上／低於（可選 MA5／20／60）
- 篩選命中的那個徽章會加上琥珀色邊框，方便看出卡片為什麼符合篩選

### 所有股票（`/market`）
- 全市場約 2,400 檔股票（TWSE＋TPEX，含 ETF，排除權證），卡片樣式跟已追蹤股票頁完全一致
- 搜尋、市場別／法人等級／連買賣／均線篩選、依三大法人今日買賣超排序、標準頁碼分頁（一頁 50 檔）
- 篩選／排序／分頁都在後端做（`/api/market`），瀏覽器不需要一次處理全部股票的資料

### 個股頁（`/stock/[code]`）
- 蠟燭圖＋MA20＋布林通道上下軌，圖表下方疊三大法人合計買賣超長條圖（買紅賣綠）
- 布林通道 %b、Bandwidth、擠壓（squeeze）訊號徽章
- 三大法人買賣超歷史表（外資／投信／自營商／合計四欄，近 10 日）
- 圖表預設顯示 3 個月（純讀取，不即時抓資料），下方有 3／6／12／24 個月按鈕，選超過 3 個月才會即時抓取並存回 Redis（`components/StockChartSection.tsx`）

### 通知設定（`/settings`）
- 法人買賣超分級（大賣～大買）通知開關
- 外資／投信／自營商／合計，各自獨立設定連續買賣天數門檻（0 表示停用）
- 股價站上／跌破 MA5／20／60，各自獨立開關
- 股價圖表資料範圍（1～24 個月）

### FAQ（`/faq`）
所有指標／門檻的計算方式與依據，包含誠實說明「大買／大賣」的 z-score 門檻是自訂的、不是業界標準。

## 技術架構

**框架**：Next.js 16（App Router + TypeScript，Turbopack），React 19，Tailwind CSS v4
**資料庫**：Upstash Redis（`@upstash/redis`，REST 介面）
**圖表**：`lightweight-charts`（TradingView）
**推播**：Web Push（`web-push` 套件）＋手寫 Service Worker（`public/sw.js`）

```
app/
  page.tsx                     首頁（已追蹤股票）
  market/page.tsx               所有股票瀏覽頁
  stock/[code]/page.tsx         個股頁（唯讀，不即時抓資料）
  settings/page.tsx             通知設定頁
  faq/page.tsx
  loading.tsx / */loading.tsx   各路由的載入骨架畫面（含 aria-live 無障礙標記）
  api/
    watchlist/                 追蹤清單 CRUD
    stock/[code]/               個股資料 API：預設唯讀，`?months=` 超過 3 個月才觸發即時抓取
    stocks/search/              股票搜尋（新增追蹤用的自動完成）
    market/                     所有股票頁的篩選／排序／分頁 API
    settings/                   通知設定讀寫
    push/subscribe|unsubscribe/ Web Push 訂閱管理
    cron/check-alerts/          每日排程：檢查突破/分級/連買賣並推播（唯一會即時抓取追蹤股票資料的地方）
    admin/backfill-market/      手動觸發全市場資料回補（見下方「資料回補」），有 CRON_SECRET 防護、依 Vercel Hobby 60 秒上限做時間預算控管
lib/
  types.ts                     所有共用型別（含 WatchlistCardData）
  indicators.ts                均線、布林通道、法人分級、連買賣等純函式計算（`indicators.test.ts` 有對應 vitest 單元測試）
  marketdata.ts                資料存取統一入口：依市場別＋來源優先序 dispatch、`getChartSeries`（暖身緩衝＋布林通道計算）、全市場卡片快取、回補邏輯
  httpFetch.ts                 共用的 fetch 重試/退避包裝，TWSE／TPEX／FinMind 三個 client 都透過這層打外部 API
  twse.ts / tpex.ts / finmind.ts  三個資料源各自的 API client
  redis.ts                     所有 Redis 讀寫（追蹤清單、訂閱、設定、歷史資料累積、全市場卡片快取）
  push.ts                      web-push 包裝
components/
  WatchlistCard.tsx            已追蹤股票／所有股票共用的股票卡片
  WatchlistClient.tsx           已追蹤股票頁的篩選＋清單邏輯
  MarketOverviewClient.tsx      所有股票頁的篩選＋分頁邏輯（呼叫 /api/market）
  StockChartSection.tsx         個股頁圖表＋月份區間按鈕（唯讀預設，選更長區間才即時抓取）
  BollingerChart.tsx            蠟燭圖＋均線＋布林通道＋法人長條圖
  InstitutionalBadges.tsx / BollingerBadges.tsx  各種徽章
  SettingsClient.tsx / StockSearchInput.tsx / WatchlistTabs.tsx / ui/
scripts/
  rebuild-directory.mjs                    重建全市場股票清單快取
  backfill-twse-prices.mjs                 全市場上市股股價回補（走證交所，免費）
  backfill-tpex-prices.mjs                 全市場上櫃股股價回補（走 FinMind）
  backfill-institutional-breakdown.mjs     （已淘汰）原本用 FinMind 逐股回補三大法人拆分；T86／櫃買日報表被發現本來就有完整拆分後，這支腳本不再需要，全市場法人拆分改由 `backfillMarketInstitutional`（`lib/marketdata.ts`）用免費來源一次處理，幾十秒內完成
```

## 資料源策略

三個外部資料源，各有取捨，`lib/marketdata.ts` 統一決定用哪個：

| 資料 | 主要來源 | 備援 | 備註 |
|---|---|---|---|
| 上市股價 | 證交所 `STOCK_DAY`（免費、無限制、無 token） | FinMind | 只有上市股票有這個免費單股歷史端點 |
| 上櫃股價 | FinMind `TaiwanStockPrice` | — | 櫃買中心沒有免費的單股歷史端點 |
| 三大法人（追蹤股票，走 cron 即時更新） | FinMind `TaiwanStockInstitutionalInvestorsBuySell` | — | 拆分外資/投信/自營商，只給少量追蹤股票用，量小不受限流影響 |
| 三大法人（全市場回補） | 證交所 T86 ＋ 櫃買中心日報表（免費、全市場一次撈） | — | 一開始誤以為這兩個來源只給合計數字，後來發現其實**本來就有完整的外資/投信/自營商拆分**，只是程式一開始只讀了合計那一欄——修正後全市場法人拆分回補完全免費、幾十秒內做完，不再需要 FinMind |
| 股票清單（代碼/名稱/市場別） | 證交所＋櫃買中心「當日行情」報表（免費） | FinMind `TaiwanStockInfo` | 改用這個是因為 FinMind 的全清單端點被限流得比單股查詢嚴重很多；證交所的報表天生不含權證，櫃買中心的則用代碼規則（4 碼數字或 00 開頭）過濾掉權證 |

**FinMind 免費額度的實際行為**：官方說法是 300 req/hr（有 token 600 req/hr），但實測是一個「一次燒完、約 1～2 分鐘回充」的小額度桶，不是乾淨的每小時額度視窗。`backfill-tpex-prices.mjs`（現在唯一還大量依賴 FinMind 的回補腳本）用短暫、遞增的等待（20 秒起跳、上限 5 分鐘）搭配即時倒數畫面來應對，而不是傻等一小時。所有對外部 API 的呼叫（TWSE／TPEX／FinMind）都經過 `lib/httpFetch.ts` 的共用重試/退避包裝。

**證交所 WAF**：對突發的大量請求會直接封鎖（403 或其他非預期狀態碼），且封鎖後就算放慢速度也可能持續一段時間。`backfill-twse-prices.mjs` 用序列化、逐股逐月、每秒 1 次請求的保守步調，並把任何非預期回應都當成限流訊號來重試，而不是直接判定該股票失敗放棄。

## 執行邏輯

### 個股資料存取：讀取跟即時抓取是分開的兩套函式
`lib/marketdata.ts` 把「讀」跟「即時抓取＋回補」拆成兩組函式，避免使用者單純瀏覽頁面就默默觸發外部 API 呼叫：

- `getPriceSeries` / `getInstitutionalSeries`：**唯讀**，只讀 Redis 裡已經存好的歷史（`history:price:{code}` / `history:institutional:{code}`），絕不即時抓取。首頁、個股頁、`/api/stock/[code]` 都是用這組。
- `refreshPriceSeries` / `refreshInstitutionalSeries`：即時抓取＋合併回 Redis（合併時用日期當 key，新資料蓋掉同日期舊資料，最多保留 400 天）。**只有 `/api/cron/check-alerts` 會呼叫**，也就是說整個網站唯一會為了追蹤股票默默打外部 API 的地方就是每日排程。
- `getChartSeries`：個股頁圖表專用，內部多抓幾個月當「暖身緩衝」再算布林通道／MA（布林通道需要 20 天、MA60 需要 60 天暖身期，不然圖表前段會沒有指標線），依參數決定要唯讀還是即時刷新。

個股頁圖表預設顯示最近 3 個月、純讀取；使用者按 6／12／24 個月按鈕才會呼叫 `/api/stock/[code]?months=`，由這支 API 判斷是否需要即時抓取更早的資料並存回 Redis。

### 所有股票頁（`getAllMarketCards`）
不對全市場約 2,400 檔股票做即時抓取，而是：
1. 用 Redis MGET 批次一次讀出所有股票已經存好的價格／法人歷史（而不是一檔一檔查）
2. 組出來的完整卡片陣列快取在 Redis（`cache:marketCards`），並用 single-flight 機制避免多個請求同時撞上快取過期而重複做同一份昂貴運算
3. `/api/market` 對快取後的資料做篩選／排序／分頁，只回傳當前頁的 50 筆給瀏覽器——不會把全部資料一次丟給前端

### 推播通知（`/api/cron/check-alerts`）
Vercel Cron 每個交易日觸發一次（`vercel.json`，UTC 12:15 = 台北 20:15，抓法人資料公布後留緩衝時間），需要 `CRON_SECRET`：
1. 對每檔追蹤股票平行（分批）用 `refreshPriceSeries`／`refreshInstitutionalSeries` 抓最新價格與法人資料
2. 比對 MA 穿越、法人分級、四種連續買賣天數是否達到使用者設定的門檻
3. 每一種都有各自的當日去重（Redis `alert:dedup`），去重標記**在推播真的送出成功之後才寫入**（避免半路失敗時把這次警示永久吃掉、之後都不會再通知）
4. 同一檔股票當天多個觸發條件會合併成一則通知一起送出
5. 推播失敗（訂閱已失效）的裝置會自動從訂閱清單移除

### 全市場資料回補
這是手動觸發、非日常運作的維護工作，不是每天自動跑的東西：
- `POST /api/admin/backfill-market`（需要 `CRON_SECRET`）：回補全市場三大法人（含外資/投信/自營商拆分，免費來源，一次呼叫幾十秒內完成）＋全部上市股股價（免費來源）。依 Vercel Hobby 60 秒執行上限做時間預算控管，跑不完會回傳 `completed: false`，重新呼叫即可從中斷處繼續。
- `node --env-file=.env.local scripts/backfill-twse-prices.mjs`：回補全部上市股股價（走證交所，免費，但要小心 WAF——見上方「證交所 WAF」）
- `node --env-file=.env.local scripts/backfill-tpex-prices.mjs`：回補全部上櫃股股價（走 FinMind，量大，跑起來要一段時間）

兩支股價回補腳本都設計成可以安全重跑：已經回補過的股票會被跳過（用各自的完成標記判斷），不會每次都重新整個清單抓一遍。

## 環境變數

參考 `.env.local.example`：

| 變數 | 用途 |
|---|---|
| `FINMIND_TOKEN` | FinMind 註冊 token，可選；有的話額度上看 600/hr（實測仍是小額度桶模式，不是乾淨的每小時視窗） |
| `VAPID_PUBLIC_KEY` / `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | Web Push，用 `npx web-push generate-vapid-keys` 產生 |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis，部署到 Vercel 時透過 Marketplace 整合會自動注入 |
| `CRON_SECRET` | 保護 `/api/cron/check-alerts` 與 `/api/admin/backfill-market`，Vercel Cron 會用 `Authorization: Bearer <值>` 呼叫 |

## 本機開發

```bash
npm install
npm run dev        # http://localhost:3000
npm run lint
npm run typecheck  # tsc --noEmit
npx vitest run     # lib/indicators.ts 的單元測試
npm run build && npm run start   # production 模式
```

**重要）本機開發環境的已知問題**：在目前這台機器上，`npm run dev`（不論 Turbopack 或 `--webpack`）的 Fast Refresh WebSocket 連不上，而且一旦連不上，React 會完全沒有掛載互動功能——不是熱重載失效這麼單純，而是整個網站在 dev 模式下所有按鈕、輸入框、篩選都會「看起來正常、點了沒反應」。這不是 app 程式碼的問題：`npm run build && npm run start`（production 模式）互動完全正常。**要測試任何點擊／輸入類的功能，一定要用 production 模式**，dev 模式只能拿來看畫面版型，不能拿來判斷功能是否正常。

## 部署

目標平台是 Vercel 免費方案：
- Redis 用 Vercel Marketplace 的 Upstash 整合（自動注入環境變數）
- Cron 用 `vercel.json` 裡設定的排程（Hobby 方案一天只能排一次，所以推播抓取時間點是抓「法人資料公布後」的固定時間，不是盯盤即時通知）
- 目前**尚未實際部署過**，所有驗證都是在本機 + 真實的 Upstash 資料庫上做的
