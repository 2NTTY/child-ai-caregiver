# 選配工作台第 83 題：從待辦問助手

家長看着一筆已保存的待辦，在同一孩子、同一頁問小助手。畫面提示「連同目前待辦發問」，由家長按送出；不帶未保存草稿、另一位孩子或過時的項目。若從共享空間切換到私人對話，共享項目不會跟過去。沒有承諾另有勾選控件。

- **待辦提問-01 ClickUp**：[待辦內發問作者頁](https://help.clickup.com/hc/en-us/articles/34958900405143-Use-Brain-AI-on-tasks)附[原圖](https://help.clickup.com/hc/article_attachments/37972812145687)；另一張[原圖](https://help.clickup.com/hc/article_attachments/40595197333527)仍見原待辦，而輸入框只問留言串，不是整筆待辦。已目視。產品 build 及截圖日期未標。不可推定私人資料、同意或實際傳送欄位。
- **待辦提問-02 VS Code**：[1.119 作者發行說明，2026-05-06](https://code.visualstudio.com/updates/v1_119#_attach-browser-tabs-as-context)、[提問旁的待加入頁面原圖](https://code.visualstudio.com/assets/updates/1_119/browser-implicit-context.webp)、[分享中原圖](https://code.visualstudio.com/assets/updates/1_119/browser-share-button.webp)。已目視。可借明示狀態，不借工具權限及持續分享。兩款均只提供作者原連結，沒有重發、裁切或嵌圖。

[私人對話選擇及情境核對](https://github.com/2NTTY/child-ai-caregiver/blob/94ca0c914598eaf8937868330adf9cc4e82fe5b6/frontend/src/components/companion/SiteCompanion.tsx#L86-L133)。[已保存待辦登記](https://github.com/2NTTY/child-ai-caregiver/blob/94ca0c914598eaf8937868330adf9cc4e82fe5b6/frontend/src/components/tasks/TaskDetail.tsx#L11-L16)。與 #37 單項待辦、#52 聊天回到來源、#56 在聊天中選受眾不同。原 PR 的合成測試記錄不是這次實測。

83 題、169 款、146 張原圖不變。靜態及離線腳本核對跳轉、焦點、並排、選擇、複製來源和移除；未用真資料、模型或正式網站。SHA-256：`b7b83af4a2e80dad76b08c1d856ac042d815f0ddcf654fa75c8226b00b42cf64`。獨立分支純文字備份，無 PR、無合併、無發布。
