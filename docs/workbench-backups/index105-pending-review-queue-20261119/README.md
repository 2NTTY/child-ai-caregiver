# 選配工作台第 90 題：同一清單的待確認入口

兩案都保留右上「待確認」，都讀目前孩子的同一批草稿，不加第二個收件匣，也不顯示跨孩子總計。原站已有核對頁；快捷入口屬未合併 PR #691。例：「2+」只說本次載到兩項仍有下一頁，「!」是上次決定結果待查。離線時不能當成零項。這頁選的是怎樣找到草稿，不是修改或同意其中一張。

## 待確認-01｜SAP Fiori：留在原頁，從頂欄打開短清單

原頁仍在後方，右上角打開清單並看到多筆項目。參考整個外殼和清單的位置；SAP 有些項目可直接決定，育伴港不照搬，需看清草稿後仍按既有流程確認。

- [作者來源](https://www.sap.com/design-system/fiori-design-web/v1-142/foundations/integration-and-services/sap-fiori-launchpad/launchpad)
- SAP Fiori Design for Web v1.142，Launchpad 的 Notifications 圖；未標應用環境 build。
- [SAP v1.142 作者原圖：原工作頁和通知彈層](https://www.sap.com/design-system/fiori-design-web/v1-142/foundations/integration-and-services/sap-fiori-launchpad/media_1214803954eab895710a4304af8304ba2ebef6b55.png?format=png&optimize=medium&width=750)
- [育伴港未合併版本：快捷入口選讀同一清單](https://github.com/2NTTY/child-ai-caregiver/blob/571bb04a6250e01461e35ce6eae8cfe1cb30c065/frontend/src/components/PendingReviewShortcut.tsx#L185-L211)
- 只連結作者畫面，不轉載圖像、品牌或示例資料。

## 待確認-02｜GitHub：從入口進完整清單，再逐項打開

原畫面用獨立儀表板把 Needs your review 和其他佇列分開。對育伴港只借完整清單與明確待核對範圍，不照搬跨倉庫、多人、批量同意或合併功能。

- [作者來源](https://github.blog/changelog/2026-07-09-new-pull-requests-dashboard-is-now-generally-available/)
- GitHub Pull requests dashboard，2026-07-09 一般可用發布圖；未標 Web build。
- [GitHub 作者發布原圖：完整清單畫面嵌於發布圖](https://github.blog/wp-content/uploads/2026/07/NewPullRequestDashboard_NewRelease_Header.jpg?resize=2064%2C1084)
- [育伴港固定原站版本：核對頁的空、部分載入和待查狀態](https://github.com/2NTTY/child-ai-caregiver/blob/86a68b787af90fbe2379247f13030125b1804742/frontend/src/screens/careScreen.tsx#L105-L118)
- [育伴港未合併版本：待確認數量語義](https://github.com/2NTTY/child-ai-caregiver/blob/571bb04a6250e01461e35ce6eae8cfe1cb30c065/frontend/src/components/agent/pending-review-model.ts#L35-L55)
- 只連結作者畫面，不轉載圖像、品牌或示例資料。

## 驗證

90 題、183 選項、106 外部參考。原 89 題及 146 張圖片不變。靜態完整性、模擬 DOM 開啟／比較／選取／清除、主題搜尋回歸通過。沒有運行真瀏覽器、操作真實核對資料、修改產品、合併或部署。

- HTML SHA-256: `5f87c135c2b0379bb8058c628904e9a2debd18f8d4a2535ac919e972584868b9`
- HTML bytes: 31025174
- 基準 SHA-256: `0ca24672267326f573d8fd9168f7c281447c9525e9354b7edecfa6cf7557cdd2`
