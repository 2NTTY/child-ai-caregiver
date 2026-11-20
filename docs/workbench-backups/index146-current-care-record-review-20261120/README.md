# 選配工作台第 128 頁：昨天核對過，今天改了日期，為甚麼同一筆記錄又亮黃燈？

- **A｜留在原回報旁對照。** [Crowdin 官方完整工作區原圖](https://support.crowdin.com/_astro/sbs_editor.BS-ZxXRm_Zx14K0.webp)把原句和譯文並列。只借同頁對照，不照搬 Crowdin 修改後仍保留原批准的規則。
- **B｜從歷史開單筆核對詳情。** [ODK 官方完整詳情原圖](https://docs.getodk.org/_images/details.png)把已收資料與核對活動分開。這是擬議的獨立頁，只有舊資料可讀才顯示；不承諾有完整核對歷史。

昨天的確認只對當時那一版。[育伴港核對邏輯](https://github.com/2NTTY/child-ai-caregiver/blob/6e91757e5f66fded6dc3f8bfe58602f2d26daf7a/frontend/src/care-view-model.ts#L137-L147)分開已寫入與已人手核對；正式讀取介面[未接通核對](https://github.com/2NTTY/child-ai-caregiver/blob/6e91757e5f66fded6dc3f8bfe58602f2d26daf7a/frontend/src/production/CareReadCoordinator.ts#L223-L230)。比較只用合成例，不會改記錄、通知家人，也不是向外部機構預約。新原圖只外連。

## 重建與檢查

- 前 127 頁不變。128 題、259 款，其中 163 款只外連，保留 165 張既有圖。
- #127 HTML SHA-256 `d5fac2a2025ae8eb5c03d10ae685db008644374be8dd25c5eeb60e65267ba148`；`python append128.py baseline127.html spec128.json output128.html`。
- HTML 34,409,591 bytes，SHA-256 `fbbc7e2ee3ee7d426d2893b642b7f42bdd739ead7b870e6b44b26f35018a47bb`；ZIP 22,781,705 bytes，SHA-256 `c31590cadd6a281cde8dd63e387f96c7e01b8eccf2f94e4c78745c78e1d65259`。
- 離線驗證，不代表現網驗收。沒有更新網站、主分支或四方案。
