# P2 比賽交付

> 身份：有日期／版本的交付或試玩記錄。下列「已部署／目前／停止」描述當時觀察或設定，不證明今天在線或已停機；現況只看 [STATUS](../STATUS.md#deployment)。操作前重核環境及授權，不沿用一次性測試／清理許可。

狀態：**S17-W02 必要驗收通過，P2 結案隨本包 PR 合併生效。** 執行版本 **`43ab10c29eb0ee3d9b21333c8e2bbe1f6d8cfc8b`** 已於 2026-09-30 部署至 https://ex-machina.eu.org，基線為 PR #67 的 `90dacd4`。原資料升級、向量初始化、公開 HTTP、配對備份／空庫還原及兩條公開 Agent 流程均已通過；首次收尾失敗與修正分開記錄。主機固定於 **2026-10-03 20:50:44 HKT** 停止，不自行續期。

沿用 [P1 交付](P1_DELIVERY.md) 的主機、域名、磁碟、密鑰及身份；不新建雲端服務。C 主責部署，A 負責 Agent／來源與整合覆核，B 負責現有功能入口的交付，D 負責獨立試玩及展示材料。開發權重 3，C 60%／A 30%／B 10%；D 的人工驗收另記實際回覆，不代填。

## 上線邊界

- `ai-caregivers-for-children`／`asia-east2-a`／`yuban-p1`，e2-small、20 GiB 原磁碟、固定 IP `35.241.127.20`；入口維持 **https://ex-machina.eu.org**。不延長已批准的停止時間，不新增公網 port。
- Compose project 及 PostgreSQL 持久卷沿用 `yuban-p1`，維持 PostgreSQL 18.6；加入已驗證的 pgvector 0.8.6 映像。保留原帳號、資料、storage／backup／auth secrets、Caddy 憑證及 proxy 設定。
- Web 沿用 `635a545` 交付映像；API／正常持久 worker 使用 `43ab10c` 收尾修正版；沿用既有 Prompt Pack 及有限官方語料。前端聊天的隔離預覽不取代正式 `app/`，不在本包重做 UI。
- Telegram／VAPID 設定只放工程外、以最小服務範圍掛載；照片使用獨立持久目錄。DB 與附件須配對加密備份，API 不掛 backup key。
- CHP／RTHK 不在公開環境登記或發布；私人來源保持本人隔離，不遷移本機測試資料或綁定到現網。

2026-09-30 升級前唯讀核對為 SHA `d654b8f`、migration 001–005、原卷 `yuban-p1_postgres-data`、PostgreSQL 18.6、資料庫約 8.7 MB、磁碟可用約 12.6 GB。現已套用至 023，pgvector 0.8.6；migration 前後八張 P1 原表的固定欄位數量／hash 相同。現有 Google CLI／IAP／SSH 及 ADC 復用，沒有新增登入或上傳本機 ADC。[交付證據](../artifacts/verification/S17_W02_CHECKS.json)

部署採 [P2 Compose override](../deploy/p2/compose.yaml)，與 P1 Compose 合併使用，保留原 project／volumes。將 [P1 非秘密座標](../deploy/p1/pilot.env.template) 與 [P2 附件座標](../deploy/p2/pilot.env.template) 合併為工程外的 `/etc/yuban-p1/pilot.env`；不把私密 `server.env` 混入可公開模板。一般指令前綴為：

```sh
docker compose --project-name yuban-p1 --env-file /etc/yuban-p1/pilot.env -f deploy/p1/compose.yaml -f deploy/p2/compose.yaml
```

P2 override 本身不開啟 Agent 或通知；正常 worker 另需 `--profile p2-worker up -d worker` 及既有 `worker-control.mjs activate --reviewed-target-source-stopped`。maintenance 改用 `scripts/photos-backup.mjs`；備份帶 `--server-stopped`，還原帶 `--empty-target-server-stopped`，並保存 `.ybak` 與 `.ybak.attachments` 配對，不能只複製 DB archive。

[增量配置工具](../deploy/p2/configure-existing.py) 只接受既有 Linux P1 基線，由 root 讀取工程外、root-owned 0600 的 Telegram／VAPID 輸入檔；先驗證所有路徑／檔案及 owner／mode，再保存唯一的原 `server.env` 備份、安裝新秘密及原子更新七項 allowlist。現有秘密內容不同便拒絕覆蓋；配置階段 AI／Agent／通知保持關閉。Linux 主機操作已通過，後續按使用者批准啟用渠道及下述 12／20 配額；原 storage／backup／auth secrets 保留。

三個交付映像已建置、核對並經 IAP 傳送至指定本人 VM；遠端 hash／大小與本機一致。P1 映像及既有 pgvector 映像保留，image IDs／打包 hash 見交付證據。首次部署 checkout 為 `/opt/yuban-p2-635a545`，舊 `/opt/yuban-p1` 保留；不靠目錄名稱推斷當前執行版本。主模型 review 已補 P2 override 的明確新映像引用，沒有重建相同映像。

## 部署次序與回復

1. 唯讀核對現網版本、持久卷、磁碟剩餘、migration、配額及服務狀態。保留舊 image IDs／配置；不列印 secret、家庭正文或完整環境。
2. 本機建置 Web／API／maintenance，復用已通過的 PG18.6＋pgvector0.8.6 映像；確認 Web 含通知 service worker、runtime 含 Prompt Pack／knowledge 及配對備份入口。部署檔先靜態 review，沒有為交付重跑 S16。
3. 取得具體部署批准後，經原 IAP／SSH 傳送版本及映像。維護期間停止 Web／API／worker，先用原相容工具建立 P1 加密備份，並以 [固定 P1 欄位摘要](../deploy/p2/snapshot-p1.sql) 在 migration 前後比較八張原表；只輸出數量／hash，不輸出正文或帳號。不使用 `down -v`、`prune --volumes` 或重跑初始化。
4. 只替換原 PostgreSQL 容器，保留 PGDATA；執行既有 migration 至 023。先保持 Agent／通知及 worker 關閉，核對 migration 與原資料保留；不以清庫處理失敗。
5. 準備非 root 容器可讀的工程外 secret 和附件目錄，核對 Linux owner／mode。初始化公共知識後，先停止 bootstrap worker／API，以 `up -d --no-deps web` 保留 Web 的固定 `172.30.51.3`，再啟動 API 及正常 worker、Agent 與已批准渠道。首次啟動曾因 API 先佔用該位址導致 Web 無法啟動；按上述次序修正後公開 health／service worker 200，沒有重跑 migration 或 embedding。
6. 公開入口通過後，以新版本維護工具建立 DB＋附件配對備份，還原至一個新空庫／空附件目錄，保持還原庫 worker 暫停；核對擴展及一份合成附件即可，不重跑本機全套。

任何 migration、原資料核對或必要啟動檢查失敗，停止上線並保留現場。**不假設舊 P1 程式可直接使用 P2 schema。** migration 前可沿舊映像／配置回復；migration 後保留原庫，先在新空目標還原已核對的 P1 備份，再按明確資料取捨恢復服務。不得把備份覆蓋至正在使用的庫，亦不默默丟棄上線後新增資料。

## 公共知識初始化

復用 [knowledge.mjs](../scripts/knowledge.mjs) 及 [knowledge-refresh.mjs](../scripts/knowledge-refresh.mjs)，不另建導入框架。

- 限 `knowledge/hk-official-seed.json` 四個 FHS 來源、五個已核對片段；保留原來來源日期、語意限制、hash 及實際核對時間，不把今天當成官方發布日。
- 登記四個公共 watch，在 Agent／通知保持關閉時由正常 worker 各抓取一次，最多四個來源及十二次含 redirect 的 GET。主模型核對取回內容仍支持原片段，才將確切 observation hash 與版本綁定；失效或內容不符便停止受影響來源，不自動核准。
- 依序 import → review → observation approve → embed → publish。初始最多五次文件 embedding；未變內容沿用同庫向量，不新增歷史測試語料。查詢 embedding 留給兩條實際展示，不另跑四年齡矩陣。
- 公開近期資訊仍如實顯示沒有可用內容；定期檢查不自動重寫或發布知識。

本輪四個 FHS 來源均經正常 worker 取得、主模型核對正文及 observation hash，五片段已發布；五次文件 embedding 成功，記錄 522 input tokens／705 billable characters。CHP／RTHK 未登記或發布。此為有限官方語料，不宣稱涵蓋所有育兒或醫療問題。

## 已完成的公開技術驗收與備份

- 公開 health 及 `/push-sw.js` 均為 200；service worker 與交付檔案 hash 一致。一次合成 HTTP 流程 23 次請求通過：登入、已確認家庭事實、孩子／記錄保存、原 opId 收據、一張合成 PNG 寫入及讀回，沒有觸發照片提取。
- 合成孩子先確認 `growth.solid_food=started` 再填九個月年齡，避免把測試資料誤當成未加固的背景觸發；截至展示前，實查 0 Agent 運行／0 生成／0 查詢 embedding。普通記錄的自然文字不能代替已確認的結構化事實。
- Telegram webhook 已指向公開 `/api/telegram/webhook`，限定更新類型、使用 secret header，登記時無待處理更新或 last error。登記時尚未驗本人綁定或 callback；後續公開 Start／一般訊息及照護提示 callback 已通過，見下方結案證據。
- 原 P1 備份為 `/var/backups/yuban-p1/before-p2-635a545.ybak`。P2 配對備份為同目錄 `p2-paired-20260930.ybak` 及 **`.ybak.attachments` 目錄**，兩者須一併保存；附件目錄包含加密 manifest 及附件密文，並非單一 sidecar 檔案。
- 配對備份已還原至新空庫 `yuban_s17_restore_20260930` 及 `/var/lib/yuban-p1/s17-restore-attachments-20260930`：23 migrations、pgvector 0.8.6、合成照片 hash 相符，還原庫 worker 暫停，沒有啟動還原 Server。原服務及正常 worker 已恢復。
- 經使用者另行明確批准，配對密文封裝已存於本機工程外的 `C:\Users\2NTTY\.codex\s17-p2-local\p2-paired-20260930.tar.gz`；277,762 bytes，SHA256 `2d1268add7c8cb7b67f5564f7b7b09fb127f521f655c3bb07e8403f26a47bd24`，IAP 傳輸後核對一致。恢復所需密鑰沿用既有獨立受保護位置，不放同一 archive 或 Git。這份備份早於公開展示，不包含其後的新任務／聊天。

## 最小公開驗收與展示

以下保留原批准範圍；首次失敗後的追加批准與實際累計見文末，不視作尚待執行的新測試。

沿用 [S16 證據](P2_ACCEPTANCE.md)，只補部署特有缺口：公開 HTTPS／同源登入、原資料保留、非 root 附件讀寫、正常 worker、真公開 webhook／Push origin，以及一份配對備份的空庫還原。失敗先停，不自行增加重試或測試矩陣。

- **展示 A：**一位組員從公開 Web 操作合成孩子，提出照護需求；展示已確認資料與向量來源、工具／任務結果，以及必要確認。若選 Telegram 聯絡，先由本人 Start、在 Web 核對身份並明確授權；訊息收到與任務完成分開記錄。
- **展示 B：**同一合成孩子的已授權到期事項，由正常 worker 在頁面關閉後處理，發出一則本人已同意的通知；重新打開查看台帳、明確完成，確認停止催辦。保留實際事件／運行／渠道證據，不展示模型內部思考。
- 兩條展示合計最多兩個 Agent 運行、八次生成、四次查詢 embedding；初始語料另最多五次文件 embedding。沒有額外照片／分享內容的真模型重跑。原批准公開通知為各一則；使用者手動發出並收到 Telegram 一般測試後，已另明確批准 Telegram 合計最多兩則（一般測試已用一則、照護提示尚餘一則），Web Push 仍最多一則，須按已批准用途及本人目的地，不能沿用已結束的本機測試綁定。
- **已批准並啟用的配置：**全站每日 20 次維持；每人每日由 5 次改為 12 次，容納同一帳號兩個有界多步運行；每次 output 上限由 P1 的 512 改為既定 P2 的 1,024 tokens。SDK 仍不重試，32,000 字元／90 秒／四次生成及兩次查詢 embedding 的運行限制不變。展示前全站實際用量為 5 次，均屬語料初始化；到額度便停止，不清零用量。
- 上述一次初始化及兩條展示的模型費初估低於 **US$0.30**，不含已續期主機固定費與流量，也不是金額硬上限。2026-09-30 核對的 [Google 官方定價](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing)：Global Gemini 3.1 Flash-Lite 每百萬 input US$0.25、output US$1.50；實際用量及帳單另記，不自行換模型。
- 人工確認包括實際瀏覽器、收到通知、操作結果及重要失敗；D／組員尚未回覆的項目保持未驗。Firefox 全套相容性仍按使用者決定延後。

## UI 交接與完成門檻

[P2 UI 功能及對接清單](P2_UI_HANDOFF.md) 已列正式功能、API／狀態、opId／unknown、權限及孩子切換清理要求，供前端聊天後續設計及接線。[組員展示指引](P2_TRIAL.md) 保存實際使用者回報與未驗項，不代填 D 的獨立驗收。公開部署不等於新前端預覽已整合。

完成時記錄交付 SHA、映像、migration／來源版本、最小驗收與真實人工回覆、實際用量、備份／回復限制，再由 C 的實際 GitHub 身份分別 push、建立 PR 及 Merge commit。所有 S17 必要項目齊備才標 P2 完成；未執行內容不得由 S16 或靜態 Pack 代替。

### 公開收尾修正與補驗

`43ab10c` 只更新 API／worker 的既有 finalizer 接線，沿用部署主機上的映像建立最小層，無依賴下載或資料遷移；當前 checkout 為 `/opt/yuban-p2-43ab10c`，原 checkout／映像保留。四次單次限額不變，已成功工具不重做；Server 收尾仍核對來源、權限及原期限。12 項相關 Runner 檢查及主模型 review 通過；本機完整 Server 型別檢查受既有缺失通知套件阻塞，沒有冒稱通過。

使用者另批准補一次互動流程及原定背景流程，合共最多兩個新運行／八次生成／四次查詢 embedding、失敗即停。驗收期間每日上限由 12／20 暫改 17／22，現已恢復 12／20，API healthy／worker running；歷史實際用量及失敗保留，不清零。公開 Telegram 總數仍最多兩則，Firefox 一則，主機停止期限不變。這是新增批准，不回寫原展示失敗。

### 公開展示與結案結果

- **A／互動：**`83471cd3-aeea-47f7-ad05-43e084594dbf` 完成，4 次生成／4 次工具／1 次查詢 embedding，`vector_keyword`。使用者在 Firefox 回覆「有來源，已確認 22:40 預約」。主模型核對 FHS 加固來源的實際支持片段與引用版本，候選 accepted 並建立同一任務；不把這個有限樣例當臨床有效性證明。
- **B／關頁後：**使用者明確選擇安靜時段的預約例外、本人 Telegram 接收及指定任務授權。Server 發現 UI 操作後未保存任務 grant，由主聊天按同一明確批准透過既有 API 補存；其後按使用者批准將同一任務改期至 22:27 HKT，重新核對版本，不增加模型／通知數。這不是整個聯絡面板已獨立驗收的證據。
- 正常 worker 產生背景運行 `c70669a7-8d0c-498b-a398-a8e1370e7b78`，4 次生成／3 次工具／0 embedding；本人照護提示 HTTP 200，14:27:50.851Z 收到相應 callback，使用者回覆「收到提示」。收取通知與照護完成分開處理。
- 公開 Firefox 一則 Push HTTP 201；使用者回覆「設定完成、Push 已收到、頁面已關閉」。連同誤按但已核對的一則 Telegram 一般測試，本包實際 Telegram 共 2 則、Push 共 1 則，沒有再發。
- 使用者其後明確批准完成及清理。14 次 HTTP 確認預約 v3 completed、沒有待催辦工作，撤銷兩個 Server 渠道綁定並刪除專用孩子／附屬資料；其他孩子保留，零模型／通知。未刪帳號，也未操作 Firefox 通知權限或 provider 退訂；不能繼續沿用已刪的展示 fixture。
- **S17 累計（包括失敗）：**3 運行／12 次生成／2 查詢 embedding／5 文件 embedding。驗收帳號當日回報 14 attempts、115,559 input／998 output／51,289 cached tokens，8 attempts 的用量 metadata 不完整；這是帳號聚合，不能當生成專屬完整統計或帳單。另五次文件 embedding 已於初始化列出。每日 12／20 已恢復，歷史用量沒有清零；該帳號今日已超過恢復後個人上限。
- 主模型完成實作、真服務及人工作業證據 review，文檔只做 diff／JSON／新增連結與 append-only 必要檢查；不再重跑 S16、備份或模型。完整 Firefox 相容性、新前端整合及所有面板完整 E2E 不在本次已驗聲明內。全部實際結果見 [EV-S17-W02](../artifacts/verification/S17_W02_CHECKS.json)。
