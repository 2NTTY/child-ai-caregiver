# 選配工作台第 145 頁：從本人備份找回已刪的私人交代，原刪除紀錄會消失嗎？

- **A｜在比較頁逐項選，再送出。** [WinMerge 整個比較視窗原圖](https://manual.winmerge.org/en/screenshots/foldercomp1.png)。只參考完整比較畫面和每列的狀態。
- **B｜獨立確認頁列明恢復與覆蓋數。** [WordPress.com 完整確認畫面原圖](https://en.support.wordpress.com/wp-content/uploads/2026/11/restore-backup-confirmation.jpg)。是未實作提案，明示「恢復 1 項、覆蓋 0 項」，不沿用來源的預先全選或覆蓋方式。

合成例：比較只讀。只有核實刪除的項目才可恢復；成功會建立有備份來源的新項，原刪除紀錄保留，再次比較會連回新項。未讀或未核實不自動納入，衝突不算成功。未使用真資料或實際執行還原；固定程式位置和完整版本資料在 `spec145.json`。

## 重建

- 前 144 題及原執行碼不變；145 題、293 款，其中 197 款只外連，165 張既有圖片。
- 以 SHA-256 為 `836519f5efb1b08ddd9813e41d84fa2def2f5cddcc69241e5f0d139c2a759d11` 的 #144 HTML 執行 `python append145.py baseline144.html spec145.json output145.html`。
- HTML 34,511,694 bytes，SHA-256 `9d96e015ff57a112d7c6e72c3ca4c78bf0998d0c91ac1dddea9e7e2585e50979`。
- ZIP 22,809,919 bytes，SHA-256 `dfdd44c77a309cca16e0371fd1266b644e88543fe82689d75195b14f77c1d231`；`zip-proof.py` 可核對及還原。
- 僅獨立備份，未更新產品、主分支或網站。
