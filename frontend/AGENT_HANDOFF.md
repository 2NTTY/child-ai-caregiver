# Agent 對話及私人結果交接

本文件只保留現行前端接點、能力邊界及必要的歷史 backend 限制。產品流程與普通／重要記錄政策見 [主要交接](HANDOFF.md#conversation-change-review)，造型只依 [DESIGN_SYSTEM](DESIGN_SYSTEM.md)，交付／驗收狀態只見 [PLAN](PLAN.md#active)。

<a id="交付與預覽"></a>
## 聊天與共用輸入接點

家長交代後由 Agent 整理，家長查看及必要時確認；輸入、原檔保存、模型使用同意、家庭共享及真正送出是不同操作。現有預覽不會正式送出附件或呼叫模型。

| 接點 | 目前介面與正式整合邊界 |
|---|---|
| [AgentComposer](src/components/agent/AgentComposer.tsx) | 接 `enabled`、`compact`、`draft`、`attachments`、`onChangeDraft(value)`、`onPreview()`、`onSources()`、`onAddAttachment(attachment, replaceId?) => boolean`、`onRemoveAttachment(id)`；選配 `captureOriginal`、`focusRequest`。`onPreview` 是本地預覽，不是正式送出 API；目前 chatScreen 只把文字及附件檔名摘要加到本地時間線後清草稿 |
| [AgentInputToolbar](src/components/agent/AgentInputToolbar.tsx) | 內部工具列接 `onFiles()`、`onVoice()`、`onPickPhoto(original)`、`onPhotoError(message)` 及選配 `captureOriginal`。不要把工具列回調誤當 composer 公開介面；`onUseText` 屬 AssistantInputDialog |
| [AssistantDraft owner](src/assistant-draft.ts) | `createAssistantDraftOwner` 管同 scope 的文字及未送出附件；`add` 回傳是否接受並處理替換／釋放。`AssistantAttachment` 是本地暫存資料，不是 Server 上傳契約 |
| [AssistantInputDialog](src/components/agent/AssistantInputDialog.tsx)／[附件預覽](src/components/agent/AssistantAttachmentPreview.tsx) | 文件／音訊／照片共用預覽、移除及選填文字。文字或有效附件其一存在才可本地預覽；真正附件-only 發送仍須正式契約支持。Dialog 可注入 `selectAttachment`，但 Composer 尚未向外暴露／注入該原生 port |
| [ChatTimeline](src/components/chat/ChatTimeline.tsx)／[ChatMessage](src/components/chat/ChatMessage.tsx)／[AnswerSources](src/components/chat/AnswerSources.tsx) | 使用穩定訊息 id、公開活動及每則訊息獨立來源狀態；保留閱讀位置、IME／多行輸入及草稿。真 stream、取消、更早歷史游標及逐句引用仍要核對正式能力，不能把合成 timer 或猜配上標當接口 |

`PreviewContext` 建立共享草稿 owner；MobileQuickInputDock、HomeQuickActions 及 AgentComposer 只交輸入意圖，不各自保存／上傳／送出。Today → Assistant 保留附件；離開 Assistant 經既有離頁確認後清附件，文字按同 scope 暫留。換 scope 不顯示上一範圍內容；正式整合須以 session／本人／Server／孩子及授權界線取代合成稱呼／角色，登出或撤權按正式生命週期清理。

### 本地媒體能力與未接通項目

- Web 照片沿 [PhotoFilePicker](src/components/photos/PhotoFilePicker.web.tsx)／[WebCameraCapture](src/components/photos/WebCameraCapture.web.tsx)：明確操作才開相機；系統拍照／選圖為後備。完整 frame 編碼後沿原 JPEG／PNG、4 MiB 校驗、hash 及 blob 管理；取消／失敗保留原草稿，換圖／移除釋放舊資源。原生 `captureOriginal` 未注入時不可假拍攝
- Web 語音沿 [VoiceCapture](src/components/agent/VoiceCapture.web.tsx) 的 MediaRecorder：明確開始才要求咪高峰，停止後試聽、再加入草稿；可後備選取錄音檔。20 MiB／5 分鐘是前端資源限制，不是正式音訊契約。沒有語音轉文字、模型、正式上傳或背景錄音；原生錄音 adapter 未提供。存在實作不等於真裝置已驗
- Web 文件 picker 可選 PDF／TXT／DOC／DOCX／CSV，音訊可選 audio MIME；1 byte–20 MiB、檔名最多 200 字元，僅為本地附件校驗。可選取不代表已完成 PDF／Word 解析、私人來源入庫或模型傳送，不新增未經正式契約支持的格式承諾
- 拍完、錄完、選檔或手勢放手均不自動送出，也不補假問題文字。正式發送、原檔／模型／共享權限、unknown 與原操作查核只在共同 owner 接入一次
- 取消、隱藏、卸載及 scope 變化須釋放採集介面的 media tracks／尚未交接的暫存 object URLs；已加入草稿的附件改由共同 owner 按替換、移除、離頁及 scope 生命週期釋放。取消一次新選取不清除既有附件。遲到的權限、編碼及讀檔回呼不得填回新 scope。不把私人附件放入 URL、localStorage 或工程日誌；檔名時間不是照顧事件時間

<a id="mobile-quick-input-design"></a>
## 手機快捷輸入與更多入口

快捷拍照沿 [現行水滴配方](DESIGN_SYSTEM.md#function-specific-layouts)：56×56 命中範圍、72×72 非互動裝飾黏附內容區左緣及導航上方底緣；避開安全區、導航及透明穿透區，不恢復已被替代的完整圓形造型。

底部「記錄」輕點進記錄、向上拖可開更多；保留可點擊／鍵盤替代入口。快捷拍照輕點沿相機入口；長按／拖動選文件、語音或快速文字，450ms 原地長按可展開後再點選。回到起點、離開有效區或 pointer cancel 取消；拖動後不額外觸發拍照 click。減少動畫仍保留完整操作。

<a id="home-assistant-entry"></a>
## 首頁助手入口與重要事項

首頁 `HomeOverview.agentImportant`、側欄 `attention` 與 `ongoing` 分屬原投影，不互相補位。Home ongoing 的 MemoryTopic 不冒充 Growth concern；Tasks 改期／完成與首頁及側欄的正式同步仍須接同一 Task owner。Contact／Summary 的指定 task id 導向目前不能只憑進入任務路由宣稱精確定位。

`HomeAgentImportantSection` 保留原來源次序、穩定 id、runId／候選版本與期限、建立及讀取時間、whyNow；前端不靠日期或健康文字判重要性。缺省／錯孩子／未接線為 unavailable，loading、error、ready 空快照分開；unknown 不作成功，run completed 不作照護完成。缺少已讀、略過或精確 run callback 時不提供假操作。

歷史靜態核對 `37625d0` 的背景清單只提供本人同孩子最近最多 20 次 run，沒有首頁重要 feed／優先級／已讀契約；接線時須重核。正式 owner 提供已授權的明確投影並隔離過期回應，不拿普通 Task／Growth 或最新 run 代替推送。`src/preview/home-overview-fixture.ts` 只屬合成樣本。

<a id="memory-context-integration"></a>
<a id="記憶接線的後續安排前端不重建後端記憶"></a>
## 記憶與上下文接線限制

沿正式 ADK／PostgreSQL 的聊天、事實／話題及私人摘要投影；公開知識 RAG 不與私人記憶混同，不另建前端長短期資料庫。記憶與參考頁只讀，見 [記憶投影](HANDOFF.md#memory-reference-storage)。

2026-10-04 在 `37625d0` 靜態發現：product-agent 只交最近最多 6 則，而 privateSummaryInput 在未摘要訊息至少 12 則、批次不超 16,000 字元才交原文，read_context 未另回傳 recentMessages。因此 11 則且沒有有效摘要／相關事實時，較早訊息可能未進當次上下文；未 runtime 重現，也不是資料被刪除。這是待重核的歷史接縫，不是最新 backend 的已證實故障。

正式接線須核對訊息 ID／coverage cursor 的摘要覆蓋、未涵蓋原文及最近尾段；不得把 earlierMessagesNotFullySummarized=false 當完整覆蓋證明。摘要更正／刪除涵蓋來源、版本、索引及快取，重試去重；不因這個缺口自行更換框架或把全部聊天向量化。前端不得保證「已完整記住」；來源用途設定不等於 memory fact 確認或背景整理授權。

## 正式接線入口

以下是較早 `90dacd4` 的靜態契約核對，不是本次重新驗證的 backend 現況。接線時重核正式 repository 的 `docs/P2_UI_HANDOFF.md`、`docs/API.md` 及所列 controller；前端 projection 不是新 HTTP schema。

| 顯示／回調 | 主聊天復用位置及映射 |
|---|---|
| 問題草稿、已保存訊息及要求回覆 | `src/client/ChatPanel.tsx`、`chat-controller.ts`、`chat-api.ts`；訊息的 `agentRunId` 只連到本人／同一孩子可見的已保存回覆。不得給每次本地輸入配一個假 run |
| `AgentRunActions.refresh` | `product-agent-api.getRun(childId, runId, signal, userId)`；既有 GET `/children/:childId/agent/runs/:runId`。控制器核對運行、孩子及引用／候選歸屬，再投影畫面 |
| 運行、停止原因及統計 | `src/shared/product-agent.ts`、`src/client/AgentRunPanel.tsx`；`countsKnown=false` 投影為 `counts=null`，不顯示零用量。停止原因沿既有 allowlist，不展示任意內部錯誤文字 |
| `proposals[].details` | 逐類投影正式 `value` 的完整內容；`task_change` 保留 action／原任務 expectedVersion／負責對象／新時間與時區／覆核 outcome／note，不能只傳一句標題 |
| `decide`／`retryOriginal` | `product-agent-api.decideProposal` 的既有 POST `.../proposals/:proposalId/decide`；原 proposalId／expectedVersion／decision／confirmShared 完整保留。正式 API 已有 pending／原決定核對，不包成另一套通用寫入流程 |
| 私人背景結果 | `src/client/AgentInbox.tsx` 既有 GET `/children/:childId/agent/runs`；手動讀取最多 20 個 runId／createdAt，再以相同組件開啟。不自造未讀、投遞、輪詢或背景完成通知 |
| 引用與開啟來源 | `ProductAgentResult.citations` 及 `product-agent-api.ts` 的 KnowledgeEvidence 驗證，投影到回覆底部 AnswerSources 及頁內來源分頁。原文編號對應須由正式 adapter 核對，沒有逐句映射時不猜配。sourceDate 保留 sourceDateText 或原日期，不把文字硬解析成 instant；versionHash 是版本校驗，不冒稱 contentHash。`onOpenSource` 只傳原 id，正式 adapter 核對 HTTPS、主機、無 credentials／控制字元後才開啟 |

<a id="必須保留的語義"></a>
## 既有 proposal 契約與安全語義

- 運行 completed 是「已結束」，不等於照護任務完成；工具成功保存候選不等於候選已執行。接受後保存的任務或記憶由原控制器重新讀取，不複製成另一個 authoritative store。
- 以下明確 accept 是歷史 proposal 契約及目前預覽沿用的安全邊界，不取代[普通自動保存／重要確認的目標需求](HANDOFF.md#conversation-change-review)。未補齊正式政策前，前端不得自行略過 accept。
- 候選是私人待核對內容；接受家庭任務或家庭記憶前明確勾選內容、對象及共享範圍。私人記憶不要求家庭勾選，但仍須明確接受。期限已過或無效、離線、讀取失敗、忙碌及權限失效皆不能提交。terminal 候選不再提供確認按鈕。
- 候選決定 unknown **沒有通用 opId 查核契約**。保留原運行／候選／版本／決定／共享值，阻擋另一個新決定，再讀取原運行。沒有候選不能推斷「未保存」；同版本 pending 也不能聲稱寫入沒發生，只能明確沿用原決定重試，並重新核對共享內容。
- 出現 terminal 候選才清除該 pending；版本改變或既有 API 要求 fresh confirmation 時停用舊基準，再明確核對新內容。409 不能只換 expectedVersion 或直接重送。讀取中清除舊共享勾選；失敗保留原操作但鎖住確認及重試。
- 正式 Server／user／child／run 範圍改變時先換 private subtree 的 key，清除舊結果、引用、勾選及原決定，再開始新讀取；abort／generation 防止舊 response 回填。401／403／404／session_changed 清除私人內容。預覽身份工具只切執行區樣本，不是真正全頁換帳戶；正式聊天、草稿、inbox 和其他控制器仍須按既有身份／刪除 gate 一起清理。
- 引用是回答當時的快照，不能保證今天仍適用；無引用不能冒稱官方支持。組內非商業來源不成為公開知識卡片。展示的引用文字和校驗字串均清楚標為合成，沒有真健康資訊或外部網頁。

<a id="驗證與限制"></a>
## 歷史與驗證定位

現行前端驗證只沿 [PLAN](PLAN.md#evidence)。本文件不再混放 FE-W09／18／19／25／28／29 的「最新」「下一包」及測試流水。需要追溯時讀[清理前固定版本](https://github.com/2NTTY/child-ai-caregiver/blob/26d36e8bf6c5f627d721ba9f26587349970ef183/frontend/AGENT_HANDOFF.md)，舊證據未被修改；只支持各自版本及範圍。

正式 ChatController／session／Server／模型／知識、多模態、跨頁持久同步、原生 adapter／APK／真機均不能由合成畫面或舊 export 證明已完成。需要時仍沿統一權威緊急求助入口，取消常駐卡不代表取消求助能力，見[聊天呈現](HANDOFF.md#chat-presentation)。
