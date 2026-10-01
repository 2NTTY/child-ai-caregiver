# 育有方視覺資產製作簡要

這批資產為未來產品預先準備，未接入產品，不代表功能已交付。只做育有方，不修改產品工程。

## 共用視覺

- 港灣環抱與一點指引光；溫暖、可信、克制、適合香港 0–10 歲孩子的成年照顧者。
- Palette：ink `#203E3A`、teal `#287568`、paper `#FAF7EF`、sage `#DDE8DB`、amber `#D99A3D`、coral `#C86D52`、white `#FFFFFF`、muted `#60756E`。
- 不用醫療十字、奶嘴主品牌、冰冷機械人或廉價漸變。線條圓潤但不幼稚，保留留白。
- 字體：`Microsoft JhengHei, PingFang TC, Noto Sans TC, sans-serif`。資訊圖的字體盡量 28–36 SVG unit（1440 寬畫布），不靠微小腳註承載重要限制。
- Mark／favicon 使用 96、app icon 使用 512 正方形 viewBox；wordmark／horizontal logo 使用緊貼內容的橫向 viewBox。插圖 640×480；宣傳 1200×720；資訊圖 1440×720；海報 A3 直向，297mm×420mm，viewBox 0 0 1188 1680。
- 正式 SVG 全部由 Astra Max 子代理創作及重大修改。主代理只整合與機械式生成預覽。

## SVG 契約

每個檔案獨立、可直接打開，沒有外部 URL、image、script、foreignObject、內嵌字體或 raster。保留純文字及簡單元素，少量 path，避免 filter／blur。使用 viewBox、title／desc，資訊閱讀順序清楚。ID 只為 accessibility、label 或可編輯圖層所需。

重要文字可用 `id` 定位，方便日後修改；不把長文轉 path。單色圖標用 currentColor；品牌 mark 不依賴文字。

## 敘事

- 主定位：幫家長整理值得記、值得問、值得跟進的事情。
- 架構是已確認設計，並非運行系統：在線 Web／Android → Server → PostgreSQL；Auth、Gemini、Agent／worker、Knowledge、Notification 在 Server 側。
- AI 理解與草擬；程式核對權限、工具、狀態、數值及保存。Server 確認才算保存。
- 重要資料／缺項需要補問或確認；預先授權的對象、內容、渠道及 fallback 內可自動執行，不逐次要求確認，但每次執行重查當前授權。
- P1 Web 基礎閉環；P2 Web＋持續 Agent（比賽目標）；P3 Android、FCM、語音／相機及完整交接；P4 完整 Knowledge、分享、趨勢、PDF、自部署／搬遷／災備；P5 可選增值。
- 不把當前進度硬寫在長期 SVG。圖上標示「產品方向／分階段規劃」及階段歸屬。當前實現狀態集中在 presentation/project-status.json。
- 不編造 QR／網址、成效、家庭數據或政府認可。照片不作疾病診斷，不做藥物管理。

## 分工

A：brand 五件＋promo/hero.svg。B：illustrations 九件。C：diagrams 五件。D：promo/problem-solution.svg＋posters/project-poster.svg。禁止交叉改檔、修改主產品或再 spawn。

主模型整合資產目錄、presentation source、build 及驗證。所有預覽／中間檔放 presentation/.build（忽略），正式 PPTX 放 presentation/output。
