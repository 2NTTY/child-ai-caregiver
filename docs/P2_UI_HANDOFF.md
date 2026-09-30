# P2 UI 功能及對接清單

供後續 Web UI 設計及接線使用；版面、視覺及互動細節可另行設計。產品要求仍以 [SPEC](../SPEC.md) 為準，進度以 [PLAN](../PLAN.md#roadmap-packages)／[STATUS](../STATUS.md) 為準，本表不另立需求或完成門檻。沿用既有美術及 Prompt Pack。

<a id="chat-handoff"></a>
## 前端聊天接手入口

前端 task 為「檢查育伴港前端現況」。2026-09-26 對齊其最新計劃：先在 `frontend/` 完成隔離 Web 預覽，正式 API 接線由主聊天整合；整套 Web 經使用者明確確認滿意且符合 P3 前置後，才開始 Android 前端。修改歸屬依 [AGENTS](../AGENTS.md#frontend-backend)。先讀根 STATUS、PLAN 當前工作包及本表，再按需要讀 [前端選型證據](TECH_REUSE.md#frontend)；本文件不自動授權開包。

| 交付 | 負責範圍 | 交接與完成條件 |
|---|---|---|
| 前端聊天 | 當前 FE-W01 的 `frontend/**` 元件、主題、路由預覽、view model／回調、合成資料、獨立依賴／配置及前端文件 | 不呼叫真 Server、不改正式 App 或根文件；展示真實運行的合成預覽，交付可重用元件及已驗／未驗項 |
| 主聊天 | Server／Agent／資料庫／安全，以及正式 `app/**`／`src/client/**` 的接線與整合 | 對照既有 API 審核前端交付，保留控制器／草稿／opId；處理根依賴、正式狀態及真 API 驗收，不從截圖重做 UI |
| 共享契約 | `src/shared/**`、API／資料契約、根依賴／lockfile／配置及權威文件 | 主聊天負責；前端只讀及列出缺口，不把 view model 當新 wire contract。各用獨立 worktree／分支，前端不自行 merge |

前端已交付 `frontend/STATUS.md`、`PLAN.md`、`DESIGN_SYSTEM.md`、`WORKFLOW.md` 及 [HANDOFF.md](../frontend/HANDOFF.md)，目前為已合併的隔離合成預覽，尚未取代正式 App。前端文件只管 FE 工作包，不複製產品總規格或自行將 Sxx 包標完成；正式後端功能接線仍由主聊天處理。

`frontend/HANDOFF.md` 每次列基線／交付 commit、元件入口、安裝與預覽命令、view model／操作回調及 API／型別對照、必要狀態與未有契約項、驗收證據。逐項標示「前端已完成」「只屬合成預覽」「待主聊天接線」「未有後端契約」。主聊天接線時保留原操作 ID、unknown 查核、頁面草稿、切孩子／登出／撤權的取消及清理；合成資料入口與正式資料來源分開，正式配置不能意外啟用預覽 fixture。前端 view model 只承載呈現資料，不另實作授權／終態／投遞規則。

近期次序依前端最新計劃從 FE-W01 Web 主頁開始，之後逐頁設計；首包優先試既定 Paper 候選，複雜表單需要時再驗 RHF＋Zod。主聊天的 S13-W01 台帳及 S16-W05 正式 Web 測試仍按根 PLAN；P3 S07-W01 才導入讀取用途的 Query，無須為預覽提前建快取／同步框架。前端新依賴先留在隔離專案，正式整合時由主聊天核對根版本／許可／相容性，不把整份預覽 lockfile 覆蓋到根目錄。

Web 預覽檢查 1440／1024／390／320 CSS px、鍵盤、溢出及必要狀態，提供實際運行畫面；390／320 是手機瀏覽器尺寸，不算 Android 驗收。前端自行維護的 preview 測試與主聊天 S16-W05 的真 API 流程分開記證據，可復用場景，不能互相冒充。僅完成預覽或確認單頁，不代表整套 Web 獲確認、P3 前置完成或 P2 已完成。

## 狀態與使用方式

目前 P1 登入、孩子、文字記錄及基本聊天可用；S11-W03 已完成 ADK 內部基礎，S11-W02 隔離分支已接 Web 聊天入口，仍待驗收及明確啟用。S06-W02 家庭管理／偏好、S05-W02 孩子檔案／確認更正／搜尋、S07-W03 在線收據／刷新、S09-W02 記憶／話題及 S10-W01 內部知識檢索均已有對應實作與必要本機證據，實際入口及限制見下表；不因此宣稱瀏覽器 E2E、Agent 全接線或部署通過。其餘 P2 功能仍待所屬工作包接通。每包交付時補上實際 API／共享型別及可操作狀態，未落碼的項目不提供假路由；接線只能採用已交付契約。

| 功能 | 使用者可做的事 | 必須能呈現的資料及狀態 | 工作包／對接落點 |
|---|---|---|---|
| UI-P2-01 家庭與成員 | 邀請、接受邀請、查看成員；owner 變更角色或撤權 | owner／caregiver／viewer、邀請有效性、權限失效；一次性碼及共享範圍二次確認 | S06-W02 [FamilyPanel](../src/client/FamilyPanel.tsx)／[API](API.md#p2-family-http)／[型別](../src/shared/family.ts) 已落碼 |
| UI-P2-02 孩子檔案 | 切換孩子，按需要補充及確認年齡、地區和照護資料 | 精確／約數年齡及日期基準、未知、實際／矯正年齡、共享範圍 | S06-W02 家庭建立／切換；S05-W02 [CarePanel](../src/client/CarePanel.tsx)／[API](API.md#p2-care-http)／[型別](../src/shared/care.ts) 已接確認檔案、版本及歷史 |
| UI-P2-03 記錄與確認 | 快捷新增、確認候選、更正、搜尋及查看時間軸 | 原文、來源、精度、確認人、版本、更正歷史；候選不冒充已保存 | S05-W02 [CarePanel](../src/client/CarePanel.tsx)／[API](API.md#p2-care-http) 已接；按加入時間分頁，事件原時間分開；尚未接 AI 提取候選 |
| UI-P2-04 記憶與話題 | 新增候選、明確確認／共享、更正／停用／刪除；管理話題終態與按原因重開，查看本人摘要覆蓋 | 候選不作事實，來源變更／過期／版本衝突，私有候選歷史遮蔽；暫緩日期、舊終態保留；未知提交先核對 | S09-W02 [MemoryPanel](../src/client/MemoryPanel.tsx)／[API](API.md#p2-memory-http)／[型別](../src/shared/memory.ts) 已接通，必要本機驗收通過，完成隨 PR #34 合併生效；瀏覽器驗收及部署未執行，S11-W02 已接 AI 摘要暫存／覆蓋校驗與候選確認工具，必要核心證據分列於本包驗收記錄 |
| UI-P2-05 Agent 對話 | 提出照護需求、核對候選完整內容及共享範圍、明確接受／略過、查核未知提交；手動查看背景結果 | 運行／工具結果、候選／實際任務分開、版本衝突、停止／unknown、統計未知，不展示內部推理 | S11-W02 [ChatPanel](../src/client/ChatPanel.tsx)、[AgentRunPanel](../src/client/AgentRunPanel.tsx)、[AgentInbox](../src/client/AgentInbox.tsx)／[HTTP](API.md#product-agent-http)／[型別](../src/shared/product-agent.ts) 已接線，必要核心證據見 [EV-S11-W02](../artifacts/verification/S11_W02_CHECKS.json)；完整 Agent UI E2E 未驗，P2_AGENT_ENABLED 預設關閉 |
| UI-P2-06 知識引用 | 從原回答查看支持片段及官方頁、辨認降級／來源時間；使用固定緊急求助入口 | 標題、章節、短原文、版本／核對時間、來源分類、降級；原引用不保證目前仍適用 | S11-W02 [AgentRunPanel](../src/client/AgentRunPanel.tsx) 已接既有 public [retriever](../server/knowledge-retriever.ts)；[EmergencyHelp](../src/client/EmergencyHelp.tsx) 在模型回覆前可見。S10-W02 已驗；本包有限真引用樣例及成長引用修正的離線證據分列，完整 UI／公開部署未驗，CHP／RTHK 組內限制不變 |
| UI-P2-07 成長關注 | 閱讀「為何現在」、接受、暫緩、關閉或永久停用主題 | 所依據的已確認資料、觀察／安排／諮詢建議、來源、處理結果及新提示原因 | S13-W08；待接通 |
| UI-P2-08 任務與預約 | 查看、確認、指派、改期、完成、取消、衝突覆核及歷史 | 任務／穩定發生實例、含 offset 時間／IANA 時區、合資格負責人、原版本、原因／備註及終態；過期不等於完成 | S13-W01 [API](API.md#p2-task-http)／[型別](../src/shared/tasks.ts) 已接 [TaskPanel](../src/client/TaskPanel.tsx)／[client API](../src/client/task-api.ts)，本機 HTTP 及 Web export 通過；瀏覽器互動待 S16 |
| UI-P2-09 聯絡授權 | 設定或撤回預授權，核對對象、內容、渠道及 fallback | 授權範圍／版本、合資格對象、待確認的超範圍動作 | S13-W07；待接通 |
| UI-P2-10 通知偏好 | 個別設定渠道、安靜時段及明確的預約例外 | 香港時間預設 22:00–08:00、普通提示合併及跟進限制 | S06-W02 已有偏好保存；S13-W04 已接站內持久批次及執行，必要 DB 驗收通過；渠道控制待 W05／W06／W07 |
| UI-P2-11 Web Push | 訂閱、退訂及查看裝置渠道狀態 | 未授權／已拒絕／不支援／已訂閱／訂閱失效，站內仍可查事項 | S13-W05 [WebPushPanel](../src/client/WebPushPanel.tsx)／[HTTP](API.md#p2-web-push-http)／[型別](../src/shared/web-push.ts) 已落碼：本人訂閱／撤銷、固定測試、原操作查核及投遞狀態；SQL／一次 Firefox 真 Push 及撤銷通過；公開 origin 留 S17 |
| UI-P2-12 Telegram | 啟動 bot 後完成綁定、解除綁定及回覆正確事項 | 綁定狀態、接收者、事項關聯；收到回覆不自動當作照護完成 | S13-W06 本人雙向綁定／撤銷、一般測試及原操作查核已落碼；[功能及未驗項](#telegram-ui-handoff)，SQL 及真本人接收／回覆通過；公開 webhook／正式 UI E2E 未驗 |
| UI-P2-13 執行與投遞台帳 | 查看實際聯絡進度及待處理結果 | 渠道接受、送達、已讀、回應、照護完成各自的證據；unknown 不冒充失敗 | S13-W04 已接站內提醒／處理狀態，必要 DB 驗收通過；真渠道台帳待 W07 |
| UI-P2-14 照片輸入 | 選圖、上傳、查看提取結果、修正及確認 | 原檔／來源、上傳與提取狀態、不確定欄位、容量／權限錯誤 | S12-W03；待接通 |
| UI-P2-15 分享輸入 | 貼上、上傳或主動分享指定來源 | 原文、來源／時間、可讀性、候選與確認；不背景讀私人動態 | S12-W04；待接通 |
| UI-P2-16 到診準備與摘要 | 選孩子／期間，查看到診問題、準備清單及日／週摘要 | 程式計算的數字、來源、缺項、版本、更正後更新 | S14-W01 [CareSummaryPanel](../src/client/CareSummaryPanel.tsx)／[對接](#care-summary-handoff)，必要 API／Agent 驗收通過、完整面板 E2E 未驗 |
| UI-P2-17 在線確認與更新 | 查核未知提交、沿原操作重試、查看最新資料及比較版本 | 未提交／未知／已確認但結果不可用、版本／世代衝突、搜尋頁面失效、權限變更；不可按文字相同猜測成功 | S07-W03 [API](API.md#online-http)／[型別](../src/shared/online.ts)／[transport](../src/client/online-transport.ts) 已接；本機 PostgreSQL／HTTP 通過，瀏覽器 E2E 未執行 |

## 共同互動與對接要求

S13-W04 在既有 TaskPanel 增加[清單 metadata](API.md#p2-task-worker-http)：每項可顯示站內 initial／follow_up 時間、worker pending／processed／stopped／failed／unknown、排定檢查時間及失敗次數。`workerEnabled=false` 或欄位尚不存在時顯示未啟用／恢復後暫停；true 亦不代表程序在線。站內提醒只給當前有權的本人，改期／終態後隱藏舊版本，換帳號／孩子／角色或撤權時清除。沿既有可見頁面刷新，不新增用戶端背景排程；前端改版可用同一 view model。外發送達／已讀／照護完成繼續分開，真正渠道台帳仍待 S13-W07。

S13-W01 任務設計需預留：家庭共享新增確認、ordinary／appointment、owner／caregiver 指派清單、時間及時區、改期／轉派原因、完成備註、取消原因、逐版歷史、`needs_review` 的相反操作及明確終態選擇。已撤權負責人須顯示需要重新指派，不代表仍可聯絡。建立事項不代表預約機構確認或已通知照顧者；worker 及渠道未接前不能顯示假送達。unknown 先查原 opId，409 比較最新版本後再明確提交，不能自動套新版本。

- owner／caregiver 可管理共享事實及事項；viewer 唯讀。只有 owner 管理成員及刪除整個孩子。每人管理自己的通知偏好；私人聊天不能因家庭角色而共享。
- 保存、確認、完成、外發授權是不同動作。按鈕應清楚交代作用及範圍；不能用一個「確認」默認同意其他動作。
- 執行中、待確認、已保存、部分完成、拒絕、衝突、失敗及未知需可區分。工具成功但回答生成失敗時仍呈現已核實結果，不能引導使用者重做副作用。
- 斷線保留當前表單／照片並提示刷新或關閉的風險；恢復後由使用者重試。不可顯示假保存或承諾跨關閉草稿恢復。
- 登出、換帳號、撤權及刪除後清理不再可見的資料與草稿；A 完成事項後 B 的共享狀態更新並停止催辦。
- 來源不足或失效要有清楚提示；醫療危險描述的官方求助提示優先呈現，不被一般載入狀態遮住。
- 對接採用 Server 回傳的識別、版本、權限和真實結果；UI 不自行推算授權、終態、投遞成功或 Agent 能力。
- S07 已在孩子／記錄、CarePanel、FamilyPanel 及 ChatPanel 接入原操作確認；S09 MemoryPanel 復用相同收據及刷新入口。可見頁面每 30 秒、重連及取得焦點時刷新；新讀取不覆蓋尚未確認的表單。跨端修改以版本衝突或最新狀態呈現，搜尋 cursor 失效須從首頁重新搜尋。Server 已確認保存而後續讀取失敗時，顯示「已確認，需重讀」，不可引導新增第二份。

已交付的 P1 介面見 [API](API.md#p1-input-contracts)；P2 語義邊界見 [Agent](API.md#agent-runtime-contract)、[知識](API.md#knowledge-retrieval-contract)，各功能落碼後再附具體實作位置。

<a id="telegram-ui-handoff"></a>
## Telegram 功能對接

- 正式基本入口：src/client/TelegramPanel.tsx／telegram-api.ts，掛在已登入帳號區；是本人渠道，切孩子不重綁、切帳號／Server 清理舊狀態。
- 可操作功能：明確開始私人綁定、開啟 10 分鐘 bot 連結、回站內刷新、核對候選帳號後確認、撤銷、明確一般測試、查投遞及收到時間。沿用 S07 同一 opId／原操作查核，不自動輪詢或重送。
- 新設計須區分未配置、等待 Telegram 啟動、待網頁確認、active／revoked／blocked、worker 暫停及各投遞狀態。API 接受不標已讀；callback 收到不標照護完成。
- [實際 HTTP／型別](API.md#telegram-http) 是本包對接契約；一般測試無家庭正文，主動聯絡與事項 callback 由 S13-W07 補齊。獨立 frontend 預覽未被替換，SQL／本人真渠道已驗；正式 UI E2E 與公開 webhook 未驗，見 [驗收界線](P2_TELEGRAM.md)。

<a id="care-summary-handoff"></a>
## S14-W01 摘要與到診準備

[CareSummaryPanel](../src/client/CareSummaryPanel.tsx) 已接基本頁；props 為 apiBaseUrl／userId／childId／online／onSessionChanged，契約見 [API](API.md#care-summary-http)。沿用現有孩子選擇器；切換後面板以帳號／孩子／Server 身份重建，沒有混算不同孩子。

功能清單：開始日、一日／七日、時區 → 手動產生摘要；孩子／年齡依據、期間／生成時間、各類紀錄及數值／原單位／約數、未知與缺項、原始記錄版本／更正、已確認預約及待覆核任務；到診問題／準備勾選／可選預約、明確共享保存及家長核對。未知時間不可假歸入當週；所有資料變動後需重核。PDF／分享未交付。

viewer 唯讀；未保存草稿不因一般重新讀取悄悄覆蓋，unknown 保留原操作識別及內容。確認前顯示共享範圍；切換身份或撤權清理，離線不提交。不要把純計算或 UI 型別證據當成真資料接線驗收；獨立 frontend 可依此替換視覺，保留版本／錯誤及範圍清理語義。

S14 必要真 API 保存／統計／來源失效及真 Agent 工具證據見 [驗收](../artifacts/verification/S14_W01_CHECKS.json)；未另跑整套 UI，不以純計算或型別結果冒充瀏覽器接線通過。

<a id="growth-ui-handoff"></a>
## S13-W08 功能接線清單（必要後端驗收通過；完整 UI 情景未驗）

[GrowthPanel](../src/client/GrowthPanel.tsx)／[growth-api](../src/client/growth-api.ts)／[共享型別](../src/shared/growth.ts)／[HTTP](API.md#growth-attention-http)。正式 App 以帳號及孩子掛載，使用既有 online refresh；未變更 `frontend/**` 的視覺預覽。

- 查看四主題的關注理由、建議、限制、官方片段／版本、前次關係及真實狀態；來源／依據失效時顯示歷史限制，停止現行建議及操作。
- 接受只作知悉，或經明確核對新增已確認任務；API 亦支援連接指定版本既有任務。顯示任務 ID／實際終態，改期／完成／取消到既有任務區。没有另建不存在的任務導航路由。
- 暫緩至明確時間、關閉、永久停用主題及明確重新啟用；相同依據不復活。只把到期暫緩改回原候選，不另建任務。
- 以頁面有限選項補充近況；「供家庭共享」須明確勾選，寫入既有確認事實及更正歷史。未知不預填否定；衝突／已失效事實到記憶區覆核。
- viewer 唯讀、離線禁提交、帳號／孩子切換清理；unknown 先重讀再選擇原 body 重試，凍結項目版本、授權版本及原 fact refs。歷史顯示上限及 worker 失敗均如實提示。

必要 SQL／背景及呈現修正的證據見 [W08](../artifacts/verification/S13_W08_CHECKS.json)。完整關注面板的瀏覽器互動未驗，不能以型別或其他面板的 Chromium 證據代替；本包不含外發，預授權联絡由 W07 交付。
