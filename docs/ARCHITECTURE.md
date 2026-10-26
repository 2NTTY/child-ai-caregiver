# 技术架构与运行机制

**實作與目標分界：**下文 PostgreSQL／Better Auth／pg-boss 專項保留原機制及證據；依 [ADR-024](DECISIONS.md#adr-024)，正式 SQL 接點改用 Firestore，原 VM／Node／Compose／Caddy 及網站繼續沿用。Firebase Auth、Storage、Tasks 的既有接線按實際範圍復用，不表示全部功能已遷移。現行契約見 [Firestore 接點](#firestore-target)，已合併／未合併／待驗只見 [PLAN](../PLAN.md#active)。

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
六層按 P1 至 P5 的實際流程落實；P1 須具備最小 Server、PostgreSQL 及身份隔離。Web／Android 共用 TypeScript domain、validation 與協議；權威業務校驗、AI orchestration、記憶及 tasks 在 Server 執行，不能放在 UI component 或資料庫／平台／渠道 adapter。

<a id="rule-3-1-11"></a>
共享核心保持平台、資料庫及渠道解耦；育有方是唯一實作領域，將領域模型、prompt、來源及受限 skills／任務流程集中管理。只在相關功能使用邊界，不建通用實體模型、動態插件平台、registry 或第二主題。日後可從來源碼層替換領域或 adapter，不預建平台。

<a id="feature-layer-boundaries"></a>
### 功能責任與可獨立驗證邊界

沿用上述六層及既有 Server 權威；以下將實作接點細分，並非新增服務或第二套架構。對應功能規格見 [SPEC](../SPEC.md#p2-optimization-layering)，實作／待驗狀態只見 [PLAN](../PLAN.md#p2-layering-streaming)。

| 接點 | 權威與責任 | 可替換／可直接驗證邊界 |
|---|---|---|
| UI component／screen | 呈現、收集輸入、互動、載入及錯誤 | view model／action；不決定授權、任務終態或是否已保存 |
| 正式 owner／controller | 草稿、API 協調、原 opId 恢復、身份世代、快取失效及同源投影 | 與 React 無關的必要操作協調接受明確 ports；React hook 保留生命週期，不另造資料庫 |
| HTTP API | 目前會話、預期身份、解析與 schema、路由及回應 | 呼叫同一業務服務；測試不自行補一套正式未提供的能力 |
| 業務服務／純規則 | 功能前置、狀態、確認、版本、防重及結果 | 純規則接受明確資料與時間；服務只取得其操作所需 ports，不依賴 React／HTTP／供應商 SDK |
| 權威資料／外部 adapter | Firestore 原子讀寫、查詢／游標、Storage、Tasks、通知 | 交易範圍顯式；替身可驗協調但不能證明真 SDK 競爭／外發 |
| ModelGateway | provider 請求、協定、用量、取消、期限及錯誤 | 可注入 scripted provider；不決定使用者同意或業務已保存 |
| Agent orchestration | 語義理解、工具選擇、接續與回答 | 工具透過上述業務服務；不能直接寫庫或外發，模型品質與機械規則分開驗 |

功能域以孩子、記錄、待辦、成長等權威資源劃分，不以頁面另建主庫；同一孩子資料可投影多頁。記憶、文件及三角色使用同一原則，接口穩定才調整，不為分類全倉搬檔、引入 DI 容器或通用 registry。

#### 主要功能入口與既有獨立邏輯

此表定位正式接線與規則，不另定資料格式；程式改動時隨所屬包更新。舊 SQL factory 或未正式掛載的 controller 不能代替現行 Firestore 證據。

| 功能 | 正式 owner／API／權威組裝 | 已可獨立使用的規則／檢查接點 |
|---|---|---|
| 孩子概況 | [CareProfileDomains](../frontend/src/production/CareProfileDomains.tsx) → [care-api](../src/client/care-api.ts) → online profile write → [prepareProfile](../server/firestore-care.ts) | 共享 profile schema、CareProfileProjections；版本／年齡精度／原文及確認沿原契約 |
| 結構化記錄 | 同一 CareProfile owner → care-api search／read、online write → Firestore prepareRecord／prepareDelete | [CareProfileProjections](../frontend/src/production/CareProfileProjections.ts)、[care-client 檢查](../tests/care-client.test.ts)；不能把 readRecords=false 的 ProductionOwner 身份／孩子 controller 當照護記錄 owner |
| 待辦 | [task owner](../frontend/src/production/task-knowledge-tasks.ts) → [task-api](../src/client/task-api.ts) → [prepareTask](../server/firestore-online.ts) | [task-policy](../server/task-policy.ts) 的 changeTask／reminderDecision、[task-projection](../frontend/src/production/task-projection.ts)、[既有 client 恢復檢查](../tests/tasks-client.test.ts) |
| 成長關注 | [growth owner](../frontend/src/production/task-knowledge-growth.ts) → [growth-api](../src/client/growth-api.ts) → [Firestore growth](../server/firestore-growth.ts) | [growth-rules](../server/growth-rules.ts)、[readGrowthPages](../frontend/src/production/growth-read.ts) 的雙來源一致性；報告／記憶部分沿自身權威，不把 SQL 測試當 Firestore 證據 |

照護讀取由 [CareReadCoordinator](../frontend/src/production/CareReadCoordinator.ts) 接同一 QueryClient／API，直接管理身份、版本、歷史游標及刪除屏障；React owner 注入生命週期與投影，保留寫入／草稿／原收據。既有 [care cache 檢查](../frontend/scripts/care-record-cache.test.mjs) 與 [history 檢查](../frontend/scripts/qa-care-history.test.mjs) 直接 import 正式讀取模組，必要 owner 回調以整份模組接線核對，不再擷取函式片段。其他已分層功能先復用，無具體缺口不再抽象一層。

待辦 HTTP 透過 [TaskService](../server/task-api.ts) 的明確讀取／可選交易寫入介面接業務服務，不引用 legacy SQL factory 的返回型別；正式 Firestore 讀取以結構相容接入，寫入仍走 online 收據交易。純 changeTask／reminderDecision 與 client 原操作恢復沿用，不新增權威或協調副本。

成長檔案由同一 useFamilyDocuments 提供準備單及報告資料；[projectFamilyDocumentArchive](../frontend/src/production/family-document-archive.ts) 僅將已授權 DocumentPage 投影為目前／歷史／期間與顯示狀態，不讀庫或生成報告。失去存取時先遮蔽資料，失效文件不提供正文／歷史；building 與來源失效、coverage 保持不同語義。hook 只接原 reading port 與操作，DomainBridge 繼續核對成長及文件的 authorityVersion；Server 仍決定來源是否有效，局部純投影不能替代這些權限與版本檢查。

**交易不變條件：**目前權限／資源版本的讀取與業務寫入、修訂、操作收據、變更序號及 outbox 仍在同一 Firestore 交易。純規則只回傳決定或差異，不在交易外依舊權限決定提交；交易 callback 不呼叫模型／通知。重試沿原 opId／fingerprint，副作用 unknown 只查原結果。完成／取消競態及 needs_review 保持原語義，終態仍由 worker 執行前重查。

**診斷：**復用既有錯誤碼與 Agent observer，只補必要功能域、階段、request/run/op 關聯、耗時與結果；未知層次明示未知。UI、API 身份、業務拒絕、版本衝突、外部／模型失敗、傳輸中斷分開，不暴露 stack、私人正文、key 或未經授權資料，不建立另一套監控服務。

<a id="reuse-boundaries"></a>
### 通用能力復用邊界

保留已驗收的 ADK、Expo Router、Better Auth、Zod、pgvector、家庭授權／在線收據／加密／知識發布等成果。新增通用能力按 [AGENTS 復用規則](../AGENTS.md#technical-skills) 選型；[固定版本研究與相容性閘](TECH_REUSE.md#decisions) 是證據，不表示候選已安裝或通過本工程驗收。

新複雜表單優先驗證 React Hook Form＋現有 Zod；新前端已採納的 Paper、表單及動效繼續復用，Expo UI Universal 留作有原生控制需要的局部候選，不批量換 UI。正式整合提前採用已研究的 TanStack Query 5.103.2，限讀取快取與失效管理，沿用原 opId／收據寫入 transport；權限／Server 切換必須取消及清理快取，不能形成離線 mutation queue。P2 的 Playwright Test Web 基礎延用至後續包，保留 node:test／既有腳本；Web 證據不能替代 Android 真機驗收。

`frontend/` 從已確認的隔離預覽轉為正式應用，納入根 npm workspace 與單一 lockfile；根 Web 啟動／建置及 Docker Web 產物指向它。保留既有設計，以正式身份／資料 provider 取代合成 owner；有效的 `src/client` 控制器及 `src/shared` 契約繼續復用。舊 `app/` 測試呈現只作過渡參考，不與新前端各自保存業務資料；舊入口的退出及實際部署狀態見 [INT 計劃](../PLAN.md#production-integration)。正式畫面不掛載合成 owner，未接能力不得顯示假成功；過渡 gate 之後仍須逐項移除正式 screen 的預覽依賴。

<a id="production-ui-data"></a>
### 正式 UI 的共用資料邊界

每個領域只有一個正式 owner，向首頁、聊天及領域頁提供同源投影；正式 Firestore 資源／操作台帳保持權威（原 PostgreSQL 機制只供歷史對照）。讀取 query key 包含 Server、本人、身份世代及孩子／角色 scope；登出、身份不明、撤權或切換 scope 時取消舊讀取並清理私有快取、草稿及附件，遲到回應不得寫進新 scope。頁面草稿不是第二份業務資料庫。

Agent／頁面修改成功後以實際資源 ID／版本使相關讀取失效並同步 owner；跨可見分頁／裝置沿用 changes cursor，每 5 秒只核對 metadata，回前景立即核對。一般讀頁不呼叫模型；來源變更令衍生報告標記待整理／失效，不繼續冒稱最新。寫入保留各領域的版本、原 opId、unknown 核對及授權邊界，不用 Query 的自動重試代替業務恢復。

Web 的可見事件及 Android 的 AppState／網絡 adapter 驅動同一 metadata observer；背景或已知離線停止核對，回前景重新查當前版本。平台事件不持有業務資料，也不重送寫入；停止讀取與取消 Server 執行分開。網絡狀態未知時仍由實際受控請求判斷，不當作身份失效。

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
P1 最小 Server／PostgreSQL／Better Auth 先支援合成資料可玩流程，之後完成 Server 儲存加密及最小加密備份／還原；P2 加入家庭邀請、私人隔離、附件、持續 worker、ADK 及最小 pgvector RAG；P3 Android 重用 Server；P4 擴充集中服務的共享／班級、知識管理、分享／分析及災難恢復；P5 完成 Server 選擇、Windows 自部署與完整跨 Server 遷移。P1／P2 的 SQL 名稱只記歷史，現行組裝沿 Firestore。

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
- <a id="rule-3-5-04"></a>當前指定 Server 確認寫入並執行 Agent／任務；P5 跨 Server 遷移才切換該權威。

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

- <a id="rule-3-6-01"></a>平台 Gemini 經 Vertex ADC 接入；本人模式沿MODEL-SELF支援Gemini Developer／Vertex Express key。模型目錄是參考選項，用戶可直接指定合法Gemini ID，不以未逐型號驗收作為禁止理由；不接受任意網址或headers，不以更換模型改動權限或配額。已知型號適配可選參數，其他型號使用供應商預設，實際不相容沿安全錯誤回報。各模式共用既有ADK／工具／來源及限額，不另建Agent。
- <a id="rule-3-6-02"></a>使用结构化输出生成记录或任务草稿，经过校验和必要确认后写入。
- <a id="rule-3-6-03"></a>数量统计、权限、排程、重复检查和完成状态由程序处理。
- <a id="rule-3-6-04"></a>P2 經渠道無關的 NotificationGateway 送出 Web Push 及 Telegram，P3 增加 FCM；Android adapter 不承擔選人、排程或 fallback 決策。
- <a id="rule-3-6-05"></a>通知权限关闭或平台不支持时，界面显示具体状态。
- <a id="rule-3-6-06"></a>PDF 由统一报告模块生成，两端负责预览、下载和分享。
- <a id="rule-3-6-07"></a>保留原 GCP VM／Node／Docker Compose／Caddy；P2 將正式 PostgreSQL／pg-boss 接點換成 [Firestore／Tasks](#firestore-target)，不要求搬走網站或改 Cloud Run。Windows／自部署為後續範圍，不要求用戶先架 Server。
- <a id="rule-3-6-08"></a>自有 Windows 與雲端沿用相容服務定義；初期可用既有 GCP 資源。自有部署不代表 Gemini 零第三方傳輸，仍遵守授權與最小上下文。
- <a id="rule-3-6-09"></a>不把数据库直接暴露到公网；远程连接使用 HTTPS／WSS。

- <a id="rule-3-6-10"></a>首次 Server／模型請求起便有登入及資源權限檢查、憑據隔離、應用配額、總開關及有限重試。供應商憑據只留 Server；日誌不記錄憑據、家庭正文或私人附件。
- <a id="rule-3-6-11"></a>P1 交付最小 Server／PostgreSQL／Better Auth、Web 記錄聊天與 Gemini 簡單 prompt，階段結案時提供真 URL。P2 以 ADK 接通完整當前 orchestration、最小向量 RAG、持續 worker、家庭權限、Web 附件、主動任務、Web Push／Telegram 及公共更新。P3 Android 重用同一 Server，P4 補集中服務協作、災備及 RAG 維運，P5 補自部署／跨 Server 遷移；不因使用框架而提前建立未需平台。

<a id="portable-core"></a>
以下是原自部署路線及現有 Compose 的能力邊界；ADR-019 已採 GCP 代管服務為本輪前置，不能再承諾 Firestore 目標無 GCP 依賴。現有資料、任務、附件、權限及確定性規則由 Node／PostgreSQL／pgvector／worker／Compose 承載。平台 Gemini 維持 Vertex，可使用 GCP 以外 ADC；個人 key 接入見 [S06-W05](#personal-model-routing)。自部署不代表離線 Gemini。S17-W05 須驗證沒有 GCP 附加身份、關閉 AI 時核心資料與確定性任務仍可用，模型及外部通知另按憑據／授權驗證。

渠道薄 adapter 優先驗證 web-push、grammY 及 Expo Notifications；FCM Server 先用官方 Google Auth＋單次 HTTP v1 請求，以免 SDK 隱藏重試繞過 unknown／去重規則。版本、許可及 Firebase Admin 未優先採用的證據見 [渠道研究](TECH_REUSE.md#channels)。選人、授權、排程、fallback 與投遞台帳仍由項目控制；採用與驗收按 [工作包](../PLAN.md#roadmap-packages) 分列；Web Push／Telegram 的既有證據不代替 P3 FCM。

<a id="p2-agent-runtime"></a>
### 3.6A P2 ADK 產品 Agent（S11-W03 基礎已實作）

S11-W03 已交付 [內部 AgentRuntime](../server/agent-runtime.ts)、[模型 adapter](../server/agent-model-gateway.ts) 及 [Prompt Pack 組裝器](../server/agent-prompt.ts)，完成真 Runner scripted 檢查及獲批的兩次 Vertex／Gemini 呼叫及一次工具循環驗收，見 [EV-S11-W03](../artifacts/verification/S11_W03_CHECKS.json)。該證據只覆蓋 `text`／`tool_cycle` 配方基礎；產品配方接線見下文，公開交付另見 [S17-W02](../artifacts/verification/S17_W02_CHECKS.json)。工具 schema 描述是模型指引，仍由主模型維護。

S11-W02 的互動／背景 [產品 Agent](../server/product-agent.ts)、[受限工具](../server/product-agent-tools.ts)及[確認台帳](../server/product-agent-store.ts) 沿用同一運行邊界。API 與 worker 共用服務組裝、配额及運行限額；以 `P2_AGENT_ENABLED=true` 明確啟用，預設保留 P1。Prompt Pack 按 product-interactive／product-background 配方復用，最終文字不作第二次副作用入口。

到期提醒與 `agent-task-due-v1` 入列共用原交易，只带 reminder／work ID 及原 worker generation／storage epoch；模型等待不持有 SQL 交易。領取及每次工具前重查任務版本／發生實例／終態、指派人及原授權人；還原後舊事件不能因重新啟用而復活。固定事件只建立一個 run，重啟查原台帳，已開始的模型循環不盲目重跑。背景先提供只屬原照顧者的站內說明；外發及成長候選分屬 S13-W07／S13-W08，沿各自契約及授權。

本人互動只載入必要近期訊息、已確認事實及可追溯摘要；背景只用家庭 scope。完整摘要批次在既有覆蓋規則下核對保存，與 run 完結共用交易，不自動提升推斷或改話題／任務終態。功能 UI 的官方求助入口在模型／檢索前保持可見，來源是 2026-09-28 核對的[消防處先遣急救員資料](https://www.hkfsd.gov.hk/chi/fire_ambulance_services/responder.html)及[召喚救護指引](https://www.hkfsd.gov.hk/chi/fire_ambulance_services/fire_information.html)，不建立症狀分類、診斷或自動致電。

診斷採原生 BasePlugin，僅允許 runId、階段、已知工具名／狀態及耗時；預設停用，`AGENT_DIAGNOSTICS=true` 才寫 metadata。保留 ADK content capture 關閉，沒有新增 OTel exporter／憑據；sink 失敗不影響流程。診斷本身的 scripted Runner／observer 檢查不等於所有端到端情景已驗；產品真服務／SQL／通知證據分見 [S11-W02](../artifacts/verification/S11_W02_CHECKS.json)／[S16-W02](../artifacts/verification/S16_W02_CHECKS.json)，按實際測試範圍判斷。

<a id="rule-adk-01"></a>
採用 Google ADK TypeScript `@google/adk 2.1.0`，現有 Node／GCP Compose 實作使用一個產品 `LlmAgent`／`Runner`；後續按[四角色目標](#p2-agent-roles)擴充，不能把本節的單 Agent 證據當多 Agent 已實作；按受信入口、事件及所需任務配方暴露 `FunctionTool`，由 ADK 實際執行多步工具循環。S11-W03 先完成相容性基礎，S11-W02 才接通完整記憶／知識／任務能力。沿用 Node 24.19，npm 於 S11-W03 調整至 11.8.0 並同步建置及 lockfile；固定依賴、許可、現有 Gemini 型號／Vertex ADC／TypeScript 相容性須在接入驗證，不把本次文件當成安裝或實測。

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

已核對 TypeScript 2.1.0 的 DatabaseSessionService／PostgreSQL 支援；後續持久會話採既有 Firestore 方向，在公開 BaseSessionService 補加密儲存適配，不再交付 SQL 專用 Session 候選。`createAgentRuntime` 已有可選、受信的 `nativeSessionService` 單次 create-only 接點，預設每 run InMemory 不變；正式 index／worker 未啟用、尚未部署，也未交付跨程序 resume。會話事件不取代業務收據、授權或根預算；儲存、清理及恢復邊界依[會話契約](CHAT_AGENT_FIRESTORE_SESSION.md#runtime-port)。SkillToolset 已調查但屬 experimental，維持現有 Prompt Pack／受限工具，不重建技能平台。

S11-W02 優先以 BasePlugin 及 ADK 原生 spans 接最小 metadata 診斷，可用單一標準 OpenTelemetry provider／本地 OTLP；不預設開啟會記正文的 LoggingPlugin、通用自動重試或 GCP exporter。observer 不得短路／改寫業務結果，診斷 sink 失敗不阻斷業務；保留 content capture 關閉，另驗 exporter allowlist。TS devtools 已有 conformance 工具，但不能直接充當產品品質評測；S16-W02 復用現有 scripted Runner 與有限真 Gemini 情境。官方原碼、版本、實驗性範圍及未驗證項見 [ADK 研究](TECH_REUSE.md#adk)。

<a id="p2-agent-budgets"></a>
### 3.6B P2 初始有界運行配置

| 限制 | 初始值／計算範圍 |
|---|---|
| 生成模型呼叫 | 2026-10-16 平台政策預設每 run 8 次；底層固定配置及既有個人 key 預設仍 4 次，個人已選限制不變。所有實際步驟、修正及收尾共用原 run 預算 |
| 工具調用 | 每 run 最多 16 次，失敗、被拒絕及未知工具嘗試也計入 |
| 查詢 embedding | 平台政策預設每 run 4 次 API 嘗試；固定配置／既有個人 key 預設 2 次。相同查詢／模型／維度在該 run 內復用 |
| 總期限 | 互動預設300秒，由管理員政策選取；模型、embedding及工具共用同一deadline，原背景／附件工作期限不延長 |
| 生成輸出 | 每次最多 1,024 output tokens |
| 文字上下文 | 初始 32,000；現行互動預設 64,000／允許 32,000–64,000，背景 32,000，依 [已接容量](API.md#agent-input-capacity)；四角色不提高，含指令／資料／schema／必要協定，不把字元當 token |

<a id="rule-adk-07"></a>
2026-10-18 等候與重試補充：管理政策新增 `modelRequestSeconds`（5–180，預設90）及 `maxModelRetries`（0–3，預設3）；互動 `maxRunSeconds` 範圍15–300，預設300秒。Firestore政策是正式權威，環境值只供未接政策的舊入口；既有政策明確提交後生效，不靜默覆寫已保存值。新互動claim在交易內讀取期限，原claim不延長；每輪設定固定，較短的原背景／附件lease仍生效。客戶端傳輸等候涵蓋允許期限及收尾，不決定Server執行額度。SDK仍單次嘗試，重試由同一ADK gateway逐次計量，只處理明確暫時性HTTP失敗，保留原協定及已成功工具；日額或根額度不足立即停止。

上表依 2026-10-16 使用者確認的預算修正，取代平台 4／2、工具 8 的初始配置；不是提前啟動 ADR-020 的其他角色。平台現網設定以版本化管理政策為準，舊政策須明確更新，不靠預設覆寫。每輪指令給出已用、餘額及時間，生成餘額包含本輪，模型自主分配並預留一次生成及 terminal 工具。最後生成、只餘一個工具位置或少於 15 秒時，具有 terminal 的 run 只向模型提供終結工具，回報真實部分成果；引用、收據及權限仍經原核對。每日總額不變。不能沿用 ADK 寬鬆預設或讓 SDK 隱藏重試。取消／到期阻止新操作，但不保證撤回已接受的外部投遞；保留並核對實際結果。超限時不靜默刪除必要授權、來源條件或未完成 call／response 配對，不擅自提高上限。

<a id="rule-adk-08"></a>
所有前景／背景／維護呼叫記實際使用量並受全局開關及配額控制，不能把整個 Agent run 當一次 API。語料向量建立是獨立、有有限批次及次數上限的維護工作，不套用每 run 兩次查詢限制；執行前預覽片段數及必要成本，未變 hash 不重算。P1 現網額度不因文件定案而上調；P2 啟用額度及真服務驗收另按批准範圍處理。

<a id="p2-adk-evidence"></a>
2026-09-24 已核對官方 [TypeScript 要求](https://adk.dev/get-started/typescript/)、[2.1.0 固定依賴／許可](https://github.com/google/adk-js/blob/adk-v2.1.0/core/package.json)、[模型接入](https://github.com/google/adk-js/blob/adk-v2.1.0/core/src/models/google_llm.ts)、[RunConfig](https://github.com/google/adk-js/blob/adk-v2.1.0/core/src/agents/run_config.ts)、[工具安全](https://adk.dev/safety/)及[實驗性 Skills](https://adk.dev/skills/)。這是文件／原文依據；真 Runner scripted 測試與真 Gemini 是不同驗收，不能假設其他語言的原生 resume／confirmation 行為已在本產品 TypeScript 路徑驗證。

<a id="section-4-2"></a>
## 4.2 裝置授權與 Server 連接

<a id="rule-4-2-01"></a>
QR／短碼配對與臨時裝置會話依 ADR-028 取消。下列錨點改記目前正常登入／撤銷邊界，不代表新增實作：

- <a id="rule-4-2-02"></a>新裝置沿正常 Firebase 登入及 Server session，不開配對會話；
- <a id="rule-4-2-03"></a>不再需要另一裝置批准；P5 自選 Server 另核地址／能力／身份；
- <a id="rule-4-2-04"></a>Server 保留各端獨立可撤銷 session，憑據與私人正文不進一般日誌；
- <a id="rule-4-2-05"></a>授權後新裝置直接連接 Server；手機斷線不影響其已授權連線；
- <a id="rule-4-2-06"></a>臨時裝置會話取消；正常登出／撤權清理頁面資料，不提供持久離線業務副本。

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
知識分三層交付：S10-W01／P2 直接建立小型官方 pgvector RAG 核心，含 embedding、版本、核對發布、停用及必要恢復；S10-W02／P2 接共用 worker 作公共來源排程及受影響片段更新；S10-W03／P4 擴充完整管理頁、大規模導入、批量重建管理、效能及知識資料遷移；跨 Server 權威切換屬 P5。三者沿用同一份知識／向量／引用，不建另一套過渡核心。P2 可用可重複執行的匯入、核對及發布指令，不提前建管理平台。

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

`firestore-model-routing` 按登入／worker受信帳號解析同一設定，提供正式Agent、媒體、轉錄及背景的provider／embedding／用量／預算。模型不能選key、任意endpoint或擴權。沿 Google Gen AI SDK 2.24.0：Gemini key走Developer API v1beta；Vertex key走Express v1全球入口、不帶platform project／location／ADC；平台仍用原Vertex ADC。SDK重試關閉，由共同gateway按原run計量及有限重試。

本人可選Server已接協定的模型與進階限制，管理員控制共用保護，`personal-model-policy`計算生效值。首次明確v2保存才採新上限政策，舊設定缺欄位不自動改寫。API及worker共用Firestore權威，無SQL migration或第二套計數；Web／Android共用client。已選設定／政策綁定每個run，設定改變停止後續呼叫但保留已保存結果。相關型別及相容協議只見[API](API.md#personal-model-http)。

2026-09-30 Gemini key地區拒絕證據仍有效；metadata可讀、協定接線與真生成分開。Vertex Express官方只列生成／token計數／串流，未列模型目錄及embedding；對應能力明示未支援，絕不fallback平台。模型目錄是有界供應商metadata與適配profile的交集，不承諾每把key／每個地區皆可用。Gemini2.5使用thinkingBudget、既有Gemini3使用thinkingLevel；不套用同一型號參數。Google真服務、UI及部署的實際gate見PLAN，不以本節代替驗收。


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

本節保留 [ADR-018](DECISIONS.md#adr-018) 的 Agent／業務契約；依 [ADR-024](DECISIONS.md#adr-024) 保留原 VM 交付，替換 SQL 並復用已做的 Firebase Auth／Storage／Tasks。沿用 ADK／ModelGateway、領域服務／加密／操作收據與同一前端 owner；進度只見 [PLAN](../PLAN.md#active)，文件不代表已部署。

- **模型與程式分工：**一個產品 LlmAgent／Runner 處理語義理解及下一步；常用上下文／檢索／結果工具可見，其餘以短能力目錄配合 ADK 原生 BaseToolset 按需載入受限工具及既有配方。來源仍是 Server 核准集合，不依最後一句 regex 取捨能力，也不解析思考文字或加一層固定意圖路由。資料正文不得升為指令。工具 schema／結果回到同一循環；授權、版本、配額及已提交效果由程式保證。首版不加多 Agent、新框架或路由模型。
- **持久接續：**原訊息／事件／收據、通用工作狀態、有 coverage 的摘要三層分開。工作保存目標／焦點／相關資源／待答問題／確認／結果，不預定照護步驟。ADK session 只承擔 run 協定；新 run 由授權業務狀態重建，原操作先查收據，不靠恢復思考。歷史與文件按需分頁，取消／更正／撤權使受影響工作失效。跨輪來源使用實際訊息及版本，不能把摘要當本人同意。
- **確認：**自然提示列清具體變更；Server 綁定操作參數、資源與授權版本、提問訊息及 opId。唯一且仍有效時才可接續簡短確認；多義或舊版重新問。刪除保留具名確認／身份核對；模型工具參數不自行證明使用者已確認。
- **RAG：**原問題及必要上下文 → 必要改寫／拆問 → 資料層適用過濾、向量＋關鍵詞 RRF → 有界同版本章節／頁面擴讀 → 有必要才補查。查詢在 run 內復用，query embedding 同受預算；公共查詢不帶無關私人正文。相似度不能代替引用支持。目前在 SQL 授權／篩選及排名、限量，目標由 Firestore 查詢／索引承接，均只解密所需範圍；沒有全庫載入排序或固定總數超出即全失敗。
- **知識發布：**既有來源 worker 發現新版，HTML／文字型 PDF 用成熟解析器保留頁章及抽取完整度，穩定分段與 hash 增量更新。重要含義核對獨立於 hash，含數值、年齡、時間、條件、例外及撤回；受影響引用／代表問題／成長規則另核。模型可輔助但不能以自報信心單獨放行。可判定安全的變更依政策發布，不確定留候選，已知失效舊版停止供應；暫失不等於失效。來源條款沿既有邊界。
- **資料範圍：**檢索、摘要、文件及背景入口都由 Server 注入本人／孩子／授權版本／用途。保存或外發前再核對來源與目的地；讀取不等於披露授權。私人／公共／孩子資源分開；失權或來源更正觸發相關摘要／候選／文件失效。不得透過歷史、快取或遲到回應繞過。
- **文件與報告：**同一 FamilyDocument 作權威，穩定章節／項目 ID 及固定版本分段讀取；局部 patch 與 expectedVersion／opId 交易保存，衝突先重新讀取。不以新增聊天或另份文件替代修改。自動來源區與指定內容分開；歷史恢復是同一文件的新版本。季度／年度以有界批次覆蓋完整期間，先可重現統計再必要敘述，同版 Web／PDF；日常成長頁是同源投影，不在讀頁生成。
- **主動性：**保留事件／到期／階段／有效知識版本觸發；目前 pg-boss，目標由 Tasks／Scheduler 與原業務台帳承接，先核相關性和終態、授權、渠道、安靜時段與抑制。沒有新條件不調模型；站內與外發分開。原邏輯工作／通知證據支援重啟去重，不重設跟進上限。
- **服務：**本人獨立空間、邀請資格、驗證／找回／裝置會話及退出維持原行為；Firebase Auth／Firestore 與原 VM／Compose／Caddy 配合，詳見 [下節](#firestore-target)。復用已實作接點，只補受影響的健康、恢復、告警及成本控制；舊驗收不冒充新環境證據。

有界讀取統一交代所讀版本／範圍、complete／未讀理由及續讀位置；查詢錯誤不偽裝空結果。完整期間工作保存可恢復進度，不能截前綴交作完整報告。沿當前有效單次及每日上限（互動文字上限依 [API 容量契約](API.md#agent-input-capacity)，背景 32,000），修正／載入／收尾均計入 run；維護向量另有有限批次。超限不靜默丟必要權限／來源／工具配對，不自動新 run 繞過。

方法參考：沿用 [ADK 2.1.0 LlmAgent](https://github.com/google/adk-js/blob/adk-v2.1.0/core/src/agents/llm_agent.ts) 原生工具集合；借鑑 [Codex 工具循環](https://developers.openai.com/blog/codex-as-a-platform)、[OpenHands 持久事件與狀態](https://docs.openhands.dev/sdk/guides/convo-persistence)、[查詢轉換](https://developers.llamaindex.ai/python/framework/optimizing/advanced_retrieval/query_transformations/)及[檢索後上下文擴展](https://developers.llamaindex.ai/python/examples/node_postprocessor/metadatareplacementdemo/)。只採方法，不因此引入另一個 runtime 或 Python 檢索服務；官方已核對與產品實測分開。

<a id="p2-a05-reports"></a>
### P2-A05：同源日常與季度／年度報告

使用既有 FamilyDocument store 及 pg-boss 文件 worker，採有界掃描、加密累計、來源修訂核對和原子發布。每次只處理一批，沒有年度全量交易／全量載入；完整統計與有限正文選錄分開。日常 living 報告隨來源事件及香港日期延展更新，季度／年度固定期間保持原界線。前端只投影同一文件及 reportCoverage，PDF 讀同一固定快照並在輸出前後覆核來源。正常讀頁不整理、不呼叫模型；舊固定／部分報告保留 partial 身份直到明確刷新完成。

<a id="p2-a06-continuation"></a>
### P2-A06：有用的站內接續

沿用 agent_work 與原生 pg-boss，按工作保存的有限 followUp 條件判斷已引用資源的實質變更、指定到期及已引用官方來源的有效換版。工作正文仍只供本人；派生的檢查基線、原事件及 run 關聯不是另一份任務或事實。每批最多檢查10項工作，每本人／孩子／香港日最多合併5項成一個站內 run；額外變更保留至下一日，不為補查繞過模型上限。未有新條件只處理 metadata，不調模型。

新 work_continuation 僅能讀取本人授權資料、查證及整理站內回饋／必要補問；不提供寫入、確認或聯絡工具，不能把私人工作內容交給其他照顧者。到期任務的本人通知、成長關注及已確認關注的跟進沿既有流程和授權，不重建渠道。保存新工作版本／取消／完成、相關終態、撤權或 epoch 改變使舊事件停止；已開始或未知 run 沿原 trigger 查收據，不開新 run 重做。


<a id="p2-a08-service"></a>
### P2-A08：单人服務接點

身份沿Better Auth1.7.5的驗證／找回／會話機制，SMTP沿Nodemailer，驗證郵件使用原pg-boss與加密outbox；不另造密碼或郵件協定。邀請資格、當前政策確認和資料退出由Server業務服務負責。正式invited模式的HTTP與模型入口重新核对本人資格，缺配置／未確認不默認放行。平台模型仍可直接使用，沒有要求用戶自行配置GCP或key。

帳戶資料下載按固定領域讀取器分頁，與頁面／Agent共用權威及遮蔽規則，不建立另一個可寫資料副本。刪除journal位於資料庫備份之外，原意圖重放及照片清理先於恢復開放；新增服務啟用後不能回退到不懂刪除journal的舊Server。正式郵件、備份保留／復原、邀請規模與營運費用在A09核定，A08本機捕獲郵件只證明程式流程。


<a id="firestore-target"></a>
## 原網站的 Firestore、Firebase Auth 與工作接點

<a id="local-agent-runtime"></a>
### 本機開發的同一正式組裝

開發入口沿 `openFirebaseRuntime`、ADK／ModelGateway、Prompt Pack、領域服務及正式 Web。只有明確的非 production、loopback、`demo-` 專案才可注入本機 Auth／Firestore／Storage 及模型憑證接點；缺 emulator 直接失敗，資料專案與 Vertex 模型計費專案分開。正式啟動拒絕本機旗標／emulator 設定，不提供免登入 API。本人合成帳號仍經准入、政策同意、裝置會話及原操作收據。

每個 worktree 使用自己的端口、資料目錄及 session cookie 名稱；cookie 本身不按端口隔離，不能共用正式 `__session`。本地背景入口只替換 Tasks／Scheduler 喚醒，復用同一 consumer、claim、generation、取消及 unknown 規則。正式環境不載入本地診斷端點；外發停用，不能把本地捕獲當成渠道接受。

Auth／Firestore／Storage 快照用於本地重啟，不代替正式備份或崩潰持久性。Storage Emulator 的 generation 限制由單一本機 runtime 的薄 adapter 補齊，不作多副本競爭或 IAM 證據。模型費用仍經原用量台帳；普通啟動不自動跑驗收或重建向量。操作及能力邊界見[本機入口](AGENT_LOCAL.md)，實際門檻見 PLAN。

本節保留待完成的遷移契約；F01／F02 已合併，F03 核心資料與聊天接線中，不能把目標當全量接通。沿用 Node、ADK／ModelGateway、領域服務、加密及前端 owner，只改必要資料／身份／工作接點。工作包及切換順序見 [PLAN](../PLAN.md#p2-firestore-migration)，資料與 HTTP 語義見 [DATA_MODEL](DATA_MODEL.md#firestore-target)／[API](API.md#firestore-target)。

依 [ADR-025](DECISIONS.md#adr-025)，先完成全部正式 SQL 依賴替換與 GCP Firestore 資料接點，再驗收受邀用戶及切換原站。可從乾淨資料開始，無須保存或搬遷舊 SQL 測試資料；不以此取消新資料的隔離、收據、刪除及恢復。API／前端契約持續兼容，不要求每個資料域獨立部署或增加一套產品網站。

### 元件、交易與查詢

原 ex-machina.eu.org 由既有 VM／Compose／Caddy 供應 frontend/dist、同源 API 及受驗證的工作入口；保留設計與互動。Firestore Standard Native 保存業務／操作權威，私有 Storage 保存加密檔案，Tasks 投遞工作，Scheduler 作補償喚醒。VM 以附加服務身份／ADC 及最小 IAM 存取服務，不下載長期服務 key。業務資料／運算預設 asia-east2；Firebase Auth 的美國處理取捨保留，不能宣稱所有資料均在香港。不採 SQL Connect／Cloud SQL，不要求 Hosting／Cloud Run API／worker 或新增搜尋叢集。

領域 store 保留接口與驗證，按實際查詢拆 collections／索引；不實作通用 SQL 相容器。Server 在查詢前加入本人、孩子、visibility／membership 與用途條件，按索引排序／cursor 分頁。SQL join 改必要 metadata 投影及有限點讀；投影可以重建，不能獨立修改正文。長文件、修訂及累積歷史分段，保留固定版本、coverage 與續讀。不能為避索引限制先讀全庫或只在任意 top-k 後篩選。

Firestore 交易先讀權限／刪除狀態、版本、唯一性及原操作，驗證後一次寫入業務、收據、workspace changeSeq 和 outbox；SQL savepoint 的部分失敗語義以事前驗證或分開的明確原子業務命令承接，不吞錯後提交半成品。交易回調可能重跑，禁止模型、郵件、通知、Storage 或 Tasks 呼叫。唯一性用確定 ID 的佔位文件；共享配額預留同樣持久且嚴格，不以分散計數弱化全站上限。workspace 序號避免全站熱點，仍須量測同 workspace 競爭。

[官方限制](https://docs.cloud.google.com/firestore/quotas) 包含單文件 1 MiB、API request 10 MiB、交易 270 秒及 60 秒閒置限制；單次業務不得接近最大值才拆分。批次上限同時核對 SDK、索引放大與目前產品容量，不假設 SQL 一次可做的 cascade 都能塞入交易。父文件刪除不刪子集合，FK、trigger 及清理必須變成持久、可接續業務流程。[交易重跑](https://docs.cloud.google.com/firestore/native/docs/manage-data/transactions)

### 身份、准入及會話

採 Firebase Authentication，保留 Auth 介面與登入畫面；其內部 Better Auth wire protocol 由 adapter 映射，不假設 Firebase 可直接接受舊 API。邀請、家庭角色、私人分享範圍、當前政策同意和資料退出仍屬產品。Identity Platform blocking function 在建立帳戶前檢查有效邀請，Server 准入交易再核對／消耗資格、建立本人空間；中途失敗保留可恢復狀態、禁止業務存取，不能在 Auth 建帳成功後自動加入別人 workspace。所有登入方式都經准入，不能靠隱藏前端或僅 beforeCreate 保護已存在但未准入的身份。[blocking functions](https://firebase.google.com/docs/auth/extend-with-blocking-functions)

依 [ADR-022](DECISIONS.md#adr-022) 從乾淨 Firebase 身份開始，不匯入舊 UID、電郵、密碼雜湊或私人資料。新 uid 綁定唯一穩定業務身份及本人 workspace；舊 session 不獲新系統接受。舊身份匯入／STANDARD_SCRYPT 相容是被取代方案，不能標成已驗；新身份驗證、找回及密碼重設後撤銷仍須完成。Firebase 全帳戶 revoke 之外，Server session ledger 保留每裝置狀態／到期／撤銷，不能把全帳戶撤銷冒充逐裝置能力。[匯入](https://firebase.google.com/docs/auth/admin/import-users)／[session cookies](https://firebase.google.com/docs/auth/admin/manage-cookies)

Web 與 Android 共用 Firebase JS 身份 adapter、正式 owner 及業務 API；只分開平台 transport。Web 沿 HttpOnly Cookie，Android 沿受控交換取得 SecureStore 中的明確 bearer，兩者由相同 Server 身份／准入／逐裝置 ledger 核對，使用不同 ledger hash domain，不能互換。原生無 Cookie／Origin，Server 不接受瀏覽器混合憑據，也不開跨站 CORS 或管理員入口。各領域 API、附件與聊天串流注入同一 transport，不能另行保存身份或直讀 Firestore。精確協議見 [API 原生會話](API.md#native-session)。

瀏覽器不直接存取 Firestore／Storage 業務資料。Admin／Server SDK 用 IAM 且繞過 Rules；每個 HTTP、Agent tool、worker 和附件下載均自行校驗目前權限／准入／epoch。規則拒絕未授權 client 不能代替 Server 檢查。限流、session 撤銷與模型預留跨 instance 保存，不能只用記憶體；key／密碼／找回 token 不入 prompt 或一般日誌。[IAM 邊界](https://docs.cloud.google.com/firestore/native/docs/security/iam)

<a id="縮零outbox-與非同步-agent"></a>
### 原 VM、outbox 與 Agent 執行

正式 Agent 組裝按 Server 持久操作綁定用途：聊天使用原訊息；背景／接續使用原工作 lease、generation 及 run；照片／分享文字使用原抽取 run、來源 ID／版本。共同 binder 核對身份、孩子、授權／儲存版本、絕對期限及預算，不把抽取偽裝成聊天或由 HTTP 指定用途。抽取／背景執行中與完成前重新核對原授權及終態。照護摘要工具注入與頁面相同的 summary service，只需要讀取接口。


交易只寫 Firestore outbox；commit 後 dispatcher 才用確定工作 ID 建立 Cloud Task，成功回寫派送狀態。崩潰在任一側以原 ID／lease／generation 查核接續，台帳是權威，Tasks 的短期名稱去重不等於 exactly-once。每分鐘一個 Scheduler OIDC 補償入口分頁領取待派／到期項，不全表掃描；長期預約留台帳，只提前 24 小時送入 Tasks（官方最遠排程 30 天）。worker 在原 VM 入口核專屬 OIDC／audience／服務身份；派送身份及 enqueue 權限另由 IAM 限定，不能依賴 Cloud Run invoker IAM 代替 VM 的應用驗證。[Tasks](https://docs.cloud.google.com/tasks/docs/creating-http-target-tasks)／[限制](https://docs.cloud.google.com/tasks/docs/quotas)

Tasks／Scheduler 呼叫原 VM 的 HTTP 工作入口，無須 Cloud Run。由應用核 OIDC 簽章、issuer、audience、期限及固定服務身份，不能把公開 HTTPS 路徑當成已授權；沿既有 lease／generation、收據及防重。worker 請求覆蓋完整有界工作，期限與 Task dispatch deadline 協調；中斷先查原效果，unknown 不盲目再生成或通知。每次領取／外發重查授權、任務終態、版本、渠道及安靜時段；不用 pg-boss 或 HTTP 回覆後的無台帳計算。

F06 的原提醒 consumer 與 `product-work` 共用上述入口；後者按 Server 台帳種類呼叫同一關注、成長、接續、文件、來源更新、附件清理、退出及通知服務。業務變更同交易建立 child-change，dispatcher 每次只派有限到期工作；恢復工作用持久游標逐頁掃描，無程序內 interval。維護只取有限 metadata；知識仍走既有來源排程與核對／发布，沒有啟動 P3 自主維護 Agent。

私人接續仍按本人／孩子／香港日合併最多五項成一個 run；每批至多讀十項，無新依據不呼叫模型。事件保存原工作、資源及來源版本，執行前重核；工作更改或取消後不沿舊事件繼續。程序重建查同一 run／工具／投遞收據，已成功不重做，未知外部結果不自動重發。渠道失效會撤銷該版本綁定；渠道接受、使用者收到和任務完成各自保存。

文件刷新只推進一個有界資料批次，沿原文件 ID／版本和來源 revision；手動修改衝突停止整理並保留內容。清理工作可在使用者已撤權後依原刪除 intent 繼續，但不得藉 SYSTEM 路由存取其他業務內容。所有新增資料域同時登記匯出／配對備份／刪除；完整還原 codec 是 F07 門檻，不能以登記完成代替還原證據。

互動沿既有可用請求、message／run／原操作關聯、進度、取消及收據接口；不因已取消的 Hosting 60 秒限制強制改成 202 協議。需要排程的工作仍須先持久保存 run／outbox，才可回已受理；頁面關閉不等於取消。Firebase Auth 已有 __session 可繼續使用，同源、CSRF、身份切換清理及 private, no-store 保持。原 Caddy／API 逾時須與有界運行協調；未遷移接口明確報未就緒，不回空資料或假成功。

<a id="firestore-multi-instance"></a>
### 多容器與橫向擴展接點

P2 正常部署維持原單 VM 的 Web／API／worker 分工，不新增 Kubernetes、VM、Redis 或負載平衡服務。可安全增加 API／worker 副本是資料與執行契約，不代表已驗高負載／高可用；同一 VM 增加容器不增加主機總資源。

- **准入與用量：**本人／全站並發名額、原 trigger／run claim、逐日配額及每次呼叫預留使用 Firestore 共用權威。現有 activeUsers 只能作本程序保護，不因副本增加而倍增名額。本輪先沿嚴格且有界的交易／租約，不提前建立分片計數平台。
- **取消與提交：**原 run 的持久取消／終態由任何副本可讀；本機 AbortController 只加速停止。模型／工具前後與提交時重核權限、期限及終態，另一副本接受取消後不得再提交新副作用；已成功保存的收據不回滾。未知外部結果不因 lease 到期自動重發，原效果與成本先核對。
- **工作競爭：**worker 沿同一 lease／generation／epoch 領取與提交；Tasks 重投不是新業務操作，Scheduler 補償入口只配置一份。不靠容器內 timer、程序 Map 或固定主機作唯一執行權威。
- **部署與檔案：**正式附件／成果及刪除紀錄存外部持久服務，本機只留可丟棄暫存。API／worker 用外部配置、服務名稱與可配置代理上游，不依賴固定 API 容器 IP、黏性會話或共享本機檔案。保留便宜的健康接點及有界停止，停止領新工作後核原收據／unknown，再按期限結束，不承諾中斷的模型必然可重播。
- **驗證範圍：**只在必要合成情景暫啟兩個程序／容器核准入、防重及跨副本取消，重用重啟證據；不作壓力測試或常駐第二副本。之後才按實際需要選 Compose 多副本或 Kubernetes Deployment，所用權威資料不隨 orchestrator 更換。

已核對官方 [Compose 服務名稱](https://docs.docker.com/compose/how-tos/networking/)、[Kubernetes Deployment](https://kubernetes.io/docs/concepts/workloads/controllers/deployment/)與 [Firestore 競爭／游標建議](https://firebase.google.com/docs/firestore/best-practices)；文件相容不代替本工程多副本已驗。實作與證據由 [F03／F06／F07](../PLAN.md#p2-completion-execution) 承接。

### 官方知識與發布

採 Firestore 原生向量（目前 1024 維低於上限 2048），沿 embedding 模型／處理版及向量相容性校驗，兼容資料直接遷移。保留標題、章節、主題、正文的候選能力、原權重及 RRF。Standard 沒有全文搜尋：公共分詞／n-gram 以分段 posting／有界候選索引承接，避免巨型 token 陣列及索引爆增；中文口語／改寫、正文獨有命中與無相關資料是必要品質對照。不是關掉關鍵詞或另起常駐搜尋服務。[向量](https://docs.cloud.google.com/firestore/native/docs/vector-search)／[全文搜尋限制](https://docs.cloud.google.com/firestore/native/docs/text-search)

地區、年齡基準、分類、公開／組內、有效版本等 prefilter 與 composite vector index 在 F01 對照。遇到 Firestore 查詢組合限制，使用有限適用分區／索引投影後查詢；不得以跨 scope 全量候選再由模型篩選。F02 驗實際索引及讀費；補取和同版本上下文續讀有界，資料不足明示，排名不能當來源支持。

內容／向量以不可變發布批次與原子 active 指標開放，建構未完成批次不參與搜尋；未變片段可以復用，不能把不同來源版本拼成同一次發布。來源停用有獨立即時閘；輸出引用前重核有效版本／範圍，失效候選有限補取。官方重要含義、抽取完整度及使用條款仍按原政策核對，遷移 hash 正確不等於內容核准。公共庫不含家庭、聊天或私人付費來源；私人檢索沿授權有界掃描與加密邊界，不暗建公共明文索引。

### 檔案、刪除及恢復

照片／PDF／原手冊存私有 bucket，固定資源 ID、hash、object generation 及資料版本。沿 StorageCipher／穩定 AAD 保留應用層加密，metadata 列明必要解密版本；密鑰分開保存。上傳先預留、以 generation precondition 寫不可變物件、校驗成功才發布 metadata；失敗可恢復／清理孤立物件。下載由 Server 核權，不使用永久 Firebase download token；PDF 仍讀同一文件快照。[generation 前置條件](https://docs.cloud.google.com/storage/docs/request-preconditions)

永久刪除先以 ifGenerationMatch=0 在**獨立 bucket** 保存加密 intent，然後交易標記關閉／撤權及建立清理工作。跨 Storage／Firestore 無交易，因此以穩定 intent ID、持久階段及原收據恢復；intent 成立後即使業務步驟失敗仍向前完成，未知不重新開放資料。常規執行身份不能覆寫／刪除 journal 物件；不放在會一起回退的資料備份內，也不只依賴有限期 soft-delete。帳戶、孩子和需永久刪除的附件都受 journal 覆蓋，清理子集合可分批，不宣稱立刻抹掉所有備份。

依 [ADR-026](DECISIONS.md#adr-026)，日常使用 Firestore 原生每日備份、保留 14 天，不停站或輪換工作世代；受控部署／演練仍可使用既有配對匯出。原生備份保存密文及索引設定，不包含 Auth、Rules、TTL 或附件。附件以同一資料快照內的 generation／hash 連到不可變 Storage 物件；私人 bucket 的 soft-delete 必須至少 14 天，不能沿用早期 7 天假設。尚存原物件可精確讀取；只有獨立日誌證明未永久刪除、來源已暫停及精確 generation 仍在復原期內，operator 才能有條件恢復其密文，再核對及轉入新 storage epoch。缺物件／日誌／密鑰時停止，不將資料庫備份單獨稱為完整配對成功。既有獨立附件備份／manifest 仍按原期限保留及核對，不回寫原證據。[備份](https://docs.cloud.google.com/firestore/native/docs/backups)／[soft-delete](https://docs.cloud.google.com/storage/docs/soft-delete)

只還原至隔離資料庫及命名空間，worker／Tasks dispatcher／通知保持暫停。先取得最新完整 journal 並重放，對照當前 Auth 存活／撤銷與附件，更新 storage epoch／失效舊 session，核對索引與配對完整度才開放。journal 缺失、無法證明完整、物件不齊或 Auth 已刪除時保持關閉，不能從舊備份復活用戶或投遞。新寫入後只回退 Firebase 相容應用版本或隔離還原，不切回 SQL；新資料、原收據及最新撤銷／刪除權威必須保留。切換前舊版與備份仍可封存；乾淨起點不授權刪除舊資料，見 ADR-022。

<a id="firestore-cost"></a>
### 費率、計量及低用量控制

**2026-10-12 現行取捨：**保留原 VM，優先減少重新搬網站與重做驗收的工程成本；Firestore 減少自行維護資料庫，不代表 VM 固定費消失或總費用必然降低。依已保存的 2026-10-11 香港 SKU，25 萬計費讀取及 5 萬寫入、不扣免費額約 US$0.24／月；另計向量索引讀取、容量、備份／還原、附件、模型、網絡及 VM。小規模電郵身份通常在首 50,000 MAU 免費範圍，但函式等服務另計。來源：[Firestore](https://firebase.google.com/docs/firestore/pricing)、[Identity Platform](https://cloud.google.com/identity-platform/pricing)。這是估算，非帳單或新增費用授權。

下列 2026-10-08 費率及 $2–6／$8–20 表保留為**舊 Cloud Run 路線的歷史估算，不是保留 VM 後的總月費**；原假設與未量測限制見[原假設表](#firestore-low-usage-assumptions)。

| 計量 | 核對值／計算注意 |
|---|---|
| [Firestore 香港](https://cloud.google.com/firestore/pricing) | 每十萬 read／write／delete 約 $0.06／$0.18／$0.02；storage 約 $0.18/GiB-month，backup 約 $0.035/GiB-month，restore 約 $0.23/GiB；索引儲存及掃描亦計費 |
| 向量索引 | kNN 每批最多 100 scanned entries 計一個 read unit，再加結果文件讀取；5,000 entries 全掃約 50 units／查詢，不只算六個回傳片段 |
| [Cloud Run 香港](https://cloud.google.com/run/pricing) | 活躍 CPU $0.0000336/vCPU-s、記憶體 $0.0000035/GiB-s，請求 $0.40/百萬；冷啟動、模型等待及 Scheduler 喚醒也計入活躍時間 |
| [Storage 香港](https://cloud.google.com/storage/pricing) | Standard 約 $0.023/GiB-month，另算操作、傳輸、備份／soft-delete／舊版本；不適用美國指定地區免費儲存 |
| [Tasks](https://cloud.google.com/tasks/pricing)／[Scheduler](https://cloud.google.com/scheduler/pricing) | Tasks 首百萬計費操作後 $0.40/百萬，payload 按 32 KB 分段／重試算操作；Scheduler 每帳單首 3 jobs 免費，其後 $0.10/job-month，喚醒 Run 的計算另收 |
| [Identity Platform](https://cloud.google.com/identity-platform/pricing) | 此規模 email／password MAU 在首 50,000 免費段；blocking functions 計算／網絡另算，不包含 SMS |
| [模型](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing) | Gemini 3.1 Flash-Lite input $0.25／output $1.50 每百萬 tokens；gemini-embedding-001 線上約 $0.00015/千 input tokens；維護 embedding 另外預算 |

免費額的每日／database／project／billing account 範圍各異，不能假設其他測試沒使用；Cloud Run 免費抵扣依指定費率，不直接套同數香港免費秒數。請求／向量／關鍵詞索引與 changes 輪詢要分開量測，Scheduler 只掃有索引的 due/outbox，空隊列也有最低查詢及冷啟動成本。

低流量仍可能有 backup、soft-delete、舊物件、映像、Secret Manager、日誌及附件外傳費；保留原 VM／磁碟／IP 的固定費須另計。額外 Hosting／Cloud Run API／worker 依用途及依賴核對後清理，保護 Auth blocking function、有效資料及備份；實際清理證據留所屬工作包。不預設新增 min instances、VPC connector、NAT、負載平衡器或搜尋服務。

配置 max instances、queue dispatch／concurrency、共享預留／停用閘、匯入／索引重建批次與 retention；模型上下文、重試、輪詢、附件下載和濫用註冊是突增來源。預算告警不是硬性停費保證。上線前以實測及資源清單核准上限；50 帳號容量欄不提高既有產品配額。

<a id="firestore-low-usage-assumptions"></a>
#### 低用量預算假設（2026-10-08；未實測）

**歷史：已取消 Cloud Run 路線的 2026-10-08 估算。**美元／月，不是帳單、免費保證或資源授權；未扣促銷信用、未含舊 VM 及一次性建置費，不能當作現行原 VM 路線總費用。費率見 [成本依據](#firestore-cost)。

| 每月估算 | 10 帳號／3 日活 | 50 帳號／15 日活 |
|---|---:|---:|
| Agent 運行 | 120 | 600 |
| 每 run 平均 | 3 次生成、1 次 query embedding | 相同 |
| 每次生成 | 10,000–15,000 input／500 output tokens | 相同 |
| 一般 Firestore 讀／寫 | 25 萬／5 萬 | 100 萬／25 萬 |
| 公共 chunks／向量查詢 | 5,000／120 | 5,000／600 |
| DB／原附件 | 0.5 GiB／1 GiB | 2 GiB／5 GiB |
| Scheduler 補償喚醒 | 約 43,200 次 | 約 43,200 次 |
| 活躍 CPU／記憶體 | 30,000 vCPU-s／20,000 GiB-s | 100,000／70,000 |
| 模型預算 | 約 $1.2–1.7 | 約 $6–8.3 |
| 整體規劃區間 | **約 $2–6** | **約 $8–20** |

**實際成本待量測：**本表仍是平均每 run 3 次生成的歷史情景，不是聊天成果的已測帳單；本輪按現行配置記錄完成一件聊天工作的 tokens／呼叫／耗時與返修。其他三角色及歷史 6 次生成提案暫緩，其成本不得預填為已驗或當本輪交付前置；未因此批准提高每日額度。

模型按現有 Gemini 3.1 Flash-Lite／gemini-embedding-001；新增語料 embedding 另算，兼容向量遷移不重算。CPU 假設包含補償喚醒／冷啟動及 Agent 等待，F02 量測後修正，不當已測效能。區間容納配對備份、索引、少量傳輸／日誌；免費額被共用帳單其他服務佔用、大量下載或重建須另算。50 帳號只是容量情景，**不批准提高每日額度**；現有上限可限制實際服務量。

<a id="p2-agent-roles"></a>
## 四角色接口與 P3 內部編排

依 [ADR-024](DECISIONS.md#adr-024)，P2 只啟用聊天 Agent；以下委派、模型審核及自主維護內部流程移至 [P3-M01～M03](../PLAN.md#p3-agent-roles)。P2 只留角色識別／enabled、模型與提示詞模組、工具權限、輸入輸出契約，以及共同根操作／身份／取消／期限／用量接點。三個未啟用角色不實例化、不暴露工具、不回假成功；現有文件、記錄、提醒與程式引用／schema／版本／授權檢查照常保留。復用 ADK、ModelGateway 和 Prompt Pack，不預建四套服務或提示詞。

### 互動與知識維護分開

聊天 Agent 保持對話控制，使用現有工具或按需委派資料編製 Agent；子任務結果返回聊天。Server 在交付實質內容前調用唯讀審核 Agent。獨立的知識維護入口由排程／管理操作喚醒，讀指定網站、自主整理後走審核及發布；不作聊天的搜尋子模型，也不讀家庭私人資料。

P3 資料編製以原生 AgentTool／LlmAgent／Runner 建立薄委派接點；審核由 Server 控制，背景維護由獨立 Runner 入口啟動。固定 2.1.0 AgentTool 的子 Runner 不能假定繼承專案 RunConfig、validator、observer 或全局用量；需明確注入共用 ModelGateway／根預算／取消／scope，子角色不再委派其他角色。模型協定 parts 保持完整，review 由 Server 調度，不能由模型選擇略過。技術依據見 [固定版本核查](TECH_REUSE.md#multi-agent-reuse)。

同一互動 root runId 下，各次子執行保存角色與父關聯，沿原工作／收據恢復，不將 ADK session 當業務權威；重啟不重設預算。工具委派及子工具呼叫都計入根工具上限，失敗／被拒亦計；審核模型呼叫同樣計生成。保留 schema／權限、metadata-only 診斷及內容捕捉關閉，不輸出思考過程。

### 資料編製與審核提交

資料編製按任務取得原資料與用途 schema／模板，產生可重用資料或局部修改，不限文件。記憶、任務及文件仍回各自業務服務；統計／日期／PDF 排版沿確定性程式，不靠模型重算。模型整理／推測不能升格事實，原文／精度／coverage／可見範圍與來源引用保留。

流程為：讀授權資料 → 編製草稿／patch → 程式驗格式與引用 → 審核核對原始證據及含義 → 必要使用者確認 → 交易重核版本／權限後提交 → 呈現核准內容與收據。審核前可保存受保護草稿，但不得改正式成果；提交時再核內容 hash、來源、對象及版本，不能只信先前的通過狀態。來源／授權／成果變更令審核失效；衝突讀回最新版，不整份覆蓋未要求內容。

審核 Agent 為唯讀：核重要說法、數值／單位、日期、年齡、否定、例外、範圍和實際支持，返回通過／需修正／證據不足及有界問題清單。公共建議看官方原文，家庭陳述看當前授權記錄，不強配公共引用；抽取自圖片的內容須能查看原頁。模型判斷不能替代引用身份、來源有效性及安全校驗，亦不是臨床有效性證明。

Server 控制哪些成果必審，不能讓生成者以自報 clarification／免審標記繞過。純澄清、確定性操作、真收據及仍適用的預核緊急求助內容沿原守衛直接呈現。通過後不再任意改寫成未核文字；未核串流不外露。既有工具已成功而審核／收尾失敗，依台帳分開回報已做與未完成，不重做副作用。

### 指定網站的獨立自主維護

來源登記允許網域／路徑／主題、使用範圍、更新頻率及抓取／頁數／深度／時間／模型預算；可在其中讀目錄及跟進站內連結，不限固定 URL。每次 URL、redirect 及附件重新套用原 SSRF／大小／格式／來源守衛；外部正文不成為指令或授權。重疊排程沿來源／版本／操作指紋防重，有界 frontier／游標、lease／generation 與 coverage 保存進度。沒有變更不重做模型整理，未完整讀取不能發布成完整手冊。

HTML／文字 PDF 先沿原解析器；掃描頁、圖表和有資訊的圖片才多模態。新增來源維護專用有界輸入接點，不全域解除現有聊天 gateway 的單張照片／fileData 限制。原始頁面、hash、章節頁碼與抽取方式保存；原生原文、模型抽取和綜合整理分開，數字／單位／註腳／例外連原頁供核對。

整理與新版比較後，獨立審核核含義，再由程式驗引用／版本／範圍／完整度及發布資格；通過則受限發布工具原子切換有效批次，無須人工逐項搬資料。疑義或衝突保持候選；已知失效即停用，暫時取得失敗不自動撤回。官方更新不自動創造或修改醫療／成長執行規則。發布事件只令已有相關性／授權流程評估，不向全部家庭直接推送；私人來源與家庭資料永不進公共維護上下文。

已發布片段與本次原文範圍、PDF 頁面一對一完全相同時，保留片段 ID、整理內容、適用欄位及原 hash，不送模型重新編製。新觀察仍按發布管線核對；新增／改變的範圍才整理，含糊匹配不自動沿用。觀察 hash 使用與持久保存相同的正規化資料，不能因物件欄位順序而把同一 PDF 判成另一份來源。Server 把實際成長規則的來源 key／hash／revision 與前後狀態交審核；綁定改變或缺失一律保持待核，模型不能覆蓋成 `none` 或自稱規則已核准。

維護模型只回報原文支持程度的 `decision`／`decisionReason`、含義差異及檢查。執行規則的 `growthRuleImpact`／理由由 Server 按 catalog 計算；沒有綁定不等於有規則改動，也不豁免語義審核。模型不能另建「凡醫療資料都須人工批准」的條件；具體證據不足仍保留候選。編製、審核及背景整理的無工具呼叫亦附同一根預算的剩餘次數／時間，只提供規劃資料，不增加額度或權限。

### 預算及成本

P3 四角色提案沿共同 [運行配置](#p2-agent-budgets)，所有角色合計最多 6 次生成；這不是本次提高 P2 執行限額的授權，P2 沿實際配置及本人更低上限。P3 啟用時預留必要審核額度，餘額／期限足夠才最多一次修正及重核；不足保存進度，不新開 run 繞限。子 Runner 必須經共用 ModelGateway 計量，不假定 ADK 自動繼承專案預算。

背景公共維護用平台獨立有界工作預算，不占某家長互動 run 或私人 key，仍受全局生成／embedding／費用控制；分批／重啟不清零邏輯工作累計用量。每批源量與多模態成本須在啟用前核定，現有維護授權不能推定新增爬取／模型成本已批准。原 [成本表](#firestore-cost) 的平均 3 次生成只是情景，新增審核／資料編製及多模態需量測後更新；不因此提高每日額度或預設更多付費服務。


<a id="private-memory-maintenance"></a>
### 私人記憶整理接線

私人摘要使用既有 Firestore 業務服務、背景工作及同一 ADK Runner；不另建記憶庫、模型壓縮服務或 P3 Agent。交易內只提交原文／變更、合併整理請求及 outbox；模型在交易外、最多一次生成，之後以原 run、來源版本與 coverage 交易保存。保存的批次在後續請求復用，並於每次 provider 請求前核對，不把摘要累加進 ADK session。

純近期訊息選取在 agent-context-window；Prompt 組裝驗證在 agent-prompt；總請求與原生協定容量閘在 ModelGateway；資料有效性與修復在 Firestore memory；排程、付款、租約、unknown／終態由現有服務掌管。詳細來源及覆蓋見 [批次資料契約](DATA_MODEL.md#memory-summary-batches)，入口及上限見 [API](API.md#memory-batch-maintenance)。

<a id="agent-observation-boundary"></a>
### Agent 執行端口與故障觀察

產品編排及私人摘要整理依賴 `AgentRuntimePort.run`，模型透過既有 `AgentModelProvider`，業務工具透過各領域 service；正式 factory 注入同一 Runner／Firestore／配額接線。測試可替換 provider，不能以另塞工具代替正式組裝。此邊界不建立額外 DI 或另一個 Agent。

ADK plugin 將事件投影為固定 metadata，按 runId 回查原訊息／操作台帳；只含 phase、layer、已登記工具、耗時及既有允許的狀態／錯誤碼。`model` 是模型接線觀察點、`tool` 是工具邊界、`authorization` 是明確拒絕、`business` 是已知業務結果；未知外部失敗不猜成資料庫根因。API 身份與傳輸仍用現有 API 錯誤碼；不把 SDK run_end 當成業務保存完成。

受信任的每次 `onDiagnostic` 與營運 logger 各收到獨立 metadata 副本，非阻塞且失敗隔離；不接收原始 args、模型正文、思考或 stack，不新增 Firestore 逐事件日誌。此端口供即時回饋取材，並不授權外發或改變取消／期限／提交；對客戶端的事件仍須經正式 HTTP 身份與產品投影。


<a id="p4-p5-architecture"></a>
## P4／P5 目標邊界（文件定案，未實作）

本次沿用原網站、共用 Expo 畫面／owner、VM／Compose、Firestore、Firebase Authentication、Storage、ADK／Prompt Pack 與同一業務服務，不另建教師 Agent、多人資料副本或 SQL 層。現有各包完成證據與本節未實作目標分開；[ADR-028](DECISIONS.md#adr-028)／[PLAN](../PLAN.md#p4-integrated) 管替代與階段。

1. **個人／班級優先：**身份、穩定資料歸屬及目前管理員分開。家庭只接選定模組，教師空間只接加入的班級；組內同源。所有領域讀寫與背景、檔案、報告、匯出走共用授權，UI 不決定資料權限。加入方式與移出／退出策略依待決，不在架構先固定搬移或刪除。
2. **共用助手：**Server 固定多孩／班級目標與版本，提供有界名冊／相關召回及批次工具，保存逐項結果及收據。私人混合聊天與孩子／班級業務成果分開；不用全班歷史填上下文，不逐孩重跑 Agent，不換 run 繞預算。需 D 接口才等待相應角色，不擴其開發範圍。
3. **資料可攜：**交接／本人備份復用同一版本化包、附件及下載／分享服務。匯入前做可信完整性、格式／相容及目標權限檢查；通過可直接使用，AI／人工內容檢查可選。跨人是獨立副本，組內仍是共享權威。可追溯的批次／映射／紀錄與衝突處理沿原交易／收據模式，不借 importer 執行原提醒或移走憑證。
4. **身份：**沿 Firebase provider linking 及原 Web／原生 session；Google／Apple 以對應方式重新驗證。Apple 邀請接續驗原收件地址並綁 UID，不猜合併；郵件來源／relay 配置與准入交易按 AUTH01 完成。
5. **營運與 P5：**P4 保留完整知識管理／批量、分享／分析、集中跨端可靠性及災備。P5 才交自選 Server、Windows 自部署、跨 Server 搬遷／任務交接與通用回退。兩階段 S16／S17 分項驗收／交付，不以整個 P3 作所有 P4 前置；取消配對不取消裝置撤銷。

[API 目標](API.md#p4-p5-contract)／[資料責任](DATA_MODEL.md#p4-p5-data)承接接口與持久化；[SPEC](../SPEC.md#p4-p5-product)為產品／AC 唯一正文。UI 保持薄層、前後端同包接通，必要驗證復用有效證據，不為階段重編號重跑全部功能。
