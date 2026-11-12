# 原站部署與維運

**日常從這裏開始。** 在倉庫根目錄使用 Node 24、Git 及已登入本倉庫的 GitHub CLI。以下入口可從乾淨 checkout 執行，毋須安裝 npm 依賴。正式網站是 [ex-machina.eu.org](https://ex-machina.eu.org)。

| 目的 | 命令與結果 |
|---|---|
| 查現況或故障 | `npm run deploy:site -- status` 顯示最後一次可信收據、其觀察時間、三個服務 SHA／digest、VM 期限、最近嘗試及每日排程時間。失敗嘗試可從 `latestAttempt.summaryUrl` 查失敗步驟。首次尚無收據顯示 `bootstrapPending`。 |
| 預覽 | `npm run deploy:site -- plan` 比較實際部署的三個版本及遠端 master，列出受影響服務和需人工核對的配置。 |
| 發布 | `npm run deploy:site -- run`。由同一工作流重新讀 master，使用 `status` 查原 run。 |
| 暫停／恢復 | `npm run deploy:site -- pause` 或 `resume`。等操作收據，再進行維護；恢復後可手動 run 或等下次排程。 |
| 回退 | `npm run deploy:site -- rollback` 列出相容候選。確認 ID 與適用服務後，`npm run deploy:site -- rollback RELEASE_ID` 會暫停自動發布並核對目前基線。 |
| 排程逾期 | 查看 [Production website](https://github.com/2NTTY/child-ai-caregiver/actions/workflows/site-release.yml) 是否已啟用及倉庫變數 `SITE_DAILY_ENABLED`。必要時手動 run；日程可能延遲，公開倉庫長期無活動時 GitHub 可停用排程。 |

日程為香港 **04:17**（UTC 20:17）。GitHub 故障／VM 期限警報共用一張由 Actions 管理的 [Issue](https://github.com/2NTTY/child-ai-caregiver/issues/575)，可訂閱其 GitHub 通知。VM 提前 7 天及 1 天提醒。GCP 只接受此倉庫、受保護 master、指定工作流與 environment 的短期身份。

首次接管已在 [2026-11-12 手動工作流](https://github.com/2NTTY/child-ai-caregiver/actions/runs/43240224906) 驗證。原站已有接收器、GitHub 環境與 WIF。下次接手從上表的 `status` 開始。

即使從未觸發，`daily.expectedAt` 亦會列出 workflow 建立後首個正式日程。`nextExpectedBy` 是香港 06:17 的監察期限；逾期仍無新排程會顯示 `overdue`。排查時用 `gh run list --workflow site-release.yml --branch master --event schedule` 查 GitHub 是否已建立 run。有 run 才查其 job；手動發布或重跑舊 run 不會刷新排程時間。

### 每日事件缺席時補觸發

先用 `npm run deploy:site -- status` 查原事件及收據。若已建立 run 而檢查失敗，應修該次錯誤。若每日 04:17 的事件一直缺席，營運者可啟用香港 06:27 的獨立 Cloud Scheduler 作業。它在 VM 停機時亦能喚醒同一個 GitHub workflow，由原發布流程查 VM 狀態。GitHub 會把補觸發記作 `workflow_dispatch`，名稱帶 UTC 日程日期；原生排程驗收只計 `schedule`。

1. **先核實身份。** 本人帳號建立私人 GitHub App，僅授予 Actions 寫入及預設 metadata 讀取，只安裝在 `2NTTY/child-ai-caregiver`。GitHub 的 Actions 寫入授權以倉庫為單位。把 App 私鑰直接存入香港 Secret Manager 的 `site-timer-github-app`，記下數字版號、App ID 和 installation ID。GitHub App 只在真的需要補觸發時換取限定本倉庫的短期 token。其他營運者復用 secret 版號即可。[GitHub 安裝 token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
2. **建立獨立映像。** 在根目錄以 `docker build -f deploy/site-release/Dockerfile.watchdog -t asia-east2-docker.pkg.dev/ai-caregivers-for-children/site-release/site-watchdog:版本 deploy/site-release` 建置並推送該標籤。將推送回傳的完整 `映像名稱@sha256:摘要` 放入 `SITE_TIMER_IMAGE`。另外設定 `SITE_GITHUB_APP_ID`、`SITE_GITHUB_INSTALLATION_ID`、`SITE_TIMER_KEY_VERSION`。
3. **啟用及恢復。** 有營運權限的帳號執行 `bash deploy/site-release/install-watchdog.sh install`。腳本註冊香港 Cloud Run Job、06:27 的 Scheduler 和兩個專用身份。喚醒身份只可執行該 Job；Job 只讀該 secret、讀取及新增發布 bucket 內 `receipts/watchdog-*` 的紀錄。日常狀態／暫停／恢復以相同腳本的 `status`、`pause`、`resume` 操作。更新或輪換時再以相同入口指定新 digest 或 secret 版號。[排程執行 Cloud Run Job](https://docs.cloud.google.com/run/docs/execute/jobs-on-schedule)
4. **查回同一操作。** 超過寬限時間、工作流啟用、當日沒有原生事件且沒正在執行時，才登記 UTC 日期並送一次。全站日程開關和原站暫停仍由正式 workflow 核對。以 `gcloud storage cat gs://ai-caregivers-for-children-site-release/receipts/watchdog-YYYY-MM-DD-result.json` 查結果。只有原 claim 或結果為 `unknown` 時，先在 GitHub 查該日期的 catch-up run；清除 claim 會破壞防重。初次試讀可執行 `python deploy/site-release/watchdog.py`，只有 `--apply` 能觸發。

此備援會增加一項 Scheduler、一個每日短暫執行的 Cloud Run Job、映像及一個 secret。Scheduler 標價每項每月 US$0.10，免費項數按帳單帳戶共用；Job、登錄、映像和 secret 按實際使用計費。觸發後沿原建置及發布成本。[Scheduler 計費](https://cloud.google.com/scheduler/pricing) · [Cloud Run 計費](https://cloud.google.com/run/pricing)

## 一次發布怎樣查證

1. GitHub 比較每個已發布服務的 SHA 與本次固定 SHA。純文件、原生專屬修改及相同目標只記檢查。遇到 Compose／部署前置時先顯示路徑。營運者核對並實際完成前置後，用 `gh variable set SITE_REVIEWED_PREREQUISITES --body <完整 master SHA>` 指定該版。接收器本身有獨立版本指紋。
2. 獨立建置 job 在乾淨 checkout 執行對應型別、離線檢查與候選啟動。Web 校驗 PWA、公開登入配置及 `/site-version.json`。後端變更須確認 Firestore 所需索引已 READY。任何前置失敗均可在工作流的相應步驟查看。
3. 發布 job 使用 GitHub OIDC 換取短期 GCP 身份，把原候選映像放入香港 Artifact Registry，再以 GCS generation 條件提交清單。VM 上的 systemd timer 讀取清單，核對期限、原基線、暫停、磁碟與在途工作。單一 Compose 專案依次切換 API／worker 和 Web。發布不修改資料庫、備份、通知偏好或 VM 停止期限。
4. GitHub 從站外比對首頁 hash、API 健康、API／Web 的版本及 VM 容器收據。查原操作用 `gh run view RUN_ID --log-failed` 和 `gh run download RUN_ID -n site-status`。工作流等待逾時後先查該次 `r<RUN_ID>-<ATTEMPT>` 的收據。被取消的排隊 workflow 以 GitHub run 紀錄為準。

### 回退與意外中斷

- 候選驗證或拉取失敗時，原站繼續服務。更新後端前暫時封住 Caddy 入站並查 Agent／背景工作。主機中斷時，鎖、原清單與本地 journal 決定如何接續。接收器只接受拉取指定映像庫的不可變 digest。
- 已有新後端可能寫入時，健康後端可繼續配合上一個 Web。只有確認舊 reader／worker 能理解新格式、刪除及未完成工作後，營運者才可於 VM 登記 `sudo python3 /usr/local/lib/yuyoufang-site-release/host.py approve-backend-pair WRITER_SHA READER_SHA`。兩個參數均為完整 commit，結果只適用該方向。一般 Web 更新可直接從相容候選回退。
- 出現 `maintenanceRequired` 時用 `pause`，查 `sudo journalctl -u site-release.service -n 35 --no-pager`、`sudo systemctl status site-release.timer`、`docker compose ls`。只在主機上讀 `/var/lib/yuyoufang-site-release/state.json`、`journal.json` 及 `blocked.json`。採用相容修正版，保留同一資料、配置和工作世代。按 [Firestore 部署／資料恢復手冊](PRODUCTION_FRONTEND.md#firestore-deployment)恢復單一 worker、Caddy 與站外健康後，用 `sudo python3 /usr/local/lib/yuyoufang-site-release/host.py accept-repaired FULL_BACKEND_SHA` 收錄修復結果，再 resume。不要用備份回捲仍有新寫入的正式資料。
- VM 保留現行與前兩組已知版本，只針對本工具管理且超出保留範圍的映像清理。磁碟不足先查 `df -h /` 及 `docker system df`，按明確映像引用與已結束的安裝包回收空間。保留 Caddy volumes、加密金鑰、備份、刪除日誌和仍在用的映像。

## 初始化或修復部署身份

一次性操作由 GitHub 倉庫管理者與該 GCP 專案營運者執行。命令在完整 master checkout、Bash、Python 3、GitHub CLI、Google Cloud CLI 及現有 IAP／OS Login 環境執行。Windows 可用 Git Bash；把 Cloud SDK 的 `bin` 加入 PATH，`CLOUDSDK_PYTHON` 可指定本機 Python 絕對路徑。使用本人 `gh auth login`／`gcloud auth login`。工作流與 VM 自行取得短期身份。

1. 核對 `gh api repos/2NTTY/child-ai-caregiver/branches/master --jq .protected`、`gcloud config get project`、本機 `git rev-parse HEAD`。目標為 `ai-caregivers-for-children`（1064034424208）、`asia-east2-a/yuban-p1`。現有正式資料庫為 `yuban-firebase-20261011`。受保護 Compose 及 app 配置來自原 VM 的 `/etc/yuban-p1/firestore/`（compose.env、firebase.env、原掛載密鑰）；Compose 路徑從現行容器標籤發現。主機重建時由營運者依現有配對備份及原受保護配置還原，保持原應用加密材料。[備份與還原](PRODUCTION_FRONTEND.md#firestore-deployment)
2. `bash deploy/site-release/bootstrap-cloud.sh preflight` 核對專案、API、VM 的附加身份／OAuth scope 及已存在的 WIF 信任。首次建立或修復缺少的授權用 `bash deploy/site-release/bootstrap-cloud.sh apply --authorize ai-caregivers-for-children:site-release:bucket-registry-wif-scoped-iam`。操作所需 GCP 權限限於此專案的 IAM 自訂角色與綁定、WIF、SA、香港 bucket／映像庫及讀取 VM。日常 CI 不持有這些管理權。
3. 設定公開 Firebase Web SDK 欄位 `EXPO_PUBLIC_FIREBASE_{API_KEY,AUTH_DOMAIN,PROJECT_ID,APP_ID}`，來源是 Firebase Console → 專案設定 → 現有 Web App → SDK configuration。從目前開放的登入方式設定 `EXPO_PUBLIC_AUTH_PROVIDERS`（保留既有清單，可為空），`EXPO_PUBLIC_ACCOUNT_LEGACY_TRIAL=false`。執行 `node scripts/site-release/configure-github.mjs init`。工具限制兩個 GitHub Environments 只可用 master；瀏覽器用 key 設為 GitHub secret，其餘為 repo variables。模型、服務帳戶、家庭資料與私鑰留在現有受保護配置。
4. `bash scripts/site-release/install-receiver.sh` 只上傳當前遠端 master 的接收器，經 IAP 核對封包 hash；首次記錄實際運行的映像、配置與首頁指紋。若 OS Login 使用不同名稱，在同一命令前設 `SITE_SSH_USER`。新安裝或接收器版本有變才需執行。網站的日常部署無需 SSH。
5. 手動 `npm run deploy:site -- run`，核對 `status` 的 `lastResult=deployed`、服務版本、收據及候選。然後 `node scripts/site-release/configure-github.mjs enable-schedule`。只有第一個真正的 schedule 留下 `skipped` 或 `deployed` 才完成排程驗收。

| 身份 | 資源與限制 |
|---|---|
| `site-observer` | 唯讀發布物件、目標 VM 配置及指定資料庫的索引 metadata。 |
| `site-publisher` | 專用香港映像庫 `site-release`，讀發布狀態，可更新 bucket 內固定清單及控制物件。 |
| 原 VM `yuban-p1` | 從該映像庫拉取、讀命令、回寫收據／狀態。原應用權限保持由主機管理。 |
| 告警 job | 唯一獲 `issues:write` 的日常 job，沒有 GCP 身份；建置 job 也沒有 GCP 身份。 |

發布 bucket 為 `gs://ai-caregivers-for-children-site-release`。營運者讀取單一收據可用 `gcloud storage cat gs://ai-caregivers-for-children-site-release/receipts/RELEASE_ID.json`。排查 WIF 拒絕時核對實際 workflow_ref、branch、repo ID、job environment 及 bootstrap 預查；修復該項綁定後以 master 重新 dispatch。

## 偶發 GCP 維運與成本

- **VM 期限。** `gcloud compute instances describe yuban-p1 --project=ai-caregivers-for-children --zone=asia-east2-a --format='yaml(status,scheduling.terminationTime,scheduling.instanceTerminationAction)'`。延長會增加 VM 運行費。營運者先約定停機窗口、確認無在途工作及費用截止；若 VM 需停止才能改期限，先停機，再執行 `gcloud compute instances set-scheduling yuban-p1 --project=ai-caregivers-for-children --zone=asia-east2-a --instance-termination-action=STOP --termination-time=RFC3339_TIMESTAMP`，再 `gcloud compute instances start yuban-p1 --project=ai-caregivers-for-children --zone=asia-east2-a`。以 describe、站外 health 及新發布收據核對。日程只提醒。 [Compute Engine 支援方式](https://docs.cloud.google.com/compute/docs/instances/limit-vm-runtime)
- **索引。** 從失敗的「Check required Firestore indexes」取得 collection／欄位；以有權營運身份取短期 token 到 `SITE_ACCESS_TOKEN` 後，`node scripts/firestore-indexes.mjs --release-check` 唯讀比對完整 manifest。使用 Firebase Console 或現有受控 `--approved-apply`／`--approved-fields` 工具，只補核實缺少項目，等 READY 後重跑 release-check。索引增加儲存、建立時需等待；這些命令需要索引管理權。 [索引定義](../deploy/firebase/firestore.indexes.json)
- **成本基線。** 原 VM、磁碟、流量、Firestore、備份及附件費照現況。每日約 30 次 GitHub 檢查／月，只有產品變更才建置；此公開倉庫使用標準 hosted runner。VM 每約 75 秒讀取小型清單，並每約 15 分鐘更新健康快照；每月約 3.5 萬次喚醒，實際 Storage 讀取取決於物件是否存在。交付映像依壓縮層佔用及保留時間計費；營運者定期核對 Artifact Registry 容量及保留需求，GitHub 候選封包保留一天。免費額度與同帳戶其他工作共用，實際帳單取決於區域、網絡、版數和計費帳戶。 [GitHub Actions](https://docs.github.com/en/billing/concepts/product-billing/github-actions) · [Artifact Registry](https://cloud.google.com/artifact-registry/pricing) · [Cloud Storage](https://cloud.google.com/storage/pricing)

相較 VM 自行拉 GitHub 並建置，此流程把建置 CPU／磁碟用量留在 GitHub，VM 只取已驗映像。Cloud Scheduler 亦可按時喚醒服務，但仍須安排建置、版本及收據；現有分支保護和 Actions 已提供其入口。此部署流程保留原 Compose 與 Firebase 資料配置。
