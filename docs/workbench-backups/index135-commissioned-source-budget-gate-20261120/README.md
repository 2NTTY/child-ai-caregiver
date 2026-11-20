# 選配工作台第 117 頁：自動巡查日額已滿，這份受命官文還可以人工續做嗎？

- **A｜先看全批還可預留多少。** [Procore 官方成本總覽原圖](https://support.procore.com/@api/deki/files/158964/cost-summary-tracker-overview.png?revision=1)示範全批總覽與各組承諾分列；它的「剩餘」不是育伴港的可用額。
- **B｜先看這份能否沿原操作接續。** [AWS 官方執行詳情原圖](https://d2908q01vomqb2.cloudfront.net/b6692ea5df920cad691c20319a6fffd7a4a766b8/2023/12/13/DBBLOG3690_5_image5-masked.png)分開顯示原執行、接續和新建；它沒有育伴港的付費預留。

[育伴港受命資格及用量](https://github.com/2NTTY/child-ai-caregiver/blob/54a2a602339a8cab5ec894418497d8b4bbff2d59/server/firestore-ai-usage.ts#L87-L124)不等於免計費。[共用毛額](https://github.com/2NTTY/child-ai-caregiver/blob/54a2a602339a8cab5ec894418497d8b4bbff2d59/server/knowledge-campaign-budget.ts#L103-L156)仍核已結算、未結預留及下步所需；同一原件未結先查原操作，不重送。預留不等於已派送或發布。兩案是只讀設計比較，金額純屬假設，並非現行帳本或現網驗收；不改額度、不付費、不派送、不發布。完整原圖、版本、原作者和權利範圍見 `spec117.json`；新增原圖只外連。

## 重建與檢查

- 前 116 頁和既有選項不變。共 117 題、237 款，其中 141 款只外連，保留 165 張既有離線圖。
- 用已驗證 #116 HTML（SHA-256 `10f2a1a98647be398ff531f21cef9a23725c082420a8996941b5c840c3f62c84`），執行 `python append117.py baseline116.html spec117.json output117.html`。
- HTML 34,349,930 bytes，SHA-256 `df6f796552cefecf7d4e2c4ff916717585cb2fb804f0450673b4e5174d868084`；單檔 ZIP 22,763,576 bytes，SHA-256 `3b4675d26e9cc1487d05bd0f91b463f2125604ec38cf3430cd3f1bce4f9aa5b1`。
- 獨立分支只放可重建文本，不改網站、主分支或四方案。
