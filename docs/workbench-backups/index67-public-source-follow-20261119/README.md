# 第 53 題：公共來源：免費加入、辨認狀態與返回平台版本

## 育伴港實作基準

[PR #671](https://github.com/2NTTY/child-ai-caregiver/pull/671) 合併提交 `36434a235458646f8398229628e67f8ca5316bac`。[公共系列的免費加入按鈕及已加入狀態](https://github.com/2NTTY/child-ai-caregiver/blob/36434a235458646f8398229628e67f8ca5316bac/frontend/src/components/memory/PlatformCardJoin.tsx#L12-L23) 與 [「設定與匯出」裡的版本管理](https://github.com/2NTTY/child-ai-caregiver/blob/36434a235458646f8398229628e67f8ca5316bac/frontend/src/components/memory/MemoryReferenceView.tsx#L230-L247) 屬同一系列。加入後可辨認跟隨同範圍更新、固定快照或停用狀態。[程式證據](https://github.com/2NTTY/child-ai-caregiver/blob/36434a235458646f8398229628e67f8ca5316bac/frontend/src/memory-reference-view-model.ts#L56-L64)：停用改啟用狀態、保留版本；使用平台版本改模式、保留啟用狀態。這不是刪除來源或退出帳戶。

[隔離 Web 和 Firebase 收據](https://github.com/2NTTY/child-ai-caregiver/blob/36434a235458646f8398229628e67f8ca5316bac/artifacts/verification/REQ006_FREE_PLATFORM_FOLLOW_20261119.json#L5-L27) 證實加入沿用已發布版本，只寫本人偏好，不新建私人爬取卡，沒有外部模型呼叫；不是正式 Web 上線驗收。本題不重做「找公開文件」、「巡查排程」或「從聊天回到同一卡」。

## 可選參考

1. **加入-01｜Feedly 搜尋結果內預覽再跟隨。** [官方原圖](https://d33v4339jhl8k0.cloudfront.net/docs/assets/5abc898d2c7d3a0e9366d6c3/images/68988a831e325e4a6fcd2dbf/file-ckENS3vFih.png)在同一來源結果卡顯示網站、近期文章及更新量，再給 Follow。只展示加入前。[官方指南](https://docs.feedly.com/article/806-how-to-follow-sources) 2025-08-10 更新，未公開畫面建置版號。原圖 SHA-256 `ec221b0bc8eb8ed910adc0c089a716710cc7683fcc033d297291ad02e726edb3`。
2. **加入-02｜LibreOffice 公共目錄與目前採用項目。** [公共目錄原圖](https://books.libreoffice.org/en/WG24/WG2410-WorkingWithTemplates-img/WG2410-WorkingWithTemplates-img006.png)和[安裝選取](https://books.libreoffice.org/en/WG24/WG2410-WorkingWithTemplates-img/WG2410-WorkingWithTemplates-img008.png)展示由分類與搜尋找現成範本；[自訂預設標記](https://books.libreoffice.org/en/WG24/WG2410-WorkingWithTemplates-img/WG2410-WorkingWithTemplates-img009.png)及[回到內建預設](https://books.libreoffice.org/en/WG24/WG2410-WorkingWithTemplates-img/WG2410-WorkingWithTemplates-img010.png)是另外兩張輔圖。範本類比採用與回復，不是訂閱。[Writer Guide 24.2 Community 第 10 章](https://books.libreoffice.org/en/WG24/WG2410-WorkingWithTemplates.html)，2024-02；網站建置版號未公開。主圖 SHA-256 `8583777f6fb5cad4355da0de92b84895342af32017fc3f1d7409744667d01a93`。章節版權 © 2024 LibreOffice Documentation Team，可採 CC BY 4.0 或後續版本；商標屬各權利人。

2026-11-19 視查官方原圖與可用連結。只存外鏈，不重新分發或將例子當成產品權限。沒有操作外站。

## 備份驗證

- 53 題、109 款（77 離線與 32 外鏈），既有 52 題及 146 張離線圖不變。
- 單檔 HTML 30,893,330 bytes，SHA-256 `4e26833029e0fd72cf354ddd0c53d672d20932c9a3521b3f86cccd8bb7373415`；31 項離線閱讀器邏輯及靜態檢查通過。無完整瀏覽器互動驗收。
- 此分支只存文字索引與證據，沒有 PR、合併、發布、應用設計或私人資料。
