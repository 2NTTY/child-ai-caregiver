# 選配工作台第 116 頁：「來源確認」算是我在這裏核對過嗎？

- **A｜從目前孩子檔案看來源。** [RootsMagic 12 官方整頁原圖](https://help.rootsmagic.com/RM12/images/rm_editperson-info.jpg)把出生資料和各自來源放在同一檔案；它不是育伴港的匯入確認流程。
- **B｜從該副本看來源經過。** [Wikimedia Commons 原站修訂史](https://commons.wikimedia.org/wiki/File:Candi_Plaosan_oleh_Tiwuk_Suwantini.jpg?action=history)分開列原站修訂、匯入和後續改版。本地改版不等於照顧者確認；補充的早期測試原圖並非同一檔案。

[育伴港標示](https://github.com/2NTTY/child-ai-caregiver/blob/54a2a602339a8cab5ec894418497d8b4bbff2d59/frontend/src/production/CareProfileProjections.ts#L8-L19)區分來源確認與「你已確認」，相同帳戶識別碼也不混用。[匯入寫入](https://github.com/2NTTY/child-ai-caregiver/blob/54a2a602339a8cab5ec894418497d8b4bbff2d59/server/firestore-care.ts#L338-L345)分保存本次匯入與原處確認；[本地明確保存更正](https://github.com/2NTTY/child-ai-caregiver/blob/54a2a602339a8cab5ec894418497d8b4bbff2d59/server/firestore-care.ts#L159-L192)才另有版本。資料仍有效且有權時，現有功能可以按自己的規則使用，這不等於本地確認。兩案只供設計比較，不涉及實際匯入、更正、權限或現網驗收。原作者、精確版本與來源見 `spec116.json`；原圖只外連。

## 重建與檢查

- 前 115 頁和既有選項不變。共 116 題、235 款，其中 139 款只外連，保留 165 張既有離線圖。
- 用已驗證 #115 HTML（SHA-256 `78d99e644def4b1af9f5c67597fc0eee8339a10a0abacef566b80d54d331312a`），執行 `python append116.py baseline115.html spec116.json output116.html`。
- HTML 34,345,311 bytes，SHA-256 `10f2a1a98647be398ff531f21cef9a23725c082420a8996941b5c840c3f62c84`；單檔 ZIP 22,762,062 bytes，SHA-256 `40bd7af957d95707aafa3e37768d82f7f24bc3e9f89aac8e508359e704186ed2`。
- 專項離線檢查涵蓋既有記錄、來源、搜尋、比較與選擇摘要。獨立分支只備份可重建文本，不更新網站、主分支或四方案。
