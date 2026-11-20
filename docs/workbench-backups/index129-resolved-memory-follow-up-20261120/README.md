# 選配工作台第 111 頁：已解決的話題有新情況，怎樣繼續？

- **A｜從已結束清單找原題。** 按標題、日期和狀態找到舊話題，再填新原因。[Zendesk 清單原圖](https://support.zendesk.com/hc/article_attachments/7856502791194) 的 Solved 不是正式關閉；[另建關聯單的官方規則](https://support.zendesk.com/hc/en-us/articles/4408883882522-Creating-a-follow-up-for-a-closed-ticket) 說的是 Closed。
- **B｜從單題詳情看原結論和新跟進。** [Qiscus 官方原圖和確認流程](https://documentation.qiscus.com/helpdesk/closed-ticket-behavior---follow-up-flow#4-follow-up-behavior) 顯示舊單不變、新單連回舊單；原圖為兩個獨立畫面，不是方案的同頁雙區。

兩款原圖只外連，原作者、精確圖址和已知版本見 `spec111.json`。育伴港現有[操作表單](https://github.com/2NTTY/child-ai-caregiver/blob/573d29821035e74dc90be6d968788f48cedd6937/frontend/src/production/TaskKnowledgeMemoryManagement.tsx#L165-L208) 要求填原因並確認。[已合併的交易程式](https://github.com/2NTTY/child-ai-caregiver/blob/573d29821035e74dc90be6d968788f48cedd6937/server/firestore-memory.ts#L349-L369) 每個舊題只允許一次直接另建，保存原狀態與可見範圍。另建不等於已發出追問或通知。兩款是設計比較，不是現網功能驗收。

## 重建與檢查

- 前 110 頁和既有選項不變。共 111 題、225 款，其中 129 款只外連，165 張既有離線圖維持原樣。
- 用已驗證的 #110 HTML（SHA-256 `da83e0be1c043d101a60c4cca701364d6281690e0d3dc5dcceba6ada51ec9af8`）執行 `python append111.py baseline110.html spec111.json output111.html`。
- HTML：34,321,299 bytes，SHA-256 `42b2315b45d7700bedf55a90428fa7edde2de3bcd9e9b9ee4a4e2504a308f4ca`；單檔 ZIP：22,753,498 bytes，SHA-256 `80634060518adc4d30eac14f8deb17c278997deabf1a6398476e874c91105773`。
- 專項離線檢查通過：既有內容保留、來源／版本、主題搜尋、兩案比對及選擇摘要。此分支只備份可重建文本，未更新既有網站、四方案或主分支。
