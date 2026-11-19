# 育伴港選配工作台｜第 50 頁：定時來源，登記與檢查範圍

比較的是登記 URL、設定頻率及界定檢查範圍，不是顯示已取材、編輯來源庫或對家長發布。

- **巡查-01 Distill**：[官方 Feed Monitor 流程](https://distill.io/docs/web-monitor/feed-monitor/)；[登記 URL 原圖](https://distill.io/docs/web-monitor/feed-monitor/images/036-add-feed-url.jpg)、[選定訂閱原圖](https://distill.io/docs/web-monitor/feed-monitor/images/036-select-feed.jpg)、[檢查頻率原圖](https://distill.io/docs/web-monitor/schedule-checks/images/check-schedule.jpg)。先確認整條 RSS／Atom，間隔在後續選項另設。已於 2026-11-19 核對，原方未公開畫面版號或發版日。
- **巡查-02 changedetection.io**：[原方 2025-03-07 完整示例](https://changedetection.io/tutorial/nurburgring-racing-passion-get-notified-news-updates-today-nurburgring)、[視覺範圍原圖](https://changedetection.io/sites/changedetection.io/files/inline-images/image_106.png)、[獨立頻率說明](https://changedetection.io/tutorial/email-notification-when-web-page-changes-how)。在完整編輯畫面保留 URL，選中新聞區而不看全頁。頻率另有頁籤，畫面版號未公開。
- 原圖只外鏈，不嵌入或複製；沒有登入、登記測試來源或發出通知。

## 育伴港對照
- [續作需求及排程恢復紀錄](https://github.com/2NTTY/child-ai-caregiver/blob/9eae8c8d994aa1f09d95ccf4ca4f174da0074e82/PLAN.md#L74-L78)：卡片與聊天共用的登記、範圍和頻率設定是續作。現行來源限 [固定目錄](https://github.com/2NTTY/child-ai-caregiver/blob/9eae8c8d994aa1f09d95ccf4ca4f174da0074e82/server/knowledge-source-catalog.ts#L4-L26)，後台目前是[唯讀狀態](https://github.com/2NTTY/child-ai-caregiver/blob/9eae8c8d994aa1f09d95ccf4ca4f174da0074e82/frontend/src/production/AdminOwner.ts#L116-L138)，不等於可新增任意 URL。
- [#666](https://github.com/2NTTY/child-ai-caregiver/pull/666) 修復共用排程索引缺失；[#667](https://github.com/2NTTY/child-ai-caregiver/pull/667) 是五個已核准公開來源的增量維護程式。抓取成功不等於資料有更新、不等於已由 Agent 處理或已發布。個別 RSS 亦不是家長公共知識。

## 離線核對
50 頁、103 款；原有 49 頁及 146 張圖片雜湊不變。25 項離線閱讀器檢查通過。HTML 30,885,208 bytes；SHA-256 `2f5b09e008cb827ad046154bd8aa09a88df2b45e45e30287d2027594358b85d7`。此分支只保存來源文字，沒有瀏覽器、通知、PR 或發布。
