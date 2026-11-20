# 原站部署與維運

**日常從這裏開始。** 在倉庫根目錄使用 Node 24、Git 及已登入本倉庫的 GitHub CLI。以下入口可從乾淨 checkout 執行，毋須安裝 npm 依賴。正式網站是 [ex-machina.eu.org](https://ex-machina.eu.org)。

| 目的 | 命令與結果 |
|---|---|
| 查現況或故障 | `npm run deploy:site -- status` 顯示最後一次可信收據、其觀察時間、三個服務 SHA／digest、VM 期限、最近嘗試及每日排程時間。失敗嘗試可從 `latestAttempt.summaryUrl` 查失敗步驟。首次尚無收據顯示 `bootstrapPending`。 |
| 預覽 | `npm run deploy:site -- plan` 比較實際部署的三個版本及遠端 master，列出受影響服務和需人工核對的配置。 |
| 發布 | `npm run deploy:site -- run`。工作流在開始時固定受保護 master 的 SHA。用 `status` 查原 run。 |
| 暫停／恢復 | `npm run deploy:site -- pause` 或 `resume`。等操作收據，再進行維護；恢復後可手動 run 或等下次排程。 |
| 回退 | `npm run deploy:site -- rollback` 列出相容候選。確認 ID 與適用服務後，`npm run deploy:site -- rollback RELEASE_ID` 會暫停自動發布並核對目前基線。 |
| 排程逾期 | 先查 `daily.lastAttempt`。若沒有本日的 run，執行 `bash deploy/site-release/install-watchdog.sh status` 查 GCP 排程，再按下節查當日觸發收據。 |

每天香港 **04:17**（UTC 前一天 20:17），GCP Cloud Scheduler 喚醒既有 Cloud Run Job。它以專用 GitHub App 請同一個發布工作流檢查受保護 `master`。只有影響網站的變更才會建置和發布。GitHub 工作流故障及 VM 期限警報沿用同一張 [Issue](https://github.com/2NTTY/child-ai-caregiver/issues/575)，VM 提前 7 天及 1 天提醒。

原站已有接收器、GitHub 環境與 WIF。日常接手從上表的 `status` 開始。2026-11-13 的 04:17 GitHub 日程在香港 09:04 建立；獨立排程於提前測試的 07:42 已補檢。兩筆收據都記錄 `skipped`。上一次有產品變更時，三個服務均有實際發布收據。[正式發布](https://github.com/2NTTY/child-ai-caregiver/actions/runs/43274416541) · [GitHub 原生日程](https://github.com/2NTTY/child-ai-caregiver/actions/runs/43342076107) · [GCP 自動補檢](https://github.com/2NTTY/child-ai-caregiver/actions/runs/43331068601)

`daily.expectedAt` 顯示預期日程，`nextExpectedBy` 是查漏期限（香港 06:17）。這兩小時只用於狀態警示。`daily.lastAttempt` 認領專用 App 的 `Daily website check YYYY-MM-DD`，亦保留切換前的原生排程歷史；手動發布或重跑舊 run 不會刷新日程。

<a id="每日事件缺席時補觸發"></a>
### GCP 每日觸發與故障查回

GitHub 的正式工作流只使用 `workflow_dispatch`。GCP 每天直接觸發一次，操作員仍可用 `deploy:site -- run`。若已有當日 run，先查該 run 的結果；若未建立，查看 Scheduler 的 `lastAttemptTime`、同時段的 Cloud Run execution 和下列收據。VM 停機亦可執行這項檢查。

1. **先核實身份。** 本人帳號建立私人 GitHub App，僅授予 Actions 寫入及預設 metadata 讀取，只安裝在 `2NTTY/child-ai-caregiver`。GitHub 的 Actions 寫入授權以倉庫為單位。把 App 私鑰直接存入香港 Secret Manager 的 `site-timer-github-app`，記下數字版號、App ID 和 installation ID。GitHub App 只在真的需要補觸發時換取限定本倉庫的短期 token。其他營運者復用 secret 版號即可。[GitHub 安裝 token](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)
2. **建立獨立映像。** 在根目錄以 `docker build -f deploy/site-release/Dockerfile.watchdog -t asia-east2-docker.pkg.dev/ai-caregivers-for-children/site-release/site-watchdog:版本 deploy/site-release` 建置並推送該標籤。將推送回傳的完整 `映像名稱@sha256:摘要` 放入 `SITE_TIMER_IMAGE`。另外設定 `SITE_GITHUB_APP_ID`、`SITE_GITHUB_INSTALLATION_ID`、`SITE_TIMER_KEY_VERSION`。
3. **啟用及恢復。** 有營運權限的帳號執行 `bash deploy/site-release/install-watchdog.sh install`。腳本註冊香港 Cloud Run Job、04:17 的 Scheduler 和兩個專用身份。喚醒身份只可執行該 Job；Job 只讀該 secret、讀取及新增發布 bucket 內 `receipts/watchdog-*` 的紀錄。日常狀態／暫停／恢復以相同腳本的 `status`、`pause`、`resume` 操作。更新或輪換時再以相同入口指定新 digest 或 secret 版號。[排程執行 Cloud Run Job](https://docs.cloud.google.com/run/docs/execute/jobs-on-schedule)
4. **查回同一操作。** GCP 用 UTC 日程日期作收據鍵，在發送前以 GCS 條件寫入取得唯一執行權。同一時段再次投遞只會讀回已有紀錄。在 `gcloud storage cat gs://ai-caregivers-for-children-site-release/receipts/watchdog-YYYY-MM-DD-result.json` 查 GitHub 是否已接受；若只有 claim 或結果為 `unknown`，先查 GitHub 上同日的 `Daily website check`。保留原 claim。若確定當日未執行，可使用手動發布入口。

首次登記期間可用 `bash deploy/site-release/install-watchdog.sh prepare` 建立唯讀模式。`status` 顯示 `observe` 時，到點只在 Cloud Logging 記錄 `would-dispatch`。完成 GitHub App 登記再按步驟 3 切換至 `dispatch`。

現有 Job 升級到 `dispatch` 可直接取回已驗映像，跳過重建。執行 `export SITE_TIMER_IMAGE="$(gcloud run jobs describe site-overdue-dispatch --project=ai-caregivers-for-children --region=asia-east2 --format='value(spec.template.spec.template.spec.containers[0].image)')"`，設定上述三個身份／版號變數，再執行 `install`。新身份剛建立時若 Scheduler 回 `NOT_FOUND`，先查同名 Job、喚醒身份及 Scheduler；確認排程尚未建立而身份可讀後，沿用同一命令接續。

現行安裝使用專用 App `5736451`、installation `181413568` 及香港 secret `site-timer-github-app`。接手時可用 `gcloud run jobs describe site-overdue-dispatch --project=ai-caregivers-for-children --region=asia-east2 --format='value(metadata.labels.wake_mode,spec.template.spec.template.spec.volumes[0].secret.items[0].key)'` 查實際模式和密鑰版號。日常發布沿用現有安裝。

首次登記或重建才需要以下步驟。

1. 用擁有人帳號開啟[已填好權限的官方表單](https://github.com/settings/apps/new?name=2ntty-yuyoufang-site-timer&url=https%3A%2F%2Fgithub.com%2F2NTTY%2Fchild-ai-caregiver&public=false&webhook_active=false&actions=write)。建立後選 **Install App → 2NTTY → Install → Only select repositories**，選 `child-ai-caregiver` 並按 **Install**。記下 App ID 和安裝頁網址末段的 installation ID。[GitHub 安裝說明](https://docs.github.com/en/apps/using-github-apps/installing-your-own-github-app)
2. 回到 [GitHub Apps 設定](https://github.com/settings/apps)，點該 App 旁的 **Edit → Credentials → Key pairs → New key**。把下載的 PEM 直接交給以下命令，使用回傳的版本號完成啟用。[GitHub 私鑰說明](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps)

```sh
# 首次且 secret 尚未存在時建立香港儲存位置
gcloud secrets create site-timer-github-app --project=ai-caregivers-for-children --replication-policy=user-managed --locations=asia-east2
gcloud secrets versions add site-timer-github-app --project=ai-caregivers-for-children --data-file="/path/to/downloaded-private-key.pem"
```

若 GitHub API 回 HTTP 500，先按原時段、分支及工作流查有沒有 run。`deploy:site` 使用非同步 dispatch 介面，接受後從 `status` 查最終收據。

沿用既有 Scheduler、每日短暫執行的 Cloud Run Job、映像和 secret。移動觸發時間毋須增加計時器或常駐服務。用量按原服務計費。[Scheduler 計費](https://cloud.google.com/scheduler/pricing) · [Cloud Run 計費](https://cloud.google.com/run/pricing)

## 一次發布怎樣查證

1. 預檢把事件的完整 SHA 寫入收據。建置、映像和發布清單沿用這個 SHA；期間再合併的提交留給下一次檢查。每個已發布服務的版本都須是目標的祖先或與目標相同，切站時再核對線上基線，以免舊 run 把服務降版。純文件、原生專屬修改及相同目標只記檢查。遇到 Compose／部署前置時先顯示路徑。營運者完成前置後，用 `gh variable set SITE_REVIEWED_PREREQUISITES --body <完整 master SHA>` 指定該版。接收器本身有獨立版本指紋。
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
5. 手動 `npm run deploy:site -- run`，核對 `status` 的 `lastResult=deployed`、三個服務版本及回退候選。首次啟用再執行 `node scripts/site-release/configure-github.mjs enable-schedule`，按上節核對 GCP 的時間與 `dispatch` 模式。自動檢查的完成證據為專用 App 對應日程的 `skipped` 或 `deployed` 收據。

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

### 公共來源的定期整理

啟用前核對 Firebase worker 的實際 SHA、已註冊的公開來源及平台的獨立知識維護用量政策。操作員在原 VM 的受保護位置放置對應版本的 `deploy/knowledge-worker/configure.py`，執行 `sudo python3 configure.py enable-platform WORKER_SHA`。停用使用同一入口的 `disable WORKER_SHA`。程式核對正式映像、現有設定、活動工作及站點健康，持原發布鎖更新 worker；原帳本、付款額度及每日發布歷史繼續沿用。

若主機已有具名贊助者或另一組知識維護設定，程式會指出衝突。若中途斷線，以同一版本和同一命令接續。設定已套用後，查實際排程的 `lastCheckedAt`、該時段的工作結果及知識版本。來源未變時沿用既有版本與處理結果。帳戶自行登記的來源由該帳戶的來源卡、授權及私有資料服務處理。

### FHS 首批同一帳日續作

**人工製卡。** 操作員明確委託 Codex 處理的教材按指定清單接續，維護程序的每日次數只計排程與自動巡查。先查原操作和付費收據，再處理仍未完成的教材。這批沿用 US$30 抵免前毛額，供應商的真實限額及未知投遞預留仍然適用。各組分工見[首批清單](../knowledge/fhs-initial-publication-lanes.json)。

**舊版操作紀錄。** 下文的日期參數及日額是舊入口在 11 月 20 日接回指定工作的做法。

2026-11-20 UTC 的一次營運批准只供 `fhs-child-initial-20261120` 的兒童健康目錄首批。當日政策 v3 的平台維護身份由 200 次增至最多 300 次，全站仍為 400 次，家長每人 200 次。每次整理、審核及文件向量都佔一次。首批仍逐次在原 US$30 毛額帳本預留，兩張 504 共 US$3.207168 繼續全額扣起。其他日子及其他維護入口沿日常政策。香港時間 11 月 21 日 08:00 批准自動到期。

由持有原批次鎖的操作者接手。先核實新 worker 的發布收據，在同一容器用已核對的兩張票據檔設定 `FHS_CAMPAIGN_RETAINED_RECEIPTS`（容器內的絕對路徑），只向本次首批命令傳入 `FHS_CAMPAIGN_DAY_ADMISSION=2026-11-20`。以下命令在該 worker 的 `/app` 內執行。首行讀回同一付款身份、當日兩個計數及毛額帳本，第二行核對原版本與指紋，第三行只接續這份教材。

```sh
node scripts/fhs-initial-campaign.mjs status
node scripts/fhs-initial-campaign.mjs inspect pdf-a036f537a86308ec16eb7d21
node scripts/fhs-initial-campaign.mjs resume-age-checked pdf-a036f537a86308ec16eb7d21 7e38e8ae1cd6991712f1f58fcdf3365a8885f8df940835b5bd5619e2151cf8c4
```

這份 PDF 的已審版本指紋為 `b7a4f123fba8723557f8040650f497f9ca7fc0ae3553edc2123a7e4d7933f45c`，已有兩次生成。再用同一 `inspect` 核對已提交的發布收據、生效版本及模型次數，對回新增的向量票據。若交送結果未知，先查原操作。原鎖接回整個排序時可用 `node scripts/fhs-catalog-batch.mjs --wait-for-daily --from-deferred SOURCE_ID ORIGINAL_FINGERPRINT`，該入口先接回同一份工作；已完成的原工作直接讀回。再次用盡日額時保留進度並等到下一個 UTC 帳日。要提早結束這項批准，由持鎖者在兩份工作之間移除本次命令的日期選項。

同一持鎖者可在兩份教材之間執行 `node scripts/fhs-catalog-batch.mjs --recover-held`，處理[已綁定原稿的教材](../knowledge/fhs-initial-recovery.json)。若持鎖者選用上述當日批准，重審須同時符合原登記、固定重審指紋及映像內的完整修訂。每份沿同一總帳最多派一次新審核，通過後才處理向量和刊登。按來源查進度可用 `node scripts/fhs-initial-campaign.mjs inspect-recovery SOURCE_ID ORIGINAL_FINGERPRINT`，只讀取工作及生效版本。遇未知交送先查同一指紋及票據。

12:43 香港收據另有六份 PDF，只需修正原稿的地區寫法。持鎖者以 `node scripts/fhs-recovery-plan.mjs SOURCE_ID` 查看該份登記，按回傳的 `campaignArgs` 執行 `node scripts/fhs-initial-campaign.mjs recover SOURCE_ID ORIGINAL_FINGERPRINT`。這六份須逐份指定；原有 `--recover-held` 繼續處理 09:00 收據。[六份原操作及審核重點](../artifacts/verification/FHS_C3_PDF_REVIEW_20261120.json)

首批有兩份在新 worker 讀回舊提示時得到 `knowledge_retained_page_request_changed`。持鎖者使用支援舊提示換行的版本後，對 `fhs-30034` 及 `pdf-eefb43f9c484a1a24343d64e` 再執行清單內原來的 `recover` 參數。入口只允許已登記、零模型呼叫且沒有租約、候選稿或發布收據的這種失敗接續一次，`inspect-recovery` 的 `retainedPromptFailure` 保留舊結果。其餘十份可沿原序列繼續。

《電子屏幕與幼兒》可按同一逐份入口接回兩次已結算的分窗閱讀。原件、單頁、兩個請求及兩段轉錄各自的引文位置均已固定。重開後應見恢復工作新增生成 0 次，向量及發布結果仍以正式收據核實。《幼兒的一天》須先釐清睡眠年齡能否用於整頁，《臍帶護理》第 2 頁的兩次轉錄分屬不同段落，兩份均繼續保留。[逐頁覆核](../artifacts/verification/FHS_C3_PDF_REVIEW_20261120.json)

<a id="fhs-publication-lanes"></a>
### 受命製卡的分組執行

三位主責在同一個正式 worker 的 `/app` 執行以下命令，把 `C1` 換成自己的組別。可在最後加一個本組 `SOURCE_ID`。教材及原件 SHA-256 取自[固定分工檔](../knowledge/fhs-initial-publication-lanes.json)。

```sh
node scripts/fhs-catalog-batch.mjs --lane C1 status
node scripts/fhs-catalog-batch.mjs --lane C1 prepare
node scripts/fhs-catalog-batch.mjs --lane C1 run
```

`prepare` 登記原操作、保存官方原件及核對實頁，全程零模型。已有成功觀測便直接讀回。`run` 按頁數由少至多，逐份使用伺服器受命製卡入口，在共用毛額帳本預留；已刊登或有確實保留結果的工作會讀回原收據。全組的 US$30 為抵免前毛額，既有五張結果未明的票據繼續足額預留。自動維護的每日次數適用於排程及自動查新。

先確認正式發布收據已包含分組 CLI、受命製卡准入及共享預留。原 C 在交接時接回原有的待審教材，並停妥舊映像的續跑程序。新目錄命令會略過全部 84 份已分組教材。以下 VM 命令使用首批已驗的 PDF 讀本，SSH 離線後仍會執行；換組時一併替換命令和日誌內的組名。

```sh
sudo docker exec -d -w /app \
  -e FHS_CAMPAIGN_PDF_READS=/var/tmp/yuban-knowledge/fhs-pdf-reads-4c205559755e \
  -e FHS_CAMPAIGN_PDF_READS_SHA256=4c205559755ee545bf4c128e803b9ba24418572dd45a7bd48fdfa53a1ea065c6 \
  yuban-p1-worker-1 sh -c 'umask 077; exec node scripts/fhs-catalog-batch.mjs --lane C1 run >>/var/tmp/yuban-knowledge/fhs-C1.ndjson 2>&1'
```

重新登入或 worker 重啟後，先用 `status` 讀回 Firestore 的原操作、觀測、未結算票據和版本。`run` 會按同一指紋接續。出現 `reconciliation_required` 先按回傳的來源與票據查原結果；已付費資料出現綁定差異時會停止派送。

逐份驗收用 `node scripts/fhs-publication-receipt.mjs SOURCE_ID ORIGINAL_OPERATION`。該命令從家長卡庫核對版本、已匯出的向量及原頁。若曾依有據的修復工作上架，可將該工作指紋加作第三個參數；原操作仍是第二個參數。

### 公共知識 ZIP 暫存

正式 Firestore 映像把 `/var/tmp/yuban-knowledge` 宣告為容器專用的可寫暫存卷，目錄由 node 帳號獨佔。原 VM 與 Compose 可直接使用該映像，原本 32 MiB 的 `/tmp` 繼續供其他功能使用。Linux 打開檔案後隨即解除檔名，程序被停止也會釋放 ZIP 的空間。草稿、進度和收據在 Firestore，暫存卷毋須備份。

單個公共知識包上限是 512 MiB，實際容量取決於 Docker 主機剩餘磁碟。收到 `knowledge_archive_scratch_full` 時，可用 `docker compose exec api sh -c 'df -h /var/tmp/yuban-knowledge; id; test -w /var/tmp/yuban-knowledge'` 核對容量與寫入身份。按原指紋查回批次，再選同一 ZIP 接續。正式 Linux 映像的掛載可在部署時以同一命令核對。

<a id="source-browser"></a>
## 來源卡瀏覽器首次啟用、更新及回退

2026-11-19 14:46 香港，原 VM 已啟用 `87a6c57f` 的 renderer。正式 worker 經唯讀 socket 取得 `200 ready`，同一收據重入後兩個容器 ID 相同。當時磁碟餘量只比 3 GiB 門檻多 11.55 MiB。下一次拉取前重新量度實際餘量。[正式健康及掛載收據](../artifacts/verification/SOURCE_BROWSER_LIVE_20261119.json)

來源卡 renderer 在獨立 Compose 專案運行。worker 以 UID 1000 從唯讀 Unix socket 讀取服務狀態。接收器按已登記版本重新產生 worker 掛載，每次日常發布、修復及業務回退都會核對掛載。renderer 保留一核、384 MiB、零 swap 和無網絡設定。

在**已合併並與遠端 master 相同的 checkout** 執行以下命令。建置機須能以現有營運身份推送香港 `site-release` 映像庫，並沿既有 IAP／OS Login 路徑連線原 VM。接收器安裝及業務發布由主線協調，renderer 與 backend 分開拉取。首次啟用次序如下。

```bash
receipt="$(pwd)/.cache/source-browser-$(git rev-parse HEAD).receipt"
mkdir -p "$(dirname "$receipt")"
bash scripts/site-release/source-browser.sh publish "$receipt"
bash scripts/site-release/install-receiver.sh
bash scripts/site-release/source-browser.sh status
bash scripts/site-release/source-browser.sh apply "$receipt"
bash scripts/site-release/source-browser.sh status
```

取得第二次 `status` 的現行 digest 及業務 release ID 後，主線按本手冊的 `SITE_REVIEWED_PREREQUISITES` 流程核對該 master 的其餘部署前置，再安排業務映像發布。

- **建置與安全更新。** `publish` 從指定提交取出建置輸入，使用固定基底、Playwright driver 及 shell 指紋。它從實際推送結果取得 digest，再按 digest 拉回並核對平台、revision、冷佔用，寫入收據。保留收據及該版 checkout。若推送後中斷，同一提交會先查現有標籤。安全更新應提交新基底或瀏覽器指紋，以新提交無快取建置。
- **容量與切換。** 首次拉取候選前，Docker data root 和接收器所在檔案系統均須有候選完整冷佔用加 3 GiB。切換前再次核對兩處仍有 3 GiB 及至少 384 MiB 可用記憶體。按原先 4.6 GB 餘量計，兩個完全獨立版本只比磁碟門檻多約 75 MiB。工具保留現版及上一版映像，成功提交後只按完整 digest 回收已退役的 renderer。現版和回退版的 root 擁有版本目錄均須保留。[容量實測](../artifacts/verification/SOURCE_BROWSER_FOOTPRINT_20261119.json)
- **鎖及健康。** 操作工具取得原有安裝鎖和發布鎖，核對已登記的 Compose 配置、業務映像身份、容器健康及在途工作。首次接線只重建現有 worker；之後切換 renderer 沿用相同 volume。工具直接從 worker 查 `/healthz`，核對容器實際 digest、隔離設定及唯讀掛載後才提交本機收據。相同收據可重入。
- **回退與中斷。** 使用實際收據的 digest 回退。首次啟用可還原至沒有 renderer 的原配置。其後回退使用本機保留的上一個 digest 及對應 Compose／seccomp，毋須重新拉取。切換失敗會嘗試還原；若主機中斷，每日接收器會保留日誌並暫停套用。用同一份已安裝 checkout 執行 `recover`，再查 `status`。這兩個命令核對現行狀態，業務版本及資料由原發布流程管理。

```bash
read -r revision digest cold_bytes < "$receipt"
bash scripts/site-release/source-browser.sh rollback "$digest"
bash scripts/site-release/source-browser.sh status
# Interrupted switch
bash scripts/site-release/source-browser.sh recover
```
