# 選配工作台第 110 頁：手機分享檔案後，加入聊天草稿或上載作資料包？

保留前 109 頁及既有選項；共 110 題、223 款、127 款只外連，原有 165 張離線圖不變。

- **A：先看同一份檔案，再選去向。** [Adobe Acrobat Android 官方原圖](https://helpx-prod.scene7.com/is/image/HelpxProd/Share-document-link-screen-in-Acrobat-on-Android-s?fmt=png) 在已開啟 PDF 下分列兩個外送動作及上載提示。它是版面參考，不是接收檔案、私人草稿或 ZIP 匯入。
- **B：先選想做甚麼，再核對檔案。** [ENVY DESIGN 示例 6](https://envydesign.jp/patterns/en/import-duplicates/#design-6) 在已解析的庫存資料上先列處理選項；不能據此推斷育伴港在選擇前已讀檔。[Tomis 指南](https://tomis.app/docs/#share-extension) 另以文字記錄接收後的草稿／專案分流，並非此原圖，不是育伴港 ZIP 上載順序的證明。兩款只外連。

育伴港原碼顯示：[加入聊天是本機草稿](https://github.com/2NTTY/child-ai-caregiver/blob/573d29821035e74dc90be6d968788f48cedd6937/frontend/src/production/incoming-share-target.ts#L4-L32)，不送出、不上載；[明選資料包才上載驗證](https://github.com/2NTTY/child-ai-caregiver/blob/573d29821035e74dc90be6d968788f48cedd6937/frontend/scripts/incoming-share-package.test.cjs#L115-L137)，不等於已匯入。查看舊匯入不會重送或消耗新分享。兩款是方案，非 Android 真機驗收或 iOS 交付。

## 重建及驗證

分支只備份可重建文本。使用獨立驗證的 #109 HTML（SHA-256 `3355a65908afeb00a1a77c16785ef1d048ac2363d937b97768f40b154f3b8b8a`），執行 `python append110.py baseline109.html spec110.json output110.html`。
- HTML 34,316,788 bytes，SHA-256 `da83e0be1c043d101a60c4cca701364d6281690e0d3dc5dcceba6ada51ec9af8`。
- 單檔 ZIP 22,751,549 bytes，SHA-256 `c8f92e89da6f477583e314107ead420144be973e5f3e59fadd3085d96e3ef503`。
- 專項離線檢查：保留既有選項、新舊匯入隔離說明、來源和版本、搜尋跳轉、比較及複製。未操作真實分享、更新線上版或修改 master／四方案。
