# 持續關注 · OG01

兩個原創閱讀選配：A 關注索引（可並讀原因）、B 閱讀小冊（目錄和單篇閱讀台）。所有孩子、文字、讀取及原操作情境均為合成。不接正式 owner/API/模型，不傳個別關注 ID，不完成任務或關注。

## 來源與邊界

本輪檢視的項目版本：[2abe7aed](https://github.com/2NTTY/child-ai-caregiver/commit/2abe7aed60b192b253414f6464e3fd070cc377e7)。只借用原有純讀取投影的語義；正式 owner/React 元件未掛入本頁。現行首頁為當前孩子、非 closed concerns、原順序前三筆。導航只有 growth 目的地，不定位某條關注。

合成原操作的 unknown 保持可見；同一 read 的成功與失敗皆不能替它結案。狀態 loading/ready/stale/error/unavailable 分開，未知或不可用不當成成功空清單。所有內容數量僅指已載入窗口。

## 設計參考

- [GOV.UK Task list](https://design-system.service.gov.uk/components/task-list/)：參考文字狀態與清楚行標籤，未使用其完成工作流。
- [NN/g Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/)：原因展讀，不隱藏讀取/未知狀態。
- [Carbon Empty states](https://www.carbondesignsystem.com/building-blocks/core/patterns/empty-states)：區分沒有資料與讀取/權限問題。

僅通用概念參考，沒有複製第三方程式、字體、圖片或品牌素材。

## 驗證界線

小型來源投影、合成 owner、JSDOM 實際入口/事件/焦點檢查不等於真正瀏覽器視覺或正式整合。Browser pixels、HTTP、native、讀屏/AT、完整 WCAG、正式 owner/路由及服務均未驗。這是一個供比較的獨立選配，不是全產品驗收或已發布功能。
