# 正式 Web 前端與功能接點

本頁說明正式入口、啟動／部署及仍未支援的內容；工作狀態只看 [PLAN](../PLAN.md#active)，實際部署以 [STATUS 日期觀察](../STATUS.md#deployment) 為準，原 [INT-W07 證據](../artifacts/verification/INT_W07_CHECKS.json) 保留。不是另一份產品需求或測試清單。

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
## 邀請制服務設定（現有 P2-A08 PostgreSQL 接點）

正式真實資料模式用SERVICE_MODE=invited；A08提供Server／client，A07沿AccountServiceOwner接登入／同意及設定入口，是否上線仍以STATUS最後觀察為準。trial保留合成相容，不代表已開放真實資料。

- ACCOUNT_SMTP_CONFIG_FILE指向工程外受保護JSON，欄位host、port、secure、from及成對user/password；不要放入EXPO_PUBLIC、prompt或聊天。Nodemailer使用TLS／STARTTLS及正常憑證核對。僅非production的loopback驗收容许ACCOUNT_SMTP_ALLOW_INSECURE_LOOPBACK=true，正式模式拒絕此例外。
- 完成[刪除journal初始化／綁定](P1_STORAGE.md#account-erasure-journal)，並配置原ATTACHMENTS_DIR、儲存key及worker。正式模式缺SMTP不啟動；消費端遵守worker_control／generation，未知郵件不重發。
- 營運者執行npm run account:invitation -- issue parent@example.invalid 7授予指定電郵七日註冊資格；回覆invitationId，可用revoke加該ID撤回。消耗資格不因刪帳復原；新邀請須明確再issue。這不加入其他家庭。示例是假電郵，不會自動寄邀請。
- 註冊後驗證本人電郵、登入及確認當前資料說明；找回沿原生流程並撤銷舊會話。驗證／找回回到同源的/?account=verified或/?account=reset，畫面只說已受理，不保證郵件送達。
- 本人下載使用固定manifest及有界資料頁；失效歷史會明示不可用，並非所有歷史正文均可匯出。模型key、密碼hash、session及渠道secret不回傳。大量資料的頁面呈現沿exportPage分批，不能把已讀前綴說成完整下載。

上述 SMTP／Compose 是現有實作，未配置時仍須拒絕啟用，不因新方案而放寬。後續已選 Firebase Auth／集中服務，不再把購置 SMTP 當新目標前置；邀請初期 10 帳號及備份 14 天政策已定，實測預算／切換仍待核准。A08 本機 SMTP 不代表 Firebase 驗證／找回或公開送達已驗證。


<a id="firestore-deployment"></a>
## Firebase 正式接點及切換門檻

採 [ADR-022](DECISIONS.md#adr-022)／[P2-F01～F08](../PLAN.md#p2-firestore-migration)。Firebase API 由 `server/firebase-main.ts` 啟動，worker 由 `server/firebase-worker-main.ts` 啟動；共用 [Dockerfile](../deploy/firebase/Dockerfile)。舊 npm／Compose 的 SQL 路徑只保留至 F08 退役，不能用它部署新 Firebase 服務；已實作接點不等於真服務驗收通過。

- Firebase Hosting 發布同一 frontend/dist 及 Push service worker；同源 /api 轉 Cloud Run，保留域名、設計與前端 owner。保留直接原 API 的本機開發 adapter，不能換成合成成功。
- Cloud Run API／私有 OIDC worker、Firestore Standard、私有 Storage、Tasks／Scheduler；request-based、min instances 0、明確 max／佇列速率。沿平台 ADC／受保護 secrets，不在前端 bundle 放服務帳戶、key 或 private bucket token。實際 hostname／DNS 切換與資源建立另按批准進行。
- AuthServiceOwner 接 Firebase provider 的登入／驗證／找回及 Server __session，邀請、政策、家庭／私人 scope 仍 Server 權威；不要求用戶配置 Firebase。依 ADR-022 建立新的受邀 Firebase 身份，不匯入舊帳戶或私人資料；不讓舊 cookie 自動續命。
- Agent 由 202／runId／原操作受理後讀同一結果，避免 Hosting 60 秒；頁面沿現有 queued／running／terminal／unknown／cancel 狀態。私有回應 no-store，切換帳戶／孩子清理快取與遲到回應，不重新設計頁面。
- 保留各領域功能／權限、opId／版本／changes 游標、照片、來源、文件／PDF、本人通知與可選 key。Tasks 取代 pg-boss 不改收到／完成和未知不重發；檔案由授權 API 提供，不讓永久公開連結繞過撤權。

F02 先合成真雲端切片；F07 驗全功能對照、14 天配對恢復及 Firebase 相容應用版本回退，F08 再核准窗口切換。DB／worker／入口只允許一套主寫；回退映像仍懂 Firebase Auth／journal。最後才收束舊 VM／磁碟／IP。#140 的有效修正與未通過 Agent 流程另由 PLAN 追溯，不把新部署規劃當作已上線或以切片代替正式成果。


F02 的同源路由採 [Hosting REST config](../deploy/firebase/hosting.config.json)，只代理 `/api` 到 API，不公開 worker。前端建置設定 `EXPO_PUBLIC_AUTH_PROVIDER=firebase`、`EXPO_PUBLIC_API_BASE_URL=/api` 及 `EXPO_PUBLIC_FIREBASE_API_KEY／AUTH_DOMAIN／PROJECT_ID／APP_ID`；這些 Web SDK 公開識別不含 Admin 憑據。 使用明確傳入的建置環境，切換身份供應商時執行 `expo export --platform web --clear`；建置 exit 0 不足以允許發布，須核對輸出 bundle 的 provider 與四項公開 Firebase 設定、HTML 實際引用及同源 `/api`。設定缺失須停止發布；不能把舊身份接點的回應當作 Firebase 已接通。API／worker 使用同一明確的 `GCP_PROJECT_ID`、`FIREBASE_DATABASE_ID`、`FIREBASE_NAMESPACE`、私人 photo／erasure buckets、同源 `SERVER_ORIGIN／WEB_ORIGIN` 及固定 secret version。共用權威資料的 API／worker／Auth blocking function 各須固定部署來源，並核對目前資料包絡的 reader 相容；更新 API 映像不代表 blocking function 已同步。啟用電郵與 worker 各有獨立 gate，不以已部署自動啟用。實際資源／revision 及費用觀察留 STATUS／驗收證據。

精確時間的 Firestore native export 必須先讀回來源庫已啟用 PITR、`earliestVersionTime` 及當期費用，再選有效的整分鐘 `snapshotTime`。一般讀取可取過去一小時並不代表未啟用 PITR 也可作時間點匯出；不能移除快照／inventory 斷言來繞過此門檻。PITR 儲存獨立計費，即使當日關閉仍可能按一天收費；隔離驗收的啟用及關閉須遵守本批範圍／預算，不能轉成持續營運授權。[時間點匯出](https://firebase.google.com/docs/firestore/manage-data/export-import#export_from_a_pitr_timestamp)、[PITR 計費](https://firebase.google.com/docs/firestore/pricing#pitr-data)。

`node scripts/firebase-recovery.mjs <command>` 是明確 operator 入口，只從 stdin 接收有界 JSON；可暫停、啟動／查回原生匯出匯入、保存配對 manifest 及在隔離庫套用還原。另需明確 `FIREBASE_RESTORE_DATABASE_ID` 和 `FIREBASE_STORAGE_KEY_VERSION_REF`；不掛 API／worker，不具恢復流量命令。演練先停排程／queue、來源 authority，再確認來源 API／worker 及 journal IO 已實際停止；請求逾時或六分鐘等待不代替停機證據。原子套用成功仍保持 `applied-paused`，開放前另核最新刪除、Auth、附件／索引及部署 gate。
