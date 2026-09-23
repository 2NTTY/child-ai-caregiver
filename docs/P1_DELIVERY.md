# P1 雲端試用交付

狀態：使用者已批准本機驗收及七天部署；本機隔離容器驗收通過，GCP 資源建立中。尚未取得公開 HTTPS／雲端驗收及組員試玩證據，本頁不是已完成交付的證明。前置 S16／PR #22 已合併。正式結果及版本會追加驗收證據。

## 可審閱的部署範圍

| 項目 | 準備方案 |
|---|---|
| 專案／區域 | `ai-caregivers-for-children`／香港 `asia-east2-a` |
| 主機 | 一台 `yuban-p1`，`e2-small`（共享 CPU、2 GiB RAM），Debian 12；實際容量須驗證 |
| 磁碟 | 20 GiB `pd-balanced`，合計 boot／Docker 資料容量，Google 管理的預設 at-rest 加密；不另開第二塊 20 GiB |
| 網路 | 專用 VPC／subnet、一個固定 IPv4；公網僅 TCP 80／443，SSH 只限 Google IAP 範圍；PostgreSQL 不發布 port |
| 入口 | `ex-machina.eu.org`；使用者明確指定使用根網域，A 記錄已核對為 `35.241.127.20`，未見 AAAA |
| 執行身份 | 專用附加 service account，只給 Vertex 使用角色及 cloud-platform scope；ADC 用 metadata，不下載 JSON key |
| 服務 | Caddy 2.11.4、Node 24.19.0 API、PostgreSQL 18.6；獨立 maintenance image 提供相同 major 的 pg tools |
| 密鑰 | 新試用庫用新產生的 storage／backup／DB／auth secrets，放工程外受限路徑；不搬移或清空本機合成庫 |
| 初始模型 | 預設關閉；獲批准後每人每日 5 次、全站每日 20 次，每次 6,000 字元／512 output tokens，1 次嘗試；不宣稱這等同金額硬上限 |
| 初始期限 | 擬先試用 7 天，以 GCE `--max-run-duration=7d --instance-termination-action=STOP` 限制單次運行；保留資料，不自動刪庫 |

上述具體資源、必要 API／IAM／firewall 與有限模型驗收範圍已於 2026-09-23 獲使用者批准；不因此擴大資源或呼叫範圍。沒有建立通用部署平台、P4 Windows 安裝器、worker 或新通知服務。

## 預估費用及限制

