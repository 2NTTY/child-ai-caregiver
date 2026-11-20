# 選配工作台第 126 頁：家人看到午睡記錄，也能看到我和助手的整段聊天嗎？

- **A｜在原記錄逐欄核對。** [Zenodo 官方完整記錄頁](https://zenodo.org/records/8152674)把資源描述、來源和受限檔案分開。育伴港方案在同頁說明哪些字已寫入照顧記錄，不顯示私人聊天。
- **B｜另開「家人可讀內容」唯讀樣張。** [Adobe 官方整頁樣張原圖](https://raw.githubusercontent.com/AdobeDocs/journey-optimizer.en/2ec7de841e3d871ad4cfc545d80c5271c4137d2c/help/using/test-approve/assets/simulate-custom-variants-list.png)把示例輸入和受眾看到的結果分開。借用的是獨立預覽，並非身分或權限模擬。育伴港目前沒有這個獨立樣張。

有權讀取該孩子照顧記錄的家人，可看到這筆已存正文、來源描述及已存更正原因，即使有人把一句聊天原話填入其中。[「記錄原文」是已存記錄](https://github.com/2NTTY/child-ai-caregiver/blob/6e91757e5f66fded6dc3f8bfe58602f2d26daf7a/frontend/src/production/CareProfileProjections.ts#L53-L71)，[私人對話有獨立範圍](https://github.com/2NTTY/child-ai-caregiver/blob/6e91757e5f66fded6dc3f8bfe58602f2d26daf7a/server/firestore-chat.ts#L294-L305)。兩案只比較，不向家人發送、不改權限，也不保證自動移除已保存的私人文字。原圖和原頁只外連。

## 重建與檢查

- 前 125 頁不變。共 126 題、255 款，其中 159 款只外連；保留 165 張既有離線圖。
- 用已驗證 #125 HTML（SHA-256 `7455df867bfeb35cb79a11a9f3210c91f9d1f6f755890037a437d719d1909a67`），執行 `python append126.py baseline125.html spec126.json output126.html`。
- HTML 34,397,300 bytes，SHA-256 `96a1f729883776ee8ae4514ddbd2dc290ef44671131a79198369893b5730a271`；單檔 ZIP 22,777,453 bytes，SHA-256 `bd1b33df7d092b53bcbdd5156f3159900906382f2bfcc818eb3e295802d73e58`。
- 離線測試不等於現網權限驗收。沒有更新網站、主分支或四方案。
