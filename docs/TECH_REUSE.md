# P1–P4 技術復用核查

核對日期：2026-09-25 至 2026-09-26；基線：`80cf50c08ee044e734d2463fe9a22ae30eeb786d`（當時本地及遠端 master）。本文件保存選型證據、代價及待驗證項；現行技術邊界由 [ARCHITECTURE](ARCHITECTURE.md#reuse-boundaries) 維護，工作包由 [PLAN](../PLAN.md#roadmap-packages) 維護，執行規則由 [AGENTS](../AGENTS.md#technical-skills) 維護。進入工作包時只補查版本變動或證據缺口，不重做整份調查。

2026-10-08 研究見 [Firestore 盤點](#firestore-dependency-audit)；2026-10-12 採用方向依 [ADR-024](DECISIONS.md#adr-024) 收窄：保留原 VM／Compose／Caddy，復用已做 Firebase Auth／Storage／Tasks，僅替換正式 SQL 接點。原實作及有效驗收仍保留，不因調整部署路線全量重跑。

<a id="baseline"></a>
## 已有成果與證據層級

**實測**只表示既有證據列出的版本及場景通過；**文件相容**表示官方文件、固定版本原碼／manifest 或 registry 已核對，不表示本工程安裝、typecheck、建置或真機通過；**待選型**表示到所屬工作包才有足夠需求定案。本輪沒有安裝依賴或執行產品驗收，不承諾未量測的 token 節省比例。

- [package.json](../package.json)／[lockfile](../package-lock.json)：Node 24 系列、npm 11.8.0、Expo 57.0.24、Expo Router 57.0.22、React 19.2.3、React Native 0.86.3、React Native Web 0.21.2、TypeScript 6.0.3、Better Auth 1.7.5、Zod 4.5.4、pg 8.23.0；沿用已驗收 ADK 2.1.0／GenAI 2.24.0、PostgreSQL 18.6／pgvector 0.8.6，不作無理由升級或替換。
- [家庭授權](../server/family-access.ts)、[在線收據](../server/online.ts)／[客戶端 transport](../src/client/online-transport.ts)、[記憶規則](../server/memory-policy.ts)、[知識儲存](../server/knowledge-store.ts)／[檢索](../server/knowledge-retriever.ts) 已存在。S06／S07／S09／S10 的本機驗收見 [STATUS](../STATUS.md) 所連結 EV；框架不能接管這些業務權威。
- [ADK runtime](../server/agent-runtime.ts) 已通過 18 項輕量檢查、兩次真 Gemini 呼叫及一次工具循環，見 [EV-S11-W03](../artifacts/verification/S11_W03_CHECKS.json)。完整產品工具、worker、Plugins／OTel 新接線尚未實測。已完成 Prompt Pack 的靜態情境檢查不等於真模型品質評測。
- 六份技術 Skill 已核對：[ADK](../.agents/skills/adk-typescript-runtime/SKILL.md)、[Gemini](../.agents/skills/vertex-gemini-server/SKILL.md)、[PostgreSQL 授權](../.agents/skills/postgres-resource-access/SKILL.md)、[加密／備份](../.agents/skills/node-postgres-encryption/SKILL.md)、[向量知識](../.agents/skills/postgres-vector-knowledge/SKILL.md)、[GCP Compose](../.agents/skills/gcp-compose-delivery/SKILL.md)。復用各自的版本與驗證範圍；GCP 部署證據不當作 Windows 本地部署驗收，不為尚未採用的候選預建 Skill。
- 現有前端使用 RN 元件及手動表單狀態，例如 [CarePanel](../src/client/CarePanel.tsx)；已有 [在線刷新](../src/client/use-online-updates.ts)、`node:test` 及 [Web 驗證腳本](../scripts/verify-web.mjs)。已完成流程足夠支援既定範圍；新複雜表單／多端快取／瀏覽器測試才引入相應工具，不批量返工 P1。

<a id="decisions"></a>
## 按優先次序的決策表

P／A／架分別表示需要調整 PLAN／AGENTS／架構；本次已落實文件調整，候選的實作仍留在所屬工作包。共通「先復用、再自建」及聊天分工只在 AGENTS 維護一次。

| 優先／工作包 | 候選 | 推薦與理由／成熟程度 | 節省的自寫工作 | 風險、代價及證據 | 文件調整 |
|---|---|---|---|---|---|
| 1 · S13-W04；S10-W02 復用 | pg-boss 12.34.0、Graphile Worker 0.17.3、現有業務台帳＋自寫執行器 | 優先驗證 pg-boss；PostgreSQL 原生佇列符合本地部署，心跳方向適合數分鐘故障恢復。現有台帳繼續使用 | 通用領取、持久排程、存活檢查、重試及停止程序 | MIT；新增 schema／連線／備份成本；pg-boss 已通過 S13-W04 必要本機驗收，Graphile 僅文件相容且 hard-kill 恢復預設不合所選時限，詳見下節 | P／架；A 共通規則 |
| 1 · S11-W02；S16-W02 | 已接 ADK 的 Session、Plugins、Skills、conformance；自建對應能力 | 保留 Runner／Prompt Pack／單次 InMemorySession；優先 BasePlugin＋原生 spans 作最小診斷，按下表取捨原生能力 | 不重建 agent loop、session 協定、callback／trace 管線或技能載入器 | Apache-2.0；現有 Runner 實測，其餘接線待驗；持久 Session 另有 ORM／加密缺口；實驗性功能不成核心依賴 | P／架 |
| 1 · S13-W01；S12-W03；P4 S10-W03 | 手動表單、React Hook Form 7.88.0＋resolvers 5.9.1＋現有 Zod | 新複雜表單優先 RHF；成熟的欄位／錯誤狀態管理，保留既有驗證契約 | dirty／touched／欄位陣列、錯誤映射及表單重設 | MIT；React 19／Zod 4 在 peer 範圍，TS 6／RN 控制元件仍待本工程驗證；不把 Server 校驗移到表單 | P／架 |
| 2 · 上述新增共用頁面；P3 S04-W01／S12-W01 | 現有 RN 元件、React Native Paper 5.15.3、Expo UI 57.0.19／57.0.20 | 新增複雜共用頁面先小範圍試 Paper；Expo UI 用於確有原生控制需要的局部。不要同包引入兩套完整設計系統 | 主題、表單控制、dialog／menu／無障礙基礎；原生控制 adapter | 均 MIT；Paper 穩定 v5，但無 RN 0.86 實測證據；Expo UI Universal 有 Web fallback，仍需 Web／Android／RHF 接線驗證 | P／架 |
| 2 · S16-W05；S16-W02／W03／W04 復用 | 現有 node:test／Web 腳本、Playwright Test 1.63.0 | 提前獨立建立 P2 Web 測試基礎；成熟 browser runner，保留既有測試 | fixtures、隔離、定位／等待、trace、報告及多瀏覽器執行 | Apache-2.0、Node ≥20；browser binaries／資料清理／執行時間；只文件相容，不能代替 Android 原生 E2E | P 新包／架 |
| 2 · S13-W05／W06／W07 | web-push 3.6.7；grammY 1.46.0／Telegraf 4.16.3；手寫協定 | Web Push 用 web-push；Telegram 優先 grammY，當期 Bot API 支援及維護較合適 | VAPID／推送加密、Bot API 型別、請求及 webhook 解析 | web-push MPL-2.0、grammY MIT；不可讓 SDK 重試繞過投遞台帳；均待實際外發驗收 | P／架 |
| INT-W01；S07-W01／S09-W03／S07-W02 延續 | 現有刷新、TanStack Query 5.103.2 | 正式前端整合提前採讀取快取及失效管理；保留 opId 寫入 transport | 查詢去重、讀取快取、loading／error、重連及頁面失效 | MIT、React 18／19；2026-10-06 安裝／peer 已核對，正式身份清理待 INT 驗收，RN focus／online adapter 留 P3；禁用持久離線 mutation／outbox | P／架 |
| 3 · S13-W02 | Expo Notifications 57.0.21；Firebase Admin 14.5.0；Google Auth Library 10.9.1＋FCM HTTP v1 | 客戶端優先 Expo；Server 優先官方 Auth＋單次 HTTP v1 薄 adapter，避免 Admin 隱藏重試 | 原生 token／通知事件、OAuth 憑據與標準訊息協定 | MIT／Apache-2.0；Admin 內部預設重試不合 unknown 規則；Android 真 build／權限／token／送達待驗 | P／架 |
| 3 · S05-W03／S12-W01／W02；S17-W05 | Expo 官方 SecureStore／Camera／ImagePicker／Audio／Sharing；現有 Compose／Node／Postgres | 同 SDK 能力優先，核心自部署；僅缺口才加庫 | 原生權限／裝置橋接、憑據保存；延用部署與備份機制 | 各模組在進包時固定版本／許可；分享輸入不能只靠分享輸出 API；Windows 及 Android 未驗 | P／架 |
| 4 · S08-W01／S10-W03／S14-W02／S15-W01／W02 | QR／HTML 解析／PDF 等成熟庫；現有授權、RAG、加密／備份 | 到具體輸入／排版／遷移需求才各核查 1–2 個候選；不新建通用平台 | 通用編碼／解析／排版；復用已驗收的版本發布、備份及還原 | 待選型；字體／授權／不可信輸入／完整還原按包驗證，現在不鎖定無需求支撐的依賴 | P 指向規則；無新架構 |

S13-W01 的業務任務台帳、S13-W07／W08 的授權／關注規則、S14-W01 的統計與來源關係，以及 S13-W03／S15 的單主切換仍由項目控制；通用庫沒有理由取代這些領域規則。已完成工作包只復用成果，不因本表選型返工。

<a id="worker"></a>
## S13-W04：框架與業務台帳的分界

2026-09-28 接入補充：已固定安裝 pg-boss 12.34.0／schema 42，原 MIT 許可及 tarball integrity 已入 [清單](../licenses/manifest.json)；Node 24／pg 8.23 的型別接線通過，真 PostgreSQL 採用閘已獲批准並通過分段驗收，hard-kill 恢復 68.895 秒，詳見 [證據](../artifacts/verification/S13_W04_CHECKS.json)。主模型已核對安裝套件的 createJob、constructor／stop、schema check、heartbeat／重試及 keep_until SQL；固定來源與可復用約束見 [worker Skill](../.agents/skills/postgres-durable-worker/SKILL.md)。使用既有交易 client 的 send、框架原生領取／heartbeat／dead letter，業務僅保存授權及唯一效果。原生 transactional work 適合短 SQL handler，但本包已有 workspace／opId 交易與可重領台帳，不另建第二套互不協調的交易。產品操作見 [P2_WORKER](P2_WORKER.md)。

| 方案 | 官方證據與相容性 | 判斷 |
|---|---|---|
| pg-boss 12.34.0 | [固定 release](https://github.com/timgit/pg-boss/releases/tag/12.34.0)／[manifest](https://github.com/timgit/pg-boss/blob/12.34.0/package.json)：MIT、Node ≥22.12、PostgreSQL ≥13、pg 8.23 系列，與本工程 Node 24／PG 18／ESM 文件相容；[jobs](https://pgboss.io/api/jobs) 支援經 `db.executeSql` 使用既有交易 client，[queues](https://pgboss.io/api/queues) 有 heartbeat | 首選相容性驗證。心跳 60 秒＋監測 60 秒是約 1–2 分鐘偵測的驗證起點，不是已量測的恢復 SLA；須連同 timeout、retry delay 及重領條件核對 |
| Graphile Worker 0.17.3 | MIT，成熟 PostgreSQL／Node worker；[固定版本 error handling](https://github.com/graphile/worker/blob/v0.17.3/website/docs/error-handling.md) 記載 hard-kill 遺留工作鎖至少 4 小時，再由約 8–10 分鐘清理週期處理 | 可作一般背景工作候選，但不符合本次選定的數分鐘故障恢復；不為遷就它再自建強制 unlock 機制 |
| 現有台帳＋自寫 worker | 已有授權、操作收據、加密及終態模式可復用；持續 worker 尚未交付 | 台帳保留，自建通用 engine 要另承擔領取競爭、租約、排程、重試、shutdown／恢復測試，未見足夠收益 |

**交給框架：**工作持久化、到期領取、併發調度、heartbeat／失效工作回收、有限重試機制及 graceful shutdown。S10-W02 共用此 worker；hash／版本／發布仍用現有知識服務，不建立第二個 scheduler。

**留在業務台帳：**家庭授權及世代、任務／occurrence／delivery 分離、穩定 occurrenceId、終態、安靜時段／提示合併／跟進上限、預授權對象內容渠道、跨渠道去重／fallback、unknown、全邏輯工作的重試預算、取消／撤權及遷移後舊執行者失效。框架 job 成功不等於照護任務完成；job 唯一鍵不保證外部副作用 exactly-once。

採用前驗證：業務台帳寫入與 `boss.send(..., { db })` 共用同一 PostgreSQL transaction，回滾不遺留可執行 job；job 只存 ID／參照，不把家庭正文或憑據複製到框架 schema。領取後再核當前授權、版本、terminal／delivery 及執行者世代，外部網絡呼叫不佔用業務 SQL transaction。兩 worker 競爭、hard-kill／恢復、取消／撤權、發送成功但回應遺失、有限重試及備份還原須有證據；unknown 不因框架重領而重發。新增 schema 納入備份、清理及 migration 管理，還原不得復活終態／撤權／未知投遞。

<a id="adk"></a>
## ADK 2.1.0：先查 TypeScript 原生能力

所有能力以 [adk-v2.1.0 原碼及依賴](https://github.com/google/adk-js/blob/adk-v2.1.0/core/package.json) 核對，不把 Python／Java 或最新網站的功能直接算進目前 TS 版本。

| 能力 | 已核實 | 本項目取捨與待驗證項 |
|---|---|---|
| Session | [DatabaseSessionService](https://github.com/google/adk-js/blob/adk-v2.1.0/core/src/sessions/database_session_service.ts) 確實存在；本地 PostgreSQL 經 MikroORM，`@mikro-orm/postgresql ^7.2` 是尚未安裝的 optional driver；[schema](https://github.com/google/adk-js/blob/adk-v2.1.0/core/src/sessions/db/schema.ts) 另存 app／user state、session、events | 不是「TS 沒有持久 Session」。現時只需單次上下文，沿用已實測 InMemorySession；若日後確需持久 session，先驗證 driver／migration／刪除／備份及業務正文加密，不能把原生 JSON 表當作已符合現有加密政策 |
| Plugins | [BasePlugin](https://github.com/google/adk-js/blob/adk-v2.1.0/core/src/plugins/base_plugin.ts) 提供 callbacks，plugin 在 agent callback 前執行，非 undefined 回傳可短路；亦有 Logging、Security 及 ReflectAndRetry 類能力 | S11-W02 優先以 observer 記錄 allowlist metadata。不得改工具結果／吞業務錯誤／自動補跑副作用；診斷 sink 故障不得中斷業務。框架 Security 不取代交易內核權；[LoggingPlugin](https://github.com/google/adk-js/blob/adk-v2.1.0/core/src/plugins/logging_plugin.ts) 會輸出內容及參數，不能預設啟用 |
| OpenTelemetry | ADK 已有 [原生 spans](https://github.com/google/adk-js/blob/adk-v2.1.0/core/src/telemetry/tracing.ts) 及 [experimental setup helper](https://github.com/google/adk-js/blob/adk-v2.1.0/core/src/telemetry/setup.ts)。lock 已間接包含 OTel API 1.9.0、SDK 2.11.0、OTLP HTTP 0.222.0（Apache-2.0） | 先 Server traces；直接 import 時才列直接依賴並保持版本對齊。用受控的標準 SDK 單一 provider／可選本地 OTLP，不要求 GCP exporter。保留 content capture=false／null logger，仍需 export allowlist／洩漏檢查；不能把一個開關當作所有 SDK telemetry 都關閉 |
| Skills | Node 匯出的 [SkillToolset](https://github.com/google/adk-js/blob/adk-v2.1.0/core/src/tools/skill/skill_toolset.ts) 為 experimental，可 list／load／讀資源，含需額外啟用的 inline scripts 能力 | 已調查但暫不引入；它會加入自身指引，不能無縫替代既有 Prompt Pack 配方／安全核心／工具閘。到真正需要動態 skill 時才做受限接入，不開放模型任意執行腳本，不建立新 registry |
| 評測／測試 | 通用 [ADK evaluate 文件](https://adk.dev/evaluate/) 標 Python；TS 2.1 的 [devtools CLI](https://github.com/google/adk-js/blob/adk-v2.1.0/dev/src/cli/cli.ts) 有 `adk integration conformance`，配合 [test runner](https://github.com/google/adk-js/blob/adk-v2.1.0/dev/src/integration/test_runner.ts) 的 YAML spec／recordings／session 及 DummyLlm／ReplayPlugin | 不能宣稱 TS 完全沒有測試能力，也不能把 conformance 當本項目產品品質評測。優先既有 node:test＋scripted Runner；S16-W02 才以有限合成情境測真 Gemini／工具／安全／成本，不另建 Python 評測服務或完整 evaluator |

[OpenTelemetry JS 官方狀態](https://opentelemetry.io/docs/languages/js/)：traces／metrics 穩定、logs 仍在開發、瀏覽器 instrumentation 實驗性。本輪選擇 Server 最小診斷；Android／Web 不載入 Node telemetry SDK。

<a id="frontend"></a>
## Web、Expo 57 與 Android

2026-09-28 S13-W01 採用補充：根專案已固定安裝 React Hook Form 7.88.0／resolvers 5.9.1／Paper 5.15.3，核對實際套件 manifest、MIT 原文並保存 tarball integrity／許可 hash（[清單](../licenses/manifest.json)）。只用於新 TaskPanel，不批量改 P1 UI；任務屬性及 Server 驗證復用同一 Zod schema，原 opId transport 繼續掌管寫入。resolver 的有效輸入／原因／時區錯誤及 scoped client 輕量檢查通過；正式瀏覽器鍵盤、畫面互動及 Android 尚未驗收，不能把 typecheck／合成 preview 當真產品 UI 驗收。後續結果以 [S13-W01 證據](../artifacts/verification/S13_W01_CHECKS.json) 為準，以下保留首次文件核查的條件及限制。

前端執行次序已按其專責 task 對齊：先在 `frontend/` 逐頁做獨立 Web 預覽，主聊天接正式 API；整套 Web 獲使用者明確確認且符合 P3 前置後才開始 Android。以下跨平台核查是選型輸入，不是現在開始 Android 或修改正式 App 的授權。Preview 驗證不能升格為正式整合證據，詳細交付界線見 [交接文件](P2_UI_HANDOFF.md#chat-handoff)。

- **RHF＋Zod：**[RHF 7.88.0 manifest](https://github.com/react-hook-form/react-hook-form/blob/v7.88.0/package.json) 支援 React 19、Node ≥18；[resolvers 5.9.1 官方 registry](https://registry.npmjs.org/@hookform/resolvers/5.9.1) 支援 RHF ^7.55、Zod ^3.25／^4，MIT。該 tag 的 repo manifest 曾顯示較舊版本號，registry 5.9.1 的 gitHead 為 `f18ddfbb5f75a24b77c408565ad767eba4dd6704`；尚未核驗安裝 tarball。採用 gate 包括實際 artifact／TS 6 typecheck、Zod 4 input／output、RN Controller 的 `onChangeText`、reset／陣列／非同步錯誤及重連表單保留。不批量改寫舊手動 validator，不讓 RHF 重設原 opId 或自行重送 unknown 寫入。
- **Paper：**[5.15.3 固定 manifest](https://github.com/callstack/react-native-paper/blob/v5.15.3/package.json) 為穩定 v5／MIT，peer 範圍寬，但其開發基線 RN 0.82.1／React 19.1.1 不能證明本工程 RN 0.86.3 已通過。它提供完整 Material 元件／主題，適合新複雜頁面；需驗 Provider、字體／圖示、Expo Metro Web、鍵盤 focus、dialog／menu 與 Android 無障礙。[Web 指引](https://oss.callstack.com/react-native-paper/docs/guides/react-native-web) 的舊 Webpack 配置不能原封照抄到目前 Expo；不選 v6 alpha、不換 P1 整套主題。
- **Expo UI：**lock 已透過 Router 間接帶入 57.0.19，未直接採用；SDK 57 的候選補丁為 57.0.20。[Universal 文件](https://docs.expo.dev/versions/v57.0.0/sdk/ui/) 及 [57.0.19 對應原碼](https://github.com/expo/expo/blob/7687b07947a5c866adeb11abbceae72403ccb188/packages/expo-ui/src/universal/index.ts) 確認 root Universal 支援 Web fallback；不是只有 iOS／Android。`/jetpack-compose`、`/swift-ui` 專屬入口不能當作共用 Web 元件。[Host](https://docs.expo.dev/versions/v57.0.0/sdk/ui/universal/host/) 的版面行為及 [TextInput](https://docs.expo.dev/versions/v57.0.0/sdk/ui/universal/textinput/) 的 native observable state 與 RHF 同步／reset／游標／中文輸入法需另驗；官方 primitive kit 不等於 Paper 的完整表單主題。Android 原生控制有需要時再局部選用。
- **TanStack Query：**[5.103.2 manifest](https://github.com/TanStack/query/blob/release-2026-09-21-0933/packages/react-query/package.json) 為 MIT、React ^18／^19；[RN 指引](https://tanstack.com/query/latest/docs/framework/react/react-native) 要接 AppState focus／onlineManager。[mutation 行為](https://tanstack.com/query/latest/docs/framework/react/guides/mutations) 涉及 offline pause／resume，不能不加判斷便接管寫入。首批只做讀快取，key 包含 Server／身份／workspace／child 及所需世代；登出／撤權／Server 切換取消在途請求並清理，驗 late response 不回填舊權限資料。改用 Query 的頁面只保留一套刷新機制，現有 opId／收據／unknown transport 延用。
- **Playwright Test：**[1.63.0 release](https://github.com/microsoft/playwright/releases/tag/v1.63.0)／[manifest](https://github.com/microsoft/playwright/blob/v1.63.0/packages/playwright-test/package.json) 為 Apache-2.0、Node ≥20；S16-W05 已通過單一 Chromium 真 API 情景；Firefox 依使用者確認延後，未驗且不阻塞 P2。S16-W05 用隔離合成資料、單 test worker、預設 Chromium（Firefox 僅另批後選入），覆蓋家庭隔離／角色、寫入回應遺失後查原 opId、撤權後清 UI 三條真瀏覽器流程。保留既有 P1 腳本／node:test；[Android API](https://playwright.dev/docs/api/class-android) 的 experimental Chrome／WebView 支援不能代替 RN APK 真機驗收。

<a id="channels"></a>
## 通知與官方平台能力

- **Web Push：**[web-push 3.6.7](https://github.com/web-push-libs/web-push/tree/v3.6.7) 支援 Node ≥16，MPL-2.0，CJS／@types/web-push 3.6.4 與 Node 24 型別接線通過；只用 generateRequestDetails 加密，補原生 HTTPS 單次請求、期限、取消、端點／DNS 校驗，不另寫加密協定。真 Push／SQL／瀏覽器待驗，見 [Skill](../.agents/skills/web-push-delivery/SKILL.md)／[操作](P2_WEB_PUSH.md)。用它處理標準加密及 VAPID；分發時保留許可／通知，修改 MPL 覆蓋檔案須核對義務。家庭綁定、訂閱撤銷、敏感 payload、投遞狀態及 unknown 仍由項目處理。
- **Telegram：**[grammY 1.46.0 release](https://github.com/grammyjs/grammY/releases/tag/v1.46.0)／[官方 Bot API](https://core.telegram.org/bots/api) 的當期 10.3 支援，是優先於 Telegraf 4.16.3 的理由；不據此宣稱後者已停止維護。預設不裝 [auto-retry plugin](https://grammy.dev/plugins/auto-retry)；webhook secret／update_id 去重、使用者先啟動 bot、綁定及反向回覆授權由本項目處理，429 及不確定結果由 worker／台帳控制。
- **Android／FCM：**[Expo Notifications SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/) 候選 57.0.21（MIT）處理原生 FCM token／通知接收與互動；須真 native build，不把 Expo Go 當 remote push 驗收。Server 可直接使用 FCM，毋須依賴 Expo Push Service 作核心排程或台帳。 2026-10-18 沿既有 57.0.21 固定版本開始實作；官方 SDK 57 已核 channel 在 permission／token 前建立、原生 token 輪換 callback 不可再取 token（避免循環）、同步通知回應讀取／清理。單次 FCM 合成流程及兩個原生 adapter 型別已驗；未以此代替 APK／真送達，未使用 Expo Push Service。
- **Admin SDK 的代價：**Firebase Admin 14.5.0 為 Apache-2.0、Node ≥22，但 [api-request](https://github.com/firebase/firebase-admin-node/blob/v14.5.0/src/utils/api-request.ts) 預設 maxRetries=4，包含 503／ECONNRESET／ETIMEDOUT；[messaging request](https://github.com/firebase/firebase-admin-node/blob/v14.5.0/src/messaging/messaging-api-request-internal.ts) 使用此 client，[公開 AppOptions](https://github.com/firebase/firebase-admin-node/blob/v14.5.0/src/app/core.ts) 未提供對應關閉選項。先選已間接使用的 Google Auth Library 10.9.1（直接使用時列直接依賴）取得 token，再以單次 `fetch` 調 [FCM HTTP v1](https://firebase.google.com/docs/cloud-messaging/send/v1-api)；不 monkey-patch 私有 SDK。token 取得／刷新與訊息 POST 分開；實際 wire attempts、逾時／unknown／429／失效 token 在 S13-W02 驗證。
- **其他平台功能：**S05-W03 優先核對 Expo SecureStore；S12-W01 優先 Camera／ImagePicker／Audio；S12-W02 先核對 Sharing 的輸入及輸出支援。只讀當期 SDK 57 對應功能，分享輸入的 experimental 能力及 Android 權限不由 Web 文件相容性代替；各模組版本、許可及真機驗收隨該包固定。

<a id="local-deployment"></a>
## 本地部署與採用閘

原自部署研究邊界（ADR-019 後不作本輪前置）：Node／PostgreSQL／pgvector／worker、業務台帳、附件、權限及確定性規則可由自有 Compose 承載。新集中服務採用 Tasks 等代管組件，不能沿用「無 GCP 核心依賴」宣稱。沿用 GCP 初期部署成果；S17-W05 驗證不附加 GCP 身份且關閉 AI 時仍能登入、管理資料／任務及執行確定性規則。Gemini 仍是外部模型服務，私有部署不代表離線推理；Google 官方支援 [GCP 以外 ADC](https://docs.cloud.google.com/docs/authentication/set-up-adc-on-premises)，具體憑據配置及模型授權須在交付驗證。FCM／Telegram／Web Push 亦是可失敗的外部渠道，不是資料權威。

每個候選先做該包最小接入及必要輕量 typecheck／unit／build；有真服務、資料庫 integration、E2E 或真機成本時，按 [PLAN 驗證制度](../PLAN.md#verification) 先列明原因、範圍、次數／成本。通過才把「文件相容」更新為指定場景實測；失敗保留版本及原因，僅回查缺口。若既有實作已足夠，記一句復用結論便繼續，不為每個小功能建大型框架比較表。

<a id="knowledge-refresh"></a>
## S10-W02：沿用知識核心與原生來源排程

2026-09-28：沿用 S10-W01 的 import／review／hash／incremental embedding／publish、S13-W04 的 pg-boss 12.34.0／schema 42 及還原暫停機制。新來源檢查用原生 schedule(name,cron,data,{key,tz,missed:'once'})；主模型已核對固定 [scheduling 文件](https://github.com/timgit/pg-boss/blob/12.34.0/docs/api/scheduling.md)及本機 timekeeper／型別，不另建計時領取器。文件相容、合成單元與必要真 DB 接線證據分開；目前新增 SQL／cron 真接線待驗。

根依賴沒有可直接採用的 HTML／RSS parser，Node 24 也沒有 DOMParser。選 Cheerio 1.2.0（MIT；固定版本 Node >=20.18.1，已安裝並鎖定）同時處理 HTML selector 與 XML；不以 main branch 的較新 Node 要求代替 [v1.2.0](https://github.com/cheeriojs/cheerio/blob/v1.2.0/package.json)。其一般 load 不執行 JS／讀取外部資源，XML 模式用 htmlparser2；來源抓取另外套用固定 host、DNS、redirect、大小及期限邊界。比較的 fast-xml-parser 5.11.1（MIT）適合 XML object，但不提供目前需要的 CSS selector；本包不為 RSS 再引第二 parser。DTD 的特定展開行為未由文件確認，產品直接拒絕 RSS DTD／ENTITY。Cheerio 新增 22 個 lockfile entries；安裝出現其傳遞 whatwg-encoding 的棄用提示，沒有因此全量升級或另加 override。

來源格式已以 curl 唯讀取得原 HTML／XML，並離線解析：四 FHS 頁正文為 #content，內容月份標籤為 #content-rev-date；CHP／RTHK 項目使用 title/link/description/pubDate，CHP 有相對 URL 及空摘要，不把其舊項目冒充當日新聞。Cheerio 合成 parser 檢查通過，仍不代替真網絡 adapter／DB 驗收。來源使用條款由 [ADR-013](DECISIONS.md#adr-013)及 [操作文件](P2_KNOWLEDGE.md#source-refresh)維護；不把 parser 可讀當成內容再發布權利。

自建部分限於固定來源定義、日期／使用範圍、觀察批准及既有版本的連結；這些是項目領域規則。向量 hash、全局模型限額、家庭資料、Prompt Pack 及正式前端架構保持原有權威，不另建全站爬蟲、新聞分析或來源管理平台。

<a id="telegram-adoption"></a>
## S13-W06：grammY 有界渠道接入

2026-09-28 沿用候選 grammY 1.46.0，直接依賴固定；新增 @grammyjs/types 5.0.0，兩份 MIT 原文及 lockfile integrity 已保存。沿用既有 node:https、Zod、AES-GCM、S07 收據及 pg-boss，沒有另選 bot framework 或引入 auto-retry。

主模型核對固定 client.ts 的一次 fetch／timeout／webhook reply 路徑及 Telegram 的 private chat、start payload、callback／update_id 契約。SDK 沒有家庭綁定、業務持久去重或 sendMessage 通用冪等 key，因此這些保留在產品服務。HTTP 回覆、Telegram API 接受與任務完成分開；403 不能一律當作封鎖。短實作參考見 [Skill](../.agents/skills/telegram-bot-api/SKILL.md)。文件相容、離線 scripted transport 及真 bot／DB 驗收分列，不將套件成功安裝寫成渠道通過。

<a id="personal-model-key-reuse"></a>
## S06-W05：沿用 SDK 的 key 接入

2026-09-30 核對 `@google/genai 2.24.0` 已同時支援 Vertex／Developer API，沿用現有 ADK adapter、AES-GCM 及 PostgreSQL，無新增依賴。Developer API 用固定官方 baseUrl／v1beta／apiKey、關閉自動重試；不可沿用 Vertex 專用 autoTruncate 參數。query 限 2000 UTF-8 bytes，gemini-embedding-001 的 1024 維結果做 L2 normalization；metadata 缺失保持未知。

官方依據：[key 與保密](https://ai.google.dev/gemini-api/docs/api-key)、[embedding](https://ai.google.dev/gemini-api/docs/embeddings)、[地區](https://ai.google.dev/gemini-api/docs/available-regions)、[Google key 類型](https://docs.cloud.google.com/docs/authentication/api-keys)、[Vertex key](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/start/api-keys)。文件／固定 SDK 原文已核對；真 Developer API metadata 於本機回覆地區不支援，不能把框架相容當真服務通過。依使用者確認，後續可用供應商接入另行處理，本包保留限制。


### INT-W06 PDF（2026-10-06）

沿已確認方案採 `@react-pdf/renderer 4.9.0`（MIT），復用 Node `renderToBuffer`／自動分頁／字體內嵌，不自建 PDF 排版器。[官方 Node API](https://react-pdf.org/docs/v4/node)、[字體限制](https://react-pdf.org/docs/v4/fonts)、[相容性](https://react-pdf.org/docs/v4/compatibility)及官方 package／license 已核對。React 19 在支援範圍；官方相容頁沒有列 Node 24，不將文件相容當實測。實際 Node 24.19 的一份繁中合成 PDF 已輸出、抽取文字及渲染核對，零模型。

字體採原版 LXGW WenKai TC v1.522 靜態 TTF（OFL 1.1），原授權及 hash 見 [字體記錄](../server/assets/fonts/README.md)。不用官方明示不適用的可變字體，不向外部 URL 傳送家庭正文；server/assets 隨既有 Server image 複製。這是 PDF 字體，不替换使用者確認的前端設計。


### P2-A03 文件局部修改（2026-10-08）

沿用現有 typed actions、Zod、PostgreSQL 交易及原 opId 收據，不新增編輯框架或 PDF 引擎。主模型核對 [RFC 6902 §3–5](https://www.rfc-editor.org/rfc/rfc6902) 的依序操作、明確目標與失敗中止；通用 JSON Pointer／陣列索引不處理本項目的穩定章節、來源權限及編輯保護，因此採受限業務 edits，並非實作通用 RFC 6902 endpoint。改寫同一份快照、固定版本分段讀取及 SQL keyset 分頁均沿既有依賴；不下載或複製第三方 patch 原始碼，沒有新增 license 義務。文件已核對，實測結果依 A03 驗收證據記錄。


### P2-A04 官方資料解析與檢索（2026-10-08）

沿用 PostgreSQL 18.6／pgvector 0.8.6 的精確搜尋、Cheerio 1.2.0 及既有來源 worker。排名在過濾後的 SQL 有界取回，引用按 ID 重驗；沒有新增 RAG framework、第二資料庫或相似度即可信度的判定。含義核對及來源授權仍是產品責任。

文字型 PDF 採固定 `pdfjs-dist 6.4.299`（Apache-2.0，官方宣告 Node >=22.13.0 或 >=24），已有 react-pdf 是報告輸出工具，不提供正文抽取，故不重用為解析器。主模型核對 [官方 Node 範例](https://github.com/mozilla/pdf.js/blob/v6.4.299/examples/node/getinfo.mjs)、[固定 API](https://github.com/mozilla/pdf.js/blob/v6.4.299/src/display/api.js) 及套件 metadata；本機 Node24.11 的標準 build 缺 toHex，沿官方 legacy build 解決，不自建polyfill。頁批次、hash、取消、local CMap／font resources及抽取品質分開驗。PDF頁有文字不等於完整正文，只有頁碼亦不能合格；不新增OCR或外部文件服務。


### P2-A05 成長整理（2026-10-08）

沿用 pg-boss、PostgreSQL 交易、現有領域來源解碼及 FamilyDocument；每批有界掃描、加密進度與完整統計是本項目資料／權限語義，沒有引入通用報表或新 workflow 框架。PDF 沿用上方 INT-W06 的 @react-pdf/renderer 4.9.0／靜態繁中文字體，不重做研究或改版。既有文件相容性證據復用；本包必要實測與未驗範圍另記 verification。


### P2-A08 帳戶與郵件（2026-10-08）

沿用 Better Auth 1.7.5 的驗證、密碼找回及會話撤銷，沒有重造身份或 token 系統。主模型核對原生 transaction／hook 及 server-only verifyPassword；業務邀請、資料處理確認、可靠刪除及備份後抑制仍由產品服務處理。方法見 [Skill](../.agents/skills/better-auth-account-lifecycle/SKILL.md)。

根依賴缺郵件 transport，採固定 Nodemailer 10.0.16（MIT-0；Node >=20）及 @types/nodemailer 8.0.2（MIT），沿現有 pg-boss 交易 outbox；使用標準 SMTP／STARTTLS 與正常憑證驗證，不綁單一商用郵件平台或自寫 SMTP 生產 client。[官方 SMTP](https://nodemailer.com/smtp)及安裝版本已核對；本機 capture、真收件箱及正式部署的證據分開記錄。


<a id="firestore-dependency-audit"></a>
## Firestore 遷移：實際依賴及原生能力核查

核對日 2026-10-08，固定基線 0c22180（PR #130 已合併）；35 份 SQL migration、97 個建表定義及 27 個 store factory 是盤點口徑，不是 Firestore collection 數量，亦不含 #140 未合併修改。以下只記研究／差異，完成狀態在 PLAN，設計在 [架構](ARCHITECTURE.md#firestore-target)。

| 現有依賴／必要原文位置 | 實際耦合／目標需要承接 |
|---|---|
| [online.ts](../server/online.ts)、[transaction-pool.ts](../server/transaction-pool.ts)、[online-change.ts](../server/online-change.ts) | advisory／workspace row lock、原 op fingerprint、savepoint、收據與 changeSeq 同一 SQL transaction；改 read-first 交易、確定 ID claim／receipt 及 outbox，不以獨立多次 set 冒充原子 |
| [family-access.ts](../server/family-access.ts)、[auth.ts](../server/auth.ts) | SQL 授權鎖與 Better Auth 1.7.5／原生 Pool；保留資源／成員版本與逐裝置撤銷，Auth adapter 改 Firebase，限流／准入須跨 instance |
| [task-worker.ts](../server/task-worker.ts)、[worker-queue.ts](../server/worker-queue.ts) | pg-boss 12.34.0／schema 42、原交易入列、lease／generation、暫停及恢復；Tasks outbox 與補償喚醒不能丟原 unknown／終態 |
| [knowledge-store.ts](../server/knowledge-store.ts)、[knowledge-retriever.ts](../server/knowledge-retriever.ts) | pgvector 0.8.6、1024 維；先適用／scope 過濾、vector／keyword 有界候選再 RRF，標題4／章節3／keywords5／topics4／body1、RRF k=60；Firestore 須保留正文候選和引用版本 |
| [photo-files.ts](../server/photo-files.ts)、[account-data.ts](../server/account-data.ts) | 本地 AES 檔案、SQL 刪除清理、獨立 fsync 刪除 journal；Storage generation／完成發布、獨立 intent 及可恢復清理替代，不能只刪 metadata |
| [package.json](../package.json)／[lockfile](../package-lock.json) | pg 8.23.0、Better Auth 1.7.5、ADK 2.1.0／GenAI 2.24.0；保留 Node 24／現有框架，Firestore／Auth／Tasks／Storage SDK 尚未在本包安裝 |

### 原生方案、取捨及待驗

| 官方／固定來源 | 文件已核對的能力／本工程仍待驗 |
|---|---|
| [Firestore 交易](https://docs.cloud.google.com/firestore/native/docs/manage-data/transactions)／[限制](https://docs.cloud.google.com/firestore/quotas) | 交易重跑及容量、原生索引／cursor；現有跨 store 事務、防重、權限競爭及全部查詢組合須 F01 對照／F02 實證 |
| [Server IAM](https://docs.cloud.google.com/firestore/native/docs/security/iam) | Server SDK 不靠 Security Rules 執行業務權限；保留本項目家庭、private scope 與刪除／撤權閘，不委派模型或 provider |
| [Auth 匯入](https://firebase.google.com/docs/auth/admin/import-users)／[blocking](https://firebase.google.com/docs/auth/extend-with-blocking-functions)／[cookie](https://firebase.google.com/docs/auth/admin/manage-cookies) | STANDARD_SCRYPT 可配參數；Better Auth 現有 N=16384／r=16／p=1／64 bytes、16 隨機 bytes 的 hex 字串作 salt、密碼 NFKC 必須以合成資料核對。blocking 要 Identity Platform；per-device session／邀請消耗由產品補，不當原生已完整支援 |
| [Better Auth adapter v1.3.2](https://github.com/yultyyev/better-auth-firestore/releases/tag/v1.3.2) | 社群 MIT、宣告支援 Better Auth 1.7；存在可保留方案，不宣稱原生／官方支援。未安裝或驗本工程交易／Auth 正確性；使用者選 Firebase 以減少 adapter／郵件維護 |
| [Tasks HTTP](https://docs.cloud.google.com/tasks/docs/creating-http-target-tasks)／[限制](https://docs.cloud.google.com/tasks/docs/quotas) | OIDC、重試、30 天最遠 schedule；task-name 去重是有限窗，不能取代永久業務收據或處理未知外發 |
| [Hosting](https://firebase.google.com/docs/hosting/serverless-overview)／[cookie/cache](https://firebase.google.com/docs/hosting/manage-cache) | 60 秒轉送、__session cookie 限制；實際認證交換、非同步 run、私有 no-store 及取消接線待驗 |
| [向量](https://docs.cloud.google.com/firestore/native/docs/vector-search)／[全文限制](https://docs.cloud.google.com/firestore/native/docs/text-search) | 原生向量上限 2048 維，1024 可沿用；Standard 無全文。採有界公共 posting／n-gram 候選是本項目必需缺口，不引入常駐搜尋；召回／索引容量／讀取費待切片量測 |
| [Storage precondition](https://docs.cloud.google.com/storage/docs/request-preconditions)／[備份](https://docs.cloud.google.com/firestore/native/docs/backups) | generation 控制及原生 DB 備份可復用；交易外 object／metadata／journal 一致性、14 天配對物件與隔離還原須本項目驗證 |
| [Emulator](https://docs.cloud.google.com/firestore/native/docs/emulator) | 本機基本測試輔助；不把 emulator 結果當 production vector／交易競爭／IAM／縮零與計費證據 |

本次只查文件、既有版本及原碼，沒有新增依賴或複製第三方實作。F01 固定官方 Node SDK 的實際版本／license／lockfile 及 Node 相容性，按現有 license manifest 納入；代管服務條款／區域／計費另核，不能以 SDK 開源 license 當服務免費。新短 Skill 只在首次實作出現可復用方法時建立，不為本研究預建框架。價格屬易變資料，核對與假設見 [成本](ARCHITECTURE.md#firestore-cost)。


<a id="firestore-chat-store-audit"></a>
### F01 聊天首批 store／query／交易差額（2026-10-09）

固定來源為 [09224a15／PR #164](https://github.com/2NTTY/child-ai-caregiver/tree/09224a1539974125dcb7ec5487fc204680c55401)。本輪按 `server/migrations/*.sql` 檔案及 `CREATE TABLE` 定義計得 **36／98**，其中 036 新增原 run→document operation 關聯；不覆寫上文 0c22180 的 **35／97／27** 歷史基線，亦不以 factory 數當完整服務數。Auth 薄 port 已合併，但仍是 Better Auth；Firestore 9.3.1 已為根直接依賴。下列是既有盤點的聊天細化，不是 collection／索引已建立、Firebase 已接線或 F01 已完成；其餘 store 仍須沿本節補齊，背景接點另核。

**原收據及跨 run 語義。** [product-agent.ts:76–92](../server/product-agent.ts#L76-L92) 先消耗本人回覆對原候選的確認，才 claim 回覆訊息的新 run；原 proposal run、asking run、response message 及其新 run 不能合併成一個 ID。原 proposal run 已 completed／stopped 不自行禁止新的明確候選決定，仍要核候選期限、scope、目標版本及具體同意；新 asking run 才須仍 running。重播 accepted confirmation 只讀原結果，不能再執行 domain effect。取消原互動 run、取消持久 work、略過 proposal 是三項不同操作，不能相互推論或代替已保存效果。交易與失敗邊界詳見 [資料契約](DATA_MODEL.md#firestore-chat-transaction-boundary)。

以下 `U/C/R` 分別為 ownerUserId／childId／runId；欄位名為邏輯對照，非定案 collection path。`↑/↓` 是索引及 cursor 的同一排序方向；等值欄位在排序欄位前。必須先定 collection 或 collection-group scope，才產生對應實體索引；以保留原 UUID 的 document ID 作最後排序鍵時，使用 `__name__` 並保留完整 Timestamp 精度，不能轉毫秒 Date 後再續頁。所有授權資料在 Server 查詢前及結果返回前核對，索引只能選候選，不能授權。

| 既有 store／操作與來源 | 最小讀取、query／index 及上限 | 必须同交易的寫入／遷移缺口 |
|---|---|---|
| [chat](../server/chat.ts#L22-L92)：列表、本人訊息及唯一模型回覆 | 本人／孩子訊息 `U,C,createdAt↓,__name__↓`，anchor 先按同 scope 點讀；原頁最多 100＋1。確認所需上一則訊息沿相同排序 limit 1，最近本人訊息另用 `U,C,role,createdAt↓,__name__↓` limit 1。原 inReplyTo→reply 唯一性及原 trigger→run 必須可點讀，不逐行 join 全 run。 | 原訊息、回覆唯一 claim、changes 同交易。現行共享 PostgreSQL 的 advisory reply lock 可協調多個 instance；移除該共享 SQL 後不能原樣搬作 Cloud Run 跨 instance 鎖；run trigger claim 及 reply claim 各自保留，HTTP 預先查「未有回覆」不是寫入防重。保存 model message 與 bind 問句目前是兩次提交；保留按原 message 修復 bind 的冪等路徑，未 bind 不可消耗。 |
| [product-agent-store](https://github.com/2NTTY/child-ai-caregiver/blob/09224a1539974125dcb7ec5487fc204680c55401/server/product-agent-store.ts#L269-L414)：claim／authorize／cancel／get／pending | 原 `(U,C,triggerKind,triggerReference)` 確定 claim→R；run 點讀。run proposals `R,createdAt↑,__name__↑` 讀最多 8＋1，超額明確拒絕。待處理候選投影需 `U,C,state,createdAt↓,__name__↓`，pending／expired 原語義保留，20＋1。背景結果 `U,C,triggerKind,createdAt↓,__name__↓` limit 20。 | claim 與 run 原子；cancel／finish／新 tool effect 讀同 run 終態及 workspace 授權／epoch。不能把 ADK session 或 root budget 作此權威。proposal owner／child／run 授權及 epoch 若為查詢 metadata，必須與原 run／proposal 一起建立並核源，不能異步複製後直接信任。已過期候選仍可略過，不能自動刪掉待處理列表。 |
| [agent-work-store](../server/agent-work-store.ts#L36-L168)：work／operations／history | work 點讀或 `U,C,createdAt↓,__name__↓`，10＋1 且沿既有約 7,000 字元頁界。history message／private note 用 `U,C,createdAt↑,__name__↑`；fact 優先用原生 `C AND (visibility=family OR createdBy=U)`，分支索引為 `C,visibility,createdAt↑,__name__↑` 及 `C,createdBy,createdAt↑,__name__↑`。一次最多掃 100＋1、回 10 matches，保留 high watermark／queryHash／after cursor；私人正文只在授權頁解密搜尋。 | `(U,C,operationId)` 與 `(R,callId)` 兩組確定 claim 指同一 receipt，參數不符拒絕。讀 run、workspace、expected workVersion、至多 6 source messages／8 resources／8 pending references，再一次寫 work／operation receipt／followup 接點／changes／run dataVersion。原批量確認失效不可無界搬進交易；以讀取時 workVersion／status 即時拒絕，清理可分批，不能在失效完成前仍授權。固定 SDK 已有 `Filter.or`；先驗原生 OR 的穩定 cursor、去重及掃描數，不預建雙查詢合併器。 |
| [agent-confirmation-store](../server/agent-confirmation-store.ts#L25-L177)：request／bind／consume／recordedConfirmation | request 以 `(askingRunId,proposalId,proposalVersion)` 確定 claim；讀原 proposal、原 run、可選 work、policy 及來源。問句讀取／bind 沿 `U,C,askingRunId,state,createdAt↑,__name__↑`，以原每 run 8 tool calls 為界讀 8＋1 並檢查超額，再在頁內判期限；不能保留無界 SQL 查詢。asked query `U,C,askMessageId,state,__name__↑` limit 2；accepted receipt 以 `(U,C,responseMessageId)` 查並檢出多於 1。有效 pending 候選需 `U,C,state,authorizationVersion,storageEpoch,expiresAt↑,__name__↑`，`expiresAt>now` limit 2，原本按 ID 排序不影響「恰好一項」判斷。 | 原 SQL join／NOT EXISTS／全量 invalidation 不能逐 set 假裝原子。一次 transaction 完成明確同意檢查、proposal CAS、domain mutation／receipt、confirmation accepted／response 綁定及必要 changes／outbox；只有 transaction 成功才可回接受。metadata index 的有效性、所有候選並發建立及最新訊息／上一則判定須在同一原生交易驗證，不以 query 外預檢代替。 |
| [agent-actions-store](../server/agent-actions-store.ts#L232-L374)：ordinary action／policy／receipt | policy 按 `(U,C)` 點讀；calls 按 `(R,callId)` 點讀；receipts `U,C,R,createdAt↑,__name__↑` 有界查，沿目前每 run 8 件上限。等價 action 沿最多 8 件已加密 fingerprint 比對，不能把私人請求 hash／原文另放可枚舉明文索引。 | 新操作讀本人來源／quote、run running／期限、權限／epoch／changeSeq、policy version、目標 expectedVersion。domain mutation、task grant 關聯、原 receipt、call alias、changes／排程 outbox、run dataVersion 必須全有或全無。舊 receipt 命中只回歷史結果，不使舊 policy／task grant 重新生效。政策撤回須保留「只撤由該政策管理的原 grant version」；大量關聯撤回的即時拒絕閘與分批清理另定。 |
| [family-document-store](../server/family-document-store.ts#L137-L196)＋[036](../server/migrations/036-agent-document-operations.sql)：原 document receipt／run link | operation 按 `(U,opId)` caller-wide 點讀，不能縮成 child scope 放過跨孩子 opId 衝突；run link `U,C,R,opId↑` 最多 8＋1。document／snapshot 點讀原 ID／版本；列表 `C,createdAt↓,__name__↓` 及加 status 等值的版本，原上限 50＋1；snapshot history 按 documentId／version↓，仍保留原 history／固定版正文入口。 | document＋snapshot＋source revision／dirty 接點＋domain receipt＋唯一原 run link＋changes／run dataVersion 同交易。receipt 讀回再核 epoch、目前文件及原／現來源可讀，只回 operationId／documentId／savedVersion；不回舊正文、不刷新報告批次、不把原 savedVersion 當 currentVersion。內容 patch 的接受路徑仍走原 proposal receipt；直接 document operation link 與 confirmed_proposal 不能合併或互相補造。 |
| [agent-work-continuation](../server/agent-work-continuation.ts)：原 event 候選／背景 claim／起始輸入證據 | 沿原 event ID 點讀完整最多 5 項 workId／workVersion 及同 scope 工作；原 deterministic trigger 點讀 claim／run，不用目前 status 或時間戳推斷歷史。僅有界身份／版本／scope 查詢與清理索引，不建立正文／prompt 索引。 | 目標是原 event 單份加密快照與原 run claim 同庫同交易，分類全部候選，只用成功 commit attempt 產生 context；全排除且原子確認無 run 才可 runId:null。詳細[資料契約](DATA_MODEL.md#p2-a06-continuation)及[相容 API](API.md#p2-a06-continuation)均為待實作，現有 SQL 台帳不因此取得新證據。 |

**索引與讀量尚待落地。** 上表是最小 query shape 候選，沒有新增 `firestore.indexes.json` 或建立雲端索引。應在同一 adapter 切片交付 index manifest、密文／不查詢大欄位的 single-field exemption、scope/時間缺欄處理及 query 測試；Firestore 索引不會包含缺排序欄位的文件。原始 SQL timestamp、UUID 及 high watermark 必須無損搬入，不能以現在時間重建排序。投影不能把 private scope 擴成共享，accepted／unknown 原收據不能用 pending TTL 清除。原生 [索引](https://firebase.google.com/docs/firestore/query-data/index-overview)、[OR queries](https://firebase.google.com/docs/firestore/query-data/queries#or_queries)及 [cursor](https://firebase.google.com/docs/firestore/query-data/query-cursors)已核文件；實際 query 讀取與 index entry 成本仍未知，沒有以文件推算現場成本。

**清理 closure。** 016／025／028／030／036 的 FK／cascade 分別保護 run／proposal、source-message→private note／revision／action receipt／call、document snapshots／operations／run links、work operations／confirmations 及 ask／response 訊息關聯；033 的 followup／continuation 由背景接點承接。Firestore 必須保留 parent tombstone／epoch 即時拒絕，再用 U／C／sourceMessageId／workId／runId 等非正文 scope 索引有界清理，並令衍生 summary／source basis 失效；不是只刪 parent。清理索引、同源反向引用及 migration resume cursor 未交付。[TTL](https://firebase.google.com/docs/firestore/ttl)非即時、非同時交易，亦不刪 subcollections，不能作權限閘或唯一清理機制。清掉正文後仍須保留必要最小防復活標記；retention 與獨立 journal／restore 依原契約，不由 session TTL 決定。

**原收據窄接點與後續缺口。** 已抽出 [PG 無關唯讀 port](../server/agent-original-receipts.ts)及[現有 SQL adapter](../server/agent-original-receipts-postgres.ts)，只核原 action／accepted confirmation／contact／document 收據，保留 missing／unavailable／overflow／revoked／source-changed 與 countsKnown=false。reader 僅在 caller 已授權、已鎖 workspace／run 的 callback 內順序借用同一連線；現行保證是 READ COMMITTED＋既有權威鎖，不宣稱固定 snapshot 或 Firestore 原子性。外層 get／readCancelled 仍有既有 run／proposal 到期更新，不能整段當純讀。定向離線證據及未驗範圍見[固定記錄](../artifacts/verification/F01_ORIGINAL_RECEIPT_PORT_20261009.json)，不擴成 resume 或新業務寫入。真正 Firestore reader／command adapter 仍須定上述 read-set／write-set／query shapes 及失敗語義，不能把 `PoolClient` 換名成泛用 transaction 或分拆獨立 commit。後續合成 gate 保留同 ID／異參數、並發 claim、取消與 effect／finish 先後、跨 run 確認一次生效、多候選／新訊息／workVersion 拒絕快捷同意、提交後回應遺失、來源刪除／epoch 及 callback 重跑／業務拒絕零半寫；本次窄驗不代表這些 command gate 全數重驗。沿用[取消／中斷](../tests/product-agent-durable-cancellation.test.ts)、[文件 store](../tests/product-agent-document-store.test.ts)、[文件 runtime](../tests/product-agent-document-cancellation.test.ts)及[文件流程](../tests/family-document-workflows.test.ts)原證據；serialized fake Pool 不當真 SQL／Firestore 競爭證據。

**起始輸入證據的最小復用與前置。** 沿用原 event 最多 5 項候選、deterministic trigger、StorageCipher、原 Firestore transaction 及既有取消／授權／dataVersion 守衛；本缺口是同次 claim 的持久選入證據，不需新依賴、另一個 workflow／outcome 系統或 SQL migration。現有 Firestore adapters 只覆蓋 session、root budget 與 model／query embedding usage，沒有 work／continuation event／business run 的同庫權威，不能把獨立 adapter 串接當作已原子提交。後續先完成原 store 的同庫 read-set／write-set 及 reader，再依成功 attempt 消費；不先加空 port／雙寫或提前啟用 query／DTO。必要合成語義核對包含取消先後、回調重跑／失去回覆、全部排除、歷史缺證據及錯綁／讀錯 fail closed；保存／真交易競爭、清理／restore 閉包與正式消費仍另驗，合成 trace 不代替它們。


<a id="multi-agent-reuse"></a>
## 四角色編排及多模態知識維護核查

2026-10-08，基線 e6842fc；以下為固定版本原碼／官方文件與本機程式唯讀核對，不是四角色或多模態流程已實測。角色接口／P3 承接見 [ADR-024](DECISIONS.md#adr-024)／[架構](ARCHITECTURE.md#p2-agent-roles)，不新增 framework、依賴或預建 Skill。

- **可復用原生能力：**ADK 的 [Agent-as-Tool](https://adk.dev/tools-custom/function-tools/) 讓子任務回傳主 Agent，主 Agent 保留對話控制；適合聊天按需調資料編製，背景維護另由受信工作入口啟動。[2.1.0 AgentTool](https://github.com/google/adk-js/blob/adk-v2.1.0/core/src/tools/agent_tool.ts) 為 Apache-2.0，已有子 Runner／取消傳遞，但 runAsync 不帶專案 RunConfig／maxLlmCalls，schema 驗證亦有 TODO；不能推定共享 scope、預算及 observer 自動完整繼承。採原生 FunctionTool／Runner 薄接點明確注入現有 gateway／validator／根預算，不複製整個框架；首次實作才核最少相容情景。
- **現有 runtime 與審核缺口：**[agent-runtime](../server/agent-runtime.ts) 有有界 Runner／FunctionTool／取消／收尾；[product-agent-tools](../server/product-agent-tools.ts) 的 present_answer 驗引用 ID、分類與範圍，不是獨立模型判斷每項說法是否獲原文支持。[knowledge-version-review](../server/knowledge-version-review.ts) 已有變更含義、原文片段、growthRuleImpact 與發布 gate，可接審核角色；資料編製復用 [文件工具](../server/agent-document-tools.ts)及其他領域服務，不另存可寫副本。
- **多模態缺口：**[knowledge-pdf](../server/knowledge-pdf.ts)／worker 沿 pdfjs 文字分批抽取，完整度不代表圖表含義已核對；[agent-model-gateway](../server/agent-model-gateway.ts) 目前拒 fileData 且最多一張受控照片。官方 [Vertex 文件理解](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/document-understanding) 提醒長文件分拆、機讀文字優先，以及掃描／手寫／定位誤差；採來源維護專用有界視覺輸入，保留原頁供審核，不以模型抽取當逐字原文。沿現有 Vertex／GenAI 路線；實作時核固定模型與 SDK 的實際媒體相容，不因通用文件宣稱本產品已支援。
- **證據／成本限制：**原單 Runner scripted／真 Gemini、文字 PDF 及來源版本 gate 的證據只適用原情景。六次是 P3 四角色提案共同上限，不調高現有 P2 配置，亦非平均成本或成功保證；四角色、視覺來源與自動語義審核按 P3-M01～M03 的最低連貫流程量測。不得用靜態 prompt、引用格式合法或另一角色說通過作實證。

<a id="firestore-full-runtime-audit"></a>
### F01 全執行路徑對照（2026-10-11）

固定來源 [fd5d4f0／#190](https://github.com/2NTTY/child-ai-caregiver/tree/fd5d4f074c9a9d0926de8fbd3b6568975d2743f8)。仍為 36 份 SQL migration、98 個建表定義；Better Auth 自身 migration、app_migrations 及 pg-boss schema 另計，不能用 98 推算全部資料。逐檔 query 呼叫位置及搜尋口徑保存在 [F01 證據](../artifacts/verification/F01_FIREBASE_FOUNDATION_20261011.json)；動態 SQL、交易借用、外部 CLI 及 FK 清理按下表另核。上文 2026-10-08／09 的盤點原位保留；聊天細節沿既有表，不另建立第二份進度。

| 原入口／store／嵌入查詢 | Firebase 替代接點與不可遺漏的交易／清理 | 實作及驗收歸屬 |
|---|---|---|
| index、database、auth、migrate；Better Auth schema、app_migrations | main 依 STORAGE_BACKEND 選正式組裝；Firebase 不建 Pool／不讀 DATABASE_URL 或 BETTER_AUTH_SECRET。Admin Auth＋同庫 canonical authority；部署管理索引／schema 版本，禁止模擬 SQL migration。 | F01 接點；F02 真身份；F08 移除舊組裝與依賴 |
| account-admission、account-runtime、auth-mail、auth-mail-worker | 邀請／consent／穩定 uid-workspace 由 authority 交易核對；Identity Platform blocking 阻擋未邀請註冊，Auth 原生驗證／找回電郵，不能把舊 SMTP outbox 當 Firebase 已配置。 | F01 canonical／裝置 ledger；F02 真寄信；F03 完整帳戶；F06 清走 SQL mail consumer |
| workspaces、families、family-access、records、care | workspace／member／child／資源狀態與 accessVersion 同交易；不搬 advisory lock。撤權／刪除先設即時拒絕閘，後有界清衍生資料。保留 invitations、notification preferences、revisions、tombstones。 | F02 最小孩子與越權；F03 全部家庭／記錄／照護 |
| online、online-change、transaction-pool | 原 opId、payload fingerprint、caller scope、expectedVersion、command receipt、changeSeq／outbox 一次提交；無 SQL savepoint 替身。changes 分頁與失回覆原操作查回。 | F02 最小重試／衝突；F03 全 command 與 changes |
| chat、product-agent-store、agent-work-store、agent-confirmation-store、agent-actions-store、agent-original-receipts-postgres | 按上文聊天表保留 run／原訊息與唯一回覆 claim、跨 run 確認、原 receipt reader、作用與終態；取消／版本／授權於同庫交易再次核對。 | F01 authority／原接點；F03 完整 command、非同步 reply；F07／08 成果 |
| agent-work-continuation、product-agent-background、worker-main | 原 event／候選快照／run claim 同庫；既有 Firestore continuation store 消費 canonical authority，未有有效事件不呼叫模型；終態／unknown 只查回。 | F01 pure-due 可執行接點；F03 完整 run；F06 排程／恢復 |
| tasks、task-work-view、task-worker、worker-control、worker-queue | care task／occurrence／revision／提醒批次／generation 與 Firestore outbox 同交易；Tasks 可重投，worker 按持久 lease／generation／epoch／取消屏障領取，不以 task-name 時窗代替原收據。 | F02 一項提醒、重投及 VM OIDC；F03 全 task；F06 全 consumer |
| memory、memory-summary、care-summary-store、shared-input-store | fact/topic/revision、summary coverage、visit preparation、shared input 管理版本；同交易核來源版本／private scope／撤權，來源刪除令衍生摘要失效。 | F03 記憶／摘要基礎；F04 完整匯入／報告 |
| ai-usage、embedding-gateway、model-settings、product-agent-services | 正式注入 Firestore session／root budget／daily usage；本人設定與 key 清理按原權限；model、embedding、background 共用限制與收據，不能靠預設 SQL usage。 | F03 動態設定／跨 instance 准入；F07 restore／用量 |
| knowledge-store、knowledge-refresh-store、knowledge-version-review、personal-library-api；knowledge／knowledge-refresh CLI | immutable source/version/chunk/vector、publication pointer、立即停用及來源正文；保留原 body 候選、filter、RRF／1024 維，不搬私人資料入公共索引。 | F02 少量已核知識及真索引；F05 完整來源／發布／查詢；F06 更新 |
| growth-store／worker、concern-store／worker、contact-store | revisions／followup／本人 consent／grant／attempt／slot，排程 outbox 與 domain receipt 同交易；撤權、停止、unknown 先拒絕再清理。 | F03 業務；F06 全背景；F07 跨帳號演練 |
| web-push-store、web-push-queue、telegram-store；各投遞 gateway | 訂閱／綁定／單次投遞收據／重試／停止；外發前核目前授權與 worker fencing，外部結果不明不得自動重發。 | F06；F02 不擅自向真接收端通知 |
| family-document-store／worker、agent_document_operations | document＋snapshot＋source revision＋caller-wide operation＋原 run link＋changes 原子；長文有界分頁，PDF／報告讀同成果版本。 | F02 一份文件局部修改；F04 全版本／匯出；F08 A09 |
| photo-store、photo-files、photo-backup；storage-upgrade | Storage 私有不可變 object＋generation/hash；先持久刪除意圖，再清 metadata／物件。既有明文升級只屬舊 SQL，不對乾淨庫假跑；新資料一開始用加密格式。 | F02 一張附件及還原；F04 完整附件／配對恢復 |
| account-data、erasure-journal、account-erasure-journal／account-invitation CLI | 匯出／帳戶及孩子刪除閉包、獨立不可變 journal／receipt；Auth 與 Firestore 非跨服務交易，依原 op 狀態恢復，先關准入再清理。 | F02 最小刪除不復活；F04 全域退出；F07 全資料對照 |
| backup、storage-backup CLI、photo-backup、worker-control CLI；deploy/p1、deploy/p2 | 14 天 Firestore／附件配對 manifest、隔離 restore／最新 journal／現行 Auth／新 epoch；還原背景保持暫停。保留 VM／Compose／Caddy；Tasks／Scheduler 取代 pg-boss，配對備份使用 Firestore／Storage。 | F02 最小還原；F07 完整 restore／相容版本回退；F08 SQL 退役 |

**固定依賴與最小實作。** Node 24、Firestore 9.3.1 沿用；本包加入 firebase-admin 14.5.0（Apache-2.0，Node >=22），SDK 原生 session-cookie／revocation API 已按安裝版本核對，license 納現有 manifest。Firebase client 13.0.0、Tasks 7.2.1、Storage 8.4.0 是 2026-10-11 registry 核對的候選固定版本，尚未直接安裝／驗證；各首次實作切片才引入及保存 license，不宣稱 registry 相容等於產品已驗。ADK 2.1.0／GenAI 2.24.0 不重寫。

**查詢與索引落地界線。** F01 authority／device ledger 只有確定 ID 點讀及原生交易，密文不建索引；deploy/firebase/firestore.indexes.json 固定 yuban_authority／yuban_authority_sessions 的全欄位 exemption，部署改 namespace 時必須同步清單，不推定其他 collection 已覆蓋。collection 命名空間綁受信配置及 AAD。F02 首次 query 同時交付具體 collection-group、filter／sort／cursor／limit 及雲端 index manifest；其餘域按上表逐切片追加，不從全密文集合掃描解密代替 query，也不把 query hint 當權威。F03 的 query 仍須沿聊天表上限；F04 清理先有即時 tombstone／epoch 拒絕，再依 source／scope 反向接點有界清理；F05 正文／向量索引不得索引私人內容。

**取代關係。** [ADR-022](DECISIONS.md#adr-022) 已取消本次舊帳戶 scrypt／UID 匯入、私人資料搬遷及 SQL 反向同步；上文 2026-10-08 匯入研究只屬歷史，未執行亦不列為通過。舊 SQL／備份保存不刪，Firebase 新寫入後只回退相容應用版本或隔離還原。

### F02 已選 SDK 與原生接點（2026-10-11）

- 正式 browser 身份使用 Firebase Web SDK 13.0.0 的記憶內 persistence；ID token 只作同源 HttpOnly cookie 交換，不由 client 直讀私人資料。Firebase Functions 7.4.0 接 beforeUserCreated；Cloud Tasks 7.2.1 接持久 outbox dispatcher。既有 Firestore 9.3.1／Admin 14.5.0 不變。Web SDK 的 @firebase/app／auth 要求 Node >=24.12.0，本包把 Node 24 線最低版本同步提高，實際本機使用 24.19.0；不把先前 24.11 的安裝警告當相容證據。
- Storage 原候選 8.4.0 與現行 ADK 2.1.0 的 optional peer ^7.17.1 衝突；不強裝，採已核對的 7.22.0。該版 FileOptions 雖容許 string，File constructor 仍把 generation 轉 Number；不可用它 pin 超過安全整數的版本。使用公開 File.request／requestStream 的 qs.generation 十進制字串及官方 [Objects:get](https://docs.cloud.google.com/storage/docs/json_api/v1/objects/get)，保留完整版本識別。metadata 先核 generation／size，再有界串流讀取，完整性由 ciphertext SHA-256、既有 AES-GCM 與原內容 hash 核對；寫入仍使用 CRC32C 及 ifGenerationMatch:0。這是已核 SDK／官方接點，真 Storage 實測仍待 F02。
- 四項新增直接依賴的固定版本、integrity、原始 license／上游 commit 及 lockfile 聲明清單見 [授權 manifest](../licenses/manifest.json)；非全量轉遞依賴審計。Firebase Auth、Functions、Storage、Tasks 不改寫家庭授權、原 opId、取消／unknown 或恢復權威。

### F05 有界檢索與來源保存（2026-10-13）

沿已固定 Firestore 9.3.1、既有 parser／私人來源服務，沒有新增搜尋框架。原生 [向量](https://firebase.google.com/docs/firestore/vector-search) 先套用版本／chunk 適用篩選；Standard 沒有正文搜尋，故在既有資料模型增公共詞彙桶，沿原權重／RRF 查必要桶及選中正文。不是先讀完整語料到 Node 排名；不索引私人正文。變更與權限仍由本工程 authority 交易核對，原前端 client／HTTP 接點復用。

欄位索引的 Firebase CLI manifest 是簡寫；[REST IndexConfig](https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.collectionGroups.fields#IndexConfig) 使用 `Index.fields`。部署腳本須轉換 `order/arrayConfig` 為該欄位的 fields 項，PATCH 只更新 indexConfig、不改 TTL。文件核對不是原生通過證據；本包實測見 WORKLOG 的 F05 專項。

### S04-W01：沿用 Expo／Firebase 的原生身份與更新基礎

2026-10-15 核對：沿 Expo 57.0.24／Firebase JS 13.0.0，不引入另一套 React Native Firebase。新增官方 SDK 57 配套 `expo-crypto` 57.0.3、`expo-secure-store` 57.0.4、`expo-updates` 57.0.23（MIT），EAS CLI 固定 24.14.0；原 LICENSE 及固定來源保存在 THIRD_PARTY_NOTICES／licenses。Expo 的 [Firebase JS 接線](https://docs.expo.dev/guides/using-firebase/)、[SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/) 及 [runtime fingerprint](https://docs.expo.dev/eas-update/runtime-versions/) 滿足現有電郵身份、原生憑據及後續 OTA 接口；無需新身份供應商、WebView 或手機業務主庫。

沿 `expo/fetch` 的原生 ReadableStream，固定版本 Android 實作已核對 `credentials: omit` 關閉 CookieJar、`redirect: error` 不跟隨重導向；自訂薄 transport 只補本產品 origin／身份與遲到回應規則。Firebase [Server session](https://firebase.google.com/docs/auth/admin/manage-cookies) 仍驗 issuer／撤銷／到期，產品另保持逐裝置 ledger；不能只持有 SDK ID token 便略過邀請。必要合成檢查及 Android bundle 與 APK／真機結果分開，後者依 PLAN 門檻交付。

Android 的 React Native／Expo runtime 未提供共用程式需要的 `crypto.randomUUID`；只在原生啟動時以 [Expo Crypto](https://docs.expo.dev/versions/latest/sdk/crypto/) 補安全隨機方法，不改 Web、不使用 Math.random，也不宣稱提供完整 WebCrypto。瀏覽器 changes event 不在原生執行，AppState 接續依 S07-W01。

Firebase JS 13.0.0 的 React Native `_getAdditionalHeaders` 沒有 Android package／cert header；既有 Web key 的 referrer restriction 不適用原生請求。依 [Firebase API key 指引](https://firebase.google.com/docs/projects/api-keys)，不同平台可用同一專案的獨立公開 key，只開 Authentication 所需 API，不加入 Gemini／業務資料權限。保留既有 Web key 限制，不覆寫 SDK 私有方法、不偽造瀏覽器來源；原生設定是否生效仍須實際接線驗收。

S04-W01 固定 `@expo/fingerprint` 0.20.13 的 Windows config loader 以反斜線作 glob 比對，與 Linux 的預設排除結果不同；按[官方 loader 路徑正規化](https://github.com/expo/expo/blob/main/packages/@expo/fingerprint/src/ExpoConfigLoader.ts)局部回補 `toPosixPath`，不升整套 SDK、不放寬 runtime 核對。`mobile:prepare` 有版本／原文／實體依賴路徑 guard；僅本機指紋一致已驗，修後 APK 另驗。


### S07-W01：共用變更游標及原生生命週期

2026-10-16：復用現有 changes cursor、owner／Query 失效及身份 transport，沒有另一份同步資料庫。採 Expo SDK 57 配套 `expo-network` 57.0.2（MIT；固定 npm 原碼／license 已保存），只用 [getNetworkStateAsync／addNetworkStateListener](https://docs.expo.dev/versions/latest/sdk/network/) 配合 React Native AppState。網絡未知不冒稱離線；訂閱優先於遲到的初讀，初讀失敗不產生未處理 promise。沒有讀取 IP 或使用 Web 的外部 IP 服務。正式依賴變更需新 native runtime／APK，原生事件仍待真機；共用游標邏輯及型別已核。

固定 React Native 0.86.3 的 `Libraries/Core/setUpXHR.js` 使用 abort-controller，其 AbortSignal 不提供 Web `any`／`timeout`。共用 observer 以一個 request controller、父取消 listener 及可清理計時器保留原十秒讀取上限；只取消 metadata 讀取，不取消 Server Agent 或重送寫入。


### S12-W01：相機、二進位資料與裝置匯出

2026-10-16：沿 Expo 57 固定 ImagePicker 57.0.19、FileSystem 57.0.7、Sharing 57.0.21，以及已使用的 expo-crypto 57.0.3；base64-js 1.5.1 顯式列為直接依賴，不自寫編碼器。均 MIT，原 license 及 lockfile 保存。沿官方 [ImagePicker](https://docs.expo.dev/versions/latest/sdk/imagepicker/)、[FileSystem](https://docs.expo.dev/versions/latest/sdk/filesystem/) 與 [Sharing](https://docs.expo.dev/versions/latest/sdk/sharing/)，核固定 npm 原碼／型別；不引入第二套媒體後端。

Expo fetch 57.0.24 在未裝 expo-blob 時返回 React Native Blob；RN 0.86.3 Blob 沒有 arrayBuffer，但 FileReader.readAsArrayBuffer 有原生實作。共用讀取保留此後備，SHA-256 由原生 expo-crypto 薄 port 提供；不偽造整套 Web Crypto。相簿／相機只在明確點按開啟，按實際 bytes／JPEG／PNG／4 MiB 核對，使用同一照片 API、收據及授權。私人來源原 owner 可共用，不另造手機版。

PDF 與資料下載只替換出口：Web 原下載；Android 私有 cache＋系統 shareAsync，開啟前重核當前 scope。固定 Android Sharing 在 chooser 的 activity result 返回，不能證明接收應用已保存；不即刻刪檔令接收方讀不到。暫存最多 16 份、每份最多 16 MiB，下次匯出清理超過 24 小時項目，不宣稱嚴格定時清理；取消亦不當保存成功。檔案是本人明確要求的匯出副本，不是可寫業務主庫。SDK 原生套件須新 APK/runtime；型別及原生 Blob 合成接點已驗，裝置權限／選圖／PDF 分享仍待真機。


### S12 語音校驗與錄音接點（2026-10-16）

沿既有 Expo 57 採固定 `expo-audio 57.0.5`（MIT），只要求前景錄音，明確關閉背景錄音／播放。Web 使用 MediaRecorder 的 Opus WebM／OGG 或 MP4；Android 用 Expo Audio 的單聲道 AAC/M4A。原始片段的兩分鐘／5 MiB 是共用格式限制，不用副檔名推定安全。

Server 使用 `mediabunny 1.61.5`（MPL-2.0）原碼及 LICENSE 不作修改；只在受記憶體／時間／並發上限約束的 Node worker 解析記憶體內檔案，沒有模型、解碼、URL 或網絡來源。曾比較 MIT 的 `music-metadata 12.2.1`，其 Matroska 時長仍依容器 Duration／tag，不能處理常見 MediaRecorder 缺值，故未採用。Mediabunny 的 `computeDuration` 亦不能直接當所有 WebM 的精確時長：固定版本對最後一個沒有 BlockDuration／DefaultDuration 的包可回傳 0；用 [RFC 6716 §3](https://www.rfc-editor.org/rfc/rfc6716.html#section-3) 的 Opus TOC 計算補齊，有界逐包核查並拒絕不可靠的時間序列。這是局部接駁，不另寫容器解析器。

[Expo Audio](https://docs.expo.dev/versions/latest/sdk/audio/)／[Mediabunny 讀取 API](https://mediabunny.dev/guide/reading-media-files)／[Gemini 音訊格式](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/audio-understanding) 已核對；本機以缺少總時長的 WebM 及 WAV 核對格式／上限，並核加密原物件查回。未證明手機錄音、真音訊模型品質或正式保存／轉錄全鏈；沿 S12 gate 交付。

S12 音訊模型接線（2026-10-16）：沿既有 ADK 2.1.0／GenAI 2.24.0／Gemini 3.1 Flash-Lite，不加轉錄供應商。官方模型頁已核對單 prompt 一段音訊及 MP4／WebM／OGG／WAV／MPEG 支援；專案仍限兩分鐘／5 MiB。音訊原件留私有 Storage、ADK 持久事件只記身份，由 gateway 每輪暫時加入相同位元組，避免超過 Firestore 單文件容量；原工具 parts、用量與取消不變。正式 Runner＋合成 provider 的同一語音操作流程通過，不當成真音訊理解品質或正式入口已開啟。[官方規格](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-1-flash-lite)


### S04-W03 固定發布入口

2026-10-18：沿 EAS CLI 24.14.0／Expo Updates 57.0.23／fingerprint 0.20.13，不新增發布平台。核對固定 CLI：`fingerprint:generate` 會上傳 fingerprint，故零發布 plan 使用本機 `resolveRuntimeVersionAsync`；`build:view`／`update:view`／有界 `update:list` 查正式身份及 runtime，`update:republish` 作相容回退。依 [runtime](https://docs.expo.dev/eas-update/runtime-versions/)／[rollback](https://docs.expo.dev/eas-update/rollbacks/) 保留原生與 JS 相容邊界；工具 JSON 只保存 ID／版本等白名單欄位。固定 SDK 方法及本機守門已核對，真雲端發布／回退與裝置升級仍待驗；採用與否不靠模型猜測套件是否含原生改動。


### S12-W05 有界檔案讀取（2026-10-18）

Word `.docx` 採固定 `mammoth 1.13.0`（BSD-2-Clause）`extractRawText`，不渲染HTML、執行文件或開放外部檔案；舊 `.doc` 不冒稱相容。沿用其已有 `jszip 3.10.2`（MIT／GPL-3.0雙授權，使用MIT條款）並列為直接依賴，以公開nodeStream逐塊核對解壓量，再抽取同一原檔。Node24需用Readable.wrap接駁該版本的舊式stream，不把它直接當async iterator。兩者原碼及license不修改。

解析放在有時間／記憶體上限的worker，只回有界文字及續讀位置；PDF沿既有pdfjs／knowledge-pdf逐頁方法，文字型檔案使用UTF解碼。採用依據：[Mammoth](https://github.com/mwilliamson/mammoth.js)、[JSZip nodeStream](https://stuk.github.io/jszip/documentation/api_zipobject/node_stream.html)。一個合成DOCX已核對抽取及續讀，與私人保存流程合併驗證；不把它當真Agent理解、圖片OCR或任意格式解析的證據，正式接線狀態仍見PLAN。


<a id="local-emulators"></a>
### DEV-AGENT01 官方本機 emulator（2026-10-18）

採固定 `firebase-tools 15.34.0`（MIT，開發依賴）、Node 24.19.0／Java 21，僅啟動 Auth、Firestore、Storage。沿現有 SDK／ADK 2.1.0 與正式服務，沒有自建資料庫、測試 Agent 或新搜尋框架。[官方 Emulator Suite](https://firebase.google.com/docs/emulator-suite)／[固定 CLI 原碼](https://github.com/firebase/firebase-tools/tree/v15.34.0)。CLI 的 SQL／其他平台相依只屬其開發工具套件，沒有啟動 SQL Connect／Cloud SQL 或產品 SQL 執行。lockfile 新增 369 項依賴、原項版本沒有改動，不代表全部 transitive package 已逐一審核。

實測固定版 Firestore Emulator 可執行 `findNearest`，無需另寫本地向量搜尋。Storage Emulator 忽略 generation precondition，因此只補單 runtime 的物件序列化及固定 metadata 核對，仍用正式加密／附件服務。CLI 標準匯出只涵蓋 `(default)`，開發資料庫因而使用隔離 demo 專案的 default；正式命名資料庫不改。Windows 第二個 CLI 匯出進程曾在成功後發生退出 assertion，改用同版 CLI 自身的 Hub export 接點並核三種 manifest，保存原失敗；該內部接點與固定 CLI 一起升級核對。穩定啟動、資料重開、首條真模型及 Web 讀回見 [DEV01 EV](../artifacts/verification/DEV_AGENT01_LOCAL_20261018.json)，不延伸為四角色、雲端 IAM 或真通知通過。

<a id="personal-google-keys"></a>
### MODEL-SELF01 個人 Google key（2026-10-18）

沿既有 Google Gen AI SDK 2.24.0（Apache-2.0）與ADK 2.1.0，不新增供應商SDK。Gemini Developer key使用`enterprise:false`；Vertex Express key使用`enterprise:true`及global v1，不帶平台project／location，避免隱式ADC。官方Express REST只列countTokens／generateContent／streamGenerateContent，沒有已核對的模型目錄或embedding方法；因此只接生成，其他能力明示未支援，不改借平台。[Express API](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/express-mode/api-reference)／[SDK固定版本](https://github.com/googleapis/js-genai/tree/v2.24.0)。

Gemini目錄使用原生`models.list`的Pager，最多兩頁各100項，只取已接協定profile；不讀完整模型列表或自動試用每個模型。Gemini2.5採thinkingBudget（Pro動態、Flash／Lite關閉可選thinking），既有Gemini3保留thinkingLevel。這是參數相容選擇，不宣稱品質／速度已實測；metadata也不等於生成或embedding可用。[模型目錄](https://ai.google.dev/api/models)／[thinking配置](https://ai.google.dev/gemini-api/docs/thinking)。SDK／HTTP重試維持一次，由正式gateway統一有限重試與計量。合成接線及真服務未驗邊界見[MODEL01 EV](../artifacts/verification/MODEL_SELF01_SETTINGS_20261018.json)。

2026-10-20局部核對：[Express支援清單](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/start/express-mode/overview)與已接profile的交集為Gemini2.5 Flash／Flash-Lite／Pro，不能因Developer模式支援便把3.1 Flash-Lite等列入Express。清單由Server共用，設定頁切換服務只讀本地profile；沒有試生成、換模型或提高用量。官方列出但尚未接profile的型號不提前開放，清單亦不保證個別key可用。[API key認證](https://docs.cloud.google.com/docs/authentication/api-keys)另指出非Gemini專用的授權key受組織政策限制；不能把普通Gemini key當作Vertex key，或為驗收任意改組織政策。
