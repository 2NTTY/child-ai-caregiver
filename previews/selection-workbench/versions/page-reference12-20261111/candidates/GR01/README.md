# GR01：一般業務成長／進度概覽參考

**這不是育兒頁，也不是兒童成長紀錄介面。** 本包僅供完整頁面層級的設計比較，忠實保留官方原圖，不代表建議把商業指標或文案搬到育兒產品。

## 原圖

`original/dashboard-light.png` 是 shadcn/ui 官方 Dashboard 的 2668 × 2824 PNG，從頂部標頭、左側導覽、四個指標卡、完整趨勢圖，到十列狀態表與底部分頁均保留。未裁切、拼接、重新繪製、翻譯或增添標註。

- 官方展示頁：https://ui.shadcn.com/examples/dashboard
- 官方原圖：https://ui.shadcn.com/examples/dashboard-light.png
- 固定 commit：`dd41d19e2f80ff6891951f7ced74c2c9a650b065`
- 完整來源、檔案雜湊、上游 Git blob ID：`manifest.json`

## 授權與出處

原圖位於官方倉庫 `apps/v4/public/examples/dashboard-light.png`；同倉庫採 MIT 授權，版權標示為 Copyright (c) 2023 shadcn。原始授權全文已保留為 `LICENSE.md`。再分發本參考包時，請保留完整版權與授權通知，不得暗示這是育伴港原創設計或獲官方背書。未發現原圖另有授權排除；未把商標或作者身分解讀為可冒用的權利。

## 範例資料證據

`evidence/` 原封保留同 commit 的五個資料／程式檔：

- `section-cards.tsx`：四個指標卡的金額、數量、百分比都是靜態值。
- `chart-area-interactive.tsx`：91 天的固定日期與數值陣列；原圖 Apr 11 浮層的 Desktop 327、Mobile 350 與程式一致。曲線各未標數值的像素點不被宣稱已逐點反算。
- `data.json`：固定 68 列範例；前十列的標題、類型、狀態、目標、上限與審閱者均對上原圖。
- `data-table.tsx`：起始第 1 頁、每頁 10 列、兩個標籤數 3／2，與圖中 0/68 選取、第 1/7 頁相符。
- `app-sidebar.tsx`：固定示例品牌 Acme Inc.、展示名稱 shadcn、`m@example.com` 及插畫頭像引用；不是從真實使用者帳戶抓取。

已看過原圖，沒有真實家庭照片、兒童個案、家庭地址、電話、帳戶憑證或真實帳戶資料流。保留的姓名與插畫是官方公開範例的一部分；不將其宣稱為所有人物均不存在。

## 驗證與邊界

- `VERIFICATION.json`：封裝驗證結果與限制。
- `CHECKSUMS.sha256`：包內各檔案的 SHA-256。
- 七個上游原始檔都已核對其 Git blob ID 與固定 commit 的官方 tree 一致。
- 官方網站原圖與固定 commit 原圖逐位元相同。
- 未執行上游程式；這是原始官方畫面參考包，不是互動重製。
- 僅本地封裝，沒有 browser 操作、上傳或網站發布。
- 未收錄資料來源尚未完全確認的 BabyTracker 候選圖。
