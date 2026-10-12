# 五階段實施計劃

本文件維護工作包的目標、前置、狀態、未完成項及完成門檻，按包推進，不按日期或周排程。產品要求見 [SPEC](SPEC.md)，短現況與部署觀察見 [STATUS](STATUS.md)，實際測試與失敗見 [WORKLOG](WORKLOG.md) 及各包證據；執行與文件更新規則只依 [AGENTS](AGENTS.md#document-updates)。

Sxx 是穩定範圍標識，不代表數字執行順序。原條款被新決策修訂時保留錨點，以 [ADR-008](docs/DECISIONS.md#adr-008) 追溯替代關係；不得把被替代要求當成已完成。

## 閱讀次序

1. [全項目總覽](#phases)：P1～P5 範圍與完成門檻。
2. [當前 P2 計劃](#current-p2)：當前包、聊天成果及 F01～F08。
3. [P2 已交付工作及承接](#p2-delivered)：原二十包、本人模型設定、INT、A01～A09 與後續修復。
4. [P3、P4、P5 及暫緩目標](#later-phases)：保留完整後續包，列清前移子範圍。
5. [S00～S17 導覽](#steps)及[文件工作包](#document-packages)：只連各包唯一正文。
6. [狀態](#states)、[證據層級](#verification)與[歷史／相容入口](#historical-entry)。

**原 P2 已結案；增補後的完整 P2 尚未完成。** 原二十包的完成只涵蓋當時範圍；INT、A 系列的已合併成果不等於完整聊天、Firebase 遷移或正式 GCP 服務已通過。A09 的未完成部分由 F07／F08 承接，並非另一套平行待辦。


<a id="phases"></a>
## 五階段及完成門檻

| 階段 | 工作正文 |
|---|---|
| P1 基礎成品 | [P1 工作包](#s01-w01) |
| P2 完整 Agent／穩定 Web 服務 | [當前計劃](#current-p2)／[已交付](#p2-delivered) |
| P3 高級完善成品 | [Android 及跨端](#s04-w01) |
| P4 完整版 | [自部署及完整能力](#s06-w04) |
| P5 以後升級版 | [非必要增值](#p5-future) |

<a id="phase-1"></a>
### P1 基礎成品

- **交付範圍：**在線 Web、最小登入隔離、孩子／文字記錄、Server 持久化與聊天、Gemini／簡單 prompt
- **完成門檻：**合成資料先玩通；Server 加密／最小加密備份還原、憑據及日誌保護通過；完成時交付組員可獨立試玩的 URL

<a id="phase-2"></a>
### P2 完整 Agent／穩定 Web 服務

- **交付範圍：**保留原 P2／INT 成果；增補邀請制單人服務、語義工具、持久工作、有證據的 RAG、真正文件讀寫／成長成果與本人跟進
- **完成門檻：**[P2-A01～A09](#p2-agent-service) 成果及 [P2-F01～F08](#p2-firestore-migration) 遷移完成；SPEC AC-P2A-01～08／AC-P2F-01～04 中本輪有效範圍通過；[AC-P2M-01～04](SPEC.md#ac-p2m-01) 依 [ADR-021](docs/DECISIONS.md#adr-021) 僅驗聊天與接口，其他角色內部驗收暫緩；GCP 真實資料服務可用，證據與部署分開；原二十包完成不能代替新門檻

<a id="phase-3"></a>
### P3 高級完善成品

- **交付範圍：**Android 在線客戶端、跨端更新、原生通知／FCM、語音／相機、家庭交接
- **完成門檻：**真機與 Web 共用服務；權限／資料一致性／通知及平台行為已驗收，不建本地 Agent 或離線主庫

<a id="phase-4"></a>
### P4 完整版

- **交付範圍：**自選相容 Server API、Windows Docker Compose 少步部署、裝置配對／臨時會話、既有 RAG 的完整管理／規模／維運擴充、分享／趨勢／PDF、Server 搬遷／災備
- **完成門檻：**全部現行有效 REQ／AC 及 S01–S17 工作包結案；原驗收條款的保留／修訂／替代均可追溯，待驗收不得當完成

<a id="phase-5"></a>
### P5 以後升級版

- **交付範圍：**另行確認的非必要增值
- **完成門檻：**不阻塞 P1–P4，不承接未完成的必要功能，不預建空框架

<a id="current-p2"></a>
## 當前 P2 計劃

<a id="active"></a>
### 當前任務入口

唯一當前工作包：[P2-F02 合成雲端切片](#p2-f02)。依 2026-10-11 已批准計劃完成 F01～F08，A09 剩餘門檻由 F07／F08 承接；身份及資料採乾淨 Firebase 起點、正式系統全面捨棄 SQL，見 [ADR-022](docs/DECISIONS.md#adr-022)。2026-10-12 起按 [ADR-023](docs/DECISIONS.md#adr-023) 沿用原網址作單一開發站；零 SQL 是硬要求，其他服務按運行費、改動量及維護收益選擇，接手時先收束 VM／Hosting 選擇。前後端隨各資料域接通並以完整流程做必要驗收，不另維護公開合成預覽或把首次整合延至 F08。實際環境、驗收／費用授權及尚需人工輸入見 [STATUS](STATUS.md)，不在本文件複製操作流水帳。

<a id="chat-capacity-recovery"></a>
### 聊天容量恢復

- **狀態／承接：**未完成，2026-10-11 起由 [F03](#p2-f03) 移植、[F08](#p2-f08) 完成正式操作驗收，不再先交付舊 SQL 版本。原候選基線 `a38e03f3`、分支 `codex/p2-chat-capacity-recovery` 及未提交修改／失敗證據原位保留；不能將承接標成完成。
- **目標：**服務忙碌時給家長可理解的提示，保留原輸入，由本人手動重送；容量釋放後可取得回覆，取消或授權失效的請求不佔住名額。
- **影響範圍／接點：**Server 的同時運行准入、取消與終態；chat API／controller 的忙碌錯誤及草稿保留。沿用 [Agent API](docs/API.md) 及現有 HTTP／client 接點，不以提高預算或另建佇列解決。
- **前置／不變條件：**保留現有身份、家庭／孩子隔離、原 opId、未知結果查回、防重、根預算與收據；不自動重送有副作用的請求。
- **已有局部證據：**核心定向檢查與獨立程式審核已進行；不等於完整 HTTP／瀏覽器流程通過。
- **未完成：**原文不變的手動重送、跨家庭／孩子操作隔離及取消等完整操作證據尚未齊；本機整合 fixture 的失敗／未驗保留在原候選。不能把局部綠燈標成整包完成。
- **完成門檻：**忙碌提示 → 原文保留 → 本人重送 → 回覆的完整流程及必要取消／隔離邊界均有可核對證據，獨立 review 收束後隨 F03／F08 所屬完整包交付，不另拆容量修補 PR；未驗不得填通過。驗證環境和批准範圍按 [AGENTS](AGENTS.md#finish) 及本聊天有效指示另核。

### 聊天 Agent 可靠辦事；F01 接點與既有能力整合

2026-10-09 範圍依 [ADR-021](docs/DECISIONS.md#adr-021)：本輪只交付家長使用的聊天 Agent；資料收集／知識維護、資料生成／編製、審核三個 Agent 保留接口，內部實作及四角色全量驗收暫緩。權限、來源有效性、確認及結果誠實門檻保留。

- **成果目標：**理解不完整交代；只就影響結果、對象或授權的歧義補問，回答後沿同一工作接續。完成知識查證、文件／任務操作、記憶更正及授權內提醒；保留取消、版本、原操作收據與結果未知。原 A09 的引用、同一文件修改及新對話讀回仍須完成。
- **復用與適配：**沿 ADK 原生 Runner／工具循環及既有業務服務，按固定來源、授權及實際移植段落記錄所採用提示詞；研究不等於採用。只補身份／孩子／資料／收據及介面適配，不另造通用 runtime 或多角色平台。
- **連貫成果：**不完整交代 → 必要補問 → 原工作接續 → 查證 → 保存／同 ID 局部修改 → 中斷後查原收據 → 新對話讀回 → 授權提醒及取消。正式預設生成上限仍為 4；受信 profile 的局部 5 步證據只見 [#181 原 run](artifacts/verification/TRUSTED_RUN_LIMITS_20261010.json)，不能省略讀版本／保存工作／present 步驟或把一次工具成功當整個 work 完成。
- **現存缺口及承接：**F01 補逐 store 對照、身份／session 接點、canonical lifecycle 與逐工作 outcome 邊界；F02 補真雲端競爭、交易、索引、OIDC／Tasks／縮零實證；F03 補完整業務保存、跨 instance 限額、正式 query embedding／其他路徑共額、動態本人設定與清理；F06 補正式 bootstrap／排程／outbox／worker、重啟接續、撤權、跨庫 fencing／resume；F07 補日額 restore、配對還原及全量演練；F08 完成原 A09 聊天成果及正式服務。default memory 與持久模式停止後查原結果均不等於跨程序恢復；舊 SQL 只作遷移對照，不新增後續 SQL 依賴。
- **證據界線：**scripted／mock／Emulator 只證明指定機械邊界；32k 下界失敗與 64k 配置通過分開，字元不是 token。離線受控文件批次未通過產品工具讀原 receipt 正文，也未有同回覆多工具即時中止、可靠 token／thinking 硬限、successor／累計成本權威；見 [候選說明](docs/CONTROLLED_DOCUMENT_BATCH.md)。局部已合併切片見[交付索引](#chat-reliability-delivered)，不能解鎖正式流量或完整 F01。

目前配置及根共同預算見 [運行配置](docs/ARCHITECTURE.md#p2-agent-budgets)；歷史付費批次／批准只作 [原 LOG](WORKLOG.md#log-20261009-initial-summary-integration) 證據，不授權本聊天重啟。其他三角色恢復內部實作須有新的使用者決定。


<a id="p2-firestore-migration"></a>
### P2 Firestore 與集中雲端服務遷移

2026-10-08 路線依 2026-10-11 [ADR-022](docs/DECISIONS.md#adr-022) 更新為乾淨起點及正式零 SQL。本節取代 [P2-A 計劃](#p2-agent-service) 的 PostgreSQL／Better Auth／單 VM **後續交付路線**，不取消 Agent、資料治理及穩定服務門檻。決策見 [ADR-019](docs/DECISIONS.md#adr-019)，機制見 [架構](docs/ARCHITECTURE.md#firestore-target)，產品要求見 [SPEC](SPEC.md#p2-firestore-service)。

#### 基線與保留範圍

歷史 SQL 依賴、數量及用途見 [固定盤點](docs/TECH_REUSE.md#firestore-dependency-audit)。這是保存及執行機制遷移，不能只改連線名稱。按 [依賴盤點](docs/TECH_REUSE.md#firestore-dependency-audit) 逐域對照，不把 SQL join／savepoint、cascade 或 trigger 當作 Firestore 已提供的能力。

集中邀請制讓家長註冊登入後使用本人空間，不要求自建 Server、建立家庭或提供 key。保留 ADK、Prompt Pack、前端設計／owner、平台 AI、可選本人 key、家庭成員／私人資料隔離，以及所有已有功能、修復與有效證據。家庭增補、Android、自部署、大型管理及跨 Server 通用遷移仍延後。

| 項目 | 已確認目標；不代表已接入 |
|---|---|
| 資料／檔案 | Firestore Standard Native；私有 Cloud Storage；保留應用層加密 |
| 運算／入口 | Cloud Run 按請求計費、minimum instances 0；Firebase Hosting 同源 API |
| 身份／准入 | Firebase Authentication；產品管邀請、本人空間、角色、資料同意及逐裝置會話撤銷 |
| 背景 | Cloud Tasks＋Cloud Scheduler＋Firestore 持久工作台帳／outbox |
| 地區 | 業務資料及運算預設香港 asia-east2；已接受 Firebase Auth 在美國處理認證資料，不宣稱全部資料只在香港 |
| 規模／保留 | 初期 10 帳號、約 3 日活；每日備份 14 天；附件 7 天復原期另加配對備份覆蓋 14 天；獨立持久刪除紀錄 |
| 切換 | Firebase 乾淨起點，不搬舊帳號／私人資料；必要維護停寫，不建長期雙寫；新寫入後只回退 Firebase 相容版本／隔離還原 |
| 排除 | Firebase SQL Connect／Cloud SQL、額外常駐搜尋叢集、重寫 ADK／前端 |

#### 全包共同完成邊界

以下仍是 F01–F08 的共同 gate；詳細定義由所連契約維護：

各包交付包含所屬前端 owner／API／資料路徑接線及同一開發站的必要代表流程；已有效通過的未變範圍不重跑，不能把未接畫面留成假成功。F07／F08 只補跨域、必要真模型及仍缺的最終門檻，不在另一套站點重複整包驗收。

- **保存／查詢／清理：**逐 store 核固定 ID、密文／AAD、版本、原 opId、授權／索引／游標、有界投影及交易原子性；唯一性、回調重跑、FK／cascade／trigger 的承接依 [資料契約](docs/DATA_MODEL.md#firestore-target)及[架構](docs/ARCHITECTURE.md#firestore-target)。
- **身份與隔離：**新合成身份註冊／驗證／找回與穩定資料關聯、邀請／本人准入、逐裝置撤銷、跨 instance 限流／配額，以及背景／附件即時授權，依同節[身份契約](docs/ARCHITECTURE.md#身份准入及會話)驗證，不能只靠 Rules 或單 instance。
- **背景與前端：**持久受理／outbox、Scheduler／Tasks、私有 worker、lease／generation／unknown 及 202／runId、Hosting／session 接點，依[非同步機制](docs/ARCHITECTURE.md#縮零outbox-與非同步-agent)及[API](docs/API.md#firestore-target)；保留既有 UI。
- **知識：**1024 維向量與有界公共混合檢索、適用性先行、權重／RRF、不可變發布及即時停用，依[知識契約](docs/ARCHITECTURE.md#官方知識與發布)；兼容向量不重算，私人內容不進公共索引，重要含義仍須核對。
- **附件／刪除／恢復：**私有 immutable 物件、授權下載、獨立不可覆寫加密刪除 journal、隔離還原及 epoch，依[檔案契約](docs/ARCHITECTURE.md#檔案刪除及恢復)；7 天復原窗不能代替 14 天配對備份。
- **成本與品質：**跨 instance／縮零／重投遞不能重置根預算；現行模型／每日配置不提高，四角色 6 次生成提案暫不啟用。F07／F08 仍須驗聊天引用、保存／局部修改、新對話讀回、授權跟進及其他角色接口；其內部實作暫緩，基建切片不能代替聊天成果。




#### 工作包與依賴

以下沿用既有工作包 ID 及前置，依 2026-10-11 已批准實施計劃更新內容；帳號匯入、私人搬遷及 SQL 反向同步由 ADR-022 明確取代，不減少其他功能／REQ／AC。按 ADR-021，只有聊天與其他三角色接口屬本輪 gate；另外三角色內部實作暫緩。研究、隔離候選及 draft PR 不當已合併；前置交付及驗收規則見 [AGENTS](AGENTS.md#git-workflow)。

<a id="p2-f01"></a>
#### P2-F01 遷移契約與接點

- **狀態／前置：**已完成並由 [#191](https://github.com/2NTTY/child-ai-caregiver/pull/191) 正常合併，merge `d5dbf61`；合併全樹已讀回與審核 head 相同。基線 master `fd5d4f0`（#190）。交付[權威／身份／正式組裝](docs/API.md#firebase-foundation-auth)及[全 SQL 路徑對照](docs/TECH_REUSE.md#firestore-full-runtime-audit)，結果及原失敗見 [F01 證據](artifacts/verification/F01_FIREBASE_FOUNDATION_20261011.json)。真雲端與其餘資料域未驗，不能把本包完成當 Firebase 全部遷移完成。

**目標／範圍：**逐項覆蓋正式 SQL 呼叫、store、內嵌查詢、交易、worker、備份及清理，沿既有資料／API／架構契約固定 Firebase 實作與驗收歸屬。固定 SDK、索引、Auth／逐裝置 session、儲存／排程接口，補 canonical account／workspace／child／run／work 生命週期；保留聊天／其他角色接口、草稿／確認／發布及現行預算。

**下一步／完成門檻：**正式選擇入口已能組裝真 Firebase adapter，F02 從空的隔離環境透過真服務 writer 建立權威，無須 fixture 注入；由 F02 承接真服務驗證。原 SQL 只維持切換前既有版本，不新增後續依賴、不自建 SQL 引擎；F08 移除新正式系統 SQL 執行依賴。定向交易／身份檢查及獨立 review 通過，逐 store 對照無未歸屬項才可交付；F02 真雲端門檻不能以本包局部測試替代。

<a id="p2-f02"></a>
#### P2-F02 合成雲端切片

- 狀態／前置：進行中；P2-F01／#191 已合併並讀回，master `d5dbf61`、分支 `codex/p2-f02-firebase-cloud-slice`。先固定既有產品接點、隔離資源／最小 IAM、費率與本批計量上限，再部署及執行已批准的一批完整驗收；專用信箱已取得。準備與實際結果見 [F02 證據](artifacts/verification/F02_FIREBASE_PREFLIGHT_20261011.json)，不把接點定位當流程完成。

**下一步／未驗：**正式 Firebase 核心 API、文件／原操作收據、不可變照片、跨帳號拒絕、公共知識真索引／版本、本人提醒設定及真 Tasks 重投防重已通過有界雲端續驗。指定信箱已完成真收信確認；配對備份、原照片刪除與隔離還原已核對完整 inventory、最新刪除日誌、當前 Auth、新 epoch、舊會話移除及背景暫停。原物件實體清理仍待辦；還原後照片不可讀不等於已完成物件清理。仍須完成自動縮零喚醒、真雲端撤權、必要產品畫面及重設電郵生命週期；手動停機不代替自動縮零驗收，指定帳號原瀏覽器失敗未重現。原失敗及定向修正證據保留，完整 F02 gate 與獨立審核通過後才交付並進入 F03；本機或局部 API 成功不代替整包。現場版本、暫停安排及費用只見 STATUS／既有證據。

**交付與完成門檻：**登入、引用、保存／修改、防重、排程、附件、刪除／隔離還原；真雲端通過才搬全部功能

<a id="p2-f03"></a>
#### P2-F03 核心業務資料

- 狀態／前置：未開始；P2-F02。

**交付與完成門檻：**完整帳號／家庭權限、孩子、記錄、記憶、聊天、持久工作、確認、changes、收據及本人模型設定；聊天 runtime、其他角色接口、持久確認狀態及根運行共同預算。接通正式 Firestore session／usage／跨實例准入；逐項移植容量候選，驗忙碌提示、原文保留／手動重送、取消釋放及身份切換清理，重核同文和跨租戶 opId，不沿用失真的 fixture 綠燈。F01 已固定記錄的五項 master 測試型別錯誤，隨本包 runtime／ports 接線收束；不可把全量型別紅誤報為通過。

<a id="p2-f04"></a>
#### P2-F04 文件、檔案與退出

- 狀態／前置：未開始；P2-F03。

**交付與完成門檻：**聊天 Agent 經既有記憶／任務／文件服務保存可重用成果及局部修改；資料編製 Agent 僅留接口；文件／修訂／報告／照片、匯出、退出、持久刪除及配對加密備份，14 天資料／附件能一起恢復

<a id="p2-f05"></a>
#### P2-F05 官方知識

- 狀態／前置：未開始；P2-F02、P2-F03。

**交付與完成門檻：**既有官方知識的保存／混合檢索、來源閱讀及發布／停用邊界；獨立知識維護與審核 Agent 僅留接口，其內部自主收集／語義審核不在本輪；保留 body 檢索與兼容向量

<a id="p2-f06"></a>
#### P2-F06 全背景流程

- 狀態／前置：未開始；P2-F03、P2-F05。

**交付與完成門檻：**任務、關注、聊天工作接續、既有來源更新事件及通知重試／停止；其他角色喚醒只保留接口；郵件保留／替代對照，不能漏 pg-boss 消費者

<a id="p2-f07"></a>
#### P2-F07 全量合成演練

- 狀態／前置：未開始；P2-F04、P2-F06。

**交付與完成門檻：**在 GCP 以真 Firebase／Tasks／Storage、scripted provider 及完整合成資料核對全部領域、附件和收據；驗並行、失回覆、重啟、取消、刪除重放、隔離還原及 Firebase 相容版本回退。新寫入、刪除、審核／草稿／維護進度與 unknown 不丟失；納入聊天成果、其他角色接口及現行預算必要驗收。原 SQL 反向同步／Auth 相容映像要求由 ADR-022 取代，不以乾淨起點省略新資料恢復。

<a id="p2-f08"></a>
#### P2-F08 正式入口及交付

- 狀態／前置：未開始；P2-F07、實際切換窗口，以及實測成本／月費估算後由使用者決定持續營運預算。驗收及資源授權見 STATUS。

**交付與完成門檻：**Hosting／Cloud Run 正式入口、完整聊天 Agent 引用→保存同一文件→局部修改→新對話讀回及必要確認／跟進／停止、容量恢復操作、實測成本與其他角色接口。移除新正式系統的 PostgreSQL／pg-boss／Better Auth SQL 組裝、套件、部署／遷移／備份入口，驗無 SQL 仍完整運作；正式切換及舊 VM 收束不刪舊備份。承接 A09 未完成 gate；未取得持續營運預算或未完成正式切換前，不能把 F08／完整 P2 標完成。

F02 以少量合成帳號、孩子、一份文件、一項提醒、一張附件及少量已核對知識走通「登入 → 查證 → 保存／修改 → 原操作重試 → 縮零後喚醒 → 刪除 → 隔離還原」。同流程順帶驗越權、撤權、版本衝突、引用及 Tasks 重投遞，不拆大量 E2E。Emulator 只證明基本邏輯，不能代替真向量索引、交易競爭、OIDC、Tasks 及 scale-to-zero；失敗保留現場、修正方案後才決定是否繼續。

#### 低用量預算假設

2026-10-08 的完整月量／成本表及未實測限制已歸 [架構成本章節](docs/ARCHITECTURE.md#firestore-low-usage-assumptions)，不是資源或新模型批次授權。

#### 切換、回退與未決門檻

1. F07 完整合成流程、隔離還原及 Firebase 相容版本回退通過後，按 F08 已批准窗口停舊寫入／worker，核對 in-flight／unknown；未知結果不能當未執行再入列。
2. Firebase 採乾淨起點，不搬舊帳號、私人家庭資料、附件或收據；只匯入經核對的公共知識。14 天配對備份與恢復驗收針對新 Firebase 資料、附件、收據、待確認／未完成工作與刪除紀錄；保留舊版本及備份。
3. 新 Firebase 接受寫入後，只回退兼容 Firebase 的應用版本或隔離還原 Firebase；不反向同步 SQL，不切回只有舊資料的 SQL 系統。還原重放最新刪除日誌、核對目前 Auth、切換 epoch，背景外發預設暫停。
4. 全部 gate 通過、實測成本／月費估算已提交並取得持續營運預算後，才切換正式網址及按核准範圍收束舊 VM／磁碟／IP；不自動刪備份。部署最後觀察見 [STATUS](STATUS.md#deployment)，不能假定舊環境仍可用。
5. #140 有效修正、Prompt Pack 版本及失敗證據逐項追溯；新平台不消除真引用／局部修改／新對話讀回缺口，也不重跑有效驗收。

2026-10-11 的已批准實施計劃及 ADR-022 取代此處原帳號／私人資料搬遷與 SQL 反向同步要求。F02 依本聊天新增 US$30 遷移與驗收授權，建資源前固定具體隔離資源、最小權限、當期費率及批次上限；不能將本次授權擴為持續服務或增加其他付費資源。F08 的持續營運預算、停寫／正式切換及舊環境處置仍按使用者決定辦理。混合檢索品質、熱點／讀取成本、縮零及刪除還原仍須實證。

<a id="p2-delivered"></a>
## P2 已交付工作及承接關係

以下保留原任務、驗收要求、交付結果及證據入口。各包內的「本次／下一步／未部署」只指其原交付版本；部署現況依 [STATUS 日期觀察](STATUS.md#deployment)，現行缺口只由[當前 P2](#current-p2)及各承接包維護。已完成包不因新計劃重做，局部完成也不升格整體產品完成。

### 原 P2 二十個工作包

原階段共通的產品邊界仍保留：Server 從 P1 起保存權威資料；Web／App 在線存取、Agent 在 Server 執行。斷線只保留當前表單及所選照片並提示刷新／關閉風險，恢復後由使用者重試；不建立跨關閉草稿或離線寫入隊列。P1 用合成資料驗收；首次模型請求已有權限、憑據、配額、有限重試及日誌保護。詳細定義見 [架構](docs/ARCHITECTURE.md#section-3-1)。

原 P2 由 ADK 編排受限工具，按預先確認的對象／內容／渠道／fallback 自動聯絡，每次重查授權而非逐次人工確認。原 pgvector 最小 RAG 是已交付技術實作；官方穩定／近期知識分開更新與引用，可信育兒問答及非醫療分流的成長關注要求保留，後續保存機制由 F 包承接。P4 擴充管理、大規模導入、批量重建、效能及完整遷移；自部署接受 Docker Desktop／WSL2 前置，保留模型外送與通知授權。見 [ADR-011](docs/DECISIONS.md#adr-011)／[SPEC](SPEC.md#section-5-11)／[freshness](SPEC.md#knowledge-freshness)。


P2 的 20 個工作包必要驗收於 2026-09-30 齊備，已隨 [PR #71](https://github.com/2NTTY/child-ai-caregiver/pull/71) 合併結案；[公開交付證據](artifacts/verification/S17_W02_CHECKS.json)。其後 INT 已接回新前端並切換正式入口；Firefox 全套相容性仍依使用者決定延後。本輪 P2-A01～A09 為新增門檻，不自動啟動 P3。

<a id="s11-w03"></a>
#### S11-W03

- 階段／狀態：P2；已完成。
- 前置：S17-W01。

**目標、局部驗收及範圍界線：**ADK 基礎與相容性：固定依賴／許可、npm 與建置版本、既有 Prompt Pack 組裝、真 Runner／FunctionTool 有界循環、配額及取消；必要 scripted model 輕量檢查與另行批准的最小真 Gemini 驗收分開記錄；[EV-S11-W03](artifacts/verification/S11_W03_CHECKS.json) 通過，完整記憶／知識／任務接線留 S11-W02

<a id="s06-w02"></a>
#### S06-W02

- 階段／狀態：P2；已完成。
- 前置：S17-W01。

**目標、局部驗收及範圍界線：**家庭邀請／owner、caregiver、viewer 角色及按需孩子資料入口；owner／caregiver 可確認更正共享事實及改期／完成／關閉事項，僅 owner 可邀請／變更或撤銷成員權限／刪整個孩子，viewer 唯讀；個人通知偏好可管理，私人聊天不因家庭管理權而共享

<a id="s05-w02"></a>
#### S05-W02

- 階段／狀態：P2；已完成。
- 前置：S06-W02。

**目標、局部驗收及範圍界線：**確認／更正歷史、來源及精度、時間軸／快捷記錄／搜尋與原文／約數／單位／模糊時間；出生日期按需，約數年齡保留精度與日期基準，不猜精準窗口；私人聊天不自動轉共享事實；新持久資料納入刪除／備份

<a id="s09-w02"></a>
#### S09-W02

- 階段／狀態：P2；已完成。
- 前置：S05-W02、S07-W03。

**目標、局部驗收及範圍界線：**長期確認事實及來源／年齡日期基準、摘要覆蓋、話題／任務記憶及已解決／暫緩話題的再問條件，供後續關注復用；新會話及清空模型快取不重問已解決事項；摘要不改終態，已關閉事項不復活；[EV-S09-W02](artifacts/verification/S09_W02_CHECKS.json) 必要驗收通過，完成隨 [PR #34](https://github.com/2NTTY/child-ai-caregiver/pull/34) 合併生效

<a id="s07-w03"></a>
#### S07-W03

- 階段／狀態：P2；已完成。
- 前置：S06-W02、S05-W02。

**目標、局部驗收及範圍界線：**在線請求冪等／版本確認、並行修改與重連、刪除及撤權；重試不重建，衝突可見；不建離線 outbox；[EV-S07-W03](artifacts/verification/S07_W03_CHECKS.json) 必要驗收通過，已隨 PR #36 合併

<a id="s13-w01"></a>
#### S13-W01

- 階段／狀態：P2；已完成。
- 前置：S09-W02、S07-W03。

**目標、局部驗收及範圍界線：**Server 任務／對象／時間、穩定 occurrenceId、改期／取消／完成及站內台帳；任務、occurrence 與投遞分開，與後續關注候選保持獨立語義，家庭成員完成狀態同步；每日普通提示合併一次、普通任務最多跟進一次，安靜時段預設 Asia/Hong_Kong 22:00–08:00 可調，預約例外須明確選擇；先由手動入口驗收確定性規則，不在本包自建通用 worker；新 TaskPanel 接入 RHF＋Zod／Paper，保留既有 UI；[EV-S13-W01](artifacts/verification/S13_W01_CHECKS.json) 必要驗收通過，完成隨本包 PR 合併生效；持久 worker／投遞另由 W04／W07 交付

<a id="s13-w04"></a>
#### S13-W04

- 階段／狀態：P2；已完成。
- 前置：S13-W01。

**目標、局部驗收及範圍界線：**持久 worker、事件／到期觸發、分鐘級故障恢復及有限重試，業務有效結果唯一；優先驗證 pg-boss，業務台帳與入列同交易，job 只存參照；授權／終態／外發去重／unknown 由項目掌管。雙 worker、hard-kill、取消撤權、重試上限及備份還原按 [採用閘](docs/TECH_REUSE.md#worker) 驗收；Web 關閉仍執行，框架成功不代表任務完成；[EV-S13-W04](artifacts/verification/S13_W04_CHECKS.json) 必要本機驗收通過；詳細次數及恢復量測見同一 EV；完成隨本包 PR 合併生效

<a id="s10-w01"></a>
#### S10-W01

- 階段／狀態：P2；已完成。
- 前置：S17-W01。

**目標、局部驗收及範圍界線：**最小向量 RAG：有限官方知識分段／版本／適用性、固定 pgvector、embedding、精確向量＋關鍵詞／RRF 及最多六片段引用；可重複匯入／核對發布／停用指令、失敗／降級、既有資料保留及擴展備份還原必要驗收；不建完整管理平台；[EV-S10-W01](artifacts/verification/S10_W01_CHECKS.json) 必要本機／真 embedding／擴展還原通過，完成隨 PR #35 合併生效；Agent／引用 UI 在 S11-W02 接線

<a id="s10-w02"></a>
#### S10-W02

- 階段／狀態：P2；已完成。
- 前置：S10-W01、S13-W04。

**目標、局部驗收及範圍界線：**共用 worker 定期檢查：官方穩定每週、官方＋指定媒體近期每日；未變 hash 不重算向量，變更只更新受影響片段且核對後發布；驗收無變／失敗／停用／過期／日期／分類隔離；依使用者確認，CHP／RTHK 只限組內試用，公開檢索預設排除，見 [ADR-013](docs/DECISIONS.md#adr-013)；不做新聞分析平台；必要集中驗收及來源失效／登記撤回閘通過，完成隨本包 PR 合併生效，見 [EV-S10-W02](artifacts/verification/S10_W02_CHECKS.json)

<a id="s11-w02"></a>
#### S11-W02

- 階段／狀態：P2；已完成。
- 前置：S11-W03、S09-W02、S13-W04、S10-W02。

**目標、局部驗收及範圍界線：**接通互動／背景共用 AgentRuntime、已確認記憶、真向量檢索及任務工具；復用 Prompt Pack 的草稿／補問／確認／結構化結果，工具授權、版本、配額及取消一致；育兒問答／成長關注／安全求助引用適用官方片段，不足時明示；原生工具與收尾不重複執行副作用，不建立醫療分流；依 [ADK 原生能力核查](docs/TECH_REUSE.md#adk) 保留單次 Session／Pack，優先 BasePlugin＋原生 spans 最小診斷並驗無正文外洩，不另建 session／skill 平台；共用真 ADK／檢索／確認與背景重啟證據、引用修正的必要 Runner／離線重播覆核通過，範圍分列於 [EV-S11-W02](artifacts/verification/S11_W02_CHECKS.json)；真聯絡留 W07，完成隨本包 PR 合併生效

<a id="s12-w03"></a>
#### S12-W03

- 階段／狀態：P2；已完成。
- 前置：S06-W02、S11-W02。

**目標、局部驗收及範圍界線：**Web 照片上傳／附件識別與授權、提取及確認；原檔／hash／來源／刪除／備份／容量限制與失敗保留當前輸入；原檔／ADK 私人候選／確認及功能 UI 已接，見 [EV-S12-W03](artifacts/verification/S12_W03_CHECKS.json)；原資料保留、照片流程、真照片候選與配對備份／空庫還原必要證據通過；刪除快照限制及完整面板未驗分列，完成隨本包 PR 合併生效

<a id="s12-w04"></a>
#### S12-W04

- 階段／狀態：P2；已完成。
- 前置：S12-W03。

**目標、局部驗收及範圍界線：**使用者主動分享／貼上／上傳、指定公開來源及本人自訂私人來源（含自備訂閱／付費材料）；保存來源／時間／備註，公開可直接訪問 HTML 由本人明確取得，需登入正文由本人提供；不背景讀私人動態，不把帖子直接當家庭事實或執行授權；私人來源、受限提取、確認及功能 UI 已接，見 [EV-S12-W04](artifacts/verification/S12_W04_CHECKS.json)；023／私人來源保存、一次取得及隔離已通過；原提取日期失敗保留；修正版真候選及原文／確認／還原必要證據通過，完整分享面板瀏覽器未驗；完成隨本包 PR 合併生效，不重跑已通過項

<a id="s13-w05"></a>
#### S13-W05

- 階段／狀態：P2；已完成。
- 前置：S06-W02、S13-W04。

**目標、局部驗收及範圍界線：**Web Push adapter：優先 web-push 處理 VAPID／協定；家庭成員訂閱／授權／撤銷、站內狀態與失敗回報；發送不冒充已讀或完成，依 [渠道採用閘](docs/TECH_REUSE.md#channels) 驗證重試／unknown 及許可；業務／輪詢與 Firefox 關頁後真通知／撤銷通過；完成隨本包 PR 合併生效，公開 origin 留 S17-W02，見 [EV-S13-W05](artifacts/verification/S13_W05_CHECKS.json)

<a id="s13-w06"></a>
#### S13-W06

- 階段／狀態：P2；已完成。
- 前置：S06-W02、S13-W04。

**目標、局部驗收及範圍界線：**Telegram adapter：優先 grammY，不預設開自動重試；接收者先啟動 bot 並綁定、授權／撤銷、發送／回應及錯誤狀態；憑據／最小通知內容保護、webhook 去重及 unknown 依 [渠道採用閘](docs/TECH_REUSE.md#channels) 驗證；migration／還原、業務／輪詢、真訊息及本人收到回覆通過，公開 webhook／即時 callback 回應留 S17-W02；完成隨本包 PR 合併生效，見 [EV-S13-W06](artifacts/verification/S13_W06_CHECKS.json)

<a id="s13-w08"></a>
#### S13-W08

- 階段／狀態：P2；已完成。
- 前置：S11-W02。

**目標、局部驗收及範圍界線：**四年齡段有限且已核對的非醫療分流的成長關注規則、按已確認孩子情況判斷適用；站內候選生命週期及來源，關閉後同階段同依據不再催，新階段／實質新確認資料／官方規則實質變更才產生新候選並說明原因；舊終態不復活，可永久停用主題；[成長關注驗收](SPEC.md#ac-growth-attention)；四年齡段規則、家長控制／原操作唯一任務與保存、關閉抑制／新依據、真背景檢索及重啟去重的必要證據已核對；引用修正沿用必要 Runner／離線重播，範圍見 [EV-S13-W08](artifacts/verification/S13_W08_CHECKS.json)，完成隨本包 PR 合併生效

<a id="s13-w07"></a>
#### S13-W07

- 階段／狀態：P2；已完成。
- 前置：S11-W02、S13-W08、S13-W05、S13-W06。

**目標、局部驗收及範圍界線：**預先授權的對象／內容／渠道／fallback 及 S13-W01 提醒控制規則內主動聯絡；每次重查授權，失敗／回應／逾時按規則處理，完成／取消／撤權即停，未知結果不盲重發；沒新事件不空轉模型；預授權／工具／持久投遞及功能 UI 已接，見 [EV-S13-W07](artifacts/verification/S13_W07_CHECKS.json)；019／配對還原、SQL fallback／撤權／終態／unknown，以及一次真 Agent→Telegram→收到→明確完成及清理通過；原清理呼叫上限失敗保留。完成隨本包 PR 合併生效；公開 webhook／部署仍留 S17-W02

<a id="s14-w01"></a>
#### S14-W01

- 階段／狀態：P2；已完成。
- 前置：S11-W02。

**目標、局部驗收及範圍界線：**多孩子切換、到診問題／準備清單、簡單日／週摘要；數字程式計算、資料可追溯、更正可更新；真 API 摘要／準備保存、來源刪除後失效、migration／加密還原及真 Agent 摘要工具證據已核對，範圍見 [EV-S14-W01](artifacts/verification/S14_W01_CHECKS.json)；完成隨本包 PR 合併生效

<a id="s16-w05"></a>
#### S16-W05

- 階段／狀態：P2；已完成。
- 前置：S06-W02、S07-W03。

**目標、局部驗收及範圍界線：**提前建立共用 Playwright Test Web 測試基礎：隔離合成資料、單 test worker、Chromium；Firefox 依 2026-09-29 使用者確認延後作相容性驗收，不阻塞 P2；先驗家庭隔離／角色、遺失寫入回應後查原 opId、撤權後清 UI 三條流程。主聊天負責正式 App／真 API 瀏覽器層及受控測試資料，前端 preview 測試另記；保留 node:test／P1 腳本，不以 mock 或 Web 代替真服務／Android；E2E 執行仍先按驗證制度批准；Chromium 單一真 API 情景通過；後續必要功能檢查用 Codex 內置瀏覽器，不重跑已通過項，Firefox 保留未驗；完成隨本包 PR 合併生效，見 [EV-S16-W05](artifacts/verification/S16_W05_CHECKS.json)

<a id="s16-w02"></a>
#### S16-W02

- 階段／狀態：P2；已完成。
- 前置：原 P2 功能包（不含後續增補）、S16-W05。

**目標、局部驗收及範圍界線：**真 ADK 工具循環、四年齡段向量召回／引用、成長關注與抑制、記憶／任務、worker 恢復、家庭隔離、照片／來源、freshness、通知／fallback、失敗及成本必要驗收；復用 S16-W05 瀏覽器基礎及既有 scripted Runner，有限真 Gemini 情境另驗，不把 TS conformance 或靜態 Pack 當產品品質證據；證明家長需求與網頁關閉後背景事件兩條完整流程，高成本項先批准；必要本機／真服務證據已按包收束，全部功能包已合併；一次真聯絡與明確完成／清理已通過，原失敗保留，主模型最終證據核對通過，完成隨本包 PR 合併生效，見 [EV-S16-W02](artifacts/verification/S16_W02_CHECKS.json)。公開 HTTPS／正常部署接線及組員展示仍由 S17-W02 驗收

<a id="s17-w02"></a>
#### S17-W02

- 階段／狀態：P2；已完成。
- 前置：S16-W02。

**目標、局部驗收及範圍界線：**Web＋ADK 產品 Agent＋最小向量 RAG 比賽成品；演示家長需求及背景觸發的工具／任務／真實聯絡／回報，交付來源與操作／投遞證據及限制；不以 mock、靜態 Pack 或兩條演示取代真服務及其他 P2 驗收。S16 已隨 PR #67 合併；[部署及交付](docs/P2_DELIVERY.md)／[EV-S17-W02](artifacts/verification/S17_W02_CHECKS.json)，該次部署、原資料保留／向量初始化、合成 HTTP 及配對備份空庫還原通過（版本及次數見同一 EV）；兩條公開 ADK／來源／任務／關頁後真聯絡流程、本人 Push／Telegram 收到、明確完成及清理通過；原失敗及修正、當時配額紀錄見同一 EV；歷史配額不是新授權；必要驗收已齊，完成隨本包 PR 合併生效



### 本人模型設定增補

2026-09-30 使用者在 P2 結案後新增必備項：**網站／軟件可設定本人模型 key**。另以 S06-W05 作 P2 增補包，立即實作及獨立驗收；原 20 包的完成證據保留。此包不列入已結案 S16-W02 的「P2 全部功能包」前置集合，避免反向循環；其驗收由本包承擔。Android 在 P3 復用同一設定契約，P4 自選 Server 為另一項功能。

<a id="s06-w05"></a>
#### S06-W05

- 階段／狀態：P2 增補；已完成。
- 前置：S17-W02。

**目標、局部驗收及範圍界線：**本人模型 key 必備入口：首版 Gemini Developer API，保留平台 Vertex；Web 設定／替換／停用／刪除、帳號隔離及加密、明確同意／背景 opt-in、執行期版本重核、生成與查詢向量同一付費來源、分開配額／用量且無靜默 fallback；共用語料維護仍用平台。個人每日／單次生成／query embedding 上限可在 UI 調整並真正約束運行；平台上限不變。本次依使用者追加確認，只驗保存／隔離／刪除、原資料保留、scripted Runner 限額及撤回後停止；Google 地區限制下真 key 生成／向量保留待驗，不阻塞此次設定與接線交付。保存及必要 Runner 驗證已通過（migration／次數見同一證據），完成隨本包 PR 合併生效；[證據](artifacts/verification/S06_W05_CHECKS.json)。軟件端於 S04-W01 復用，無需先自部署或切換 Server；當時設定增補尚未公開部署；後續部署觀察見 [STATUS](STATUS.md#deployment)


<a id="production-integration"></a>
### 正式前端整合（P2 結案後增補）

2026-10-06 使用者確認先完成接線，並建立持續目標直到新前端取代正式入口。核心體驗及新增能力見 [SPEC](SPEC.md#agent-first-experience)，決策見 [ADR-017](docs/DECISIONS.md#adr-017)。沿用最新前端設計、既有 Server／Prompt Pack／素材；不把已確認的新 Agent 能力或預覽效果當作已實作。正式頁面接既有業務服務，缺少後端的關注鏈、多份準備文件及報告必須明示，不用相似 API 冒充。


<a id="int-w01"></a>
#### INT-W01

- 前置：master `61a8faa`；原分支 `codex/int-w01-production-foundation`。

**交付及驗收界線：**已完成（隨 [PR #91](https://github.com/2NTTY/child-ai-caregiver/pull/91) 合併生效）：正式建置、登入、孩子与共用 owner／讀取快取；[EV](artifacts/verification/INT_W01_CHECKS.json)

<a id="int-w02"></a>
#### INT-W02

- 前置：INT-W01。

**交付及驗收界線：**已完成（PR #92）：真聊天／引用、持久候選、普通記錄／私人交代與本人提醒的預授權操作及收據；[EV](artifacts/verification/INT_W02_CHECKS.json)

<a id="int-w03"></a>
#### INT-W03

- 前置：INT-W02。

**交付及驗收界線：**已完成（PR #93）：既有 UI-P2-01～18 接線、共用 owner／跨頁同步及人工備援；普通記錄更正、聊天游標及取消。一次代表流程通過，未全驗表單及新照片提取；[EV](artifacts/verification/INT_W03_CHECKS.json)

<a id="int-w04"></a>
#### INT-W04

- 前置：INT-W03（PR #93）。

**交付及驗收界線：**已完成（PR #94）：私人來源的對話設定、讀取、引用及管理；同一 shared_inputs／獨立私人引用，零模型必要流程與未驗見 [EV](artifacts/verification/INT_W04_CHECKS.json)／[LOG](WORKLOG.md#log-20261006-int-w04)

<a id="int-w05"></a>
#### INT-W05

- 前置：INT-W03。

**交付及驗收界線：**已完成（PR #95）：持續關注、站內主動跟進、事件鏈及結束／恢復；結束不取消相連任務、恢復不重排，原 input_limit 失敗與必要零模型流程見 [EV](artifacts/verification/INT_W05_CHECKS.json)／[LOG](WORKLOG.md#log-20261006-int-w05)

<a id="int-w06"></a>
#### INT-W06

- 前置：INT-W04、INT-W05。

**交付及驗收界線：**已完成（PR #96）：Agent 操作多份準備文件、成長報告及同版 PDF；[EV](artifacts/verification/INT_W06_CHECKS.json)

<a id="int-w07"></a>
#### INT-W07

- 前置：INT-W01～06。

**交付及驗收界線：**已交付，隨 [PR #97](https://github.com/2NTTY/child-ai-caregiver/pull/97) 合併完成：正式入口部署、必要接線證據及舊 UI 退出；[功能清單](docs/PRODUCTION_FRONTEND.md)／[EV](artifacts/verification/INT_W07_CHECKS.json)（完整瀏覽器序列在 HTTP 上限停批；剩餘 UI 斷言未驗，人工結果未代填；補驗次數見 EV／LOG）；[LOG](WORKLOG.md#log-int-w07)

驗收只取通常路徑及必要邊界：正式登入／Agent、跨頁同源、重開持久化、身份／孩子隔離、一次原操作 unknown 恢復；新增能力各取一條代表路徑，重用已有證據。不重跑完整預覽矩陣，不使用 Computer Use。真模型／通知仍受既有次數、成本、明確目的地及內容授權限制；部署前重查 VM 期限、備份及相容遷移。完成需列明已接、待驗及未接項，不能在過渡頁仍存在時宣稱正式接線完成。

<a id="p2-agent-service"></a>
### P2 完整 Agent 與穩定 Web 服務總計劃

2026-10-08 使用者定案；本節取代尚未落實的 Agent 增補提案，保留舊 P2／INT 的完成範圍與證據。A01～A08 的實作與最低證據以下各包為準；完整服務門檻未完成，不由 master 推定已部署。保存／認證／部署路線已由 [Firestore 計劃](#p2-firestore-migration) 取代。產品行為及 AC 見 [SPEC](SPEC.md#p2-agent-service)，技術邊界分別見 [架構](docs/ARCHITECTURE.md#p2-agent-service)、[資料](docs/DATA_MODEL.md#p2-agent-service)、[API](docs/API.md#p2-agent-service)；替代決定見 [ADR-018](docs/DECISIONS.md#adr-018)。

#### 目標與保留範圍

**在 GCP 提供邀請制、可保存真實資料的穩定 Web 服務；家長註冊登入後，一個人便能以「自然交代 → 查證及辦事 → 真實回饋 → 同源呈現 → 適時接續」使用核心 Agent。** 不必建立家庭、邀請照顧者、配置 GCP 或填模型 key；平台提供基本 AI，本人 key／限額只是可選設定。

保留文字、照片、私人來源連結／正文、記錄、記憶、待辦、準備單、持續關注、成長檔案、報告／PDF、本人通知及歷史。沿用 ADK、Prompt Pack、美術、正式前端 owner、權限與操作收據；PostgreSQL／pgvector、pg-boss 是目前實作，按 F01～F08 遷移，不重建另一套業務權威。手動輸入是備援；普通低風險指令在本人授權內直接執行，重要事項在對話內具體確認，未完成工作持久保留。

準備單是某一次到診、入學、旅行等事情到時可直接使用的行動資料；待辦負責「何時做甚麼」。同一事情可連結待辦、準備單及關注鏈，不另存可獨立修改的孩子資料。各頁用途沿用 [DESIGN_SYSTEM](frontend/DESIGN_SYSTEM.md)，保留已確認設計與互動。

延後家庭多人協作與選人聯絡／交接增補、Android、語音、一般文件上傳、自部署、跨 Server 遷移及大型管理介面；既有能力與安全隔離保留。官方手冊 PDF 的公共知識匯入不等於開放一般附件。維持不診斷、不開藥、不建立自動醫療分流；危險描述的已核對求助資訊不能被一般工具流程延誤。

#### 五項強制約束與實現方向

| 約束 | 各包必須保留的做法 |
|---|---|
| 語義選工具 | 拆除最後一句／延續詞 regex 的能力開關；常用工具與簡短能力目錄可見，模型依上下文載入工具，原生 function calling 的結果回到同一有界循環。不解析思考文字、不換成另一套固定意圖清單。 |
| 操作綁定確認 | 自然提示列清將改甚麼；Server 綁定操作參數、孩子／資源、資源及授權版本、提問訊息、候選及原 opId。只有唯一且有效的具體確認才承接「好」；模型不能自行產生同意。 |
| 一致的來源範圍 | 檢索前按本人／孩子／用途授權；摘要、文件及外發前再核對來源與目的地。公共、私人、孩子資料分開；coverage／版本／可見範圍不因摘要而放寬。 |
| 官方換版核對含義 | hash 發現變更後，在收集／發布管線核對年齡、數值／單位、時間、條件、例外及撤回；核對受影響引用、少量代表問題及相關規則。通過政策檢查才發布，不確定保留候選，失效舊版不冒充最新。 |
| 有界但可接續的讀取 | 資料庫先授權／適用過濾再排名、限量；搜尋、文件、歷史及完整期間整理使用游標／範圍，回傳 coverage、未讀部分及續讀位置。不能以讀取前綴冒充完整，也不能因資料增多整次失敗或將權限／DB 錯誤偽裝為空結果。 |

RAG 採上下文理解／必要改寫 → 向量與關鍵詞 RRF → 同版本章節／頁面擴讀 → 必要補查 → 有依據回答。約數年齡只是模糊問題之一；保留原話、精度及未知部分，不補造生日或其他事實。私人內容不進公共向量庫，公共查詢只攜必要情境。

持久工作保存目標、焦點、資源、待答問題、待確認引用及結果；不是預寫育兒流程。原始訊息／事件／收據與有 coverage 的摘要分開；相關歷史可按需續讀，更正、取消、撤權及孩子切換使受影響理解與操作失效。逾時先查原操作。

文件沿同一 ID／版本作局部增刪改移，固定版本分段閱讀；交易寫入帶 expectedVersion／opId，衝突先讀最新版。歸檔不佔終身建立額度，歷史恢復形成同一文件新版本。成長日常頁投影同源資料；季度／年度報告分批完整覆蓋，先統計再必要敘述，網頁與 PDF 同版，來源變更標待更新。

worker 只因相關資料／階段／到期／已授權跟進／有效知識換版觸發；無新事件不空轉模型。重查終態、授權、渠道及安靜時段，保留合併、跟進上限、抑制及去重；入列、渠道接受、收到和完成分開。



#### 增補工作包與依賴

A01～A08 的已合併成果保留；A09 僅有效修正收束，未完成成果由 F07／F08 統一承接。舊 Better Auth／PostgreSQL／單 VM 描述是當時實作與交付對照，後续交付路线依 ADR-019，沒有藉本次整理重新設計。

<a id="p2-a01"></a>
#### P2-A01 語義工具循環

- 狀態／前置：已合併 PR #132；[最低證據](artifacts/verification/P2_A01_CHECKS.json)。

**交付與完成門檻：**拆除關鍵詞閘；ADK 原生按需工具／配方、工具結果接續、配額／取消及真實終結。只補必要代表流程，不先實作 A02 工作狀態。

<a id="p2-a02"></a>
#### P2-A02 持久工作與記憶

- 狀態／前置：已合併 [PR #133](https://github.com/2NTTY/child-ai-caregiver/pull/133)／770ad48；[證據](artifacts/verification/P2_A02_CHECKS.json)。

**交付與完成門檻：**跨輪工作、相關歷史續讀／搜尋、來源與 coverage、Agent 更正／停用記憶、操作綁定確認及未知結果恢復。

<a id="p2-a03"></a>
#### P2-A03 真正文件讀寫

- 狀態／前置：已合併 PR #134；[必要證據](artifacts/verification/P2_A03_CHECKS.json)。

**交付與完成門檻：**準備單／文件局部正文與清單修改、固定版本續讀、歷史分頁、歸檔容量與實際保存收據；整合 PR #130 有效成果。

<a id="p2-a04"></a>
#### P2-A04 可補查官方 RAG

- 狀態／前置：已合併[PR #135](https://github.com/2NTTY/child-ai-caregiver/pull/135)；[證據／限制](artifacts/verification/P2_A04_CHECKS.json)。

**交付與完成門檻：**模糊問題的有界混合檢索／上下文擴讀，HTML／文字型官方 PDF、章節頁碼、增量向量及語義換版發布核對；首批香港核心主題及四年齡段。

<a id="p2-a05"></a>
#### P2-A05 成長成果

- 狀態／前置：已合併 [PR #136](https://github.com/2NTTY/child-ai-caregiver/pull/136)；[證據](artifacts/verification/P2_A05_CHECKS.json)。

**交付與完成門檻：**同源日常投影、完整季度／年度分批整理及同版 PDF，來源更正失效；復用已合併日期篩選修正。

<a id="p2-a06"></a>
#### P2-A06 有用的主動接續

- 狀態／前置：已完成（[PR #137](https://github.com/2NTTY/child-ai-caregiver/pull/137)）；P2-A02、P2-A03、P2-A04。

**交付與完成門檻：**私人工作事件接續、原run去重、終態／撤權與滿額關注結束；沿用本人通知原授權。[EV](artifacts/verification/P2_A06_CHECKS.json)。

<a id="p2-a07"></a>
#### P2-A07 正式單人使用流程

- 狀態／前置：已合併 [PR #139](https://github.com/2NTTY/child-ai-caregiver/pull/139)／b30a7b2；[證據](artifacts/verification/P2_A07_CHECKS.json)。

**交付與完成門檻：**各頁用途與共用 owner、統一歷史／完整聊天通知入口、單人引導、即時同源更新及安全操作入口；保留設計，不改成管理表格。

<a id="p2-a08"></a>
#### P2-A08 邀請制真實資料服務

- 狀態／前置：已合併[PR #138](https://github.com/2NTTY/child-ai-caregiver/pull/138)；[證據](artifacts/verification/P2_A08_CHECKS.json)。

**交付與完成門檻：**本人獨立資料空間、邀請註冊、Better Auth 電郵驗證／找回／會話撤銷、真實資料授權、下載及帳戶退出／刪除與備份保留說明。

<a id="p2-a09"></a>
#### P2-A09 GCP 穩定交付

- 狀態／前置：有效修正隨 [PR #140](https://github.com/2NTTY/child-ai-caregiver/pull/140) 收束；完整交付仍未完成；前置 A01～A08 已合併。

**交付與完成門檻：**Prompt 版本及文件收據修正、原失敗／未驗均保留；[收束證據](artifacts/verification/P2_A09_CLOSEOUT_CHECKS.json)。完整 Agent／帳號／備份恢復及穩定交付由 F07／F08 承接；原 VM／SMTP 專用路線被替代，不標整包完成。

#### 最低必要驗收及交付門檻

以少量連貫情景覆蓋以下成果；不要求每項另開真模型或 E2E，也不規定唯一工具順序。復用有效證據，不測大量偏僻矩陣，不使用 Computer Use。

1. 受邀註冊、登入及找回；不建家庭、不填 key 也可使用。
2. 模糊提問、多輪指向及改口，取得實際支持的重要官方引用並保存有用成果。
3. 長準備單續讀、指定項修改、勾選、歸檔及新對話讀回同一文件最新版。
4. 重要操作綁定對象／版本；多候選或過期時一句「好」不確認錯事，一次確認只生效一次。
5. 私人搜尋、摘要、文件及背景處理不擴大資料範圍。
6. 重要知識換版核對含義，失效舊版不當最新；資料增加仍可有界接續。
7. 更正同步成長頁、完整期間同版報告／PDF；本人提醒完成即停止。
8. 集中核對一次必要版本衝突、原操作重試、服務重啟、刪除與備份恢復。

完成以實際成果和 GCP 可用服務為準，不能以工具／畫面存在、mock 或 unit 通過取代。權限、分享範圍、有界讀取與可靠寫入不是最後整合才補的項目。


<a id="qa-report-period--關注觀察的固定期間歸屬已合併待部署"></a>
#### QA-REPORT-PERIOD — 關注觀察的固定期間歸屬（交付記錄）

- **結果／範圍：**#117 已合併；逐觀察以原事件 ID／日期歸屬期間，保留來源權威、未知日期、80 項 coverage、同版 PDF 及舊快照相容，不遷移／刪除資料。
- **驗收／限制：**原跨季聚合缺陷、香港跨日、超過五條、更正／撤權的原失敗及定向結果見 [EV](artifacts/verification/QA_REPORT_PERIOD_CHECKS.json)／[LOG](WORKLOG.md#log-20261007-report-observation-period)。fake Pool／mock renderer／scoped typecheck 不代表真 DB、PDF 排版、正式 UI 或全面驗收；部署只依 [STATUS 日期觀察](STATUS.md#deployment)。

<a id="qa-adk-runtime--指令資料分層與安全終結已合併待部署"></a>
#### QA-ADK-RUNTIME — 指令資料分層與安全終結（交付記錄）

- **結果／範圍：**#113 已合併；基於 #112 將不受信 context 移至資料 part、受信指令改 InstructionProvider，保留原生 parts／大括號原文。有效 present_answer 終結原生 loop 並再核引用／授權，混合 terminal batch 在 handler 前拒絕；互動 64k／背景 32k、selector／跨輪來源／DB 不在該包擴改。
- **驗收／承接：**Prompt Pack 版本、各輪測試及失敗見 [EV](artifacts/verification/QA_ADK_RUNTIME_CONTRACT_CHECKS.json)／[LOG](WORKLOG.md#log-20261007-adk-runtime-contract)，scripted 不代表真模型／UI。當時未解的漏調 present_answer、澄清跨輪來源、背景 no_action、按能力裁剪須對照後續 [A01](#p2-a01)、[A02](#p2-a02)、[A06](#p2-a06) 及[聊天成果 gate](#current-p2)，不另建 persistent state 或第二套記憶。

<a id="qa-interactive-input--待辦意圖與互動容量已合併待部署驗收"></a>
#### QA-INTERACTIVE-INPUT — 待辦意圖與互動容量（交付記錄）

- **結果／範圍：**#112 已合併；修含修飾語的明確意圖及標題／內容資料邊界。互動 AI_AGENT_MAX_INPUT_CHARACTERS 預設 64k、範圍 32k–64k，背景 32k、P1、生成／工具／輸出／時間及授權不變；設定頁只讀 Server 真值，舊 metadata 不猜值。
- **驗收／限制：**#110 基線的 T7 超限未建立待辦、確切線上參數錯誤仍未知；原失敗、定向修正及 typecheck 見 [EV](artifacts/verification/QA_TASK_INTENT_BUDGET_CHECKS.json)／[LOG](WORKLOG.md#log-20261007-interactive-input-contract)。scripted 不代替真待辦；沒有 CI 結果不得稱 CI 成功。
- **承接：**原 #111 draft／PostgreSQL 驗證受阻是當時狀態。核心修正由 [#137](https://github.com/2NTTY/child-ai-caregiver/pull/137) 合併及 [A06 本機證據](artifacts/verification/P2_A06_CHECKS.json) 承接；剩餘回歸由 [#142](https://github.com/2NTTY/child-ai-caregiver/pull/142) 合併，[#111](https://github.com/2NTTY/child-ai-caregiver/pull/111) 已關閉未合併，見 [補充證據](artifacts/verification/PR111_REGRESSION_RECOVERY_CHECKS.json)。正式 readers／029 啟用仍未核，不由本機結果推定。

#### QA-AGENT-CONTEXT-INTEGRITY — 工具容量與數量依據（已部署，保留交付快照）

- **結果／範圍：**#107／#108 修當前意圖選工具、有界單份 context／精確摘要前綴及 Server 數量 grounding。保留原 gateway contents／config 邏輯 JSON 的 32k 歷史上限、原生 parts、權限、opId／unknown、既有 store 及來源邊界；不新增完全無背景待辦、不改固定報告期間。後續互動容量由 QA-INTERACTIVE-INPUT 承接；收據客戶端相容修復在 #110。
- **驗收／限制：**input_limit、重複 context 與模型補造數量的原始失敗、真 UI 讀回及局部驗證見 [EV](artifacts/verification/QA_AGENT_CONTEXT_INTEGRITY_CHECKS.json)／[LOG](WORKLOG.md#log-qa-agent-context-integrity)。mock completed 只驗容量／循環，不當真待辦保存；普通保存及私人重要候選確認收據也不等於整個 run 成功。
- **當時未解／承接：**最終文字未通過 present_answer、201 項記憶／200 條關注事件容量死角須對照 A01／A02／A06 的後續成果，必要成果驗收由 F07／F08 承接；不再將原部署或 review 當下一步。

#### QA-DOCUMENT-INTEGRITY — 已合併部署及定向 UI 重測

- **結果／範圍：**#103 保留未變 checklist、有效來源的 stale 歸檔、無日期關注正文及同孩子／精確期間 active 標準報告 create／restore 防重。固定期間不改，不刪舊文件或改 DB；來源、家庭／孩子隔離、撤權、同版 PDF 及原 opId／unknown 保留。
- **驗收／限制：**固定句號分段的真 PDF coverage 保留原快照；stale 歸檔／恢復、刷新勾選及 coverage 的歷史定向 UI 觀察，連同原失敗／測試次數見 [EV](artifacts/verification/QA_DOCUMENT_INTEGRITY_CHECKS.json)／[LOG](WORKLOG.md#log-qa-document-integrity)。fake Pool／shallow 不當真 PostgreSQL 並發或瀏覽器驗收；真 Agent 首請求的服務暫不可用停批與零模型文件修復分開，定向 UI 不當全面通過。
- **後續：**原 renderer 頁尾缺口已由 [#179](#chat-reliability-delivered) 窄修；下載／隔離／取消晚到及完整聊天成果仍按 F07／F08 gate，不以 renderer 取代全流程。

#### QA-GROWTH-READ-BOUNDARY — 已合併，保留交付證據

- **結果／範圍：**#101 修 list／GET filter 對自由文字 region／未知年齡的邊界；只在本機 filter 轉換不可用時略過知識查詢並提示地域／0–10 歲限制，保留 profile、scope、authority、既有候選及其他資料。
- **不變條件：**sourceAvailable=false 只是未確認適用性的讀投影，不存回狀態／版本／歷史。DB／解密／網絡錯誤不吞掉；decide／topic（含回傳 page）／evaluate／Agent search 的嚴格失敗及 worker 邊界不變。
- **驗收／限制：**合成 A／B 的 GET 400、原 parser 兩碼地域／120 個月邊界、各次失敗與測試見 [EV](artifacts/verification/GROWTH_READ_BOUNDARY_CHECKS.json)／[重跑及對照限制](artifacts/verification/GROWTH_READ_BOUNDARY/README.md)／[LOG](WORKLOG.md#log-qa-growth-read-boundary)。沒有正式 HTTP capture；完整 Server 對照只替換 Growth store，非 pristine master；UI 補正未重跑完整 typecheck。局部零模型／通知／DB／全面瀏覽器與後來單次 UI 讀取分開，不冒稱全面線上根因驗收。

此前 QA-POST-RELEASE 已由 [#100](https://github.com/2NTTY/child-ai-caregiver/pull/100) 合併；原修復／失敗及部署交接見 [EV](artifacts/verification/QA_CHILD_SELECTION_CHECKS.json)。本次沒有重做或再次部署；歷史部署／UI 觀察均由固定原 LOG／EV 保存，STATUS 只留最後外部觀察。


<a id="chat-reliability-delivered"></a>
### 聊天可靠性與 F01 局部接點（已合併，未作正式部署）

以下是接手 `a38e03f3` 已包含的成果與限制；測試次數、修正輪次、工具失敗及詳細 hash 只在原 LOG／EV。已合併不等於開啟正式持久流量。#186 已合併；旧入口所寫「尚未 PR／合併」已失效。

| 交付 | 成果／仍有限制 | 原證據 |
|---|---|---|
| #168～170 | 固定平台 services、owned cleanup、日額不一致拒絕；完整 restore 未解 | [原交接](WORKLOG.md#log-20261009-initial-summary-integration) |
| #171 | 單字補問；原合成流程仍多一輪查回才完成 | [澄清](artifacts/verification/CHAT_DOCUMENT_CLARIFICATION_20261009.json) |
| #172 | 本人 user 原訊息、取消不可復活、歷史原 op 查回 | [工作安全](artifacts/verification/CHAT_WORK_SAFETY_20261009.json) |
| #173／#177／#182 | 搜尋、準備單、匯出彈窗及結果提示；PDF 真下載／pending race 未驗 | [前端包](frontend/PLAN.md#active)／[日期觀察](STATUS.md#preview-history) |
| #174 | 跟進取消／原收據恢復及同批事件呈現；原逐 constituent outcome／取消時間權威仍缺 | [原紅與局部驗證](artifacts/verification/CHAT_FOLLOWUP_RECOVERY_20261010.json) |
| #175 | 固定平台模型及 query embedding 共原 Firestore 日額；全平台共額及 restore 尚未完成 | [用量](artifacts/verification/F01_SHARED_EMBEDDING_USAGE_20261010.json) |
| #176 | accepted 確認重試共用原授權 client／鎖內收據；不把 lookup error 當 absence，不重做 decide | [確認重試](artifacts/verification/CHAT_CONFIRMATION_RETRY_20261010.json) |
| #178 | 同版本受核成長正文讀回，保留來源／scope／授權重驗，空正文拒絕 | [受核證據](artifacts/verification/CHAT_REVIEWED_GROWTH_EVIDENCE_20261010.json) |
| #179 | PDF 頁尾非診斷提示／頁碼窄修；正文／snapshot 不變，只驗 renderer | [原失敗及最終 PDF](artifacts/verification/QA_PDF_FOOTER_20261010.json) |
| #181 | 固定受信 profile 的有界 runLimits；不提高正式 default／日額，不解鎖全流程 | [局部接續](artifacts/verification/TRUSTED_RUN_LIMITS_20261010.json) |
| #183 | included／not_included／unknown 起始輸入證據，不是工作執行或完成證據 | [起始輸入](artifacts/verification/F01_FOLLOWUP_INPUT_EVIDENCE_20261010.json) |
| #184 | recovery-only 原收據 adapter；互斥 processor，不建立新 claim／重播副作用 | [恢復契約](docs/CHAT_AGENT_FIRESTORE_RECOVERY.md) |
| #185 | 純到期 writer／consumer 的未啟用接線、V1 lookup-only；canonical lifecycle、bootstrap／排程／outbox／清理／restore 等仍待 F 包 | [到期權威](artifacts/verification/F01_DUE_WORK_AUTHORITY_20261010.json) |
| #186 | 真 SDK wire 准入及離線文件 consumer；live factory 拒絕，原 receipt 工具讀回及完整成本／token gate 仍缺 | [離線批次](artifacts/verification/CONTROLLED_DOCUMENT_BATCH_20261010.json)／[界線](docs/CONTROLLED_DOCUMENT_BATCH.md) |

以上局部能力對應 [當前未完成項](#current-p2)，不新增一套修補清單。詳盡原段落的固定版本與去向見 [歷史索引](_archive/README.md#plan-20261011)。


<a id="later-phases"></a>
## P3、P4、P5 及暫緩目標

**本次只保留範圍，不啟動後續包。** P3／P4 所列 P2-A09 前置指其完整成果 gate；該 gate 現由 F07／F08 承接，不能因 #140 合併便解鎖。下方保留原前置字樣以便追溯，沒有移除任何依賴。

舊 PostgreSQL／pgvector／Compose 是原技術方案或已交付實作對照。使用者已決定捨棄 SQL，F01～F08 為既定遷移方向；S17-W05 等自部署包的歷史 SQL 技術描述不構成新 SQL 建置指令。替代實現與自部署方案留待另外規劃，本次不改需求、完成條件或預先選型。

### 原工作包前移與延後對照

保留原 Sxx 錨點及歷史，只前移本目標所需子範圍，不整包改稱完成；原表各包須與本表一起讀取。

| 原範圍 | 本輪 P2 子範圍／承接包 | 原階段剩餘範圍 |
|---|---|---|
| S09-W03／P3 | Web 歷史、記憶與新對話接續 → P2-A02 | Android 跨端記憶接點 |
| S07-W01／W02／P3 | Web 一致性、重連、未知操作恢復 → P2-A02、P2-A07、P2-A09 | Android、自選 Server、完整故障矩陣 |
| S10-W03／P4 | 官方 PDF、語義換版及必要發布維護 → P2-A04 | 大型後台、規模／效能擴展及通用遷移 |
| S14-W02／P4 | 日常成長檔案、季度／年度與同版 PDF → P2-A05 | 原生分享及非核心分析 |
| S15-W02／P4 | GCP 資料退出、必要備份保留與恢復 → P2-A08、P2-A09 | 跨 Server 搬遷及通用匯入／遷移 |
| 身份／服務缺口 | 邀請、找回、真實資料及穩定交付 → P2-A08、P2-A09 | 社交／電話登入、裝置配對 |

### P3 工作包

<a id="s04-w01"></a>
#### S04-W01

- 階段／狀態：P3；未開始。
- 前置：P2-A09、S06-W05。

**目標、局部驗收及範圍界線：**Android 在線登入／孩子／記錄／聊天、APK 與使用者真機流程；重用同一 Server 和業務，不建 SQLite 主庫；正式 P3 接線／真機仍須使用者明確確認整套 Web 滿意；隔離 Android 共用 UI 可按 [分工例外](AGENTS.md#frontend-backend) 提前實作，手機瀏覽器／單頁確認不能代替正式關口

<a id="s05-w03"></a>
#### S05-W03

- 階段／狀態：P3；未開始。
- 前置：S04-W01。

**目標、局部驗收及範圍界線：**Android 憑據安全保存、附件暫存／清理及退出／撤權處理；平台 adapter 不成為權威業務資料庫

<a id="s07-w01"></a>
#### S07-W01

- 階段／狀態：P3；未開始（Web 子範圍前移）。
- 前置：S05-W03、S07-W03、P2-A09。

**目標、局部驗收及範圍界線：**Android／跨端在線更新、並行修改、重連與附件狀態；沿 TanStack Query／RN focus／online adapter 與 opId，不建離線隊列。Web 同源、一致性及原操作恢復由 P2-A02／A07／A09 先交付，不重做。

<a id="s09-w03"></a>
#### S09-W03

- 階段／狀態：P3；未開始（Web 子範圍前移）。
- 前置：S07-W01。

**目標、局部驗收及範圍界線：**Android 跨端授權歷史與記憶接點；Web 新對話／歷史／記憶接續前移 P2-A02，不把清空業務庫當清模型快取。

<a id="s12-w01"></a>
#### S12-W01

- 階段／狀態：P3；未開始。
- 前置：S05-W03、S12-W03。

**目標、局部驗收及範圍界線：**粵語與 Android 相機／照片／便條，重用 Web 提取契約；數字單位確認，拒絕權限或失敗回表單

<a id="s13-w02"></a>
#### S13-W02

- 階段／狀態：P3；未開始。
- 前置：S07-W01、S13-W07。

**目標、局部驗收及範圍界線：**家庭交接與 FCM／原生通知 adapter；客戶端優先 Expo Notifications，Server 優先 Google Auth＋單次 FCM HTTP v1，依 [候選與限制](docs/TECH_REUSE.md#channels) 驗 native build／權限／token／unknown；業務排程仍在 Server，投遞／回應／完成分離及撤權有效

<a id="s16-w03"></a>
#### S16-W03

- 階段／狀態：P3；未開始。
- 前置：P3 全部功能包。

**目標、局部驗收及範圍界線：**雙端真機／在線一致性／家庭隔離／多模態／通知必要驗收；先批准高成本項，不能用 Web 代替真機

<a id="s17-w03"></a>
#### S17-W03

- 階段／狀態：P3；未開始。
- 前置：S16-W03。

**目標、局部驗收及範圍界線：**可安裝 APK、跨端 Web、家庭操作／權限／連線說明及真實證據

### P4 工作包

<a id="s06-w04"></a>
#### S06-W04

- 階段／狀態：P4；未開始。
- 前置：S17-W03。

**目標、局部驗收及範圍界線：**使用者選擇相容 Server API；確認地址、版本／能力及身份，憑據隔離，不自動把舊 Server 家庭資料送往新地址

<a id="s17-w05"></a>
#### S17-W05

- 階段／狀態：P4；未開始。
- 前置：S06-W04。

**目標、局部驗收及範圍界線：**Windows Docker Desktop／WSL2 前置檢查、Compose 設定與少步啟動 API／worker／PostgreSQL／pgvector；儲存持久化、私密配置、TLS 與操作限制說明；驗沒有 GCP 附加身份且關閉 AI 時仍可使用核心資料及確定性任務，Gemini／外部通知另驗，不宣稱離線模型

<a id="s08-w01"></a>
#### S08-W01

- 階段／狀態：P4；未開始。
- 前置：S06-W04。

**目標、局部驗收及範圍界線：**QR／短碼／已登入裝置確認、裝置撤權及臨時電腦會話；拒絕重放／過期，客戶端直接連 Server，不作手機資料中繼

<a id="s10-w03"></a>
#### S10-W03

- 階段／狀態：P4；未開始（必要維護前移）。
- 前置：S17-W03、S10-W02、P2-A04。

**目標、局部驗收及範圍界線：**沿 P2 RAG 擴充大型管理頁、大規模導入／批量重建管理、效能與通用遷移。官方 PDF、語義換版及必要發布維護前移 P2-A04；不另建向量／引用權威。

<a id="s12-w02"></a>
#### S12-W02

- 階段／狀態：P4；未開始。
- 前置：S17-W03、S12-W01、S12-W04。

**目標、局部驗收及範圍界線：**系統分享及其餘既定平台 adapter；來源／確認／權限與失敗行為完整

<a id="s07-w02"></a>
#### S07-W02

- 階段／狀態：P4；未開始（Web 必要項前移）。
- 前置：S08-W01、S07-W01、S12-W02。

**目標、局部驗收及範圍界線：**完整跨端故障矩陣、附件中斷及不同 Server 邊界；Web 必要重連／unknown 前移 P2-A02／A07／A09，原 S07 剩餘 AC 仍須結案。

<a id="s13-w03"></a>
#### S13-W03

- 階段／狀態：P4；未開始。
- 前置：S07-W02、S13-W02。

**目標、局部驗收及範圍界線：**Server 切換的任務／授權交接、唯一執行、舊執行者失效與必要審計；為正式遷移提供切換邊界

<a id="s14-w02"></a>
#### S14-W02

- 階段／狀態：P4；未開始（成長成果前移）。
- 前置：S10-W03、S12-W02、P2-A05。

**目標、局部驗收及範圍界線：**原生分享、雙端預覽及非核心分析；日常成長、完整季度／年度與同版 PDF 前移 P2-A05，來源／更正語義沿用。

<a id="s15-w01"></a>
#### S15-W01

- 階段／狀態：P4；未開始。
- 前置：S13-W03、S17-W05。

**目標、局部驗收及範圍界線：**Server 搬遷、資料／身份／附件／知識／任務完整性核對、確認後切換權威 Server；失敗不提早停用來源

<a id="s15-w02"></a>
#### S15-W02

- 階段／狀態：P4；未開始（GCP 必要恢復前移）。
- 前置：S15-W01、S14-W02、P2-A09。

**目標、局部驗收及範圍界線：**跨 Server 搬遷、通用備份／遷移及保留新寫入 rollback。GCP 配對加密備份／保留／空環境恢復前移 P2-A08／A09；不能恢復已撤權／終態工作。

<a id="s16-w04"></a>
#### S16-W04

- 階段／狀態：P4；未開始。
- 前置：P4 全部功能包。

**目標、局部驗收及範圍界線：**現行 AC 全量追溯及原條款替代核對；完整成本／快取／權限／過期／可用性驗收先按驗證制度批准

<a id="s17-w04"></a>
#### S17-W04

- 階段／狀態：P4；未開始。
- 前置：S16-W04。

**目標、局部驗收及範圍界線：**全部 APK／Web／源碼配置／Windows 部署／知識／遷移／許可／操作說明／證據交付，另一組員可重現

<a id="p5-future"></a>
### P5 以後升級版

只包含另行確認的非必要增值；不阻塞 P1～P4，不接收尚未完成的必要功能，不預建空框架。尚無獨立已確認的 P5 工作包。

<a id="p2-agent-roles"></a>
### P2 四角色 Agent：保留的後續接口目標（內部實作暫緩）

本節保留 2026-10-08 的四角色目標作接口與後續範圍對照；2026-10-09 已由 [ADR-021](docs/DECISIONS.md#adr-021) 收窄當前實作。下列角色內部、兩條四角色流程、6 次預算及 AC-P2M 全量門檻均屬暫緩目標，不是本輪 F01～F08 依賴；只有聊天與接口按 [當前入口](#active) 推進。原提案取代「文件生成 Agent」／聊天搜尋子模型式資料收集，但不授權現在開始內部實作。產品要求與四條 AC 見 [SPEC](SPEC.md#p2-agent-roles)，編排見 [架構](docs/ARCHITECTURE.md#p2-agent-roles)，決策見 [ADR-020](docs/DECISIONS.md#adr-020)。

#### 目標、現況與交付範圍

家長只面對同一育有方助手：自然交代、查證及辦事，必要時編製可保存／重用的資料，再看真實結果。不是每輪都運行四個 Agent，也不把所有普通操作改為生成文件。

| 角色 | 工作與邊界 |
|---|---|
| 聊天 | 理解口語及多輪指向、補問、檢索已發布知識／歷史、使用業務工具與按需委派，保持唯一對話入口 |
| 資料編製 | 整理需保存／重用、嚴格格式或專門風格的資料；包括準備內容、成長整理、照護說明、有用記憶／摘要與待辦草案，不限文件 |
| 審核 | 唯讀原始證據，核對實質回答／編製成果／知識更新的含義、引用、適用性與披露範圍；不能代家長同意或自行寫業務／發布 |
| 背景知識維護 | 獨立於聊天，在核准網站／路徑內自主讀目錄與連結、取得圖片／PDF 等新版、整理資料並經檢查後更新知識庫；沒有家庭私人資料權限 |

基線 `e6842fc` 已有單一 ADK 工具循環、引用身份／版本校驗、文件版本與局部修改、來源刷新／發布及文字 PDF 抽取；尚缺四角色委派、獨立語義審核、官方視覺資料理解與跨角色共同預算。已有能力與失敗／未驗證據保留，不把本文件當 runtime 已接通。

#### 暫緩的四角色流程與結果對照

- **互動：**家長交代 → 聊天查詢／操作 → 必要資料編製 → 審核 → 按授權保存或待確認 → 真收據回報／各頁同步。清楚的普通記錄、勾選、改期仍可直接走現有工具；不為確定性操作額外調模型。
- **知識維護：**排程或管理入口 → 背景讀取指定網站 → 整理／比較新版 → 審核與程式檢查 → 自動發布／更新／停用 → 供之後查詢。沒有聊天請求亦可運作；聊天搜尋直接用 KnowledgeRetriever，缺口只記待補，不擴大爬取或採信未核內容。
- **資料而非副本：**輸出依領域 schema 進原記憶／任務／文件服務；待辦是任務，網頁／卡片／PDF 是同版資料的呈現。既有成果局部修改保持 ID／版本／原 opId；草稿和正式成果分開，推測不升格事實，審核不代替重要操作確認；更正／撤權／失效同步影響衍生物。
- **審核：**重要含義以原始證據核對，不只驗引用 ID／hash。結果綁成果內容、來源版本、對象及範圍；改動須重新核對，未通過不正式保存或呈現。純澄清／確定性收據免額外模型，官方緊急求助內容可立即呈現；不宣稱零錯誤或臨床有效性。
- **自主維護：**指定網域／路徑／主題／使用範圍內，可有界跟進站內連結；原文、模型抽取與整理分開，圖片／PDF 保留原始頁面、版本與完整度。未變內容復用，長資料分批保存進度；檢查通過自動更新，含義不明／矛盾保留候選，抓取暫失不當失效。不得修改執行醫療／成長規則或把家庭／私人付費來源混公共庫。

#### 暫緩的預算、次序及驗收提案

以下保留原規劃，未啟用，不提高現行限額。互動的所有角色共用最多 **6 次生成**，包含委派、審核及修正；不是每角色 6 次。8 工具、2 次 query embedding、90 秒、每次輸出及上下文上限與每日配額不提高，本人更低上限仍有效。預留審核呼叫，餘額容許才最多一次修正／重核；耗盡保存進度，不新開 run 繞限。背景知識維護使用獨立有界工作／平台預算，不用家長私人 key；未變內容不重做模型整理。細節與目前配置分界見[運行配置](docs/ARCHITECTURE.md#p2-agent-budgets)。

原四角色交付構想（目前暫緩）：F01 契約 → F02 雲端切片 → F03 共用 runtime／聊天／審核 → F04 資料編製及 F05 知識維護 → F06 全背景 → F07／F08 成果／遷移驗收及交付。F05 增加 F03 前置，其餘依賴保留。主模型親寫契約及角色 prompt，沿既有 manifest 按需補模組，不複製四套 Prompt Pack，不重做前端。

四角色日後恢復實作才適用的驗收為 [AC-P2M-01～04](SPEC.md#ac-p2m-01)：模糊交代後有依據的可重用成果／新對話及跨頁讀回；指定項修改與版本／引用拒絕；無聊天時取得視覺來源新版、核對發布後可引用；範圍／私人隔離、重投遞及根預算控制。合併連貫情景並復用有效證據，不為四角色各跑整套 E2E；真服務／雲端沿各包批准成本邊界，不用 Computer Use。

2026-10-08 該次只有文件定案、連結／依賴／diff review，未修改程式或 Prompt Pack、未呼叫模型、部署或建立資源。現在的唯一實作入口是 [#active](#active)；#140 已收束，F02 實證及原 A09 聊天成果門檻仍保留。

<a id="steps"></a>
## 步驟範圍與結案

Sxx 是跨階段範圍；結案須其所有有效包及 AC 完成。此表只列範圍、完成條件與唯一正文入口，不另維護狀態或下一步。SQL／Better Auth／pgvector 名稱在此指既有實作，遷移路線見 F01～F08。

<a id="s00"></a>
### S00 文件遷移

- 範圍：固定基線、逐條映射、文件權威及執行入口
- 完成條件：M01–M09 全部通過；歷史基線可追溯
- 工作包：[S00-W01](#s00-w01)。

<a id="s01"></a>
### S01 開源復用核查

- 範圍：有界核查必要候選、固定版本與許可
- 完成條件：可核對的版本／許可／採用清單；未核實程式碼不進入交付
- 工作包：[S01-W01](#s01-w01)。

<a id="s02"></a>
### S02 最小共享工程

- 範圍：Expo Router／TypeScript、共享契約與必要配置
- 完成條件：Web 可啟動；只建立縱向流程使用的工程與邊界
- 工作包：[S02-W01](#s02-w01)。

<a id="s03"></a>
### S03 Web 最小縱向流程

- 範圍：登入後建立孩子、文字記錄及 Server 保存／顯示
- 完成條件：不依賴 AI；關閉重開並登入後資料可恢復；[保存驗收](SPEC.md#section-10-2)
- 工作包：[S03-W01](#s03-w01)。

<a id="s04"></a>
### S04 Android 同一縱向流程

- 範圍：重用 Server 與共享業務的在線 App、APK
- 完成條件：使用者真機完成同一流程；不以 Web 驗證代替真機
- 工作包：[S04-W01](#s04-w01)。

<a id="s05"></a>
### S05 記錄與資料保護

- 範圍：確認、更正、時間軸、搜尋、Server 加密／刪除／備份及平台安全保存
- 完成條件：原文、約數、時間、修訂與來源保留；備份還原可核對；[資料規則](docs/DATA_MODEL.md#section-5-1)
- 工作包：[S05-W01](#s05-w01)、[S05-W02](#s05-w02)、[S05-W03](#s05-w03)。

<a id="s06"></a>
### S06 Server 身份與資料

- 範圍：TypeScript、PostgreSQL、Better Auth、家庭權限及相容 Server 連線
- 完成條件：真實登入／持久化、跨家庭隔離、私人聊天邊界及 Server 選擇；[權限驗收](SPEC.md#section-10-5)
- 工作包：[S06-W03](#s06-w03)、[S06-W01](#s06-w01)、[S06-W02](#s06-w02)、[S06-W05](#s06-w05)、[S06-W04](#s06-w04)。

<a id="s07"></a>
### S07 在線更新與一致性

- 範圍：請求冪等、版本／衝突、跨端更新、附件狀態、刪除與撤權
- 完成條件：中斷／重試／並行操作不靜默丟資料，終態不復活；[一致性驗收](SPEC.md#section-10-2)
- 工作包：[S07-W03](#s07-w03)、[S07-W01](#s07-w01)、[S07-W02](#s07-w02)。

<a id="s08"></a>
### S08 裝置配對與臨時會話

- 範圍：QR／短碼、已登入裝置確認、臨時電腦、裝置管理及撤權
- 完成條件：拒絕過期／重放／未批准連線；裝置直接連 Server；[配對契約](docs/API.md#section-4-1)
- 工作包：[S08-W01](#s08-w01)。

<a id="s09"></a>
### S09 聊天與長期記憶

- 範圍：原始聊天、確認事實、摘要、話題與任務台帳
- 完成條件：新會話／換端／清空模型快取後從 Server 重建授權記憶；[記憶驗收](SPEC.md#section-10-3)
- 工作包：[S09-W01](#s09-w01)、[S09-W02](#s09-w02)、[S09-W03](#s09-w03)。

<a id="s10"></a>
### S10 知識與資訊更新

- 範圍：官方來源、pgvector／embedding、引用、版本、近期資訊、定期更新及管理擴充
- 完成條件：最小向量 RAG、穩定／近期隔離、發布／停用及 freshness 正確；[知識驗收](SPEC.md#section-10-4)／[向量驗收](SPEC.md#ac-p2-vector-rag)
- 工作包：[S10-W01](#s10-w01)、[S10-W02](#s10-w02)、[S10-W03](#s10-w03)。

<a id="s11"></a>
### S11 Gemini 與 Agent 編排

- 範圍：P1 文字聊天；P2 ADK 基礎、Prompt Pack 接線、結構化草稿／確認及互動／背景工具循環
- 完成條件：真實工具及結果回饋，模型不能繞過權限；配額及失敗可核對；[Agent 驗收](SPEC.md#ac-p2-agent-loop)
- 工作包：[S11-W01](#s11-w01)、[S11-W03](#s11-w03)、[S11-W02](#s11-w02)。

<a id="s12"></a>
### S12 照片、語音與分享輸入

- 範圍：Web 照片、主動分享、公開來源及 Android 語音／相機／系統分享
- 完成條件：來源可追溯；數字及不確定內容確認；拒絕權限與失敗明確；[輸入邊界](SPEC.md#section-1-5)
- 工作包：[S12-W03](#s12-w03)、[S12-W04](#s12-w04)、[S12-W01](#s12-w01)、[S12-W02](#s12-w02)。

<a id="s13"></a>
### S13 主動任務、聯絡與家庭交接

- 範圍：Server worker、任務／授權、成長階段關注、Web Push／Telegram／FCM、fallback 與交接
- 完成條件：唯一執行、撤權即停、終態不復活；發送／回應／完成分開；[任務驗收](SPEC.md#section-10-3)／[成長關注驗收](SPEC.md#ac-growth-attention)
- 工作包：[S13-W01](#s13-w01)、[S13-W04](#s13-w04)、[S13-W05](#s13-w05)、[S13-W06](#s13-w06)、[S13-W08](#s13-w08)、[S13-W07](#s13-w07)、[S13-W02](#s13-w02)、[S13-W03](#s13-w03)。

<a id="s14"></a>
### S14 摘要與報告

- 範圍：多孩子、到診準備、日／週摘要、趨勢及 PDF
- 完成條件：數字由程式計算，來源／版本可追溯，更正後產生新報告；[報告規則](SPEC.md#section-5-8)
- 工作包：[S14-W01](#s14-w01)、[S14-W02](#s14-w02)。

<a id="s15"></a>
### S15 Server 搬遷與災備

- 範圍：統一匯出、Server 搬遷、加密備份、空環境恢復與 rollback
- 完成條件：身份／資料／附件／知識／任務完整，切換單主，rollback 保留新寫入；[災備驗收](SPEC.md#section-10-6)
- 工作包：[S15-W01](#s15-w01)、[S15-W02](#s15-w02)。

<a id="s16"></a>
### S16 驗證與成本核對

- 範圍：相關功能、四年齡段、權限／故障／成本及可用性驗收
- 完成條件：全部有效 AC 有證據；高成本驗證先獲批准，缺驗收用待驗收；[驗證制度](#verification)
- 工作包：[S16-W01](#s16-w01)、[S16-W05](#s16-w05)、[S16-W02](#s16-w02)、[S16-W03](#s16-w03)、[S16-W04](#s16-w04)。

<a id="s17"></a>
### S17 交付與接續能力

- 範圍：Web／APK、Windows 部署、源碼配置、操作及接續資料
- 完成條件：另一位組員可依說明使用並重現；[交付驗收](SPEC.md#section-10-8)
- 工作包：[S17-W01](#s17-w01)、[S17-W02](#s17-w02)、[S17-W03](#s17-w03)、[S17-W05](#s17-w05)、[S17-W04](#s17-w04)。



<a id="roadmap-packages"></a>
### 工作包、階段與依賴

前置原則上指已驗收並合併的工作包；既有 P2 隔離分支依[收束安排](#p2-deferred-acceptance) 完成必要驗收及合併，不再新增延後驗收的接續例外。S16 的「本階段全部功能包」按該次結案範圍固定：S16-W02 只涵蓋原 P2 功能包，不包括 S06-W05、INT 或 P2-A01～A09 等後續增補，避免把已結案 S17-W02 反向接回新包。未結案階段包括其所有功能包（P4 包含 S17-W05），不包括該階段 S16 驗收包及 S17-W01／W02／W03／W04 結案交付包。父 Sxx 的有效 AC 與局部驗收共同適用。

新增驗收包括 [Server／授權外發 AC](SPEC.md#ac-server-agent)、[freshness AC](SPEC.md#ac-knowledge-freshness)、[P2 知識 AC](SPEC.md#ac-p2-knowledge)、[成長關注 AC](SPEC.md#ac-growth-attention)、[ADK／完整流程 AC](SPEC.md#ac-p2-agent-loop)及[最小向量 RAG AC](SPEC.md#ac-p2-vector-rag)，隨所屬功能包驗收；原 AC 的修訂按 [替代索引](docs/DECISIONS.md#adr-008-replacements) 追溯。

通用能力先復用現有程式／Skill，再核對同版本 Google／Expo 原生能力及必要成熟候選；[選型與驗證閘](docs/TECH_REUSE.md#decisions) 按包使用，文件相容不代表已實測。已完成 P1／P2 成果不為換框架返工。前端聊天／主聊天的責任及共享修改次序依 [AGENTS](AGENTS.md#frontend-backend)，混合工作包須兩邊交付並完成相關整合驗收才結案。


- [原 P2](#p2-delivered)／[INT](#production-integration)／[P2-A](#p2-agent-service)／[P2-F](#p2-firestore-migration)。
- [P3／P4](#later-phases)；P1 的完整正文見下方。



### P1 基礎工作包（已交付）

P1 驗收於 2026-09-23 通過；本次結案隨 [PR #23](https://github.com/2NTTY/child-ai-caregiver/pull/23) 合併生效。證據見 [EV-S17-W01](artifacts/verification/S17_W01_CHECKS.json)；不代表跨階段 Sxx 或 P2–P4 已完成。

<a id="vertical-slice"></a>
#### 最小縱向流程與依賴

S03：登入 → 建立孩子 → 輸入文字記錄 → Server 保存／顯示 → 關閉重開並登入 → 仍可讀取。S04 在 P3 Android 真機完成同一流程。

S03 依賴最小 Server 身份及資料能力，不依賴 Gemini、家庭邀請、配對、知識或通知。P1 預設順序：**S01-W01 → S02-W01 → S06-W03 → S03-W01 → S06-W01 → S09-W01 → S11-W01 → S05-W01 → S16-W01 → S17-W01**。加密／備份排在最早可玩流程之後，但仍是 P1 完成前置；不能以清空既有資料代替升級。

<a id="s01-w01"></a>
#### S01-W01

- 階段／狀態：P1；已完成。
- 前置：S00、DOC-R02 文件規範合併。

**目標、局部驗收及範圍界線：**有界核查 coo 與當前流程必要候選，固定版本／許可／實際復用結論；不能核實就不採用，不無限除錯舊專案

<a id="s02-w01"></a>
#### S02-W01

- 階段／狀態：P1；已完成。
- 前置：S01-W01。

**目標、局部驗收及範圍界線：**最小 Expo／TypeScript Web 工程、共享契約／驗證與可配置入口；必要檢查可執行，不建通用平台

<a id="s06-w03"></a>
#### S06-W03

- 階段／狀態：P1；已完成。
- 前置：S02-W01。

**目標、局部驗收及範圍界線：**最小 Server／PostgreSQL／Better Auth 登入與帳號／資料空間隔離；Server 重啟後資料仍在、未授權請求拒絕；不含家庭邀請

<a id="s03-w01"></a>
#### S03-W01

- 階段／狀態：P1；已完成。
- 前置：S06-W03。

**目標、局部驗收及範圍界線：**Web 登入、孩子／文字記錄及 Server 保存／顯示；關閉重開後登入可恢復；斷線保留當前表單，不假稱保存

<a id="s06-w01"></a>
#### S06-W01

- 階段／狀態：P1；已完成。
- 前置：S03-W01。

**目標、局部驗收及範圍界線：**安全 AI API／部署配置；供應商憑據只在 Server，從首次請求套用權限、配額、有限重試／總開關及無正文日誌

<a id="s09-w01"></a>
#### S09-W01

- 階段／狀態：P1；已完成。
- 前置：S03-W01。

**目標、局部驗收及範圍界線：**原始聊天與孩子／作者關聯保存於 Server，授權後可恢復；不提前建立全部長期記憶

<a id="s11-w01"></a>
#### S11-W01

- 階段／狀態：P1；已完成。
- 前置：S06-W01、S09-W01。

**目標、局部驗收及範圍界線：**真 Gemini、簡單 prompt、相關孩子／近期聊天及調用統計；失敗保留當前輸入，先以合成資料玩通

<a id="s05-w01"></a>
#### S05-W01

- 階段／狀態：P1；已完成。
- 前置：S11-W01。

**目標、局部驗收及範圍界線：**Server 儲存加密／密鑰保護、必要刪除、最小加密備份／還原；既有記錄聊天可接續，不以清空資料代替升級

<a id="s16-w01"></a>
#### S16-W01

- 階段／狀態：P1；已完成。
- 前置：P1 全部功能包。

**目標、局部驗收及範圍界線：**核心流程、持久化、斷線／AI 失敗、憑據／日誌與備份還原的必要驗收；實際模型及服務驗證先取得批准

<a id="s17-w01"></a>
#### S17-W01

- 階段／狀態：P1；已完成。
- 前置：S16-W01。

**目標、局部驗收及範圍界線：**交付組員可開啟的 Web URL、操作說明及證據；另一位組員獨立試玩通過才算 P1 完成


<a id="document-packages"></a>
## 文件工作包

2026-10-11 本次根 PLAN 重排是獨立文件交付：保留全部舊工作包 ID、前置、有效 REQ／AC、140 個顯式錨點及原標題入口；內容按既有職責歸位，不改產品碼或原容量候選。驗收為文件結構／連結／內容去向／依賴及一次獨立只讀核查；證據見 [重排核查](artifacts/verification/PLAN_RESTRUCTURE_20261011.json)／[LOG](WORKLOG.md#log-20261011-plan-restructure)。本次不重編 DOC-R01～R04，也不把文件整理當產品 gate 通過。

<a id="doc-r01"></a>
### DOC-R01 — 五階段文件重排及歸檔

- 狀態：已完成。
- 驗收：五階段／依賴、原錨點及當時有效 AC 保留；歸檔原文／唯一 JSON、WORKLOG 舊前綴及連結核對。
- 證據：[LOG-20260920-007](WORKLOG.md#log-20260920-007)／[EV-DOC-R01](artifacts/verification/DOC_R01_CHECKS.json)。證据適用當時版本；後續替代依 ADR 追溯。

<a id="doc-r02"></a>
### DOC-R02 — Server 路線與專案代理規則修訂

- 狀態：已完成。
- 前置：DOC-R01 文件基線。
- 範圍：五階段／工作包、Server 契約、規則／專案配置及必要狀態與追加記錄；不含產品實作。
- 驗收：現行要求與替代關係一致、舊錨點可追溯、依賴無循環、WORKLOG 舊前綴及歷史資料未改、專案配置可解析與當前 Codex 識別；角色限額與硬配置明確區分。
- 證據：[LOG-20260922-001](WORKLOG.md#log-20260922-001)／[EV-DOC-R02](artifacts/verification/DOC_R02_CHECKS.json)。

<a id="doc-r03"></a>
### DOC-R03 — P1–P4 技術復用與前後端分工

以下保留當時結案範圍；其中「下一包／Android 次序」不是現行指令，現行分工見 [AGENTS](AGENTS.md#frontend-backend)。

- 狀態：已完成；文件驗收通過，交付隨本包 PR review／合併生效。
- 基線：master `80cf50c`；保留已完成工作包及六份技術 Skill 的有效成果。
- 範圍：有界復用規則、原生能力／候選證據、工作包採用閘、提前 S16-W05 及前後端交接；不改產品程式、依賴、部署或既有驗收結果。
- 驗收：文件連結／錨點、工作包依賴、候選與實測分類、歷史 WORKLOG 前綴及 STATUS 位元組保留。使用者明確要求本包不改 STATUS，完成記錄只在本節及追加 WORKLOG。
- 證據：[選型核查](docs/TECH_REUSE.md)／[ADR-012](docs/DECISIONS.md#adr-012)／[LOG-20260926-001](WORKLOG.md#log-20260926-001)。新功能包仍未開始，下一後端功能包仍為 S13-W01。
- 前端交接補充：與「檢查育伴港前端現況」最新計劃對齊，採隔離 Web 預覽／主聊天正式整合及整套 Web 確認後才開 Android；[LOG-20260926-002](WORKLOG.md#log-20260926-002)。前端目錄及 FE-W01 尚未實作，不更改原產品包完成狀態。

<a id="doc-r04"></a>
### DOC-R04 — 文件職責及閱讀路徑收斂

- 狀態：已完成；2026-10-04 使用者確認合併，隨 [PR #86](https://github.com/2NTTY/child-ai-caregiver/pull/86) 合併生效。
- 成果／基線：從 master `c51dd52` 收斂根／前端閱讀入口、文件職責、過時 metadata 及歷史索引；附件按現行資料取捨，保留前端獨立進度、固定歷史原文及證據。沒有業務程式、API 語義、UI 或部署改動。
- 驗收：[EV-DOC-R04](artifacts/verification/DOC_R04_CHECKS.json)／[LOG](WORKLOG.md#log-20261004-001)。引用／錨點、TOML、歷史內容及接手入口已核對；追加 STATUS 更新／清理規則已靜態核對。官方 Skill validator 缺 PyYAML，替代檢查及未驗限制照實保留；沒有產品測試或 runtime／token 節省量測。
- 後續整合限制：#84／#85 的新內容及各自驗收由原包處理；整合時保留其新增內容，不整檔覆蓋。本包不操作其源分支或啟動正式接線。

<a id="s00-w01"></a>
### S00-W01 — 完整文档迁移

- 状态：已完成。
- 目标：原样保留磁盘完整基线及四份旧材料，完成职责拆分、逐条映射与执行制度。
- 关联验收：AC-S00-M01 至 AC-S00-M09（下表稳定锚点）。
- 验证：完整覆盖／原文保留、哈希、链接锚点、状态、单一权威、Luna 只读獨立核查。
- 完成证据：[LOG-20260920-002](WORKLOG.md#log-20260920-002)、[EV-001](artifacts/verification/S00_CHECKS.json)、[EV-002](artifacts/verification/S00_AUDIT.md)。

| 子步骤／验收 ID | 状态 | 工作 | 验收条件 |
|---|---|---|---|
| <a id="ac-s00-m01"></a>M01 / AC-S00-M01 | 已完成 | 固定已有磁盘基线，登记五份原文件版本与校验值 | 原文可回看、来源明确、五文件哈希未变，没有摘要重建 |
| <a id="ac-s00-m02"></a>M02 / AC-S00-M02 | 已完成 | 逐段、逐列表项、逐表格行清点 | 有效设计、验收与结构信息全部可定位，冲突有依据 |
| <a id="ac-s00-m03"></a>M03 / AC-S00-M03 | 已完成 | 文档权威职责、稳定编号 | 每类信息有唯一维护位置，引用可解析 |
| <a id="ac-s00-m04"></a>M04 / AC-S00-M04 | 已完成 | 完整内容搬迁 | 正文有实质规则，不是只有标题／链接／TODO；已有未定细节明确保留 |
| <a id="ac-s00-m05"></a>M05 / AC-S00-M05 | 已完成 | 建立执行入口 | PLAN 全步骤、短 AGENTS／STATUS、append-only WORKLOG、诚实 README，产品步骤未假完成 |
| <a id="ac-s00-m06"></a>M06 / AC-S00-M06 | 已完成 | 完成逐条映射 | 有效条款无遗漏；复合条款各部分有落点；所有 AC 保留；unresolved 不隐瞒 |
| <a id="ac-s00-m07"></a>M07 / AC-S00-M07 | 已完成 | 一致性与结构检查 | 无断链、重复锚点、错误状态、竞争权威、虚假运行命令 |
| <a id="ac-s00-m08"></a>M08 / AC-S00-M08 | 已完成 | Luna 獨立只读核查，主模型处理 | 发现项有解决记录、复核通過；子代理无文件修改 |
| <a id="ac-s00-m09"></a>M09 / AC-S00-M09 | 已完成 | 冻结迁移結果和交接 | 记录完整，PLAN 与 STATUS 一致；歷史遷移範圍結案，不代表產品功能完成 |

<a id="states"></a>
## 状态

步骤和工作包仅使用下列五种状态。实现与证据层级不是额外状态。

| 状态 | 含义 |
|---|---|
| 未開始 | 尚未開始該步驟／工作包；已有研究只是輸入 |
| 進行中 | 正在實施，或驗證失敗後繼續修復；跨階段 Sxx 部分包完成亦屬此狀態 |
| 受阻 | 缺少必要条件导致无法推进；记录原因、所缺条件及解除方法 |
| 待驗收 | 实现准备完成，但必需测试或人工确认尚未完成 |
| 已完成 | 实现、全部必需验证和记录均完成 |

<a id="verification"></a>
## 验证与证据层级

| 用语 | 含义 | 依据 |
|---|---|---|
| 已确认 | 设计或需求确定 | SPEC／ADR／用户决定 |
| 已实现 | 代码确实存在 | 文件与修改版本；文档迁移只能说明文档已写入 |
| 已验证 | 指定场景实际通過 | 命令或人工步骤、环境／版本、結果与证据 |
| 已完成 | 实现、全部必需验证和记录齐备 | 本步驟必要驗收及證據齊備；按文件職責更新受影響位置 |

驗證範圍、成本、批准與失敗停批統一依 [AGENTS 驗證與收尾](AGENTS.md#finish)。此處只定義證據層級及下列既有分支例外，不複製另一份測試規則。

<a id="historical-entry"></a>
## 歷史及相容入口

整理前完整原文、Git 版本與 SHA-256 見 [固定快照索引](_archive/README.md#plan-20261011)。當時的未完成、下一步、批准及分工不因保留而成為現行指令。

<a id="current-capability-gaps"></a>
### 新前端能力差距（2026-10-07 源碼核對）

`0a39e018` 的七項完整差距快照保留於[固定原文](https://github.com/2NTTY/child-ai-caregiver/blob/a38e03f3c48bbb9e879254248313c11f5bab5e63/PLAN.md#current-capability-gaps)。A02～A07 後續已合併；真引用、同文件修改、新對話讀回及正式服務仍由 [F07](#p2-f07)／[F08](#p2-f08) 承接，不能把舊快照再次當未開始清單。前端原深連結保留此入口。

<a id="team-package-allocation"></a>
### 四人工作包責任預分配

人員責任、歷史預分配、權重／份額及署名操作已歸既有本機協作文件；只在分配／署名／交付時按 [AGENTS 本機協作指引](AGENTS.md#team-contributions) 讀取，不納入 Git。沒有重算或改寫歷史貢獻。

<a id="extension-boundaries"></a>
### 共享邊界與漸進實作

原 P2 接續的版本／分支／驗收批准保留於[固定歷史原文](https://github.com/2NTTY/child-ai-caregiver/blob/a38e03f3c48bbb9e879254248313c11f5bab5e63/PLAN.md#extension-boundaries)，不是新的待辦。DataStore／ModelGateway／AgentRuntime／AttachmentStore／KnowledgeRetriever／TaskExecutor／NotificationGateway 及 SyncEngine 的職責由 [API](docs/API.md#section-3-3) 維護；共享 TypeScript／薄 adapter／Server 權威依 [架構](docs/ARCHITECTURE.md#section-3-1)，執行範圍依 [AGENTS](AGENTS.md#scope)。

<a id="packages"></a>
### 工作包与有限并行

工作包範圍、前置合併、Git、模型與並行、前後端修改歸屬統一依 [AGENTS](AGENTS.md#scope)／[Git 工作流](AGENTS.md#git-workflow)／[模型分工](AGENTS.md#models)／[前後端分工](AGENTS.md#frontend-backend)。預覽不當正式接線；S16-W05 的共用基礎由 S16-W03／W04 延續，不延後各功能包必要驗收。

工作包记录格式：

```text
工作包 ID：Sxx-Wxx
所属步骤：
階段／前置工作包：
狀態：未開始 / 進行中 / 受阻 / 待驗收 / 已完成（選一）
目标：
关联 REQ／AC：
修改范围：
前後端交付／共享契約與修改歸屬（適用時）：
復用結論／必要候選及未驗證項（一句或引用既有研究即可）：
範圍外：
验证方法：
完成证据：
```

<a id="section-7-reuse"></a>
### 技術與開源復用原則

<a id="rule-7-reuse-01"></a>
<a id="rule-7-reuse-07"></a>
執行及許可／歸屬保留規則見 [AGENTS 技術研究](AGENTS.md#technical-skills)；家庭授權、任務終態、外發去重與安全由項目掌管，採用見 [TECH_REUSE](docs/TECH_REUSE.md#decisions)。

<a id="rule-7-reuse-02"></a>
<a id="rule-7-reuse-03"></a>
<a id="rule-7-reuse-04"></a>
<a id="rule-7-reuse-05"></a>
<a id="rule-7-reuse-06"></a>
S01 的 coo-ai-agent、Baby Buddy、CareLoop、BreastfeedingTracker、UNICEF Bebbo 研究用途與不採用／參考邊界保留於[固定原文](https://github.com/2NTTY/child-ai-caregiver/blob/a38e03f3c48bbb9e879254248313c11f5bab5e63/PLAN.md#section-7-reuse)及[研究歷史索引](_archive/README.md)；不是新的預設首查或產品底座。已完成成果不為換框架返工。

<a id="p2-deferred-acceptance"></a>
### 按包驗收與既有 P2 隔離分支收束

2026-09-28 的集中驗收安排、2026-09-30 恢復按包驗收及既有分支收束方式是歷史；原二十包已結案。固定前置、未驗項及原證據仍按各包保留，不必重建成果，不得用歷史例外開新的未驗依賴包。原主聊天 `01a0c876-a538-7a51-8b99-648131cc56f4` 的免逐次詢問只限該聊天及原操作／成本，不延伸本聊天、部署、續期或新資源。

完整歷史條款與當時批准見[固定原文](https://github.com/2NTTY/child-ai-caregiver/blob/a38e03f3c48bbb9e879254248313c11f5bab5e63/PLAN.md#p2-deferred-acceptance)；現行批准、失敗停批、必要驗收／合併及真機反饋依 [AGENTS](AGENTS.md#finish)。程式準備好不等於完成，真機欠驗用待驗收；必要環境缺失且無法繼續用受阻。

<a id="maintenance"></a>
### 计划与规范维护

文件職責、更新及凍結／歷史追溯只依 [AGENTS 文件更新邊界](AGENTS.md#document-updates)。保留穩定 REQ／AC／S／工作包／ADR／LOG／EV／SRC 與舊錨點；替代關係見 [ADR-001](docs/DECISIONS.md#adr-001)／[ADR-005](docs/DECISIONS.md#adr-005)／[ADR-008](docs/DECISIONS.md#adr-008)／[ADR-009](docs/DECISIONS.md#adr-009)，回查歷史先讀 [_archive 索引](_archive/README.md)。


### P2 原責任預分配（歷史；狀態以上表為準）

保留原標題供舊深連結使用；此標題的「上表」指整理前歷史表，不是目前任務清單。原分配已歸既有本機協作文件，讀取條件見 [AGENTS](AGENTS.md#team-contributions)，不代表新的分工或份額。
