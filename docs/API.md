# 接口与鉴权契约

**現行 Firestore 範圍：**家庭多人管理延至 [P4-FAMILY](../PLAN.md#p4-family)，未實作的 API 不回假家庭或成功空集合。本人設定、通知及孩子隔離保持。以下歷史家庭／SQL 契約仍供後續接線，不是已交付聲明。

**披露契約：**原操作已成功但所指正文已永久刪除／遮蔽時，仍回原 confirmed 身份、版本及狀態，result 為 null；不得以原 opId 再次執行。account export 的歷史區段套用目前刪除／歷史下限；文件正文及修訂來源失效時返回無正文的 invalidated 投影，不直接披露 recovery envelope。空的單頁不代表所有歷史不存在，沿原 cursor／complete 使用。


**實作與目標分界：**下文 PostgreSQL／Better Auth／pg-boss 專項保留原機制及證據；依 [ADR-024](DECISIONS.md#adr-024)，正式 SQL 接點改用 Firestore，原 VM／Node／Compose／Caddy 及網站繼續沿用。Firebase Auth、Storage、Tasks 的既有接線按實際範圍復用，不表示全部功能已遷移。現行契約見 [Firestore 接點](#firestore-target)，已合併／未合併／待驗只見 [PLAN](../PLAN.md#active)。

本文件管穩定契約／設計，不維護包進度或即時部署。實作與未驗項見 [PLAN](../PLAN.md#roadmap-packages)，運行觀察見 [STATUS](../STATUS.md#deployment)，測試結論只按所連 EV 的版本／範圍解讀。

本文件維護已確定的共享介面職責、鑑權邊界及呼叫結果語義。介面名及錨點保留，現行 Server 契約依 [ADR-008](DECISIONS.md#adr-008) 原位替代舊模式，不表示程式碼或 HTTP 路由已存在。完整字段定義見 [DATA_MODEL](DATA_MODEL.md)，執行次序見 [ARCHITECTURE](ARCHITECTURE.md)，不複製 schema 或另立更新算法。

<a id="section-3-3"></a>
## 3.3 共享业务接口

<a id="api-3-3-01"></a>
业务层通过接口访问数据，避免各端自行定义规则：

- <a id="api-3-3-02"></a>`DataStore`：由 Server 權威讀取、保存、修訂及確認業務對象；
- <a id="api-3-3-03"></a>`AttachmentStore`：附件保存、读取和校验；
- <a id="api-3-3-04"></a>`SyncEngine`：在線更新、版本／游標、確認及衝突狀態；不含持久離線 outbox；
- <a id="api-3-3-05"></a>`ModelGateway`：Gemini 解析、回答和摘要；
- <a id="api-3-3-06"></a>`KnowledgeRetriever`：查询官方知识及引用；
- <a id="api-3-3-07"></a>`NotificationGateway`：渠道無關的投遞邊界，P2 支援 Web Push／Telegram，P3 加 FCM；
- <a id="api-3-3-08"></a>`TaskExecutor`：在 Server 重查授權、終態及執行租約，執行獲授權任務；
- <a id="api-3-3-14"></a>`AgentRuntime`：P2 的內部互動／worker 共用入口，組裝已授權上下文及配方，執行有界 ADK 工具循環；

<a id="api-3-3-09"></a>
这些接口用于隔离差异，不建设复杂插件平台。

<a id="api-3-3-10"></a>
介面按實際流程落碼：P1 `DataStore`／`ModelGateway`；P2 `AgentRuntime`／`AttachmentStore`／`KnowledgeRetriever`／`TaskExecutor`／`NotificationGateway` 及在線一致性所需 `SyncEngine`；P3 只增加 Android 平台 adapter，P4 補相容 Server 切換。共享核心隔離平台、資料庫與渠道；選人、任務及升級／fallback 規則不進渠道 adapter。

<a id="api-3-3-11"></a>
P1 `ModelGateway` 由已登入且通過資源權限檢查的 Server 請求呼叫真 Gemini／簡單 prompt。瀏覽器不接收 provider credential；Server 驗證輸入及模型結果，套用配額、總開關及有限重試，日誌不保存憑據或家庭正文。模型只回傳回答或草稿，不能繞過權威寫入及授權規則。

<a id="api-3-3-12"></a>
`KnowledgeRetriever` 接收所需內容類別及適用範圍；一般育兒問答預設穩定指引，近期查詢另用時間窗口。回傳片段連同來源／版本／日期與查核狀態供引用，快取也遵守相同過濾與停用規則。這是結果語義，不預先固定 HTTP 路由或建立第二個知識平台；字段依 [DATA_MODEL](DATA_MODEL.md#section-5-6)。

<a id="api-3-3-13"></a>
P2 檢索適用範圍包含地區、年齡依據及精度、主題與必要條件，未知保留未知；回傳結果區分有適用證據、無適用證據、來源衝突及檢索不可用，不把空結果當作容許模型補造。育兒知識回答／成長關注／安全求助提示至少一個已核對的適用官方來源，每項重要建議連具體片段／版本；Server 拒絕不存在或已失效引用。語義支持與例外依 [SPEC](../SPEC.md#req-5-6-11)，不宣稱結構校驗消除幻覺。安全求助可用仍適用的預先核對官方內容；不新增醫療分流 API。

<a id="agent-runtime-contract"></a>
### P2 AgentRuntime／工具契約

四角色擴充目標見[角色與審核接口](#p2-agent-roles)，下列為既有單 Agent 接點及證據。S11-W03 的 [AgentRunInput／AgentRunResult／AgentTool](../server/agent-runtime.ts) 是 Server 內部型別，不是接受客戶端身份或工具定義的 HTTP API。已接通 ADK 有界循環、Prompt Pack 組裝、原生工具 parts、配額與安全停止。S11-W02 已接業務工具及跨 run 確認／記憶；HTTP 契約見下文，驗收範圍見所屬工作包。工具成功但生成失敗可返回已核實進度；取消／期限耗盡而不能重新核權時，不披露舊結果。

- <a id="api-ar-01"></a>內部入口接受受信互動請求或 worker 事件及必要輸入／待確認參照；Server 建立 runId，注入身份、孩子／資料空間、觸發來源、時間／時區、授權及資料版本、配方／工具集合。客戶端正文不能聲稱自己是 worker 或提供可直接採信的權限。
- <a id="api-ar-02"></a>ModelGateway 的 ADK 路徑傳遞完整模型／工具 parts、呼叫關聯及必要 opaque metadata，不壓成 P1 文字介面。每次生成／查詢 embedding 均受[運行配置](ARCHITECTURE.md#p2-agent-budgets)、全局開關、配額及共享取消／deadline 約束；語料維護另有有限額，不能繞過全局控制。
- <a id="api-ar-03"></a>FunctionTool 只映射本次允許的業務操作；呼叫必須核對 schema、資源及來源權限、授權版本、終態、確認參照和穩定 opId／occurrenceId。結果區分成功、部分成功、拒絕、衝突、失敗及 unknown，帶實際操作參照；框架自動呼叫工具不豁免校驗。
  Concern／family-document 的模型工具宣告使用 Vertex 支援的 anyOf；confirm 在 wire schema 表達 boolean，但本機 refine 及執行前原業務 schema 仍要求 true。模型用宣告不替代 Server 嚴格驗證，不放寬身份、action 專屬欄位、版本、家庭共享確認或存取權限。SDK 序列化契約以固定版本離線檢查，正式 400 的具體拒絕欄位仍須與真服務驗收區分；不得以重送未知結果驗證格式。
- <a id="api-ar-04"></a>原生工具呼叫是副作用入口；收尾的文字／actionRequests 不能再次執行同一操作。必要結構化結果使用宣告 schema；不支援同次工具／schema 時的獨立收尾仍計同一預算。收尾失敗從台帳呈現已確認結果，不重做工具。
- <a id="api-ar-05"></a>待確認參照綁種類、原事項／訊息、對象、內容版本、可見範圍及有效性，跨 run 持久保存。確認回覆重新核對指向、發言者與當前權限；多個可能指向先補問。事實確認、任務確認、完成及外發授權不可互換。
- <a id="api-ar-06"></a>輸出供 UI 使用的 runId、狀態／停止原因、可理解結果、可引用來源及最小工具進度，須在呈現前重新核對權限及版本。進度只取實際工具／台帳證據，不回傳原始 provider 協定、內部推理、憑據或無權資料。API 路由與完整序列化隨工作包落碼，不把 Prompt Pack 語義直接當現有 wire format。

<a id="product-agent-http"></a>
### S11-W02 產品 Agent 接線

Server／worker 須明確設定 `P2_AGENT_ENABLED=true` 並已套用 migration 016；未啟用維持 P1 聊天。共用組裝入口為 [product-agent-services](../server/product-agent-services.ts)，共享結果見 [product-agent](../src/shared/product-agent.ts)。GET／POST 均核對 session 與 `x-expected-user-id`，POST 另沿用 JSON／Origin 規則；模型不能提供身份、配方或權限。

| 路由 | 真實行為 |
|---|---|
| POST `/api/children/:childId/messages/:messageId/reply` | 空物件；沿用原訊息，進入 product-interactive。相同訊息重取同一持久運行，不重新呼叫模型；返回聊天訊息及 `agentRunId` |
| GET `/api/children/:childId/messages/:messageId/reply` | 唯讀 `{reply:null|{messageId,runId,status,stopReason}}`；null 只表示已核權的本人原訊息尚無 claim；錯身份／孩子／來源／授權改變回錯誤。按原 claim 確定 ID 點讀，沒有新 run、模型或寫入；期限過去可投影 unknown，不聲稱完成 |
| GET `/api/children/:childId/agent/runs/:runId` | `{result}`：本人運行、工具狀態、當時引用、候選及停止原因；中斷且未保存統計以 `countsKnown=false` 表示未知 |
| POST `/api/children/:childId/agent/runs/:runId/proposals/:proposalId/decide` | `{expectedVersion,decision:accept\|dismiss,confirmShared}` → `{proposal}`；精確重試返回原結果，過期候選不可接受但可明確略過；接受仍核對權限及版本 |
| GET `/api/children/:childId/agent/pending?cursor=…` | `{proposals,nextCursor}`：本人及該孩子的 pending／expired，每頁最多 20 項，獨立於近期聊天及 20 次背景清單；過期項只能重新核對或略過 |
| GET `/api/children/:childId/agent/runs` | `{runs:[{runId,createdAt}]}`：本人最近最多 20 次背景運行，供手動重讀；不是啟動 Agent 的入口 |

`propose_task／propose_task_change／propose_fact` 只保存私人候選。明確接受後，任務／已確認事實與候選結果在同一交易寫入；家庭共享需額外明確確認。受限聯絡工具按 [W07 授權](#proactive-contact-http) 執行，入列、聯絡結果與照護完成分開。候選 24 小時過期；任務改期／完成／取消沿用原版本及終態規則，事實保留原私人訊息來源，不靠最終文字重做副作用。

`read_context` 按入口區分本人／家庭；私人摘要只在取得完整批次時透過 `stage_private_summary` 暫存，運行結束再核對來源版本及精確覆蓋，衝突保留原摘要。摘要及候選不成為確認事實。`search_knowledge` 使用既有 public retriever 與同一運行預算；`present_answer` 核對引用 ID、官方類別及當前有效版本，回傳結構不等於已驗證語義支持。

ADK 2.1.0 執行邊界：版本化指令與 Server 控制 metadata 經 InstructionProvider 提供，input.context 獨立放入有標籤的 user Content 資料 part；原使用者訊息仍第一個 part，原生附件、歷史及工具關聯保留。正文中的 `{name}`／`{name?}` 不作 state 展開或刪除，資料內容不能授權，也不能聲稱封裝本身保證抵禦所有 prompt injection。

每輪 Server runtime metadata 的 `budget` 包含 `usedBeforeThisCall`、`remaining.modelCallsIncludingThisCall`、剩餘工具／查詢向量／時間、`reserveForFinish`、`nonTerminalToolCallsAvailable` 及 `phase`；是運行即時快照，不是新操作授權或聊天歷史。生成餘額包含本輪尚待預留的呼叫。模型自行選擇必要步驟，`finish` 階段只保留當前已有 terminal 的 schema／toolsDict／ANY allowedFunctionNames；沒有 terminal 的抽取流程沿原輸出契約。原生成／工具／配額／取消計數不重設，Server 仍拒絕未提供工具及混批；未完成或證據不足不能假造成功。

`present_answer` 為 terminal 工具。一般階段成功接受後，ADK skipSummarization 結束循環，既有 finalize 仍重驗引用及目前授權；unknown 停止並保留原台帳。gateway 在執行任何 handler 前拒絕 terminal 與其他工具的同一 response，不能先展示再截掉未完成副作用。

產品互動／家庭背景入口可由 Server 內部明確 opt-in `presentationRepair: "present_answer"`；不是客戶端欄位，照片／分享提取不自動啟用。僅在主流程以可確認的自然文字 final 結束、尚無已接受展示且沒有錯誤／unknown／取消／撤權／額度阻擋時，才可在同一 invocation 用一次剩餘模型呼叫補展示。主流程 MAX_TOKENS、SAFETY、partial、空回應或不能明確辨識者不因此重試。既有model/tool/input/deadline共用，不重設、不增總上限。

修正階段 request 的工具宣告／toolsDict 只留 present_answer，function-calling ANY 及 allowedFunctionNames 限此修正階段及預算收尾階段；Server 亦拒其他工具及混批，不能只依賴模型遵從。固定Server控制訊息只加到該請求，不寫聊天／session事件、不提供新操作授權；原原生parts、signatures與既有工具結果完整保留，不偽造模型工具呼叫。收到修正的首個functionResponse後，僅用ADK控制位結束此階段並完整收束generator清理，即使展示被拒也不第三次生成；控制位不代表業務接受。finalize仍判斷是否有有效展示，修正失敗為invalid_response；真正預算／權限停止保持原分類，不以總額度錯誤冒充階段耗盡。

修正只能回報已知結果或必要補問，不能重新執行被拒／未知／已成功操作，也不能把pending候選當正式任務。自然 final 本身仍不可直接展示成成功。這不保證所有F4／T9情境成功，也未建立背景安靜no_action契約；定向scripted驗證不代表真模型或正式使用已通過。

工具參數修正提示：僅 `propose_task` 在執行前 strict schema 驗證失敗時，可在既有 `invalid_parameters`／`nextAction` 旁返回 `hints`。每項只有公開 schema 的固定 `path`、固定 `reason` 及 `expected` 字串；最多3項，整個提示陣列 JSON 最多512字元，超出時整項省略。只識別根、values及六個已宣告任務欄位；未知鍵不回鍵名，不轉傳原 issue、message、input、動態路徑或使用者值。這是模型 function response 的有界修參資訊，不是新增客戶端 HTTP 欄位或家庭資料副本。

修正提示不放寬 schema，不替代身份、授權、版本或業務驗證；非法參數仍零執行。`not_authorized`、handler拒絕及unknown沿原規則，其他工具維持原泛用回覆。僅能使用本次剩餘預算修正，不能因收到提示而增加模型次數、換操作ID或重送未知副作用。這項改善不等於已確定歷史 T7／T8／T9 真實請求中哪個欄位失敗。

另僅 `propose_task` 執行時回覆 `rejected／invalid_assignee`，補上固定 `nextAction=read_context`、`field=values.assigneeUserId` 及無私人值的取值指引。本人須以 Server scope.userId 比對 read_context.eligibleAssignees 的 userId；不在有效名單內便不可指派，不猜 ID、不靜默改派。既有 code、拒絕及零候選寫入不變；conflict、unknown、撤權及其他工具不套用。這只改善錯誤後恢復，不保證模型首次呼叫正確，也不增加預算或取代每次執行的資格檢查。

Agent拒絕診斷沿既有 `AGENT_DIAGNOSTICS=true` 的metadata-only sink，不開啟ADK原始spans／logger或新增內容日誌。`tool_rejection` 事件只帶既有runId／elapsedMs、configured工具白名單名稱，以及固定stage（schema／authorization／execution）、outcome與code白名單；其他code只記unknown，不能回傳任意程式例外或工具data正文。僅propose_task的schema拒絕可加最多3項、JSON最多256字元的固定path／reason，不記expected、原參數、message、input、issues、未知鍵、動態路徑、使用者或孩子ID。

observer在sink前再次投影白名單，診斷故障不能改變業務結果或產生額外操作。這些事件供關聯已發生的拒絕階段，不授權、不中止既有守衛、不重試副作用；沒有事件也不能推斷歷史運行必定是哪種錯誤。診斷flag的實際生效與真實驗收另核，不因程式支援就宣稱已有過去T9參數證據。

<a id="agent-ordinary-actions"></a>
INT-W02 增補：`GET／POST /api/children/:childId/agent/policy` 管理本人按孩子的普通操作預授權；POST 帶 `operationId／expectedVersion／confirm`，家庭記錄或任務另須 `confirmShared`。預設全部停用；變更身份授權或 storage epoch 令舊政策失效。記錄類別只限 note／feeding／sleep／diaper，普通私人交代與本人 ordinary 任務各自開關；重要健康事實、刪除及擴大共享維持明確確認。渠道權限綁目前本人同意版本及完整 binding 清單，不能因事後多綁渠道而靜默擴權；每項到期授權仍由既有 ContactStore 保存，無 fallback／額外跟進，收據只列實際核准的首個渠道。缺有效通知授權時只能回報站內安排。

`GET /agent/notes?query=…&afterId=…` 返回 `{notes:{items,nextAfterId}}`；是本人普通交代的權威來源，不複製成已確認事實。`POST /agent/notes/:id/delete` 需 `operationId／expectedVersion／confirmDelete:true`。`GET /agent/actions?runId=…` 返回 `{receipts}`，只讀本人／孩子原運行的已提交操作；收據含資源 ID、版本、保存／排程／終態及通知授權狀態，不以模型文字推定成功。上述路徑均以 `/api/children/:childId` 為前綴並重核 session；未套用 migration 025 不啟用新操作。

<a id="agent-input-capacity"></a>
容量契約增補：P2-A01 已以[語義能力集合](#semantic-capability-tools)取代「當前指令＋短延續詞」工具選擇，目標依[語義工具契約](#p2-agent-service)，授權仍由 Server 判定，資料正文不升格為指令。gateway 的完整 contents／config 邏輯 JSON 按運行共用的 inputCharacters 上限檢查（UTF-16 字元，不等於 SDK 後續加入固定設定後的 HTTP body 大小或 token 數）。互動 Agent 由 Server 的 AI_AGENT_MAX_INPUT_CHARACTERS 設定，預設 64,000、允許 32,000–64,000；背景仍為 32,000。原 P1 AI_MAX_INPUT_CHARACTERS 與模型次數／輸出／時間及配額不因此改變。

`read_context` 在整體 request 剩餘容量內只給一份完整、有序的原訊息前綴；`privateSummaryInput.messageIds` 引用同次提供的原文，舊摘要只提供一次。明示 omitted／more／complete，不能把未讀部分說成已摘要。Server 對摘要批次重新核對 previousVersion、basis 及連續前綴 coverage，來源改變仍拒絕。固定 metadata 放不下時明示 context_input_limit，不暗刪事實或任務；原生工具協定／signatures 不被截斷。

Agent 普通記錄的 quantityEvidence 為可空逐字數量片語，只在本次 sourceQuote／原訊息存在、原值與受支持單位對應時保留 quantity。未提供、無法核對或僅有日期／時鐘時保存 null，不補一次、不換算或求和。有限語法支援數字、中文數詞、半數及已知約數；原文約數或範圍不得升為 exact，不支持形式保留在記錄原文。該證據不另存共享欄位；手動 Care API 不變。更正未改量度時可保留舊欄位，但不視為新核對或提升可信度；既有錯誤記錄不自動回填。

`read_context.uncoveredConversation` 依既有摘要 coverage 讀取未覆蓋的本人原訊息，保持完整訊息及最後來源 ID；超過本次工具文字預算時明示未讀部分，不靜默截斷或宣稱全部記得。長期普通交代另由 `read_private_instructions` 按主題查回，不把最近幾則聊天當長期記憶。

INT-W03 增補 `allowRecordCorrections`，既有政策及未提供欄位預設 false，不因升級而擴大舊授權。`read_care_records` 讀目前共享記錄及版本；`revise_ordinary_record` 只按本次明確指令更正本人、原普通類別及目前版本，並要求此新開關與原類別均獲授權。更正沿用 CareStore 歷史及原資源，保留未變的時間精度；共享確認、來源原文、權限／版本、操作收據及未知結果規則不變。

原生 `save_ordinary_record`／`save_private_instruction`／`revise_private_instruction`／`create_ordinary_reminder`／`change_ordinary_reminder` 各採單一參數形狀，共用相同業務操作與收據；只接受互動 run、當次來源訊息、精確 sourceQuote、目前政策版本及允許的動作，由同一交易調用原 CareStore／TaskStore 並保存收據；背景 run 不取得此工具。原 call ID 的精確重試及同 run 等價動作沿用原收據；政策撤回、權限／版本改變及任務終態仍拒絕新效果。工具成功但文字收尾失敗，依台帳顯示已保存結果，不再次執行。`read_context.uncoveredConversation` 顯式區分摘要已覆蓋與尚未覆蓋的原文；只返回完整訊息，超出有界輸入時列未讀部分，不承諾完整記得全部聊天。

背景 product-background 因已核准到期提醒或 S13-W08 新關注基準入列，讀取家庭共享上下文並保存本人站內說明；不讀私人聊天、建立新任務或發出外部通知。成長關注接線見 S13-W08；預授權聯絡由 W07 的接線及授權掌管。必要真 SQL、Gemini／embedding、worker 恢復與修正範圍分列 [S11 證據](../artifacts/verification/S11_W02_CHECKS.json)及 [W08 證據](../artifacts/verification/S13_W08_CHECKS.json)；完整 Agent／關注 UI 情景未驗，不以其他包的瀏覽器證據代替。


<a id="semantic-capability-tools"></a>
### P2-A01 已接線的語義能力集合

互動 reply 固定使用 product-interactive，工具是否存在不再由最後一句／延續詞 regex 或 summary 字詞决定。Server 提供的實際業務工具按 `PRODUCT_AGENT_TOOL_CATALOG` 分為常用核心與能力群；`load_capabilities({capabilities:[id,...]})` 沿同一 strict schema、授權、用量與取消管線載入，不能擴權或直接執行業務。不存在的服務不列目錄；配置遺漏／重複歸屬拒絕。

ADK BaseToolset 每步解析核心＋已載入群，metadata.capabilityCatalog 列出可用群與 loaded；同一 batch 尚未載入的工具仍拒絕。群對應的 Server prompt module IDs 沿既有 manifest 去重／依賴核對，不接受模型路徑。集合按 run 隔離、單調增加；terminal 收尾保持可見，repair 僅可 present_answer。未提供 catalog 的背景／其他 run 保留原固定工具邊界。

此接線沒有新增持久工作、跨輪寫入來源、確認政策、正文 patch 或新業務 API；相關增補依 [總計劃](../PLAN.md#p2-agent-service) 的後續包。最低離線證據見 [A01](../artifacts/verification/P2_A01_CHECKS.json)，不當作完整真 Agent 驗收。

<a id="knowledge-retrieval-contract"></a>
### P2 最小向量檢索契約

- <a id="api-kr-01"></a>KnowledgeRetriever 接收必要問題語義及 Server 核定的適用條件，未知保持未知；不把整份聊天或孩子檔案作 embedding 輸入。內部封裝向量／關鍵詞與 RRF，ADK 只調用同一個渠道／模型無關的檢索工具。
- <a id="api-kr-02"></a>回傳片段識別、原文／章節、來源／版本、官方日期、查核及適用狀態，以及向量＋關鍵詞、關鍵詞降級或不可用等實際檢索狀態。最多六項、適用性及引用門檻依[架構](ARCHITECTURE.md#p2-vector-rag)；排名／距離只作檢索資訊，不作語義支持保證。
- <a id="api-kr-03"></a>兩種檢索及任何復用結果套用相同分類、年齡／地區、已發布、有效版本及停用條件。embedding 失敗可回傳合格關鍵詞結果與降級原因；無適用證據／衝突／不可用不回傳模型補造的來源。
- <a id="api-kr-04"></a>維護指令預覽片段數，按固定模型／維度／處理版本有限生成及核對發布；保存失敗及未完成狀態，hash 未變不重算。P2 提供實際匯入／發布／停用邊界，P4 管理頁及批量維運沿用它，不另建一套管理 API 權威。

<a id="knowledge-w01-implementation"></a>
### S10-W01 實作入口（必要真服務驗收已通過）

[KnowledgeRetriever](../server/knowledge-retriever.ts) 的 `createRun({actor,budget,authorize})` 接收 Server 權威身份、既有運行預算及即時權限回查。`search(query, filter)` 回傳 [KnowledgeResult](../src/shared/knowledge.ts)，包括實際模式、片段短原文 `sourceExcerpt`、經核對精簡轉述 `text`、來源及版本；此處是內部檢索契約，S11-W02 的 ADK／HTTP 接線見上文。`revalidateCitations` 在交付前重查片段／版本／hash 和適用性，不作內容語義判定。維護 CLI 及限額見 [操作文件](P2_KNOWLEDGE.md)；接線驗收按 [S11-W02](../PLAN.md#s11-w02) 的版本化證據。

<a id="knowledge-a04-contract"></a>
### P2-A04 語義查詢、同版擴讀及新版核對

- Agent 自行按多輪情境提出公共主題查詢，不解析思考文字或按最後一句關鍵詞開能力。`search_knowledge` 可帶查詢年齡假設及原話依據；Server 核對本人／孩子的使用者訊息或目前檔案版本。這只供找資料，不能寫成生日、確認事實或精確時程資格。原話／數值詮釋／未知精度分開；條件性命中須補問或明說適用條件。
- 精確已確認年齡沿既有包含範圍；數字約數按原 asOf 與經過時間作仍屬約數的檢索提示，回傳日期基準；無效／未來基準保持未知。約數／查詢假設可按相交年齡範圍找候選，未知年齡可找相關內容但回傳需要核對適用性。不因缺生日封死知識，也不把模型的數值解讀當 Server 已驗事實。地區、分類、公開範圍、來源有效性仍由 Server 控制。
- SQL 先套用有效版本／權限／地域，再分別取有界向量及關鍵詞排名並 RRF；不先拉全庫，也不因總量超過 1,000 便失敗。最多六個結果；引用重驗按實際 ID 查，不能在排名前綴中找不到便判引用失效。embedding 及總 run 限額不變。
- `read_knowledge_context` 只擴讀當次已取得片段的同一有效版本；按穩定片段次序／頁碼分批取回，回傳已讀範圍、完整性及續讀位置。新片段也套用範圍及適用性標示，並累積實際回傳的引用範圍，未讀間隙不補造；不把只讀目錄、短摘錄或一頁當讀完全文。每次工具輸出有界，不能截斷必要例外卻不標示。
- 官方文字型 PDF 用 PDF.js 按頁抽取，沿固定來源抓取安全限制；不執行附件脚本或另抓遠端資源。每批最多八頁、固定檔案 hash、保留實際頁碼與下一頁；空白／圖片／抽取失敗不冒充完整原文。匯入的有限章節可單獨核對，但須標明選取範圍，不宣稱整冊已收錄。私人附件不進此管線。
- 新版 review 須保存對照版本／hash、變更片段、舊新原文依據、含義說明、年齡／數值單位／時程／條件／例外／禁止／撤回核對及受影響代表問題；成長規則有影響時保留待核，不自動改規則。只按 hash 或勾選已看條款不能發布重要新版。無法確定則 hold，已失效或有未核對變更的舊內容不得冒充最新。
- 保留原 import／review／embed／publish 權威及操作人身分；review 與觀察資料在交易內綁當前版本。首次核對、重要改動核對及向量完成後按批准政策自動嘗試發布，失效／來源觀察變更時保留未發布並列明原因；不繞過維護費用上限。僅完全相同已核對內容的觀察刷新可沿用批准，不靠模型自報信心自動批准改動。來源暫時抓取失敗不等於撤回。

<a id="knowledge-refresh-contract"></a>
### S10-W02 來源更新邊界

共用 worker 以 pg-boss 原生每週／每日排程檢查固定、經條款核對的來源；job 只帶 watch ID、配置版本及 worker 世代。暫停、還原或配置失效後不抓取，網絡等待不持有 SQL 交易；回寫前再次核對。`knowledge-refresh.mjs` 只供主機操作者使用，沒有新增 Web 路由或模型可調用的管理工具。

抓取結果是公共來源觀察資料，並非已發布知識。P2-A04 在這個邊界增加語義核對與依政策自動發布，未接入前不把人工 hash 批准當成新門檻已完成。既有 S10-W02 實作中，首次／變更內容須經操作者核對，將 observation hash 綁定至既有 reviewed version，再沿用有限 embedding／publish；hash 未變不重算向量，受影響片段以既有 embedding hash 去重。已登記來源的觀察版本不符、停用或 404／410 均不供引用；重新啟用或登記定義改變時，同一交易內撤銷舊內容批准，即使再改回原設定也不自動恢復。暫時抓取失敗保留先前內容及成功查核時間。候選新聞不自動寫入家庭事實或任務。

`KnowledgeEvidence.checkedAt` 保持人工核對時間；新增 `lastSuccessfulCheckAt` 表示成功來源抓取，未建立證據為 null。來源發布／修訂時間另存，缺日期不代填；近期資訊只取已核對發布、七日內且 24 小時內成功查核的項目。CHP／RTHK 來源只容許主機操作者明確使用 internal audience；公開 store 預設排除，usageScope 不由模型或瀏覽器選擇。這些 metadata 檢查不等於語義支持核對。操作與待驗項見 [P2_KNOWLEDGE](P2_KNOWLEDGE.md#source-refresh)。

<a id="p2-care-http"></a>
## P2 確認記錄及孩子檔案 HTTP（S05-W02）

以下路由均以 `/api/children/:childId` 為前綴，使用當前 Server session／孩子權限；owner、caregiver 可確認／更正／刪除，viewer 唯讀。所有 POST（包括搜尋）需 `x-expected-user-id`、JSON 及合法 Origin，沿用 64 KiB／no-store；讀取或寫入前與撤權使用同一家庭鎖協調。共享範圍須明確確認，並不構成外發授權。

| 路由 | 輸入／結果 |
|---|---|
| POST `/care/search` | `{query?,kind?,cursor?}` → `CarePage`，搜尋字串不放 URL；每頁最多掃描 200 筆加密記錄、回 50 筆，`nextCursor` 非 null 時需繼續，空頁不等於無結果 |
| POST `/care` | `CareValues`＋`confirmShared:true` → 201 `{record}`；來源、原文、種類、數量原值／單位／精度及事件時間原文分開 |
| POST `/care/:recordId/revise` | 上述值＋`expectedVersion`、`reason` → `{record}`；同交易保存舊版／更新目前值，版本不符 409 |
| GET `/care/:recordId/history` | 可選 `beforeVersion` → `HistoryPage<CareRevision>`；每頁 50 版，保留來源、確認者／時間及原因 |
| POST `/care/:recordId/delete` | `{expectedVersion,confirmDelete:true}` → `{deleted:true}`；永久清除正文及全部歷史，保留最小刪除標記 |
| GET／POST `/profile` | GET → `{profile}`；POST `{data,expectedVersion,reason,confirmShared:true}` → `{profile}`；首次版本 0，資料欄位可未知 |
| GET `/profile/history` | 可選 `beforeVersion` → `HistoryPage<ChildProfile>`，每頁 50 版 |
| POST `/profile/delete` | `{expectedVersion,confirmDelete:true}` → 空 `{profile}`；清除全部檔案正文／歷史，版本繼續遞增，其他記錄不刪 |

實際型別見 [care.ts](../src/shared/care.ts)，schema 見 [care-validation](../server/care-validation.ts)。未登入 401，帳號 precondition 缺失 428／改變 409，輸入無效 400，其他家庭、viewer 寫入或不存在目標均 404。純更正與永久刪除是不同動作；模糊時間不得帶假精準 timestamp，約數年齡不生成出生日，也不自動計算矯正年齡。

來源欄由使用者描述，不自動讀私人聊天或冒充官方知識引用；既有私人聊天仍私有。長期候選／記憶接線屬 S09／S11。未知寫入結果先查核，不能自動重送；衝突保留本地輸入並明確核對新版。S07-W03 已接[在線確認](#online-http)；下列 P1 原始契約仍可用，其最新文字由更正後的目前值提供。

<a id="p1-input-contracts"></a>
## P1 已落碼的最小輸入契約

S02 的 [共享輸入](../src/shared/inputs.ts) 只建立首條縱向流程必要的公開驗證；不代表 HTTP 寫入、身份或持久化已實現。

| 輸入 | 規則 |
|---|---|
| `CreateChildInput.displayName` | 字串，去除首尾空白後為 1–80 個 Unicode code point；只需孩子稱呼，不要求法定姓名 |
| `CreateTextRecordInput.childId` | 1–128 個 ASCII 字母、數字、`_` 或 `-`；只是 ID 格式檢查，不能代替 Server 資源授權 |
| `CreateTextRecordInput.text` | 非空白字串、最多 10,000 個 Unicode code point；保存原文及首尾空白，不推斷數字、單位或時間 |

驗證接受 `unknown`，回傳 `ok/value` 或帶欄位及固定錯誤碼／繁體中文訊息的 `issues`；錯誤不回顯被拒絕的正文。`workspaceId`、作者、確認狀態及額外欄位不從這些輸入採信，由 S06／S03 的 Server 邊界取得身份及建立權威欄位。未包含的孩子詳細資料、修訂及事件欄位依後續工作包增加。

部署設定 `EXPO_PUBLIC_API_BASE_URL` 預設 `/api`，可指向 HTTPS API，或只在本機開發使用 localhost／loopback HTTP；拒絕內嵌憑據、query、fragment 及不支援路徑。它是建置時公開配置，不放 provider key，也不是 P4 使用者切換 Server 功能。

<a id="section-3-4"></a>
## 3.4 身份和权限

<a id="api-3-4-01"></a>
P1 起使用自部署 Better Auth 與 PostgreSQL，先落實登入、帳號及資料隔離；P2 加入家庭邀請、成員角色及私人聊天邊界。Better Auth 管理會話，業務 API 逐次檢查資源權限。[PostgreSQL 支持](https://better-auth.com/docs/adapters/postgresql) · [Expo 整合](https://better-auth.com/docs/integrations/expo)

<a id="api-3-4-02"></a>
区分：

- <a id="api-3-4-03"></a>用户身份；
- <a id="api-3-4-04"></a>家庭成员身份；
- <a id="api-3-4-05"></a>设备凭据；
- <a id="api-3-4-06"></a>配对会话；
- <a id="api-3-4-07"></a>模型及通知服务凭据。

<a id="api-3-4-08"></a>
Web／App 均先連接 Server 並登入；資料空間明確綁定帳號及授權關係，不設無登入的本地業務模式。Android 安全保存平台憑據，不保存本地業務主庫。

<a id="api-3-4-09"></a>
个人聊天默认私有，共享照护事件进入家庭时间轴。家庭管理员不自动获得其他成员全部私人聊天。

<a id="p2-family-permissions"></a>
### P2 家庭操作權限

以下為業務角色契約，S06-W02 開始落實家庭 API；Better Auth 會話不能代替每次資源及操作授權。

| 操作 | owner | caregiver | viewer |
|---|---|---|---|
| 查看獲授權的共享孩子資料、關注及任務 | 可 | 可 | 可 |
| 提交／更正共享記錄、確認／更正共享事實及按權限刪除個別共享資料 | 可 | 可 | 不可 |
| 接受／暫緩／關閉共享關注，停用／重新啟用孩子的關注主題 | 可 | 可 | 不可 |
| 安排／指派家庭事項，改期／完成／取消共享任務 | 可 | 可 | 不可 |
| 邀請、變更角色及撤銷成員權限，刪除整個孩子 | 可 | 不可 | 不可 |
| 管理自己的通知偏好、訂閱及撤銷自己的裝置／渠道綁定 | 可 | 可 | 可 |

<a id="api-family-01"></a>
所有「可」仍受當前家庭／資源範圍及版本檢查約束；不能以角色要求讀取其他人的私人聊天。確認共享事實、指派對象及綁定渠道均不等於通知外發授權；收件人及內容仍按[任務授權](#notification-contract)核對。分享私人候選時，確認入口須明示目標範圍，Server 先驗證來源讀取及目標寫入權限。

<a id="p2-family-http"></a>
### S06-W02 家庭 HTTP 接線

沿用 Origin、session、無快取、64 KiB body 上限及 POST 的 `x-expected-user-id`。新 body 嚴格拒絕未定義欄位；識別／角色／預期版本只供 Server 核對，不能代替權限。共享型別見 [family.ts](../src/shared/family.ts)，入口見 [FamilyPanel](../src/client/FamilyPanel.tsx)。實作與真驗收狀態看 [STATUS](../STATUS.md)。

| 方法／路徑 | 輸入與結果 |
|---|---|
| GET `/api/families` | `{families: FamilySpace[]}`，包含自己及已加入家庭的目前角色、成員及權限版本；僅 owner 收到邀請電郵及狀態 |
| POST `/api/families/:id/invitations` | owner 提交 `{email,role,expectedVersion}`；角色只可 caregiver／viewer，回 `{invitation,token}`。UI 先確認全家庭共享範圍，邀請碼只顯示一次，不自動發電郵 |
| POST `/api/families/invitations/preview` | `{token}`，須登入指定電郵帳號，回 `{invitation: {workspaceId,ownerName,role,expiresAt}}`；不預先披露孩子／記錄正文 |
| POST `/api/families/invitations/accept` | `{token,confirmWorkspaceId}`；使用者檢視範圍後確認，回 `{joined:true}`。同帳號重複確認不新增成員，舊邀請不能恢復已撤權資格 |
| POST `/api/families/:id/invitations/:inviteId/revoke` | owner 提交 `{expectedVersion}`；只撤銷未接受邀請，回 `{updated:true}` |
| POST `/api/families/:id/members/:userId` | owner 提交 `{role,expectedVersion}`；role 為 caregiver／viewer／revoked，不能改動／刪除 owner，回 `{updated:true}` |
| POST `/api/families/:id/children` | owner／caregiver 提交 `{displayName}`，回 `{child}`。最少孩子資料入口；年齡／地區及確認歷史由 S05-W02 接入 |
| GET／POST `/api/notification-preferences` | 僅本人；GET 回 `{preferences}`，POST `{timeZone,quietStart,quietEnd,allowAppointmentDuringQuiet,expectedVersion}` 回新版本。初始 version=0；quiet 為不同的 HH:mm，時區須有效 |

家庭由原有 workspace 延伸，owner 仍唯一；加入即涵蓋該家庭現在及日後孩子／共享記錄，UI 建立及接受邀請前均明示。此包不加入 owner 轉移、不同孩子的子權限或電郵發送；一次性 256-bit 邀請碼綁指定電郵，七天失效，同家庭最多 20 個有效未接受邀請，同一電郵不能重複 pending。錯碼、錯收件人、過期或撤銷均回固定 404。必須同時持碼及登入指定帳號；本包不新增電郵信箱驗證服務，不能把帳號電郵當成已核實法定身份。

新管理寫入以 workspace 權限版本拒絕舊畫面，409 要求重讀；400／415／428 是明確拒絕，網絡／5xx 結果未知，不自動重送。既有 `/children` GET 及 workspace GET 擴為目前可存取的家庭資料，`Child.accessRole` 表示目前角色；舊 POST `/children` 保留建立至自己 workspace。共享記錄保留各作者，整個孩子刪除仍只准 owner。viewer 可使用自己的私人聊天，但不能寫共享資料；這不授予查看其他成員私人聊天的權限。

偏好預設 `Asia/Hong_Kong`、22:00–08:00、`allowAppointmentDuringQuiet=false`；true 只表示使用者允許已明確設定的預約提醒在安靜時段內例外投遞，不能代替逐項任務／內容／對象授權。此包只保存偏好，通知及頻率控制仍隨 S13 接線。

<a id="p1-server-http"></a>
## P1 最小 Server HTTP 邊界

S06-W03 先實現以下端點；實際通過狀態見 STATUS／工作包證據，不以本表當 integration 已通過。

| 端點 | 身份及結果 |
|---|---|
| `/api/auth/*` | Better Auth 1.7.5 標準 email/password／session handler；最少 12 字元密碼，無本包 email／社交登入外送 |
| `GET /api/health` | 不需登入；PostgreSQL 可查詢時 `200 {status:"ok"}`，否則固定錯誤／503 |
| `POST /api/workspaces` | 每次查 Server session；由使用者 ID 建立或取得唯一私人資料空間，`200 {workspace}`；不採信 body 的 owner／workspace 欄位 |
| `GET /api/workspaces` | 每次查 session，只列當前帳號資料空間，`200 {workspaces}` |
| `GET /api/workspaces/:id` | SQL 同時限制 ID 及帳號；不存在與另一帳號資料一律 404，不洩漏存在性 |

本包 `workspace` 為 `{id, storageEpoch, createdAt}`，不包含家庭成員／邀請。未登入 401，來源未獲授權 403，不支援方法 405，內容超限 413；業務錯誤為 `{error:{code,message}}`，訊息不回顯憑據或輸入正文。全部 JSON／session 回應不快取。

只接受 GET／POST／OPTIONS；所有 POST 須有精確符合 `SERVER_ORIGIN` 或 `WEB_ORIGIN` 的 Origin，並保留 Better Auth 自身的 CSRF／來源校驗。CORS 不使用萬用 origin，cookie 透過 credentials 傳送；HTTP adapter 保留分開的 Set-Cookie。每個 body 最多 64 KiB。部署 HTTPS origin 與 localhost 開發 origin 分開驗證。

限流暫為單程序記憶體計數（100／60 秒加 Better Auth 端點規則），Server 重啟後計數重設；不聲稱分散式限流。以 socket IP 覆寫使用者可偽造的 x-forwarded-for，不默認信任反向代理標頭；部署代理策略在 S06-W01 按實際環境核對。session 在 PostgreSQL，停用 cookie cache，每次權限操作重新讀取會話。

<a id="p1-child-record-http"></a>
## P1 孩子與文字記錄 HTTP

S03-W01 在同一 `/api` 入口新增以下已登入端點；session、Origin、body 上限及錯誤規則沿用上節。所有孩子與記錄查詢都透過資料空間 owner 限制；客戶端不能指定另一個 owner／作者／Server 時間。

| 方法／路徑 | 輸入 | 成功回應 |
|---|---|---|
| GET `/api/children` | 無 | 200 `{ children: Child[] }` |
| POST `/api/children` | `{ displayName }` | 201 `{ child: Child }` |
| GET `/api/children/:childId/records` | 孩子 UUID | 200 `{ records: TextRecord[], limit: 100 }`，最新在先 |
| POST `/api/children/:childId/records` | `{ text }` | 201 `{ record: TextRecord }` |

`Child` 包含 `id`、`workspaceId`、`displayName`、`createdAt`；`TextRecord` 包含 `id`、`childId`、`authorUserId`、`text`、`createdAt`。輸入沿用共享驗證：稱呼 trim 後 1–80 字；文字非空且最多 10,000 字，原文空白、約數及模糊時間完整保存。文字的孩子取自路徑，作者取自 session；body 的身份欄位不能改寫歸屬。

所有本節 POST 必須帶 `x-expected-user-id`，值為表單所屬的已登入帳號 ID。缺少回 428 `account_precondition_required`，與當次真正 session 不符回 409 `session_changed`，在讀寫業務資料前拒絕。此值只作一致性前置檢查，不能授權或選擇 owner；避免另一分頁換帳號後，把原帳號草稿寫入新帳號。

未登入回 401，其他帳號或不存在的孩子均回 404。列表目前只提供最近 100 則，介面明示此限制；這不是完整搜尋或時間軸。客戶端不自動重試寫入，只有收到成功回應才顯示已保存；網絡失敗／結果未知保留當前表單，先按[原 opId 查核](#online-http)，沒有離線 outbox。舊直接 POST 仍相容，但不提供新操作收據的冪等保證。


<a id="p1-child-deletion"></a>
## P1 必要刪除 HTTP（S05-W01，本機已驗證）

`POST /api/children/:childId/delete` 接受且只接受 `{confirmChildId: childId}`，須有當前 session 及吻合的 `x-expected-user-id`；body 不能指定 owner。成功回 200 `{deleted:true, childId}`，在同一 SQL 中刪除 owned child／相關資料並寫最小標記；外人或不存在均 404。未登入 401、缺預期帳號 428、不同帳號 409、錯誤確認 400。瀏覽器先顯示永久刪除範圍並要求二次確認，離線／提交或 AI 回覆中不得開始。

成功及重新讀取發現孩子消失時，客戶端清理該孩子的照護／聊天緩存及本頁草稿，晚到回覆不得重現；其他孩子草稿保留。網絡失敗或結果未知不能假稱完成，須重新讀取孩子列表核對。不提供無確認的整帳號清空或單則修訂；備份保留政策見 [P1 儲存操作](P1_STORAGE.md)。

<a id="p1-ai-boundary"></a>
## P1 模型安全邊界（S06-W01）

`GET /api/ai/status` 須有有效 session，只回 `{available: boolean}`；未登入 401，回應不快取、不公開 project、地點、模型或憑據。S06 先交付 Server 安全邊界，S11 才接真 Vertex provider、聊天上下文及回答路由；只有配置開關不會啟動模型。

`server/model-gateway.ts` 只接受 Server 組裝的指令與有角色的文字訊息。每次嘗試前重新核對 session／孩子授權，回覆前再核對；拒絕超限輸入、空白或無效模型結果。Server 限制每帳號一個、每程序最多四個同時請求。UTC 每日帳號／全站嘗試數在 PostgreSQL 短事務內共同預留，包含重試及結果未知的嘗試；重啟不重設配額，不因失敗退回可能已產生成本的次數。

預設每天每帳號 20／全站 100 次、每請求最多兩次、每次 30 秒、總輸入 10,000 字元、輸出 1,024 tokens。只有明確的 provider 429 可等候 1 秒 後有限重試；網絡異常、逾時及未知結果不自動重試。`AI_ENABLED=false` 為預設及總開關；變更配置須重啟全部 Server 程序。模型 adapter 須關閉自身重試，避免繞過配額。

`003-ai-usage` 遷移新增每日配額及 `ai_attempts`；只保存帳號／孩子 ID、模型、固定結果碼、耗時及已回報 token 數，未知 token 為 null，不保存問題、回答、憑據或 raw error。遷移只新增資料表，不清空既有資料。設定見 `.env.example`；部署須使用 HTTPS、精確 origin、Server ADC 及私網 PostgreSQL，不信任客戶端 forwarding header。

Vertex generate 失敗可在既有 Server 日誌記錄一次受限診斷：固定 event=vertex_generate_failure、httpStatus（只接受 400–599 整數，否則 null）及固定 category。不得包含問題／回答、家庭或帳號識別碼、網址、headers、憑據、原始錯誤字串或 stack。診斷不改原例外傳遞、取消／deadline、配額或 adapter 的單次嘗試；未知用量仍是未知，不能因顯示 0 tokens 推定零費用。這不改公開 API 或新增監控／存取權限；mock SDK 驗證不代表正式 provider 已恢復。

身份／配額接線與真服務驗收分開核對：[S06-W01](../PLAN.md#s06-w01)／[S11-W01](../PLAN.md#s11-w01)；fake provider 不等於真模型證據。

<a id="p1-chat-http"></a>
## P1 私人聊天保存 HTTP（S09-W01）

`GET /api/children/:childId/messages?before=:messageId` 返回 `{messages, limit:100, nextCursor}`，每則有 `id/childId/authorUserId/role/text/inReplyTo/createdAt`。首次省略 before，後續使用 nextCursor（最舊訊息 ID）；按 Server `(created_at,id)` 穩定排序，游標查詢也限定本人／孩子。每頁按時間正序呈現，沒有更多時 nextCursor=null。只返回當前帳號在該孩子的私人聊天；無權或不存在都 404，未登入 401。

INT-W03 的 `POST /api/children/:childId/messages/:messageId/reply/cancel` 接受 `{}` 及相同 `x-expected-user-id`，重新核對 session、孩子、原訊息、授權版本及儲存 epoch，將本人原互動 run 的取消狀態持久保存於 SQL 台帳。`accepted:true` 表示原 run 已保存為 stopped／cancelled，或冪等確認同一仍獲授權的 cancelled run；同程序 AbortController 只作及時中止的加速。其他程序在下一次 Server 授權檢查停止後續操作，不保證立即停止在途模型／工具，也沒有跨庫副作用的原子 fencing。仍須讀取原運行與業務收據；取消不撤銷已提交效果，不把 unknown 改成未執行。`false` 不聲稱運行已取消；重啟後查原台帳，不重建或重跑模型。取消不增加生成呼叫；背景 worker 不由這個入口控制。持久狀態、終態與結果查回邊界見[取消契約](CHAT_AGENT_INTEGRATION_CONTRACT.md#原運行的持久取消)。

`POST /api/children/:childId/messages` 只接受 `{text}`，保存 1–10,000 Unicode 字元原文；拒絕額外欄位、空白、NUL 或無效 surrogate。須有符合 session 的 `x-expected-user-id`，缺失 428／不同 409；成功回 `{message}` 及 201。作者、角色、ID 和時間由 Server 決定，不能提交模型訊息。訊息本身不是已確認照護記錄，不觸發模型或工具。

GET／POST 沿用原有 Origin、body 上限、cookie 更新及 no-store 規則。此包沒有瀏覽器主庫、outbox 或自動重試寫入；S11 會接入保存後的聊天 UI／Gemini，P2 才補完整搜尋與長期記憶。

<a id="p1-chat-reply"></a>
## P1 Gemini 文字聊天（S11-W01）

Web 先保存 user 原文，再 `POST /api/children/:childId/messages/:messageId/reply`，body 只接受 `{}`，帶相同的 `x-expected-user-id`。成功返回已保存的 `{message}`／200；已有回覆直接重用。Server 以 PostgreSQL advisory lock 避免同一訊息並發生成，每程序最多持有四個回覆鎖，保留連線供授權及配額查詢。程序退出會釋放鎖；這不是 S07 的完整冪等協議，模型成功而尚未保存的未知結果不能保證免重複計費。

Server 復用完整 [P1 prompt](../prompts/p1/childcare-chat.txt)，只組合已授權孩子稱呼及私人近期聊天；最多 20 則，按總輸入字元上限由近至遠保留，止於所要求的 user 訊息。孩子資料放在 user 內容，不升為系統指令；不讀照護記錄、其他人的聊天或未來訊息，不提供工具／長期記憶。目標原文連必要指令仍超限時拒絕 AI 呼叫，已保存原文保持不變。

固定 `@google/genai` 2.24.0，Server 使用 ADC、Vertex v1 及 `.env.example` 指定模型／地點，SDK `attempts:1` 關閉額外重試。只接納正常結束的自然文字，移除 thought parts，拒絕工具、空回覆及截斷輸出；回覆保存前再次核對 session／孩子授權。401 表示登入失效，404 表示訊息／孩子不可見，400 表示輸入不適用；429 包括 `ai_busy`／`ai_quota_exceeded`，503 包括 `ai_disabled`／`ai_timeout`／`ai_unavailable`。

`GET /api/ai/usage` 只向當前登入者返回 UTC `day`、`attempts`、`inputTokens`、`outputTokens`、`cachedTokens`、`unknownUsageAttempts`。tokens 為已回報部分的合計，未知次數另列；output 由 total 減 prompt 計算並包含已回報思考 tokens，缺失不推算。這是用量統計，不是帳單或剩餘優惠額度。

草稿只存本頁、按孩子區分；換帳號／登出清除，離線或 AI 失敗保留輸入。原文保存未知時先重讀及人工核對，不自動重送；AI 回覆可用原 message ID 手動再取，已有結果不再呼叫模型。關頁／登出前提示未提交內容，沒有瀏覽器資料主庫或 outbox。介面告知要求回覆會將孩子稱呼及近期聊天送到 Google，P1 試玩只使用合成資料。

<a id="section-4-1"></a>
## 4.1 配对码与二维码

<a id="api-4-1-01"></a>
配对码只用于临时设备授权，不是 API key、账号密码或永久访问密钥。

<a id="api-4-1-14"></a>
配对码默认五分钟有效、单次使用，并限制尝试次数。二维码不包含儿童资料或模型密钥。涉及新的服务器地址时，先展示地址供确认。

<a id="sync-contract"></a>
## 在線寫入及更新契約

<a id="online-http"></a>
### S07-W03 已實作入口

下列入口沿用 session／Origin／64 KiB JSON 上限及 `no-store`；包括 GET 在內均要求 `x-expected-user-id`。Server 以登入身份重新核權，請求身份欄不能授權。migration 010 套用後啟用；未套用時保留舊服務行為，不以 428 一次封鎖舊路由。

| 入口 | 請求及結果 |
|---|---|
| `GET /api/online/spaces` | 目前有權的 workspace／storageEpoch；不回傳私人正文 |
| `POST /api/online/context` | `{path, payload}` 只接受白名單業務寫入；核對目標後返回 `{workspaceId, storageEpoch}`，不執行該業務操作 |
| `POST /api/online/submit` | `{path, payload, operation:{workspaceId, storageEpoch, deviceId, opId}}`；entity／action 沿用既有路徑，baseVersion 沿用 payload 的 `expectedVersion`，不重複傳兩套欄位 |
| `GET /api/online/operations/:opId` | 只查本人操作，回 `{state:"unconfirmed"}` 或已確認收據；每次重查現在權限及 storageEpoch |
| `GET /api/online/changes?workspaceId=…&storageEpoch=…&cursor=…` | cursor 初值字串 `"0"`；每頁最多 100 項無正文變更，含 changeSeq／kind／childId／deleted、accessVersion、下一 cursor／hasMore。私人聊天／偏好只回本人，邀請細節變更僅 owner 可見 |

已確認收據為 `{state:"confirmed", path, operation, changeSeq, statusCode, result}`；外層 HTTP 200，`statusCode` 保留原業務的 2xx。業務寫入、變更序號及加密收據在同一交易提交。相同 opId／deviceId／範圍／內容重試回原結果；不同 opId 仍代表不同真實事件，不按文字相同去重。刪除正文後收據的 `result` 可為 null：操作仍已確認，不能解讀為「沒有保存」而另建。收據是當時確認，現況須重新讀取。

白名單涵蓋孩子建立／刪除、文字及照護記錄、孩子檔案、私人聊天原文、家庭邀請／接受／撤權／成員角色及本人通知偏好；不接受模型生成、外發、身份操作或任意 URL。模型回覆仍沿用 messageId 專用入口，其費用／未知結果限制不因本包消失。

`operation_mismatch`、`storage_epoch_changed`、版本衝突均 409；不得換 opId 強行重送。照護搜尋的新 cursor 帶 changeSeq，列表期間資料改變回 `cursor_stale`／409，從首頁重讀而不拼接不同版本。舊 cursor 仍相容，不聲稱具有新快照保護。缺身份前提 428、帳號改變 409、未登入 401、失去權限／不存在 404、無效輸入 400。

Web transport 在本頁記憶體保留原操作；未知結果先查收據，只有使用者明確重試才沿用相同識別提交。重新連線／頁面取得焦點及可見期間每 30 秒重新核對授權與資料，忙碌畫面可於下一次讀取更新；不宣稱即時推送。失敗不推論保存／刪除／登出；換人、登出、撤權清理本頁狀態。刷新或關閉不保證恢復草稿／操作識別，不建立持久 outbox。實際型別及 transport 見 [online.ts](../src/shared/online.ts)／[online-transport.ts](../src/client/online-transport.ts)。

| 调用面 | 请求／返回的既定语义 | 权威依据 |
|---|---|---|
| 在線寫入 | 使用保留名稱的 SyncOperation 字段組；Server 先檢查身份、當前權限、世代、版本及 opId；重試回傳已有或新確認結果，不由客戶端先宣告保存 | [字段](DATA_MODEL.md#section-4-3)、[確認過程](ARCHITECTURE.md#section-4-4) |
| 在線增量更新 | 按 cursor 取得 changeSeq 變更；重新連線仍須檢查授權。游標不代替寫入確認，不隱含持久離線副本 | [changeSeq／cursor](DATA_MODEL.md#section-4-3)、[確認過程](ARCHITECTURE.md#section-4-4) |
| 附件傳輸 | 獨立傳輸及 hash 校驗，區分未提交、傳輸中、Server 已確認或失敗；正文成功不代表附件完成 | [附件定義](DATA_MODEL.md#section-3-2)、[確認過程](ARCHITECTURE.md#section-4-4) |
| 冲突／终态 | 返回可见的冲突／待核对内容，不用设备时间裁决；遵守已完成／取消的终态限制 | [冲突不变量](DATA_MODEL.md#section-4-5) |
| 撤权 | 请求执行必须遵守当前授权，不能继续接受已撤销设备上传；必要审计不含家庭正文 | [撤权行为](../SPEC.md#section-4-8)、[日志隐私](../SPEC.md#section-5-9) |
| 寫入結果未知 | 逾時不當作確定失敗；以原 opId 核對結果，再由使用者安全重試。未提交輸入只留當前畫面，刷新／關閉前提示 | [確認過程](ARCHITECTURE.md#section-4-4) |
| 遷移後舊請求 | 舊世代不能覆蓋新環境；回報需要核對及重新連接，不建立跨關閉離線草稿或 outbox | [正式遷移](ARCHITECTURE.md#section-6-4) |

<a id="notification-contract"></a>
## 任務授權與渠道投遞契約

<a id="p2-task-http"></a>
### S13-W01 手動任務台帳

實際型別與欄位驗證見 [tasks.ts](../src/shared/tasks.ts)。所有路由以已登入帳號及孩子家庭權限核對；owner／caregiver 可寫，viewer 可讀。這個入口確認的是家庭共享安排，不代表向其他人外發的授權。

| 入口 | 輸入及結果 |
|---|---|
| `GET /api/children/:childId/tasks` | `afterId` 可選；每頁最多 50 個，回傳 `items / eligibleAssignees / nextAfterId`。合資格指派對象只有該家庭 owner／caregiver |
| `GET /api/children/:childId/tasks/:id` | 回傳當前 `{task}`；收據內的舊結果不能代替本次讀取 |
| `GET /api/children/:childId/tasks/:id/history` | `beforeVersion` 可選；最多 50 筆 revision，包含當時完整快照、操作人、操作、原版本、原因／備註及 Server 時間 |
| `POST /api/children/:childId/tasks` | `values` 為標題、正文、ordinary／appointment、負責人、含 offset 的 `dueAt`、IANA `timeZone`；`confirm:true` 後建立一次安排及穩定 occurrence |
| `POST /api/children/:childId/tasks/:id/change` | `expectedVersion / confirm:true / action`；reschedule 帶時間、時區、負責人及原因，complete 可留備註，cancel 必填原因；resolve 只處理待覆核衝突，明確選 completed／cancelled 及原因 |

POST 是 [在線收據](#online-http) 的 command path，須經 `/api/online/context`、`/api/online/submit` 執行；直接 POST 回 428，避免沒有原 opId 的重試重建事項。讀回、撤權及刪除沿用同一權限與結果清除規則；失去回應先查原操作，不以文字相同推定成功。

改期／轉派保留 taskId 及 occurrenceId，過期仍是 scheduled；沒有自動完成。一般舊版本回 409。唯一例外是同一 scheduled 版本上的相反 complete／cancel：保留兩筆 revision，第二筆回已確認的 `needs_review`（HTTP 200 收據），並停止提醒；不能把它顯示成照護已完成。明確 resolve 只選終態，不重新排程。已結束事項如需另做，須明確建立新事項。

S13-W01 不外發或自行建立週期排程。`task-policy.ts` 提供可重用的確定性提醒資格判斷：收件人本地日的普通合併上限、最多一次跨日跟進、安靜時段及明確預約例外；已撤權／終態／unknown 均阻止新投遞。跨事項／孩子／渠道的持久批次、資格重新核對及原子去重由 S13-W04／W07 接入，不能將純判斷測試當作 worker 或真通知已通過。

<a id="p2-task-worker-http"></a>
S13-W04 在 migration 013 後擴充上述清單回應：`reminders` 只含本人在本頁的當前版本、仍 scheduled 且仍有執行資格的站內提醒；每筆有 `id / batchId / taskId / occurrenceId / taskVersion / phase / createdAt`，phase 為 initial／follow_up。`work` 包含本頁當前版本的 `taskId / taskVersion / status / nextAt / failures`；status 為 pending／processed／stopped／failed／unknown。`nextAt` 是排定檢查時間，processed 不代表照護完成，unknown 不允許自動重做。`workerEnabled` 是持久執行開關，並非在線／健康證明。舊資料庫缺少這些 optional metadata 時，UI 不宣稱 worker 已接通。

建立／改期在既有收據交易內寫 task_work 及 pg-boss job；入列失敗整筆回滾，不能回報已安排。首次遷移及還原保持執行暫停，期間可保存安排，經維護核對再啟用。沒有新增公開的 worker 管理 HTTP 路由；[操作與未驗範圍](P2_WORKER.md)。站內提醒不構成 Web Push／Telegram 的外發授權或投遞證據。

<a id="api-notification-01"></a>
`TaskExecutor` 在 Server 根據事件或到期工作取得有限租約，每次執行均重查任務終態、授權版本及資源權限。Agent 可在 Server 提供的合資格照顧者中提出選擇及理由；服務按明確指派、預設負責人及預授權備援規則核准，缺資料先補問，不猜測誰有空。內容範圍、時機、重試及 fallback／升級由任務業務規則決定，不交給渠道 adapter。預先授權範圍內自動執行，範圍外先確認。

<a id="api-notification-02"></a>
`NotificationGateway` 接收已核准的穩定任務／發生實例、收件人、渠道綁定、內容及投遞識別；回傳渠道接受／拒絕／結果未知、可用回執及其時間，不回傳虛構的送達或已讀。供應商不支援的證據保持未知；投遞結果不直接把任務改為完成。

<a id="api-notification-03"></a>
Telegram 綁定須確認接收者已啟動 bot，並把渠道身份與獲授權帳號／家庭身份連結。Web Push／FCM 使用相應裝置訂閱／token；失效、停用及撤銷有明確結果。綁定本身不是家庭資料存取權或任意外發授權；通知服務密鑰只在 Server，敏感 token 不進日誌。

<a id="api-notification-04"></a>
已知可重試失敗按有限上限處理；結果未知須核對原投遞，不盲目重送或切換渠道。fallback 只按已授權的對象、內容及渠道條件執行，逐次重查最新授權並記錄原因及終止狀態。撤權、取消、完成或超出範圍停止新投遞；已被外部渠道接受的訊息不能保證撤回。

<a id="api-notification-05"></a>
worker 重啟、租約過期及並發執行沿用穩定邏輯識別，從投遞台帳恢復，不另建任務或把 unknown 當未發送。實際字段及狀態語義依 [DATA_MODEL](DATA_MODEL.md#notification-model)，不在本文件預定供應商路由或完整 schema。

<a id="api-notification-06"></a>
TaskExecutor 同時核對接收者時區、安靜時段、合併及跟進上限、個人退訂、關注有效性及主題停用；延後至容許時段後再核對，不沿用排入時的過期資格。渠道 adapter 回報失效／拒絕／未知及已知回執，不自行繞過限制加發；完成預設只更新站內台帳。預約例外須有明確使用者設定，綁定不代表同意例外。

<a id="growth-attention-contract"></a>
## P2 成長關注操作契約

- <a id="api-ga-01"></a>取得關注時回傳獲授權的孩子／範圍、當下原因、適用依據、官方片段／版本、限制及可執行操作；私人來源不得透過理由洩漏。家庭背景判斷只用已確認且可向展示對象公開的資料。
- <a id="api-ga-02"></a>接受、暫緩、關閉、主題停用／重開及任務改期／完成／取消，均重查角色、資源、版本與冪等結果。回傳真實關注／任務狀態及必要關聯；接受候選不等於完成、已預約、已外發或取得新授權。稍後處理保存既有安排，不以技術重試另建實例。
- <a id="api-ga-03"></a>重新提出已關閉主題須有規則允許的新實質依據，回傳新原因及前次處理關聯；舊終態維持，永久停用須明確重開。來源失效、依據不足、衝突、越權及已不適用均有明確結果，不冒充新候選或操作成功。
- <a id="api-ga-04"></a>資料語義見 [DATA_MODEL](DATA_MODEL.md#growth-attention-model)，執行次序見 [ARCHITECTURE](ARCHITECTURE.md#growth-attention-flow)。沿用既有共享介面及在線更新；本包實際路由見下方，不新增通用平台。
<a id="growth-attention-http"></a>
### S13-W08 實際接線

僅在 `P2_AGENT_ENABLED=true` 且 migration 017 已套用時接線。沿用登入 cookie、`x-expected-user-id`、JSON／Origin 及家庭角色校驗；共享關注對目前成員可見，owner／caregiver 可管理，viewer 唯讀。

| 路由 | 契約與結果 |
|---|---|
| `GET /api/children/:childId/growth` | `{page: GrowthPage}`，有效／暫緩項目、最近 30 項歷史、`historyHasMore`、四主題及近況選项、提示、合資格任務負責人、`canManage`、`authorityVersion` |
| `POST /api/children/:childId/growth/:id/decide` | `GrowthAction`：原 `expectedVersion`／`authorityVersion`／`confirm:true`，接受（只知悉、連既有指定版本任務或明確新建）、暫緩至指定時間、關閉；回傳 `{item}` |
| `POST /api/children/:childId/growth/topics/:topicId` | `GrowthTopicAction`：原版本／授權版本、明確永久停用／重新啟用，或 `confirm_context`；近況另需 `expectedFacts` 與 `confirmShared:true`，回傳 `{page}` |

共享型別／校驗見 [growth.ts](../src/shared/growth.ts)。`authorityVersion` 綁 workspace storage epoch 及成員授權版本；舊畫面不可跨還原、撤權／再邀請繼續確認。近況只接受頁面提供的有限選項，在同一交易寫入既有記憶事實及更正歷史；原 fact ID／版本不符、衝突或失效時拒絕覆蓋，轉到記憶入口核對。

原版本＋相同 actor／完整請求的最後一次成功操作可查回，不能再次建立任務。回應未知先 GET 原頁面再決定是否重送原 body；不得默換新版本／授權版本。更晚的處理可令原重試回 409，必須重新核對。沒有離線操作佇列。

`sourceAvailable` 表示原關注的已核對來源**及適用依據**仍成立；false 不必然代表網站下架。這時不呈現舊建議為現行指引、不允許接受／暫緩，保留歷史及真正任務狀態。關注接受不等於預約成功或任務完成。新基準沿用已明確關聯的同階段任務；若原任務仍待處理／待覆核，拒絕在關注入口再建一份，先核對既有安排；不從相似標題猜測任務關聯。任務改期／完成／取消沿用 S13-W01。重新啟用主題只恢復未來評估，不復活已關閉的相同依據。


## S09-W02 記憶介面

<a id="p2-memory-http"></a>
使用現有登入 cookie、來源檢查及 POST 的 `x-expected-user-id`；每次交易重新核對家庭權限。以下路徑前綴為 `/api/children/:childId/memory`，正文型別見 [memory.ts](../src/shared/memory.ts)。沒有公開摘要寫入路由，也不能從請求指定模型身份／工具權限。

| 方法／後綴 | 輸入與結果 |
|---|---|
| GET `/facts`、`/topics` | 可選 `afterId`；每頁最多 50 項，回傳 `items`／`nextAfterId`；只包含家庭共享及本人私人資料 |
| POST `/facts` | `FactCreate`；建立私人候選，保存 `intendedVisibility`，尚不作已確認事實；回傳 `{ fact }` |
| POST `/facts/:id/confirm` | `FactConfirm`；預期版本、明確確認及共享確認，重核來源；候選／停用事實才可確認 |
| POST `/facts/:id/revise` | `FactRevise`；新內容／來源、更正原因及版本，保留原可見範圍和狀態；停用資料須另行確認才恢復 |
| POST `/facts/:id/deactivate` | `FactDeactivate`；保存原因及新版本，停止作為適用事實 |
| POST `/topics` | `TopicCreate`；私人或明確共享的待處理話題，回傳 `{ topic }` |
| POST `/topics/:id/change` | `TopicChange`；待處理／暫緩可改為已回答、已解決或指定未來時間暫緩；終態拒絕改回待處理 |
| POST `/topics/:id/reopen` | `TopicReopen`；明確原因及原版本，另建關聯話題；保留原終態，同一舊話題只重開一次 |
| GET `/facts/:id/history`、`/topics/:id/history` | 可選 `beforeVersion`，`HistoryPage` 每頁 50；其他家庭成員看不到共享前的私人候選版本 |
| POST `/facts/:id/delete`、`/topics/:id/delete` | `MemoryDelete`；預期版本及二次確認，只刪指定資料與其修訂；保留最小刪除標記 |
| GET `/summary` | `{ summary }`，只回傳本人有效摘要，未生成／失效時為 `null` |

owner／caregiver 可管理共享記憶；viewer 只能管理本人私人記憶。任何成員均不能管理他人的私人資料。私聊來源只接受本人、同一孩子的訊息；轉共享只公開明確確認的內容／來源描述，不公開原始訊息或私人候選歷史；對其他成員隱藏私人訊息 ID。引用照顧記錄需核對當前版本，更正後衍生事實標記 `sourceState=changed`、`applicable=false`，須重新核對。過期、停用及候選亦不進入適用事實集合。

同一範圍的已確認事實不能有重複標準化 key；不同私人／共享範圍同 key 的衝突由內部 context 明示，不靜默擇一。這不是自然語言矛盾檢測器；孩子年齡、日期基準等既有結構資料仍以 S05 檔案為準，不能由摘要推算或覆蓋。

錯誤沿用 401（未登入）、428（缺身份前置）、409（身份／版本／來源／終態衝突）、404（不存在或無權）、400（輸入／確認不完整）。S09 復用已合併 S07 的[在線收據](#online-http)：上述事實／話題 POST 均可作為白名單 command，Web 經 `/online/submit` 執行；內部摘要寫入不開放為 HTTP／online command。未知結果先查原 opId，再由使用者明確重試；版本／來源衝突仍需比較，不把世代／操作衝突當作可覆寫的版本衝突。舊直接 POST 保留相容，沒有操作收據時不承諾冪等。

migration 011 啟用 `memory` 類無正文變更及收據刪除；私人候選／話題／摘要只向本人發出更新，共享事實／話題在家庭內可見。Server 仍校驗每項記憶的可見範圍及角色，READ 入口資格不允許 viewer 寫共享事實。讀取與修改回應同樣隱藏其他作者的私人訊息 ID。刪事實／話題時保守清除該孩子 memory 類收據正文；原操作仍 confirmed，不能另建重複候選。模型摘要與產品 Agent 接線維持 S11-W02。

內部 `MemoryStore.prepareSummary` 回傳前一有效摘要、當前權威版本摘要值 `basis`、`previousVersion` 及按 Server 次序排列的最多 50 條未覆蓋訊息；`saveSummary` 只接受完全吻合的實際 ID 清單及版本。資料變化、缺段、越權、重複或過時輸入均不當作成功。摘要不寫入事實／話題／任務狀態。`context` 分開私人及家庭模式；家庭模式不含私人聊天／摘要，亦不提供私人來源 ID。context 在 200 項事實上限之前排除 inactive 歷史事實，歷史／一般列表仍保留它們；inactive 舊 key 不再否決另行確認的替代事實。候選、過期或來源改變的 confirmed 事實仍納入完整範圍及 unavailable-key／conflict 核對。超過 200 項非 inactive 事實或任何狀態的話題時仍拒絕無篩選 context，不能取前 200 項而暗藏衝突或終態；訊息未全部覆蓋以 `truncated.messages` 明示。S11-W02 接入模型時必須處理這些狀態、有效性及 `conflictingKeys`，本包未改 P1 聊天入口或宣稱已由 Gemini 生成摘要。


<a id="p2-web-push-http"></a>
## P2 本人 Web Push 渠道

S13-W05 [共享契約](../src/shared/web-push.ts) 只管理本人訂閱及明確一般測試；不授予聯絡其他照顧者的權限。全部讀寫要求登入及相符的 x-expected-user-id；POST 只透過 [S07 收據](#online-http) command 白名單，直接 POST 回 428。私人 preferences 變更只向本人可見。

| 路徑 | 輸入／回應 |
|---|---|
| GET /api/web-push | WebPushStatus：本人綁定、最近最多 20 項投遞、public VAPID key、provider、配置／worker 旗標及測試額度；不回 endpoint／auth key |
| POST /api/web-push/subscriptions | PushRegistrationInput：subscription（endpoint、keys、expirationTime）及 label；回 { binding }；相同本人端點及 key 冪等，不接管他人綁定 |
| POST /api/web-push/subscriptions/:id/revoke | expectedVersion；回 { binding }，清除 hash／密文並停止尚未開始投遞 |
| POST /api/web-push/subscriptions/:id/test | expectedVersion、confirmImmediate:true；回 { delivery }，同交易保存 queued 與 job，不在收據交易外發 |

配額、provider、加密配置及限制見[操作說明](P2_WEB_PUSH.md)。版本／綁定／額度／worker 不符為 409，不自動更新版本；他人／不存在資源為 404，schema 無效 400。S13-W07 才將核准照護任務交渠道，不能把 test 入口當成 Agent 任意外發工具。accepted 不等於送達、已讀或完成；unknown 不重發，已在途請求不能保證撤回。

<a id="errors-compatibility"></a>
## 错误、兼容和未确定的实现细节

契約要求區分未授權／已撤權、配對過期或重放、舊世代、版本衝突、校驗失敗、網絡失敗、結果未知及附件未完成；界面映射到 [SPEC 確認狀態](../SPEC.md#section-4-7)，失敗或未知不能顯示成功。以上是業務條件，未固定 HTTP 狀態碼或錯誤字串。

HTTP 路徑、完整封裝、裝置憑據格式、批次限制、衝突內容及相容協商仍由 [D-API-001](DECISIONS.md#d-api-001) 追蹤：P1 S06-W03 定最小登入／資料介面，S06-W01／S11-W01 定安全 AI 入口；P2 S07-W03 定在線一致性，S13-W04 至 W07 定 worker／通知／授權 fallback；P4 S06-W04／S08-W01 定 Server 選擇及裝置授權。僅實作所需部分，寫回本文件。遷移格式及恢復要求依 [DATA_MODEL](DATA_MODEL.md#section-6-2) 與 [ARCHITECTURE](ARCHITECTURE.md#section-6-5)，不虛構已運行路由或指令。

<a id="telegram-http"></a>
## P2 Telegram 本人渠道

S13-W06 的 [共享型別](../src/shared/telegram.ts) 接本人私人渠道；綁定本身不授予讀取家庭資料或任意聯絡權。以下登入 HTTP 均核對 cookie 及 x-expected-user-id，POST 只經既有 S07 原操作收據；直接 POST 回 428。網絡外發在交易提交後由 worker 執行。

| 路徑 | 輸入與回應 |
|---|---|
| GET /api/telegram | TelegramStatus：本人綁定、未過期連結／候選帳號、最近 20 筆投遞、配置／worker 狀態；不回原 chat ID、bot token 或 webhook secret |
| POST /api/telegram/challenges | confirmPrivateChannel:true → { challenge }；10 分鐘私聊連結，每人每小時最多 6 個，取代尚未完成連結 |
| POST /api/telegram/challenges/:id/confirm | expectedVersion、confirmAccount:true → { binding }；須在 Telegram 啟動 bot，再於網頁確認候選名稱／身份尾碼；版本／epoch／期限重查 |
| POST /api/telegram/bindings/:id/revoke | expectedVersion → { binding }；清除渠道身份密文及索引，停止尚未開始投遞 |
| POST /api/telegram/bindings/:id/test | expectedVersion、confirmImmediate:true → { delivery }；固定無家庭正文測試、每日最多 3 次、至少相隔 60 秒；排隊與 job 同交易 |
| POST /api/telegram/webhook | 唯一免瀏覽器 Origin／會話的渠道入口；必須先通過 Telegram secret header，再讀取最多 64 KiB JSON；無有效 secret 不讀正文 |

一人最多一個 active 綁定，同一 bot 的同一私人 chat 不能由另一產品帳號接管；換帳號先撤銷。只處理私人 /start、/stop、bot 封鎖及本人匹配的 opaque callback；不保存無關聊天。/stop／封鎖也取消已識別、尚待網頁確認的連結。

queued、sending、accepted、rejected、unknown、stopped 與 acknowledgedAt 分開；「收到測試」只記收到，不改任何照護任務。sendMessage 逾時或重領 sending 保留 unknown，不重發／不切換渠道；API 接受不是送達或已讀。同一綁定仍有 queued／sending 或未收到回應的 unknown 時，Server 拒絕另建一般測試。原 opId 回應丟失先查收據；即使現況改變，仍可明確用相同原操作取得既有成功或 Server 拒絕，不另建操作猜結果。

家庭授權聯絡由 S13-W07 接線，callback 只記收到；任務完成仍須明確確認。SQL／真渠道及公開 webhook 的既有結果分見 [S13-W06](../artifacts/verification/S13_W06_CHECKS.json)／[S17-W02](../artifacts/verification/S17_W02_CHECKS.json)，不由契約正文推斷完整瀏覽器已驗。

<a id="care-summary-http"></a>
## S14-W01 摘要與到診準備

需 P2 開關及 migration 020。GET `/api/children/:childId/summary?startDay=YYYY-MM-DD&period=day|week&timeZone=Asia/Hong_Kong` 回 [CareSummary](../src/shared/care-summary.ts)；登入並核對 expected user、孩子可讀角色。日期窗口為當地一日／連續七個曆日，結束日不包含；數字只從已確認、具有事件時間的當前版本計算。未知時間另外計數，不拿輸入／確認日期冒充事件日期。零紀錄不等於事件沒有發生。

POST `/api/children/:childId/visit-preparation` 只經 S07 收據（直接 POST 428）：`PreparationInput` 帶 expectedVersion、basisVersion、period、明確共享確認、可選已確認且仍 scheduled 的預約 task ID、最多 12 問題／16 清單項及家長核對狀態。只有 owner／caregiver 可寫；回 `{preparation}`。來源或版本改變回 409，原 opId 查核／重試，不自動套新版本。

GET 同一權限交易取得資料與版本；每孩子最多掃 2,000 筆記錄／500 任務，超限明示不產生部分總計；窗口最多 200 筆，超限可改單日。未知時間數量屬全部已掃孩子記錄，不冒稱特定期間缺失。數量只接受明確十進位及已列單位，保留約數；不混加單位、不解析便條數字。原文、source、確認與更正版本保留於記錄索引；既有 care history 入口可取完整修訂。

Agent 的唯讀 `read_care_summary` 復用同一服務、身份與運行預算；模型不能改數字或保存核對狀態。特定摘要需求載入既有 summary-visit 配方，沒有新增模型生成 HTTP、PDF、分享或推送。

<a id="p2-photos"></a>
## P2 照片（S12-W03）

所有路徑在 `/api/children/:childId/photos` 下，須登入及 `x-expected-user-id`。先透過原 opId 收據建立 metadata，再獨立傳原檔；原檔確認與家庭記錄確認分開。

| 操作 | 請求及結果 |
|---|---|
| GET 集合／`/:id` | 目前有權附件清單／單項；私人附件只回上傳者，共享原圖回目前家庭成員 |
| POST 集合（online 收據） | `fileName,mimeType,bytes,sha256,source`；回 private／reserved 附件。JPEG／PNG，單張 4 MiB，每孩子 100 張／100 MiB，全站 10,000 張／原始容量 512 MiB；預留及待清理原檔亦計額 |
| POST `/:id/content` | `{base64}`；只對已核權、同一穩定 ID 的原圖放寬 HTTP 大小。Server 核格式簽名、長度及 SHA-256，再確認 ready；相同原檔可明確重傳，不准換原檔 |
| GET `/:id/content` | 重新核權、解密及核 hash 的原始 JPEG／PNG；no-store，不回永久公開 URL |
| POST `/:id/extract` | `{expectedVersion,confirmModel:true}`；只有原上傳者可把私人原圖送到既有 Vertex／ADK。running／unknown 只查原狀態，已知 failed 可用目前版本明確重試；不自動重試模型 |
| POST `/:id/confirm`（online 收據） | `{expectedVersion,confirmShared:true,values:CareValues}`；家長核對文字、種類、約數／單位／模糊時間後，在同交易建立照護記錄及共享原圖；source 由 Server 綁 ID／hash／上傳時間／原來源，不接受偽造來源 |
| POST `/:id/delete`（online 收據） | `{expectedVersion,confirmDelete:true}`；私人原圖由上傳者管理，共享原圖由 owner／caregiver 管理；同時刪相關照護記錄／修訂及附件 metadata，原檔進持久刪除清單，回 cleanupPending，不謊稱磁碟已即時清除 |

AI 候選不是事實，原圖共享也不自動公開上傳者的私人提取候選；確認畫面明確說明原圖及已核對記錄會共享。提取受同一 Agent／模型配額控制，最多四次生成、八次工具及 90 秒；單張二進位大小另限；照片提取屬 interactive，全部文字、schema 及協定 metadata 使用同一 AI_AGENT_MAX_INPUT_CHARACTERS 上限（32,000–64,000，預設 64,000），不因此提高圖片二進位上限。模型只能交候選，不能建立任務或外發。

上傳／提取回應遺失先 GET 原 ID；確認／刪除查原 opId。未知結果不改新識別重做。未提交檔案及文字只留本頁，斷線保留，換孩子／帳號／Server、撤權或登出清理；重開不保證草稿恢復。原圖缺失／hash 錯誤不得宣稱成功。大小及 MIME 簽名檢查不是完整影像解碼或辨識品質證據。

<a id="p2-shared-inputs"></a>
## S12-W04 主動分享輸入

集合為 `/api/children/:childId/inputs`，共用 [型別](../src/shared/shared-inputs.ts)。登入及 `x-expected-user-id` 必須一致；每次核對家庭權限，只有輸入者可讀自己的原文／候選，其他家庭成員不能讀取，即使已產生共享記錄。

- GET 集合回 `{inputs,sources,canCreate}`，最多 50 項；GET `/:id` 回 `{input}`。來源清單只包含既有已核准、可公開非商業使用的 FHS 頁面，CHP／RTHK 未擴大使用範圍。
- POST 集合新增 `personal_source`：`sourceLabel` 非空、最多 200 字元；`sourceUrl` 可為 null，否則是最多 1,000 字元的 HTTPS URL、不含帳密；`sourceDateText` 可為 null、最多 200 字元；`sourceNotes` 最多 1,000 字元；`text` 最多 10,000 字元，網址或非空正文至少一項。適用自備訂閱／付費材料及一般私人來源；只有同意 AI 提取時才傳選取正文，私人網址／備註不傳模型。尚無正文時只保存來源，不能提取或確認成記錄。
- INT-W04：同一 `inputs/:id/manage` 以原 opId 收據提交 `expectedVersion / management / content / reason`。`management` 分開用途（回答參考／記錄候選／關注意向）、來源性質聲稱、時效原文、啟用及 `modelExcerpt`；null 表示未授權對話模型讀正文，非空須是已保存正文的連續原文片段。改正文或停用清除原片段授權及過時提取；另一次明確管理確認才恢復。content=null 保留原文，有連結家庭記錄時不可原地換來源正文。GET `inputs/:id/history` 只向本人返回最近 20 次管理版本／原因及 `hasMore`；歷史不供模型繞過現行授權。取得／提取 running 或 unknown 時先查核原操作。
- Agent `private_source_create / private_source_change` 候選使用同一建立／管理服務，接受、版本與重複確認沿既有持久候選協定；不需要家庭共享同意，也不因此建立家庭事實、訂閱或外發。背景不提供私人來源工具。`read_private_source` 只讀本人現行已授權片段（本次最多 6,000 字，過長請本人縮小，不能靜默截斷），引用以 `privateSourceCitations` 與公共引用分開；收尾重新核對版本、hash、啟用及片段授權。`private_reference` 只回述私人材料，不能代替育兒／安全建議的官方來源門檻。歷史回答的引用是當時私人快照，不聲稱仍為現行來源。
- POST 集合走原 opId 收據：`paste` 保存最多 10,000 字元原文、來源名稱、可選 HTTPS 來源網址及原始日期文字；`public_source` 只接受清單 sourceId。貼上的網址不自動抓取。
- POST `/:id/fetch` 須 `expectedVersion／confirmFetch:true`；`public_source` 仍限清單，`personal_source` 可取得本人提供的 URL；兩者共用既有 20 秒、1 MiB、最多兩次同主機 HTTPS redirect 的受限 transport。DNS 逐次只准公共 IPv4 並固定已核對地址，不接受私人網段、URL 帳密或非標準 port。私人頁面只解析 UTF-8 HTML，沒有 cookies／私人登入、JavaScript、PDF 或自動重試。保存解析正文、來源網址、日期文字、取得時間及正文 hash，不宣稱保留原 HTML 格式；解析正文最多 64,000 字元，超限拒絕而非截短；私人頁面不推定來源日期，保留家長所填日期並分開記錄取得時間。登入／訂閱提示頁不代表取得付費正文，家長須核對實際保存內容。
- POST `/:id/extract` 須 `expectedVersion／confirmModel:true／excerpt`；片段必須是已保存原文的精確非空子字串、最多 10,000 字元。長文由使用者選擇，不靜默截斷；共用 ADK runtime 限額。只有 `present_shared_draft`，不能寫事實、建任務或外發。
- POST `/:id/confirm` 走收據，須 `expectedVersion／confirmShared:true／kind／confirmChildFact／values`。`reference` 強制 note、沒有數值或事件時間；`family_record` 另須本人確認確與孩子有關。兩者均由家長核對正文；來源欄由 Server 注入類型、原輸入 ID、hash、保存時間及來源名稱。完整原文、網址／原日期及 AI 候選維持私人，不自動形成長期事實或任務授權。
- POST `/:id/delete` 走收據，須版本及 `confirmDelete:true`；刪除本人輸入及連結照護記錄。刪除連結記錄／孩子亦連帶清除輸入；共享記錄的更正由原 Care API 管理。

owner／caregiver 可保存／提取／確認自己的輸入；viewer 只能讀本人既存輸入。fetch／extract 在交易外執行，claim／結果均核對權限及期限；running 超時顯示 unknown，回查不重開，只有明確 failed 的當前版本可由使用者重試。來源快照 ready 後不覆寫；需要補正文時可由現有 UI 帶回來源資料建立另一份私人輸入，明示原項保留，不冒稱原地更新或持續訂閱。原 opId 未解決前不建立另一份輸入。一般網絡失敗保留當前草稿，換身份／孩子／Server 或撤權則清除，不建離線 outbox。

<a id="proactive-contact-http"></a>
## S13-W07 預授權主動聯絡

型別見 [contact.ts](../src/shared/contact.ts)。需 `P2_AGENT_ENABLED=true`、migration 019、渠道配置與 worker；功能 UI 不代表真渠道已驗證。以下前綴為 `/api/children/:childId/contact`，GET 核對本人及家庭可讀權；POST 僅 owner／caregiver，須經 S07 原操作收據、`x-expected-user-id` 及 JSON／Origin，直接 POST 回 428。

| 方法／路徑 | 行為 |
|---|---|
| GET 前綴 | 本人同意、本人可用綁定、合資格接收者、任務／授權、最近聯絡及渠道證據；每頁任務／聯絡最多 50 筆，超出有明示 |
| POST `/consent` | 本人同意／撤銷；expectedVersion、enabled、allowBackup、bindings、confirm；每渠道最多選一個綁定，次序即 fallback 次序 |
| POST `/tasks/:taskId/authorization` | 精確任務版本及授權版本、到期觸發、固定無家庭正文通知、跟進／fallback／後備對象及明確到期時間；首次最多 365 日，改期／轉派須重新授權 |
| POST `/attempts/:id/acknowledge` | 只可確認本人收到該次通知；不完成照護事項 |

綁定、本人同意、任務授權是三個獨立條件。授權固定主接收者為任務負責人；後備須本人另外同意及授權人明確選擇。接收同意或家庭權限版本變更使舊授權不能外發。模型只有 `read_contact_options`／`contact_caregiver`：後者只按 Server 提供的任務／授權版本及對象，在到期事件存在時原子入列；不能寫同意、擴大披露內容或提供任意地址。回傳台帳 ID，入列並不等於送達。

投遞前重查終態、來源、權限、同意、綁定、期限、worker 世代及通知偏好。僅明確拒絕可按已授權順序轉下一渠道／後備，最多四個綁定嘗試；unknown／已在途中斷不盲重發。普通通知按接收者本地日跨孩子合併，後續事項保留站內；`coalesced` 只表示沒有另發，不能推論首則成功。收到、渠道接受與照護完成分開；Telegram `contact:` callback 只在身份／事項匹配時記錄收到。來源／任務失效停止後續催辦；已在途外部請求不能保證撤回。

<a id="personal-model-http"></a>
## S06-W05 本人模型設定

所有路由需登入；GET／POST 均帶 `x-expected-user-id`，身份不符回 403。POST 沿用 Origin／JSON 檢查及 2 KiB 上限；不進 online opId／收據，不保留可重播的 key 正文。

| 路由 | 輸入／結果 |
|---|---|
| `GET /api/ai/settings` | 本人無密鑰 metadata、版本、平台／個人可用開關及分開用量 |
| `POST /api/ai/settings` | `ModelSettingsCommand`：expectedVersion、mode、可選 apiKey／removeKey、背景同意、dailyLimit、maxModelCalls、maxQueryEmbeddings、consent；只回保存後的 `ModelSettings` |
| `POST /api/ai/settings/check` | expectedVersion；只用已保存 key 做一次模型 metadata GET，回 accessible／unavailable，不代表生成／embedding／帳單已驗證 |

精確型別見 [model-settings.ts](../src/shared/model-settings.ts)。`platform / personal / disabled` 需明確選擇；personal 須同意費用及資料外送，背景另行 opt-in。key 不讀回。刪除必須 removeKey=true、mode=disabled，不可同時傳新 key；停用與刪除後不自動使用平台。

版本衝突回 409；保存回應失聯先重讀版本，由使用者核對，不自動重送 key。輸入框在送出／失敗／斷線／身份或 Server 變更時清除。存取檢查每帳號每分鐘一次，Server 最多保留四個當分鐘槽位；逾限回 429。

個人每日上限 1–1000（預設 100）、每次 Agent 生成 1–12（預設 4）、查詢 embedding 1–6（預設 2），UI 可編輯並經 Server 驗證。只有 personal 模式採用這些限額；平台每日配額及每次限額由管理政策控制，現行政策預設 8／4；這不覆寫個人已保存設定。工具與執行秒數由同一管理 policy 提供（未初始化預設 16 次／90 秒），平台／本人 key 共用；輸出仍固定 1024 tokens／次。互動上下文由 Server 的 AI_AGENT_MAX_INPUT_CHARACTERS 決定（預設 64,000、允許 32,000–64,000 UTF-16 邏輯字元）；個人設定不可提高此界限，背景仍為 32,000。GET /api/ai/settings 回應頂層的可選 agentInputCharacters 回傳實際互動上限，嚴格驗證範圍及整數；舊 Server 缺欄位時 UI 顯示「互動上下文上限未提供」，不可猜測新預設。每個運行固定選定版本，後續模型／向量／工具及回報重查；撤回不能取消供應商已接受的呼叫。

`/api/ai/status`、`/api/ai/usage` 依本人目前模式回報；設定頁同時列兩種來源。UTC 每日 00:00（香港 08:00）重置計數；生成與查詢 embedding 的嘗試均計次，用量 metadata 不代表完整供應商帳單。

<a id="int-concerns"></a>
## INT-W05 持續關注

共享關注是獨立的業務資源，與有限成長候選、MemoryTopic、任務分開；[精確型別](../src/shared/concerns.ts)。讀取依 READ_ROLES，寫入依 WRITE_ROLES，鎖後重核同一孩子及共享關聯。聊天與頁面均調用 ConcernStore，不另存可寫副本。

- GET `/api/children/:childId/concerns` 回傳同一家庭的 concern 清單、事件、目前跟進狀態及 `authorityVersion`。頁面／歷史以 ID、版本及真實歸檔時間投影，不靠標題配對。
- POST 同一路徑建立，POST `/concerns/:id/actions` 追加觀察、結束、恢復或設定一次站內跟進。寫入帶原 `opId`、`confirmShared:true`；變更另帶原版本及 authorityVersion。相同操作精確重播返回原收據，換內容不能沿用同一 opId；unknown 先查原對象及原操作，不新建副作用。
- Agent `read_concerns` 可查共享歷史；`propose_concern`／`propose_concern_change` 使用持久候選，接受時明確核對將共享的整理內容、時間及關聯，經同一 store 原子保存。私人聊天全文不自動共享；觀察不升格為已確認健康事實。
- 結束保留歷史與關聯，取消尚未執行的本關注跟進；不完成、取消或刪除相連任務。恢復回到結束前的 following，不重啟舊跟進。使用者另行明確指定未來時間才安排新的跟進。
- 背景 `concern_followup` 只在目前角色／版本／worker generation／storage epoch 有效時啟動；工具不提供外發或寫入能力。模型呼叫在交易外，使用同一 follow-up reference 防重；已知完成可讀回，unknown 不重新推理。結果連結實際 Agent run，站內回饋不代表發送通知或照護完成。

新關注由本人核對後屬家庭共享；背景回覆仍按原使用者的 Agent run 權限呈現。事件只保存共享觀察、操作與結果 ID，不把私人聊天／模型背景正文複製成家庭紀錄。外發仍須另有既有任務／渠道授權，不由本包擴權。

互動工具按當次及近期對話的任務載入：來源／關注、普通記錄／私人交代／提醒分組，不把全套工具 schema 塞進每次呼叫。這只決定本 run 可用工具，不授權執行；缺能力時如實說明或補問，不假稱成功。每個工具照常核對權限、原文及政策。模型上限不變，不靜默截斷必要的授權或協定配對；關注上下文保留完整事件並明示 historyComplete。


<a id="int-family-documents"></a>
## INT：家庭文件及同版 PDF

`/api/children/:childId/documents` 是多份準備文件及成長報告的唯一業務入口，與舊單份 VisitPreparation 分開。每次重查本人、目前家庭角色、孩子及 authorityVersion；owner／caregiver 可整理，viewer 唯讀。GET 清單／單項不呼叫模型或自動建立文件。POST 建立及 `/:id/actions` 帶原 opId；refresh／archive／restore／check_item 帶 expectedVersion。網絡未知只重查／重送相同原操作，不換 opId 或版本猜成功。

文件只整理已可家庭共享的 profile、記錄、有效確認事實、任務及關注；私人聊天／私人記憶／私人來源不自動進入。Server 按來源原 ID／版本組成內容，未記錄保持未知，未知事件時間不改成建立日期。有限範圍列 coverageNote，不將記錄整理當成診斷、能力判定或完整發展評估。四種準備用途保留；歸檔／重開及勾選文件項目不更動照護任務終態。

每次讀取及導出核對來源版本；已更正、刪除或失去適用性的原正文及依賴它的舊快照不得繼續披露。只有新增資料時可呈現有權讀的舊版並標待整理。首次生成標準報告後，持久 worker 按資料變更合併更新，沒有新資料不重建、不輪詢 Gemini；歸檔停止自動更新。

`POST /:id/pdf` 指定 snapshotId／snapshotVersion／authorityVersion、用途及來源／更新說明選項。Web 與 PDF 使用同一快照；生成後再次核權及核對來源才送回 `application/pdf`，`Cache-Control: no-store`。不靜默換版，不自動外發。現版只導出已共享文字；照片、私人聊天逐項匯出等更廣選項仍未提供。

家庭標準成長報告（kind=growth_report、purpose=family）同一孩子及相同 period.from／period.to 最多一份 active 文件。建立及恢復在既有 workspace 寫入鎖內重核；已有另一份相同期間的 active 標準報告時回 409 standard_report_exists，不以另一份資源冒充建立成功。同一原 opId 的合法重播仍返回原收據。不同年度／季度或其他期間報告可並存及歸檔保存；準備文件、其他用途及其他孩子不受此單一入口限制，不自動刪除或合併既有重複資料。

準備文件只因新增來源而 stale、且原快照仍獲授權及來源有效時，可以保留使用時版本直接歸檔；不要求先刷新。這不允許修改 stale 勾選或把它當最新版本匯出，也不繞過來源更正／刪除／撤權的正文遮蔽。刷新只沿用同一穩定 ID 且文字與來源關聯未變的核對項目，其餘項目維持未核對。

沒有觀察時間的現行持續關注仍列入成長報告正文，明示日期未提供；不把建立時間當事件時間。已知時間的來源仍依原文件期間篩選，PDF 沿用同版章節及來源。關注觀察依每條 observation 的原 ID／at 各自形成來源，按香港日期及指定期間篩選後才共用整體80項上限，不先只取最近5條或用最後一條日期代表整條關注。關注標題／理由清楚標示背景，不假作該次觀察。新增下一季觀察不得令上一季已有觀察因聚合日期而消失。

有觀察事件的舊版 concern:<id> 聚合來源只在讀取時用原算法建立臨時校驗投影，以原ID／版本／文字核對既有快照；不持久保存另一份資料、不放入新生成或新sourceBasis。舊來源仍有效時可按原同版讀取／PDF規則查看，但因來源模型更新而stale時須整理後才作需最新版本的操作；來源更正、刪除及撤權仍遮蔽。新觀察来源使用穩定 concern:<id>:observation:<eventId>，authority仍歸原關注資源，不放寬舊資料可見性。完全沒有觀察事件的關注保留原 concern:<id> 未提供日期來源及既有basis規則，不屬上述退役聚合。

Agent 透過 read_family_documents／generate_family_document／change_family_document 使用同一服務。初次來源整理保留用途／期間等結構化參數；P2-A03 以下述局部修改取代「所有正文只能由固定模板產生」的限制。真實資源 ID／版本及操作收據才代表已保存。

<a id="document-editing"></a>
### P2-A03：同一文件的局部修改與續讀

- 沿用 actions 與原 opId；新增 patch 動作，包含 expectedVersion、authorityVersion 及最多 12 個依序執行的 edits。所有修改在同一交易提交，任一不合法即整批回滾。只使用穩定 sectionId／itemId，不用畫面第幾行作持久索引，不接受可改權限／來源版本的任意 JSON path。
- edits 支援 set_metadata（title／summary／eventDate）、upsert_section、remove_section、move_section、upsert_item、remove_item、move_item；文字有明確上限，整份文件有容量上限。未提及內容、ID、核對狀態及來源保持；換文字或來源的核對項目回到未核對。增補內容不是新孩子事實或醫療判斷，引用只能指向當前獲授權的共享來源。
- 由本人直接在備援 API 提交的 patch 需明確 confirmShared；Agent 不可自行填 true 代替同意。Agent 僅移動／刪除既有項目等不增加披露的明確指令可經現有 writeDocument 直接執行；任何新增／替換正文、標題或摘要，先保存 family_document_change 候選，使用 A02 的綁定確認。候選列清文件、版本及逐項差異，共享範圍只限列出的整理；私人聊天原文、私人來源不隨之整批公開。接受時再次核對文件／授權／來源及原操作；可在聊天確認，不另建文件。 Server 在候選密文另綁 documentSourceBasis；接受前核對同一來源依據，不把舊候選文字自動套新來源版本。原文件或來源改變後，候選 public view 的 contentState=invalidated，正文／標題等遮蔽，原 ID／版本及真收據可保留；只能略過或重新核對，不能把遮蔽投影當作完整可接受內容。原加密候選不改寫。
- 修改過的章節與欄位標記為人工／Agent 指定內容，刷新及背景來源整理保留；已刪章節不自動長回。受保護內容的原來源更正／失效時，停止刷新並回 document_edits_need_review，不把舊文當新資料或靜默覆盖。讀取仍遮蔽失效正文，只提供無正文的穩定結構識別，供明確刪除／替換後重新核對。背景刷新遇此明確待核對結果，只停止該文件的 dirty 重試，保留原快照並繼續其他文件；新的相關事件仍可標記待更新。純結構修復若只餘 ageLabel 的失效 profile 依據，可保存仍被遮蔽的過渡版本，下一次明確 refresh 才以新 profile 更新年齡；不丟失依據或冒稱正文已可用。版本恢复只形成同一文件的新版本，原歷史不改。
- 清單及歷史採權限內 SQL keyset 分頁，游標綁本人／孩子／範圍／高水位，不以首頁表示全部。歸檔不佔用 50 份 active 文件額度；恢復同樣核對 active 上限及既有標準報告唯一性。
- 指定文件讀取，以及成功建立／修改後的工具收據，可在同一授權版本、同一文件／快照且完整JSON符合工具回覆預算時附上authorityVersion及完整snapshot，contentPartial=false；短文件不必額外分段再讀。超出預算或正文失效則保留有界目錄／續讀位置，contentPartial=true，不截斷冒充完整。寫入已成功但後續describe失敗、撤權或版本已變時，收據仍如實保留已保存ID／版本，readRequired要求查原資源，不把後續讀取錯誤改報為寫入失敗或誘導新op重做；不返回未重新授權正文。
- 工具先取得文件目錄與 snapshotId／snapshotVersion，再透過 read_family_document_content 依固定版本和 offset 讀每次最多 4,000 字元的快照 JSON；回傳已讀範圍、totalCharacters、nextOffset、complete 及 contentKind。有效正文為 snapshot_json；失效正文只可讀 redacted_manifest_json，僅穩定結構識別與必要版本，不含標題、摘要、正文或來源原文。complete 只指該 contentKind 讀完。目錄工具的章節概要亦有界，manifestPartial 明示未列齊，不在每段正文重帶完整目錄。不得因超過舊 7,000 字元限制而只返回空正文。中途換版不能拼接不同版本；歷史版本以 list_family_document_versions 的游標選取，再按同一固定版本讀取，當前權限及來源有效性仍適用。
- HTTP 清單可帶 cursor；新增 /:id/content 與 /:id/versions 唯讀入口，共用工具與頁面的資料服務。範圍錯誤、權限失效及資料庫故障不偽裝成沒有資料。前端仍以閱讀、核對及對話整理為主，不改設計或另建可寫副本。

實作沿用現有 typed actions／PostgreSQL 收據與版本交易；參考 [RFC 6902](https://www.rfc-editor.org/rfc/rfc6902) 的序列修改與失敗中止語義，並不宣稱提供其通用 JSON Patch 協定。任意 path／陣列位置不能代替本項目的穩定識別與來源控制，故無須引入通用 patch 引擎。2026-10-08 文件已核對，實作驗收按 A03 證據另記。

<a id="p2-agent-service"></a>
## P2 增補接口邊界

本節為後續工作包的必要語義，不宣稱新增 HTTP 路由已實作；具體 wire 型別隨各包接既有服務。產品及驗收見 [SPEC](../SPEC.md#p2-agent-service)。

- **能力目錄／載入：**Server 依入口、身份／授權及事件核定可用集合，提供簡短能力描述及核心讀取／搜尋／結果工具；模型以原生 function calling 選擇所需集合，再由 ADK 繼續循環。不得以最後一句／延續詞 regex 篩掉能力。載入不等於授權，任何未知／非法工具仍拒絕並計入上限。
- **工作／歷史／原文讀取：**接受受權資源 ID、查詢及有界游標／範圍；返回實際資源版本、已讀範圍、完整度、續讀位置及限制原因。授權／資料庫錯誤與成功空結果分開。通用工作保存目標／焦點／問題／資源／結果，不另造任務副本或固定流程。
- **操作／確認：**沿 expectedVersion、operationId、原訊息／工具及收據。跨輪確認必須能核對原提問、使用者回應、參數／對象及資源／授權版本；模糊、多候選、取消或舊版返回需要重新核對，不能由 confirmed:true 放行。相同已提交操作返回原收據；unknown 先查原操作，取消不宣稱已撤回外部接受結果。
- **文件讀寫：**提供目錄／穩定節點 ID、固定版本範圍閱讀及局部新增／替換／刪除／移動。寫入含 documentId、expectedVersion、opId、具體 patch；交易核對後回傳保存版本與變更片段。版本衝突讀回再處理，不整份覆蓋；沒有讀全須明示。歸檔／歷史分頁，恢復沿原文件新版本。
- **知識搜尋／擴讀：**query 保留必要語義及未知精度，Server 決定適用／權限過濾；SQL 先篩選排名及有界取回，RRF 去重。回傳穩定來源／片段／版本、章節頁碼、適用條件、核對及發布狀態、降級／不完整狀態及可續讀位置。同版本上下文擴讀也有界。引用須指實際返回的支持片段；embedding 失敗的關鍵詞降級不算向量驗收。
- **範圍及衍生輸出：**讀取、摘要、文件及背景任務均核對來源／目的地，保留 coverage／版本／可見範圍；私人材料不擴至公共或共享。更正／撤權／失效時刷新相關 owner／候選／報告狀態；metadata 更新不能成為另一份正文權威。
- **成長／報告：**日常讀取不生成；完整期間工作回傳固定期間、分批進度／coverage、來源版本及同版 PDF 引用，部分結果不稱完整。期間資料增多不以總數超限全失敗，也不隱藏未知日期。
- **帳戶／資料退出：**保留驗證／找回／會話原生機制，目前 Better Auth、目標改 [Firebase adapter](#firestore-target)；邀請單次資格與本人資料空間分開。下載／刪除需本人身份及相應具體確認，返回可追蹤狀態與保留政策；不在對話或模型參數傳 key／找回憑據。
- **成本與結果：**讀取、工具載入、模型補查／修正／收尾仍在既有 run 預算；完整 HTTP／工具協定不靜默截斷。超限回傳已提交／未完成／unknown 與可接續工作，不自動新 run 或提高配額。前端只根據正式收據與目前資源顯示成功。

<a id="persistent-agent-work"></a>
### P2-A02 實作邊界：工作、原文及對話確認

沿用原私人聊天、memory、proposal 及業務收據。新增本人／孩子範圍的工作保存目標、焦點、待答問題、原訊息引用、相關資源與待確認引用；它是模型整理的恢復資料，不能取代事實或任務終態。更新帶工作版本及原操作 ID，服務重啟後可查回，取消使該工作的未確認綁定失效；背景不自動取得私人工作。

- **有界歷史與原文：**先 SQL 限定本人／孩子／資料類別及 keyset 頁，再解密有界資料；加密正文暫用有界掃描而非另建明文／公共索引。回傳掃描範圍、命中、完整度與續讀 cursor；查詢未掃完不說不存在。原文按訊息 ID＋範圍續讀；role 保留，模型回覆不能當本人陳述。記憶採分頁及有效性核對，不因超過一批便拒絕整個對話。
- **多輪來源：**普通操作仍必須引用當前指令；可附最多六項已授權舊使用者訊息的逐字來源，補足日期、對象與內容。Server 核對本人／孩子、原文、時間先後及來源版本；引用歷史只補資料，不構成再次執行舊指令或新的共享／外發同意。歷史原文和工作都是不受信資料，不能覆盖工具規則。
- **事實更正：**Agent 讀回具體 fact／version，提出 revise 或 deactivate 候選，接受時用原 MemoryStore 交易處理；重要事實不直接自動更正。私人／共享範圍不擴大，原來源與歷史保留，更正使依賴摘要重新核對。
- **對話確認：**從一項既有 proposal 建立具體確認請求，綁定 proposal／參數摘要、目標／版本、當前授權／政策版本及期限。Server 產生完整具體問題，隨真正保存的 assistant 訊息綁定；不是模型自報已問。只有該問題為緊接上一則訊息、唯一有效候選、回覆為完整而無附帶更改的明確同意，才可沿原 decide 交易接受。此窄同意識別只保護確認，不篩選 Agent 可用能力；其餘說法交模型理解並重新列明或使用現有具名確認入口。多候選、已取消、過期、跨孩子、版本／權限／政策變更都不能以一句「好」執行。共享目的地須由 Server 問題明示；永久刪除不加入此快捷確認。
- **重試：**綁定的本人回覆訊息、原候選及原操作識別共同去重，未知先查原結果。有權讀取的過期候選保留重新核對入口，不自動延長或換新候選繞過失效。

實際接點沿 `/api/children/:childId/agent`：`GET /work`（cursor）及 `/work/:workId` 查本人工作；`GET /history?kind=message|private_instruction|memory_fact&query=…&cursor=…` 查有界歷史；`GET /history/messages/:messageId?offset=…&limit=…` 續讀同一原訊息（每次最多 4,000 字元）。維持 session 及 `x-expected-user-id`；工具與 HTTP 共用 store，不另建可寫頁面副本。工作每頁最多 10 項、歷史每頁最多掃 100 項／回 10 個命中；游標綁本人、孩子、類別、查詢及本次最高建立位置，新增訊息不改先前掃描範圍。記憶命中只是定位，當前適用性須讀回原事實核對。

`save_work` 使用 `operationId／workId／expectedVersion`，每個 run／call 與原操作皆防重；`request_confirmation` 指向既有 `runId／proposalId／expectedVersion`，可綁 `workId`。新 `memory_fact_revise／memory_fact_deactivate` 候選由 Server 讀出 `targetVisibility`，前端不可猜測分享範圍。確認成功的實際收據加入當輪結果；後续模型或文字收尾失敗仍保留已成功操作，不重做。

工作來源與取消的窄守衛補充：`sourceMessageIds` 只接受同本人／孩子、`role=user` 且 `author_user_id` 為本人的原訊息，仍受目前 run 原訊息的時間截止限制；模型訊息可按原 role 查閱作上下文，不能列為本人來源。空來源陣列的既有規則不改，亦不以歷史來源取得新操作授權。原工作已 `cancelled` 時，新寫入不得改為其他狀態，返回 `409 work_cancelled` 並保持原版本、收據及 changes；仍為 cancelled 的既有更新不因此新增限制，completed 的轉換政策不在本次擴改。相同原操作／內容的查回仍返回歷史結果，不能解讀成當前工作已恢復；不同內容仍衝突。沒有同 ID 的恢復協定；只有本人明確的新交代才可另建工作，不自動以新 ID 繞過取消，原取消紀錄保留。

完整前端呈現由 A07 接回同一 owner，不在 A02 重做介面。

<a id="p2-a05-reports"></a>
### P2-A05：完整期間與日常成長成果

沿用同一 documents create／refresh、原 opId、expectedVersion、authorityVersion 及固定 snapshot 的 content／PDF。growth_report 可選 reportMode=fixed（省略時沿用）或 living；living 的起日保留使用者指定、止日隨香港當日延展，固定季度／年度由實際起訖分類，不由標題猜測。準備單不接受 reportMode。建立或 refresh 只做有界的一批，剩餘工作保存並由既有文件 worker 接續；重試原 opId 不多處理一批。讀頁無副作用、不呼叫模型。

FamilyDocument.report 回報 building／complete／needs_update、已掃來源數、期間、模式及來源修訂；building 不代表全文已完成。DocumentSnapshot.reportCoverage 只在所有來源頁完成後保存，含完整掃描數、期間內各類記錄筆數、未知日期筆數、任務／共享關注觀察／有效確認事實數及必要有效期。完整是目前已保存資料的覆蓋，不代表孩子生活全部發生過的事，無記錄不等於未發生；正文可以只展示清楚標示的有限重點，不能把選錄數當總數。

資料或授權改變後先遮蔽失效聚合，不能從舊收據、歷史、分段或 PDF 讀出已失效原文。更新／歸檔沿同一文件；自動刷新保留 A03 指定修改，不能覆蓋人手內容。處理途中來源改變會重新建立該來源修訂的進度，不拼接不同版本；來源長期變動時如實保持未完成。

<a id="p2-a06-continuation"></a>
### P2-A06：工作跟進與真實結果

save_work 的可選 followUp 包含 reason、dueAt（可空）、watchResources 及最多4個 knowledgeSourceIds；只有有用、具明確依據的工作才設定。省略／null 或工作終態會停止該工作的新跟進；時間不明不捏造，普通提醒及外發仍走既有任務／授權服務。Server 核對所有引用、已發布公共官方來源、本人／孩子及目前權限，保存既有資源版本作比較基線。知識內容含義未變只更新基線，不以抓取／排程／重啟時間製造新原因。

背景先提供全部有關工作 ID／版本與有界摘要（總 context 至多3500字元）；省略正文、引用詳單或其他欄位須標明，可按工作 ID 續讀，不能把摘要當完整讀取。私人背景沿既有 ADK 原生載入器按需提供只讀能力，配方只組裝已有安全、知識與主動跟進模組；互動與任務外發配方保持原範圍，不增加32k／4次生成等上限。

read_work 可附 latestFollowUp 的 eventId、runId、state、createdAt；read_background_result 透過既有本人 run 讀取入口回傳有界結果／引用，不將模型回覆當成新的同意或已確認事實。queued、completed、stopped、unknown、cancelled 分開，未知不能重新生成。私人變更事件只通知本人 owner；正式頁面由 A07 接回同一工作及結果。

`latestFollowUp` 的 `eventId／runId` 可能連到合併多項工作的同批跟進事件，並非逐工作執行收據。現有 queued 事件會按目前工作版本／有效性投影 cancelled；事件終態仍保留原同批結果，completed 不能證明每項工作均曾執行或完成。取消後的工作卡優先顯示「此工作已取消，不再接續」，關聯狀態為 cancelled 時列明「此工作關聯接續」，其餘列明「同批跟進事件」，Agent 讀取亦遵守這個分界。cancelled 可能只是仍排隊同批內本項的失效投影，不代表整批已取消；亦不代表仍 active／waiting 的工作本身已取消。沒有逐成員 outcome／取消時間權威，不能用目前 status 或 updatedAt 推斷取消先後、改寫取消前已完成的歷史事件，或將另一工作成果冒稱為本項成果。上述已交付切片只更正呈現與讀取指引，不改 DTO、事件台帳、排程／取消策略；精確逐工作 outcome 仍未提供。

**F01 待實作：逐工作起始輸入證據。** 只回答「原背景 run 已提交的起始輸入快照是否包含此 work 的原版本」，不是執行／完成收據。`included` 不證明 provider 已收到、模型已讀取或工作已完成；`not_included` 只指未進起始快照，不排除其後經授權的唯讀工具讀到該工作。run 的 completed／stopped／unknown、目前 work 終態及原業務收據繼續各自為權威；本證據不新增背景寫入能力、不重播未知結果。

擬以 `GET /api/children/:childId/agent/work` 及 `/work/:workId` 的 `followUpEvidence=1` 明確 opt-in，在同一 `latestFollowUp` 加可選 `participation={state,workVersion}`；`state` 為 `included | not_included | unknown`，`workVersion` 是該 event 的原候選版本，不能偷換成目前工作版本。證據沿同物件的 `eventId／runId` 綁定，不另找最新 run 或跨事件拼接。省略 opt-in 仍回原 shape；既有 strict DTO 不可直接加欄位，新 client 必須可處理舊 Server／未回欄位並顯示未知，不從 batch completed 或 cancelled 補猜。`read_work`／前端消費者須在相應 reader 與相容解析接好後才使用；本段 query、欄位及消費接線目前均未實作。

Server 只有已授權、成功讀取，並從原 event 已驗證的持久格式／版本確認為舊格式且缺起始快照，才正常回 `unknown`；不能依建立時間、目前 status 或單純缺欄位猜測。新／舊格式辨識須受原 event 的加密完整性及格式驗證保護，移除快照欄不能把新格式降格成歷史資料。缺欄位的 client 未知顯示不是新的持久證據。無權、讀取／解密失敗、未知格式、壞綁定或不完整證據均 fail closed，沿原錯誤路徑停止，不當作 `unknown`／`not_included`。`not_included` 必須來自原完整有界快照的明確排除；若同一原子提交確認全部候選排除且未建立 run，才可伴隨 `runId:null`。新事件仍排隊、尚未 claim 時不捏造分類，保留原排隊狀態及省略欄位；已 claim 的新格式事件缺快照則屬錯誤。

取消先於 claim 提交的版本不能 included；claim 先提交則保留 included 歷史，後續取消／改版／撤權仍使舊 context 依原 dataVersion／授權守衛停止，不能拿歷史證據繼續生成。晚到結果不能把 work 改為完成，也不承諾撤回已在途 provider 請求。原子選入、加密及清理閉包見[資料契約](DATA_MODEL.md#p2-a06-continuation)；不得以現時 status／updatedAt 重建歷史。

關注容量沿 draft #111 的受檢邊界：普通事件200、另兩格只供結束跟進／歸檔；029遷移收據成立才寫201–202。到頂仍可取消／結束，不能刪歷史騰位；滿額恢復／新增普通事件仍拒絕。部署须先更新相容 API／worker／Web，已有保留格資料後不可回退200讀取器或縮窄SQL限制。


<a id="p2-a08-service"></a>
### P2-A08：邀請資格、本人資料與退出

沿Better Auth原生註冊、電郵驗證、找回密碼及會話API；營運者以指定電郵授予有限期註冊資格，資格不加入別人的workspace。正式invited模式須具可用SMTP設定，新用戶驗證電郵並確認當前資料處理說明後才可使用業務API；原逐項模型／照片／私人來源／外發授權仍有效，不以一次確認擴大使用範圍。未啟用模式保留原合成試用相容，不等於已開放真實資料服務。

GET /api/account 回傳模式、資料政策、本人驗證及確認狀態；POST /api/account/acknowledgement 帶policyVersion／accepted／operationId。原生找回後撤銷全部舊會話，使用者亦可主動撤銷其他會話。驗證／找回URL以原生期限及同源目的地校驗，固定電郵經加密outbox及既有queue送出；queued／accepted／failed／unknown分開，未知不自動重發；客戶端只說已受理請求。

本人下載由固定白名單的有界資料頁／既有安全讀取器提供，標明scopeVersion、section、已讀／未讀及nextCursor；身份、權限或資料版本改變則停止該次下載重新核對，不把前綴當完整。只包含目前仍有權查看的本人／孩子資料及可追溯成果，私人來源／聊天不混入別人資料；不下載密碼、會話、API key、通知token或其他人的私人內容。照片透過原有受權限保護的讀取，不公開儲存目錄。

永久刪除先POST /api/account/deletion/prepare（原operationId），保存短時效範圍及回覆收據能力；再POST /api/account/delete，帶同一operationId、receiptToken、完整「永久刪除我的帳戶」及由Better Auth核對的本人密碼。直接原生deleteUser保持關閉，不能繞過業務清理。未知結果以同一收據查回，不換新op；已刪帳戶的收據只顯示處理狀態，不披露身份或正文。

單人帳戶刪除本人workspace／孩子及附屬私人內容、key、渠道、會話；其他workspace只撤去本人成員及連帶本人內容，並使既有來源／版本重新核對。本人仍擁有其他使用者參與的共享workspace時先明示阻塞，避免暗中刪掉其他成員資料；多人轉移不列本輪單人門檻。照片實體清理與資料庫刪除狀態分開。

下載入口為 GET /api/account/export；固定section、childId、scopeVersion及加密cursor由 manifest 引導，不接受表名／SQL。收據查詢為 GET /api/account/deletion/:operationId，以 x-erasure-receipt 傳能力token；不放URL或日誌。短時效prepare收據綁原範圍；登出／切換身份清掉瀏覽器暫存，未知提交在同次會話沿原收據核對。


<a id="p2-a07-library"></a>
### P2-A07 正式歷史及參考讀取

正式歷史沿A02工作／訊息原文cursor、各領域原清單與修訂API；通知沿A08本人notification_deliveries安全分頁，只代表本人渠道／聯絡／驗證信的投遞metadata，不冒稱全部屬當前孩子。搜尋及日期篩選須標示已掃範圍與續讀位置，不能以未載入當不存在。私人工作是Agent保存的目標／焦點／問題，不稱模型內部推理或完整run context。

新增 GET /api/children/:childId/library?cursor=… 為唯讀公共來源目錄；核對session、expected user及孩子現行存取後，以sourceId keyset每頁最多10項。cursor綁本人／孩子及權限版本；只返回目前enabled、reviewed、published、未過期且符合既有watch／observation及公開使用範圍的版本metadata（sourceId、versionId、title、publisher、url、classification、checkedAt、sourceUpdatedAt、validUntil），附nextCursor／complete。目錄不判定每份內容適用該孩子，也不將來源存在當作支持某句回答；不返回私有来源、不呼叫模型或embedding。


<a id="firestore-target"></a>
## 原 VM 上的 Firestore／Firebase 接口差異

以下為 F01～F08 的遷移契約；已接線範圍見下方 F01 及 PLAN，不宣稱所有路由已完成。保留 Auth／AccountServiceOwner、原操作／版本、history／run／proposal 語義；原 VM／Caddy 供應同一前端，不允許瀏覽器直接讀寫 Firestore／Storage。

### 登入及安全 session

- 登入、驗證、找回及最近重新認證改 Firebase provider；正式 Server 驗 token 的 issuer／audience／期限／撤銷後才交換受保護 session。沿已有受保護的同源 __session cookie，HttpOnly／Secure／適當 SameSite、origin／CSRF 與 x-expected-user-id 防護保持；不把 client 傳來的 uid 當授權。
- Server session 同時核對每裝置 ledger、帳戶准入／政策、epoch 及 Auth 有效性。登出撤銷本裝置、撤銷其他或全部裝置沿原產品語義；Firebase 全用戶 revoke 不能代替逐裝置操作。私有 API 與錯誤／認證回應禁止 CDN 共用快取（private, no-store）。
- 邀請檢查在 Identity Platform blocking function 及業務准入交易各有責任；Auth 已建但業務未完成時不開放資料，沿同一身份恢復。依 ADR-022 重新建立受邀 Firebase 帳號，不匯入舊身份／私人資料；舊 cookie 不被新系統接受。新帳號建立後身份與資料關聯保持。
- 帳戶刪除由最近 Firebase 重新認證的 Server 可驗證證明替代 Better Auth 密碼核對；保留具名確認、原 operationId、範圍版本、短時效 receiptToken 及 unknown 查詢。模型不能觸發裸 Auth delete 繞過業務 journal。下載／退出、viewer／caregiver／owner 及私人資料邊界不變。

### 現有互動與持久工作接點

- 保留現有 message／trigger、operation 及 run 關聯和可用請求協議，不因 Hosting 限制強制改聊天為 202。須排程的工作先通過准入／權限／成本檢查，交易建立唯一 run／outbox 後才可回 202＋runId＋原操作關聯；202 只代表已受理。
- 相同原操作重試返回同一 run；不同 fingerprint 拒絕。逾時先查原受理／收據，不自動換 opId／runId。模型呼叫時仍作持久配額預留，排隊不能繞每日限制。
- 沿既有本人／孩子 run 結果接口有界取得進度、工具收據、引用、候選及 terminal／unknown；等待／重連沿同一 owner，不複製為另一份聊天或任務。實際 route／typed DTO 相容對照在 F01 固定，不能把新路由當已存在。
- 取消保存於同一 run，worker 每階段檢查；已提交的工具效果不因取消或收尾失敗回滾。頁面關閉不代表取消；長期未完成工作與待確認仍保留，重新登入可查回。無權、過期版本及 unknown 不偽裝空結果。
- API 副本可互換：准入、限流、session 撤銷、每日及根預算、原收據與取消使用共用持久權威，前端毋須指定 instance 或黏性會話。另一副本接受取消後，執行者在模型／工具與提交邊界核同一終態；已提交效果仍按原操作查回。busy 與已受理／unknown 分開，不能引導重做已存在效果，細節見 [多副本契約](ARCHITECTURE.md#firestore-multi-instance)。
- Tasks／Scheduler 送至原 VM 的受驗證入口；應用校驗 OIDC 簽章、issuer／audience／期限及固定服務身份。payload 只帶穩定參照／generation，不帶 prompt、附件正文或憑據。Caddy／API 期限依現有有界 run 協調，不提高模型預算；取消及 unknown 恢復沿同一操作。

### 業務、附件及恢復

online 操作的 expectedVersion、accessVersion、storageEpoch、opId／fingerprint 與收據狀態保持；changes cursor 仍按 workspace、本人可見性及固定頁返回。資料庫語法不是 wire contract；移除 SQL join 不取消原篩選、分頁或未知提交恢復。

附件維持預留／完成／授權下載語義，完成時由 Server 查實際 generation／hash 才回 ready；下載及 PDF 再核對孩子／本人／來源有效性，不返回永久公開 URL。資料搬遷保留穩定 asset/document ID，不要求頁面記住雲端路徑。

恢復環境在最新刪除 journal、現行 Auth／撤銷、附件與 epoch 核對前不接受一般 API／Agent／通知。維護狀態明確返回暫不可寫／未完成，不偽造成功；重新開放時舊 cursor／session 必須重新取得，原 opId 仍用於查已保存效果。

<a id="p2-agent-roles"></a>
## 四角色、編製及知識維護接口

依 [ADR-024](DECISIONS.md#adr-024)，P2 只留角色識別、啟用狀態、模型／prompt 模組、工具權限與輸入輸出契約，沿既有 AgentRuntime／ModelGateway 的身份、根操作、取消及預算。下列角色內部流程由 [P3-M01～M03](../PLAN.md#p3-agent-roles) 實作；未啟用角色不得實例化、暴露工具或回假成功。不是新增四套公開 API，不取消已有產品工具及程式校驗。資料不變量見 [DATA_MODEL](DATA_MODEL.md#p2-agent-roles)，編排見 [架構](ARCHITECTURE.md#p2-agent-roles)。

- **委派：**Server 將根 run／原操作、允許角色、身份／範圍、用途 schema、來源參照、版本及剩餘預算傳給子執行；模型只能提交受限任務參數，不能傳任意工具、prompt 路徑、服務身份或權限。輸出沿父子關聯回原流程，子角色不可再委派；子模型、委派／子工具及失敗均計根上限。
- **編製：**接收授權資料參照及新增／局部修改意圖，返回符合目標領域 schema 的 draft／patch、缺項、來源／coverage 及所需確認；正文／段落／項目按穩定 ID 修改。直接普通操作沿原 API，不必呼叫編製；任務、記憶及文件的保存仍呼叫其既有服務，不由聊天文字或 actionRequests 二次執行。
- **審核：**Server 提供草稿與原始證據，唯讀 Agent 返回 pass／revise／insufficient_evidence 及有界問題／支持依據。程式先驗 schema、來源身份／有效性與 scope，回傳後再驗審核綁定；生成者不能提交可採信的 approved／免審標記。使用者確認及審核是兩個獨立條件；必審內容須同時符合審核、當前授權及業務 gate 才正式呈現／提交。
- **提交與恢復：**帶原 opId／fingerprint、目標 ID／expectedVersion、草稿 hash、來源與授權版本及 Server 審核參照；交易重核後回真資源版本／收據。衝突返回現行版本及重新核對需要；回應丟失先查原收據，不換 opId。逾時、取消、審核失敗或待確認分開回報，草稿不冒稱正式保存；已成功操作的真收據可獨立回報。
- **待確認狀態回覆：**互動回合只回報操作、沒有引用時，Server 可查回該本人／孩子／run 的唯一有效確認問題，用固定「已準備待確認、尚未執行」取代模型措辭，再由原 API 附上權威問題。這句確定性狀態毋須再呼叫審核模型；沒有有效問題、來源建議或模型自稱已準備，均不能藉此免審。編製內容的原審核、接受時的版本與授權檢查維持。
- **獨立知識維護：**受信管理／排程入口傳已核准來源 ID／scope 版本及持久工作關聯，沒有家長聊天或私人 key。站內查閱／取得工具逐次校驗 URL、redirect、路徑、附件及批次上限，返回原檔／章節頁碼、抽取方式、完整度和續讀位置；未核內容不經一般聊天搜尋返回。發布工具重核內容／來源版本、語義審核及規則影響資格後原子更新；疑義保持候選，不讓 Agent 自行批准擴大來源或醫療規則。
- **客戶端投影：**沿既有持久受理／run 結果接口，提供必要的編製中、核對中、待確認／修正、未完成及已保存結果，附可授權讀取的草稿／資源／版本參照。具體 wire 狀態隨包相容擴充，不直接改歷史狀態 enum。只顯示核准正文與真實進度，不回傳內部推理、子模型協定、未核串流或私人證據全文；身份切換／撤權清理保持。

背景候選 runner 的 `liveFetch=false` 只可使用明確注入的離線 `fixtureFetch`，缺少便回 `background_knowledge_fetch_disabled`，不呼叫網絡 port。PDF 的頁窗、完整頁碼及抽取 metadata 由程式在比較／審核前核對，模型回傳通過不能覆蓋這些條件。同一來源版本及排程 occurrence 的 fingerprint 不包含 worker generation，換 worker 不能取得新工作預算；排程 occurrence 由受信台帳產生，不由重試時間生成。

現有背景 port 尚未具備原子 fencing 的發布交易，要求 live 發布固定回 `not_enabled / background_knowledge_live_not_connected`，不啟動抓取／模型／發布。完成接口須在同一權威交易核對持有者、lease／generation、預算並提交發布指標及收據；分開的 `claimOperation`／`saveBudget`／`publish` 不能當作此保證。離線候選、程序檢查替身及真模型審核分開表示，具體完成狀態只見 PLAN。

<a id="firebase-foundation-auth"></a>
## F01 Firebase 身份與正式組裝接點

STORAGE_BACKEND=firestore 經 server/main.ts → firebase-main.ts／firebase-runtime.ts 組裝真 Admin Auth、指定 database 的 Firestore、加密 authority 及裝置 ledger；不注入 fixture／SQL 權威。DATABASE_URL／BETTER_AUTH_SECRET 只屬切換前舊分支。Firebase 路徑要求明確 GCP_PROJECT_ID、FIREBASE_DATABASE_ID、FIREBASE_NAMESPACE、唯一密鑰來源（Secret Manager 固定版本注入的 YUBAN_FIREBASE_STORAGE_KEY 或保留嚴格權限的 STORAGE_KEY_FILE，不可同時提供）與同源 SERVER_ORIGIN／WEB_ORIGIN；production 禁 Emulator。

| 接點 | 行為 |
|---|---|
| POST /api/auth/session | JSON 只有 idToken；原生 Admin 驗 token、revocation、近期 auth_time（5 分鐘）、目前 user 與邀請，再建立 5 天 __session HttpOnly／Secure／SameSite=Lax cookie 與持久裝置 ledger。已有另一身份必須先登出；有 session 的交換必須帶相同 x-expected-user-id。 |
| GET /api/auth/get-session | 保留既有 user.id/name/email 或 null；暫時 Auth／資料庫錯誤回 503，不能冒充已登出清走使用者草稿。 |
| POST /api/auth/sign-out、/api/auth/revoke-other-sessions | 同源、JSON 空物件及目前 x-expected-user-id；登出撤銷本 cookie，另一接點只保留當前裝置，不能以 Firebase 全帳戶 revoke 假裝完成。 |
| GET /api/account、POST /api/account/acknowledgement | 沿現有狀態／policyVersion／operationId schema；同意必須已登入、同源與 expected identity，authority 同交易核 verified、邀請及原 receipt。mailConfigured 由 FIREBASE_AUTH_EMAIL_ENABLED 明確開啟；僅在原生 provider／測試站 origin 配置讀回後設 true，未設或 false 為關閉，其他值拒絕啟動。這表示可以由本人明確提出原生驗證／重設請求，不證明郵件送達；真寄信及本人確認另按驗收記錄。 |
| GET /healthz | 只表示程序在運作與 foundation 階段，不表示已查 DB、F02 通過或完整服務可用。 |
| 其餘尚未移植 /api/* | 明確 503 firebase_domain_not_ready，舊密碼端點回 auth_provider_transition_required；F02／F03 接原生身份 UI 與產品路由，不能當永久縮減功能。 |

所有私人回應 private, no-store；Web 變更請求核確切 Origin；原生請求只走下列[明確憑據協議](#native-session)。身份 body 上限 16 KiB，Node 入口整體上限 64 KiB；後續附件依原規格另作有界傳輸，不能沿此限制截斷產品照片。Server 部署以 attached identity/ADC 存取服務，不下載長期 key。

<a id="native-session"></a>
### Android 共用會話 transport

S04-W01 擴充身份接線，不建立手機專用業務 API。Web 保持 HttpOnly `__session`；Android 以同一 Firebase JS Auth 的 ID token 向 `POST /api/auth/native-session` 交換 `{user,credential,expiresAtMs}`，JSON 仍只含 `idToken`，帶 `x-expected-user-id`。Server 沿目前身份、邀請／准入、近期 `auth_time`、有效期及逐裝置 ledger 核對；回應不設 Cookie。既有其他身份必須先登出，不能以交換更換其身份。

Android 之後用 `Authorization: Bearer yuban-native-v1.<credential>` 呼叫同一 API。憑據只進 SecureStore，不進聊天、業務資料、一般日誌或雲端備份。原生 ledger 使用獨立 hash 前綴；不能將 Web cookie 改裝成 bearer。Server 每次重核 Firebase 有效性／撤銷、產品准入及裝置台帳；`get-session`、`sign-out`、撤銷其他裝置、近期重認證沿原接口及語義。

原生路徑拒絕同時帶 Cookie、Origin 或瀏覽器 Fetch Metadata；Web 不因此放寬 Origin／CSRF。Node 的 request-shape 檢查只決定是否進入身份層，不能代替 credential／孩子權限檢查。管理 API 不接受原生憑據。所有私人回應 `private, no-store` 並以 `Cookie, Authorization` 分隔。

共用 owner 向各領域 client 注入同一 transport；原生只允許指定 HTTPS origin 的 `/api/`，不傳 credentials 至重導向或另一站。上傳、下載、JSON 及 SSE 同一身份路徑；業務 body、版本、`opId`、unknown 查回及取消不改。暫時錯誤不當登出，斷線不重發操作；登入交換只在目前 generation／signal 仍有效時保存憑據。未設定有效 Firebase provider 時原生入口失敗關閉，不回退舊密碼接口。

operator CLI firebase:control 接受 initialize／invite／revoke-invitation 及 stdin JSON，復用正式 authority；set-enabled 復用既有恢復控制的 expectedGeneration／新 generation／enabled 比較交換，不能沿舊 generation 啟用工作。不在公開 HTTP 提供管理後門、不輸出電郵或 token。Identity Platform blocking function 在 F02 部署，必須調同一 invitation authority；SDK 已有接點不能當 blocking function 已啟用。

F02 的孩子／事項沿既有 GET /api/children、GET /api/children/:childId/tasks（含單項／history）及 /api/online/* 協議。建立／更改仍經 context／原 opId submit，不開無收據的直接寫入旁路；children 回 children 與 nextCursor，client 讀完整分頁才展示，不以首 50 項當全集。cursor 綁本人／workspace／epoch／changeSeq，中途改變回衝突，身份改變不回傳前一身份頁面。尚未組裝的領域維持明確未就緒回應，不返回合成空結果。

<a id="firestore-core-chat"></a>
### F03 核心資料與聊天接點（本包接線，部署／驗收另記）

`firebase-runtime` 組裝 Firestore 的照護／孩子 profile、記憶、聊天、產品 run／工作／候選／確認、直接操作、模型設定及共用用量。保留原 API 和前端 owner，並非另一套 Firebase UI。`/records` 的人工備援與 `/care` 使用同一照護記錄；`/messages` 是本人私人訊息，不自動寫成照護事實。

- 原 `/api/online/*` 維持 context、原 opId、收據查回及 changes；一般寫入的資料、版本、收據和 change 在同一交易提交。讀頁、搜尋和固定版本續讀沿既有 schema；超出本頁保持 cursor／coverage。
- `/api/ai/status`、`/api/ai/usage` 沿原 session-only GET 契約；若附 expected identity 仍須相同。模型設定及所有 Agent 操作維持 `x-expected-user-id`，變更另核確切 Origin。個人 key 留 Server 加密設定，不進 prompt／日誌；切換設定令舊 run 的授權失效。
- `POST .../messages/:messageId/reply` 綁同一使用者原話與持久 run；重送不新開一次模型。`reply/cancel` 更新持久取消；逾時或收尾失敗依原 run、操作收據及候選回報，不能把成功工具再做一次。聊天保存 `agentRunId`，重新登入後仍可讀同一運行結果。
- 原 reply 可用 `Accept: text/event-stream` 取得同次執行進度；JSON 呼叫及已保存回覆仍相容。SSE `data` JSON 分 `progress`（原 runId／messageId、固定 phase、可選固定 card ID）及 `result`（原 HTTP status／body）。開始、讀取、搜尋、工具返回只是進度，只有最後的已保存 message 才是正式回覆；工具返回不等於業務成功。
- 串流保留 Origin／expected-user／session／孩子權限。每次最多 48 個進度投影，心跳不代表工作；慢連線可省略中間 metadata，開始／固定卡及終態保留。不傳原始工具參數、私人檢索正文、模型思考或 token 草稿，不逐事件寫入資料庫。
- 前端 fetch 保持身份 header、原 message 與 run 綁定；中斷讀原 `/agent/runs/:id` 及已保存聊天，不自動重新 POST。斷線只關回饋渠道，原有界運行及保存可以繼續；明確 cancel 仍更新原持久取消狀態，切換身份／孩子清除進度與遲到結果。回覆尚未保存時如實顯示待查，不假造聊天。 JSON 與 SSE 同樣不以連線中斷取消已提交的執行。執行期限只停止新增模型／工具工作；原執行者仍可保存經核對的終態、計數與原操作結果。若查回曾把逾期未結清運行標為 interrupted，可由原執行者結清；已取消、撤權、儲存世代變更或已有正式結果不可被覆蓋。
- `show_official_help` 只選 Server 固定版本卡片，不外發、不確認操作、不新增分類生成。當前為 `emergency-hk-v1`／`medical-consult-hk-v1`；同次去重，保存 message 的 `officialHelp` 由原 run 的成功工具收據導出，不能由用戶提供正文。普通聊天無卡；歷史卡保持原版本，不把舊醫療說明冒稱新核對。
- `/agent/work`、`/agent/history`、`/agent/pending`、`/agent/runs/:id` 延續原接口。待確認綁提問訊息、操作／參數、資源／授權／政策／工作版本；多個有效候選、資料變更或不明確回覆不自動確認。一次確認和實際業務效果同交易保存。
- 共同准入為每人一個、全站最多四個運行；lease 到原 90 秒期限再加五秒釋放緩衝。持久日額度、原生 ADK session 及 root budget 跨程序共用；平台／本人付費來源不混用，個人較低限制保留。這不增加每日或單 run 配額。

F04 接以下文件／照片／退出契約；F06 接背景執行及對外提醒。未遷移的工具不向模型宣告，直接 API 回未就緒；不能把沒有資料或靜態按鈕當成已遷移。

<a id="firestore-files"></a>
### 文件、照片及資料退出的 Firestore 接點

- 原文件 list／detail／content／versions／actions／PDF 路徑與 schema 不變。Agent 使用同一 document store；文件修改、原操作收據、Agent 工具關聯與 run 版本同交易提交，重送不另建版本。需要明確確認的正文修改仍走原持久候選。PDF 由既有 renderer 使用指定版本快照，不另保存可修改副本。
- 照片 reserve／confirm／delete 經原 online context／opId；upload／content 沿既有路徑。extract 需要本人模型授權，使用同一 ModelGateway，提取只產生候選；confirm 才把核對內容保存到同一照護記錄。刪照片一併關閉其照護正文，未知上載保持清理責任。
- 本人下載沿 `GET /api/account/export` 的 manifest／section／childId／scopeVersion／cursor；Server 明列可匯出的領域，有界讀取固定來源版本，來源變動回 `export_scope_changed`。私人 key、Auth 憑據及內部模型協定不匯出。後續新增資料域須同時加入下載／刪除接點，不以空清單冒充接通。
- 帳戶退出保留 prepare → 具名確認 → 原 receipt 查回。Firebase 客戶端先在原登入 adapter 再驗證本人密碼，交換新 session；`POST /api/account/delete` 只傳 operationId／receiptToken／confirmation，密碼不送業務 API。Server 核 `auth_time`、原身份、準備時版本及有效 token。舊 SQL adapter 只在切換前保留其原 wire，不能在 Firestore 模式回退。
- 退出 receipt 的 `prepared / processing / completed` 分別代表待確認、已受理／清理中、實際清理完成。`GET /api/account/deletion/:operationId` 憑 `x-erasure-receipt` 查原狀態，帳戶被關閉後仍可恢復；只返回最小狀態，不透露正文或身份。前端 processing 顯示「清理中」，不重交新操作。
- 孩子刪除沿原 `confirmChildId`，原 online receipt 返回已關閉存取及 `cleanupPending`。獨立 journal、權威屏障及可恢復清理詳見 [資料契約](DATA_MODEL.md#firestore-files)。F06 接排程清理，F07 補完整還原 codec；尚未接妥前不對受邀用戶宣稱全套退出／恢复可用。

<a id="firestore-knowledge-sources"></a>
### 知識與私人來源的 Firestore 接點

- 原 `KnowledgeRetriever`、`search_knowledge`／`read_knowledge_context` 及引用 schema 不變；正文、PDF 原頁碼、版本及未讀範圍由同一已發布來源提供。索引及操作者方法見 [維護入口](P2_KNOWLEDGE.md#firestore-maintenance)。原前端來源面板讀同一 Agent 運行／引用資料，不另接公共瀏覽器資料庫。
- `/api/children/:childId/inputs` 的 list／get／fetch／extract／confirm／manage／management-history／delete 沿既有 wire；原 source owner／`createSharedInputApi`、Agent 候選及私人來源工具共用 `SharedInputStore`。變更仍經 online context／原 opId／expectedVersion，原 changes／owner 刷新維持，各頁不另存副本。
- 私人來源正文分段加密；來源取得及模型提取仍須本人授權、受限 URL 取得與既有 lease。管理時更改正文、停用或撤回選段會使舊選段／提取失效；提取不自動建立已確認事實。
- online 收據內部只保存私人來源的 ID／版本；查回原結果前核本人範圍及目前版本。來源已更改或刪除時，原操作仍 confirmed，但 `result:null`，不得重做或回傳舊正文；client 沿原 unknown 查回及共同 owner 重新讀取。匯出與孩子／帳戶清理同時涵蓋私人來源及管理修訂。

<a id="firestore-background"></a>
### 背景、關注與通知的 Firestore 接點

- 原 `/concerns`、`/growth`、`/contact`、`/api/web-push`、`/api/telegram` 和通知偏好繼續供正式前端共用 owner 使用，沒有第二套介面／資料副本。關注及成長事項沿原版本／權限／確認契約；訂閱、綁定、測試、撤銷及聯絡授權變更沿 online 原操作收據。寫入／投遞結果更新同一 changes。
- Telegram webhook 只豁免一般瀏覽器 Origin 門檻，仍核配置的 webhook secret、有界 body、bot／update 去重及本人已確認綁定。按鈕回覆綁正確訊息及事項；「收到」不完成照護任務。瀏覽器身份不可充當 webhook 身份。
- 私有 `/internal/product-work` 與原提醒／dispatcher 共用固定 OIDC 驗證；payload 只有持久 job ID、generation、dispatchRevision 和 scheduledAt，不接受模型上下文、渠道地址或使用者指定執行權限。Server 從原台帳取得範圍並重新核對。
- 接續結果沿 `/agent/work` 的 `latestFollowUp` 及原 background runs 顯示；過期、取消及原 run 未成功保持真實狀態。成長整理的分批進度仍沿同一文件／reportCoverage，不另增可修改報告副本。
- 本次為 Firestore 路由／資料接線，實際驗收和正式部署分別見 PLAN／證據；未發送真通知的 scripted 結果不代表渠道已送達。

照片 DTO 的可選 `recoveryPending` 表示隔離還原時原上載尚未結清；仍為 reserved，不能讀正文或提取。正式照片 owner 顯示核對原圖的提示；沿同一附件／hash 查回，沒有額外建立或上載副本。


<a id="result-history-consistency"></a>
### 成果收據與本人通知歷史

文件原操作收據保留 operationId／documentId／savedVersion；內部 contentState 區分 building／ready／invalidated，並提供目前版本及已有處理數量。building 表示整理工作已提交，正文未完成；不等於來源失效或需要建立另一文件。真正來源失效仍遮蔽正文，收據暫時查不到仍是 unknown，不換 opId 重做。頁面沿同一文件的 report.phase／readState 顯示進度。

`GET /api/account/export?section=notification_deliveries` 保留既有前端 owner 契約，回傳本人的 Push／Telegram 投遞及聯絡 attempts metadata；含 id、channel、status、created_at、attempted_at、finished_at、acknowledged_at，聯絡項另有 request_id。沒有真 attempt 的聯絡請求不投影成送達；不新增假電郵、私密正文、渠道地址或 binding。按原請求建立時間倒序有界合併三來源，每頁最多掃十筆來源列，游標各自保存進度，空頁仍須沿 nextCursor 續讀。此分頁不是穩定歷史快照；新投遞／回執由重新讀取更新，身份或資料範圍變更使旧游標失效。


<a id="web-admin"></a>
## Web 管理 API

管理接口共用 Firebase session、`x-expected-user-id`，回應 `no-store`。`GET /api/admin/session` 只回本人是否為管理員；其他接口只容許部署綁定 UID。管理權不來自電郵字串、家庭 owner 或模型參數。POST 另核 Origin 與近期重新驗證，結果返回前重查身份。

| 方法／路徑 | 契約 |
|---|---|
| GET `/api/admin/policy` | 生效 policy／version（含 maxToolCalls／maxRunSeconds）、部署 AI 開關及固定輸入輸出容量 |
| GET `/api/admin/invitations?cursor=` | 最多 20 筆後台管理邀請及 nextCursor；狀態重新讀權威資格 |
| GET `/api/admin/invitation?email=` | 完整電郵定位既有資格；不以未列入列表推定不存在 |
| GET `/api/admin/usage?day=YYYY-MM-DD` | UTC 日的平台／本人 key 全站 counters，無聊天掃描 |
| GET `/api/admin/audit?cursor=` | 最多 20 筆不可變管理收據／前後值 |
| POST `/api/admin/operations` | `src/shared/admin.ts` 的 policy／invite／revoke 聯合契約，必帶原 opId；policy 帶 expectedVersion |
| GET `/api/admin/operations/:opId` | 本管理員原收據或 null；null 不表示原請求必定未生效，重送只能用同一參數／opId |

管理設定的合法範圍統一於 `src/shared/agent-run-limits.ts`：生成 1–12、工具 1–16、查詢 embedding 1–6、期限 15–90 秒。實際值以已保存 policy 為準；舊 policy 缺工具／秒數時讀成 16／90。舊 policy 寫入請求可省略這兩個新欄位，保持原請求指紋並保留目前值；不以預設覆蓋新設定。API／worker 新 run 固定同一 policy 版本，執行中不動態換額度；本人 key 仍用其個人生成／向量限額，工具／期限共用管理政策。期限只可縮短原受信任 claim 的絕對期限，不能刷新或延長原 run。模型可見餘額供自主規劃，不代表必須用盡。

`version_conflict`／`operation_conflict` 回 409，不覆蓋或另建操作；已使用資格回 `invitation_consumed`，不呼叫原 operator 的帳戶撤權流程。網絡／5xx 保持 unknown，Web owner 暫停其他寫入並提供查回／明確同 ID 重送。登出／身份切換取消讀取並清除管理快取；原生頁不載入管理資料。管理寫入不呼叫模型。

<a id="feature-operation-contracts"></a>
## 功能分層的既有操作契約

此節約束正式 owner／API／服務的相同成果，不新增路由或輸出格式。欄位仍以各域 schema／既有專項為準；程式與未驗範圍見 [LAY](../PLAN.md#p2-layering-streaming)。care/profile 普通 HTTP 在正式 firebase-app 僅掛載讀取／搜尋，寫入沿現有 online transport／收據，不能將舊 handler POST 分支當正式入口。

| 功能 | 輸入與權威前置 | 結果與恢復／同步 |
|---|---|---|
| 保存孩子概況 | 目前身份／孩子 scope、原 opId／fingerprint、預期版本、精度與日期基準、必要共享確認；不把約數換成生日 | 同一 profile 新版本／修訂／變更／收據；衝突讀回，不覆蓋草稿；概況與相關記憶／成長投影失效重讀 |
| 新增／更正／刪除記錄 | 目前 scope、原文及事件時間精度、指定原記錄／預期版本、原 opId；刪除沿既有明確確認 | 真提交後回原結果；正文及修訂依刪除屏障遮蔽，原收據不重建；列表／詳情／歷史同步，不因 off-page 缺席推定刪除 |
| 完成／取消／改期待辦 | 目前 scope／角色／對象、允許狀態、預期版本、原 opId；明確完成與收到區分 | 同交易任務／修訂／收據／outbox；同操作回原收據；完成與取消相同基準競態仍 needs_review；worker 重查終態，不能只隱藏按鈕 |
| 讀取成長／關注 | 本人／孩子、有效來源／版本／時間範圍及有界游標；配對來源 authorityVersion／canManage 一致 | 同源投影與 coverage；資料更正使衍生成果待更新／失效，不讀頁生成；讀失敗與空集合／無關注不同 |

跨域共通：拒絕、版本衝突、讀取暫時不可用與副作用未知分開。未知提交先按原 opId 查回，不能生成新 ID 重做；identity generation／取消及重讀前後校驗沿原 owner。畫面即時提示不取代交易內校驗，測試替身不取消真身份／交易邊界。


<a id="agent-execution-outcomes"></a>
### OPT02 現有聊天／背景執行契約

`present_answer` 保留舊整體 kind／paragraphs；新增每段可選 kind，整體 `mixed` 時每段必填。育兒／求助段各須實際適用官方片段，私人材料段須本人來源；澄清、收據及資料回述不硬配公共引用。終端仍重查引用／權限，這是程式閘，不冒稱新審核 Agent 的語義核對。

僅受信背景入口提供 `kind:no_action, paragraphs:[]`，成功後持久結果是 `status:completed, outcome:no_action, text:''`；沒有引用或候選正文，不寫假聊天或外發。互動入口不提供或接受空答。已建立聯絡不能以無動作遮掩，必須回報真實收據。原 run 重讀仍返回此終態，不能因沒有文字重開 run。

工具只有經 Server 明列 `effect:read` 的純讀取 handler，普通服務失敗才回 `failed/read_unavailable` 供同一預算內補查；不是空資料。執行權不確定或取消／期限仍停止，未標純讀取的錯誤維持 unknown，只核原收據、不換 ID 重做。模型無權更改 effect。首批僅上下文、官方原文續讀、照護摘要及純工作讀取，搜尋 embedding 的用量及未知規則不放寬。

正式私人聊天在每次模型請求前，透過共同 gateway 回調重新讀取已核對摘要；null 明確移除失效摘要，不退回舊快照。摘要只加入本次 provider payload，最多原有 4,000 字元並計完整請求容量，不累加至 ADK session；原工具 parts／配對保持。此接點不新增模型整理、壓縮或配額，局部摘要維護由 OPT03／04 承接。舊無回調入口保持原首次摘要相容行為。


<a id="memory-keyed-recall"></a>
### 記憶原項與有界召回

正式 Firestore 聊天工具沿同一業務服務：`read_memory_facts.keys` 可直接讀最多四個已知事實鍵／話題標題，返回目前有效性、原來源及話題終態；與 factId／afterId 互斥。未命中只表示這些正規化鍵未有目前指標，歷史與候選仍可按原 ID／搜尋核對。回覆超出工具容量時要求縮窄鍵，不靜默截斷成完整結果。

`read_private_instructions.memoryKeys` 在 query 為空、afterId=null 時直接定位最多四項私人交代，返回 missingKeys 及 `legacyUnkeyedNotSearched:true`；舊無鍵或同義內容沿原有界搜尋。`save_private_instruction.memoryKey`／`revise_private_instruction.memoryKey` 是可選的穩定主題／事情鍵，非任意權限或事實確認。新保存遇同鍵、同標題及正文，返回原資源 ID／版本及新操作收據 `memoryOutcome:duplicate`，不新增內容版本、變更序號或提醒；同鍵不同內容回 `instruction_key_conflict`，須讀原項再帶 expectedVersion 更正。舊無鍵交代可在同一更新補鍵；已綁定鍵不能藉此更名覆蓋另一項。收據 outcome 的 created／updated／duplicate 與照護完成或外發無關。

`search_history` 增加可選 `createdFrom`（包含）／`createdBefore`（不包含），指保存時間，不能冒充事情發生時間。先沿既有排序索引限制範圍，再做原有最多 100 筆授權正文掃描與十項命中；cursor 同時綁定此範圍、本人／孩子／世代／變更版本及查詢。舊無範圍 cursor 相容。已知事情資源仍用原工作 resource ID／version 直接讀，不建立第二份權威資料。


<a id="memory-batch-maintenance"></a>
### 私人摘要批次與共同上下文

Firestore 的 `prepareSummary`／`read_context.privateSummaryInput.summaryMode=isolated_batch` 指定一段完整、有序原訊息；摘要只涵蓋該批，不串接上一份摘要正文。舊 cumulative 資料仍按原 basis 保守核對。保存綁定 previousVersion、basis、原覆蓋 IDs；來源變動不重設新版的追加游標。這是私人衍生資料，不改事實、工作或提醒終態。

私人 `memory-refresh` 是現有 worker 的維護用途，非 P3 專職 Agent：以已保存工作 reference／generation／授權 claim 進同一 Runner、付款路由及原 finish 交易。只有一個 terminal `stage_private_summary`，最多一次生成、無檢索 embedding 或外發工具；一次最多整理 12,000 字元的完整原訊息批次，修復時連同現行更正資料亦須符合此上限。超大單訊息保留未處理及 input_limit，不截斷或跳過覆蓋；原文仍可由歷史續讀。沒有新增或可修復批次便零模型結束。

有效摘要每次 provider 呼叫前重核，最多選目前四個批次中能完整容納的內容；保留原訊息 IDs、部分覆蓋／未載入說明。近期對話以最多六則完整訊息及 14,000 字元的可選前文預算選取；當前訊息不截斷，超出可選預算仍交最後總容量閘判定，原始歷史按原工具續讀。未載入不等於不存在；摘要不是目前事實或操作授權。

Prompt 組裝輸出模組字元統計，沿原 manifest 檢查依賴／版本／重複；gateway 每次仍計指令、工具 schema、資料及完整原生 parts，為工具結果留原有空間。可選摘要因容量／有效期省略時盡可能附 coverage 標示，不新增模型壓縮或把字元換算成固定中文 token 上限。工具配對、確認及 opaque metadata 不截斷。

<a id="agent-observation-port"></a>
### 內部 Agent 觀察端口

`AgentRuntimePort.run(AgentRunInput): Promise<AgentRunResult>` 是產品編排／記憶整理使用的 Server 接口。`AgentRunInput.onDiagnostic` 只由受信任組裝注入，HTTP body 與模型不能指定 callback 或觀察別人的 run。返回結果及保存仍沿原權威服務；觀察事件不代替收據。

`AgentDiagnostic` 新增穩定 `layer=agent|model|tool|authorization|business`，其餘沿原 runId、phase、tool、elapsedMs、outcome、stage、code 白名單。已登記工具以外的名稱及原始錯誤內容不傳出。正常模型／工具事件不自動持久保存；斷線、HTTP 錯誤及 run 終態由各自層處理，不從最後一個進度事件猜測成功或重做。


<a id="p3-voice-input"></a>
## P3 共用語音接點

S12 的目標契約：Web／Android 每次聊天最多一段錄音、兩分鐘／5 MiB。錄音與選檔先留裝置，按送出才保存；未送出草稿不跨端同步。M4A／MP4、WebM Opus、OGG、WAV、MP3 使用同一格式表；Server 依實際音訊包校驗，不信檔名、客戶端時長或容器宣告。無法完整核對便拒絕，不截斷後聲稱成功。

正式接線必須經原身份／孩子權限：原 `opId` 預留附件、原地址上載與未知查回，再於聊天保存交易綁定唯一訊息。附件處理期間不能因重試建立第二份訊息；內容下載前後重核目前權限、版本及刪除狀態。Storage 的 generation／hash／加密正文與 Firestore metadata 分開，不能把未完成上載當已保存聊天。

聊天 Agent 直接讀當前已授權音訊；背景轉錄只保存可搜尋文字及可信時間標記，沒有辦事工具，不再執行錄音指令。轉錄未完成不阻塞原聊天；後續以保存的轉錄／摘要按需召回，原錄音可追溯。刪除及還原必須處理音訊、轉錄、搜尋和衍生內容；完整生命週期接好前，正式畫面的語音入口保持未開放。實作／驗收狀態只見 [S12-W01](../PLAN.md#s12-w01)。

語音 port 使用 `/api/children/:childId/voices`：POST 帶原 `opId`、檔名、MIME、bytes、hash 預留；GET `/:id` 查回；POST `/:id/content` 帶 expectedVersion／base64；POST `/:id/resolve` 只核原物件；GET `/:id/content` 返回經授權的原位元組；POST `/:id/delete` 帶原 opId／expectedVersion。與照片相同的身份、同源及 x-expected-user-id 保護；正式發布狀態見 PLAN／STATUS，不以端口存在代表手機已交付。

聊天建立可帶 `voice: {id, expectedVersion}`。Server 交易確認 ready、目前本人／孩子及未綁定後，將附件與唯一訊息一併保存；回傳只帶不可變音訊身份／hash／格式／時長，不複製正文。無文字的語音訊息允許空 text，舊文字訊息不變。格式或時長拒絕是上載前已知失敗，可沿原附件修復；已進 Storage 的未知結果只查原地址。刪除先遮蔽，獨立日誌確認後清理固定 generation；unknown 上載沒有找到物件不代表已完成清理。未結清義務保持有界退避及可見停留狀態。

語音交代的普通操作可帶 `sourceBasis=voice_interpretation`，`sourceQuote` 是模型本輪從原錄音聽取的片語。Server 只接受當前訊息綁定、仍 ready 的同一附件 ID／版本／hash，連同原 run、預授權版本及操作收據保存來源證據；不改寫原訊息 text 為自動轉錄，不把語音辨識當已確認事實。文字及較早文字來源仍須逐字核對，重要事項仍使用原確認服務。刪除／改版後不能引用舊錄音執行新操作。

ADK 事件只保存本次音訊身份 metadata；模型 adapter 在每次已授權呼叫前將同一原位元組加入原訊息位置，維持完整 function calling 協定。音訊另計格式、5 MiB／兩分鐘及一段上限，文字／工具 schema 仍計原上下文容量；完整 provider payload 參與原呼叫指紋及用量。不能把 base64 寫進 Firestore 聊天／ADK 事件，亦不能接受模型或 HTTP 提供的任意音訊 URL。

語音轉錄 GET `/:id/transcript` 使用同一身份及原音訊存取核對，返回 pending／running／available／unknown／stopped、自動辨識標記、完整度及段落時間；不將轉錄複製到原聊天 text。首次訊息綁定同交易入列，預留互動運行時間後處理；單次生成、同一付款來源及背景授權，已知配額未准入可有限次延後，未知模型結果不重做。清理及匯出沿目前音訊刪除屏障；預留／刪除的原操作占用共用收據位置，跨資源重用同 opId 拒絕。

語音搜尋復用本人／孩子的聊天歷史接口：只從目前可讀的原音訊取得已保存轉錄，標明自動辨識及完整度；不改寫聊天原文、不建立另一份可修改正文。`read_history`／GET 歷史訊息可返回 `voice` 及 `contentVersion`；語音續讀帶同一 `contentVersion`，轉錄完成、原音訊刪除或可讀範圍變化後舊版本拒絕續接。新一頁須從 offset 0 重新讀取。無法讀取或未完成轉錄不等於原錄音沒有內容。

原錄音播放每次下載重新核權，使用短期可丟棄的裝置快取；有可靠段落時間才提供跳播。尚未綁定聊天的 Server 上傳保留最多 24 小時，再沿獨立刪除日誌及原物件清理；已綁定訊息不受此期限影響。裝置草稿不會因此自動送出。已提交但回覆丟失的上傳只查回原 ID，不能重送成另一附件。

配對備份 manifest 的 `voices` 為向後相容可選欄位；錄音密文使用獨立、固定 generation 的備份物件，保留與 manifest 相同的 14 天期限，原生熱備份讀回沿相同獨立刪除屏障。還原先重放 voice-delete／孩子／帳戶刪除，遮蔽轉錄；清理 tombstone 保留原物件範圍，活躍內容才轉換儲存世代。未結清上傳、轉錄 unknown 不被當成成功或重做許可；真原生備份還原仍按既有待驗門檻處理。
