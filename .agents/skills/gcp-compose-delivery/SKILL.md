---
name: gcp-compose-delivery
description: 準備或修改 GCP 單 VM 的 Docker Compose Web／Node／PostgreSQL 部署、Caddy HTTPS 入口、附加身份及 secret 掛載時使用。
---

# GCP／Compose 交付

適用 Docker Compose v2、Node 24、PostgreSQL 18、Caddy 2.11.4／Compute Engine；官方文件最後核對 2026-09-23。本文約束已核對，指定映像的本機隔離容器／HTTPS／maintenance 備份還原已驗證；實際雲端部署尚待驗證；產品範圍及環境決策以專案架構／交付文件為準。價格易變，按實際區域即時核對，不在 Skill 固定報價。

- Multi-stage 只把所需 runtime／靜態輸出放入對應映像；不要把 `.env`、ADC、密鑰或本機資料放入 build context。Build ARG／ENV 不能安全傳秘密；需要建置秘密時用 BuildKit secret mount，runtime 則另行提供。[multi-stage](https://docs.docker.com/build/building/multi-stage/)、[build secrets](https://docs.docker.com/build/building/secrets/)
- Compose file secret 是掛載檔案，不代表 Secret Manager、宿主加密或自動修正 UID／mode；核對映像實際 UID 能讀、其他身分不能讀。只對指定服務授權，API 不掛 backup key 或 Docker socket。[Compose secrets](https://docs.docker.com/compose/how-tos/use-secrets/)
- PostgreSQL image/client 使用相容 major；maintenance job 保留原生 pg_dump／pg_restore，公開 API 不因備份取得主機 Docker 權限。既有加密 Skill 的空庫／認證還原邊界仍適用。
- 只發布 HTTPS 入口所需 port；DB 留私有 network。網域 DNS 須指向入口、80/443 挑戰可達、Caddy data directory 持久且可寫。Caddy 的 IP 自簽預設不等於公開信任憑證；CA 的新能力亦不代表固定 Caddy 版本已支援。[Automatic HTTPS](https://caddyserver.com/docs/automatic-https)、[v2.11.4](https://github.com/caddyserver/caddy/releases/tag/v2.11.4)
- GCP 使用專用附加 service account 與 ADC／metadata，按需要授予 API 角色，不下載 JSON key。VM OAuth scope 與 IAM 都須容許調用；若使用 Secret Manager，只授指定 secret 存取，而非把整個 project 的秘密開放給 API。[ADC](https://cloud.google.com/docs/authentication/application-default-credentials)、[Vertex IAM](https://cloud.google.com/vertex-ai/docs/general/access-control)
- Persistent Disk 預設的 Google 管理加密是磁碟控制，不能替代正文 AES key、獨立備份 key、OS 權限及實際還原。備份及金鑰須有可恢復的工程外副本。[disk encryption](https://cloud.google.com/compute/docs/disks/disk-encryption)
- 停止 VM 不代表所有費用停止：仍關聯的固定 IPv4 及保留磁碟繼續收費。用量限制和 budget alert 也不等於硬性停費。[IP pricing](https://cloud.google.com/vpc/network-pricing)
