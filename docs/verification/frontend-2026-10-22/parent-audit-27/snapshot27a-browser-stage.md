# Snapshot27a 增量重驗

**6組有界增量案例通過，關閉snapshot27的關注按鈕主次RED。** 這不是全站重驗；snapshot27既有原圖及19個通過組別按精確未改範圍承接，兩個未實屏限制仍保留，不把27的原RED改寫成當時已通過。

| 項目 | 結果與界線 | 證據 |
|---|---|---|
| 關注主要次級層級 | PASS。320／390／1024 主次可辨；320助手＋手動同列、管理換行，390／1024三者同列。 | P27A-01、02、03 |
| 手動完整無障礙名稱 | PASS。可見短名「手動」，無障礙樹為「手動：新增／跟進關注」；不是螢幕閱讀器語音實測。 | 03補證 |
| 手動完整表單標題 | PASS。320／1024完整標題、原說明／欄位及關閉保留，無保存或模型呼叫。 | P27A-06、07 |
| 手動關閉回原入口 | PASS。1024 Enter開啟／Escape關閉及320點按開關都回焦原手動入口。 | 05補證 |
| 共用準備單dialog | PASS。可見「手動建立準備單」未改；完整無障礙名稱、表單標題及Escape回焦可用。 | P27A-08及補證 |
| 共用日期dialog | PASS。320起訖欄與關閉名稱保留；未套用日期Escape丟棄，不觸發家庭guard，回焦原入口，再開為空。 | P27A-09及補證 |

## 重驗原圖

| 圖片 | 說明 |
|---|---|
| [P27A-01](screenshots/snapshot27a/01-growth-hierarchy320.jpg) | 320 助手為緊湊主要樣式，與短「手動」同列，管理自然換行；未縮小點按目標。 |
| [P27A-02](screenshots/snapshot27a/02-growth-hierarchy390.jpg) | 390 助手、手動、管理同列，主要／次級差異可辨。 |
| [P27A-03](screenshots/snapshot27a/03-growth-hierarchy1024.jpg) | 1024 助手、手動、管理同列；保留原關注正文。 |
| [P27A-06](screenshots/snapshot27a/06-growth-manual-settled320.jpg) | 320 穩態手動表單仍用完整「新增／跟進關注」標題及原欄位、說明和關閉。 |

全部原圖為1364×1024 JPEG，合成內容；逐byte複製，無裁切／拼接／生成。04／05是開啟動畫，不用作穩態判斷；06／07才是穩態完整表單。預覽固定提示的上邊疊層未由27a修復，不能延伸成所有正式modal標題無遮擋。

## 仍保留的限制

- 跨工作區retained dirty／pending／unknown歷史日期情境仍只有source／DOM；沒有注入狀態冒作UI。
- 模型成功表單、key／endpoint／費用及write-unknown仍未實屏；27只驗正確未確認讀取態。
- 沒有全17頁重驗、正式服務／真模型、原生手機或完整螢幕閱讀器語音驗收。
- 新bundle SHA-256：`abf3e8dc7d012a87db73ac5732721cc10429c68454144b2fbfff8c3aba4dbcf2`；fixture沿用`461064eb151bff716b67a93ecc8b9305fdc2c0c05bdbf42eaa599fc2af00ef6d`。已發布至 Site86；[發布後5組窄範圍線上 smoke](site86-live-smoke.md)通過，與本候選階段結果分開。
