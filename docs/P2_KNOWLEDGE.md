# P2 小型官方知識庫

S10-W01 實作公共知識的匯入、核對、向量化、發布、停用與檢索。獲批的真 PostgreSQL／embedding／備份還原已通過：7 組檢查、15 次 embedding、79 次 store 呼叫；原 23 張業務表保留，31 張表空庫還原及向量查詢成功，詳見 [驗收證據](../artifacts/verification/S10_W01_CHECKS.json)。目前未部署。Agent 工具接入及面向家長的引用 UI 在 S11-W02，定期來源檢查在 S10-W02；本包指令不等於這些功能已接通。

## 首批內容與適用性

[語料](../knowledge/hk-official-seed.json) 有四個家庭健康服務來源、五個經主模型核對的精簡轉述；`sourceExcerpt` 另保留必要短原文，與轉述 `text` 清楚分開。保留原題、章節、URL、原日期字樣及限制，不把轉述冒充逐字引文。以人工取得／核對片段開始，不建完整爬蟲。`fetchedAt` 記本次彙集時間，不是官方發布時間；來源只列月份時，精確發布／修訂欄為 `null`。

| 產品年齡段 | 初始片段 | 實際覆蓋及限制 |
|---|---|---|
| 0–1 | 加固時間及質感 | 約六個月及未滿四個月的不同條件；0–12 月只是檢索範圍，並非背景提醒窗口 |
| 1–3 | 遊戲及語言發展 | 本來源只涵蓋一至兩歲，不外推全部幼兒發展 |
| 3–6 | 持續發展關注、視力普查 | 保留多項且持續的求助條件；普查服務限定四至五歲 |
| 6–10 | 學童護眼及後續視力查詢 | 小一檢查按年級適用，不把全部學童當作小一生，也不擴大學前普查資格 |

這是每段有實例的有限起點，並非所有年齡／照護主題／安全求助情況已完整覆蓋。缺資料或無適用來源應補問或明示限制，不能用最相似片段湊答案。S13-W08 還須按首批關注規則補齊相應證據；本包沒有創建醫療規則。

