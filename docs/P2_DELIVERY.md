# P2 比賽交付

狀態：S17-W02 準備中，基線為 PR #67 的 `90dacd4`；P2 功能包及必要 S16 證據已合併，**現網仍是 P1，以下部署及公開展示尚未執行**。使用者只批准既有主機續期至 **2026-10-03 20:50:44 HKT**，不是本次 P2 部署批准。

沿用 [P1 交付](P1_DELIVERY.md) 的主機、域名、磁碟、密鑰及身份；不新建雲端服務。C 主責部署，A 負責 Agent／來源與整合覆核，B 負責現有功能入口的交付，D 負責獨立試玩及展示材料。開發權重 3，C 60%／A 30%／B 10%；D 的人工驗收另記實際回覆，不代填。

## 上線邊界

- `ai-caregivers-for-children`／`asia-east2-a`／`yuban-p1`，e2-small、20 GiB 原磁碟、固定 IP `35.241.127.20`；入口維持 **https://ex-machina.eu.org**。不延長已批准的停止時間，不新增公網 port。
- Compose project 及 PostgreSQL 持久卷沿用 `yuban-p1`，維持 PostgreSQL 18.6；加入已驗證的 pgvector 0.8.6 映像。保留原帳號、資料、storage／backup／auth secrets、Caddy 憑證及 proxy 設定。
- Web、API、正常持久 worker 使用同一交付版本；沿用既有 Prompt Pack 及有限官方語料。前端聊天的隔離預覽不取代正式 `app/`，不在本包重做 UI。
- Telegram／VAPID 設定只放工程外、以最小服務範圍掛載；照片使用獨立持久目錄。DB 與附件須配對加密備份，API 不掛 backup key。
- CHP／RTHK 不在公開環境登記或發布；私人來源保持本人隔離，不遷移本機測試資料或綁定到現網。

2026-09-30 唯讀核對：現網 SHA `d654b8f`、migration 001–005、原卷 `yuban-p1_postgres-data`、PostgreSQL 18.6、資料庫約 8.7 MB、磁碟可用約 12.6 GB。現有 Google CLI／IAP／SSH 及 ADC 可復用，沒有另行安裝或新增登入。[準備證據](../artifacts/verification/S17_W02_CHECKS.json)

部署採 [P2 Compose override](../deploy/p2/compose.yaml)，與 P1 Compose 合併使用，保留原 project／volumes。將 [P1 非秘密座標](../deploy/p1/pilot.env.template) 與 [P2 附件座標](../deploy/p2/pilot.env.template) 合併為工程外的 `/etc/yuban-p1/pilot.env`；不把私密 `server.env` 混入可公開模板。一般指令前綴為：

```sh
docker compose --env-file /etc/yuban-p1/pilot.env -f deploy/p1/compose.yaml -f deploy/p2/compose.yaml
```

P2 override 本身不開啟 Agent 或通知；正常 worker 另需 `--profile p2-worker up -d worker` 及既有 `worker-control.mjs activate --reviewed-target-source-stopped`。maintenance 改用 `scripts/photos-backup.mjs`；備份帶 `--server-stopped`，還原帶 `--empty-target-server-stopped`，並保存 `.ybak` 與 `.ybak.attachments` 配對，不能只複製 DB archive。

[增量配置工具](../deploy/p2/configure-existing.py) 只接受既有 Linux P1 基線，由 root 讀取工程外、root-owned 0600 的 Telegram／VAPID 輸入檔；先驗證所有路徑／檔案及 owner／mode，再保存唯一的原 `server.env` 備份、安裝新秘密及原子更新七項 allowlist。現有秘密內容不同便拒絕覆蓋；準備完成後 AI／Agent／通知一律關閉，5／20 配額保持原值。上線啟用及下述配額改動須另外按批准範圍完成。語法及合成 env 核對已通過，Linux 主機操作尚未實測。

三個交付映像已建置並通過一次離線檔案／版本核對；P1 映像及既有 pgvector 映像保留。image IDs／打包 hash 見準備證據；未向 VM 傳送。主模型 review 補上 P2 override 的明確新映像引用，避免沿用 P1 tag；沒有為該配置修正重建相同映像。

## 部署次序與回復

1. 唯讀核對現網版本、持久卷、磁碟剩餘、migration、配額及服務狀態。保留舊 image IDs／配置；不列印 secret、家庭正文或完整環境。
2. 本機建置 Web／API／maintenance，復用已通過的 PG18.6＋pgvector0.8.6 映像；確認 Web 含通知 service worker、runtime 含 Prompt Pack／knowledge 及配對備份入口。部署檔先靜態 review，沒有為交付重跑 S16。
3. 取得具體部署批准後，經原 IAP／SSH 傳送版本及映像。維護期間停止 Web／API／worker，先用原相容工具建立 P1 加密備份，並以 [固定 P1 欄位摘要](../deploy/p2/snapshot-p1.sql) 在 migration 前後比較八張原表；只輸出數量／hash，不輸出正文或帳號。不使用 `down -v`、`prune --volumes` 或重跑初始化。
4. 只替換原 PostgreSQL 容器，保留 PGDATA；執行既有 migration 至 023。先保持 Agent／通知及 worker 關閉，核對 migration 與原資料保留；不以清庫處理失敗。
5. 準備非 root 容器可讀的工程外 secret 和附件目錄，核對 Linux owner／mode。初始化公共知識後才開啟正常 worker、Agent 與已批准渠道。
6. 公開入口通過後，以新版本維護工具建立 DB＋附件配對備份，還原至一個新空庫／空附件目錄，保持還原庫 worker 暫停；核對擴展及一份合成附件即可，不重跑本機全套。

