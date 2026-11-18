# 工作台第 21 版：接收分享

**這是自寫的來源與驗收索引，不能單靠這個 GitHub 分支還原完整預覽。** 此提交不含圖片、第三方原始碼、字型、示例連結內容、預覽 HTML、私人備份或存取連結。完整的雙案單頁和還原增量另存於私人備份。

## 兩種接收方式

- **A／先核對，再轉交。** Jonathan Kimball 的 [Link to MD 原頁](https://github.com/JAKimball/poc-pwa-share-target/blob/773cc455f4f5d72a134fac2237e6738e72d18442/index.html) 和[接收程式](https://github.com/JAKimball/poc-pwa-share-target/blob/773cc455f4f5d72a134fac2237e6738e72d18442/app.js)，`JAKimball/poc-pwa-share-target@773cc455f4f5d72a134fac2237e6738e72d18442`，MIT。原示例從文字抽出連結，顯示 Markdown，使用者可另行轉交；它在接收時已把最近 100 筆記入本機，並不是完全不留存的草稿。
- **B／先收藏，再整理。** mmrahmanbappi 的 [Share Target Link Saver 示範頁](https://github.com/mmrahmanbappi/100-vanilla-javascript-projects/blob/4028dc58b8b375532ad196b5ff3484ff49dbd63c/03-pwa-and-offline/025-share-target-link-saver/demo.html) 及[接收目標宣告](https://github.com/mmrahmanbappi/100-vanilla-javascript-projects/blob/4028dc58b8b375532ad196b5ff3484ff49dbd63c/03-pwa-and-offline/025-share-target-link-saver/manifest.webmanifest)，`mmrahmanbappi/100-vanilla-javascript-projects@4028dc58b8b375532ad196b5ff3484ff49dbd63c`，MIT。實際接收目標是 demo.html，非專案說明首頁。原教學示例收到連結就寫入本機閱讀清單，轉發是另一步。
- **育伴港比對範圍。** [驗收當時的固定版 shareScreen](https://github.com/2NTTY/child-ai-caregiver/blob/39f914dafc516d89904bfe99f38d112972480753/frontend/src/screens/shareScreen.tsx#L20-L68)，`/share` 的流程是核對孩子及內容、加入聊天草稿，再由本人送出。沒有將兩個來源的儲存或傳送規則當成育伴港實作。

兩款使用同一份合成分享輸入、未連接原服務。A 保留四個按鈕及最末 Raw Inputs；B 保留新增後三筆閱讀清單、操作說明、程式範例及 MIT 頁尾。B 原作者另有未接收時的首屏，不是此次私人完整狀態。此處所指的是**固定來源的離線靜態擷取，不是作者原長圖、真機或原作操作驗收**。

## 四個私存 PNG 的指紋（不含圖片）

| 參考頁／視窗 | 原像素 | bytes | SHA-256 |
|---|---:|---:|---|
| A 桌面 | 1280 × 800 | 84,926 | `d61e1df9591758e4de14a289bce5f614d9b60c49ca19359cf787b74477280389` |
| A 窄窗 | 390 × 845 | 78,681 | `dbaaa02cea0e9522291c76aafb9c19be62288de7a3602d6246b9c74926b62fce` |
| B 桌面 | 1280 × 1592 | 719,682 | `2c348f68aeb9b0e2e276e4a2bdde42f838deda1fbbbb9bac56451a407f7dc41e` |
| B 窄窗 | 390 × 3080 | 654,246 | `68531f337d977e05009fdd26fe10bf45baebb611c3adacd5f248e5ad5add5ad1` |

## 已驗、未驗與還原

- 私人擷取採修正版 fix01：修正 B 凍結頁的頁首殘字，核對 21 份 Git blob 與 29 個封存檔；早期 B 不納入比較。B 用四個固定本地字型檔（[三個字型家族的來源版本](https://github.com/google/fonts/tree/7af0d90b4d532ffa4b041937b560c6df4e7b1e95/ofl)），按原家族保留三份 SIL OFL 1.1；不保證與原站當時取得的字型位元或畫面逐像素相同。
- Chromium 實測第十三組比較的目錄進出、桌面並排、單看、切換 390px、放大及還原、來源與授權展開。B 窄圖最末頁腳可見；程式範例依原版在區塊內橫捲，圖只顯示預設橫向位置。第 20 版原十二組、25 條原入口和一個歷史單案的連結保留，未逐一重驗舊頁。
- 沒有執行來源腳本、測試系統分享、實際寫入、匯出、使用剪貼簿、安裝 PWA 或向應用傳送；未使用真實帳戶或家庭資料。
- 已從私人備份讀回核對，完整雙案單頁 SHA-256 `068af4ac9e23bf07299c78d2eef7a38be05728b7c4e3e28fd887d1f8f5510731`，第 21 版增量包 SHA-256 `5fa7333f3c77dec0a562e01beed1675102069633273fab6b48b7889aa4e57495`。雜湊不是下載連結，還原完整歷史工作台仍需先前基底與依賴。
