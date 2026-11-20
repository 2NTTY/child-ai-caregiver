# 選配工作台第 115 頁：記低了「傍晚做拼貼」，七日照顧摘要為甚麼找不到？

- **A｜從七日摘要去搜尋已存原件。** 先說清楚為何有些記錄不能歸入日期範圍，再去同一孩子的已存記錄搜尋。[Google 官方報告原圖](https://developers.google.com/static/search/blog/images/video-indexing-report.png)示範把日期摘要和未納入原因分開；[個別原項查詢](https://support.google.com/webmasters/answer/9495631?hl=en)另有入口。未索引不是育伴港的事件日期不明。
- **B｜另列已保存、但事件日期未定位的記錄。** [Todoist 官方原圖](https://images.ctfassets.net/dm4oa8qtogq0/7da6f3b8455a51b7214c17a46a32b5fdb1ee4e6a/b7948920ea62c8ce268117bbeab91b2b/No_due_date_filter)示範沒有排定日期仍能找到原項；建立時間另看。這不表示 Todoist 有照顧事件或確認時間。

育伴港[正式輸入驗證](https://github.com/2NTTY/child-ai-caregiver/blob/400b159d221e8d30875494806dd24eb81eada73a/server/care-validation.ts#L14-L20)不替「傍晚」猜事件日期。[摘要](https://github.com/2NTTY/child-ai-caregiver/blob/400b159d221e8d30875494806dd24eb81eada73a/server/care-summary-policy.ts#L71-L95)把缺事件時間的記錄另計；缺項數是所掃描範圍，並非七日內漏記，亦不提供原件清單。日期不足不等於沒有保存。兩案只供設計比較，不代填日期、不改記錄，並非線上功能驗收。原圖只外連，版本及精確來源見 `spec115.json`。

## 重建與檢查

- 保留前 114 頁與既有選項。共 115 題、233 款，其中 137 款只外連，165 張既有離線圖不變。
- 用已驗證的 #114 HTML（SHA-256 `decdd379b84934f9b56586a8519e470e64d2a01e281512de7e91b740106c072f`）執行 `python append115.py baseline114.html spec115.json output115.html`。
- HTML 34,340,141 bytes，SHA-256 `78d99e644def4b1af9f5c67597fc0eee8339a10a0abacef566b80d54d331312a`；單檔 ZIP 22,760,243 bytes，SHA-256 `0421eb05406dc5a7dc76f4ce32e8362dea8e6cafc86587acf7a06690edb0b1c6`。
- 專項檢查涵蓋既有記錄、兩案來源、搜尋、比較及選擇摘要。獨立分支只備份重建文本，不更新網站、主分支或四方案。
