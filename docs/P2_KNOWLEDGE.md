# P2 小型官方知識庫

S10-W01 實作公共知識的匯入、核對、向量化、發布、停用與檢索。真 PostgreSQL／embedding／備份還原待本包批准驗收；目前未部署。Agent 工具接入及面向家長的引用 UI 在 S11-W02，定期來源檢查在 S10-W02；本包指令不等於這些功能已接通。

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

本機獲批後：先以 `verify-knowledge-storage.mjs capture --approved-knowledge-storage` 建工程外加密備份及既有表 hash；再建置並只重建合成 DB 容器，保留原 volume；執行 migration 009（008 屬獨立 S09，合併時保留兩者）；然後 `verify-knowledge.mjs --approved-knowledge`。它預標四年齡段八條改寫問題及一條無關問題，最多 16 次 embedding、120 次 store 操作，失敗不自動重試或上調額度。原私人資料保留；測試新版本及歷史不刪除，最後恢复核對過的 seed 版本。

最後 `verify-knowledge-storage.mjs restore --approved-knowledge-storage` 驗證既有資料、全庫加密備份及新空目標還原，實際查詢 pgvector，再只移除本次新建的還原庫。備份目錄由 `KNOWLEDGE_ACCEPTANCE_DIR` 指定、必須在工程外，沿用獨立 storage／backup key。必要環境用現有 `TEST_DATABASE_URL`、`PG_TOOL_CONTAINER`；不把它們寫入 Git。

缺擴展、錯版本、pg_restore 錯誤或資料 hash 不符均不得標成功。上述腳本語法／純單元不是此驗收的替代品；S10-W01 證據會分列真服務、DB、還原及未執行項目。
