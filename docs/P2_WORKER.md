# P2 持久 worker

S13-W04 使用 pg-boss 12.34.0（schema 42）、Node 24.19、pg 8.23、PostgreSQL 18.6。只接任務到期與站內提醒，不呼叫模型或真通知；實作與必要本機驗收分開。功能／資料契約見 [API](API.md#p2-task-worker-http)／[DATA_MODEL](DATA_MODEL.md#task-worker-storage)。

S10-W02 在同一程序加入[知識來源更新](P2_KNOWLEDGE.md#source-refresh)，共用全局暫停及 generation；其來源登記、核對與發布仍獨立於照護任務。以下任務重試與恢復證據只屬 S13-W04；知識更新的必要驗收另列，不沿用為已通過。

## 啟用與停止

在已核准的目標環境、既有 storage key 及 DATABASE_URL 下操作；不要把環境檔或密鑰放入 Git。

1. 維護窗口先停止 API／worker，執行 `npm run db:migrate`。框架 schema 與 queue 由遷移命令建立；API／worker 均用 `migrate:false`，版本不符即拒絕啟動。已有非 42 的 framework schema 必須另作版本升級 review。
2. `npm run worker:control -- status` 查看開關及狀態數量，不輸出正文。首次安裝預設 disabled。
3. 核對目標庫、既有安排及唯一執行來源後，執行 `npm run worker:control -- activate --reviewed-target-source-stopped`。只補入沒有 work 的已確認 scheduled 任務及重排有效 pending；失敗預算保留，failed／unknown 不自動重做。
4. 分別啟動 `npm run server` 和 `npm run worker`；關閉 Web 不影響 worker。Compose 已預留 `p2-worker` profile、沿用 API image，只掛 storage key、不發布 port；本包不部署或自行開啟現網 profile。
5. `npm run worker:control -- pause` 持久暫停並輪換 generation；SIGTERM／SIGINT 執行 graceful stop（框架等待 15 秒，整個程序 20 秒硬期限），之後關 pool。Compose 給 25 秒停止期限；硬期限退出仍須由框架恢復，不冒充優雅停止。程序輸出只含固定事件名稱。

Compose 維護映像亦包含控制指令：以既有 private env／secret 設定執行 `docker compose -f deploy/p1/compose.yaml --profile ops run --rm maintenance scripts/worker-control.mjs status`；pause／activate 沿相同入口及上述核對條件。新的 worker profile／映像尚未作容器部署驗收。

知識來源須先由操作員核對及登記。啟用 worker 後，原生 cron 按每週／每日安排執行；啟用本身不強制立即取得所有來源，臨時檢查須另用明確的 `check` 指令。知識排程配置每 60 秒核對一次；暫停或撤銷登記後，已入列工作仍須在取得內容前及寫入前重查資格，不因排程尚未移除而繼續寫入。

## 恢復及狀態

- pg-boss job 僅包含 workId／jobId，業務工作確認者加密；SQL 交易內核權及寫入站內結果，不持鎖呼叫模型／渠道。
- heartbeat 60 秒、monitor／supervise 各 60 秒、執行期限 90 秒、重試延遲 5 秒；每個邏輯工作最多三次失敗。框架每批一個、每個程序 localConcurrency=1；多程序以框架 claim 及業務唯一鍵協作。分鐘級恢復仍以本機 hard-kill 實測為準，不是 SLA。
- created／retry 的保留期是排定時間後 14 日，完成工作 7 日。業務台帳保留；分鐘級有限狀態核對把框架 failed 映射到 failed，遺失／取消映射到 unknown，不另行領取或重試它們。unknown 須先查明原因；本包未接外部投遞，不能宣稱已驗真渠道結果不明的處置。
- 同日普通事項合併到本人站內批次；已 initial 的同一 occurrence 最多再一次跨日跟進，改期不重置。completed／cancelled／needs_review、確認者或負責人撤權及世代不符均停止新有效結果。
- 備份沿全庫 `pg_dump`、認證加密及空庫 `pg_restore`。API／worker 必須在還原前保持停止；還原成功後自動輪換 generation 並設 disabled。若暫停步驟失敗，整次還原回報失敗，目標繼續停用。既有 active job 不會由還原自動變成新工作。
- 核對資料及原來源已停後才顯式 activate；每個有效 pending 配新 jobId，舊 queue job 即使重領也不能重做。此操作不是 P4 完整 Server 遷移或跨站雙主協定。

## 驗收邊界

必要驗收腳本會另列合成資料、HTTP／store 上限、雙 worker、hard-kill、回應遺失、權限／終態／重試及加密空庫還原範圍，獲批准後才執行。單元／typecheck 不代替真 PostgreSQL；沒有另獲批准的 Gemini、通知、部署、E2E 或全量回歸。

2026-09-28：本包必要本機驗收通過，實際版本及分段證據見 [S13-W04](../artifacts/verification/S13_W04_CHECKS.json)。hard-kill 恢復 68.895 秒，只刪本次合成孩子，原庫、加密備份及暫停的空庫還原成果保留。首次實測發現 adapter 丟失 pg 多段 SQL 結果，修正後保留正式期限補驗通過；這是本機樣例，並非恢復 SLA 或外部投遞保證。
