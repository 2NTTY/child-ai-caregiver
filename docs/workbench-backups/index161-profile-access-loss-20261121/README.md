# 選配工作台第 143 頁：正在改孩子檔案，權限失效後舊草稿會跟過去嗎？

- **A｜先解釋，再手動切換。** [WordPress.com 整頁受限原圖](https://en.support.wordpress.com/wp-content/uploads/2024/10/private-site-request-access.png)及[官方說明](https://wordpress.com/support/privacy-settings/make-your-website-private/#view-a-private-site)。只參考整頁提示，不引入登入或權限申請。
- **B｜直接選仍有權查看的孩子。** [Firefox 原圖](https://blog.mozilla.org/wp-content/blogs.dir/278/files/2025/05/profiles-screenshot-1024x882.png)及[Mozilla 原文](https://blog.mozilla.org/en/firefox/shifting-left-for-better-accessibility/)。只參考完整選擇視窗；同頁列出可選孩子是未實作提案。

權限失效與普通離線不同。固定版本畫面不再顯示舊檔案、歷史和編輯器；合成預覽會清除該頁草稿，並忽略不再符合範圍的完成回覆。這不等於刪除後端資料或取消已送出的請求。兩款均不自動切換、不帶走舊草稿，也不改動權限。原圖僅外連，精確出處和程式碼位置見 `spec143.json`。

## 重建

- 前 142 題及原執行碼不變；143 題、289 款，其中 193 款只外連，165 張既有圖片。
- 以 SHA-256 為 `b22b968309bf75da02eec72918b9f74156f1b0f058534352a605a3123506beb9` 的 #142 HTML 執行 `python append143.py baseline142.html spec143.json output143.html`。
- HTML 34,502,957 bytes，SHA-256 `e6c3b8f75513e71ee7a39bfa7795a7dad413cb09fa5b3f0d39a0338bf48d5850`。
- ZIP 22,807,501 bytes，SHA-256 `9b9c4c09af6c565c917a4438d651b88dc83bec47b954aee7a0d79d198c9603c3`；`zip-proof.py` 可核對及還原。
- 僅獨立備份，未更新產品、主分支或網站。
