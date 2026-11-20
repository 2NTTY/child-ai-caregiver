# 選配工作台第 108 頁：私人 PDF 已可下載，助手這次實際讀了哪一頁？

保留前 107 頁及選項；共 108 題、219 款、123 款外連，原有 165 張離線圖不變。

- **A：在這條答覆旁查看閱讀證據。** [Open WebUI 官方完整原圖](https://github.com/open-webui/docs/blob/be66142d8c1fb0ec031ad75ca54ed12665a632bc/static/images/open-terminal-display-file-manual-page.png)，0.13.0 文件修訂。圖中答覆指向第 132 頁，原檔預覽也開在同頁；不是讀取稽核，沒有證明助手讀過其他頁。
- **B：整頁逐頁區分結果。** [PDF2OCR 作者原圖](https://github.com/rishabh3354/PDF2OCR/blob/26a3636f5cd58cb9cc0c410b728b9d593e772f3b/share/screenshots/01-scan-to-text.png) 示範已完成的逐頁清單及一頁文字；同版原碼另區分試讀未能抽取文字和尚未處理，但原圖未展示這兩種情況。兩張圖均只外連。

[育伴港 PDF 讀取原碼](https://github.com/2NTTY/child-ai-caregiver/blob/573d29821035e74dc90be6d968788f48cedd6937/server/chat-file-reader.ts#L38-L66) 只支持有界的文字結果。可下載原檔不證明助手讀過；讀取失敗只在請求頁與結果確實配對時才可標示該頁。文字抽取不證明圖片、排版或整份文件已檢查。兩款都是設計對照，現版未核實有完整用戶端逐頁紀錄。未使用私人檔案或模型。

## 重建與驗證

只備份可重建文本，無私人 ZIP 或上游圖檔。使用獨立驗證的 #107 HTML（SHA-256 `b2dfea34d35970a4768ed97a6587e37faf4c13042377bd1b6db09d101b6bd506`），執行 `python append108.py baseline107.html spec108.json output108.html`。

- HTML 34,308,220 bytes，SHA-256 `7854b8c2164dd6798473510a1b2fff8f06c5a7982d4c9edeeb9202161cd4b84b`。
- 單檔 ZIP 22,748,725 bytes，SHA-256 `a012eb1a9b1f9a0fe33e62a94ea8efb2e80022a9e56fe3e520a8e09c06c2bfb2`。
- 專項離線檢查通過：保留前版選項，閱讀狀態、原始圖源、導覽、對照、複製來源。未更新線上版、四方案或 master。
