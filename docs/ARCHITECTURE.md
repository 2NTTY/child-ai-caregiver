# 技术架构与运行机制

本文件管穩定契約／設計，不維護包進度或即時部署。實作與未驗項見 [PLAN](../PLAN.md#roadmap-packages)，運行觀察見 [STATUS](../STATUS.md#deployment)，測試結論只按所連 EV 的版本／範圍解讀。

本文件唯一維護組件職責、技術選擇、資料流、權威節點、在線更新、AI、通知、部署、恢復及 Gemini 成本機制。現行 Server 權威設計按 [ADR-008](DECISIONS.md#adr-008) 取代三種主庫、手機中繼及離線 outbox，保留原章節及 rule 錨點。本次不代表已驗證服務可用性；實施時按 [PLAN](../PLAN.md) 核驗實際環境與固定版本。

用户行为见 [SPEC](../SPEC.md)，完整字段见 [DATA_MODEL](DATA_MODEL.md)，调用／鉴权契约见 [API](API.md)。[DECISIONS](DECISIONS.md) 记录原因和后续未决细节，不承担第二份当前架构。

<a id="section-3-1"></a>
## 3.1 总体结构

<a id="rule-3-1-01"></a>
采用 **Expo Router＋React Native＋TypeScript**，网页与 Android 共用业务逻辑。

<a id="rule-3-1-02"></a>
整体分为六层：

1. <a id="rule-3-1-03"></a>用户界面；
2. <a id="rule-3-1-04"></a>共享业务规则；
3. <a id="rule-3-1-05"></a>Server 儲存與在線一致性；
4. <a id="rule-3-1-06"></a>身份、设备和家庭权限；
5. <a id="rule-3-1-07"></a>AI、知识检索与任务执行；
6. <a id="rule-3-1-08"></a>可部署、可备份的后端基础设施。

<a id="rule-3-1-09"></a>
模型不直接控制数据库和通知系统。所有写入及工具执行通过应用程序检查。

<a id="rule-3-1-10"></a>
六層按 P1 至 P4 的實際流程落實；P1 須具備最小 Server、PostgreSQL 及身份隔離。Web／Android 共用 TypeScript domain、validation 與協議；權威業務校驗、AI orchestration、記憶及 tasks 在 Server 執行，不能放在 UI component 或資料庫／平台／渠道 adapter。

<a id="rule-3-1-11"></a>
共享核心保持平台、資料庫及渠道解耦；育有方是唯一實作領域，將領域模型、prompt、來源及受限 skills／任務流程集中管理。只在相關功能使用邊界，不建通用實體模型、動態插件平台、registry 或第二主題。日後可從來源碼層替換領域或 adapter，不預建平台。

<a id="reuse-boundaries"></a>
### 通用能力復用邊界

保留已驗收的 ADK、Expo Router、Better Auth、Zod、pgvector、家庭授權／在線收據／加密／知識發布等成果。新增通用能力按 [AGENTS 復用規則](../AGENTS.md#technical-skills) 選型；[固定版本研究與相容性閘](TECH_REUSE.md#decisions) 是證據，不表示候選已安裝或通過本工程驗收。

新複雜表單優先驗證 React Hook Form＋現有 Zod；新前端已採納的 Paper、表單及動效繼續復用，Expo UI Universal 留作有原生控制需要的局部候選，不批量換 UI。正式整合提前採用已研究的 TanStack Query 5.103.2，限讀取快取與失效管理，沿用原 opId／收據寫入 transport；權限／Server 切換必須取消及清理快取，不能形成離線 mutation queue。P2 的 Playwright Test Web 基礎延用至後續包，保留 node:test／既有腳本；Web 證據不能替代 Android 真機驗收。

`frontend/` 從已確認的隔離預覽轉為正式應用，納入根 npm workspace 與單一 lockfile；根 Web 啟動／建置及 Docker Web 產物指向它。保留既有設計，以正式身份／資料 provider 取代合成 owner；有效的 `src/client` 控制器及 `src/shared` 契約繼續復用。舊 `app/` 測試呈現只作過渡參考，不與新前端各自保存業務資料；舊入口的退出及實際部署狀態見 [INT 計劃](../PLAN.md#production-integration)。正式畫面不掛載合成 owner，未接能力不得顯示假成功；過渡 gate 之後仍須逐項移除正式 screen 的預覽依賴。

<a id="production-ui-data"></a>
### 正式 UI 的共用資料邊界

每個領域只有一個正式 owner，向首頁、聊天及領域頁提供同源投影；PostgreSQL 資源／操作台帳保持權威。讀取 query key 包含 Server、本人、身份世代及孩子／角色 scope；登出、身份不明、撤權或切換 scope 時取消舊讀取並清理私有快取、草稿及附件，遲到回應不得寫進新 scope。頁面草稿不是第二份業務資料庫。

Agent／頁面修改成功後以實際資源 ID／版本使相關讀取失效並同步 owner；跨可見分頁／裝置沿用 changes cursor，每 5 秒只核對 metadata，回前景立即核對。一般讀頁不呼叫模型；來源變更令衍生報告標記待整理／失效，不繼續冒稱最新。寫入保留各領域的版本、原 opId、unknown 核對及授權邊界，不用 Query 的自動重試代替業務恢復。

<a id="section-3-2"></a>
## 3.2 数据存储

| <a id="rule-3-2-01"></a>组件 | 职责 |
|---|---|
| <a id="rule-3-2-03"></a>Android 在線資料存取 | 經 Server API 讀寫；不設 SQLite 業務主庫或本地 Agent |
| <a id="rule-3-2-04"></a>Android 平台儲存 | 系統安全憑據及輸入／導出必要暫存，不保存持久離線業務副本 |
| <a id="rule-3-2-05"></a>Web 在線資料存取 | 頁面狀態與未提交表單／選中照片；不設 IndexedDB 業務主庫或 outbox |
| <a id="rule-3-2-06"></a>PostgreSQL | 自 P1 起保存唯一權威業務資料、帳號；隨階段加入家庭權限、任務、審計及變更記錄 |
| <a id="rule-3-2-07"></a>pgvector | 官方知识的语义检索索引 |
| <a id="rule-3-2-08"></a>服务器附件目录 | 原文件与生成报告，使用稳定文件标识 |
| <a id="rule-3-2-09"></a>通用導出格式 | 相容 Server 之間搬遷及空環境恢復 |

<a id="rule-3-2-10"></a>
Server 業務儲存須加密，備份獨立加密及核驗恢復；實際加密機制按工作包細化。Android 憑據使用平台安全儲存，Web 會話遵守安全會話設定。密鑰、密碼及恢復資料不寫入程式碼、日誌或一般導出。

<a id="rule-3-2-11"></a>
P1 最小 Server／PostgreSQL／Better Auth 先支援合成資料可玩流程，之後完成 Server 儲存加密及最小加密備份／還原；P2 加入家庭邀請、私人隔離、附件、持續 worker、ADK 及最小 pgvector RAG；P3 Android 重用 Server；P4 擴充既有 RAG 管理／規模及維運，完成 Server 選擇、Windows 部署、完整遷移及災備。

<a id="p2-family-access"></a>
### S06-W02 家庭授權

Server 會話提供身份，業務每次按 workspace owner／目前 membership 核權；資料寫入及單一孩子讀取以 `family-access` 短交易持 workspace `FOR SHARE`，成員管理／接受邀請持 `FOR UPDATE`，取得鎖後另查 membership，與撤權串行。採用 PostgreSQL 18 的 [READ COMMITTED](https://www.postgresql.org/docs/18/transaction-iso.html) 及 [row locks](https://www.postgresql.org/docs/18/explicit-locking.html#LOCKING-ROWS)；不在持鎖期間呼叫模型或外部渠道。私人聊天另限自身擁有者，長時間生成前後及讀取既有回覆後重新核權。

撤權前已送達的資料不能從裝置收回；新操作以 Server 當前權限為準，客戶端重讀發現孩子消失／收到權限拒絕時清除該孩子緩存與草稿，不把 stale UI 當作授權。完整在線版本／重連協議留 S07-W03。邀請共享範圍、短期碼及個人偏好契約見 [API](API.md#p2-family-http)。

<a id="p1-storage-protection"></a>
### P1 加密實作邊界（S05-W01，本機已驗證）

Server 在 PostgreSQL driver 前，以 Node 24 原生 AES-256-GCM 加密孩子稱呼、文字記錄及私人聊天正文；每次新 nonce、完整 tag 與擁有者／記錄 AAD，授權讀取後才解密。密鑰檔案在工程外受 OS 權限保護；缺失／不符或未完成既有資料轉換時不啟動 Server，不回退明文。IDs、時間、角色、用量及 Better Auth 的索引／身份欄位不屬此正文加密；正式部署仍須加密磁碟、WAL 及備份儲存，不能用本機欄位測試代替環境證據。

P1 備份以 pg_dump custom snapshot 及獨立 key 加密；原 archive 只在記憶體，還原先完整驗證再送入空目標的單一交易。帳號及業務保存，臨時 session／verification 排除；沒有自動切換 Server、密鑰輪替或 P4 搬遷框架。必要限制及實際指令見 [P1 儲存操作](P1_STORAGE.md)。已獲准的本機 PostgreSQL 升級、原文一致性、刪除及備份還原驗收通過；部署磁碟／WAL 保護及交付 URL 仍須在 S16／S17 核對。

<a id="section-3-5"></a>
## 3.5 主节点与任务执行

<a id="rule-3-5-01"></a>
每個資料空間自 P1 起只有一個 Server 權威：

- <a id="rule-3-5-02"></a>Android 是在線客戶端，不安排權威任務；
- <a id="rule-3-5-03"></a>Web 是在線客戶端，分頁及瀏覽器不持有任務執行權；
- <a id="rule-3-5-04"></a>當前指定 Server 確認寫入並執行 Agent／任務；P4 遷移才切換該權威。

<a id="rule-3-5-05"></a>
主节点负责：

- <a id="rule-3-5-06"></a>确认操作和分配变化序号；
- <a id="rule-3-5-07"></a>维护任务最终状态；
- <a id="rule-3-5-08"></a>安排提醒；
- <a id="rule-3-5-09"></a>执行需要唯一结果的业务动作。

<a id="rule-3-5-10"></a>
Server 自 P2 起以持續 worker 處理事件及到期工作，瀏覽器關閉不影響執行。客戶端不得另行重複安排；平台通知 adapter 只提交或呈現 Server 已決定的投遞。

<a id="rule-3-5-11"></a>
Worker 以持久台帳、穩定邏輯鍵／occurrenceId、有限租約及冪等協調取得工作；重啟按台帳恢復，執行前重查最新授權及完成／取消狀態。只有事件或到期事項需要推理時才作有限 AI 呼叫；不以模型空轉輪詢，也不建大型 Agent 平台。外發結果未知時先核對投遞嘗試，不以租約到期作盲目重發理由。

<a id="p2-worker-reuse"></a>
### S13-W04 worker 採用邊界

優先驗證 pg-boss 12.34.0 作 PostgreSQL worker；Graphile Worker 0.17.3 作比較候選，其預設 hard-kill 恢復不合本次數分鐘恢復目標。框架負責 job 持久化、排程／領取、heartbeat、有限重試及停止；項目保留家庭授權／世代、occurrenceId、終態、投遞去重／unknown、安靜時段／跟進上限及全邏輯工作重試預算。job 完成不等於照護任務完成，框架唯一 job 亦不保證外部副作用 exactly-once。

業務台帳與入列須共用 PostgreSQL transaction，job 只保存 ID／參照；每次執行重新核權及台帳，外部呼叫不持有業務交易。S10-W02 復用同一 worker 與既有知識 hash／發布流程。採用須通過交易回滾、雙 worker、hard-kill／分鐘級恢復、取消／撤權、unknown 不重發及備份還原不復活終態等驗證；具體版本／配置假設與成本見 [worker 研究](TECH_REUSE.md#worker)。S13-W04 已隨 PR #48 合併並通過必要本機驗收；S10-W02 接入同一 pg-boss 原生 cron，來源觀察、人工核對與發布仍分開，新增接線待本包驗收。

<a id="section-3-6"></a>
## 3.6 AI、通知与部署

- <a id="rule-3-6-01"></a>平台 Gemini 經 Vertex ADC 接入；S06-W05 增補本人 Gemini Developer API key 模式，首版同為 `gemini-3.1-flash-lite`，模型由 Server 固定相容清單，不接受任意網址或 headers。兩模式共用既有 ADK／工具／來源及單次限額，模型 key 模式不另建 Agent。
- <a id="rule-3-6-02"></a>使用结构化输出生成记录或任务草稿，经过校验和必要确认后写入。
- <a id="rule-3-6-03"></a>数量统计、权限、排程、重复检查和完成状态由程序处理。
- <a id="rule-3-6-04"></a>P2 經渠道無關的 NotificationGateway 送出 Web Push 及 Telegram，P3 增加 FCM；Android adapter 不承擔選人、排程或 fallback 決策。
- <a id="rule-3-6-05"></a>通知权限关闭或平台不支持时，界面显示具体状态。
- <a id="rule-3-6-06"></a>PDF 由统一报告模块生成，两端负责预览、下载和分享。
- <a id="rule-3-6-07"></a>採用 Docker Compose 部署所需 API、worker、PostgreSQL 及入口服務；P4 交付 Windows 少步部署，接受 Docker Desktop／WSL2 作前置。
- <a id="rule-3-6-08"></a>自有 Windows 與雲端沿用相容服務定義；初期可用既有 GCP 資源。自有部署不代表 Gemini 零第三方傳輸，仍遵守授權與最小上下文。
- <a id="rule-3-6-09"></a>不把数据库直接暴露到公网；远程连接使用 HTTPS／WSS。

- <a id="rule-3-6-10"></a>首次 Server／模型請求起便有登入及資源權限檢查、憑據隔離、應用配額、總開關及有限重試。供應商憑據只留 Server；日誌不記錄憑據、家庭正文或私人附件。
- <a id="rule-3-6-11"></a>P1 交付最小 Server／PostgreSQL／Better Auth、Web 記錄聊天與 Gemini 簡單 prompt，階段結案時提供真 URL。P2 以 ADK 接通完整當前 orchestration、最小向量 RAG、持續 worker、家庭權限、Web 附件、主動任務、Web Push／Telegram 及公共更新。P3 Android 重用同一 Server，P4 補完整部署／遷移／災備及 RAG 維運擴充；不因使用框架而提前建立未需平台。

<a id="portable-core"></a>
核心資料、任務、附件、權限及確定性規則由自有 Node／PostgreSQL／pgvector／worker／Compose 承載，不依賴只能在 GCP 運行的核心服務。平台 Gemini 維持 Vertex，可使用 GCP 以外 ADC；個人 key 接入見 [S06-W05](#personal-model-routing)。自部署不代表離線 Gemini。S17-W05 須驗證沒有 GCP 附加身份、關閉 AI 時核心資料與確定性任務仍可用，模型及外部通知另按憑據／授權驗證。

渠道薄 adapter 優先驗證 web-push、grammY 及 Expo Notifications；FCM Server 先用官方 Google Auth＋單次 HTTP v1 請求，以免 SDK 隱藏重試繞過 unknown／去重規則。版本、許可及 Firebase Admin 未優先採用的證據見 [渠道研究](TECH_REUSE.md#channels)。選人、授權、排程、fallback 與投遞台帳仍由項目控制；採用與驗收按 [工作包](../PLAN.md#roadmap-packages) 分列；Web Push／Telegram 的既有證據不代替 P3 FCM。

<a id="p2-agent-runtime"></a>
### 3.6A P2 ADK 產品 Agent（S11-W03 基礎已實作）

S11-W03 已交付 [內部 AgentRuntime](../server/agent-runtime.ts)、[模型 adapter](../server/agent-model-gateway.ts) 及 [Prompt Pack 組裝器](../server/agent-prompt.ts)，完成真 Runner scripted 檢查及獲批的兩次 Vertex／Gemini 呼叫及一次工具循環驗收，見 [EV-S11-W03](../artifacts/verification/S11_W03_CHECKS.json)。該證據只覆蓋 `text`／`tool_cycle` 配方基礎；產品配方接線見下文，公開交付另見 [S17-W02](../artifacts/verification/S17_W02_CHECKS.json)。工具 schema 描述是模型指引，仍由主模型維護。

S11-W02 的互動／背景 [產品 Agent](../server/product-agent.ts)、[受限工具](../server/product-agent-tools.ts)及[確認台帳](../server/product-agent-store.ts) 沿用同一運行邊界。API 與 worker 共用服務組裝、配额及運行限額；以 `P2_AGENT_ENABLED=true` 明確啟用，預設保留 P1。Prompt Pack 按 product-interactive／product-background 配方復用，最終文字不作第二次副作用入口。

到期提醒與 `agent-task-due-v1` 入列共用原交易，只带 reminder／work ID 及原 worker generation／storage epoch；模型等待不持有 SQL 交易。領取及每次工具前重查任務版本／發生實例／終態、指派人及原授權人；還原後舊事件不能因重新啟用而復活。固定事件只建立一個 run，重啟查原台帳，已開始的模型循環不盲目重跑。背景先提供只屬原照顧者的站內說明；外發及成長候選分屬 S13-W07／S13-W08，沿各自契約及授權。

本人互動只載入必要近期訊息、已確認事實及可追溯摘要；背景只用家庭 scope。完整摘要批次在既有覆蓋規則下核對保存，與 run 完結共用交易，不自動提升推斷或改話題／任務終態。功能 UI 的官方求助入口在模型／檢索前保持可見，來源是 2026-09-28 核對的[消防處先遣急救員資料](https://www.hkfsd.gov.hk/chi/fire_ambulance_services/responder.html)及[召喚救護指引](https://www.hkfsd.gov.hk/chi/fire_ambulance_services/fire_information.html)，不建立症狀分類、診斷或自動致電。

診斷採原生 BasePlugin，僅允許 runId、階段、已知工具名／狀態及耗時；預設停用，`AGENT_DIAGNOSTICS=true` 才寫 metadata。保留 ADK content capture 關閉，沒有新增 OTel exporter／憑據；sink 失敗不影響流程。診斷本身的 scripted Runner／observer 檢查不等於所有端到端情景已驗；產品真服務／SQL／通知證據分見 [S11-W02](../artifacts/verification/S11_W02_CHECKS.json)／[S16-W02](../artifacts/verification/S16_W02_CHECKS.json)，按實際測試範圍判斷。

<a id="rule-adk-01"></a>
採用 Google ADK TypeScript `@google/adk 2.1.0`，在現有 Node／GCP Compose Server 使用一個產品 `LlmAgent`／`Runner`；按受信入口、事件及所需任務配方暴露 `FunctionTool`，由 ADK 實際執行多步工具循環。S11-W03 先完成相容性基礎，S11-W02 才接通完整記憶／知識／任務能力。沿用 Node 24.19，npm 於 S11-W03 調整至 11.8.0 並同步建置及 lockfile；固定依賴、許可、現有 Gemini 型號／Vertex ADC／TypeScript 相容性須在接入驗證，不把本次文件當成安裝或實測。

<a id="rule-adk-02"></a>
Server 的 `AgentRuntime` 統一接收互動或 worker 事件，注入身份、孩子／資料空間、觸發及授權／資料版本、工具集合。ADK 處理理解、選擇工具及依結果繼續推理；每個工具處理器仍經 DataStore、KnowledgeRetriever、TaskExecutor 等服務校驗參數、權限、來源、終態及冪等後才執行。權威 SQL、排程及投遞不交給模型或框架 session。未知工具、非法參數及資料正文中的指令不能擴大能力。

<a id="rule-adk-03"></a>
產品 skills 是既有 [Prompt Pack manifest／配方](../prompts/README.md) 的任務指引、受限工具及輸出契約；依 manifest 組裝、依賴核對及去重，只載入所需正文並保留安全核心／香港育兒語氣。ADK 原生 SkillToolset 尚屬實驗性，首版核心不依賴它，也不宣稱已使用。開發技術 Skill 依 AGENTS 按需沉澱，不能代替產品配方或項目權威。

<a id="rule-adk-04"></a>
ModelGateway 的 ADK 接入保留原始 function call／response parts、呼叫關聯及 provider 必需的 opaque metadata，不能沿用 P1 的純文字 flatten／拒絕工具路徑。Vertex API v1、ADC、SDK 自動重試關閉、逾時／取消及每次調用配額由接入層維持；opaque metadata 不解讀、不展示、不寫入一般日誌。工具參數用 schema，候選／確認／背景結果按需結構化，一般聊天仍可自然文字；工具與最終 schema 若不支援同次組合，必要獨立收尾仍計入同一運行預算，不固定為每輪純聊天加一次呼叫。

<a id="rule-adk-05"></a>
ADK session 首版只保存單次運行協定上下文；Server 保存已確認事實、摘要、待確認事項及操作／投遞台帳。背景工作只取得可向目標範圍披露的已確認資料。回覆確認須重查原事項、內容版本及權限；重啟先核對既有操作／未知投遞，再由權威資料建立新運行，不依賴框架原生暫停續跑或恢復模型推理。重建 run 不重設邏輯工作原有的有限重試／跟進上限。

<a id="rule-adk-06"></a>
原生工具呼叫是本運行副作用入口；最終 `actionRequests` 或文字只是候選／結果語義，不再觸發第二次執行。工具已成功而文字生成失敗，按台帳交代已完成、未完成或 unknown。UI 只顯示經權限／版本核對的來源及工具／任務進度，不把模型內部推理或未核對串流當執行證據。

<a id="p2-adk-native-reuse"></a>
### ADK 原生能力的採用條件

已核對 TypeScript 2.1.0 的 DatabaseSessionService／PostgreSQL 支援，現時仍沿用已實測的單次 InMemorySession：持久 Session 會增加 ORM driver、另一組 JSON 表及加密／刪除／備份責任，尚無必需使用情境。SkillToolset 已調查但屬 experimental，維持現有 Prompt Pack／受限工具，不重建技能平台。

S11-W02 優先以 BasePlugin 及 ADK 原生 spans 接最小 metadata 診斷，可用單一標準 OpenTelemetry provider／本地 OTLP；不預設開啟會記正文的 LoggingPlugin、通用自動重試或 GCP exporter。observer 不得短路／改寫業務結果，診斷 sink 失敗不阻斷業務；保留 content capture 關閉，另驗 exporter allowlist。TS devtools 已有 conformance 工具，但不能直接充當產品品質評測；S16-W02 復用現有 scripted Runner 與有限真 Gemini 情境。官方原碼、版本、實驗性範圍及未驗證項見 [ADK 研究](TECH_REUSE.md#adk)。

<a id="p2-agent-budgets"></a>
### 3.6B P2 初始有界運行配置

| 限制 | 初始值／計算範圍 |
|---|---|
| 生成模型呼叫 | 每 run 最多 4 次，包含修正／獨立收尾 |
| 工具調用 | 每 run 最多 8 次，失敗、被拒絕及未知工具嘗試也計入 |
| 查詢 embedding | 每 run 最多 2 次 API 嘗試；相同查詢／模型／維度在該 run 內復用 |
| 總期限 | 90 秒，模型、embedding 及工具共用同一 deadline |
| 生成輸出 | 每次最多 1,024 output tokens |
| 文字上下文 | 每次最多 32,000 字元，含指令、文字資料及工具 schema；不把字元當 token |

<a id="rule-adk-07"></a>
上述為 P2 接入初始配置，不能沿用 ADK 寬鬆預設或讓 SDK 隱藏重試。取消／到期阻止新操作，但不保證撤回已接受的外部投遞；保留並核對實際結果。超限時不靜默刪除必要授權、來源條件或未完成 call／response 配對，不擅自提高上限。

<a id="rule-adk-08"></a>
所有前景／背景／維護呼叫記實際使用量並受全局開關及配額控制，不能把整個 Agent run 當一次 API。語料向量建立是獨立、有有限批次及次數上限的維護工作，不套用每 run 兩次查詢限制；執行前預覽片段數及必要成本，未變 hash 不重算。P1 現網額度不因文件定案而上調；P2 啟用額度及真服務驗收另按批准範圍處理。

<a id="p2-adk-evidence"></a>
2026-09-24 已核對官方 [TypeScript 要求](https://adk.dev/get-started/typescript/)、[2.1.0 固定依賴／許可](https://github.com/google/adk-js/blob/adk-v2.1.0/core/package.json)、[模型接入](https://github.com/google/adk-js/blob/adk-v2.1.0/core/src/models/google_llm.ts)、[RunConfig](https://github.com/google/adk-js/blob/adk-v2.1.0/core/src/agents/run_config.ts)、[工具安全](https://adk.dev/safety/)及[實驗性 Skills](https://adk.dev/skills/)。這是文件／原文依據；真 Runner scripted 測試與真 Gemini 是不同驗收，不能假設其他語言的原生 resume／confirmation 行為已在本產品 TypeScript 路徑驗證。

<a id="section-4-2"></a>
## 4.2 裝置授權與 Server 連接

<a id="rule-4-2-01"></a>
QR／短碼只授予裝置連接 Server 的權限：

- <a id="rule-4-2-02"></a>新裝置向 Server 建立短期授權會話；
- <a id="rule-4-2-03"></a>既有獲授權裝置核對 Server 地址及權限並確認；
- <a id="rule-4-2-04"></a>Server 簽發獨立可撤銷憑據，QR／短碼及日誌不含家庭正文、附件或模型密鑰；
- <a id="rule-4-2-05"></a>授權後新裝置直接連接 Server；手機斷線不影響其已授權連線；
- <a id="rule-4-2-06"></a>臨時會話按期限／登出失效並清理頁面資料，不提供持久離線副本。

<a id="rule-4-2-07"></a>
連線使用 TLS；此流程不是手機資料中繼，不建 WSS 中繼、WebRTC、STUN／TURN 或自製端對端加密協議。替代映射見 [ADR-008](DECISIONS.md#adr-008)。

<a id="section-4-4"></a>
## 4.4 在線寫入、更新及確認

1. <a id="rule-4-4-01"></a>當前畫面保留待提交表單及選中照片；不建立本地業務交易或持久 outbox。
2. <a id="rule-4-4-02"></a>提交前顯示「尚未保存」，連線失敗時保留當前輸入並提示重試。
3. <a id="rule-4-4-03"></a>使用者在線提交或重連後重試同一邏輯操作。
4. <a id="rule-4-4-04"></a>Server 檢查身份、當前權限、世代、版本及 opId，再以事務提交權威變更。
5. <a id="rule-4-4-05"></a>成功時回傳已存在的冪等結果或新確認結果；逾時但結果未明則提供原操作核對途徑。
6. <a id="rule-4-4-06"></a>客戶端取得確認後更新畫面，並以版本／游標取得其他已授權變更。
7. <a id="rule-4-4-07"></a>附件獨立傳輸及核對 hash；中斷不冒充附件完成，重連按確認狀態重試。
8. <a id="rule-4-4-08"></a>所需正文與附件均獲 Server 確認後才顯示全部完成。

<a id="rule-4-4-09"></a>
同一邏輯重試保留 opId，結果未知先查核；SyncEngine 僅協調在線更新、版本、確認及錯誤，名稱與錨點保留，不保留離線框架。未提交輸入只限當前畫面；重新整理／關閉前提示，不跨關閉保存本地草稿。

S07-W03 已接 [online HTTP](API.md#online-http) 及[操作台帳](DATA_MODEL.md#online-storage)：Server 先取得本人 opId 的交易鎖，再按既有 workspace 鎖順序重新核權，將業務寫入、變更序號及加密收據一起提交。局部 store 使用同一 connection 的 savepoint；只有外層能 commit。讀取收據取得父鎖後重新讀台帳，避免等待刪除期間沿用已被抹除的舊正文。回覆丟失後查原收據；已確認但正文被刪不重做副作用。

Web 只在可見頁面週期讀取變更與現況，焦點／重連也重新核對；不依賴畫面文字相同推斷寫入成功。個人草稿、共享資料及私人聊天分開清理；版本衝突保留輸入並要求比較，分頁變動要求重讀。舊入口保留相容，新功能於 migration 010 存在時才啟用。模型生成不放入在線交易；後續 Agent／worker 另沿既定任務及外發台帳執行，不把本頁輪詢當背景 worker。

<a id="section-5-4"></a>
## 5.4 长期记忆

<a id="rule-5-4-01"></a>
每次模型请求按需组合：

1. <a id="rule-5-4-02"></a>稳定规则；
2. <a id="rule-5-4-03"></a>当前孩子及已确认事实；
3. <a id="rule-5-4-04"></a>活动任务和相关完成状态；
4. <a id="rule-5-4-05"></a>会话摘要；
5. <a id="rule-5-4-06"></a>最近消息；
6. <a id="rule-5-4-07"></a>查询到的相关历史；
7. <a id="rule-5-4-08"></a>必要官方知识片段。

<a id="rule-5-4-09"></a>
P2 的孩子上下文保留年齡精度、日期基準及實際／矯正年齡的適用依據；由程式計算，不讓模型猜出生日期或把約數變精確。AI 候選經使用者確認後才進入長期事實，寫入和分享範圍分開確認。家庭背景工作只取得其展示對象有權讀取的已確認資料；不從其他成員私人聊天補齊家庭背景。

<a id="section-5-5"></a>
## 5.5 任务台账

<a id="rule-5-5-09"></a>
只有當前 Server 安排提醒。完成確認與終態轉換使用事務及冪等控制，避免兩位照顧者並發操作重複完成或復活任務。

<a id="rule-5-5-10"></a>
模型行動建議先與現有任務及當前授權比較。預先確認的對象、內容、渠道及 fallback 範圍內可自動建立、跟進及外發，毋須逐次人工確認；超出範圍才請求確認。普通聊天或外部內容不直接變更排程或執行授權。

<a id="rule-5-5-11"></a>
Agent 可從 Server 提供的合資格照顧者中提出選擇及理由；任務服務按明確指派、預設負責人及預授權備援規則核准，資料不足先補問，不猜測誰有空。任務服務仍負責時間、有限跟進及 fallback／升級決策；NotificationGateway adapter 只按已核准對象和內容投遞。每次外發前核對授權版本、家庭成員權限、渠道綁定、任務終態及既有投遞；Telegram 接收者須先啟動 bot 並完成綁定。

<a id="rule-5-5-12"></a>
渠道接受不等同送達、已讀或任務完成。已知可重試失敗按有限規則處理；結果未知先查核供應商回執或既有投遞，不盲目重發或換渠道。fallback 必須在預先授權範圍內，記錄原因與終止狀態；撤權、取消、完成或授權不符即停止。已被渠道接受的內容不能保證撤回，須如實記錄競態結果。

<a id="rule-5-5-13"></a>
分享、貼上、上傳、公開來源及附件解析內容均屬不可信輸入。Server 保留來源及確認邊界，內容不能自行取得工具權限、覆寫 prompt／穩定規則、成為孩子事實或建立未授權動作。

<a id="persistent-worker"></a>
S13-W04 以獨立 Node worker 及固定 pg-boss 12.34.0 接上手動任務。API、opId 收據、任務變更、業務工作與 `boss.send({db})` 共用同一交易 client；worker 不依賴 Web 存活。框架負責到期領取、heartbeat、有限重試及 shutdown，業務在 workspace 排他鎖後重查確認者／負責人資格、epoch／generation、版本及終態，再寫唯一站內提醒。改期或完成令舊 job 失效；處理成功但框架確認回應遺失時，重領先核對台帳，不新增第二筆有效結果。SQL 交易內沒有模型或外部渠道呼叫。

安靜時段及普通提示上限以收件人偏好計算下一個 UTC 檢查點；不靠空轉模型輪詢。每個邏輯工作最多三次失敗，延期不重置累積預算；framework 失敗／遺失反映為 failed／unknown，不能當照護完成。新安裝與備份還原預設暫停，世代及 jobId 防止舊工作重放；啟用前須確認唯一有效來源及恢復資料。[操作](P2_WORKER.md)／[資料](DATA_MODEL.md#task-worker-storage)／[介面](API.md#p2-task-worker-http)。這包只接站內效果，Gemini、知識更新、外發及 fallback 留在其既有後續工作包，不宣稱外部 exactly-once。

<a id="growth-attention-flow"></a>
### 5.5A 成長階段關注流程（S13-W08／P2）

- <a id="rule-ga-01"></a>在既有 Server domain／tasks 內加入有限的官方關注規則及適用判斷，重用持久 worker、KnowledgeRetriever、事實與任務台帳，不另建醫療分流引擎、通用規則平台或第二套 scheduler。規則已發布、來源仍適用才可用；模型只能解釋或提出受限候選，不能自行修改規則。
- <a id="rule-ga-02"></a>流程為：相關階段邊界／已確認事實或預約變更／到期事項／官方規則實質變更 → 取得獲授權上下文 → 程式檢查適用性、資料精度、主題停用、處理歷史及去重 → 必要時作有限推理 → Server 校驗依據及權限 → 保存站內關注或 no_action。缺資料可提出有界補問，不把未知當未完成；無新條件不呼叫模型。
- <a id="rule-ga-03"></a>規則依各自官方依據選擇實際或矯正年齡；不確定年齡不能符合精準窗口。排程保存下一個相關檢查點或事件條件；到點重查，不要求瀏覽器開啟，也不每日對所有家庭空轉模型。來源實質更新經核對發布後才觸發，單純抓取時間變動不觸發。
- <a id="rule-ga-04"></a>候選、確認／預授權任務、occurrence 及投遞維持獨立語義。關注轉任務先對照已確認預約及既有任務，沿用可追溯關聯與唯一性；改期／暫緩更新既有安排。已關閉事項的新實質依據可產生有原因的新候選，不能復活舊終態；永久停用優先，重新啟用須明確操作。
- <a id="rule-ga-05"></a>家庭共享關注以可見範圍、孩子、主題、階段及實質觸發依據去重，與個人通知偏好分開。完成、更正、取消及撤權沿用事務／版本控制；投遞前重查當前終態及關注有效性。個人時區、安靜時段、合併頻率及跟進上限由任務服務處理，adapter 不自行加發，渠道重試／fallback 不能繞過接收者的限制。
- <a id="rule-ga-06"></a>S11-W02／S13-W08 復用既有 [Prompt Pack](../prompts/README.md) 的知識問答、主動執行及安全模組，隨能力接線補入可信上下文、來源門檻及關注操作；不重建 Pack。P1 已接線 prompt 不因本次文件要求而改動，模組存在不代表 P2 已實作。

<a id="section-5-6"></a>
## 5.6 官方育儿知识库

<a id="rule-5-6-07"></a>
资料流程：

<a id="rule-5-6-08"></a>
**登记来源 → 获取正文 → 清洗 → 分段 → 保存版本 → 生成向量 → 审核发布 → 检索引用 → 检查更新。**

<a id="rule-5-6-09"></a>
知識分三層交付：S10-W01／P2 直接建立小型官方 pgvector RAG 核心，含 embedding、版本、核對發布、停用及必要恢復；S10-W02／P2 接共用 worker 作公共來源排程及受影響片段更新；S10-W03／P4 擴充完整管理頁、大規模導入、批量重建管理、效能及完整遷移。三者沿用同一份知識／向量／引用，不建另一套過渡核心。P2 可用可重複執行的匯入、核對及發布指令，不提前建管理平台。

<a id="rule-5-6-10"></a>
P2 問答 orchestration 必須取得適用的已發布官方片段及引用識別，限制模型只引用提供的證據；Server 校驗引用存在、版本／適用條件及來源啟用狀態，缺失時拒絕無依據的具體建議並呈現限制。每項重要說法是否真正獲片段支持仍須在內容 review 及驗收中核對，不把 metadata 校驗當成語義正確性保證。 背景成長關注採較窄的呈現方式：Agent 檢索並選取本次已登記的官方片段，Server 重查有效性後直接組裝已核對正文與引用，不使用模型改寫的照護建議；無片段時只呈現固定限制說明。此策略由 Server 事件決定，不受模型的答案分類影響；當下原因及家長操作仍以關注卡片為準。互動問答維持原契約，不能把此局部限制視為其語義品質已全面驗證。純澄清／操作確認／家庭資料回述不硬配公共引用；近期資訊保留分類邊界。

<a id="rule-5-6-11"></a>
安全求助使用已核對官方內容及明確來源；檢索暫時失敗時可取預先核對且仍適用的求助內容，不讓模型編造閾值或因等待工具而延誤顯示。已知失效內容停用，不能以 fallback 為由復用；不建立臨床分級或自動醫療外發。有限合成案例只證明該案例行為，不證明臨床有效性。

<a id="section-5-7"></a>
## 5.7 向量检索与更新

<a id="p2-vector-rag"></a>
P2 最小向量 RAG 的資料／接口語義分別見 [DATA_MODEL](DATA_MODEL.md#knowledge-vector-model)／[API](API.md#knowledge-retrieval-contract)，此處維護選型及處理次序。

- <a id="rule-5-7-01"></a>P2 在現有 PostgreSQL 18.6 同 major 映像加入固定版本 pgvector；固定版本及許可在 S10-W01 落實，保留資料目錄及既有正文保護。備份與空庫還原目標須具備相容擴展；本次文件不代表已升級或驗證。
- <a id="rule-5-7-02"></a>初始 embedding 使用 `gemini-embedding-001`、1024 維，公共語料維護沿用 Server Vertex ADC，查詢按 [本人模型路由](#personal-model-routing) 選擇；文件使用 RETRIEVAL_DOCUMENT，查詢使用 RETRIEVAL_QUERY。超長內容重新分段，不靜默截斷限定條件；只向量化公共知識，不注入整份聊天／孩子檔案。
- <a id="rule-5-7-03"></a>按标题和语义分段，保留限定条件及必要上下文。
- <a id="rule-5-7-04"></a>先按年齡依據／精度、地區、主題、知識分類、已發布及有效版本作硬性過濾，再以 cosine distance 做精確向量搜尋；相似度不繞過適用條件。小型庫先不用近似索引，後續按實測延遲／規模加入 HNSW 等索引，沿用既有向量。
- <a id="rule-5-7-05"></a>同時保留標題及主題關鍵詞匹配，與向量檢索共用硬性過濾，以 RRF 合併排序及去重；關鍵詞為長期補充，不另建資料模型。
- <a id="rule-5-7-06"></a>每次最多提供六個相關片段，按上下文預算保留完整必要條件；不足便補問／明示限制，不將最近似片段當正確答案，也不為湊數放入無關內容。
- <a id="rule-5-7-07"></a>答案引用具体来源片段，不能只附一个无关首页链接。

<a id="rule-5-7-08"></a>
更新时：

- <a id="rule-5-7-09"></a>内容未改变，不重复生成向量。
- <a id="rule-5-7-10"></a>实质变化只重建受影响段落。
- <a id="rule-5-7-11"></a>旧索引停用，历史报告仍能追溯旧版本。
- <a id="rule-5-7-12"></a>生成失败保留明确状态，不把未完成索引当作已发布。
- <a id="rule-5-7-13"></a>更换 embedding 模型或维度时，重建对应索引，不混用不兼容向量。
- <a id="rule-5-7-14"></a>新闻资讯与育儿指导分开管理；指导变化不自动成为家庭照护规则。
- <a id="rule-5-7-15"></a>以 `knowledgeClass` 或等效分類分開 `stable guidance` 與 `recent news`；穩定指引只接受已核對官方來源，指定媒體只供近期資訊。一般育兒檢索預設只取穩定指引，近期資訊按需要明確加入，預設窗口七日。
- <a id="rule-5-7-16"></a>穩定官方知識每週檢查，hash 未變則不重新生成 embedding；實質變更經核對才發布，只重建受影響內容。近期資訊每日檢查，初期以來源 ID／原文 URL 基本去重，不做媒體評分、複雜跨來源去重或付費 News API。
- <a id="rule-5-7-17"></a>發佈／修訂時間、擷取時間與最後成功檢查時間分開保存；近期來源超過 24 小時未成功查核不得稱為最新。官方有效期另存，七日窗口不得當成官方或法定期限；缺來源發布日期不以抓取時間代填。
- <a id="rule-5-7-18"></a>已知失效來源停用；抓取失敗保留最後成功版本及狀態。近期資訊只供按需展示與引用，不寫入長期育兒規則、孩子事實或自動家庭任務。
- <a id="rule-5-7-19"></a>共用抓取與引用工具，不合併兩類的發布／檢索／快取有效性。快取結果也須檢查分類、查詢窗口、來源版本、停用及新鮮度；讀取快取不刷新成功查核時間。P2 不為更新來源建立消息隊列、完整爬取平台或新聞分析服務。

<a id="rule-5-7-20"></a>
embedding 暫時不可用時，可返回仍符合相同條件的關鍵詞結果並標示降級／原因；不足時明示限制。降級不算向量流程通過。候選新版須完成核對及向量生成才發布；生成失敗不冒充完成，已知失效舊版即停用，歷史引用仍能追溯。

<a id="p2-rag-evidence"></a>
S10-W01 已在實作固定 pgvector `0.8.6`／commit `8ee86c96f0fd72390f890aa8a336fda6d3ab4c6c`；採用同版 PostgreSQL multi-stage 映像及公共資料 migration，既有 volume 保留。有限語料、指令、精確／RRF 排序、用量與降級見 [操作與限制](P2_KNOWLEDGE.md)，可復用 SDK／擴展約束見 [技術 Skill](../.agents/skills/postgres-vector-knowledge/SKILL.md)。真擴展、embedding、資料保留及備份還原的版本化結果見 [S10-W01](../artifacts/verification/S10_W01_CHECKS.json)，不代表現時服務可用性。

2026-09-24 核對 [pgvector 精確搜尋／過濾及索引](https://github.com/pgvector/pgvector#querying)、[固定版本建置參考](https://github.com/pgvector/pgvector/blob/v0.8.6/Dockerfile)、[Gemini embedding 維度](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/embeddings/get-text-embeddings)及[task types](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/embeddings/task-types)；其後亦核對固定 GenAI 2.24.0 的參數／回應映射。這些文件與 SDK 原始碼依據不當作真服務證據。

<a id="section-5-8"></a>
## 5.8 摘要与报告

<a id="rule-5-8-10"></a>
数字和总量由程序计算，AI 负责表达。记录更正后生成新报告版本，不继续复用旧结论。

<a id="section-6-3"></a>
## 6.3 不同用途的备份

| <a id="rule-6-3-01"></a>类型 | 用途 |
|---|---|
| <a id="rule-6-3-03"></a>用户资料导出 | 用户读取、保存和跨设备搬迁 |
| <a id="rule-6-3-04"></a>加密迁移包 | 完整恢复一个获授权资料空间 |
| <a id="rule-6-3-05"></a>PostgreSQL 备份 | 服务器灾难恢复 |
| <a id="rule-6-3-06"></a>附件备份 | 恢复原文件及报告 |
| <a id="rule-6-3-07"></a>配置与密钥备份 | 恢复服务连接及加密能力，独立安全管理 |

<a id="rule-6-3-08"></a>
临时模型缓存不属于必要迁移资料。账号密码使用安全哈希保存；普通导出不包含明文密码或服务密钥。

<a id="section-6-4"></a>
## 6.4 正式迁移过程

1. <a id="rule-6-4-01"></a>检查目标兼容性和可用空间。
2. <a id="rule-6-4-02"></a>檢查未確認請求、版本衝突、進行中 worker 工作及投遞嘗試。
3. <a id="rule-6-4-03"></a>核對已提交但未回應的結果，提示使用者處理當前未提交表單；不假設另有離線修改佇列。
4. <a id="rule-6-4-04"></a>暫停舊 Server 寫入及新任務，收斂或記錄進行中工作。
5. <a id="rule-6-4-05"></a>生成一致性快照和附件清单。
6. <a id="rule-6-4-06"></a>导入空目标，默认保持任务暂停。
7. <a id="rule-6-4-07"></a>核對記錄數量、附件 hash、帳號／家庭權限、授權版本、渠道綁定及任務／投遞狀態。
8. <a id="rule-6-4-08"></a>更新主节点及 `storageEpoch`。
9. <a id="rule-6-4-09"></a>切换客户端连接。
10. <a id="rule-6-4-10"></a>确认旧节点停止后，再启用新节点。

<a id="rule-6-4-11"></a>
舊世代請求不能覆蓋新環境；在當前畫面保留未確認輸入並提示核對原結果後重新提交。遷移台帳保留結果未知的投遞，避免新 worker 當作未發送而重發；不建立跨關閉 outbox 或離線草稿恢復承諾。

<a id="section-6-5"></a>
## 6.5 灾难恢复

<a id="rule-6-5-01"></a>
恢复环境先处于只读／任务暂停状态，完成检查后才恢复正常操作。

<a id="rule-6-5-02"></a>
恢复检查覆盖：

- <a id="rule-6-5-03"></a>数据库格式是否支持；
- <a id="rule-6-5-04"></a>账号和家庭关系是否完整；
- <a id="rule-6-5-05"></a>附件是否缺失；
- <a id="rule-6-5-06"></a>任務終態、授權版本、渠道綁定及投遞嘗試是否完整；
- <a id="rule-6-5-07"></a>向量索引是否可用；
- <a id="rule-6-5-08"></a>通知与模型凭据是否有效；
- <a id="rule-6-5-09"></a>是否仍有旧节点正在执行任务。

<a id="rule-6-5-10"></a>
无法恢复的附件或来源明确列出，不假装完整恢复。

<a id="section-6-6"></a>
## 6.6 Rollback

- <a id="rule-6-6-01"></a>切换前保留可验证的旧环境备份。
- <a id="rule-6-6-02"></a>新环境尚未接收新数据时，可以恢复旧环境。
- <a id="rule-6-6-03"></a>新环境已有写入时，先带回新增数据，再回滚，不能直接丢弃新记录。
- <a id="rule-6-6-04"></a>不盲目把新格式数据库交给不兼容的旧程序。
- <a id="rule-6-6-05"></a>回滚后仍须保证只有一个节点执行提醒。
- <a id="rule-6-6-06"></a>不补发整段停机期间的所有过期通知；遗漏事项集中显示为待处理。

<a id="rule-6-6-07"></a>
更换域名或服务器后，可以要求重新登录和登记推送权限，但聊天、家庭关系与任务完成状态必须保留。

<a id="section-9-1"></a>
## 9.1 两套成本独立记录

<a id="rule-9-1-01"></a>
分别管理：

1. <a id="rule-9-1-02"></a>**使用 GPT／Codex 开发项目的消耗；**
2. <a id="rule-9-1-03"></a>**软件运行时 Gemini、embedding、数据库、存储及服务器费用。**

<a id="rule-9-1-04"></a>
不把订阅额度、模型 API 费用和 GCP 赠金混为同一种成本。

<a id="section-9-3"></a>
## 9.3 Gemini 运行阶段

<a id="rule-9-3-01"></a>
优先减少不必要调用：

- <a id="rule-9-3-02"></a>同步、配对、权限、冲突检测、统计和排程不调用模型。
- <a id="rule-9-3-03"></a>没有新资料或值得处理的任务时，不唤起模型轮询。
- <a id="rule-9-3-04"></a>每次只发送相关历史、事实、任务和知识片段。
- <a id="rule-9-3-05"></a>不发送完整聊天库或整套官方知识库。
- <a id="rule-9-3-06"></a>摘要增量更新，不每句话重做全部总结。
- <a id="rule-9-3-07"></a>同一录音、图片和文章按哈希复用处理结果。
- <a id="rule-9-3-08"></a>内容未变化，不重复生成 embedding。
- <a id="rule-9-3-09"></a>控制输出长度和任务范围，失败时采用有限重试。

<a id="section-9-4"></a>
## 9.4 缓存分层

| <a id="rule-9-4-01"></a>缓存 | 复用内容 | 失效条件 |
|---|---|---|
| <a id="rule-9-4-03"></a>输入解析缓存 | 相同文字、录音或图片的解析 | 内容、解析规则或模型版本变化 |
| <a id="rule-9-4-04"></a>Embedding 缓存 | 未变化的文章段落 | 正文、模型、维度变化 |
| <a id="rule-9-4-05"></a>检索缓存 | 相同查询与过滤条件的结果 | 知识版本或检索规则变化 |
| <a id="rule-9-4-06"></a>通用答案缓存 | 不含家庭资料的通用问题 | 来源或生成规则变化 |
| <a id="rule-9-4-07"></a>家庭结果缓存 | 指定家庭和孩子的摘要等 | 数据、任务、权限或版本变化 |
| <a id="rule-9-4-08"></a>Gemini 上下文缓存 | 重复使用的稳定输入前缀 | 到期、配置或内容变化 |

<a id="rule-9-4-09"></a>
家庭缓存必须绑定资料空间、孩子、权限和版本。不能跨家庭复用私人结果。

<a id="section-9-5"></a>
## 9.5 Gemini 上下文缓存

<a id="rule-9-5-01"></a>
**隐式缓存：**

- <a id="rule-9-5-02"></a>把稳定规则和共用内容放在前部。
- <a id="rule-9-5-03"></a>保持格式一致，把动态内容放在后部。
- <a id="rule-9-5-04"></a>记录实际缓存 token，不能假定每次命中。

<a id="rule-9-5-05"></a>
**显式缓存：**

- <a id="rule-9-5-06"></a>初期默认关闭。
- <a id="rule-9-5-07"></a>达到模型门槛，且预计重复使用收益覆盖创建和存储费用后才启用。
- <a id="rule-9-5-08"></a>使用短 TTL 开始测量。
- <a id="rule-9-5-09"></a>不为达到门槛而填充无用内容。
- <a id="rule-9-5-10"></a>不把频繁变化的任务状态当稳定缓存。
- <a id="rule-9-5-11"></a>含家庭正文的顯式模型快取預設關閉，啟用須另核對必要性、授權、權限隔離及有效期；自有 Server 亦相同。

<a id="rule-9-5-12"></a>
缓存不是长期记忆。清空缓存后必须能从数据库重新构建上下文。[Vertex AI 缓存说明](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/context-cache/context-cache-overview)

<a id="section-9-6"></a>
## 9.6 成本统计与上限

<a id="rule-9-6-10"></a>
现有约 US$300 GCP 额度是可用资源，不作为必须用完的预算。设置预算提醒、应用调用配额、重试上限和模型总开关；预算提醒不等于自动停费。

<a id="rule-9-6-11"></a>
估算费用用真实账单校准，不预先承诺节省百分比。

<a id="flow-index"></a>
## 数据流与单一权威索引

記錄流程：客戶端介面 → Server 身份／權限及共享規則校驗 → Server 權威儲存 → 回傳確認版本。AI 路徑先生成草稿，再按已確認授權規則進入同一寫入／執行流程，不能繞過權限。

| 机制入口 | 依赖的权威定义 |
|---|---|
| Server 與在線客戶端 | [SPEC 保存位置](../SPEC.md#section-2-2)、本文主節點章節 |
| 同步与重试 | [操作字段](DATA_MODEL.md#section-4-3)、[冲突和终态](DATA_MODEL.md#section-4-5)、[接口结果语义](API.md#sync-contract) |
| 长期记忆构建 | [原始聊天](../SPEC.md#section-5-2)、[事实](DATA_MODEL.md#section-5-3)、[摘要／话题状态](DATA_MODEL.md#section-5-4)、[任务实例](DATA_MODEL.md#section-5-5) |
| 知识处理 | [来源与适用范围](../SPEC.md#section-5-6)、[来源元数据](DATA_MODEL.md#section-5-6)、本文审核和检索机制 |
| 便携迁移与恢复 | [支持方向](../SPEC.md#section-6-1)、[迁移包](DATA_MODEL.md#section-6-2)、本文迁移／灾备／rollback 流程 |
| Gemini 费用与缓存 | [统计字段](DATA_MODEL.md#section-9-6)、[用户费用视图](../SPEC.md#section-9-6)；Codex 额度规则只在 [AGENTS](../AGENTS.md#quota) |

本文约 US$300 GCP 资源和模型名称是原计划基准记录，不是本轮查询到的实时余额或可用性。保留初始方案，使用前按对应步骤核对。

<a id="telegram-wiring"></a>
## S13-W06 Telegram 接線

沿用已選 grammY 1.46.0／MIT，Node Server 用 Api 及受限 transport，沒有 Bot 自動初始化、long polling、auto-retry 或 webhook reply。server/telegram-* 接本人綁定、原操作收據、加密台帳及 pg-boss；功能旗標 TELEGRAM_ENABLED 預設關閉。Server／worker 共用受保護 JSON 配置，原 bot ID／綁定版本及執行世代每次重新核對。

一般測試只發固定無孩子正文訊息，使用者點回應只記 acknowledgedAt。此包接通渠道邊界，S13-W07 才把已核准家庭事項與聯絡決策接入；不讓渠道 adapter 決定照顧者、醫療事項、fallback 或完成狀態。網頁可關閉，已確認 queued 由 worker 處理；發送不確定時停止重發，不能承諾外部 exactly-once。

原文核對及實作方法見 [Telegram Skill](../.agents/skills/telegram-bot-api/SKILL.md)，帳號操作／上線條件見 [操作指引](P2_TELEGRAM.md)。S13-W06 的 SQL／訊息結果見 [該包 EV](../artifacts/verification/S13_W06_CHECKS.json)，公開 webhook 及恢復範圍按 [S17-W02](../artifacts/verification/S17_W02_CHECKS.json) 核對。

<a id="care-summary-flow"></a>
## S14-W01 統計及到診準備接線

復用已驗收的孩子切換、CareStore 解密／確認版本、任務台帳、家庭授權及 online receipts。短交易讀當前孩子來源與依據，純函式按時區曆日分組及千分位整數計算；Server 提供總數，模型只可解釋，不從自由文字猜數值。不新增統計框架、快取層或 PDF 依賴，沿用 [TECH_REUSE](TECH_REUSE.md#decisions) 的領域統計安排。

到診草稿加密保存，核對版本隨來源變化失效；圖表、PDF 及完整報告輸出仍按 P4 工作包。日／週入口不需 Gemini；使用者明確問摘要時才以 summary-visit 配方及唯讀摘要工具加入既有 ADK 循環，原全局配額及上限不變。沒有背景週報推送或額外模型排程。

純計算／型別／配方載入與真 API／Agent／加密還原證據分列 [S14 驗收](../artifacts/verification/S14_W01_CHECKS.json)；完整摘要面板瀏覽器情景未驗，不冒用其他面板的 Chromium 結果。

<a id="growth-attention-wiring"></a>
#### S13-W08 接線與首批規則

實作位於 [growth-rules](../server/growth-rules.ts)、[growth-store](../server/growth-store.ts) 及 [growth-worker](../server/growth-worker.ts)。復用公共 KnowledgeStore 的發布／適用條件過濾與既有向量證據，確定性規則判斷本身不需要另做 embedding；Agent 仍可按需要使用同一 KnowledgeRetriever。規則綁來源 ID、官方 URL、已核對片段 hash 及個別規則版本；內容改變要重新核對相應規則，不能只換最新連結繼續使用。

2026-09-28 主模型核對四份 FHS 官方內容，沿用既有種子片段；產品提示窗口與官方適用條件分開：

| 年齡段／主題 | 本批產品窗口及必要限制 | 官方來源 |
|---|---|---|
| 0–1：引入固體食物 | 實際 6 至未滿 12 個月；約六個月的官方內容不是「5.5–6.5」產品期限。是否已開始未知時先問；已開始或有個別醫護計劃則停止本項 | [FHS 飲食](https://www.fhs.gov.hk/tc_chi/health_info/child/30039.html) |
| 1–3：遊戲與溝通 | 此來源只覆蓋 12 至未滿 24 個月；不擴展到整個 1–3 歲或逐項發展診斷 | [FHS 一至兩歲](https://www.fhs.gov.hk/tc_chi/health_info/child/15654.html) |
| 3–6：發展觀察 | 36 至未滿 72 個月；未知時補觀察。建議諮詢保留「官方所列多項問題且持續」條件，不把短暫一項問題當異常 | [FHS 學前發展](https://www.fhs.gov.hk/tc_chi/health_info/child/14821.html) |
| 6–10：視力 | 72 至未滿 120 個月；小一安排需明確年級，不能由年齡猜測。已有專業跟進／相關檢查完成則停止本項 | [FHS 視力](https://www.fhs.gov.hk/tc_chi/health_info/child/14812.html) |

本批只用有效出生日期的實際年齡及香港地區；約數保留且明示需要資料，不產生狹窄窗口判斷。沒有把矯正年齡套入四項規則，亦不宣稱每個月齡都有關注。近況選項由照顧者明確確認到既有共享事實：`growth.solid_food`、`growth.play`、`growth.development_concern`、`growth.school_year`／`growth.vision`；無記錄、衝突或不識別值維持未知。

pg-boss 的 minute cron 只取已到期或目錄版本改變的孩子，短交易完成適用／抑制判斷及新候選；不是每日對全家庭呼叫模型。新基準與 `growth-agent-v1` 原子入列，原 worker generation／storage epoch／candidate version 隨工作保存；模型開始及運行中重查權限、關注與來源。背景復用 S11 ADK，只給家庭資料、讀取／知識／呈現工具，站內結果仍只屬其原運行使用者；沒有共享私人摘要、醫療規則生成或外發。相同 candidate 的 run claim 不會因 worker 重領重做模型。

API 與 worker 均須既有 P2 啟用旗標及 migration 017；DB 維護指令建立兩個新 queue，runtime 不自行 migration。還原後沿既有 worker 暫停與世代核對；必要 SQL、原資料／還原及真背景恢復已有分項證據；完整失敗矩陣未執行，見 [W08 驗收範圍](../artifacts/verification/S13_W08_CHECKS.json)。

<a id="p2-photo-flow"></a>
## S12-W03 照片接線

沿用 [附件目錄](#section-3-2)、既有 storage cipher／online 收據及 ADK runtime。metadata 預留與原檔傳輸分兩步；Server 授權後才接最多一張 4 MiB 圖，單程序最多兩個內容上傳，普通 JSON 仍限 64 KiB。原檔獨立加密、保留 SHA-256，無公開靜態路徑；短 SQL 交易內只做本機有界檔案操作，不持鎖呼叫 Gemini。不可變檔案及 reserved 狀態讓中斷後核對原 ID；DB 刪除清單解決 SQL／檔案不能共用交易的清理恢復。

原生 inlineData 由 Server 注入當次 ADK user message，保留現有 parts／配額／取消／診斷保護；共用同一前景 runtime 並發控制。只載入既有 capture-confirm／multimodal 模組及簡短 photo-capture 接線模組；受限工具只接候選。家長編輯、確認及原圖分享經業務服務完成，AI 不能直接写入共享照護資料。原圖外送須明確操作，不因已上傳便呼叫模型。

本包只做原生 Web File 選取與功能確認表單；不加入圖片套件、雲端物件服務、相機／Android 或 UI polish。已核官方資料與真服務證據分列，必要照片／配對還原通過，完整面板未全驗，公開交付另按 S17-W02 證據；[接口](API.md#p2-photos)／[保存](DATA_MODEL.md#p2-photo-data)／[恢復操作](P2_PHOTOS.md)。

<a id="p2-shared-input-flow"></a>
## S12-W04 分享輸入接線

INT-W04 正式前端增補沿同一 SharedInputStore：頁面管理與 Agent 候選確認共用權限、版本及來源；Agent 的 list／read 工具只在本人互動提供，read 只取明確授權的現行原文片段。私人網址／備註不加入工具讀取結果或公共檢索，私人引用與官方證據分開，收尾重查版本及授權。來源取得仍使用原人工明示 fetch，沒有付費網站代登入；新增用途不是訂閱、家庭事實或後續關注任務。詳見 [接口](API.md#p2-shared-inputs)。

復用 [來源 fetcher](../server/knowledge-source-fetch.ts)、既有 online 收據、私人 storage cipher 及共用 ADK runtime；不增加網頁爬蟲／PDF parser 或通用 ingestion 平台。手動貼文、已核准公開頁面及 [照片上傳](#p2-photo-flow) 提供 P2 使用者主動輸入；作業系統分享 adapter 仍留 P4。

Server 只從固定 catalog 選公開來源，沿用 DNS／IP／HTTPS／redirect／內容上限保護；fetch 與模型呼叫均在資料庫交易外，短交易 claim 及結果核權。原文與選取片段當作不可信資料注入；既有 capture-confirmation／multimodal 模組加一個短 shared-capture 接線配方，工具只回私人候選。來源不足不能借提取包裝成育兒建議。

家長可人工填寫，或採用候選再確認；外部參考與孩子實際記錄分開。完整來源快照私有，確認文字共享，沒有背景讀私人動態、帖子直接授權任務或全量向量化。功能 UI 交接見 [清單](P2_UI_HANDOFF.md#shared-input-handoff)；必要私人來源取得／隔離、SQL／保存及真提取修正版證據見 [S12-W04](../artifacts/verification/S12_W04_CHECKS.json)；完整分享面板瀏覽器仍未驗。

<a id="proactive-contact-flow"></a>
## S13-W07 預授權聯絡接線

到期事件 → 共用 ADK 讀取 Server 聯絡選項 → 原生工具建立唯一聯絡請求／pg-boss job → worker 核權及偏好 → 渠道單次呼叫 → 持久結果／本人收到確認。對已到期事項新增明確授權可建立一個新事件；同一提醒的外發請求仍唯一，不重跑舊模型運行。無新事件不空轉模型。

[contact-store](../server/contact-store.ts) 擁有選人、授權／終態、來源適用、每日合併、安靜時段、unknown 及有界 fallback；復用既有任務、成長規則、pg-boss、加密與渠道 adapter。主對象是任務負責人，後備與順序須事先確認；不猜測誰有空。網絡呼叫不持 SQL 鎖，緊接外發前再次核權；重領 sending 保留未知結果，已知拒絕才可走核准的下一綁定。

Prompt Pack 只補產品工具範圍；工具是唯一副作用入口。收尾失敗從台帳回報已入列，既有操作不重做。包版本與模組正文版本分開，loader 仍精確校驗模組 header／manifest／依賴。Push／Telegram 都只傳固定無家庭正文提示，點開後由站內權限控制資料；回應不改照護終態。渠道接受、收到與任務完成分開展示，瀏覽器關閉不影響已入列工作。

P2 開關預設關閉；真渠道及 SQL 等既有結果見 [S13-W07](../artifacts/verification/S13_W07_CHECKS.json)，公開 worker／webhook 見 [S17-W02](../artifacts/verification/S17_W02_CHECKS.json)。開關預設值、某次部署與完整瀏覽器驗收不是同一狀態。

<a id="personal-model-routing"></a>
## S06-W05 本人 key 的共用路由

`model-routing` 在 Server 按登入／worker 受信帳號解析一次設定，為 ADK／P1 gateway 及查詢 embedding 提供相同付費來源；不讓模型選 key、provider、網址或擴權。私人 key 使用既有 Google Gen AI SDK 2.24.0 的 Developer API v1beta；平台及語料維護維持 Vertex ADC。SDK 重試關閉；同一運行的版本變更即阻止後續呼叫，不靜默 fallback。

個人 key 模式的 UI 可調每日及每次運行生成／query embedding 次數，範圍見 [API](API.md#personal-model-http)；本節取代前述 4／2 對 personal 模式不可變的假設，平台預設不變。全站個人服務安全上限由 `AI_PERSONAL_DAILY_GLOBAL_ATTEMPTS` 管理，預設 1000，UI 顯示但普通使用者不能改全站配置；全局 AI_ENABLED 仍有效。接線版本啟動前須 migration 024，避免憑據或計數服務悄悄退回舊路徑。

2026-09-30 真 key 的 metadata GET 回覆地區不支援；使用者確認本包先交付設定及本機接線，真生成／向量留待可用供應商條件。不能把 Vertex ADC 通過或 metadata GET 當私人 key 真服務通過；未新增 Vertex key 路由或繞過地區限制。


<a id="int-concern-flow"></a>
## INT-W05 持續關注與站內跟進

ConcernStore 是家庭共享關注、事件與原操作收據的唯一權威；頁面 owner 與 Agent 候選確認共用服務，GrowthAttention 保持有限官方規則的獨立語義。觀察只保存已核對共享的整理內容，不把私人聊天或來源向量化／複製進家庭。連結按資源 ID／孩子核對，不因相似標題合併。

一次跟進由明確未來時間觸發：pg-boss 排程 → 短交易重核／入列 ID → 交易外 Agent background → 原 run 收據／站內結果。延用既有 generation、storage epoch、目前成員權限與 Agent claim 去重。沒有新排程不空轉模型；已關閉、版本過時或 unknown 不重新執行。背景關注沒有 contact 工具，不借此擴大通知授權；相關任務仍走既有獨立流程。恢復關注不重新排入舊跟進。

使用現有 pg-boss／權限／cipher 的原因：此包缺的是產品關注與終態語義，既有框架已提供可靠入列、排程及恢復，不引入第二套 worker 或狀態機框架。細節以 [API](API.md#int-concerns)／[資料契約](DATA_MODEL.md#int-concerns) 為準。


<a id="int-family-documents"></a>
## INT 文件整理與導出

Agent 工具、準備單、成長頁及歷史共用 FamilyDocumentStore；前端只掛一個文件 owner，沿既有 changes cursor 更新各頁。Server 在短交易內取得已授權的同源資料，保存有界版本化整理；原 opId、防越權及來源失效規則不交給模型判斷。

首次建立標準報告後，持久 worker 合併來源事件更新；這是確定性的家庭記錄整理，不宣稱每次由 Gemini 新作分析，亦不消耗模型額度。特殊用途由對話選取既有用途及範圍，未提供的私人內容／照片匯出不冒充已接線。PDF 使用固定版 react-pdf Node renderer 及本地繁中字體，取同一已授權 snapshot；渲染後重核才回應，不在持 SQL 鎖時排版。

<a id="p2-agent-service"></a>
## P2 增補架構：語義工具、持久工作與單人服務

本節為 [ADR-018](DECISIONS.md#adr-018) 的目標契約；不把文件寫成已實作。沿用上文 ADK／ModelGateway、業務 Store／加密／操作收據與同一前端 owner，具體進度只在 [PLAN](../PLAN.md#p2-agent-service)。

- **模型與程式分工：**一個產品 LlmAgent／Runner 處理語義理解及下一步；常用上下文／檢索／結果工具可見，其餘以短能力目錄配合 ADK 原生 BaseToolset 按需載入受限工具及既有配方。來源仍是 Server 核准集合，不依最後一句 regex 取捨能力，也不解析思考文字或加一層固定意圖路由。資料正文不得升為指令。工具 schema／結果回到同一循環；授權、版本、配額及已提交效果由程式保證。首版不加多 Agent、新框架或路由模型。
- **持久接續：**原訊息／事件／收據、通用工作狀態、有 coverage 的摘要三層分開。工作保存目標／焦點／相關資源／待答問題／確認／結果，不預定照護步驟。ADK session 只承擔 run 協定；新 run 由授權業務狀態重建，原操作先查收據，不靠恢復思考。歷史與文件按需分頁，取消／更正／撤權使受影響工作失效。跨輪來源使用實際訊息及版本，不能把摘要當本人同意。
- **確認：**自然提示列清具體變更；Server 綁定操作參數、資源與授權版本、提問訊息及 opId。唯一且仍有效時才可接續簡短確認；多義或舊版重新問。刪除保留具名確認／身份核對；模型工具參數不自行證明使用者已確認。
- **RAG：**原問題及必要上下文 → 必要改寫／拆問 → SQL 適用過濾、向量＋關鍵詞 RRF → 有界同版本章節／頁面擴讀 → 有必要才補查。查詢在 run 內復用，query embedding 同受預算；公共查詢不帶無關私人正文。相似度不能代替引用支持。先在 SQL 授權／篩選及排名、限量，再解密所需範圍；沒有全庫載入排序或固定總數超出即全失敗。
- **知識發布：**既有來源 worker 發現新版，HTML／文字型 PDF 用成熟解析器保留頁章及抽取完整度，穩定分段與 hash 增量更新。重要含義核對獨立於 hash，含數值、年齡、時間、條件、例外及撤回；受影響引用／代表問題／成長規則另核。模型可輔助但不能以自報信心單獨放行。可判定安全的變更依政策發布，不確定留候選，已知失效舊版停止供應；暫失不等於失效。來源條款沿既有邊界。
- **資料範圍：**檢索、摘要、文件及背景入口都由 Server 注入本人／孩子／授權版本／用途。保存或外發前再核對來源與目的地；讀取不等於披露授權。私人／公共／孩子資源分開；失權或來源更正觸發相關摘要／候選／文件失效。不得透過歷史、快取或遲到回應繞過。
- **文件與報告：**同一 FamilyDocument 作權威，穩定章節／項目 ID 及固定版本分段讀取；局部 patch 與 expectedVersion／opId 交易保存，衝突先重新讀取。不以新增聊天或另份文件替代修改。自動來源區與指定內容分開；歷史恢復是同一文件的新版本。季度／年度以有界批次覆蓋完整期間，先可重現統計再必要敘述，同版 Web／PDF；日常成長頁是同源投影，不在讀頁生成。
- **主動性：**復用 pg-boss 事件／到期／階段／有效知識版本觸發，先核相關性和終態、授權、渠道、安靜時段與抑制。沒有新條件不調模型；站內與外發分開。原邏輯工作／通知證據支援重啟去重，不重設跟進上限。
- **服務：**Better Auth 原生驗證／找回／會話管理配合本人獨立空間、邀請資格與退出服務；不另造身份系統。邀請不是家庭成員資格。沿 GCP 單 VM Compose／Caddy／API／worker／PostgreSQL 加入必要健康、重啟、容量／故障告警、配對加密備份與空環境還原、相容遷移／回滾；不引入高可用平台。Email 供應商、邀請規模及費用在相應實作／部署前核定。

有界讀取統一交代所讀版本／範圍、complete／未讀理由及續讀位置；查詢錯誤不偽裝空結果。完整期間工作保存可恢復進度，不能截前綴交作完整報告。沿當前有效單次及每日上限（互動文字上限依 [API 容量契約](API.md#agent-input-capacity)，背景 32,000），修正／載入／收尾均計入 run；維護向量另有有限批次。超限不靜默丟必要權限／來源／工具配對，不自動新 run 繞過。

方法參考：沿用 [ADK 2.1.0 LlmAgent](https://github.com/google/adk-js/blob/adk-v2.1.0/core/src/agents/llm_agent.ts) 原生工具集合；借鑑 [Codex 工具循環](https://developers.openai.com/blog/codex-as-a-platform)、[OpenHands 持久事件與狀態](https://docs.openhands.dev/sdk/guides/convo-persistence)、[查詢轉換](https://developers.llamaindex.ai/python/framework/optimizing/advanced_retrieval/query_transformations/)及[檢索後上下文擴展](https://developers.llamaindex.ai/python/examples/node_postprocessor/metadatareplacementdemo/)。只採方法，不因此引入另一個 runtime 或 Python 檢索服務；官方已核對與產品實測分開。

<a id="p2-a05-reports"></a>
### P2-A05：同源日常與季度／年度報告

使用既有 FamilyDocument store 及 pg-boss 文件 worker，採有界掃描、加密累計、來源修訂核對和原子發布。每次只處理一批，沒有年度全量交易／全量載入；完整統計與有限正文選錄分開。日常 living 報告隨來源事件及香港日期延展更新，季度／年度固定期間保持原界線。前端只投影同一文件及 reportCoverage，PDF 讀同一固定快照並在輸出前後覆核來源。正常讀頁不整理、不呼叫模型；舊固定／部分報告保留 partial 身份直到明確刷新完成。
