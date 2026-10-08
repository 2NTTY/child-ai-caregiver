# 正式 Web 前端與功能接點

本頁說明正式入口、啟動／部署及仍未支援的內容；工作狀態只看 [PLAN](../PLAN.md#active)，實際部署與驗收見 [INT-W07 證據](../artifacts/verification/INT_W07_CHECKS.json)。不是另一份產品需求或測試清單。

## 入口與日常開發

- 正式網址：**https://ex-machina.eu.org**。`frontend/` 是正式 Expo Web 應用，使用已確認的版面、互動及美術；根 `app/` 不再是正式 Web 產物。
- Node 24.19.0／npm 11.8.0；根目錄 `npm ci` 使用唯一 lockfile。先按 `.env.example` 配好既有 PostgreSQL／Server，`npm run server` 啟動 API；另執行 `npm run web`。本機 API 座標用 `EXPO_PUBLIC_API_BASE_URL=http://localhost:3001/api`；公開部署用同源 `/api`。密鑰不可放在 `EXPO_PUBLIC_*`。
- `npm run build:web` 匯出 `frontend/dist`，並複製 Push service worker 及許可。Docker `web` target 經 Caddy 供應這份產物，`/api/*` 轉到同一 API。
- 舊根入口及專用Panel／runner已退出現行開發路徑，原碼見[可恢復歸檔](../_archive/legacy-web-2026-10-07/README.md)；legacy Web/build/test命令明確停止。有效 controller、API client、收據及權限處理繼續共用，沒有為新頁另建業務資料庫。

## 使用方式及共用資料

主要流程是「與 Agent 說 → 查看實際結果」。本人先在對話內開啟相關普通操作的預授權；普通記錄／私人交代及本人提醒依範圍執行。重要事項、共享擴大、來源摘錄及超出授權的動作仍要確認。待確認索引獨立於近期聊天頁數；過期項保留查核入口，不繼續執行舊版本。

| 功能 | 正式頁面／對話接點 | 權威及必要界線 |
|---|---|---|
| 身份、家庭、孩子 | 登入、設定及孩子選擇 | Server session／家庭角色；登出及切換清理舊投影 |
| Agent、引用、收據、候選、背景回饋 | 與 Agent 對話 | 原 messages／run／operation ledger；回覆不能冒充業務收據 |
| 日常記錄、更正、檔案 | 對話及記錄與核對 | 同一 Care／Profile；人工表單作備援，未知操作保留原 opId |
| 記憶、摘要 | 對話、記憶參考及孩子概況 | Memory／CareSummary；私人聊天不自動變成共享事實 |
| 任務、預約、完成／取消 | 對話及待辦 | Task／occurrence；收到提示不等於完成 |
| 階段關注、持續關注鏈 | 對話、成長及歷史 | GrowthAttention 與 Concern 分開；同一 owner 投影，結束不偷偷取消相連任務 |
| 多份準備文件、清單及歷史 | 對話、孩子概況與準備 | FamilyDocument；原單份到診準備可由 `/summary?tab=legacy-preparation` 查回 |
| 成長報告及 PDF | 對話、成長 | 同版共享文字快照；来源更正遮蔽失效正文，普通讀頁不生成 |
| 私人來源與照片 | 對話入口、來源管理 | SharedInput／Photo；上傳、模型提取及共享各按原授權，私人引用不是官方證據 |
| 聯絡、Push／Telegram、模型 key／限額 | 對話安全入口及設定 | 原 Settings／Contact／Notification 服務；key 不進模型上下文，渠道權限由本人操作 |

完整 callback／API 對照見 [P2 UI 接點](P2_UI_HANDOFF.md#production-owners)。首頁、側欄及歷史讀取這些 owner；沒有另一份可寫副本。Agent 或人工寫入後刷新相關投影，可見頁按 changes cursor 每 5 秒核對 metadata，返回前景立即核對；沒有新事件不呼叫模型。已載入清單不當作完整歷史。

## 部署及回復（以下保留 INT-W07 歷史版本）

目前部署版本以 [STATUS](../STATUS.md#deployment) 的具日期觀察為準，不把下列053658b當最新版本。

沿用專案 `ai-caregivers-for-children`、`asia-east2-a`、VM `yuban-p1`（ID `2846984358678394356`、IP `35.241.127.20`），Compose project `yuban-p1`。不新增服務、公網資料庫或另一個資料卷。

```sh
docker compose --project-name yuban-p1 \
  --env-file /etc/yuban-p1/pilot.env \
  -f deploy/p1/compose.yaml -f deploy/p2/compose.yaml <command>
```

本次 release 以 `053658b` 建置，安裝目錄 `/opt/yuban-int-053658b`；三個映像為 `yuban-int-api:053658b`、`yuban-int-maintenance:053658b`、`yuban-int-web:053658b`，實際 ID 以證據為準。原 PostgreSQL 18.6／pgvector 0.8.6、`yuban-p1_postgres-data`、Caddy 資料、附件及 `/etc/yuban-p1` 秘密沿用。

次序是核對主機／磁碟／原映像 → 傳送並核對 hash → 暫停 worker 及停止 Web／API → 工程外加密配對備份 → 套用 024–028 → 核對所有原資料表既有欄位的數量／hash → 先啟動固定 proxy IP 的 Web，再 API → 恢復正常 worker。每日平台上限維持每人 12／全站 20，不清零用量。沒有重算知識向量或重發渠道測試。

升級前備份 `/var/backups/yuban-p1/int-w07-before-028.ybak` 必須連同 `.ybak.attachments` 目錄保存，密鑰保持分開。原 `/opt/yuban-p2-43ab10c` 與原映像保留；原 pilot 設定備份在 `/var/backups/yuban-p1/int-w07/pilot-before.env`。回復不得 `down -v`、清庫或覆蓋正在使用的資料庫；先停止寫入、核對是否已有新資料，再决定沿舊映像讀取相容 schema 或還原至新的空目標，不能默默丟棄新資料。

## 明確保留的限制

- 語音、其他文件輸入、第三方／電話登入及 Android 真機仍未支援；孩子刪除保留。沒有假成功入口。
- PDF 是共享文字資料整理，不包含私人聊天或照片，也不是醫療／發展評估；完整選材匯出、遷移及大規模知識管理仍按後續階段。
- 本人 Gemini key 的保存、加密及可調限額已接；Developer API 的地區可用性仍有既有阻塞，不能保證每個使用地區可真生成。
- 記憶頁顯示持久工作狀態及公共來源目錄，不聲稱是模型當時完整上下文；聊天仍可查看實際引用。有限官方語料不代表所有育兒問題皆有足夠來源。
- 使用既有瀏覽器／通知證據及這次一則公開真對話。該瀏覽器腳本在讀收據時達 HTTP 上限停止；同一資料的 run／收據／記錄／聊天及清理由 8 次 API 補核，沒有重跑模型或瀏覽器。本輪剩餘 Care／Home／reload／logout UI 斷言未驗，不宣稱完整序列、所有表單、Firefox 全套相容性或每項新能力已逐一真模型驗收。實際失敗與未驗項保留在證據檔。


<a id="invited-account-service"></a>
## 邀請制服務設定（P2-A08 Server 接點）

正式真實資料模式用SERVICE_MODE=invited；A08提供Server／client，A07沿AccountServiceOwner接登入／同意及設定入口，是否上線仍以STATUS最後觀察為準。trial保留合成相容，不代表已開放真實資料。

- ACCOUNT_SMTP_CONFIG_FILE指向工程外受保護JSON，欄位host、port、secure、from及成對user/password；不要放入EXPO_PUBLIC、prompt或聊天。Nodemailer使用TLS／STARTTLS及正常憑證核對。僅非production的loopback驗收容许ACCOUNT_SMTP_ALLOW_INSECURE_LOOPBACK=true，正式模式拒絕此例外。
- 完成[刪除journal初始化／綁定](P1_STORAGE.md#account-erasure-journal)，並配置原ATTACHMENTS_DIR、儲存key及worker。正式模式缺SMTP不啟動；消費端遵守worker_control／generation，未知郵件不重發。
- 營運者執行npm run account:invitation -- issue parent@example.invalid 7授予指定電郵七日註冊資格；回覆invitationId，可用revoke加該ID撤回。消耗資格不因刪帳復原；新邀請須明確再issue。這不加入其他家庭。示例是假電郵，不會自動寄邀請。
- 註冊後驗證本人電郵、登入及確認當前資料說明；找回沿原生流程並撤銷舊會話。驗證／找回回到同源的/?account=verified或/?account=reset，畫面只說已受理，不保證郵件送達。
- 本人下載使用固定manifest及有界資料頁；失效歷史會明示不可用，並非所有歷史正文均可匯出。模型key、密碼hash、session及渠道secret不回傳。大量資料的頁面呈現沿exportPage分批，不能把已讀前綴說成完整下載。

真郵件供應商、寄件身份、邀請規模、保留期限、VM期限及運行預算仍須在A09部署前核定；A08本機SMTP證據不代表公開找回信已送達。


<a id="p2-a09-deployment"></a>
## P2-A09 邀請制部署接線（待正式部署驗收）

此節是現行部署方法；上方 INT-W07 保留歷史觀察，不能把舊映像當成已包含 A01～A08。實際主機／映像、驗收及未完成項見 STATUS／PLAN。

### Compose 與工程外設定

在原 `deploy/p1/compose.yaml`、`deploy/p2/compose.yaml` 後追加 `deploy/p2/service.compose.yaml`；沿用同一 `yuban-p1` project、pilot env 與原 secrets，不建立新資料卷。`service.env.template` 只列 SMTP 檔及 journal 目錄座標，實際值合入工程外 pilot env。核對合併配置時啟用 `--profile p2-worker --profile ops`，否則看不到 worker／maintenance。

- API／worker 共同使用 invited 模式、受保護 SMTP JSON 及同一目前 journal；maintenance 只掛 journal／原備份能力，不需要 SMTP 憑據。API 不取得 backup key。
- 主機目錄須由 UID 1000 可穿越及讀寫；SMTP 檔 0600、journal 0700。Compose 不代修 owner／mode，缺 bind 來源拒絕啟動。
- 首次 journal 尚未存在時，先按照 [P1_STORAGE 的初始化／綁定步驟](P1_STORAGE.md#account-erasure-journal) 在受保護父目錄完成初始化，再掛最終目錄。不能先建立空的 journal 子目錄代替 initialize，也不能把正式 API 當初始化工具。
- 映像包含 `scripts/account-invitation.mjs` 及 `scripts/account-erasure-journal.mjs`。邀請由已配置的 API 容器執行 `node scripts/account-invitation.mjs issue <email> <days>`；該 CLI 只登記資格，不發邀請信。不要在缺 SMTP 的 maintenance 服務執行它。

### 升級與恢复界線

1. 核對指定 VM 身份、STOP 時間、磁碟容量、正在使用的 Compose 檔／映像及 migration；先 fetch master／核對相關 PR，映像不得只依目錄名稱認定版本。保留原映像及完整工程外設定，不變更已有平台配額。
2. 建置 reviewed Web／API／maintenance；SMTP、ADC、密鑰、使用者資料不進 build context。傳輸到同一已核實 VM 前核對 hash，原 pgvector 映像及資料目錄沿用。
3. 暫停 worker、停止寫入，使用原相容工具保存 DB＋照片加密配對備份；journal 另存工程外受保護副本，密鑰保持分開。只有備份檔存在不算恢復通過。
4. 按實際尚缺的 migration 升級；首次 035 部署在開放之前完成 journal initialize／bind，以後只能 replay。核對原資料保留。先保留固定 proxy IP 啟動 Web，再啟動同版 API／worker，正式 SMTP 與資料說明／邀請政策備妥才開放 invited 服務。
5. 空目標還原使用配對 DB／照片及**目前** journal，先 replay 並檢查刪除結果，再決定是否開放；worker 保持暫停，不重發舊郵件／提醒。單 VM 及本機恢復證據不等於高可用。

套用 035 之後，不可直接回退到不懂 journal 的 API／worker。回復必須保留新寫入和刪除意圖，使用相容映像或新空目標恢復；禁止 down -v、清庫、覆蓋目前 journal 或以舊備份復活帳戶。正式 SMTP 送達、邀請規模、保留期限、維運告警及預算未核定前，這份接線不能視為穩定服務已交付。
