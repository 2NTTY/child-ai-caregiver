# 本機 Agent 開發入口

使用目前分支的正式 Web、API、ADK、Prompt Pack、工具及業務服務。只有身份／資料／附件與背景喚醒接到本機環境；不是另一個測試 Agent。工作狀態及未驗項以 [PLAN](../PLAN.md#local-agent-personal-model) 為準。

## 首次準備

需要 Node 24（依根 `package.json` 的 engines）、npm 11、Java 21 或以上。執行 `npm ci` 安裝鎖定的依賴，包括 `firebase-tools 15.34.0`。第一次啟動需下載官方 emulator；毋須 Firebase 登入、雲端資料庫或網站密鑰。Java 可用獨立 JRE，透過 `JAVA_HOME` 指定，無須改系統安裝。

在工程外建立只有本人可讀的 JSON，例如 `C:\Users\你的帳號\.config\yuyoufang-local.json`：

```json
{"provider":"gemini","apiKey":"自行填入本人的 key","model":"gemini-3.1-flash-lite"}
```

PowerShell：

```powershell
$env:LOCAL_AGENT_CONFIG = 'C:\Users\你的帳號\.config\yuyoufang-local.json'
npm run agent:local
```

亦可自行在目前 shell 設定 `GEMINI_API_KEY`，但不要把實際 key 寫入共享命令、聊天、Git 或 `EXPO_PUBLIC_*`。前端不會收到模型憑證。Vertex API key 使用 `{"provider":"vertex","apiKey":"本人的 Vertex key","model":"gemini-3.1-flash-lite"}`，沿正式個人模型 adapter；環境變數則明確選 `LOCAL_MODEL_PROVIDER=vertex` 及 `VERTEX_API_KEY`。不拿 Gemini key 默認代替另一供應方式。Vertex key 的 embedding 接點仍未支援，不能以它初始化知識向量或假稱完整混合檢索可用；需要完整檢索時明確選擇本人可用的 Gemini key 或 ADC，不借平台額度。

已使用本人本機 ADC 的開發者可改用：

```json
{"provider":"vertex-adc","project":"你的模型計費專案","location":"global","model":"gemini-3.1-flash-lite"}
```

ADC 留在本機。若全局 `GOOGLE_APPLICATION_CREDENTIALS` 指向舊檔案，在上述 JSON 明確設定正確的 `adcPath`，或修正目前 shell 的變數；入口不會默默忽略失效的明確路徑。模型專案只供 Google 模型請求，資料專案始終是獨立的 `demo-` 專案。

## 開啟及修改

- 開啟終端列出的 `http://127.0.0.1:<port>`；不要另開 Expo 的直接端口。原 Web 和 API 經同一個本機 origin。
- 本地帳號為 `developer@local.yuyoufang.test`，隨機密碼保存在終端列出的 `.cache/agent-local/state.json`；這是本機合成帳號，不是正式網站密碼。正常登入、產品條款及資料同意仍經正式流程。
- 同一個明確初始化的本地帳號可開 `/admin` 調整本地限額；不授予正式網站權限，不清零原用量。
- 修改共用前端可熱更新；Windows／macOS 使用 Node 原生 `--watch-path`，只監看 `server`、`src/shared`、`prompts`，不監看依賴或本地資料。Linux 沿 Node module watch，尚未實測。Prompt Pack 仍由正式組裝器讀取；不要在有付費運行時改動程式。需要固定版本核對時可加 `--no-watch`，手動停止後重開才載入修改。[Node 原生監看](https://nodejs.org/api/cli.html#--watch-path)
- 修改程式中斷運行時，不自動重發問題；先查回原 run／收據。頁面重新讀取不代表再執行一次。
- `/__local/status` 顯示分支、SHA、dirty、模型、Prompt Pack、角色邊界；`/__local/events` 只保留最近 200 筆診斷 metadata，不輸出內部思考或私人全文。詳細結果仍從正式頁面／原 run 讀取。
- `--no-model` 只供資料／UI 開發，明確停用模型；`--no-web` 可供已有前端入口的 API 開發。沒有憑證時不使用假模型，也不借正式平台 key。

每個 worktree 有自己的專案、端口、cookie 名稱及受保護資料目錄。啟動第二份相同 worktree 會拒絕；如另一程式已佔用端口，先停止該程式，不強殺不明程序。

## 第一次準備可引用知識

先停止本地入口，再明確執行：

```sh
npm run agent:local -- --prepare-knowledge
npm run agent:local
```

這是唯一會主動初始化模型向量的命令：首批只用既有 `fhs-solid-food` 一個章節，最多一次本人憑證 embedding，零聊天生成；已存在的向量按 hash 復用。命令輸出成功後自動保存並退出，普通啟動不重做。

原文、條款與含義核對來自固定的 [seed manifest](../knowledge/local-development-seed.json) 和所指的既有證據。它是有日期、有限範圍的本地素材，不是啟動時重新抓取的最新全站知識，也沒有核准其他資料或成長執行規則。修改原文或種子版本會使舊核准失效；擴充來源沿既有 `knowledge.mjs`／來源維護管線，不把新文字自動當成已審核。

Firestore Emulator 已核實支援本次版本的 `findNearest`；使用同一向量＋關鍵詞、過濾及引用服務，不做假搜尋。無知識或本人 embedding 不可用時如實回報，不以固定答案代替。首次失敗保留原操作與用量，先診斷；不可刪除未知向量佔位來盲目重試。

## 背景、附件與收件箱

背景工作使用正式 Firestore 工作台帳、claim、租約、原收據及 consumer；本地 dispatcher 只替換 Tasks／Scheduler 的喚醒。停用模型仍保留確定性附件清理等 consumer；模型呼叫由相同的正式啟用與用量檢查控制，不是每次啟動自動跑付費驗收。

附件經原加密／hash／授權服務保存到 Storage Emulator。本版本 emulator 忽略 generation precondition，因此薄 adapter 在單一本機 runtime 內序列化每個物件、核對固定 generation；這不能作為雲端多副本競爭或 IAM 驗收證據。

驗證電郵／找回密碼由 Auth Emulator 產生本地操作連結，可在 `/__local/inbox` 查看最近 20 項；全部明示沒有實際寄出。這些連結有憑證作用，只在本機使用，不分享診斷輸出。Telegram／Web Push／FCM 保持停用，目前尚未提供其本地投遞收件箱；不回報渠道接受或收到。[Firebase 官方行為](https://firebase.google.com/docs/emulator-suite/connect_auth)

四角色使用當前分支的實際接線。基線沒有某個角色，就不能因環境啟動而宣稱四角色完成。#214／#215／#216 已依使用者明確授權 review 修正及合併，原作者保留；真背景維護缺口仍由 DEV-AGENT02 承接。編製成果必須經正式保存服務，再由原頁面讀回，不能只看模型文字。

目前接續分支及固定基線見根 PLAN；舊 `codex/dev-agent02-role-integration` 只保留先前成果及中斷證據。#214 的審核、#215 的既有文件修改工具已接正式服務，與聊天共用預算；目前編製不是所有資料類型的通用產生器。#216 的 `KnowledgeSemanticReviewPort` 仍未接真模型，`BackgroundKnowledgeMaintenancePorts` 缺持久維護用量／工作／發布組裝及觸發；正式發布在副作用前停用，不能用預設 stub 或記憶體 ledger 當完整背景驗收。環境不另造角色，也不把這個明確缺口改為假成功。

## 保存、停止與重設

輸入 `stop` 或按 Ctrl+C：停止本機 API／worker，完成 emulator 配對匯出後退出。每分鐘另做一次 checkpoint。正常重開會匯入最後完整快照；突然斷電／強殺可能丟失最近一個 checkpoint 之後的本地修改，不宣稱 emulator 等同正式資料庫的崩潰持久性。

Auth、Firestore、Storage 同存 `.cache/agent-local/export`，前一份留在 `export-previous`。本地用 `(default)` 資料庫，因固定 CLI 的標準匯出不涵蓋任意命名資料庫；正式 GCP 設定不變。

需要清除本 worktree 的合成資料時，先停止入口，再執行：

```sh
npm run agent:local -- --reset --confirm-local-reset
```

只刪這個 worktree 的 state／emulator 快照，不刪工程外模型設定或正式資料。重設後須重新初始化知識，不用重設來繞過帳目、掩蓋失敗或當作原操作恢復。

## 證據邊界

最低檢查才執行 `scripts/verify-agent-local.mjs`；啟動工具不自動跑測試。`--real-agent` 會花本人模型額度，最多一個原 run，失敗即停，原始合成結果留受保護 cache。不要例行反覆跑。

DEV02 本地整合分支另有 `--real-compose`，只建立一次原 run，在本輪新建合成文件上要求只改標題並準備確認；腳本先核對改動確為指定標題、其餘 metadata 不變，才明確接受這項合成修改，並沿新 client 讀回同一文件及未變章節。不是通用的自動批准入口，不處理家長文件或反覆重試。原訊息關聯在請求前保存，失敗先查同一結果。先前真模型中斷及 scripted 組裝見[角色核對](../artifacts/verification/DEV_AGENT02_LOCAL_ROLES_20261018.json)，不把未回報結果的呼叫當作零消耗；未載入角色的分支不提供該驗收模式。

`--artifacts` 在 `--no-model` 入口使用正式 client 核對同一份準備單的修改／讀回／版本衝突，以及一份小附件的保存／讀回／刪除；它不驗證模型編製或審核，也不代表清理 worker 已實際刪除物件。

本地成功不代替 GCP IAM、真通知、正式備份恢復或 Android 真機。已驗、失敗及未驗項見 [DEV-AGENT01 證據](../artifacts/verification/DEV_AGENT01_LOCAL_20261018.json)；角色聯合成果和個人設定交付以根 PLAN 為準。
