# Snapshot30：metadata／icons 與契約修補增量

**本地歷史證據：定向整合及 export 通過；snapshot30 有界瀏覽器取證已完成，但 Summary 自然focus有焦點／位移紅項，完整 TypeScript 在兩個環境均exit137，兩項門檻未通過。不是整批PASS；未發布。** [snapshot29 原包](../README.md)及其照片、原紅與限制維持凍結，不被本頁取代或改寫。

Snapshot30 包含本次全部 frontend 修補：先前的頁型、focus、讀取範圍及 Tabs／導航，再加 metadata／icons 一致性和 Contact 表單契約修補。最終範圍是 **57 檔＝34 產品＋22 測試＋1 設計文件，553 product inputs**。相對29精確差異為 **16檔＝9產品＋7測試**；其中已有檔案重疊，所以不是45＋16。

## 本版新增

- 待辦、準備單及關注時間線：正文先行，種類／人／時間／來源用緊湊圖示 metadata；保留真正的狀態及警告，不把所有資訊變成 chip。
- 助手提案、核對記錄及記憶：使用已知語意圖示、縮短重複標籤、保留無障礙完整名稱；選填空資訊退位，重要缺失／過期／未確認提示不隱藏。
- 記憶資料來源可展開既有追溯詳情；來源 URL 使用既有安全處理，開啟失敗可核對完整原文。沒有假造新來源導航。
- Contact schema 接受既有 `native_push`，最多三個渠道；原本人綁定、版本、去重及開關守門保持，不新增帳戶權限或通知能力。

## 證據不能相加

| 版本 | 來源／測試範圍 | 該版定向整合 | Browser |
|---|---|---|---|
| 29 | 45 檔，553 inputs | 20 unique scripts，159 PASS | Care／Tabs／歷史／合成模型審閱的限定場景通過；其他未驗另列。 |
| 30 | 57 檔，553 inputs | 15 unique scripts，144 PASS | Metadata、memory／tasks390、通知審閱及Contact安全讀取失敗代表通過；Summary自然focus紅，tasks1440自然focus未知。不沿用29照片。 |

兩組 scripts 有重疊，不計303項或作者測試總和。30的15 scripts只代表此增量必要範圍，不宣稱57檔所有功能都重跑。原 AppIcon harness 失敗及唯一 test-port 修正保留。

唯一 export：exit0、135.301秒，65 raw／36 HTML／72 packaged，553 inputs及scope前後相同，靜態validator PASS。bundle SHA-256：`a5b1662b88e46d14216430967f4ec4f7071a280aadb031481f1d27e23d68ec47`。

完整TS的768 MiB程序heap嘗試以exit137／Killed停止，沒有diagnostics，原因未明；不能稱TS綠，也不能沿用29的明確V8 heap錯誤當成本次根因。替代雲端Terminal亦以exit137／Killed停止（9.854秒、RSS842696KiB），沒有diagnostics；inputs／scope前後一致，根因仍未知，不能推定host OOM。**完整TS門檻仍未通過；preview有界驗收不等於正式全綠。**

## 閱讀入口

- [全部本次改動與版本歸屬](all-changes.md)
- [18-route分層覆蓋矩陣](route-coverage.md)
- [測試、審核及原失敗](checks-and-limits.md)
- [57檔來源hash](receipts/source-scope57.json)／[29→30精確差異](receipts/delta-from29.json)
- [export identity](receipts/export-identity.json)／[整合checks](receipts/checks.json)
- [30瀏覽器結果與8張代表原圖](browser-evidence.md)／[80原圖索引](original-images-index.json)

僅用合成資料；沒有真模型、真家庭資料、真照片／訊息、正式服務、GCP或OTA驗收。靜態包裝與browser都不代表正式後端接線或外部發布。PR／Site狀態須另按發布收據確認。

## 文檔附加與build分開

本次另有已審核的 `frontend/DESIGN_SYSTEM.md` 小型文檔補充，記錄正文優先、metadata圖標短值／必要label、種類與狀態分離、真互動target、空值確認與「本人」短名。30 build仍使用凍結原doc hash；交付新doc hash為 `d5b16b8d5778e0d0d1231a08d35d1713359b6533c641ce342ec8ae5f7a24faf6`，**產品inputs及bundle不變**。[文檔附加收據](receipts/documentation-addendum.json)分開記錄，不能當成重新build／browser驗收。

## 外部版本觀察

2026-10-23 **03:37 UTC** 的GitHub讀回：PR #253仍open／draft／未合併，head `2fdb8aa31a59fe4b01be8b7470da91740a793bae`，base `master`；尚無本版新commit或發布。這是帶時間的觀察，不保證之後狀態不變，外寫前須另核。

## 保留的版本邊界

Summary修補另候新版本覆驗；30紅項不因後續修好而回寫成綠。記憶圖48仍用「只供本人」，不能宣稱30全站短標籤已統一為「本人」。本包不包含31測試或照片。
