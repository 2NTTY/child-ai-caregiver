# 育伴港選配工作台｜第 46 頁：公共來源卡

比較的是讀者如何從公開目錄進入系列、找到文件及定位版本，不是長期記憶、聊天引用的原文定位、私人來源或後台索引。

## 來源-01｜UNICEF 出版系列
- [出版總目錄](https://www.unicef.org/reports) → [系列原頁](https://www.unicef.org/reports/state-of-worlds-children) → [2024 年版的完整文件頁](https://www.unicef.org/reports/state-of-worlds-children/2024)。
- 以系列簡介、歷年報告與封面幫讀者找冊次；打開單冊再分語言、全文及摘要。各年可能是不同主題，不等於新版覆蓋舊版。定位版本：2024 年 11 月出版；總目錄／系列頁可變，UI 版號未公開。
- [原方出版說明](https://www.unicef.org/reports/about-unicef-publications)。只保留公開網頁外鏈，不重新分發照片、封面、截圖或報告。

## 來源-02｜W3C WCAG 版本索引
- [標準總目錄](https://www.w3.org/TR/) → [WCAG 系列原頁](https://www.w3.org/TR/wcag/all/) → [2.2 版本沿革](https://www.w3.org/standards/history/WCAG22/) → [2024-12-12 固定正式版](https://www.w3.org/TR/2024/REC-WCAG22-20241212/)。
- 以版本、日期及狀態為主，讓讀者由現行目錄回到指定快照；草案與正式版不同。定位版本：WCAG 2.2 Recommendation，2024-12-12；索引 UI 版號未公開。
- [原方文件授權](https://www.w3.org/copyright/document-license-2023/)。只保留公開網頁外鏈，沒有重製標誌、截圖或規格內容。

## 育伴港對照及本輪範圍
- [#663](https://github.com/2NTTY/child-ai-caregiver/pull/663) 已進主線，固定程式 [聚合出版社與系列](https://github.com/2NTTY/child-ai-caregiver/blob/aa759f49b0ffda4e351387b6f9582587d3b3c9a8/frontend/src/components/memory/MemoryReferenceView.tsx#L303-L339)、[封面、文件與設定頁籤](https://github.com/2NTTY/child-ai-caregiver/blob/aa759f49b0ffda4e351387b6f9582587d3b3c9a8/frontend/src/components/memory/MemoryReferenceView.tsx#L211-L263)。選擇不是實作，沒有改動既有來源或正式資料。
- 2026-11-19 以官方網頁核對設計；兩例皆使用完整網頁外鏈，未封存其畫面，未擴大分享範圍。既有離線圖片不變。

## 驗證
- 第 46 頁離線 HTML：30,875,914 bytes；SHA-256 `529b68131de2a171726276983f0fa904048b7c4e6795d8a07e9bf90d2c52eb56`。
- 46 主題／95 款；原有 45 組及 146 張圖片雜湊未變。17 組離線 JS 檢查包含新一頁選擇、替換、摘要、返回及撤銷。未跑真瀏覽器或公開部署。
- 此獨立分支只備份來源文字與版本，不含預覽檔或任何原圖。
