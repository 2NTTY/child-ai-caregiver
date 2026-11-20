# 選配工作台第 118 頁：老師退出班級又加入，舊待辦的到期提醒會恢復嗎？

- **A｜原待辦詳情。** [Jira 官方整頁原圖](https://confluence.atlassian.com/jirasoftwareserver0820/files/1299911649/1299911650/1/1688733278786/Full%2Bissue%2Bview%2Bin%2BJira%2BSoftware.png)同頁放原工單、負責人和改派入口。停用負責人見另一張官方局部圖，並非這張的同一工單。
- **B｜班級原指派清單。** [Asana 官方整頁原圖](https://assets.asana.biz/transform/31e2396a-6c6b-4497-8dbf-d9dfda60a044/previously-assigned-tasks-final-1?format=webp&io=transform%3Afill%2Cwidth%3A2560)集中列出離開成員先前的未完工作。只借清單結構，不用它證明復班規則。

同一帳戶重新入班會取得[新會籍](https://github.com/2NTTY/child-ai-caregiver/blob/54a2a602339a8cab5ec894418497d8b4bbff2d59/server/firestore-sharing.ts#L559-L576)；[舊提醒不會自動恢復，原待辦保留](https://github.com/2NTTY/child-ai-caregiver/blob/54a2a602339a8cab5ec894418497d8b4bbff2d59/tests/class-task-worker.test.ts#L93-L110)。名冊看見名字不證明舊指派有效。未核實不標「已停止」；有權另行核對和改派才會保存原待辦的新版本，不保證送達或撤回已送提醒。兩案只讀，不是已部署介面。原圖、作者、已知版本和授權界線見 `spec118.json`；新增原圖只外連。

## 重建與檢查

- 前 117 頁不變。共 118 題、239 款，其中 143 款只外連，既有離線圖片 165 張。
- 用已驗證 #117 HTML（SHA-256 `df6f796552cefecf7d4e2c4ff916717585cb2fb804f0450673b4e5174d868084`），執行 `python append118.py baseline117.html spec118.json output118.html`。
- HTML 34,354,803 bytes，SHA-256 `aa206ad8d3db5cd3199c6fec0e035e00f255adc8f06cd87aeb5a606dc6b55bee`；單檔 ZIP 22,765,196 bytes，SHA-256 `d94e9dd5883fae4a78ea91d780ff9c5b6d36c7e19ab3851b4ad00aa134da9791`。
- 獨立分支僅備份可重建文字，不更新網站、主分支或四方案。
