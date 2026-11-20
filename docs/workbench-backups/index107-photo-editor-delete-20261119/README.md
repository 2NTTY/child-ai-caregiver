# 育伴港選配工作台｜第 92 題：照片頁

**照片頁：返回、清除本頁，還是刪除原件？**

- **92A Apple Photos（macOS 27 手冊）**：[編輯區原頁](https://support.apple.com/en-ca/guide/photos/pht304c2ace6/12.0/mac/27)與[圖庫刪除](https://support.apple.com/en-ie/guide/photos/pht3bfab2f96/12.0/mac/27)分開。還原照片的調整不是刪除原件。[編輯工作區原圖](https://ipcdn-web.apple.com/assets/v2/web/9ca2e5bc-7b50-48df-b239-76b09dcc4fce) · [最近刪除原圖](https://ipcdn-web.apple.com/assets/v2/web/6929b28a-4c20-431a-9b9d-1c2b7247d3d3)（刪除後頁面，不是確認視窗）。
- **92B Adobe Lightroom 網頁版**：[官方工作區原頁](https://helpx.adobe.com/lightroom/web/get-set-up/learn-the-basics/tour-the-workspace.html)分開返回和重設，也分開移出相簿與刪除照片。[原圖：細節頁](https://helpx-prod.scene7.com/is/image/HelpxProd/Images-are-displayed-with-different-presets-applie?%24pjpeg%24=&jpegSize=300&wid=1600) · [原圖：共享相簿](https://helpx-prod.scene7.com/is/image/HelpxProd/Two-images-are-selected-in-the-shared-albums-view%2C?%24pjpeg%24=&jpegSize=300&wid=1600) · [官方刪除範圍](https://helpx.adobe.com/lightroom/web/create-albums-and-organize-photos/add-and-organize-photos/delete-photos.html)。Adobe 手冊標示 2026-04-28，未標 build 或圖像日期；只核對原文及圖說，未重載圖像至預覽包。

[育伴港固定版本照片頁](https://github.com/2NTTY/child-ai-caregiver/blob/2f552cf35ef8dc536b08bdfb77a3fd0feb00aeff/frontend/src/components/photos/PhotosView.tsx#L119-L161)：返回不動頁內草稿，清除本頁重設編輯器，兩者都不刪除已存原件。刪除限有權者另行確認，影響原件及已連結記錄（如有）；共享原件會使其他家人無法再讀取。實體清理另行排程，不照搬其他產品相簿或復原方式。沒有執行刪除。

## 版本與檢查

- 完整預覽 SHA-256：`8a8170503c528adc5b9e307bd9d39ea653a5b9323de2733c868cbf6ce868d433`，31032396 bytes。
- 92 題、187 款（110 款外部連結），保留 146 張原有圖片。新兩款不轉載第三方圖片。
- 獨立靜態檢查及離線 JS 模擬通過：保留原 91 題、選題、比較、複製及搜尋；未驗證實際瀏覽器或外部圖像像素。
- 本分支僅保存文字及版本證據，未改產品、未建 PR、未合併或發布。
