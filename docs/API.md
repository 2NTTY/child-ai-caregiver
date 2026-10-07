# 接口与鉴权契约

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

S11-W03 的 [AgentRunInput／AgentRunResult／AgentTool](../server/agent-runtime.ts) 是 Server 內部型別，不是接受客戶端身份或工具定義的 HTTP API。已接通 ADK 有界循環、Prompt Pack 組裝、原生工具 parts、配額與安全停止。S11-W02 已接業務工具及跨 run 確認／記憶；HTTP 契約見下文，驗收範圍見所屬工作包。工具成功但生成失敗可返回已核實進度；取消／期限耗盡而不能重新核權時，不披露舊結果。

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
| GET `/api/children/:childId/agent/runs/:runId` | `{result}`：本人運行、工具狀態、當時引用、候選及停止原因；中斷且未保存統計以 `countsKnown=false` 表示未知 |
| POST `/api/children/:childId/agent/runs/:runId/proposals/:proposalId/decide` | `{expectedVersion,decision:accept\|dismiss,confirmShared}` → `{proposal}`；精確重試返回原結果，過期候選不可接受但可明確略過；接受仍核對權限及版本 |
| GET `/api/children/:childId/agent/pending?cursor=…` | `{proposals,nextCursor}`：本人及該孩子的 pending／expired，每頁最多 20 項，獨立於近期聊天及 20 次背景清單；過期項只能重新核對或略過 |
| GET `/api/children/:childId/agent/runs` | `{runs:[{runId,createdAt}]}`：本人最近最多 20 次背景運行，供手動重讀；不是啟動 Agent 的入口 |

