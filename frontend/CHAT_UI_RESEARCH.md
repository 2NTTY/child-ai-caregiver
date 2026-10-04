# Agent 對話顯示研究

身份：版本化方法研究及選型依據；現行呈現看 [DESIGN_SYSTEM](DESIGN_SYSTEM.md)，實際接點看 [HANDOFF](HANDOFF.md#codex-chat-presentation)。研究觀察與項目實測分開，變更只更新各自權威。

核對日期：2026-10-02（事件／捲動）及 2026-10-04（Codex 桌面呈現）。這是 frontend 的顯示方法研究，產品協定及業務權限仍由根文件／Server 掌管。已讀官方文件、下列 GitHub 原文及官方桌面圖片；沒有啟動這些產品、檢查其閉源桌面渲染器、複製程式／圖片資產或引入新依賴。

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

<a id="codex-desktop-presentation"></a>
## FE-W36：Codex 桌面呈現

使用者要求 Agent 聊天全面參照 Codex，包括字體、間距及輸入區。本輪先復用上方事件／捲動研究，再核對 [Codex app 官方說明](https://learn.chatgpt.com/docs/app)、[官方 changelog](https://learn.chatgpt.com/docs/changelog)及 [Codex Remote 官方文章](https://developers.openai.com/blog/mastering-codex-remote-for-engineering)。實際在瀏覽器查看官方 [Windows light 對話圖](https://learn.chatgpt.com/images/codex/windows/codex-windows-light.webp)與 [新對話輸入圖](https://learn.chatgpt.com/images/codex/app/codex-app-basic-light.webp)；手機 Remote 只輔助理解附件／輸入操作，不拿其尺寸當桌面規格。

| 實際可觀察的呈現 | 本項目採用 |
|---|---|
| 明亮對話背景、置中的有限正文寬度；普通助手回覆直接排文 | 白色聊天工作區，正文與輸入區同寬，無頭像／卡片外框；沿泛用 ChatMessage，不只改示例頁 |
| 家長問題與助手正文分開；輔助過程及訊息資訊較輕 | 淺灰使用者氣泡，正文／區段／過程／metadata 四層字級；公開活動、失敗、未知、停止、候選語意仍各自保留 |
| 單一圓角 composer，上方文字、下方精簡工具及右側箭嘴 | 一個面板容納多行文字、原照片及圖示列；本地預覽提示放外側。直接拍照、原檔處理、文字草稿及焦點返回沿現有流程 |
| 過程細節不需要一直展開 | 合成「Agent 活動與候選」預設收起；展開區保持掛載，收合不能清掉待查核的原操作。正式版須沿真活動／待確認投影，不把合成工具列搬過去 |
| 長對話讓正文及輸入區各自可達 | 沿既有時間線的讀者意圖、歷史錨點及底部懸浮返回；多行輸入可增高至上限後自行捲動，不壓在訊息上 |

官方圖片沒有提供 renderer CSS／實際字級數值，本機唯讀定位亦只找到 CLI 入口，沒有可讀的桌面 renderer 原碼。因此 **15／24 正文、13／20 工具、12／18 metadata、16／24 輸入、800 上限及 20 圓角是育有方的實作選值，不是聲稱量得或複製 Codex CSS**；前文 TUI Rust 證據也不能支持桌面字體數值。這些值集中於 chat-presentation，保留品牌導航及育有方的引用／操作規則，不搬入 Codex 的模型選擇、權限／工具協定或工作目錄功能。

輸入框沿現有 Paper 原生欄位；Web 需要沒有表單外框的 textarea、多行增高及中文 IME-safe Enter，故加局部 ChatComposerInput.web adapter，沒有改 AppTextField 或換框架。原文直接經 onChangeText 回調；提交仍沿本地 onPreview。尺寸按 [MDN scrollHeight](https://developer.mozilla.org/en-US/docs/Web/API/Element/scrollHeight)同步量度，在 [React useLayoutEffect](https://react.dev/reference/react/useLayoutEffect) 的繪製前階段還原高度，刪字及寬度變更均可重新量度，避免跨幀重設閃動；依 [MDN isComposing](https://developer.mozilla.org/en-US/docs/Web/API/KeyboardEvent/isComposing)及 composition 狀態隔離選字 Enter，另保留 keyCode 229 的相容判斷。Web Enter 預覽、Shift＋Enter 換行；原生多行 Enter 仍換行，明確按箭嘴才預覽。原生 adapter／鍵盤行為只交接，實機仍待驗。

這次沒有新依賴或 vendor code／圖片複製；外觀選值與實際合成互動證據分開，正式 transport／真引用／100 則以外歷史等原缺口照上節處理。[設計配方](DESIGN_SYSTEM.md#codex-chat-presentation)／[交接及實測](HANDOFF.md#codex-chat-presentation)。
