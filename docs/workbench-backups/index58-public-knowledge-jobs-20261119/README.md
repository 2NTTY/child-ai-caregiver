# 選配工作台：第 44 題「公共知識索引：查進度與失敗項」

候選只作完整頁面比較。這個分支只備份文字索引與原作者連結；沒有圖檔、家長資料、索引執行、合併或部署。

## 批次-01｜Dagster
[完整 Backfills 原圖](https://dagster.io/docs/assets/images/backfills-tab-b3ac9d2ad492162ca6c63bf2c065d707.png) · [官方文件](https://dagster.io/docs/guides/operate/webserver#backfills-tab)

先跨批查看目標、時間、已完成數和分段狀態。原圖只示範兩批完成，另外三類均為零，不說成有失敗與暫停實測。官方文件讀取時顯示 1.13.30；資產雜湊 `b3ac9d2ad492162ca6c63bf2c065d707`，不是截圖所用 App 版本。

## 批次-02｜Bull-Board
[完整隊列詳情原圖](https://raw.githubusercontent.com/felixmosh/bull-board/0c602c9e5042f0285c3d66733b005123178bbfd1/website/docs/public/screenshots/queue-detail-info-icon.png) · [官方文件](https://felixmosh.github.io/bull-board/guide/exploring-the-dashboard#queue-info) · [固定版本 v9.13.1](https://github.com/felixmosh/bull-board/releases/tag/v9.13.1) · [示例程式](https://github.com/felixmosh/bull-board/blob/0c602c9e5042f0285c3d66733b005123178bbfd1/example.ts#L248-L279)

先選隊列，再以狀態及計數找到失敗工作。原圖有 Retry、Logs，沒有呈現重試結果、恢復或斷點續跑。文件資產固定於 v9.13.1 的提交 `0c602c9e5042f0285c3d66733b005123178bbfd1`。

## 與育伴港的關係
查核 [Web 管理後台](https://github.com/2NTTY/child-ai-caregiver/blob/5ddc68e4b02ae0e9a934cc3f209b634a4ba600fa/frontend/src/screens/AdminScreen.web.tsx#L340-L415) 與 [續跑的背景處理](https://github.com/2NTTY/child-ai-caregiver/blob/5ddc68e4b02ae0e9a934cc3f209b634a4ba600fa/server/firestore-knowledge-index-batches.ts#L219-L234)。原後台已有整組與單批狀態、逐項分段、暫停和繼續；失敗終態要另開批次，索引完成不等於發布。本輪不變更任何功能。

## 驗證
前 43 題及 146 張既有離線圖不變。共 44 題／91 款；77 款離線、14 款僅連至外部原圖。離線靜態檢查與 JS VM 的比較、選擇、更換、撤銷與導覽通過。不是瀏覽器操作測試。
新版 HTML SHA-256: `620736efb81a5bfdc77a7f7c2bcef3d7be241810ea25870d162b513f6adbcabf`。
