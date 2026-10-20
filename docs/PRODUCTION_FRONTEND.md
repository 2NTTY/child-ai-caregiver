# 正式 Web 前端與功能接點

本頁說明正式入口、啟動／部署及仍未支援的內容；工作狀態只看 [PLAN](../PLAN.md#active)，實際部署以 [STATUS 日期觀察](../STATUS.md#deployment) 為準，原 [INT-W07 證據](../artifacts/verification/INT_W07_CHECKS.json) 保留。不是另一份產品需求或測試清單。

## 入口與日常開發

- 正式網址：**https://ex-machina.eu.org**。`frontend/` 是正式 Expo Web 應用，使用已確認的版面、互動及美術；根 `app/` 不再是正式 Web 產物。
- Node 24.19.0／npm 11.8.0；根目錄 `npm ci` 使用唯一 lockfile。按 `.env.example` 配好 Firestore、Firebase Auth 公開應用配置、私有 Storage 及工程外密鑰，`npm run server` 啟動 API；`npm run web` 只啟動 Web 開發程序。正式身份接線要求同源，完整本機驗收亦須用反向代理把 Web 及 `/api` 放在同一 origin；直接使用兩個開發端口不算已接通登入。公開部署使用同源 `/api`。密鑰不可放在 `EXPO_PUBLIC_*`。API／worker 只接受 Firestore，缺配置即拒絕啟動，不回退 SQL。
- `npm run build:web` 匯出 `frontend/dist`，並複製 Push service worker 及許可。Docker `web` target 經 Caddy 供應這份產物，`/api/*` 轉到同一 API。
- 舊根入口及專用Panel／runner已退出現行開發路徑，原碼見[可恢復歸檔](../_archive/legacy-web-2026-10-07/README.md)；legacy Web/build/test命令明確停止。有效 controller、API client、收據及權限處理繼續共用，沒有為新頁另建業務資料庫。

## 使用方式及共用資料

主要流程是「與 Agent 說 → 查看實際結果」。本人先在對話內開啟相關普通操作的預授權；普通記錄／私人交代及本人提醒依範圍執行。重要事項、共享擴大、來源摘錄及超出授權的動作仍要確認。待確認索引獨立於近期聊天頁數；過期項保留查核入口，不繼續執行舊版本。

| 功能 | 正式頁面／對話接點 | 權威及必要界線 |
|---|---|---|
| 身份、孩子 | 登入、設定及孩子選擇 | Server session／本人空間；登出及切換清理舊投影，家庭多人待 P4 |
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

### 本人模型設定

相容 Server／客戶端更新後，在「設定 → 本人模型」選個人模式、Google 服務及模型，填入 key、調整限制及背景授權，再保存。Web／Android 使用同一帳戶設定；key 送出後清空且不讀回。右方顯示 Server 的實際生效值，保存不清零用量。這是操作方法，實際發布狀態仍以 STATUS 為準。

「檢查已保存密鑰」及模型目錄只讀 metadata，不執行生成；遇版本衝突先重讀，結果未知用「查回原操作及目前設定」，不重送 key。Vertex Express 尚未接 metadata／embedding，頁面會說明限制；不能把已保存 key 當成知識檢索已可用。本機 ADC 只在[開發入口](AGENT_LOCAL.md)配置，不上傳到此表單。

## 部署及回復（以下保留 INT-W07 歷史版本）

目前部署版本以 [STATUS](../STATUS.md#deployment) 的具日期觀察為準，不把下列053658b當最新版本。以下命令只適用該歷史 checkout；現行 `deploy/p1/compose.yaml` 已改為純 Firestore 入口，不可疊加舊 SQL／P2 overlay。

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
## 邀請制服務與 Web 管理

現行身份為 Firebase Auth，沿原登入畫面、邀請資格、電郵驗證／找回及逐裝置撤銷；舊 Better Auth／SMTP／SQL 邀請命令僅屬歷史，不用來管理目前站點。

`/admin` 是獨立 Web 管理頁，不需建立或選擇孩子。已授權管理員亦可從 Web 設定進入；原生 App 沒有管理入口。首位管理員由營運者核對 Firebase 帳號的 emailVerified／disabled，將實際 UID 寫入工程外 `firebase.env` 的 `YUBAN_ADMIN_UID`；預設空值拒絕，修改配置後重建 API。不要用電郵、家庭角色或前端表單替代 UID 授權。

1. 以本人網站帳號登入，開 `/admin`；寫入前用本人密碼重新驗證（五分鐘有效）。
2. 邀請輸入完整電郵和 1–90 天有效期，確認發出；複製 `/login` 網址自行傳給對方。未使用可續期／撤銷，已註冊只能讀。舊資格用完整電郵查找；列表不是全部帳號目錄。
3. 平台設定顯示目前版本並可保存修改。以後台顯示的已保存 policy 為準；每日呼叫、每次生成／工具／查詢 embedding／執行秒數均在同一處修改。合法範圍集中於 `src/shared/agent-run-limits.ts`，不是另一份運行設定；尚未初始化才使用程式預設。本人 key 共用每日保護上限獨立，原個人 key／限額及背景同意保持原服務管理。
4. 新運行採新設定；暫停在下一次平台模型／embedding 前核對，不撤回結果或一般通知。資料讀取失敗不放寬。每日按 UTC 換日（香港 08:00），計生成及查詢 embedding 嘗試，不是聊天句數；不等於帳單或硬性停費保證。
5. 結果未知先按「查回原操作」，必要時明確重送同一 ID；不要另建等價操作。後台只提供有界用量／管理紀錄，無清零、刪紀錄、個人配額覆寫、任意模型或私人資料瀏覽。

緊急 bootstrap 保留 `node scripts/firebase-control.mjs invite`（或 `npm run account:invitation`），**從 stdin 接 JSON**：`{"email":"parent@example.invalid","expiresAt":"<future ISO time>","operationId":"<UUID>"}`，不是舊的 `issue <email> 7` 位置參數；需原受保護 Firestore runtime 配置。operator 的 `revoke-invitation` 可能連帶撤銷已註冊帳號，不當作後台邀請撤回用法。後台使用交易內「未使用」檢查的另一受限入口。

本人下載仍沿固定 manifest／有界資料頁，失效歷史明示不可用；不輸出 key、session、密碼或渠道秘密。實際部署、管理綁定與未驗項見根 STATUS／PLAN，介面存在不等於已授權所有帳號。


<a id="firestore-deployment"></a>
## 原網站的 Firestore 交付接點（遷移中）

採 [ADR-024](DECISIONS.md#adr-024)／[F01～F08](../PLAN.md#p2-firestore-migration)。保留 ex-machina.eu.org、原 VM、Node／Compose／Caddy、frontend/dist 及 Push service worker，不把 Hosting 或 Cloud Run 當交付前置。資料接線及原站切換狀態只看根 PLAN／STATUS；原網站不因 master 更新而自動升級。

- Firebase Auth 復用既有登入畫面／owner、__session、邀請、政策及逐裝置會話；乾淨起點不搬舊帳號／私人資料，舊備份保留。身份與孩子範圍由 Server 核驗，登入者不需配置 Firebase。
- Firestore／私有 Storage 沿同一權威、應用加密、版本／opId／changes 及授權下載。VM 附加身份／ADC 與受保護設定繼續使用，密鑰不進前端或模型。
- Tasks／Scheduler 呼叫 VM 的受驗證工作入口，應用核 OIDC、固定 audience 及服務身份；保留 lease／generation、收據及 unknown 不重發。不能僅暴露一條公開 worker URL 便視為安全。
- 互動沿現有請求、進度、取消及結果接口；不為 Hosting 60 秒限制強制改協議。需要排程的工作先持久受理；私有回應 no-store，身份切換清除快取及遲到回應。
- 依 [ADR-025](DECISIONS.md#adr-025)，F02～F07 先完成原 VM 資料接點及全部正式 SQL 退出，保留既有 API／頁面相容性；F08 再驗收受邀用戶並更新原站。不逐資料包切站或重跑完整用戶流程。未遷移功能明示，不用假成功或空資料掩蓋；不維持兩套產品網站。
- 每次部署核對 VM 實況／期限、相容配置、資料與備份及 in-flight 工作，允許短暫維護；只有一套主寫與排程。已有新寫入只能回退相容 Firebase 應用版本或隔離還原，不能切回 SQL 舊快照；新刪除／撤銷／收據不可倒退。已寫入語音訊息、轉錄或原生通知綁定後，回退的 API／worker 仍須識別這些 schema 及清理義務；舊 Web／APK 可保留相容使用，不代表可以盲退不識別新資料的 Server。

F07 的資料及 SQL 退出證據已交付；F08 原站使用 Firestore，額外 Hosting 站點與 Cloud Run API／worker 已按用途核對後清理。**保留原 VM／磁碟／IP、Firebase Auth 所需函式、有效 Firestore／Storage／Tasks、刪除日誌及備份**；不以名稱相似整批刪除。實際版本與尚未完成項見根 PLAN／STATUS，A09／F02 舊失敗保留，不以基建切片代替產品成果。

### 原 VM Firestore 組裝

2026-10-15，原站 API／worker／Web 已更新為 `opt-b1d1565`，程式源為 b1d1565（#226，master 99f53df），Prompt Pack 0.1.43；包含 #213 登入及 OPT／LAY 修改。沿固定版本 Node／npm 建置 Web，依賴未變，Server 及 Web 以已核 hash 的小型層疊加既有映像，沒有傳送密鑰或 ADC。三服務健康、原生新索引及公開產物／SSE 已核；一次合成摘要／聊天共兩次生成，沒有通知、embedding 或調高配額。[交付 EV](../artifacts/verification/P2_OPT_DELIVERY_20261015.json)；舊 ADM01／review 證據保留，不能當全面回歸。

回退配置保存在 `/etc/yuban-p1/firestore/compose.env.before-opt-b1d1565`，舊映像未刪。**OPT04 摘要批次與 OPT05 卡片寫入後，舊 API 的 strict schema 不能保證讀取新格式。** UI 故障可單獨恢復舊 Web 並保留新 API／worker；後端故障先暫停受影響入口／worker，使用保留新格式 reader 的相容修正。不能直接還原舊 compose.env 便宣稱資料相容，也不能用舊資料快照覆蓋新收據／刪除。

現場部署目錄 `/opt/yuban-firestore-cce4667/deploy/p1`；受保護設定在 `/etc/yuban-p1/firestore`，原渠道檔案在 `/etc/yuban-p1`。部署疊加 `compose.firestore.channels.yaml`，掛載設定不代表已准外發。原 Caddy 固定 IP 為 `172.30.51.3`，動態 API／worker 池為 `172.30.51.8/29`、共同子網 `172.30.51.0/28`；調整子網時須同步核對 `P1_DYNAMIC_RANGE` 與 `P1_PROXY_IP` 不重疊，避免重建時動態容器先佔用 proxy 地址。

ADK 原生 session 的 `events` 子集合需 `timestamp + id` 同向升／降排序索引，已加入 `deploy/firebase/firestore.indexes.json`；部署前須等相關索引 READY。業務列表索引全齊不代表 Agent 協定 session 已可讀，缺索引會在生成前安全停止。此修正不變更 session／業務權威或配額。

`deploy/p1/compose.firestore.yaml` 是同一 `yuban-p1` 專案的替代組裝，不能與 SQL Compose 疊加。沿用 80／443、Caddy 資料 volume 和前端；API／worker 只在內部網絡提供服務。`/internal/task-reminders`、`/internal/task-dispatch` 與 `/internal/product-work` 只轉送固定 worker 入口，由 worker 驗 OIDC issuer／audience／期限／service account；其他 internal 路徑拒絕。健康檢查只查程序存活，不查資料庫或觸發工作，也不表示全部產品功能可用。

沿用既有 Push／Telegram 時，另外疊加 `deploy/p1/compose.firestore.channels.yaml`，`P1_CHANNEL_PRIVATE_DIR` 指向既有受保護的 `vapid.json`／`telegram.json` 目錄；只掛 API／worker，不能加入 build context。此 override 不含 SQL 或本機附件 volume，也不自動開啟外發；`firebase.env` 的渠道旗標及產品本人授權仍須符合正式交付範圍。主 Compose 單獨運作時不要求有渠道秘密。

營運者在工程外建立受保護的 `firebase.env`（按同目錄 `firebase.env.example`）及原 Firestore 加密 `storage.key`，設定 `P1_PRIVATE_DIR`、`PUBLIC_HOST`、`RELEASE_TAG` 與四項 Firebase 公開 Web SDK 建置參數，再從根目錄使用：

```sh
docker compose -f deploy/p1/compose.firestore.yaml config --quiet
docker compose -f deploy/p1/compose.firestore.yaml build api web
# Only after the package deployment/backup gates are met:
docker compose -f deploy/p1/compose.firestore.yaml up -d --no-build
```

不要輸出完整展開設定到日誌，不上傳 ADC、密碼或密鑰到映像／Git。VM 使用附加身份的 ADC；讀取現有 Firestore 資料必須掛原相容密鑰，不能拿舊 PostgreSQL 的另一把 key 代替。F03 局部接線不代表可切站；先完成 F07 零 SQL 資料門檻，再於 F08 核對受邀用戶及更新原站。切換前停止舊 worker、保留原備份及舊映像，停止已退出的 SQL 服務；不要 `down -v` 或刪原資料 volume。舊資料搬遷不是門檻；worker、電郵及 authority 預設保持關閉，按實際驗收／交付範圍個別啟用。

`API_UPSTREAM`／`FIREBASE_WORKER_UPSTREAM` 可配置服務地址；目前保持單副本，不設黏性會話或新負載平衡器。跨副本准入／取消與完整 worker 恢復仍由 F03／F06 驗證。VM IAM 至少按命名資料庫、私人物件 bucket、只新增／讀取的刪除日誌、指定 queue／OIDC 身份及現有 Session 自訂角色核對；不給 Owner／Editor，也不因啟動此 Compose 自動授權。

### Auth 回跳與附件清理

Firebase authorizedDomains 須包含原網站主機名，否则重設及驗證信回跳原站會被拒絕。session 期限按已驗簽 iat／exp 限五天，發行時間與 Server 容許最多五秒差距；原近期登入、撤銷及本人資格核對不變。

受信 operator 可執行 scripts/firebase-photo-cleanup.mjs，傳入工程外 JSON 路徑；只含原 scope、photoId、operationId。先核 tombstone／journal，再刪 descriptor 的精確 generation；unknown 保留待處理，成功才交易釋放容量。未确认上載不猜測清空，排程與恢復由 F06 承接。此入口不向模型／公共 API 暴露，備份和 soft-delete 保留期不變，不宣稱所有備份密文立即消失。

### 即時聊天傳輸

原 reply 同時保留 JSON 與 `Accept: text/event-stream`。Node transport 直接以有背壓的 stream pipeline 寫入，不先 arrayBuffer；SSE 設 `private, no-store, no-transform`。Caddy 2.11.4 原生對 `text/event-stream` 即時 flush，encode 遵守 no-transform，故沿原 Caddyfile、不額外服務或全站關閉壓縮。部署核對原代理鏈仍保留這些 header；固定版原生能力與 2026-10-15 一條正式 HTTPS SSE 已核；不代替瀏覽器全面相容性驗收。中斷不自動取消原運行或重新發問，原取消 API 另行處理。

### 復用 F02 的建置及恢復接點

前端建置設定 `EXPO_PUBLIC_AUTH_PROVIDER=firebase`、`EXPO_PUBLIC_API_BASE_URL=/api` 及 `EXPO_PUBLIC_FIREBASE_API_KEY／AUTH_DOMAIN／PROJECT_ID／APP_ID`；這些 Web SDK 公開識別不含 Admin 憑據。 使用明確傳入的建置環境，切換身份供應商時執行 `expo export --platform web --clear`；建置 exit 0 不足以允許發布，須核對輸出 bundle 的 provider 與四項公開 Firebase 設定、HTML 實際引用及同源 `/api`。設定缺失須停止發布；不能把舊身份接點的回應當作 Firebase 已接通。API／worker 使用同一明確的 `GCP_PROJECT_ID`、`FIREBASE_DATABASE_ID`、`FIREBASE_NAMESPACE`、私人 photo／erasure buckets、同源 `SERVER_ORIGIN／WEB_ORIGIN` 及固定 secret version。共用權威資料的 API／worker／Auth blocking function 各須固定部署來源，並核對目前資料包絡的 reader 相容；更新 API 映像不代表 blocking function 已同步。啟用電郵與 worker 各有獨立 gate，不以已部署自動啟用。實際資源／revision 及費用觀察留 STATUS／驗收證據。

精確時間的 Firestore native export 必須先讀回來源庫已啟用 PITR、`earliestVersionTime` 及當期費用，再選有效的整分鐘 `snapshotTime`。一般讀取可取過去一小時並不代表未啟用 PITR 也可作時間點匯出；不能移除快照／inventory 斷言來繞過此門檻。新匯出仍限最近 55 分鐘；已完成匯出如遇 operator 中斷，可在同一快照仍受 PITR 保留時繼續封存，上限七天，由 Firestore 核實實際可讀時間；不能換成目前資料或另開匯出來冒充原結果。PITR 關閉前須完成封存，關閉後重新啟用不會取回舊歷史。PITR 儲存獨立計費，即使當日關閉仍可能按一天收費；隔離驗收的啟用及關閉須遵守本批範圍／預算，不能轉成持續營運授權。[時間點匯出](https://firebase.google.com/docs/firestore/manage-data/export-import#export_from_a_pitr_timestamp)、[快照續讀](https://docs.cloud.google.com/firestore/native/docs/use-pitr#read_pitr_data)、[PITR 計費](https://firebase.google.com/docs/firestore/pricing#pitr-data)。

`node scripts/firebase-recovery.mjs <command>` 是明確 operator 入口，只從 stdin 接收有界 JSON；可暫停、啟動／查回原生匯出匯入、保存配對 manifest 及在隔離庫套用還原。另需明確 `FIREBASE_RESTORE_DATABASE_ID` 和 `FIREBASE_STORAGE_KEY_VERSION_REF`；不掛 API／worker，不具恢復流量命令。演練先停排程／queue、來源 authority，再確認來源 API／worker 及 journal IO 已實際停止；請求逾時或六分鐘等待不代替停機證據。套用以加密計劃及游標分批交易提交；原命令可續接，不能換 restore ID 或覆蓋另一個計劃。全部內容與最新 Auth／journal 核對後才標 `applied-paused`；開放流量仍是獨立步驟。

還原保留聊天、文件、私人來源、引用、收據及配額，不恢復裝置會話／ADK 協定執行；模型與通知的未知結果不重發。待確認重新核對，Push／Telegram 重新綁定及聯絡授權後才可外發。孩子／帳戶刪除日誌先排除內容，來源仍有未完成的永久附件清理則暫停還原，先以原日誌完成清理；不丟掉該責任來宣稱成功。快照與還原盤點目前均有明示 2,000 筆／32 MiB 操作上限，超限停留原進度，不截斷資料；大規模串流盤點另按容量需求處理。

現行標準啟動使用 `npm run server`／`npm run worker`，或 `docker compose --env-file <protected-compose-env> -f deploy/p1/compose.yaml <command>`；根 Compose 引用 `compose.firestore.yaml`，映像不安裝 SQL 生產依賴。`storage:backup`／`storage:restore` 導向上述 Firebase operator；`db:migrate`／`storage:encrypt`／舊 `setup:local` 明確拒絕，不會操作舊 SQL。歷史 SQL 程式及驗收仍可按固定 Git 版本追溯，舊資料 volume／備份不由這些命令刪除。

### 原生每日備份與隔離還原

日常依 [ADR-026](DECISIONS.md#adr-026) 使用原生每日排程，retention 為 `1209600s`（14 天）；不執行上面的 pause/export，也不開啟 PITR。營運者以 Firestore Admin 的 `backupSchedules` list/create/get 管理，先讀既有 daily 排程，沒有才建立 `{"retention":"1209600s","dailyRecurrence":{}}`；不可重複建立另一份排程。現場 schedule resource 及首份備份狀態見 F08 EV。平台決定時間，設定完成不代表首份備份已產生。[排程 API](https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.backupSchedules/create)

只用 operator 身份還原，另指定全新、未掛產品服務的 `FIREBASE_RESTORE_DATABASE_ID=yuban-restore-<unique-name>`，地區同來源；保留現有 key version。`scripts/firebase-recovery.mjs` 增加三個命令，仍從 stdin 讀 JSON、不輸出正文：

1. `start-managed-restore` 接 `{ "backupName": "projects/<project>/locations/asia-east2/backups/<id>" }`，校驗來源庫 UID、READY／有效期及新目標不存在後，只建立一次 native restore。未知結果沿原目標／operation 查回，不能改名重試。
2. `get-managed-restore` 接 `backupName`／`operationName`。原生完成仍不是可開放狀態：需要先停來源寫入、queue、Scheduler／worker 和 journal IO，authority 暫停及排空；不得把六分鐘 guard 當作停機證據。
3. `apply-managed-restore` 接 `backupName`、`operationName`、固定 `restoreId`、已暫停的 `sourceGeneration`。核對原生 operation、來源／目標 UID、snapshot 與盤點，再沿現有分頁 restore；checkpoint 綁原生來歷 digest，最終仍為 `applied-paused`。不自動更新網站配置、Auth、Rules、TTL 或 IAM。

原生 DB 備份不包含 Storage。讀取同版 metadata 的不可變照片；如只有 soft-deleted 密文，還原入口本身先完整讀取並驗證獨立 journal，拒絕帳戶／孩子／照片永久刪除，再重查來源暫停。只能對原 generation 使用 `ifGenerationMatch=0`，不能蓋過現有物件；回覆未知只讀回同一位置，核對原 hash，再由既有 decoder 驗密文／內容並重加密至新 epoch。journal 無法完整讀取、過期、hash 不符或來源變更均停止。私人 bucket 的 soft-delete 至少 14 天；不可把較短的預設值當已覆蓋備份。既有 paired manifest 仍適用，hold 到期不等於自動刪除；只能按指定 backupId 核對期限後清理，不能碰 `erasures/v1/`。

使用者已將原生首份備份／真還原驗收延後，按 [PLAN 待驗入口](../PLAN.md#p2-backup-followup)續做，不阻塞本次功能交付。原生備份、真還原及附件復原的實際證據按 F08 EV 分列；本機檢查不代替這些證據。還原目前仍要求可核對的來源權威及清理狀態，不宣稱來源整庫消失後可無條件自動恢復。

<a id="android-foundation"></a>
## Android 共用入口與建置基礎

產品範圍／進度只見 [根 PLAN Android 計劃](../PLAN.md#p3-mobile)。原 Web／API 網址及設計不變；Android 使用同一 `frontend/`、正式 owner 與 Server，平台 adapter 位於 `production-transport.native.ts`，Web 沿同名共用入口。身份協議見 [API](API.md#native-session)。原生管理後台維持不開放。

- 在 `frontend/` 使用固定 `eas-cli@24.14.0`；`app.json` 固定 Android `org.yuyoufang.app`、scheme `yuyoufang` 及 runtime fingerprint，`eas.json` 保留 development／preview／production channel。固定 Node 24.19.0、npm 11.8.0。
- Expo 帳號由本人登入，不把密碼／token 放入專案；公開 project ID 固定於 `app.json`，可由 `EAS_PROJECT_ID` 覆蓋；現行專案為 `@2ntty/yuyoufang`。沒有 project ID 不允許雲端 build；本機無連結時 Updates 關閉，不假稱 OTA 已配置。
- `EXPO_PUBLIC_AUTH_PROVIDER=firebase`、API base 使用原站 HTTPS `/api`；Firebase project／authDomain／appId 沿同一專案，缺任何公開設定便停止雲端 build。Android 必須使用相容原生 JS SDK 的專用 Firebase Auth 公開 key，API allowlist 只需 `identitytoolkit.googleapis.com`／`securetoken.googleapis.com`；不可直接沿用限定 HTTP referrer 的 Web key、移除其限制或偽造 Referer。SDK 未提供 Android package／cert headers，不把原生 SDK 的 application restriction 設定當已相容。公開 key 不授予 Firestore、Storage、模型或 Admin 權限；產品准入與 Server 權限仍逐次核對，配額不提高。原生 key 已建立並配置至 Expo preview，尚待 APK 真登入；production 設定不因 preview 完成而自動就緒。
- 公開 config 會進入 bundle，不應標為秘密來誤以為客戶端不可讀；ADC、私鑰與服務端 secret 不傳至 Expo。
- `.easignore` 限定上載共用前端、client／shared、資產及依賴／授權。首次雲端建置前必須核對實際 archive，排除 Server、prompt、測試資料、私人協作文件及憑據。`eas build:inspect --platform android --stage archive --profile preview --output <new-local-directory>` 只準備本機 archive，但 CLI 仍需要 Expo 登入。EAS 會先以不含尾斜線的目錄名判斷是否遍歷；allowlist 須放行目錄本身，不能只以 `!/frontend/` 等模式假定子檔已納入。
- `npm run build:android-ui --workspace frontend` 只驗 JS／Hermes bundle，不會產生可安裝 APK。EAS preview／production 使用 APK；簽署、真機登入、OTA 與更新證據另列，不因 bundle 成功當成品。
- 先部署相容的 `/api/auth/native-session` Server，再分發 Android；既有 Web Cookie 及 API body 保留。未支援原生交換的 Server 無法供新 APK 登入，不能用假 Origin 補救。

`mobile:release` 的本機工具見下節；語音／FCM、完整跨端前景同步及更新交付按根 PLAN 的實作／部署／真機門檻分開，不以工具存在宣稱已發布。

Windows 執行 EAS 前，在實體 dependency installation 的完整建置副本執行 `npm run mobile:prepare`；不要用指向另一 worktree 的 `node_modules` junction。此命令只針對固定 `@expo/fingerprint` 0.20.13 loader 補 glob 比對前的 POSIX 路徑正規化，版本或原文改變即停止；Linux 不修改。保留原生內容 fingerprint 與雲端相等檢查，不使用忽略全部 native 檔案或硬填 runtime 的替代。後續 `mobile:release` 應調用同一入口。


### Android FCM 建置與部署接點

共用設定卡在 Android 使用原生通知 owner，在 Web 沿原 Web Push。`expo-notifications` 的 `defaultChannel` 固定為 `yuyoufang-reminders`；包含本套件／plugin 的版本需要新 APK，不能只發 OTA。

建置前把同一 Firebase 專案、package `org.yuyoufang.app` 的 Android 描述檔放工程外，經 `ANDROID_GOOGLE_SERVICES_FILE` 指向；EAS 使用同名 file 環境設定。`app.config.js` 核對 project／package，缺檔則停止 Android 雲端建置；JSON 不入 Git／一般上載 archive。此原生 FCM 描述檔與既有 JS Firebase Auth 公開 key 分開，不能移除 Web key 的限制或把缺 FCM 配置當成已支援。正式下載／設定應核對 Firebase Installations／Messaging 所需限制，不盲目沿用只允許 Auth 的 key。

Server `ANDROID_PUSH_ENABLED` 預設關閉；準備同一 GCP project 的 FCM HTTP v1 API及 VM 身份最小發送權限後，才在相容 API／worker 設定中開啟。先套用該版新增 Firestore 索引，再部署同版服務；不放服務帳號 key 到 App。一般測試仍須明確本人操作；不得在保存設定或建置後自動發訊息。

原生配置／權限、新索引、部署、真機及真 FCM 是否已完成只見根 PLAN／驗證證據；bundle 或本機合成通過不能替代這些門檻。


<a id="mobile-release"></a>
## 共用 Web／Android 的固定發布入口

從根目錄執行 `npm run mobile:release -- --plan`。預設 preview，純本機：讀 Git 差異、現有 app／EAS 配置及可用的官方 runtime，不登入、不上傳、不建置、不發布。未知路徑明列待 review；缺本機依賴或 Android Firebase 描述檔時，不能聲稱 OTA 相容。文件改動不觸發建置，Server 改動不要求重發 App；`src/shared` 的相容契約改動須先交付 Server。

### 每次修改後的短流程

1. 在目前分支完成所需修改及 review，保留單一共用畫面／owner；不另外重畫 Android。只跑本次必要檢查。
2. 執行 `npm run mobile:release -- --plan --since <上一交付的Git-SHA>`。已有正式 build 記錄時可加 `--baseline <build-記錄路徑>`，會核對專案、profile、channel、package、已完成狀態及 fingerprint。
3. 正式執行要求乾淨提交、實體 dependency installation（不能指向另一 worktree 的 junction）、固定 Node／npm／EAS，及工程外 Web Firebase 環境檔。Android 的 `ANDROID_GOOGLE_SERVICES_FILE` 是已核對的同專案描述檔，不能進 Git／上傳原始碼封包。`mobile:prepare` 沿固定 Windows fingerprint 修正，不能手填舊 runtime。
4. 共用修改用同一入口準備 Web 及 Android；例如 `npm run mobile:release -- --execute --channel preview --build-id <目前APK的EAS-build-ID> --web-env-file <工程外Web環境檔>`。它先產生 Web 產物，再核對官方 runtime：相同才 OTA，不同便 APK；沒有 baseline 不能猜 OTA。用 `--action update` 可要求不相容即停；`--action build` 明確要求新 APK。
5. Web 使用 `frontend/dist`，沿本文件原 VM／Caddy 部署及回滾接點傳送；工具目前只把 Web 標為 **prepared-deployment-pending**，不會冒稱網站已更新。部署私人產物、API 相容修正、新索引及雲端費用依有效授權處理。
6. build 使用固定簽署（`--freeze-credentials`）、遠端遞增 versionCode、`--no-wait`；排入 EAS 不等於 APK 成功。完成後執行 `npm run mobile:release -- --record-build <ID> --channel preview`，只讀 EAS 結果並保存供下次 plan 使用的精簡記錄。首次新 APK 升級交付核對實際產物的 applicationId、遞增 versionCode 及原證書，以 Android 官方 `apksigner verify --verbose --print-certs` 驗證簽署；不只相信 build metadata。覆蓋安裝及裝置結果仍須實測。

Web 環境檔只讀 `EXPO_PUBLIC_*`；工具在獨立程序先清走 Android 配置，避免兩端公開 Firebase key 混用。Android 執行才讀指定 EAS environment；不輸出其內容。`--plan` 不使用 `eas fingerprint:generate`，因固定 CLI 的該命令會上傳 fingerprint；沿 `expo-updates` 的本機 resolver 取得與 runtime 相同的判斷。

Android 匯出亦須合併 `frontend/eas.json` 的 `build.base.env`，包含正式身份供應商與 API 地址，並設定相應的 `EAS_BUILD_PROFILE`／`EAS_BUILD_PLATFORM` 讓 `app.config.js` 驗證完整配置。`mobile:release` 已執行此步；單獨 `eas env:pull` 的檔案不包含全部 profile 值。若因已有產物使用 `--skip-bundler`，須先核對原匯出沿用同一配置合併與驗證，不能只憑 runtime 相容便發布。

### 正式發布、回退及失回應

- production 必須同時指定 `--channel production --confirm-production`，不沿 preview 默認發布。兩個環境都使用固定 EAS 專案／application ID／channel；EAS 審批、額度及私有封包上傳授權不由這個旗標代替，不購買方案、不每次 commit 建置。
- 相容回退：`npm run mobile:release -- --execute --action rollback --channel preview --build-id <已安裝build-ID> --rollback-group <原update-group-ID>`。先查同專案 branch 的最近最多 50 組，核對 Android／同 runtime，再沿原生 `update:republish`。找不到便停，不搜尋全部歷史或強制跨 runtime。回退只改客戶端，不還原業務資料。
- 每次結果在 `.cache/mobile-releases/<Git-SHA-channel-action>/release.json`：保留 SHA、build／update ID、runtime、App版本、Web產物與待部署狀態。日誌只在同一 ignored 目錄，診斷先看末段；manifest 不保存 key、環境正文、signed URL 或完整雲端日誌。
- 雲端呼叫前保存 submitted。回應丟失／失敗時保留 unknown，**不自動重新發布**；先在原 EAS 專案按 ID／SHA 查原結果。同一提交／channel／action 不自動建立第二次操作。
- OTA 沿現有 ON_LOAD／下次安全啟動套用；工具不呼叫 App reload，不在聊天、確認或 unknown 期間強制重載。

本文件只定義固定交付方法；實際 EAS／部署／真機／OTA 狀態與證據以[根 PLAN](../PLAN.md#s04-w03)為準。APK 檢查使用[Android 官方工具](https://developer.android.com/tools/apksigner)，不修改或重新簽署已交付的 APK；Windows `aapt` 若不接受中文絕對路徑，從專案目錄傳入相對路徑。
