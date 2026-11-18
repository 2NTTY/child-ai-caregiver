# 工作台第 22 版：本人模型設定

這是一份文字索引，記錄兩款設定頁的原始版本、離線擷取範圍與校驗值。**不能單靠這個 GitHub 分支還原完整預覽。** 這次新增的文件不包含圖片、第三方程式、憑證、預覽檔案或私人存取連結。

## 兩款設計

- **A｜Explain Me 1.0.0：單卡。** [原作者選項頁](https://github.com/indrarahul/explain-me/blob/bfe436611fb9b294f4ae519db48e9286473e6613/options.html)；版本 `indrarahul/explain-me@bfe436611fb9b294f4ae519db48e9286473e6613`，[MIT © 2026 z3r0](https://github.com/indrarahul/explain-me/blob/bfe436611fb9b294f4ae519db48e9286473e6613/LICENSE)。四個欄位之後是儲存按鈕與快捷鍵說明。模型欄為空，gpt-4o-mini 是提示文字，不是已選值。提示詞文字框保留原本的內部捲動。390px 為受控窄視窗，不是手機安裝實測。
- **B｜Page Summarizer 1.2.0：分段選擇。** [原作者選項頁](https://github.com/bharatnanda/page-summariser/blob/18f6f8408a741e4fc6f42290bca430d8d06c12c2/core/options.html)；版本 `bharatnanda/page-summariser@18f6f8408a741e4fc6f42290bca430d8d06c12c2`，[MIT © 2026 Page Summarizer](https://github.com/bharatnanda/page-summariser/blob/18f6f8408a741e4fc6f42290bca430d8d06c12c2/LICENSE)。選定 gpt-4o-mini，進階設定刻意展開，不是首次開啟狀態。同步和語音朗讀均關閉。390px 原頁的供應商列末端被裁切；450px 補圖可見完整一列。頁尾的重設與儲存按鈕沒有遮住最後一個控制項。

兩案同為選中 OpenAI、密鑰留空的唯讀離線狀態；未安裝擴充套件、儲存、同步或調用模型。這是依原頁結構固定狀態後的擷取，不是作者提供的截圖，也不代表已驗證來源軟體的執行行為。

育伴港的[本人模型設定](https://github.com/2NTTY/child-ai-caregiver/blob/82f44a08019a0fc00ec068252f1359886154af64/frontend/src/components/model-settings/ModelSettingsView.tsx) 隨帳戶，而非孩子。這兩案供比較欄位排列及進階設定的位置，並不對應育伴港的密鑰保護、權限或用量。尤其不可將 A 的瀏覽器同步方式當作密鑰儲存建議。

## 私人擷取件指紋（SHA-256）

- A-wide（1280 × 780）：`07ae3560e0027836c1a0e58c5808d7b7f6a9e2bcffc658e9bdd06ca6805877b9`
- A-narrow（390 × 790）：`b59a52a42946f0b7e87b4c1d3457fd1c13fe99964cefafb4ff630ba447421ed5`
- B-wide（1280 × 1530）：`91840fae80868fea885f0ebe9cf8b9b503440a82df770a9c11b66ff77602bf1e`
- B-narrow（390 × 1620）：`9ed7e55ff623075a2e06fae93b58b6be3580d4c24ec32abf1e150badf558719c`
- B-mid（450 × 1610）：`3e076a2e3b514ca94805644bc195c547e73bf5a2076651240511fb57685b2b2f`

原始來源證據包：`80c7edbc026c2895636214dc0c5ee108b36d157f81277aed2799bfb87ade8b79`（25 檔，核對 15 個上游 Git blob）。兩案可攜比較頁：`2e61b8bc9ba5dcf246ece33a28f62b78cf3942a21ddc10a1a00e40f33c62eafe`。本版增量 ZIP：`b9642884b6cef1402ebd7b1bc5f594f03cc8c496496cf98faf6d5f0f7c04108d`。完整預覽的圖片與檔案只保存在私人備份；還原歷代工作台仍需較早版本。

比較頁已驗桌面與窄窗、雙案／單案、原尺寸及來源說明；工作台保留 25 個舊入口和歷史單案，本版為第 14 組雙案。這不是重新走查 25 個舊頁，也不是育伴港模型功能驗收。
