# 育有方可復用美術素材

這是為未來產品、宣傳、海報及簡報準備的 source library，尚未整合 Web 或 Android。圖示中的功能是已確認設計或分階段方向，不代表已交付。沒有第三方圖形、字體檔、真實家庭照片或資料。

## SVG 目錄

| 檔案 | 用途 |
|---|---|
| [brand/mark.svg](brand/mark.svg) | 無文字單色品牌符號，環抱港灣與指引光 |
| [brand/wordmark.svg](brand/wordmark.svg) | 可編輯中文字標 |
| [brand/logo-horizontal.svg](brand/logo-horizontal.svg) | 橫向品牌組合 |
| [brand/app-icon-source.svg](brand/app-icon-source.svg) | App icon 的正方形 source，尚未產生平台資源包 |
| [brand/favicon.svg](brand/favicon.svg) | 小尺寸單色符號 |
| [illustrations/welcome.svg](illustrations/welcome.svg) | 歡迎／家庭共讀 |
| [illustrations/empty-child.svg](illustrations/empty-child.svg) | 尚未建立孩子檔案 |
| [illustrations/empty-record.svg](illustrations/empty-record.svg) | 尚未有日常記錄 |
| [illustrations/assistant.svg](illustrations/assistant.svg) | 對話及協助理解 |
| [illustrations/proactive-reminder.svg](illustrations/proactive-reminder.svg) | 日程及主動跟進方向 |
| [illustrations/offline.svg](illustrations/offline.svg) | 未連線；只保留當前畫面的未提交內容 |
| [illustrations/unknown-result.svg](illustrations/unknown-result.svg) | 請求結果未獲 Server 確認 |
| [illustrations/success-confirmation.svg](illustrations/success-confirmation.svg) | 僅用於 Server 已確認保存的語境 |
| [illustrations/source.svg](illustrations/source.svg) | 來源及原始記錄核對 |
| [diagrams/agent-loop.svg](diagrams/agent-loop.svg) | 補問、程式核對、授權執行及有限跟進 |
| [diagrams/server-architecture.svg](diagrams/server-architecture.svg) | Server 唯一業務資料權威 |
| [diagrams/user-journey.svg](diagrams/user-journey.svg) | 分階段的日常照顧旅程 |
| [diagrams/roadmap.svg](diagrams/roadmap.svg) | P1–P4 及可選 P5；P2 為比賽主要目標 |
| [diagrams/traceability.svg](diagrams/traceability.svg) | 原文、確認、保存、摘要及回查 |
| [promo/hero.svg](promo/hero.svg) | 親子同行的品牌主視覺 |
| [promo/problem-solution.svg](promo/problem-solution.svg) | 零散日常資訊與協助方向 |
| [posters/project-poster.svg](posters/project-poster.svg) | A3 直向海報，文字及區塊可編輯 |

## 使用與修改

直接修改 SVG 的文字、座標和有限顏色即可，不需要框架。SVG 沒有外部依賴，沒有 raster 或字體內嵌。字體順序是 Microsoft JhengHei、PingFang TC、Noto Sans TC、sans-serif。

單色 mark／favicon 支援 `currentColor`。以 inline SVG 使用時可由父元素 `color` 控制；用 `<img>` 引用時，父頁 CSS 不會跨文件改色，須改 SVG 的 `color` 或使用合適的整合方式。插圖保留透明背景或原設計底色，不宣稱已適配所有 UI。

承載資訊時保留 title／desc，或由外部元件提供等效 label。純裝飾 inline SVG 由整合端設定 `aria-hidden="true"`、`focusable="false"`；裝飾 `<img>` 使用空 alt。不只依靠色彩表達狀態。

海報的 title、價值點、流程、roadmap 及 demo 區有可定位 group／text。換入已核實 URL 時，才生成真 QR；現有框不是 QR。保留至少 12 mm 印刷安全邊，未做實體印刷驗收。

本批正式 SVG 由四名 Astra Max 子代理創作，主代理作整合 review。這是本任務的一次性分工，不改變專案長期代理規則。配色及敘事簡要見 [BRIEF.md](BRIEF.md)。

生圖素材的提示詞與使用方向見 [IMAGE_DIRECTION.md](IMAGE_DIRECTION.md) 及 [image-prompts.json](image-prompts.json)；生成 PNG 保存在 `images/`，屬合成插畫，不是產品截圖或真實家庭影像。

## 輕量檢查

由 repository root 執行 `npm --prefix presentation run check` 及 `npm --prefix presentation run preview`。只檢查視覺資產與簡報，不執行產品 integration、E2E、真服務或真機测试。
