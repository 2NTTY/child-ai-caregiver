# P1–P4 技術復用核查

核對日期：2026-09-25 至 2026-09-26；基線：`80cf50c08ee044e734d2463fe9a22ae30eeb786d`（當時本地及遠端 master）。本文件保存選型證據、代價及待驗證項；現行技術邊界由 [ARCHITECTURE](ARCHITECTURE.md#reuse-boundaries) 維護，工作包由 [PLAN](../PLAN.md#roadmap-packages) 維護，執行規則由 [AGENTS](../AGENTS.md#technical-skills) 維護。進入工作包時只補查版本變動或證據缺口，不重做整份調查。

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
| 1 · S13-W04；S10-W02 復用 | pg-boss 12.34.0、Graphile Worker 0.17.3、現有業務台帳＋自寫執行器 | 優先驗證 pg-boss；PostgreSQL 原生佇列符合本地部署，心跳方向適合數分鐘故障恢復。現有台帳繼續使用 | 通用領取、持久排程、存活檢查、重試及停止程序 | MIT；新增 schema／連線／備份成本；兩個候選均只有文件相容，Graphile 的 hard-kill 恢復預設不合所選時限，詳見下節 | P／架；A 共通規則 |
| 1 · S11-W02；S16-W02 | 已接 ADK 的 Session、Plugins、Skills、conformance；自建對應能力 | 保留 Runner／Prompt Pack／單次 InMemorySession；優先 BasePlugin＋原生 spans 作最小診斷，按下表取捨原生能力 | 不重建 agent loop、session 協定、callback／trace 管線或技能載入器 | Apache-2.0；現有 Runner 實測，其餘接線待驗；持久 Session 另有 ORM／加密缺口；實驗性功能不成核心依賴 | P／架 |
| 1 · S13-W01；S12-W03；P4 S10-W03 | 手動表單、React Hook Form 7.88.0＋resolvers 5.9.1＋現有 Zod | 新複雜表單優先 RHF；成熟的欄位／錯誤狀態管理，保留既有驗證契約 | dirty／touched／欄位陣列、錯誤映射及表單重設 | MIT；React 19／Zod 4 在 peer 範圍，TS 6／RN 控制元件仍待本工程驗證；不把 Server 校驗移到表單 | P／架 |
| 2 · 上述新增共用頁面；P3 S04-W01／S12-W01 | 現有 RN 元件、React Native Paper 5.15.3、Expo UI 57.0.19／57.0.20 | 新增複雜共用頁面先小範圍試 Paper；Expo UI 用於確有原生控制需要的局部。不要同包引入兩套完整設計系統 | 主題、表單控制、dialog／menu／無障礙基礎；原生控制 adapter | 均 MIT；Paper 穩定 v5，但無 RN 0.86 實測證據；Expo UI Universal 有 Web fallback，仍需 Web／Android／RHF 接線驗證 | P／架 |
| 2 · S16-W05；S16-W02／W03／W04 復用 | 現有 node:test／Web 腳本、Playwright Test 1.63.0 | 提前獨立建立 P2 Web 測試基礎；成熟 browser runner，保留既有測試 | fixtures、隔離、定位／等待、trace、報告及多瀏覽器執行 | Apache-2.0、Node ≥20；browser binaries／資料清理／執行時間；只文件相容，不能代替 Android 原生 E2E | P 新包／架 |
| 2 · S13-W05／W06／W07 | web-push 3.6.7；grammY 1.46.0／Telegraf 4.16.3；手寫協定 | Web Push 用 web-push；Telegram 優先 grammY，當期 Bot API 支援及維護較合適 | VAPID／推送加密、Bot API 型別、請求及 webhook 解析 | web-push MPL-2.0、grammY MIT；不可讓 SDK 重試繞過投遞台帳；均待實際外發驗收 | P／架 |
| 3 · S07-W01；S09-W03／S07-W02 延續 | 現有刷新、TanStack Query 5.103.2 | P3 先採讀取快取及失效管理；保留 opId 寫入 transport | 查詢去重、讀取快取、loading／error、重連及頁面失效 | MIT、React 18／19；身份／Server 切換清理及 RN focus／online adapter 待驗；禁用持久離線 mutation／outbox | P／架 |
| 3 · S13-W02 | Expo Notifications 57.0.21；Firebase Admin 14.5.0；Google Auth Library 10.9.1＋FCM HTTP v1 | 客戶端優先 Expo；Server 優先官方 Auth＋單次 HTTP v1 薄 adapter，避免 Admin 隱藏重試 | 原生 token／通知事件、OAuth 憑據與標準訊息協定 | MIT／Apache-2.0；Admin 內部預設重試不合 unknown 規則；Android 真 build／權限／token／送達待驗 | P／架 |
| 3 · S05-W03／S12-W01／W02；S17-W05 | Expo 官方 SecureStore／Camera／ImagePicker／Audio／Sharing；現有 Compose／Node／Postgres | 同 SDK 能力優先，核心自部署；僅缺口才加庫 | 原生權限／裝置橋接、憑據保存；延用部署與備份機制 | 各模組在進包時固定版本／許可；分享輸入不能只靠分享輸出 API；Windows 及 Android 未驗 | P／架 |
| 4 · S08-W01／S10-W03／S14-W02／S15-W01／W02 | QR／HTML 解析／PDF 等成熟庫；現有授權、RAG、加密／備份 | 到具體輸入／排版／遷移需求才各核查 1–2 個候選；不新建通用平台 | 通用編碼／解析／排版；復用已驗收的版本發布、備份及還原 | 待選型；字體／授權／不可信輸入／完整還原按包驗證，現在不鎖定無需求支撐的依賴 | P 指向規則；無新架構 |

S13-W01 的業務任務台帳、S13-W07／W08 的授權／關注規則、S14-W01 的統計與來源關係，以及 S13-W03／S15 的單主切換仍由項目控制；通用庫沒有理由取代這些領域規則。已完成工作包只復用成果，不因本表選型返工。

<a id="worker"></a>
## S13-W04：框架與業務台帳的分界

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

前端執行次序已按其專責 task 對齊：先在 `frontend/` 逐頁做獨立 Web 預覽，主聊天接正式 API；整套 Web 獲使用者明確確認且符合 P3 前置後才開始 Android。以下跨平台核查是選型輸入，不是現在開始 Android 或修改正式 App 的授權。Preview 驗證不能升格為正式整合證據，詳細交付界線見 [交接文件](P2_UI_HANDOFF.md#chat-handoff)。

- **RHF＋Zod：**[RHF 7.88.0 manifest](https://github.com/react-hook-form/react-hook-form/blob/v7.88.0/package.json) 支援 React 19、Node ≥18；[resolvers 5.9.1 官方 registry](https://registry.npmjs.org/@hookform/resolvers/5.9.1) 支援 RHF ^7.55、Zod ^3.25／^4，MIT。該 tag 的 repo manifest 曾顯示較舊版本號，registry 5.9.1 的 gitHead 為 `f18ddfbb5f75a24b77c408565ad767eba4dd6704`；尚未核驗安裝 tarball。採用 gate 包括實際 artifact／TS 6 typecheck、Zod 4 input／output、RN Controller 的 `onChangeText`、reset／陣列／非同步錯誤及重連表單保留。不批量改寫舊手動 validator，不讓 RHF 重設原 opId 或自行重送 unknown 寫入。
- **Paper：**[5.15.3 固定 manifest](https://github.com/callstack/react-native-paper/blob/v5.15.3/package.json) 為穩定 v5／MIT，peer 範圍寬，但其開發基線 RN 0.82.1／React 19.1.1 不能證明本工程 RN 0.86.3 已通過。它提供完整 Material 元件／主題，適合新複雜頁面；需驗 Provider、字體／圖示、Expo Metro Web、鍵盤 focus、dialog／menu 與 Android 無障礙。[Web 指引](https://oss.callstack.com/react-native-paper/docs/guides/react-native-web) 的舊 Webpack 配置不能原封照抄到目前 Expo；不選 v6 alpha、不換 P1 整套主題。
- **Expo UI：**lock 已透過 Router 間接帶入 57.0.19，未直接採用；SDK 57 的候選補丁為 57.0.20。[Universal 文件](https://docs.expo.dev/versions/v57.0.0/sdk/ui/) 及 [57.0.19 對應原碼](https://github.com/expo/expo/blob/7687b07947a5c866adeb11abbceae72403ccb188/packages/expo-ui/src/universal/index.ts) 確認 root Universal 支援 Web fallback；不是只有 iOS／Android。`/jetpack-compose`、`/swift-ui` 專屬入口不能當作共用 Web 元件。[Host](https://docs.expo.dev/versions/v57.0.0/sdk/ui/universal/host/) 的版面行為及 [TextInput](https://docs.expo.dev/versions/v57.0.0/sdk/ui/universal/textinput/) 的 native observable state 與 RHF 同步／reset／游標／中文輸入法需另驗；官方 primitive kit 不等於 Paper 的完整表單主題。Android 原生控制有需要時再局部選用。
- **TanStack Query：**[5.103.2 manifest](https://github.com/TanStack/query/blob/release-2026-09-21-0933/packages/react-query/package.json) 為 MIT、React ^18／^19；[RN 指引](https://tanstack.com/query/latest/docs/framework/react/react-native) 要接 AppState focus／onlineManager。[mutation 行為](https://tanstack.com/query/latest/docs/framework/react/guides/mutations) 涉及 offline pause／resume，不能不加判斷便接管寫入。首批只做讀快取，key 包含 Server／身份／workspace／child 及所需世代；登出／撤權／Server 切換取消在途請求並清理，驗 late response 不回填舊權限資料。改用 Query 的頁面只保留一套刷新機制，現有 opId／收據／unknown transport 延用。
- **Playwright Test：**[1.63.0 release](https://github.com/microsoft/playwright/releases/tag/v1.63.0)／[manifest](https://github.com/microsoft/playwright/blob/v1.63.0/packages/playwright-test/package.json) 為 Apache-2.0、Node ≥20；本工程只有文件相容。S16-W05 用隔離合成資料、單 test worker、Chromium／Firefox，先覆蓋家庭隔離／角色、寫入回應遺失後查原 opId、撤權後清 UI 三條真瀏覽器流程。保留既有 P1 腳本／node:test；[Android API](https://playwright.dev/docs/api/class-android) 的 experimental Chrome／WebView 支援不能代替 RN APK 真機驗收。

<a id="channels"></a>
## 通知與官方平台能力

- **Web Push：**[web-push 3.6.7](https://github.com/web-push-libs/web-push/tree/v3.6.7) 支援 Node ≥16，MPL-2.0，CJS／型別接入待驗。用它處理標準加密及 VAPID；分發時保留許可／通知，修改 MPL 覆蓋檔案須核對義務。家庭綁定、訂閱撤銷、敏感 payload、投遞狀態及 unknown 仍由項目處理。
- **Telegram：**[grammY 1.46.0 release](https://github.com/grammyjs/grammY/releases/tag/v1.46.0)／[官方 Bot API](https://core.telegram.org/bots/api) 的當期 10.3 支援，是優先於 Telegraf 4.16.3 的理由；不據此宣稱後者已停止維護。預設不裝 [auto-retry plugin](https://grammy.dev/plugins/auto-retry)；webhook secret／update_id 去重、使用者先啟動 bot、綁定及反向回覆授權由本項目處理，429 及不確定結果由 worker／台帳控制。
- **Android／FCM：**[Expo Notifications SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/notifications/) 候選 57.0.21（MIT）處理原生 FCM token／通知接收與互動；須真 native build，不把 Expo Go 當 remote push 驗收。Server 可直接使用 FCM，毋須依賴 Expo Push Service 作核心排程或台帳。
- **Admin SDK 的代價：**Firebase Admin 14.5.0 為 Apache-2.0、Node ≥22，但 [api-request](https://github.com/firebase/firebase-admin-node/blob/v14.5.0/src/utils/api-request.ts) 預設 maxRetries=4，包含 503／ECONNRESET／ETIMEDOUT；[messaging request](https://github.com/firebase/firebase-admin-node/blob/v14.5.0/src/messaging/messaging-api-request-internal.ts) 使用此 client，[公開 AppOptions](https://github.com/firebase/firebase-admin-node/blob/v14.5.0/src/app/core.ts) 未提供對應關閉選項。先選已間接使用的 Google Auth Library 10.9.1（直接使用時列直接依賴）取得 token，再以單次 `fetch` 調 [FCM HTTP v1](https://firebase.google.com/docs/cloud-messaging/send/v1-api)；不 monkey-patch 私有 SDK。token 取得／刷新與訊息 POST 分開；實際 wire attempts、逾時／unknown／429／失效 token 在 S13-W02 驗證。
- **其他平台功能：**S05-W03 優先核對 Expo SecureStore；S12-W01 優先 Camera／ImagePicker／Audio；S12-W02 先核對 Sharing 的輸入及輸出支援。只讀當期 SDK 57 對應功能，分享輸入的 experimental 能力及 Android 權限不由 Web 文件相容性代替；各模組版本、許可及真機驗收隨該包固定。

<a id="local-deployment"></a>
## 本地部署與採用閘

Node／PostgreSQL／pgvector／worker、業務台帳、附件、權限及確定性規則可由自有 Compose 承載，不以 Cloud Tasks、Vertex Session／Memory Bank 或代管 RAG 作核心前置。沿用 GCP 初期部署成果；S17-W05 驗證不附加 GCP 身份且關閉 AI 時仍能登入、管理資料／任務及執行確定性規則。Gemini 仍是外部模型服務，私有部署不代表離線推理；Google 官方支援 [GCP 以外 ADC](https://docs.cloud.google.com/docs/authentication/set-up-adc-on-premises)，具體憑據配置及模型授權須在交付驗證。FCM／Telegram／Web Push 亦是可失敗的外部渠道，不是資料權威。

每個候選先做該包最小接入及必要輕量 typecheck／unit／build；有真服務、資料庫 integration、E2E 或真機成本時，按 [PLAN 驗證制度](../PLAN.md#verification) 先列明原因、範圍、次數／成本。通過才把「文件相容」更新為指定場景實測；失敗保留版本及原因，僅回查缺口。若既有實作已足夠，記一句復用結論便繼續，不為每個小功能建大型框架比較表。
