# 選配工作台第 113 頁：準備單改成「帶兩盒彩筆」，昨天打的勾還算嗎？

- **A｜直接看現版準備單。** 彩筆數量變了，要重新核對；沒改的水樽保留原勾。[Bitbucket 整頁原圖](https://atlassianblog.wpengine.com/wp-content/uploads/2024/11/mark-files-as-viewed.png)顯示同頁已查看和未查看項；[官方文件](https://support.atlassian.com/bitbucket-cloud/docs/review-code-in-a-pull-request/)另證被改動的已查看檔才重設，原圖不顯示改動前後。
- **B｜先看這一版改了甚麼。** 先比同一張準備單有權查看的相鄰兩版，再回現版。[Microsoft Spreadsheet Compare 官方整窗](https://support.microsoft.com/en-gb/excel/media/o15-ssc-results.jpg)示範兩版並列與另列差異；沒有示範沿用原勾。缺舊版或無法核實就不猜。

[育伴港原碼](https://github.com/2NTTY/child-ai-caregiver/blob/573d29821035e74dc90be6d968788f48cedd6937/server/family-document-edits.ts#L58-L86)按原項維持或重設勾選：文字或來源識別序列有變就重設，只在原章移動不重設。[版本讀取](https://github.com/2NTTY/child-ai-caregiver/blob/573d29821035e74dc90be6d968788f48cedd6937/server/firestore-family-documents.ts#L511-L536)有同文件及來源限制。兩款是只讀設計比較，不能替代實物核對，不是現網功能驗收。原作者、精確原圖和版本界線見 `spec113.json`；兩案原圖只外連。

## 重建與檢查

- 保留前 112 頁與既有選項。共 113 題、229 款，其中 133 款只外連，165 張既有離線圖不變。
- 用已驗證 #112 HTML（SHA-256 `dc94014e0279304eebc4050c535566790ff5da6ccb19c99a8e32c3c9fcc1269e`）執行 `python append113.py baseline112.html spec113.json output113.html`。
- HTML 34,329,851 bytes，SHA-256 `10d7b4f77053c046bcf890adc189dd7709ec3785766e22537e9c77560a9178be`；單檔 ZIP 22,756,638 bytes，SHA-256 `e79948ffe6c6b25f1a6c9789923989373f36b1cf9d7d617f7cf49b4f57b04bbe`。
- 專項檢查涵蓋既有記錄保留、兩案來源、搜尋、並排比較和選擇摘要。獨立分支只備份重建文本，不更新網站、主分支或四方案。
