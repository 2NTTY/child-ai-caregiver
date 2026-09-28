# 接口与鉴权契约

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
### P2 AgentRuntime／工具契約（基礎已落碼，業務接線待完成）

S11-W03 的 [AgentRunInput／AgentRunResult／AgentTool](../server/agent-runtime.ts) 是 Server 內部型別，不是接受客戶端身份或工具定義的 HTTP API。已接通 ADK 有界循環、Prompt Pack 組裝、原生工具 parts、配額與安全停止；目前 P1 路由未切換。具體業務工具、跨 run 確認／記憶／冪等及對 UI 的契約隨 S11-W02 和相應功能包落碼。工具成功但生成失敗可返回已核實進度；取消／期限耗盡而不能重新核權時，不披露舊結果。

- <a id="api-ar-01"></a>內部入口接受受信互動請求或 worker 事件及必要輸入／待確認參照；Server 建立 runId，注入身份、孩子／資料空間、觸發來源、時間／時區、授權及資料版本、配方／工具集合。客戶端正文不能聲稱自己是 worker 或提供可直接採信的權限。
- <a id="api-ar-02"></a>ModelGateway 的 ADK 路徑傳遞完整模型／工具 parts、呼叫關聯及必要 opaque metadata，不壓成 P1 文字介面。每次生成／查詢 embedding 均受[運行配置](ARCHITECTURE.md#p2-agent-budgets)、全局開關、配額及共享取消／deadline 約束；語料維護另有有限額，不能繞過全局控制。
- <a id="api-ar-03"></a>FunctionTool 只映射本次允許的業務操作；呼叫必須核對 schema、資源及來源權限、授權版本、終態、確認參照和穩定 opId／occurrenceId。結果區分成功、部分成功、拒絕、衝突、失敗及 unknown，帶實際操作參照；框架自動呼叫工具不豁免校驗。
- <a id="api-ar-04"></a>原生工具呼叫是副作用入口；收尾的文字／actionRequests 不能再次執行同一操作。必要結構化結果使用宣告 schema；不支援同次工具／schema 時的獨立收尾仍計同一預算。收尾失敗從台帳呈現已確認結果，不重做工具。
- <a id="api-ar-05"></a>待確認參照綁種類、原事項／訊息、對象、內容版本、可見範圍及有效性，跨 run 持久保存。確認回覆重新核對指向、發言者與當前權限；多個可能指向先補問。事實確認、任務確認、完成及外發授權不可互換。
- <a id="api-ar-06"></a>輸出供 UI 使用的 runId、狀態／停止原因、可理解結果、可引用來源及最小工具進度，須在呈現前重新核對權限及版本。進度只取實際工具／台帳證據，不回傳原始 provider 協定、內部推理、憑據或無權資料。API 路由與完整序列化隨工作包落碼，不把 Prompt Pack 語義直接當現有 wire format。

<a id="knowledge-retrieval-contract"></a>
### P2 最小向量檢索契約

- <a id="api-kr-01"></a>KnowledgeRetriever 接收必要問題語義及 Server 核定的適用條件，未知保持未知；不把整份聊天或孩子檔案作 embedding 輸入。內部封裝向量／關鍵詞與 RRF，ADK 只調用同一個渠道／模型無關的檢索工具。
- <a id="api-kr-02"></a>回傳片段識別、原文／章節、來源／版本、官方日期、查核及適用狀態，以及向量＋關鍵詞、關鍵詞降級或不可用等實際檢索狀態。最多六項、適用性及引用門檻依[架構](ARCHITECTURE.md#p2-vector-rag)；排名／距離只作檢索資訊，不作語義支持保證。
- <a id="api-kr-03"></a>兩種檢索及任何復用結果套用相同分類、年齡／地區、已發布、有效版本及停用條件。embedding 失敗可回傳合格關鍵詞結果與降級原因；無適用證據／衝突／不可用不回傳模型補造的來源。
- <a id="api-kr-04"></a>維護指令預覽片段數，按固定模型／維度／處理版本有限生成及核對發布；保存失敗及未完成狀態，hash 未變不重算。P2 提供實際匯入／發布／停用邊界，P4 管理頁及批量維運沿用它，不另建一套管理 API 權威。

<a id="knowledge-w01-implementation"></a>
### S10-W01 實作入口（待真服務驗收）

[KnowledgeRetriever](../server/knowledge-retriever.ts) 的 `createRun({actor,budget,authorize})` 接收 Server 權威身份、既有運行預算及即時權限回查。`search(query, filter)` 回傳 [KnowledgeResult](../src/shared/knowledge.ts)，包括實際模式、片段短原文 `sourceExcerpt`、經核對精簡轉述 `text`、來源及版本；不是新增 HTTP 或已接通的 ADK 工具。`revalidateCitations` 在交付前重查片段／版本／hash 和適用性，不作內容語義判定。四來源五片段、維護 CLI、限額及未完成接線見 [操作文件](P2_KNOWLEDGE.md)；S11-W02 才整合聊天及背景 Agent。

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

本包只有必要單元／型別檢查證據；真 PostgreSQL 遷移及重啟配額、Vertex 調用與部署環境仍須在 S11／S16 的必要驗收取得實測證據，不能把 fake provider 當真模型。

<a id="p1-chat-http"></a>
## P1 私人聊天保存 HTTP（S09-W01）

`GET /api/children/:childId/messages` 返回 `{messages, limit:100}`，每則有 `id/childId/authorUserId/role/text/inReplyTo/createdAt`。只返回當前帳號在該孩子的私人聊天；無權或不存在都 404，未登入 401。

`POST` 同一路徑只接受 `{text}`，保存 1–10,000 Unicode 字元原文；拒絕額外欄位、空白、NUL 或無效 surrogate。須有符合 session 的 `x-expected-user-id`，缺失 428／不同 409；成功回 `{message}` 及 201。作者、角色、ID 和時間由 Server 決定，不能提交模型訊息。訊息本身不是已確認照護記錄，不觸發模型或工具。

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
- <a id="api-ga-04"></a>資料語義見 [DATA_MODEL](DATA_MODEL.md#growth-attention-model)，執行次序見 [ARCHITECTURE](ARCHITECTURE.md#growth-attention-flow)。沿用既有共享介面及在線更新，不在文件階段預建 HTTP 路由、完整 schema 或新增平台。

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

<a id="errors-compatibility"></a>
## 错误、兼容和未确定的实现细节

契約要求區分未授權／已撤權、配對過期或重放、舊世代、版本衝突、校驗失敗、網絡失敗、結果未知及附件未完成；界面映射到 [SPEC 確認狀態](../SPEC.md#section-4-7)，失敗或未知不能顯示成功。以上是業務條件，未固定 HTTP 狀態碼或錯誤字串。

HTTP 路徑、完整封裝、裝置憑據格式、批次限制、衝突內容及相容協商仍由 [D-API-001](DECISIONS.md#d-api-001) 追蹤：P1 S06-W03 定最小登入／資料介面，S06-W01／S11-W01 定安全 AI 入口；P2 S07-W03 定在線一致性，S13-W04 至 W07 定 worker／通知／授權 fallback；P4 S06-W04／S08-W01 定 Server 選擇及裝置授權。僅實作所需部分，寫回本文件。遷移格式及恢復要求依 [DATA_MODEL](DATA_MODEL.md#section-6-2) 與 [ARCHITECTURE](ARCHITECTURE.md#section-6-5)，不虛構已運行路由或指令。
