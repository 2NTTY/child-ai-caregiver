# 决策与替代依据

只记录为什么、来源与影响；当前行为和实现全文分别在 [SPEC](../SPEC.md)、[ARCHITECTURE](ARCHITECTURE.md)、[DATA_MODEL](DATA_MODEL.md)、[API](API.md)。本文的历史原文不形成另一份现行规范。

現行入口：[ADR-008](#adr-008) 記錄 Server 權威架構、五階段局部修訂及原 REQ／AC 替代索引；[ADR-009](#adr-009) 記錄工作上下文、測試及最新子代理政策。現行全文仍由以上權威文件及 [AGENTS](../AGENTS.md)／[PLAN](../PLAN.md) 維護。

ADR-001 至 ADR-007 保留當時歷史；其中「本輪」「不得移動」「通過即停止」及 ADR-005／007 的本地架構、原 AC 不改等表述，不覆蓋 ADR-008／009 已明列的修訂。未被替代的歸檔、來源治理及按需領域解耦原則繼續適用。

<a id="adr-001"></a>
## ADR-001 — 文档拆分与磁盘基线冻结

- 状态：已确认；依据：用户本次明确授权 S00 及此前《长期开发文档体系与实施前迁移计划》。
- 基线：磁盘 [DEVELOPMENT_PLAN.md](../DEVELOPMENT_PLAN.md) v1.0（2026-09-20），SHA-256 见 [迁移清单](MIGRATION_MAP.md#baseline)。绝不根据聊天摘要重建。
- 原文件第 5 行“主计划”及逐章更新约定、第 8.1／8.3／8.6 的单文档组织由新职责分工替代；完整十章原文继续保留，已确认产品和架构不变。
- 当前规范的单一权威登记在 [README](../README.md#authority)；原 PROJECT_STATE.md 职责由 STATUS.md 接替，不创建／维护第二份状态文件。启动／测试方法放 README，AGENTS 只保留执行约定。
- DEVELOPMENT_PLAN 冻结后不继续同步修改。新需求只改其权威文件并记录原因、影响、替代条款和验证。
- 基线第 7 行“目前仍是四份文档”是旧状态描述，原样历史保留；不是本轮文件数量或实现完成情况。当前状态只由 PLAN／STATUS 表达。

<a id="adr-002"></a>
## ADR-002 — 旧资料的历史身份与有效资产

依据 v1.0 和用户后续确认，以下旧结论已替代；S00 **不修改、删除或移动**四份旧材料，在本登记处明确其效力。

| 旧位置 | 已替代的建议 | 当前权威入口 |
|---|---|---|
| PROJECT_PROPOSAL §1、§4 | 0–12 个月首版、0–10 岁远期路线 | [SPEC 产品形态](../SPEC.md#section-1-2)：0–10 岁四段覆盖；旧婴儿场景可作合成案例 |
| PROJECT_PROPOSAL §13；PITCH_AND_DEMO §5 | 六周开发排期 | [PLAN](../PLAN.md#steps)：按步骤与验收推进 |
| PROJECT_PROPOSAL §12–13；OPEN_SOURCE_REUSE §1、§5、§8 | Baby Buddy 优先作为底座、原生 App 才切 Expo | [既定共享架构](ARCHITECTURE.md#section-3-1)；研究候选尚未采用 |
| 旧参考项目中的 AWS／Twilio／短信实现 | 参考实现不成为产品选型 | [AI 与通知](ARCHITECTURE.md#section-3-6)；[Instagram 边界](../SPEC.md#section-1-5) |
| DEVELOPMENT_PLAN §8.2 的“追加实际复用决定” | 在研究文档另维护现行采用决定 | 实际选择的依据记录于本文件；研究材料保留调查用途和来源 |

下列有效资产原文保留并可直接访问，不能当作已实现或已验证：

- [PROJECT_PROPOSAL](../PROJECT_PROPOSAL.md)：§2 问题与验证假设、§3 香港服务／竞品、§6 功能研究、§9 官方来源治理、§10 报告、§11 安全隐私、§17 历史交付状态。
- [OPEN_SOURCE_REUSE](../OPEN_SOURCE_REUSE.md)：§1 候选与许可、§2 Baby Buddy 限制、§3 缺口、§6 复制与许可义务、§7 AI 开发成本、§8 旧里程碑；保留仓库及许可链接，不把候选清单当采用清单。
- [PITCH_AND_DEMO](../PITCH_AND_DEMO.md)：§2 开场稿、§3 四分钟剧本、§4 核心画面、§5 简报、§6 问答、§7 事实核对；合成、模拟和演示备份须继续如实标注。
- [WEEKLY_LOGS](../WEEKLY_LOGS.md)：§1 AI 与个人归属、§2 周报流程、§3 证据、§8 导师跟进、§9 可登记的旧状态、§10 提示词；只是模板，实际发生记录由 [WORKLOG](../WORKLOG.md) 提供。

<a id="adr-003"></a>
## ADR-003 — 提前持久化纵向流程，保持完整范围

依据用户已确认迁移方案，v1.0 §7 的 16 个大步骤调整为 [S00–S17](../PLAN.md#steps)。共享工程、三种存储、身份和多模态被拆成可独立验收步骤，使 Web／Android 重启后读取尽早验证；全部原工作和验收通过 [逐条映射](MIGRATION_MAP.md) 保留。

S03 无须等待账号、云数据库、AI、向量、配对或通知；这是实施顺序调整，不是移除这些最终功能。有限并行规则以 [PLAN 工作包](../PLAN.md#packages) 为准。本轮授权仅 S00，通过即停止。

<a id="adr-004"></a>
## ADR-004 — 模型、额度、人工操作与证据制度

依据用户已确认迁移方案，开发模型／额度唯一规则进入 [AGENTS](../AGENTS.md#models)，验证层级进入 [PLAN](../PLAN.md#verification)，事实记录进入 [WORKLOG](../WORKLOG.md#template)。余额以用户报告为准，旧计划“可取得真实用量”不能解释为授权主动查询。

默认关闭 Computer Use，简单 GUI／真机步骤由用户执行，机器检查由 Codex 执行；Luna 仅只读。此选择限制非必要开销，不把核心实现交给低能力模型。模型策略不等于已经更改实际会话配置。

<a id="deferred"></a>
## 原计划未确定、留待相应步骤细化的内容

以下實施細節仍未確定，不是遷移條款缺失；上層約束已保留。S00 unresolved 為當時凍結結論，追溯須先經[歸檔索引](../_archive/README.md)，不向歷史 MIGRATION_MAP 追加新問題。往後未決細節記在本表／新增 ADR，不能冒充已實現。

| 编号 | 尚待确定 | 负责步骤与当前约束 |
|---|---|---|
| <a id="d-api-001"></a>D-API-001 | HTTP 路徑、封裝、錯誤碼、裝置憑據編碼、批量／相容協商 | P1 S06-W03 身份／Server API，S06-W01／S11-W01 最小 AI proxy；P2 S06-W02 家庭權限、S07-W03 線上一致性；P3 S07-W01 跨端；P4 S06-W04 自選相容 Server、S08-W01 裝置授權及 S07-W02 故障；[API 契約](API.md#errors-compatibility)按 ADR-008 現行語義落實 |
| D-DATA-001 | 具體 schema、欄位類型、索引和物理約束 | S06-W03 先建立 PostgreSQL 權威儲存，再按 S03–S15 實際物件漸進建立；[DATA_MODEL](DATA_MODEL.md) 不變量先行，不建 SQLite／IndexedDB 業務主庫或離線 outbox |
| D-SEC-001 | P1 正文 AES-256-GCM／獨立加密備份已實作、待驗收；後續密鑰輪替及完整災備仍按階段細化 | P1 S05-W01 的 [實作範圍](ARCHITECTURE.md#p1-storage-protection)及[操作](P1_STORAGE.md)須通過本機驗收才合併；P3 S05-W03 處理在線客戶端附件邊界；P4 S15-W01／W02 落實 Server 搬遷／災備，S17-W05 交付 Windows 部署；[加密要求](ARCHITECTURE.md#section-3-2)不降低 |
| D-REUSE-001 | 首輪有界核查已完成；後續新增／升級依賴各包核對 | [ADR-REUSE-P1](#adr-reuse-p1)／[S01 固定版本及許可證據](REUSE_AUDIT.md)；候選不當作已安裝或已交付 |
| D-PLATFORM-001 | 實際模型、平台權限、RSS／來源讀取及後台行為驗證 | S06-W01／S11-W01 先核實 Gemini；S10-W02 核實來源與更新；S04／S08／S12／S13 核實平台行為；不把來源入口研究當產品通過 |

<a id="adr-005"></a>
## ADR-005 — 五階段與可獨立驗收工作包

- 日期／狀態：2026-09-20，已確認；依據：使用者在本任務確認方案及三項收斂修訂，最後授權「開始執行」。本次只執行文件重排及歸檔。
- 原因：舊 S00→S17 直線順序把 Android／雲端／同步／配對放在 Gemini 之前，過早消耗非比賽核心工作的開發資源。
- 決定：[PLAN 五階段](../PLAN.md#phases)是目前路線；P2 是比賽必達，P4 保留完整 SPEC，P5 只收新增非必要項。Sxx 是穩定範圍標識，依賴／分支／review／合併以工作包為單位。
- P1 先以合成資料完成 Web 持久化＋真 Gemini，再完成加密／最小備份及整階段驗收；首次呼叫起保護憑據及日誌。試玩網址是 P1 完成時的要求，沒有聲稱目前已存在。
- 替代：ADR-003 及舊 PLAN 的數字直線次序、AGENTS「整個 Sxx 一個分支」慣例；原 S03 不依賴 AI 的獨立驗收、所有原需求及 AC 保留。
- 驗證：工作包依賴／範圍映射及原 AC 保留檢查；產品包全部仍未開始，詳細執行以 [PLAN](../PLAN.md#roadmap-packages) 為準。

<a id="adr-006"></a>
## ADR-006 — 實體歸檔、原位證據與不可改寫的歷史

- 日期／狀態：2026-09-20，已確認；依據：使用者選擇 `_archive/`、舊路徑相容入口，並再次要求 WORKLOG 嚴格 append-only 及避免 JSON 重複。
- 決定：完整舊 Markdown 及 S00 映射／審計移入 `_archive/`，凍結原文不改；舊路徑用短指向頁及必要錨點承接。兩份 S00 JSON 原位唯一保存，登記為 archived-in-place，不搬後再複製；OPEN_SOURCE_REUSE 留作 S01 按需輸入。
- WORKLOG 的既有正文、連結、格式與空白均不改；只追加記錄。歸檔檔案保留來源 commit／SHA，歷史相對路徑按當時快照解讀，現行導航由索引及相容頁提供。
- 凍結資料以範圍限定的 `.gitattributes` 關閉 Git 文字換行轉換，避免現有 `core.autocrlf=true` 在日後 checkout 改變原文雜湊；不改 WORKLOG 的既有換行。
- 長期維護：任何文件移入 `_archive/` 或改為 archived-in-place，必須同包更新[索引](../_archive/README.md)；日常不直接掃描，追溯時先索引再指定資料。狀態、閱讀觸發條件及資料清單不另複製在本 ADR。
- 替代：ADR-002 的「S00 不移動」是歷史限制，本次已有新授權；不刪歷史證據及有效需求，不建立符號連結／轉址服務或多份 JSON。
- 驗證：WORKLOG 位元組前綴、凍結檔案雜湊、JSON 唯一位置、索引覆蓋、舊入口與新連結；舊 EV-001／EV-002 不改寫成此次結果。

<a id="adr-007"></a>
## ADR-007 — 有界資訊更新與按需領域解耦

- 日期／狀態：2026-09-20，已確認；依據：使用者選擇 P2 最小自動更新、穩定知識每周／近期資訊每日、官方加指定權威媒體；領域替換只作寫程式時的原則。
- 決定：[SPEC 更新及 freshness](../SPEC.md#knowledge-freshness)區分穩定指引與短時效資訊；共用薄抓取／引用能力，不因官方身分把所有公告當穩定指引。公共更新排程不改變家庭資料存放位置或本地家庭任務執行邊界。
- 來源研究：2026-09-20 已透過一手頁面確認 [CHP RSS](https://www.chp.gov.hk/tc/static/24063.html) 及 [RTHK 本地 RSS 入口](https://news.rthk.hk/rthk/ch/rss.feed)；只有入口核查，未驗證產品解析、定時器或來源可用性保證。初期不用付費新聞 API、媒體評分或複雜跨來源分析。
- 輕量解耦：維持共享 TypeScript 業務與薄平台 adapter；寫到功能時集中 prompt／知識來源／受限 skills 流程／領域規則。未來可來源碼替換重建，不另開解耦包、不建通用資料模型／插件平台／第二主題。
- 範圍：新增 freshness 要求及 AC，不修改原 55 AC；原 pgvector／知識管理及全部完整版功能仍在 P4。介面與欄位由 [API](API.md#section-3-3)／[DATA_MODEL](DATA_MODEL.md#section-5-6) 維護。
- 驗證：S10-W02 及 S16-W02 測更新有變／無變、失敗／過期／日期、來源停用與分類隔離；S10-W03 完成全面知識管理。

<a id="template"></a>
## 后续 ADR 模板

编号／日期；状态（已确认或未决）；问题；决定与权威条款链接；依据；考虑过的替代；影响范围；被替代 ADR／条款；验证或实施步骤。不要把未決草案写成当前架构。

<a id="adr-008"></a>
## ADR-008 — Server 唯一權威與五階段局部修訂

- 日期／狀態：2026-09-22，已確認；依據：使用者本輪確認的 Server 架構及五階段調整，於 DOC-R02 落盤；只修改文件與專案開發設定，不啟動產品實現。
- 原因：手機／瀏覽器主庫、離線 outbox 及手機中繼增加三種儲存、任務交接與同步的複雜度，也無法承擔 P2 關閉瀏覽器後持續執行的主動照顧流程。
- 決定：Server 是唯一業務資料權威及 Agent 執行端，PostgreSQL 持久儲存；Web／Android 是同一服務的在線客戶端。正式替代手機／瀏覽器業務主庫、SQLite／IndexedDB 業務持久化、離線 outbox、自動離線重放及手機 WSS 資料中繼。斷線只在當前頁面保留未提交表單／照片，明確標示未保存並由使用者手動重試；重新整理／關閉前提示可能丟失，不承諾跨關閉草稿恢復。Server 確認前不得顯示保存成功。
- 邊界：只實現育伴港，共享 TypeScript 業務與薄平台 adapter，必要 port 隨功能建立；核心 Server 分層由 [ARCHITECTURE §3.1](ARCHITECTURE.md#section-3-1) 維護，不預建通用平台、第二領域或空框架。

| 階段 | 本次確認的門檻與調整 |
|---|---|
| P1 | 最小 Server、PostgreSQL、Better Auth 身份及資料隔離先行；Web 孩子／文字記錄／聊天與真 Gemini 形成合成資料閉環後，完成 Server 儲存加密、最低加密備份／還原及驗收。組員可開啟的試玩網址仍是 P1 完成要求，並非現況；S06-W03 在 S03-W01 前，S06-W01 保持最小 AI proxy 職責 |
| P2 | 比賽必達：家庭權限、持久 worker、完整 AI orchestration、長期記憶、Web 照片、Web Push＋Telegram 及預授權找人 fallback；按已授權對象／條件執行，不逐次確認，每次執行檢查當前授權及撤權。任務、投遞、閱讀與完成分開，重試不重複發送。社交來源由使用者主動分享公開更新，不自動讀取私密 feed |
| P3 | Android 在線客戶端、FCM、語音／相機及平台適配，Web／Android 共用同一 Server；跨端一致性、撤權、失敗與真機驗收隨功能完成，不重新建立手機業務主庫 |
| P4 | 自選相容 Server API；Windows Docker Compose 少步部署，接受 Docker／WSL 前置；裝置配對及臨時會話只作授權、不作中繼；Server 搬遷、災備、保留新寫入的 rollback，完整知識／報告及最終交付 |
| P5 | 可選增值；不承接 P1–P4 必要驗收，不預建未來平台 |

官方穩定知識／近期資訊的來源隔離、每周／每日查核、七日近期窗口、freshness 與失效規則沿用 [SPEC](../SPEC.md#knowledge-freshness)；持久家庭 worker 不把近期資訊自動變成孩子事實或家庭任務。ADR-007 的知識治理及輕量解耦有效，只有「家庭資料／任務仍在本地」的邊界被替代。

<a id="adr-008-packages"></a>
本次工作包落點（完整依賴及驗收只維護於 [PLAN](../PLAN.md#roadmap-packages)）：

| 範圍 | 新增／修訂工作包 |
|---|---|
| P1 身份與權威儲存 | 新增 S06-W03，置於 S03-W01 之前；S06-W01 仍是 AI proxy；S03-W01／S09-W01／S05-W01 改為 Server 記錄、聊天、加密與最低備份 |
| P2 家庭與持久執行 | S06-W02 提前至 P2；新增 S07-W03 線上一致性、S13-W04 持久 worker；S13-W01／S11-W02 在 Server 完成確定性任務及 orchestration |
| P2 輸入、分享與外發 | 新增 S12-W03 Web 照片、S12-W04 公開分享來源、S13-W05 Web Push、S13-W06 Telegram、S13-W07 預授權找人 fallback |
| P3 跨端 | 原 S04-W01／S05-W03／S07-W01／S09-W03／S12-W01／S13-W02 改為在線 Android、同服務一致性及 FCM／語音相機語義；家庭身份不再延至此階段 |
| P4 自選 Server 與交付 | 新增 S06-W04 自選相容 Server、S17-W05 Windows 部署；S15-W01 移至 P4 並改為 Server 搬遷，S15-W02 災備／rollback；S08-W01 裝置授權、S07-W02 在線故障、S13-W03 Server 任務切換；完整知識及報告仍由 S10-W03／S14-W02 完成 |

<a id="adr-008-replacements"></a>
原 REQ／AC 與契約的替代索引：保留原 ID／顯式錨點作現行修訂入口；**保留 ID 不等於原文不變**。修訂前完整文字可在 Git 基線 `f858487` 的相同路徑及 ID 追溯，不回寫舊 ADR 或凍結資料。未受本決定影響的要求繼續有效，不能因改成在線架構刪除權限、衝突、終態、備份或恢復驗收。

| 原位置／穩定 ID 範圍 | 正式替代語義及現行入口 |
|---|---|
| SPEC §1.2–1.5，`req-1-2-02..04`、`req-1-3-12`、`req-1-4-01..02`、`req-1-5-01..02` | 產品描述、Server 執行位置及首批外發渠道與新階段一致；社交輸入維持主動提供，不背景讀私人動態；[產品邊界](../SPEC.md#section-1-5) |
| SPEC §1.6，`req-1-6-*` | P1 Server 身份／儲存先行，P2 持久家庭任務與真外發，P3 在線 Android，P4 自選 Server／部署；[階段要求](../SPEC.md#section-1-6) |
| SPEC §2.1–2.6，`req-2-1-*` 至 `req-2-6-*` | 手機／電腦／雲三種業務主庫及入口改為同一 Server 的部署／連接選擇；Windows 自託管屬 Server 部署，客戶端不變成資料主節點；[儲存與部署](../SPEC.md#section-2-1) |
| SPEC §4.1／4.6／4.7，`req-4-1-*`、`req-4-6-*`、`req-4-7-*` | 配對只授權裝置／臨時會話；移除手機中繼及離線副本；斷線保留當頁輸入、手動重試、Server 確認及明確失敗；[配對](../SPEC.md#section-4-1)／[斷線](../SPEC.md#section-4-6)／[狀態](../SPEC.md#section-4-7) |
| SPEC §6.1，`req-6-1-*` | 手機／電腦／雲主庫互轉改為相容 Server 搬遷、匯出／備份及空環境恢復；[遷移方向](../SPEC.md#section-6-1) |
| SPEC §4.8，`req-4-8-04..05` | 裝置撤權改為拒絕 Server API 讀寫及新通知；不保留離線上傳途徑；[撤權](../SPEC.md#section-4-8) |
| SPEC AC §10.2，`ac-10-2-*` | 三種本地儲存／離線同步判據修訂為 Server 持久化、在線一致性、未確認輸入及錯誤不冒充成功；[AC 10.2](../SPEC.md#section-10-2) |
| SPEC AC §10.3，`ac-10-3-*` | 指定瀏覽器／手機主節點改為持久 Server worker；跨會話記憶、唯一任務、終態及當前撤權檢查不降低；[AC 10.3](../SPEC.md#section-10-3) |
| SPEC AC §10.6，`ac-10-6-*` | 三庫互轉／待同步 outbox 改為 Server 搬遷、待確認請求、備份恢復及不丟新寫入的 rollback；[AC 10.6](../SPEC.md#section-10-6) |
| SPEC AC `ac-10-8-06`，新增 `ac-sa-01..06` | Windows 少步部署說明及 Server／授權外發的補充驗收；[交付](../SPEC.md#section-10-8)／[新增 AC](../SPEC.md#ac-server-agent) |
| ARCH §3.1／3.2／3.5／3.6，`rule-3-*` | 共享核心＋Server 唯一資料／Agent 權威、PostgreSQL、身份隔離、持久 worker 及渠道；[架構](ARCHITECTURE.md#section-3-1) |
| ARCH §4.2／4.4，`rule-4-2-*`／`rule-4-4-*` | 手機 WSS 中繼及離線 outbox 流程改為授權在線請求、冪等、版本與 Server 確認；[連接](ARCHITECTURE.md#section-4-2)／[確認流程](ARCHITECTURE.md#section-4-4) |
| ARCH §6.3–6.6、§9.5，`rule-6-*`／`rule-9-5-*` | Server 備份／遷移／災備／rollback，以及按當前權限與資料處理邊界使用快取；[備份](ARCHITECTURE.md#section-6-3)／[遷移](ARCHITECTURE.md#section-6-4)／[快取](ARCHITECTURE.md#section-9-5) |
| API §3.3／3.4／4.1、`sync-contract` | 共享接口的 Server 端執行、當前身份／權限、短效裝置授權；同步契約改為在線一致性與手動重試，不提供離線自動重放；[共享接口](API.md#section-3-3)／[在線契約](API.md#sync-contract) |
| DATA §3.2／4.3／4.5／5.4／5.5／6.2，`data-*` 對應段落 | PostgreSQL 權威與 Server 請求／世代／版本／變更游標、記憶／任務；保留衝突／終態與完整遷移格式，移除業務本地庫／outbox 的解釋；[資料儲存](DATA_MODEL.md#section-3-2)／[請求欄位](DATA_MODEL.md#section-4-3)／[遷移格式](DATA_MODEL.md#section-6-2) |

- 替代 ADR：ADR-003 的 S03 不依賴帳號／雲資料庫；ADR-005 的原架構與「原需求／AC 原文不變」範圍；ADR-007 的本地家庭資料／任務邊界。歷史原文保留，ADR-006 的歸檔與不可改寫規則不變。
- 驗證／實施：DOC-R02 檢查原錨點、局部替代映射、工作包依賴、文件一致性及歷史完整性；產品包全部未開始。各階段實際驗收由 PLAN 的相關 S16／S17 包執行，文件寫入不代表 Server、外發、部署或真機已驗證。

<a id="adr-009"></a>
## ADR-009 — 有界工作上下文、測試及子代理政策

- 日期／狀態：2026-09-22，已確認；依據：使用者確認最新開發政策。權威規則在 [AGENTS](../AGENTS.md#models) 及 [PLAN 驗證制度](../PLAN.md#verification)，本 ADR 記錄理由與替代範圍。
- 原因：避免完整歷史反覆載入、過度委派、碎片訊息與無根因重試，控制驗證成本，同時保留必要驗收及人工結果的真實邊界。
- 上下文與記錄：先 STATUS，再 PLAN 當前包；已有結論先復用，足夠證據即停止。WORKLOG 日常禁止全讀，只讀模板／相關 LOG／追加所需尾部，既有位元組、連結及格式不回寫；只有實質工作包狀態、實現／驗收、重要失敗決策或正式里程碑才追加。普通 Git、格式及臨時檢查不記 LOG。歸檔仍先索引再指定內容，移入或 archived-in-place 同包更新索引；S00 JSON 唯一原位。
- 分工：主模型 UI 自選 Astra／Sol，不固定或降級。長期子代理只用 Luna Max 唯讀調查與 Sol High（可 High／Xhigh／Max）有界實現；禁止 Terra／Astra，使用者明確指定優先，當輪例外不構成永久許可。Luna 不寫檔、不執行 workspace 寫入或架構決策；所有子代理禁止再 spawn。主模型做簡單搜尋／單檔工作，並負責架構、複雜實現、衝突、整合 review 及最終驗收。
- 限額與交接：每包同時及累計最多 3 Luna＋2 Sol；重啟／恢復／替代啟動均計入，達限先整合不追加。主模型先完整拆分，明列目標、範圍、路徑、約束、禁止事項、輸出與證據，一次下達；明確角色／模型／effort 與 `fork_turns="none"`。不輪詢進度、不用 `send_message` 追問／重複／零碎補上下文；follow-up 只補會阻塞的關鍵證據。每輪收齊後統一整合，未整合不追加同類。
- 實際配置：只改專案 `.codex/config.toml` 與角色檔，預設子模型 Sol、effort High、總並發硬上限 5；`explorer` Luna Max／readonly，`worker` 固定 Sol 而不固定 effort。角色數及累計限額屬行為規則，不聲稱 TOML 已提供這些額外硬限制；不改全局。配置檔不證明當前 runtime 或唯讀 sandbox 已生效，必須核對實際啟動結果。
- 驗證政策：預設只執行修改必要的輕量檢查及公開輸入／輸出單元測試；integration、E2E、真機、真實服務、深度／全量回歸須先交代原因、範圍、成本，由使用者決定。未批准的必要驗收保留「待驗收」，不降低完成門檻。可合併的讀取／搜尋／修改／檢查批量做；連續兩輪修改、驗證、再修改仍失敗，先整理根因、失敗證據及下一方案。
- 分支／範圍：可獨立驗收工作包（包括文件包）是分支與合併單位，依賴其成果須等 review／合併，不受整個父 Sxx 完成鎖約束；領域解耦按需建立，不增加通用平台或空框架。
- 替代／驗證：替代先前 AGENTS 的 Sol Medium、通常容許 Astra 實現子代理、最多四代理及未區分測試成本的規則；ADR-004／005 的歷史保留。DOC-R02 只核對政策、專案設定與文件一致性，當前 runtime 未核對部分及未執行驗收須如實報告。

<a id="adr-reuse-p1"></a>
## ADR-REUSE-P1 — S01-W01 有界復用採用決定

- 日期／狀態：2026-09-22，已確認；前置 S00、DOC-R02 已合併至 `89d864a`。採用範圍按既定 ADR-008，不重設架構。
- coo 固定 commit 的 LICENSE 正文未核實、被引用 models 缺件，且 Python／AWS／Twilio 與身份設定不適合當前 P1。決定不複製程式碼、prompt、模板、素材或部署檔，不進行啟動除錯；保留概念來源。
- S02 採 Expo SDK 57 官方相容依賴組合，自行建立最小入口；模板僅參考版本配置，不複製示例程式碼／素材。精確候選、固定許可來源及排除清單見 [S01 核查](REUSE_AUDIT.md)；實際安裝、lockfile 與 notices 在 S02 完成。Better Auth／PostgreSQL／pg 到 S06-W03 才啟用，不提前加 ORM、Agent 平台或家庭插件。
- Baby Buddy 等既有候選只保留研究，不移植另一底座；沒有證據的候選不標為已核實或已採用。S01 實際生產程式碼採用清單為空；選定依賴不等於已可運行。
- 本決定結束 D-REUSE-001 的首輪核查，不免除後續新增／升級依賴的固定版本、許可與測試要求。Agent Prompt Pack 不屬本包；其尚未合併內容不作依賴。
- 證據：[EV-S01-W01](../artifacts/verification/S01_W01_CHECKS.json)／[LOG-20260922-101](../WORKLOG.md#log-20260922-101)。沒有產品、真服務或高成本測試；OPEN_SOURCE_REUSE 保留原文／原路徑，沒有新增歸檔。
