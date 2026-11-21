# 選配工作台第 140 頁：這筆照顧記錄打不開，其他記錄還能看嗎？

- **A｜回原清單。** [VA 手機首頁整屏原圖](https://design.va.gov/images/templates/homepage/VAHB-home-3.1.png)供排版參考，[VA 部分來源失敗、其餘內容照常顯示的獨立範例](https://design.va.gov/templates/home-pages/authenticated#2-one-source-fails-and-other-items-loaded)供策略參考。原圖不是單筆失效場景。
- **B｜先看獨立說明，再返回。** [Miro 單一白板不可用的官方整頁原圖](https://help.miro.com/hc/article_attachments/21016057938450)有獨立說明和安全出口；[來源文章](https://help.miro.com/hc/en-us/articles/5225385943954-I-can-t-access-or-edit-a-Miro-board)。原圖的入口回 Miro，不是原清單；不搬登入、分享或 Cookie 功能。

單筆不可讀不等於刪除或失去整個孩子的權限。有權時保留同一孩子的其餘可讀記錄；不補舊資料或其他孩子資料。已開詳情暫時不能查核時，原版可能把內容明確標成上次讀取；失去孩子權限時整個範圍的清單、詳情、草稿都隱藏。用合成例比較，不寫入、重建或還原。來源和固定程式行號見 `spec140.json`。

## 重建

- 前 139 題與原執行碼不變；140 題，283 款，其中 187 款只外連，保留 165 張既有圖。
- 以 SHA-256 為 `e2d079ab30c4dd895ae76db05b047aec1b18db3b5d04460b07b7c6b24f9f0ac0` 的 #139 HTML 執行 `python append140.py baseline139.html spec140.json output140.html`。
- HTML 34,488,013 bytes，SHA-256 `7444b46be91ce8a4d5cbe2a3486f7573eeea074409e27c24c2dbb5aede981606`。
- ZIP 22,803,610 bytes，SHA-256 `55bb1c5ac19d8f1dd2868a169c7bb6b2be860fdbc076e57d842e6cb91a2e14f8`；可用 `zip-proof.py` 驗證及還原。
- 僅獨立備份，未更新項目、主分支或網站。
