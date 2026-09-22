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

<a id="errors-compatibility"></a>
## 错误、兼容和未确定的实现细节

契約要求區分未授權／已撤權、配對過期或重放、舊世代、版本衝突、校驗失敗、網絡失敗、結果未知及附件未完成；界面映射到 [SPEC 確認狀態](../SPEC.md#section-4-7)，失敗或未知不能顯示成功。以上是業務條件，未固定 HTTP 狀態碼或錯誤字串。

HTTP 路徑、完整封裝、裝置憑據格式、批次限制、衝突內容及相容協商仍由 [D-API-001](DECISIONS.md#d-api-001) 追蹤：P1 S06-W03 定最小登入／資料介面，S06-W01／S11-W01 定安全 AI 入口；P2 S07-W03 定在線一致性，S13-W04 至 W07 定 worker／通知／授權 fallback；P4 S06-W04／S08-W01 定 Server 選擇及裝置授權。僅實作所需部分，寫回本文件。遷移格式及恢復要求依 [DATA_MODEL](DATA_MODEL.md#section-6-2) 與 [ARCHITECTURE](ARCHITECTURE.md#section-6-5)，不虛構已運行路由或指令。
