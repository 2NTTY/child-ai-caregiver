# 選配工作台第 146 頁：想先看怎樣開啟提醒，一定要讀完頭兩步嗎？

- **A｜從目錄直達第三節。** [Material for MkDocs 完整文件視窗](https://raw.githubusercontent.com/squidfunk/mkdocs-material/bcc3f28764178139b4cee96b9fb0c2ccd9bf2bd2/docs/assets/screenshots/navigation-sections.png)，只參考目錄與正文並列。
- **B｜按兩次「下一步」。** [Hugo Learn 完整閱讀畫面](https://raw.githubusercontent.com/matcornic/hugo-theme-learn/3202533a746f91c67de1a8fa373c0328ec1b403d/images/screenshot.png)，只參考逐節翻閱入口，沒有採用圖中的勾選標記。

兩個入口已在原碼並存。數字表示閱讀次序；讀到第三節不會啟用通知，「前往設定」是另一個按鈕。合成示例未呼叫通知權限、未修改設定。官方原圖僅外連，版本和原碼行號見 `spec146.json`。

## 重建

- 前 145 題與執行碼不變；146 題、295 款，其中 199 款只外連，165 張既有圖片。
- 以 SHA-256 為 `9d96e015ff57a112d7c6e72c3ca4c78bf0998d0c91ac1dddea9e7e2585e50979` 的 #145 HTML 執行 `python append146.py baseline145.html spec146.json output146.html`。
- HTML 34,515,238 bytes，SHA-256 `53aecaebcaa78dead49682dafffc19689118d7b6fd7ea585bb1fed971d4e985d`。
- ZIP 22,810,905 bytes，SHA-256 `cab5e9b8c3aa673a5611edaed9e17be52d66c5e4ee6c1202e4f01bedc3b20a25`；`zip-proof.py` 可核對及還原。
- 僅獨立備份，未更新產品、主分支或網站。
