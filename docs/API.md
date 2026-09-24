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

<a id="api-3-3-09"></a>
这些接口用于隔离差异，不建设复杂插件平台。

<a id="api-3-3-10"></a>
介面按實際流程落碼：P1 `DataStore`／`ModelGateway`；P2 `AttachmentStore`／`KnowledgeRetriever`／`TaskExecutor`／`NotificationGateway` 及在線一致性所需 `SyncEngine`；P3 只增加 Android 平台 adapter，P4 補相容 Server 切換。共享核心隔離平台、資料庫與渠道；選人、任務及升級／fallback 規則不進渠道 adapter。

<a id="api-3-3-11"></a>
P1 `ModelGateway` 由已登入且通過資源權限檢查的 Server 請求呼叫真 Gemini／簡單 prompt。瀏覽器不接收 provider credential；Server 驗證輸入及模型結果，套用配額、總開關及有限重試，日誌不保存憑據或家庭正文。模型只回傳回答或草稿，不能繞過權威寫入及授權規則。

<a id="api-3-3-12"></a>
`KnowledgeRetriever` 接收所需內容類別及適用範圍；一般育兒問答預設穩定指引，近期查詢另用時間窗口。回傳片段連同來源／版本／日期與查核狀態供引用，快取也遵守相同過濾與停用規則。這是結果語義，不預先固定 HTTP 路由或建立第二個知識平台；字段依 [DATA_MODEL](DATA_MODEL.md#section-5-6)。

<a id="api-3-3-13"></a>
P2 檢索適用範圍包含地區、年齡依據及精度、主題與必要條件，未知保留未知；回傳結果區分有適用證據、無適用證據、來源衝突及檢索不可用，不把空結果當作容許模型補造。育兒知識回答／成長關注／安全求助提示至少一個已核對的適用官方來源，每項重要建議連具體片段／版本；Server 拒絕不存在或已失效引用。語義支持與例外依 [SPEC](../SPEC.md#req-5-6-11)，不宣稱結構校驗消除幻覺。安全求助可用仍適用的預先核對官方內容；不新增醫療分流 API。

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

以下為業務角色契約，不代表 P1 已有家庭 API；Better Auth 會話不能代替每次資源及操作授權。

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

未登入回 401，其他帳號或不存在的孩子均回 404。列表目前只提供最近 100 則，介面明示此限制；這不是完整搜尋或時間軸。客戶端不自動重試寫入，只有收到成功回應才顯示已保存；網絡失敗／結果未知保留當前表單，先重新讀取核對，沒有離線 outbox。完整 opId／版本協議留在 S07-W03。


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

<a id="api-notification-01"></a>
`TaskExecutor` 在 Server 根據事件或到期工作取得有限租約，每次執行均重查任務終態、授權版本及資源權限。模型只提供受限建議；選人、內容範圍、時機、重試及 fallback／升級由任務業務規則決定，不交給渠道 adapter。預先授權範圍內自動執行，範圍外先確認。

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

<a id="errors-compatibility"></a>
## 错误、兼容和未确定的实现细节

契約要求區分未授權／已撤權、配對過期或重放、舊世代、版本衝突、校驗失敗、網絡失敗、結果未知及附件未完成；界面映射到 [SPEC 確認狀態](../SPEC.md#section-4-7)，失敗或未知不能顯示成功。以上是業務條件，未固定 HTTP 狀態碼或錯誤字串。

HTTP 路徑、完整封裝、裝置憑據格式、批次限制、衝突內容及相容協商仍由 [D-API-001](DECISIONS.md#d-api-001) 追蹤：P1 S06-W03 定最小登入／資料介面，S06-W01／S11-W01 定安全 AI 入口；P2 S07-W03 定在線一致性，S13-W04 至 W07 定 worker／通知／授權 fallback；P4 S06-W04／S08-W01 定 Server 選擇及裝置授權。僅實作所需部分，寫回本文件。遷移格式及恢復要求依 [DATA_MODEL](DATA_MODEL.md#section-6-2) 與 [ARCHITECTURE](ARCHITECTURE.md#section-6-5)，不虛構已運行路由或指令。
