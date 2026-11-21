# 選配工作台第 142 頁：一次把兩張手作照片拖進聊天，哪張已加入草稿？

- **A｜留在對話。** [Nextcloud Talk 整頁原圖](https://raw.githubusercontent.com/nextcloud/documentation/4ebe12f9a3e328158bdbd3d7b4d135069567dc95/user_manual/talk/images/drag-and-drop.png)及[官方手冊](https://docs.nextcloud.com/server/stable/user_manual/en/talk/attachments.html#sharing-files-in-a-chat)。只參考拖放時保留對話，不引入 Nextcloud 的多檔上傳。
- **B｜在裝置先選一張。** [WordPress 完整選圖視窗原圖](https://wordpress.org/documentation/files/2022/10/Screen-Shot-2022-10-27-at-10.36.03-AM-1024x575.png)及[官方指南](https://wordpress.org/documentation/article/page-post-settings-sidebar/#featured-image)。只參考縮圖、單選及另按確認；這是新方案，不是產品現有功能。

現版 Web 聊天輸入框一次拖入兩張，整批拒絕，兩張都不加入，原文字或附件不變。A 讓你重選一張；B 的本機選圖不預選、取消不改草稿。加入草稿不等於上傳或送出。用合成例，不操作產品或讀取真照片。原圖只外連，固定版本與程式證據見 `spec142.json`。

## 重建

- 前 141 題及原執行碼不變；142 題、287 款，其中 191 款只外連，165 張既有圖片。
- 以 SHA-256 為 `588dab3fbd5df174122046e2524dad7435e9aa2168756e1772565c40d3ad3ad1` 的 #141 HTML 執行 `python append142.py baseline141.html spec142.json output142.html`。
- HTML 34,498,521 bytes，SHA-256 `b22b968309bf75da02eec72918b9f74156f1b0f058534352a605a3123506beb9`。
- ZIP 22,806,404 bytes，SHA-256 `a5df44c49233c6339c52ebdef8a7f9f8f809ecf76761ad2880e746b3fc7d01f2`；`zip-proof.py` 可核對及還原。
- 僅獨立備份，未更新項目、主分支或網站。
