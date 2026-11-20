# 選配工作台第 134 頁：聊天設定已保存，為甚麼需要向量的知識搜尋仍不能用？

- **A｜同頁分開兩種設定。** [RAGFlow 官方整頁原圖](https://raw.githubusercontent.com/infiniflow/ragflow-docs/1dacd1c32cb05980eabccc70ba975635f3309909/images/select_model_provider.jpeg)把聊天、向量及其他用途分開列出。育伴港借用版面，不沿用模型清單或配置規則。
- **B｜先看能力狀態。** [Home Assistant 2023.6 官方整頁原圖](https://www.home-assistant.io/images/blog/2023-06/integrations-dashboard.png)把未配置項目與其他狀態分開，讓用戶自己選擇何時進設定。育伴港這一整頁是提案。

適用於帳戶服務已啟用且有設定權限的情境。已保存聊天不等於已驗證連線；需要向量的搜尋在缺設定時先停止，不借平台額度、不自動切換服務商。比較使用合成資料，不調用模型、不更改設定，只外連原圖。

## 重建與檢查

- 第 133 頁以前不變；共 134 題、271 款，其中 175 款只外連，保留 165 張既有圖片。
- 以 SHA-256 `34fbe59753ed011342b0be1e1529a4d9698f2ee474b59353336f20fe5ba2c01d` 的 #133 HTML 執行 `python append134.py baseline133.html spec134.json output134.html`。
- HTML 34,451,393 bytes，SHA-256 `bc6197e50dd439e9b2ca1870fab0e1642ceca99042a71f81de77eebac69f5ab6`；ZIP 22,794,940 bytes，SHA-256 `2fd71699a9e13968cc1d21f3c2afa9a0659ed59610791d3108084d34abfcb11f`。
- 從還原 #133 重建後與草稿逐位元組一致，離線靜態檢查通過；未更新網站、主分支或四方案。
