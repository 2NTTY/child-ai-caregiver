# 選配工作台第 132 頁：助手還在回覆，下一個問題要留作草稿，還是等它答完再送？

- **A｜留在同一對話及輸入框。** [Microsoft 官方整頁原圖](https://code.visualstudio.com/assets/updates/1_105/agent-sessions-codex.png)在原對話下保留追問輸入框；該圖不是生成中或待傳截圖，排隊行為另有官方版本說明。
- **B｜分開「正在回答」與「接下來」。** [Spotify TV 官方全畫面原圖](https://storage.googleapis.com/pr-newsroom-wp/1/2023/11/Playback-queue.png)同時看當前及下一個項目。借分區，不借多項佇列；育伴港雙區整頁是提案。

在同一孩子的主聊天，只輸入是草稿；明確排入才等原回覆完成後傳一則文字。[編輯、撤回保留草稿](https://github.com/2NTTY/child-ai-caregiver/blob/6e91757e5f66fded6dc3f8bfe58602f2d26daf7a/src/client/chat-controller.ts#L322-L334)；[停止當前回覆會清待傳](https://github.com/2NTTY/child-ai-caregiver/blob/6e91757e5f66fded6dc3f8bfe58602f2d26daf7a/src/client/chat-controller.ts#L580-L609)。離線、失敗或不明不標為已送；不插隊、不排附件、不用真實家庭資料或模型及不發送。新原圖只外連。

## 重建與檢查

- 前 131 頁不變。132 題、267 款，其中 171 款只外連；保留 165 張既有圖。
- #131 HTML SHA-256 `9068de7995b7d94983201b839f6dfdcf7fcf062a4eb93a4b1aa18dd978470e00`；`python append132.py baseline131.html spec132.json output132.html`。
- HTML 34,436,820 bytes，SHA-256 `cf5e91c86d333850d817b64f71770dfbd86d40df67cb56765617747bb2b1b36a`；ZIP 22,790,660 bytes，SHA-256 `c413f2ca3123b5b0f56449784fe43c8d243ec3f33365b23c9d2c07737c762d9e`。
- 離線檢查未執行真實聊天流程。未更新網站、主分支或四方案。
