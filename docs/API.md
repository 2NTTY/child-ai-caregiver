# 接口与鉴权契约

本文件维护已确定的共享接口职责、鉴权边界及调用结果语义。以下接口名来自 v1.0，不表示代码或 HTTP 路由已经存在。字段完整定义引用 [DATA_MODEL](DATA_MODEL.md)，执行次序引用 [ARCHITECTURE](ARCHITECTURE.md)，不复制 schema 或另维护同步算法。

<a id="section-3-3"></a>
## 3.3 共享业务接口

<a id="api-3-3-01"></a>
业务层通过接口访问数据，避免各端自行定义规则：

- <a id="api-3-3-02"></a>`DataStore`：读取、保存和修订业务对象；
- <a id="api-3-3-03"></a>`AttachmentStore`：附件保存、读取和校验；
- <a id="api-3-3-04"></a>`SyncEngine`：上传、增量下载、冲突和状态；
- <a id="api-3-3-05"></a>`ModelGateway`：Gemini 解析、回答和摘要；
- <a id="api-3-3-06"></a>`KnowledgeRetriever`：查询官方知识及引用；
- <a id="api-3-3-07"></a>`NotificationGateway`：本地通知、FCM 和 Web Push；
- <a id="api-3-3-08"></a>`TaskExecutor`：检查和执行获授权任务。

<a id="api-3-3-09"></a>
这些接口用于隔离差异，不建设复杂插件平台。

<a id="api-3-3-10"></a>
七個介面按實際產品階段落碼，不為未使用能力建立空實作：P1 落實 `DataStore` 與 `ModelGateway`；P2 落實 `KnowledgeRetriever`、`TaskExecutor` 及先覆蓋站內投遞的 `NotificationGateway`；P3 才落實 `AttachmentStore`、`SyncEngine`，並把 `NotificationGateway` 擴至本地通知、FCM 及 Web Push。介面保持薄身，只隔離端別與供應商差異；共享 domain、validation、orchestration 及 tasks 規則留在業務層。

<a id="api-3-3-11"></a>
P1 的 `ModelGateway` 經最小 proxy 呼叫真實 Gemini：瀏覽器不接收 provider credential；proxy 對輸入與結構化輸出作驗證，套用配額、總開關及有限重試，日誌不記錄憑據或家庭正文。模型只回傳回答或草稿，不能繞過 `DataStore` 的確認與寫入規則。

<a id="api-3-3-12"></a>
`KnowledgeRetriever` 接收所需內容類別及適用範圍；一般育兒問答預設穩定指引，近期查詢另用時間窗口。回傳片段連同來源／版本／日期與查核狀態供引用，快取也遵守相同過濾與停用規則。這是結果語義，不預先固定 HTTP 路由或建立第二個知識平台；字段依 [DATA_MODEL](DATA_MODEL.md#section-5-6)。

<a id="section-3-4"></a>
## 3.4 身份和权限

<a id="api-3-4-01"></a>
云端采用自部署 Better Auth，账号数据保存在 PostgreSQL。它负责登录会话；家庭、孩子、个人聊天和设备权限由业务接口逐次检查。[PostgreSQL 支持](https://better-auth.com/docs/adapters/postgresql) · [Expo 集成](https://better-auth.com/docs/integrations/expo)

<a id="api-3-4-02"></a>
区分：

- <a id="api-3-4-03"></a>用户身份；
- <a id="api-3-4-04"></a>家庭成员身份；
- <a id="api-3-4-05"></a>设备凭据；
- <a id="api-3-4-06"></a>配对会话；
- <a id="api-3-4-07"></a>模型及通知服务凭据。

<a id="api-3-4-08"></a>
本地模式使用本机资料空间和设备身份，不强行依赖云端登录。转入云端时建立明确的账号与资料空间关联。

<a id="api-3-4-09"></a>
个人聊天默认私有，共享照护事件进入家庭时间轴。家庭管理员不自动获得其他成员全部私人聊天。

<a id="section-4-1"></a>
## 4.1 配对码与二维码

<a id="api-4-1-01"></a>
配对码只用于临时设备授权，不是 API key、账号密码或永久访问密钥。

<a id="api-4-1-14"></a>
配对码默认五分钟有效、单次使用，并限制尝试次数。二维码不包含儿童资料或模型密钥。涉及新的服务器地址时，先展示地址供确认。

<a id="sync-contract"></a>
## 同步调用约定

| 调用面 | 请求／返回的既定语义 | 权威依据 |
|---|---|---|
| 上传操作 | 使用 SyncOperation 字段组；先检查身份、权限、世代、版本和重复；重试返回已有确认结果或新结果 | [字段](DATA_MODEL.md#section-4-3)、[确认过程](ARCHITECTURE.md#section-4-4) |
| 增量下载 | 按 cursor 表示的客户端已接收位置获取 changeSeq 标记的变化；下载游标不代替上传操作的确认 | [changeSeq／cursor](DATA_MODEL.md#section-4-3)、[确认过程](ARCHITECTURE.md#section-4-4) |
| 附件传输 | 独立队列传输与哈希校验，正文成功不代表附件完成 | [附件定义](DATA_MODEL.md#section-3-2)、[同步过程](ARCHITECTURE.md#section-4-4) |
| 冲突／终态 | 返回可见的冲突／待核对内容，不用设备时间裁决；遵守已完成／取消的终态限制 | [冲突不变量](DATA_MODEL.md#section-4-5) |
| 撤权 | 请求执行必须遵守当前授权，不能继续接受已撤销设备上传；必要审计不含家庭正文 | [撤权行为](../SPEC.md#section-4-8)、[日志隐私](../SPEC.md#section-5-9) |
| 迁移后的旧请求 | 旧世代操作不能直接覆盖新环境；保留客户端待处理草稿 | [正式迁移](ARCHITECTURE.md#section-6-4) |

<a id="errors-compatibility"></a>
## 错误、兼容和未确定的实现细节

已有契约要求区分未授权／已撤权、配对过期或重放、旧世代、版本冲突、校验失败、网络失败和附件未完成；界面映射到 [SPEC 同步状态](../SPEC.md#section-4-7)，失败不能显示成功。以上是业务条件，并未定义 HTTP 状态码或错误字符串。

原計劃沒有確定 HTTP 路徑、完整請求／回應封裝、裝置憑據格式、分頁批次限制、衝突回傳內容和協議相容協商。保留為 [D-API-001](DECISIONS.md#d-api-001)：早期 Gemini proxy／chat 所需最小路徑在 S06-W01 與 S11-W01 的相應工作包確定；身分、同步及配對細節在 S06–S08 按當前工作包確定，並寫回本文件。遷移包相容性依據[版本化格式](DATA_MODEL.md#section-6-2)與[恢復檢查](ARCHITECTURE.md#section-6-5)。不以補齊標題為理由虛構介面或運行指令。
