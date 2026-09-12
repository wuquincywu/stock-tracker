import Link from "next/link";
import BackButton from "@/components/ui/BackButton";

interface FaqItem {
  q: string;
  a: React.ReactNode;
}

const ITEMS: FaqItem[] = [
  {
    q: "均線突破（跌破 MA5 / 站上 MA20…）是怎麼判斷的？",
    a: (
      <>
        比較「前一個交易日」跟「今天」的收盤價相對於均線的位置：前一天在均線之下、今天收在均線之上 = 站上；反過來則是跌破。
        預設會看 MA5 / MA20 / MA60 三條線。均線本身要有足夠的歷史資料才能計算（MA60 至少要 60 個交易日），資料不夠時該條線就不會顯示、也不會觸發通知。
      </>
    ),
  },
  {
    q: "布林通道是怎麼算的？",
    a: <>中軌是 20 日均線（MA20），上軌／下軌是中軌 ± 2 倍的 20 日收盤價標準差。這是布林通道的標準算法，沒有另外調整參數。</>,
  },
  {
    q: "%B 指標、通道寬度、「站上布林上軌」「通道收縮」是什麼意思？",
    a: (
      <>
        兩個布林通道的常見應用指標：
        <br />
        <span className="font-medium">%B</span> = (收盤價 − 下軌) ÷ (上軌 − 下軌)，數字化呈現收盤價落在通道的哪個位置。%B &gt; 1
        代表收盤價站上上軌（
        <span className="text-red-300">短線強勢／超買</span>
        ，股價可能沿上軌繼續走），%B &lt; 0 代表跌破下軌（
        <span className="text-emerald-300">短線弱勢／超賣</span>
        ）；%B &gt; 0.5 算相對強勢、&lt; 0.5 算相對弱勢（以中軌為分界）。
        <br />
        <span className="font-medium">通道寬度（Bandwidth）</span> = (上軌 − 下軌) ÷ 中軌。通道打開（變寬）代表波動大，通道收斂（變窄）代表波動小、前一段趨勢接近尾聲。當
        <span className="text-amber-300">通道寬度創近 60 個交易日新低</span>
        （畫面上顯示「通道收縮」），是波動度降到近期最低、股價在盤整的訊號，短期看漲時可能準備順著上軌突破，但方向仍要搭配其他指標判斷，不是收縮本身就代表方向。
      </>
    ),
  },
  {
    q: "三大法人合計是怎麼算的？",
    a: <>外資買賣超 + 投信買賣超 + 自營商買賣超（含自行買賣與避險）加總後的淨股數。個別三大法人的明細目前不會顯示，只呈現合計數字跟分級。</>,
  },
  {
    q: "大買 / 小買 / 平盤 / 小賣 / 大賣是怎麼分級的？",
    a: (
      <>
        用該股票自己近 40 個交易日的三大法人合計買賣超，算出這段期間的平均值跟標準差，再看「今天」的數字距離平均值有幾個標準差（z-score）：
        <br />
        z &gt; 1 大買、0.2～1 小買、-0.2～0.2 平盤、-1～-0.2 小賣、z &lt; -1 大賣。
        <br />
        <span className="text-zinc-500">
          這組門檻是自己設計的，不是業界公開標準（查證過 Tide、CMoney 籌碼K線、玩股網、XQ全球贏家等平台，都沒有公開實際的分級公式或門檻數字）。資料不到
          20 個交易日時不分級。
        </span>
      </>
    ),
  },
  {
    q: "連續買賣天數（連3買、連4賣）是怎麼算的？",
    a: <>單純計算三大法人合計「連續同方向」淨買超或淨賣超的天數，不會額外要求每天金額要多大才算數——這跟其他台股籌碼平台的算法一致。</>,
  },
  {
    q: "「股價圖表資料範圍」這個設定是什麼？",
    a: (
      <>
        控制個股頁蠟燭圖實際畫出來的股價範圍，預設 3 個月，可在
        <Link href="/settings" className="text-emerald-400 hover:underline">
          通知設定
        </Link>
        頁調整（1～24 個月）。均線跟布林通道需要的暖身資料（MA60 要 60 個交易日、布林通道要 20 個交易日）會另外多抓幾個月，不受這個設定影響，所以不管設定幾個月，圖表可視範圍內的均線跟通道線都會是完整的。拉長月數也不影響三大法人的資料，那是另外抓固定
        40 個交易日。
      </>
    ),
  },
  {
    q: "資料多久更新一次？為什麼推播設在 20:15？",
    a: (
      <>
        每個交易日的資料收盤後才會出來，不是即時的。價格資料官方大約 15:30～17:30 分批釋出，三大法人買賣超（用 FinMind
        資料）官方文件寫每個交易日 20:00 更新。推播排程設在台灣時間週一到週五晚上 20:15，就是為了確保等法人資料真的更新完才檢查、才通知，避免抓到前一天的舊資料。
      </>
    ),
  },
  {
    q: "為什麼手機上點「啟用通知」沒有反應？",
    a: (
      <>
        iOS Safari 的規定：網頁推播只有在「已加入主畫面、以獨立模式開啟」時才能用，在 Safari 分頁裡開網頁完全無法訂閱推播。畫面下方會出現「將本頁加入主畫面」的提示，照著做（分享
        → 加入主畫面）、從主畫面圖示重新打開後才能點「啟用通知」。另外本機用 http（非
        https）測試時，瀏覽器會直接擋掉推播訂閱功能，這是瀏覽器的安全限制，要部署到有 https 的正式網址才能真正測試推播。
      </>
    ),
  },
  {
    q: "資料來源是什麼？可靠嗎？",
    a: (
      <>
        股價優先用證交所（TWSE）官方免費資料；官方沒有的部分（上櫃股價、所有股票的三大法人買賣超歷史）改用 FinMind
        這個第三方免費 API 補。FinMind 不是官方服務、沒有 SLA
        保證，如果暫時連不上，畫面會顯示「資料來源暫時無法連線，請稍後再試一次」而不是整頁出錯。
      </>
    ),
  },
];

export default function FaqPage() {
  return (
    <div className="mx-auto max-w-xl px-4 pb-24 pt-6">
      <BackButton />
      <h1 className="mb-1 text-xl font-semibold">常見問題</h1>
      <p className="mb-6 text-sm text-zinc-500">關於畫面上各項指標、分級跟設定的算法說明。</p>

      <div className="flex flex-col gap-3">
        {ITEMS.map((item) => (
          <details key={item.q} className="group rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3">
            <summary className="cursor-pointer list-none text-sm font-medium marker:content-none">
              <span className="mr-2 inline-block text-zinc-500 transition-transform group-open:rotate-90">›</span>
              {item.q}
            </summary>
            <p className="mt-2 text-sm leading-relaxed text-zinc-400">{item.a}</p>
          </details>
        ))}
      </div>
    </div>
  );
}
