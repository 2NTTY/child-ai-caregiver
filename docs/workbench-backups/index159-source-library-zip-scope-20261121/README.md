# 選配工作台第 141 頁：兩個 ZIP 都寫着教材名稱，哪一個有收錄的原文片段？

- **A｜先比較內容。** [Pressbooks 匯出頁原圖](https://pressbooks.pub/app/uploads/sites/4748/2025/07/Export.png)及[官方匯出指南](https://guide.pressbooks.com/chapter/export/)。同頁列出書籍檔案和連結格式供比較，只參考排列，不複製多選或匯出進度。
- **B｜先選用途。** [Veeam 完整備份精靈原圖](https://helpcenter.veeam.com/docs/agentforwindows/userguide/images/ep_backup_job_mode.png)及[官方指南](https://helpcenter.veeam.com/docs/agentforwindows/userguide/backup_job_mode.html)。先解釋不同範圍能做甚麼，再進下一步。只參考分步方式，不搬備份預設或目的地設定。

版本參照 ZIP 不帶原文，只帶來源及固定版本識別、校驗清單。來源庫 ZIP 可含獲准分享的收錄內容，不是原版 PDF 或全冊。分享原文須註明出處、限非商業用途。選取參照 ZIP 只核對，另行明確選用才採用版本；不發布未公開內容。僅合成比較，不匯出、匯入或分享真實資料。兩張原圖只外連，詳細來源與程式行號見 `spec141.json`。

## 重建

- 前 140 題及原執行碼不變；141 題、285 款，其中 189 款只外連，165 張既有圖片。
- 以 SHA-256 為 `7444b46be91ce8a4d5cbe2a3486f7573eeea074409e27c24c2dbb5aede981606` 的 #140 HTML 執行 `python append141.py baseline140.html spec141.json output141.html`。
- HTML 34,493,066 bytes，SHA-256 `588dab3fbd5df174122046e2524dad7435e9aa2168756e1772565c40d3ad3ad1`。
- ZIP 22,805,080 bytes，SHA-256 `37acb9a2d9d9cc2bf7d81b74e8fa73c494be82f1826af29808edc46b948233e4`；`zip-proof.py` 可核對及還原。
- 僅獨立備份，未更新項目、主分支或網站。
