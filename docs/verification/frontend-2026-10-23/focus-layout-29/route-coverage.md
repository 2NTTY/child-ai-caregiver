# 18-route 覆蓋矩陣

**這是覆蓋說明，不是 18 頁通過。** 共 18 個 page entry：17 個一般家長 route，加 1 個 gated `/admin`。Query 子頁、八類歷史、八區設定及 Bell 不是額外 route。

來源盤點承接 snapshot26d 的 18-entry source trace；下表只將 snapshot29 最終 45 檔 freeze 的改動映射到相應 route，不冒稱全部 source 重新逐行審查。Site85／snapshot27／27a／Site86 的既有 browser 結果保留於[原報告](../../frontend-2026-10-22/parent-audit-27/page-audit.md)，不作本批新 PASS。

| Route | 用途 | 本批來源改動／相關性 | Snapshot29 browser |
|---|---|---|---|
| /login | 登入 | 無本輪產品改動 | 本批未重驗 |
| / | 首頁 | 共用導航排序；非首頁重設計 | 本批未重驗 |
| /chat | 聊天 | 已載空 snapshot 與 focus 刷新 | 本批來源／測試已覆，29未作browser代表驗收。 |
| /tasks | 待辦 | loaded-ID 原子範圍刷新 | 29未驗loaded-more自然focus，留30。 |
| /growth | 關注／準備 | 共用 Tabs 量測；主內容未改 | 僅共用Tabs來源／測試相關；29未重驗此route。 |
| /summary | 概況／成長檔案 | 空 snapshot、已套用期間；共用 Tabs | 29未驗未套用期間自然focus，留30。 |
| /care | 核對 | 已保存正文優先；count／empty／page／detail focus | 29有界PASS：pending1/成功空0/saved24/detail自然focus；390事件卡；Tabs1024/390。 |
| /memory | 記憶 | loaded-ID 原子範圍刷新；共用 Tabs | 29未驗loaded-more自然focus，留30。 |
| /history | 歷史 | 待辦單欄；核對／記憶／待辦已載範圍；共用 Tabs | 29有界PASS：待辦390/1440、1024/360補充；click/Enter/Space/AX/回焦；刷新只test harness。 |
| /settings | 設定 | 模型／通知／備註；草稿／確認依據／focus；共用 Tabs | 29僅合成模型審閱窗→自然focus→取消有界PASS；通知／備註等未browser覆蓋。 |
| /more | 全部功能 | 管理導航排序／既有入口 | 導航來源／測試已覆，29未單獨browser驗收。 |
| /profile | 檔案 | 導航排序；內容未改 | 本批未重驗 |
| /photos | 照片 | 無本輪照片能力改動 | 本批未重驗 |
| /sources | 來源 | readFresh 與寫入鎖；同 scope 讀取 | 本批來源／測試已覆，29未作browser代表驗收。 |
| /contact | 聯絡 | 無本輪產品改動 | 本批未重驗 |
| /family | 家庭 | 無本輪產品改動 | 本批未重驗；不驗權限 |
| /guide | 指引 | 無本輪產品改動 | 本批未重驗 |
| /admin | 管理員 | 既有 gated 入口，無本輪改動 | 不屬一般家長 browser 範圍 |

## 另外分開的覆蓋維度

- 共用 `UnderlineTabs`：badge 尺寸變化後位置量測；只有實際測過的 route／viewport 能列 browser PASS。
- 自然 focus：讀取不應移除既有內容或焦點；必須分清首次載入、同 scope 讀取、scope 改變及真寫入。
- 無障礙：卡片可達名稱、確認／取消與焦點留存是本批代表風險；不是完整螢幕閱讀器驗收。
- 來源審核／Node 測試／DOM 或 Paper 測試／真瀏覽器／正式服務，是不同層級，互不替代。