`propose_task／propose_task_change／propose_fact` 只保存私人候選。明確接受後，任務／已確認事實與候選結果在同一交易寫入；家庭共享需額外明確確認。受限聯絡工具按 [W07 授權](#proactive-contact-http) 執行，入列、聯絡結果與照護完成分開。候選 24 小時過期；任務改期／完成／取消沿用原版本及終態規則，事實保留原私人訊息來源，不靠最終文字重做副作用。

`read_context` 按入口區分本人／家庭；私人摘要只在取得完整批次時透過 `stage_private_summary` 暫存，運行結束再核對來源版本及精確覆蓋，衝突保留原摘要。摘要及候選不成為確認事實。`search_knowledge` 使用既有 public retriever 與同一運行預算；`present_answer` 核對引用 ID、官方類別及當前有效版本，回傳結構不等於已驗證語義支持。

<a id="agent-ordinary-actions"></a>
INT-W02 增補：`GET／POST /api/children/:childId/agent/policy` 管理本人按孩子的普通操作預授權；POST 帶 `operationId／expectedVersion／confirm`，家庭記錄或任務另須 `confirmShared`。預設全部停用；變更身份授權或 storage epoch 令舊政策失效。記錄類別只限 note／feeding／sleep／diaper，普通私人交代與本人 ordinary 任務各自開關；重要健康事實、刪除及擴大共享維持明確確認。渠道權限綁目前本人同意版本及完整 binding 清單，不能因事後多綁渠道而靜默擴權；每項到期授權仍由既有 ContactStore 保存，無 fallback／額外跟進，收據只列實際核准的首個渠道。缺有效通知授權時只能回報站內安排。

`GET /agent/notes?query=…&afterId=…` 返回 `{notes:{items,nextAfterId}}`；是本人普通交代的權威來源，不複製成已確認事實。`POST /agent/notes/:id/delete` 需 `operationId／expectedVersion／confirmDelete:true`。`GET /agent/actions?runId=…` 返回 `{receipts}`，只讀本人／孩子原運行的已提交操作；收據含資源 ID、版本、保存／排程／終態及通知授權狀態，不以模型文字推定成功。上述路徑均以 `/api/children/:childId` 為前綴並重核 session；未套用 migration 025 不啟用新操作。

容量契約增補：工具選擇以當前本人指令為主，只有明確短延續語才參考上一則本人訊息，不把助手回覆或無關舊意圖疊入；明確待辦標題／內容屬資料，禁止通知等子句不會僅因關鍵字開啟該工具。多個正向意圖保留，工具選擇從不代表授權。gateway 的完整 contents／config 邏輯 JSON 仍受原 32,000 UTF-16 字元上限（不等於 SDK 後續加入固定設定後的 HTTP body 大小），沒有提高模型次數或配額。

`read_context` 在整體 request 剩餘容量內只給一份完整、有序的原訊息前綴；`privateSummaryInput.messageIds` 引用同次提供的原文，舊摘要只提供一次。明示 omitted／more／complete，不能把未讀部分說成已摘要。Server 對摘要批次重新核對 previousVersion、basis 及連續前綴 coverage，來源改變仍拒絕。固定 metadata 放不下時明示 context_input_limit，不暗刪事實或任務；原生工具協定／signatures 不被截斷。

Agent 普通記錄的 quantityEvidence 為可空逐字數量片語，只在本次 sourceQuote／原訊息存在、原值與受支持單位對應時保留 quantity。未提供、無法核對或僅有日期／時鐘時保存 null，不補一次、不換算或求和。有限語法支援數字、中文數詞、半數及已知約數；原文約數或範圍不得升為 exact，不支持形式保留在記錄原文。該證據不另存共享欄位；手動 Care API 不變。更正未改量度時可保留舊欄位，但不視為新核對或提升可信度；既有錯誤記錄不自動回填。

`read_context.uncoveredConversation` 依既有摘要 coverage 讀取未覆蓋的本人原訊息，保持完整訊息及最後來源 ID；超過本次工具文字預算時明示未讀部分，不靜默截斷或宣稱全部記得。長期普通交代另由 `read_private_instructions` 按主題查回，不把最近幾則聊天當長期記憶。

INT-W03 增補 `allowRecordCorrections`，既有政策及未提供欄位預設 false，不因升級而擴大舊授權。`read_care_records` 讀目前共享記錄及版本；`revise_ordinary_record` 只按本次明確指令更正本人、原普通類別及目前版本，並要求此新開關與原類別均獲授權。更正沿用 CareStore 歷史及原資源，保留未變的時間精度；共享確認、來源原文、權限／版本、操作收據及未知結果規則不變。

原生 `save_ordinary_record`／`save_private_instruction`／`revise_private_instruction`／`create_ordinary_reminder`／`change_ordinary_reminder` 各採單一參數形狀，共用相同業務操作與收據；只接受互動 run、當次來源訊息、精確 sourceQuote、目前政策版本及允許的動作，由同一交易調用原 CareStore／TaskStore 並保存收據；背景 run 不取得此工具。原 call ID 的精確重試及同 run 等價動作沿用原收據；政策撤回、權限／版本改變及任務終態仍拒絕新效果。工具成功但文字收尾失敗，依台帳顯示已保存結果，不再次執行。`read_context.uncoveredConversation` 顯式區分摘要已覆蓋與尚未覆蓋的原文；只返回完整訊息，超出有界輸入時列未讀部分，不承諾完整記得全部聊天。

背景 product-background 因已核准到期提醒或 S13-W08 新關注基準入列，讀取家庭共享上下文並保存本人站內說明；不讀私人聊天、建立新任務或發出外部通知。成長關注接線見 S13-W08；預授權聯絡由 W07 的接線及授權掌管。必要真 SQL、Gemini／embedding、worker 恢復與修正範圍分列 [S11 證據](../artifacts/verification/S11_W02_CHECKS.json)及 [W08 證據](../artifacts/verification/S13_W08_CHECKS.json)；完整 Agent／關注 UI 情景未驗，不以其他包的瀏覽器證據代替。

<a id="knowledge-retrieval-contract"></a>
### P2 最小向量檢索契約

- <a id="api-kr-01"></a>KnowledgeRetriever 接收必要問題語義及 Server 核定的適用條件，未知保持未知；不把整份聊天或孩子檔案作 embedding 輸入。內部封裝向量／關鍵詞與 RRF，ADK 只調用同一個渠道／模型無關的檢索工具。
- <a id="api-kr-02"></a>回傳片段識別、原文／章節、來源／版本、官方日期、查核及適用狀態，以及向量＋關鍵詞、關鍵詞降級或不可用等實際檢索狀態。最多六項、適用性及引用門檻依[架構](ARCHITECTURE.md#p2-vector-rag)；排名／距離只作檢索資訊，不作語義支持保證。
- <a id="api-kr-03"></a>兩種檢索及任何復用結果套用相同分類、年齡／地區、已發布、有效版本及停用條件。embedding 失敗可回傳合格關鍵詞結果與降級原因；無適用證據／衝突／不可用不回傳模型補造的來源。
- <a id="api-kr-04"></a>維護指令預覽片段數，按固定模型／維度／處理版本有限生成及核對發布；保存失敗及未完成狀態，hash 未變不重算。P2 提供實際匯入／發布／停用邊界，P4 管理頁及批量維運沿用它，不另建一套管理 API 權威。

<a id="knowledge-w01-implementation"></a>
### S10-W01 實作入口（必要真服務驗收已通過）

[KnowledgeRetriever](../server/knowledge-retriever.ts) 的 `createRun({actor,budget,authorize})` 接收 Server 權威身份、既有運行預算及即時權限回查。`search(query, filter)` 回傳 [KnowledgeResult](../src/shared/knowledge.ts)，包括實際模式、片段短原文 `sourceExcerpt`、經核對精簡轉述 `text`、來源及版本；此處是內部檢索契約，S11-W02 的 ADK／HTTP 接線見上文。`revalidateCitations` 在交付前重查片段／版本／hash 和適用性，不作內容語義判定。維護 CLI 及限額見 [操作文件](P2_KNOWLEDGE.md)；接線驗收按 [S11-W02](../PLAN.md#s11-w02) 的版本化證據。

<a id="knowledge-refresh-contract"></a>
### S10-W02 來源更新邊界

共用 worker 以 pg-boss 原生每週／每日排程檢查固定、經條款核對的來源；job 只帶 watch ID、配置版本及 worker 世代。暫停、還原或配置失效後不抓取，網絡等待不持有 SQL 交易；回寫前再次核對。`knowledge-refresh.mjs` 只供主機操作者使用，沒有新增 Web 路由或模型可調用的管理工具。

抓取結果是公共來源觀察資料，並非已發布知識。首次／變更內容須經操作者核對，將 observation hash 綁定至既有 reviewed version，再沿用有限 embedding／publish；hash 未變不重算向量，受影響片段以既有 embedding hash 去重。已登記來源的觀察版本不符、停用或 404／410 均不供引用；重新啟用或登記定義改變時，同一交易內撤銷舊內容批准，即使再改回原設定也不自動恢復。暫時抓取失敗保留先前內容及成功查核時間。候選新聞不自動寫入家庭事實或任務。

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

INT-W03 的 `POST /api/children/:childId/messages/:messageId/reply/cancel` 接受 `{}` 及相同 `x-expected-user-id`，重新核對 session／孩子權限，只停止目前 API 程序中屬於本人原訊息的互動運行。`accepted:true` 表示取消訊號已送入真正 runtime；仍須讀取最後運行與收據，不代表撤銷已提交操作。`false` 不聲稱運行已取消；程序重啟後按原台帳核對，不重建或重跑模型。取消不增加生成呼叫；背景 worker 不由這個入口控制。

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

內部 `MemoryStore.prepareSummary` 回傳前一有效摘要、當前權威版本摘要值 `basis`、`previousVersion` 及按 Server 次序排列的最多 50 條未覆蓋訊息；`saveSummary` 只接受完全吻合的實際 ID 清單及版本。資料變化、缺段、越權、重複或過時輸入均不當作成功。摘要不寫入事實／話題／任務狀態。`context` 分開私人及家庭模式；家庭模式不含私人聊天／摘要，亦不提供私人來源 ID。超過 200 項事實或話題時拒絕無篩選 context，不能靜默省略終態；訊息未全部覆蓋以 `truncated.messages` 明示。S11-W02 接入模型時必須處理這些狀態、有效性及 `conflictingKeys`，本包未改 P1 聊天入口或宣稱已由 Gemini 生成摘要。


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

AI 候選不是事實，原圖共享也不自動公開上傳者的私人提取候選；確認畫面明確說明原圖及已核對記錄會共享。提取受同一 Agent／模型配額控制，最多四次生成、八次工具及 90 秒；單張二進位大小另限，32,000 字元仍計全部文字、schema 及協定 metadata。模型只能交候選，不能建立任務或外發。

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

個人每日上限 1–1000（預設 100）、每次 Agent 生成 1–12（預設 4）、查詢 embedding 1–6（預設 2），UI 可編輯並經 Server 驗證。只有 personal 模式採用這些限額；平台維持原配額及每次 4／2。工具 8 次、90 秒、輸出 1024 tokens／次及上下文 32000 字元仍是固定安全上限。每個運行固定選定版本，後續模型／向量／工具及回報重查；撤回不能取消供應商已接受的呼叫。

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

沒有觀察時間的現行持續關注仍列入成長報告正文，明示日期未提供；不把建立時間當事件時間。已知時間的來源仍依原文件期間篩選，PDF 沿用同版章節及來源。

Agent 透過 read_family_documents／generate_family_document／change_family_document 使用同一服務。生成只接受用途／期間等結構化參數，不接受模型自由撰寫家庭正文；真實資源 ID／版本及操作收據才代表已保存。

