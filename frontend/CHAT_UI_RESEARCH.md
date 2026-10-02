# Agent 對話顯示研究

核對日期：2026-10-02。這是 frontend 的顯示方法研究，產品協定及業務權限仍由根文件／Server 掌管。已讀官方文件及下列 GitHub 原文；沒有啟動這些產品、檢查其閉源桌面渲染器、複製程式或引入新依賴。

| 參考 | 核對到的做法 | 育有方採用範圍 |
|---|---|---|
| [Codex App Server](https://learn.chatgpt.com/docs/app-server)；[官方 TUI chatwidget](https://github.com/openai/codex/blob/ca466061d64f0b44f416135c7fd06aa7af850bbc/codex-rs/tui/src/chatwidget.rs) | Thread／turn／item 有各自生命週期，增量文字對應 item id；item completed 提供權威最終內容，停止及失敗分開。CLI 有串流及歷史顯示處理 | 同一 message id 持續更新文字；完結沿最終快照替換暫時文字。公開步驟及回覆分開；不用 Codex 協定取代項目 API |
| [Claude Code Desktop 的 Transcript modes](https://code.claude.com/docs/en/desktop)、[互動模式](https://code.claude.com/docs/en/interactive-mode)；[官方 GitHub](https://github.com/anthropics/claude-code) | Normal 將工具過程收成摘要，詳細 transcript 可展開；中止操作有獨立狀態。當前模式列 Normal／Thinking／Verbose，舊 Summary mode 已移除 | 預設聚焦回覆，工具活動收起，點一下展開／收回；顯示安全、可公開的工作摘要。內部思維鏈不進顯示投影 |
| [DeepSeek Harness 官方庫](https://github.com/deepseek-ai/deepseek-harness/tree/639ed015397290b3745d163aafe02ffee4aa3f84)；[use-chat-scroll](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-chat/src/client/chat/use-chat-scroll.ts)、[use-scroll-follow](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-chat/src/client/chat/use-scroll-follow.ts) | 分開跟隨意圖、閱讀位置及歷史導航；新提交可跟隨尾端，閱讀舊內容時維持位置。內容或 viewport 增長依閱讀意圖調整 | 新訊息在底部、較早記錄分批展開；家長往上讀時停跟，明確「回到最新」再恢復。程式捲動及讀者手勢分開 |
| DSH [AssistantNodeView](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-chat/src/client/chat/AssistantNodeView.tsx)、[TurnProcessNodeView](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/client/ui-chat/src/client/chat/TurnProcessNodeView.tsx) | 串流／已結束／中止共用 keyed renderer；工具過程可收起，停止／錯誤替代普通結束標籤 | 共用 ChatMessage，來源及工具展開狀態留在各訊息實例；失敗、未知、待確認和停止保持各自含義 |

Codex 指定版本為 Apache-2.0；DSH 指定版本為 MIT，其 README 明示仍屬快速迭代的 developer preview，這不是採用整套 harness 的成熟度保證。此包只採顯示原則，沿已採用 React／RN／Paper／OverlayScrollbars 實作。Claude Code 只按官方產品說明研究，未把其 GitHub 當成完整桌面 UI 源碼。一般改動方法、Expo 官方 GitHub 指引及動畫證據見 [WORKFLOW](WORKFLOW.md)。

## 與項目接口的差距

已直接讀 GitHub master `d3213e6dde2b72fd34a955b5ceebab1f046f3f6e` 的 [API](https://github.com/2NTTY/child-ai-caregiver/blob/d3213e6dde2b72fd34a955b5ceebab1f046f3f6e/docs/API.md)、[ChatPage 型別](https://github.com/2NTTY/child-ai-caregiver/blob/d3213e6dde2b72fd34a955b5ceebab1f046f3f6e/src/shared/chat.ts)、[ChatPanel](https://github.com/2NTTY/child-ai-caregiver/blob/d3213e6dde2b72fd34a955b5ceebab1f046f3f6e/src/client/ui/ChatPanel.tsx)。

- GET messages 只有 messages／limit，目前限最近 100 則；沒有 before／cursor／hasMore。前端只分批展開已載入訊息，不能宣稱已讀更早的 Server 歷史。
- POST 原訊息 reply 返回已保存回覆／agentRunId，沒有 SSE／WebSocket 增量及恢復契約。ChatMessage 已能接受同 id 更新的 text／phase／公開 activities，但計時示例不是正式串流。
- 後端若加入串流，須先定義穩定 message／run／item 身份、增量次序／去重／斷線重讀、最終快照、失敗及取消語義；前端按既有控制器授權上下文接線，不能自行發明 transport。高頻增量可由 adapter 合併到顯示幀；每字不建立新訊息。
- 部分文字不當作已保存的最終答案；停止不能當作完成，unknown 先查原運行，不自動重送。待確認操作仍走原候選及共享確認。
- 正文引用與 KnowledgeEvidence 沒有逐句映射；最終真編號及來源快照須由正式 adapter 核對。公開進度摘要須經資料層核定，不顯示 provider 私有推理、原工具參數／原工具輸出或 secrets。

這些是實際接口缺口，交 [正式移除及接線清單](PRODUCTION_UI_HANDOFF.md) 和 [組件交接](HANDOFF.md#chat-timeline) 跟進；沒有改後端或推造業務成功。