2026-09-23 官方區域資料的初步估算：e2-small US$0.023440335／小時；20 GiB 平衡磁碟 US$0.000150685／GiB-小時；固定 IPv4 US$0.005／小時。以 730 小時估算固定部分約 **US$22.96／月**，7 天約 **US$5.28**；實際區域 SKU 及帳單為準，未核實個人優惠餘額。[VM 定價](https://cloud.google.com/products/compute/pricing/general-purpose)、[磁碟定價](https://cloud.google.com/compute/disks-image-pricing)、[IPv4 定價](https://cloud.google.com/vpc/network-pricing)

不含流量、AI、額外備份或其他服務；不開 Cloud SQL、Cloud NAT、負載均衡器或付費 DNS zone。停止 VM 後，固定 IP 及保留磁碟仍收費，按上述估算約 US$5.85／月；不是自動完全停費。US$50 是使用者提供的優惠資訊，不代表本次可任意使用的預算。

## 檔案及啟動次序

使用 [Compose](../deploy/p1/compose.yaml)、[非私密座標](../deploy/p1/pilot.env.template)、[Caddyfile](../deploy/p1/Caddyfile)、[初始化工具](../deploy/p1/init-secrets.py)。Linux Docker／Compose 按 [官方 Debian 安裝方式](https://docs.docker.com/engine/install/debian/) 安裝並保存實際版本；不執行未閱讀的遠端安裝腳本。以下是批准後的操作，不是已執行紀錄。

1. 先在本機建置並驗證 `web`／`server`／`maintenance` 三個 target，記錄 image digest；只用獨立合成資料做一次容器啟動／HTTPS 配置及 maintenance 驗證。不要把 `.env`、ADC、key 或備份放入 build context。
2. 建立上述雲端資源，核對 VM 身份、磁碟加密、firewall 與 7 天停止設定，傳送已驗證的 image／Compose 及腳本。公網資料庫／API port 不開放，管理走 IAP。
3. 在新 VM 的新路徑，用 `sudo python3 deploy/p1/init-secrets.py --directory /etc/yuban-p1 --backup-directory /var/backups/yuban-p1 --host ex-machina.eu.org --project ai-caregivers-for-children` 初始化。工具只接受 Linux root、工程外新目錄；不覆蓋既有密鑰。storage／backup key 為 UID 1000、0600，以唯讀單檔 mount 供非 root 容器讀取。
4. `server.env` 維持 root:root 0600；每次 Compose 均以 `sudo docker compose`（或 root）執行，不放寬 secret 權限。每次 compose 指令均指定 `--env-file deploy/p1/pilot.env.template -f deploy/p1/compose.yaml`。先 `up -d postgres`，再 `run --rm --no-deps api node server/migrate.ts` 及 `run --rm --no-deps api node scripts/encrypt-storage.mjs --server-stopped`；確認完成才 `up -d api web`。日後已有資料須先停 API 並備份，不以重新產生 key 解決啟動問題。
5. 使用者已將 Cloudflare 根網域 `A` 記錄 `@` 設為 `35.241.127.20`，採 **DNS only**；只維護已指定的入口，不改郵件或其他記錄。Caddy 只在 DNS 與 80／443 驗證成功後簽發公開信任憑證；不要求組員略過 TLS 警告。
6. 核對 HTTPS Web、HTTP 轉向、API 健康、登入 cookie、帳號隔離、保存及重開、沒有 DB 公網 port、固定安全日誌與資源用量。經獲准的最多兩次合成 Gemini 呼叫核對 metadata ADC；不搬入私人家庭資料。

## 備份、停止及試玩

maintenance 只在 `ops` profile 使用，API 不掛 Docker socket 或 backup key。使用上述 compose 前綴加 `--profile ops run --rm maintenance scripts/storage-backup.mjs backup /backups/<新檔名>.ybak`；驗證時只還原到新建空庫，完整步驟沿用 [P1 儲存操作](P1_STORAGE.md)。新 host 的 key、auth secret、必要設定及已驗證的加密 archive 分開保管於工程外，不只留唯一副本在 VM。

暫停服務使用 `sudo docker compose ... stop` 或停止指定 VM；不要使用 `down -v`、刪除磁碟或覆蓋原庫。7 天後若繼續運行須重新確認期限；若結束試用，先保護／驗證恢復資料，再確認是否釋放磁碟及 IP，不能把停機說成零費用。

另一組員按 [P1 試玩](P1_TRIAL.md) 自行操作，交付時記錄 URL、實際 image／commit、環境與結果。開發者本機通過或本頁寫好不代表 P1 完成。

## 官方依據

- [GCE 磁碟加密](https://cloud.google.com/compute/docs/disks/disk-encryption)：預設 Google 管理加密與應用層 key 是兩層控制。
- [附加身份 ADC](https://cloud.google.com/docs/authentication/application-default-credentials)、[Vertex IAM](https://cloud.google.com/vertex-ai/docs/general/access-control)：使用 metadata 身份，不以本機個人 ADC 作服務端部署憑據。
- [Caddy HTTPS](https://caddyserver.com/docs/automatic-https)：網域、可達挑戰 port 及持久 Caddy data；已用使用者提供網域解除 public-IP 憑證相容性缺口。
- [GCE 運行時限](https://docs.cloud.google.com/compute/docs/instances/limit-vm-runtime)：選 STOP 保留資料；IP／disk 留存費另計。