任何 migration、原資料核對或必要啟動檢查失敗，停止上線並保留現場。**不假設舊 P1 程式可直接使用 P2 schema。** migration 前可沿舊映像／配置回復；migration 後保留原庫，先在新空目標還原已核對的 P1 備份，再按明確資料取捨恢復服務。不得把備份覆蓋至正在使用的庫，亦不默默丟棄上線後新增資料。

## 公共知識初始化

復用 [knowledge.mjs](../scripts/knowledge.mjs) 及 [knowledge-refresh.mjs](../scripts/knowledge-refresh.mjs)，不另建導入框架。

- 限 `knowledge/hk-official-seed.json` 四個 FHS 來源、五個已核對片段；保留原來來源日期、語意限制、hash 及實際核對時間，不把今天當成官方發布日。
- 登記四個公共 watch，在 Agent／通知保持關閉時由正常 worker 各抓取一次，最多四個來源及十二次含 redirect 的 GET。主模型核對取回內容仍支持原片段，才將確切 observation hash 與版本綁定；失效或內容不符便停止受影響來源，不自動核准。
- 依序 import → review → observation approve → embed → publish。初始最多五次文件 embedding；未變內容沿用同庫向量，不新增歷史測試語料。查詢 embedding 留給兩條實際展示，不另跑四年齡矩陣。
- 公開近期資訊仍如實顯示沒有可用內容；定期檢查不自動重寫或發布知識。

## 最小公開驗收與展示

沿用 [S16 證據](P2_ACCEPTANCE.md)，只補部署特有缺口：公開 HTTPS／同源登入、原資料保留、非 root 附件讀寫、正常 worker、真公開 webhook／Push origin，以及一份配對備份的空庫還原。失敗先停，不自行增加重試或測試矩陣。

- **展示 A：**一位組員從公開 Web 操作合成孩子，提出照護需求；展示已確認資料與向量來源、工具／任務結果，以及必要確認。若選 Telegram 聯絡，先由本人 Start、在 Web 核對身份並明確授權；訊息收到與任務完成分開記錄。
- **展示 B：**同一合成孩子的已授權到期事項，由正常 worker 在頁面關閉後處理，發出一則本人已同意的通知；重新打開查看台帳、明確完成，確認停止催辦。保留實際事件／運行／渠道證據，不展示模型內部思考。
- 兩條展示合計最多兩個 Agent 運行、八次生成、四次查詢 embedding；初始語料另最多五次文件 embedding。沒有額外照片／分享內容的真模型重跑。公開通知最多 Telegram、Web Push 各一則，須明確批准用途及本人目的地，不能沿用已結束的本機測試綁定。
- **待批准的配置：**全站每日 20 次維持；每人每日由 5 次改為 12 次，容納同一帳號兩個有界多步運行；每次 output 上限由 P1 的 512 改為既定 P2 的 1,024 tokens。SDK 仍不重試，32,000 字元／90 秒／四次生成及兩次查詢 embedding 的運行限制不變。到額度便停止，不清零用量。
- 上述一次初始化及兩條展示的模型費初估低於 **US$0.30**，不含已續期主機固定費與流量，也不是金額硬上限。2026-09-30 核對的 [Google 官方定價](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing)：Global Gemini 3.1 Flash-Lite 每百萬 input US$0.25、output US$1.50；實際用量及帳單另記，不自行換模型。
- 人工確認包括實際瀏覽器、收到通知、操作結果及重要失敗；D／組員尚未回覆的項目保持未驗。Firefox 全套相容性仍按使用者決定延後。

## UI 交接與完成門檻

[P2 UI 功能及對接清單](P2_UI_HANDOFF.md) 已列正式功能、API／狀態、opId／unknown、權限及孩子切換清理要求，供前端聊天後續設計及接線。[組員展示指引](P2_TRIAL.md) 只準備操作及回報，沒有代填實際通過。公開部署不等於新前端預覽已整合。

完成時記錄交付 SHA、映像、migration／來源版本、最小驗收與真實人工回覆、實際用量、備份／回復限制，再由 C 的實際 GitHub 身份分別 push、建立 PR 及 Merge commit。所有 S17 必要項目齊備才標 P2 完成；未執行內容不得由 S16 或靜態 Pack 代替。
