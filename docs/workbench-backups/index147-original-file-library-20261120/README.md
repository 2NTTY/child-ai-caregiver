# 選配工作台第 129 頁：不用重翻聊天，怎樣找到這個孩子曾上傳的原檔？

- **A｜在附件清單辨認原檔。** [Google Chat 官方 Shared 整頁](https://workspaceupdates.googleblog.com/2024/03/access-and-sort-shared-files-in-google-chat-space.html)把檔名、類型、分享者和日期放同一列。育伴港只借清單排法，顯示附件建立日，不把它當成 Google 的分享日。
- **B｜先打開單筆詳情。** [Nuxeo 官方單檔詳情原圖](https://doc.nuxeo.com/assets/nxdoc/2021/digital-asset-management-dam/video_document_type-webui.png)把一個原件的資訊放在一起。這是擬議整頁，現有的是局部對話框；不借用 Nuxeo 播放器。

「活動清單.pdf」和「紙船示範.mp4」是合成例。在[附件回看 → 影片與文件](https://github.com/2NTTY/child-ai-caregiver/blob/6e91757e5f66fded6dc3f8bfe58602f2d26daf7a/frontend/src/components/photos/PhotosView.tsx#L92-L117)看到檔名不保證仍可下載，[下載前須再核對存取和版本](https://github.com/2NTTY/child-ai-caregiver/blob/6e91757e5f66fded6dc3f8bfe58602f2d26daf7a/frontend/src/production/ChatFileMessage.tsx#L14-L53)。「前往聊天」不是直達原訊息。工作台不下載、播放、分析或更改權限，原圖只外連。

## 重建與檢查

- 前 128 頁不變。129 題、261 款，其中 165 款只外連，保留 165 張既有圖。
- #128 HTML SHA-256 `fbbc7e2ee3ee7d426d2893b642b7f42bdd739ead7b870e6b44b26f35018a47bb`；`python append129.py baseline128.html spec129.json output129.html`。
- HTML 34,415,999 bytes，SHA-256 `3a1ac297cecb57c460bef6e55dd035f6870f4bb409d380881a0a792e2108786c`；ZIP 22,784,035 bytes，SHA-256 `332dbc28da3c4cc62269a161f40dc2637206191fc3478c5b31d649bf2e76c331`。
- 離線驗證，不代表現網權限驗收。未更新網站、主分支或四方案。