來源歸屬香港特別行政區政府衞生署。家庭健康服務[版權告示](https://www.fhs.gov.hk/english/notice/notice.html)允許註明來源的非商業散布／複製，商業用途須先取得書面授權。這批內容限定本項目的非商業比賽／試用，不隨程式授權轉為可商用內容；沒有採用條款較窄且用途未釐清的教育局／CHP 候選。日後用途改變須再核對，亦不表示衞生署認可產品。

## 維護入口

`node scripts/knowledge.mjs` 是有本機 DB 權限的操作者指令，不是模型工具或公開管理路由。以工程外環境檔及 ADC 執行；所有變更帶 `--operator team-alias --operator-confirmed`。不在命令列輸入密鑰。

1. `list`：列出版本、核對／發布、向量完成及缺失失敗數。
2. `import knowledge/hk-official-seed.json`：只建立未發布版本，輸出 `versionId`／hash；相同內容重入不重新生成。
3. `review VERSION --hash HASH --source-and-terms-checked`：操作者核對實際來源、條款、片段及適用性後記錄；檔案存在不等於已核對。
4. `embed VERSION --max-calls N --approved-cost`：只生成缺失向量，每次一段；N 為 1–16，超過即停止，不自行拆多輪繞過批准。
5. `publish VERSION --hash HASH`：只容許已核對、未過期、向量完整的版本；原子替換活躍指向，歷史版本保留。
6. `disable SOURCE --reason REASON`：立即停用；原活躍版本標 withdrawn，重新發布須再次核對。
7. `search INPUT.json --approved-cost`：輸入 `{query, filter}`；CLI 只印公共引用識別及實際模式，不回印查詢或向量。

正式語料失效時先停用；不得因新版未完成而保留已知錯誤內容。CLI 的確認旗標是操作防呆，不能代替 AGENTS 所要求的真服務／成本批准。資料未變不重算；title、正文或向量處理版本改變才生成相應新向量。模型、維度及 pipeline 不相容時不得混用。

## 檢索契約與限制

- [KnowledgeFilter／KnowledgeResult](../src/shared/knowledge.ts) 是內部共用契約。Server 提供地區、實際或矯正年齡區間、主題及分類；約數區間須整段落在片段範圍。未知年齡只允許無年齡限制片段；此 seed 沒有這類片段。年齡不是模型自行推算的事實。
- [KnowledgeRetriever](../server/knowledge-retriever.ts) 每個 Agent run 建立一次，重用現有 `AgentBudget`；兩次查詢 embedding／90 秒與生成及工具共用同一運行期限。同 query 只重用向量，來源狀態每次重新查 DB；引用在交付前再以 chunk／版本／hash 核對。這項 metadata 檢查不證明語義支持。
- PostgreSQL 先過濾發布、有效期、年齡、地區、主題及分類，再計算精確 cosine distance；標題／關鍵詞的繁中 bigram 與 Latin token 排序一起做 RRF，最多六片段。`0.4` 距離門檻為初始產品參數，須由少量召回案例核對，並非官方置信度。首版最多 1,000 個適用候選；超限明確拒絕，P4 再按實測擴充。
- 只有 embedding 暫時不可用才標 `keyword_degraded`；取消、越權、額度、畸形向量或過長输入不被降級掩蓋。query 使用者及 corpus maintenance 都消耗既有同一全站每日 counter；maintenance 自身每日最多 16 次。沒有提高現網 5／20 額度。
- 公共片段／向量與私人加密資料分開；不向量化家庭聊天。用量只存 operation／actor、模型、維度、成功／失敗、已知 token／billable characters；只有公共文件記 hash，查詢正文不入日誌。實際帳單仍由 GCP 提供。

## 必要驗收與映像切換

`Dockerfile` 的 `postgres-vector` target 固定 PostgreSQL 18.6／pgvector 0.8.6；來源 commit 與許可見 [notices](../THIRD_PARTY_NOTICES.md#p2-vector-extension-and-public-knowledge)。Compose volume 及 PGDATA 不變，不能刪 volume 或另建空庫冒充升級。

若 Debian 編譯依賴下載受阻，Debian 12／amd64 可用 [Dockerfile.package](../deploy/postgres/Dockerfile.package) 離線建置。下載 [PGDG 套件](https://apt.postgresql.org/pub/repos/apt/pool/main/p/pgvector/postgresql-18-pgvector_0.8.6-1.pgdg12%2B2_amd64.deb)，以 [官方 buildinfo](https://apt.postgresql.org/pub/repos/apt/pool/main/p/pgvector/pgvector_0.8.6-1.pgdg12%2B2_amd64.buildinfo) 核對：269,856 bytes、SHA-256 `c014676900ce4af14f85e4c438ba2d488a4dcb8f684bc03ff908bac184910081`。工程外的獨立建置目錄只放改名的 `pgvector.deb` 及本專案 `licenses/pgvector/LICENSE`，不可將備份／密鑰所在父目錄當作 context。基底 `postgres:18.6-bookworm` 須已在本機：

```text
docker build --network=none --file deploy/postgres/Dockerfile.package --tag yuban-postgres:18.6-pgvector0.8.6 <獨立建置目錄>
```

映像會檢查 hash、版本、架構及動態依賴；不執行套件 maintainer scripts。這條套件建置、同卷啟動及還原路徑已實測；原 source-build 路徑因下載逾時未完成，不冒稱通過。使用既有 Compose project／環境檔，以 `up -d --no-deps --no-build --wait postgres-test` 只替換獲准的合成容器，避免再走 source build；不能另改 project 名稱而誤建新 volume。其他平台不套用 amd64 套件。


本機獲批後：先以 `verify-knowledge-storage.mjs capture --approved-knowledge-storage` 建工程外加密備份及既有表 hash；再建置並只重建合成 DB 容器，保留原 volume；執行 migration 009（既有 008／010／011 保持原 checksum）；然後 `verify-knowledge.mjs --approved-knowledge`。它預標四年齡段八條改寫問題及一條無關問題，最多 16 次 embedding、120 次 store 操作，失敗不自動重試或上調額度。原私人資料保留；測試新版本及歷史不刪除，最後恢复核對過的 seed 版本。

最後 `verify-knowledge-storage.mjs restore --approved-knowledge-storage` 驗證既有資料、全庫加密備份及新空目標還原，實際查詢 pgvector，再只移除本次新建的還原庫。備份目錄由 `KNOWLEDGE_ACCEPTANCE_DIR` 指定、必須在工程外，沿用獨立 storage／backup key。必要環境用現有 `TEST_DATABASE_URL`、`PG_TOOL_CONTAINER`；不把它們寫入 Git。

缺擴展、錯版本、pg_restore 錯誤或資料 hash 不符均不得標成功。上述腳本語法／純單元不是此驗收的替代品；S10-W01 證據會分列真服務、DB、還原及未執行項目。

<a id="source-refresh"></a>
## S10-W02 定期來源檢查（已實作、待必要驗收）

固定來源登記見 [catalog](../server/knowledge-source-catalog.ts)。四個 FHS 穩定頁每週一香港時間 09:00 檢查；CHP／RTHK 近期 RSS 每日香港時間 09:00 檢查。使用同一 pg-boss 的原生 cron／missed:once，停機漏跑合併為一次，不另建 scheduler。worker 啟動及每分鐘同步登記／暫停狀態，真正到期由原生 timekeeper 處理；網頁關閉仍運行，worker 本身須開啟。初始 migration 不自動登記或啟用來源。

### 使用範圍

- FHS 沿用非商業、註明出處的項目用途。CHP [RSS](https://www.chp.gov.hk/rss/pressreleases_zh_tw_RSS.xml)及 RTHK [本地 RSS](https://rthk9.rthk.hk/rthk/news/rss/c_expressnews_clocal.xml) 依 [ADR-013](DECISIONS.md#adr-013)只限組內非商業試用；公開版不提供其摘要或檢索片段。是否可再公開使用須另取得權利證據，不把操作者確認旗標當成授權來源。
- createKnowledgeStore 的預設 audience 為 public；internal 只能由受信任主機操作者明確選擇。現階段用既有 knowledge.mjs 的 --internal-source-review 作組內檢索／發布，沒有瀏覽器可選權限或公開近期資訊 UI。新結果帶 usageScope；S11 不得把 internal 結果移入公開對話。取得新公開來源前，公開的近期查詢應如實顯示沒有可用內容。
- 原始觀察只供內容核對。RSS 原文／來源日期不改寫；轉述、章節及適用條件仍由操作者核對，不把 RSS description 或整篇新聞直接當育兒指引。沒有摘要時僅保留標題，不編造摘要。近期資料不建家庭事實、長期規則或任務。

### 維護流程

新增 [knowledge-refresh.mjs](../scripts/knowledge-refresh.mjs)，延用工程外設定與主機權限。catalog／list／inspect SOURCE_ID 唯讀；其他操作須 --operator ALIAS --operator-confirmed。

1. register WATCH_ID --source-and-terms-checked：只登記固定清單的來源及用途；需要同時啟用共用 worker 時按 [worker 操作](P2_WORKER.md)確認目標及唯一執行者，不在此指令偷偷啟用。新登記來源在首次抓取／核對前不供引用。已啟用且定義相同時保留批准；定義變更或重新啟用則原子撤銷舊批准，不因改回原設定而自動恢復引用。
2. check WATCH_ID --approved-source-check：以目前 watch revision／worker generation 入列一次；queued 或 already_pending 均不等於抓取完成。list 查工作實際結果；亦可等候正常每週／每日排程。
3. inspect SOURCE_ID：查看受大小限制的公共觀察正文、原日期、content hash 及抓取時間。首次／實質變更後人工整理受影響片段，沿用原 knowledge.mjs import／review；不把整頁自動發表。原版失效或待新 hash 核對時停止引用，已保存版本不刪除。
4. approve SOURCE_ID --observation-hash HASH --version UUID --version-hash HASH --source-and-terms-checked：把確切觀察版本與已核對知識版本綁定。日期、URL、分類、發布者及條款要一致；版本或觀察已變即拒絕，不能用舊確認批准新內容。
5. 沿用 knowledge.mjs embed 的 --approved-cost／有限 max-calls，再 publish；internal 來源需明確帶 --internal-source-review。未變 title／片段 text／模型／pipeline 復用既有向量；正文觀察有變但核對後片段不變，可再批准原版，不為此重算。這些旗標不代替 AGENTS 的本輪服務成本批准。
6. disable WATCH_ID：立即停止該登記的後續查詢及排程，撤銷觀察批准。停用單個既有知識來源仍用 knowledge.mjs disable SOURCE；任何重新發布先核對，不因來源重現而自動復活。

### 失敗、日期與恢復

抓取固定 HTTPS host，IPv4 DNS 檢查及地址固定、最多兩次同 host redirect；每次來源呼叫總計 20 秒、1 MiB、最多 50 個 RSS 項目。Cheerio 1.2.0 只解析內容，拒絕 RSS DTD／ENTITY；FHS 明確使用 #content，頁尾／導覽變動不應成為育兒正文。XML 各項 pubDate 分別保存；月份／無日期保持未知，不套用頻道 lastBuildDate。正文過長明確失敗，不靜默裁去限制條件。

觀察的 fetched_at 與 last_successful_check_at、來源發布／修訂日期及既有版本 checked_at（人工核對）分開。hash 未變只更新成功抓取 metadata，沒有向量呼叫；失敗保留最後成功內容與時間。404／410 或停用立即排除，恢復後也需重新批准。feed 不再列某項不自動判斷官方撤回，其成功時間停止前進；超過 24 小時或七日發布窗口便不進近期結果。

SQL 回寫前重查登記／世代／全局暫停，job ID 唯一結果；網絡請求不持有 SQL 交易。每日／每週取回都是有界 GET，沒有模型或私人家庭資料外送。還原保留三張維護表及 pg-boss schedules/jobs，沿用 worker_control 關閉／新世代；核對唯一來源後才重新啟用，操作者可用 check 補查，不能把還原舊抓取時間當最新。

目前已核對六份原 HTML／RSS 的 selector／日期欄位，並完成離線解析：四 FHS 月份精度保持未知日期；CHP 原 feed 有舊項目，不能因今天取回而寫成最新；RTHK description 有完整句段，不能冒充僅標題。這是來源格式研究及離線檢查，並非新 SQL／真 worker／網絡 adapter 驗收。[必要驗收腳本](../scripts/verify-knowledge-refresh.mjs)已準備並 review，使用者於 2026-09-28 選擇先保留待驗收，尚未執行；使用工程外受保護目錄、原加密合成庫、先備份及單次批准標記，檢查上限及已驗／未驗見 [EV-S10-W02](../artifacts/verification/S10_W02_CHECKS.json)。增量向量檢查使用明示合成向量，真來源只取回解析、不保存正文；沒有新 Gemini／embedding 呼叫、E2E 或部署。
