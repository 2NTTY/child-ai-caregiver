# P2 UI 功能及對接清單

現行品牌為「育有方」（2026-10-01 更名）；下文的既有聊天標題、版本及驗收記錄保留當時名稱。新版前端品牌已沿正式frontend接線；本頁舊版驗收記錄不代表最新部署狀態。

供後續 Web UI 設計及接線使用；版面、視覺及互動細節可另行設計。產品要求仍以 [SPEC](../SPEC.md) 為準，進度以 [PLAN](../PLAN.md#roadmap-packages)／[STATUS](../STATUS.md) 為準，本表不另立需求或完成門檻。沿用既有美術及 Prompt Pack。

<a id="chat-handoff"></a>
## 前端聊天接手入口

先沿根 [STATUS](../STATUS.md) 分域：前端聊天讀 [frontend/PLAN#active](../frontend/PLAN.md#active)，正式整合讀 [根 PLAN#active](../PLAN.md#active)。本表只回答「正式功能接哪個 API／controller」，不是目前任務、開包授權或第二份驗收門檻。

修改歸屬、Android UI 例外及正式 P3 邊界唯一見 [AGENTS#frontend-backend](../AGENTS.md#frontend-backend)。跨域整合按本次功能讀下表 → [前端專項交接](../frontend/HANDOFF.md#p2-coverage) → 必要 API／型別；固定核對 commit，不讀整份前端歷史。

前端的 view model／回調不是 wire contract；正式接線保留原 controller、身份／孩子／Server 清理、草稿、原 opId／unknown 及授權。實際移除 fixture、開發工具及替換掛載位置見 [PRODUCTION_UI_HANDOFF](../frontend/PRODUCTION_UI_HANDOFF.md)。前端包的已驗／未驗與下一步只在其 PLAN；本表不複製。

INT-W01 已將 frontend 納入根 npm workspace，使用統一 lockfile；依賴變更仍須核對版本／許可／相容性。Web 合成結果、真 API 流程、Android bundle／真機各自分開；單頁或預覽完成不能代替正式驗收。

<a id="production-owners"></a>
## 新前端正式資料接點

根舊app／Panel及專用runner已[可恢復歸檔](../_archive/legacy-web-2026-10-07/README.md)。本節owner為現行接線；後文各Sxx舊Panel位置僅保留歷史參考，不能照其舊路徑重新掛回正式頁面。

以下是 INT 系列的接線位置；完成與驗收狀態只看 [根 PLAN](../PLAN.md#production-integration)。不改既有版面、美術或動效，不把舊面板直接掛到新入口。表內 owner 是 Server 資源的受權投影，不能另建頁面資料副本。

| 使用者功能／頁面 | 同一權威來源及前端 owner |
|---|---|
| 登入、家庭選擇、孩子切換與刪除 | `ProductionOwner`／既有 RecordsController；Server session、家庭角色及 children |
| 對話、歷史、來源、工具結果、持久待確認及取消 | ChatController／AgentConversationOwner／AgentAuthorizationOwner；messages、agent runs／pending／operation receipts |
| 記錄、搜尋、更正、歷史及孩子檔案；首頁照護資料 | `CareProfileDomains`；同一 Care API／profile 版本。首頁只組合已載入資料，不另外保存 |
| 任務、預約、改期、完成、取消、成員指派及歷史 | `TaskKnowledgeDomains`；Task API 的 task／occurrence／版本，側欄讀相同 owner |
| 記憶、摘要覆蓋、人工備援；成長關注及原單份到診準備 | `TaskKnowledgeDomains`；Memory／Growth／CareSummary API；舊到診準備保留 `/summary?tab=legacy-preparation` 查閱入口 |
| 多份準備文件、清單、歸檔／恢復、成長報告與同版 PDF | `TaskKnowledgeDomains/useFamilyDocuments` → FamilyDocument API／Store；Agent 工具及頁面共用加密資源、版本與收據。來源更正遮蔽失效正文，普通讀取不生成；worker 合併刷新共享文字報告。PDF 明確綁定所選快照／權限，不包含私人聊天或照片。契約見 [API](API.md#int-family-documents) |
| 共享持續關注、事件、結束／恢復與一次站內跟進 | 同一 `TaskKnowledgeDomains/useTaskKnowledgeGrowth` → Concern API／ConcernStore；首頁及歷史只讀此 owner。Agent 以持久候選確認同一服務；與 GrowthAttention／MemoryTopic 分開。根 INT-W05 記驗收，未聲稱已公開部署 |
| 對話照片轉交、照片上傳／提取／確認、分享文字／連結輸入 | `PhotoInputDomains`；Photo／SharedInput API，原檔與人工草稿共用一次操作上下文；模型提取與家庭共享分開同意 |
| 本人模型 key／限額、通知偏好、Push／Telegram、家庭成員及聯絡授權 | `SettingsDomains`；各既有 API／版本／收據，個人設定按身份、家庭操作按孩子清理；不自動發送渠道測試 |
| 私人來源、用途、原地修改／停用、修訂歷史及對話設定 | `PhotoInputDomains`／`usePhotoInputSources`／同一 SharedInput API；設定與聊天導向同一來源清單，Agent 候選確認亦寫入同一 shared_inputs。引用原文另經本人選取授權，私人引用不當官方知識 |
| 首頁、側欄與歷史頁 | 組合上述 owner 的受權結果；已載入清單不冒充完整清單，未能讀取不顯示為「沒有資料」 |

寫入成功按 Server 收據刷新共用讀取；可見頁面沿 changes cursor 每 5 秒核對變更 metadata，回到前景即核對。沒有變更不定時重跑模型。busy／unknown 保留原操作，先查核再容許新提交；登出、撤權及身份／孩子切換清理舊內容與遲到回應。

較早聊天使用 Server 游標；取消只要求停止仍在運行的生成，已保存的工具操作不會撤銷。普通記錄更正另設預設關閉的授權開關，只可更正本人獲授權普通類別的原版本；升級不擴大舊授權。完整入口部署及舊 UI 退出正式建置仍依 INT-W07；新關注／報告的本機證據不能代替公開部署。

## 狀態與使用方式

P2 功能包及 S16 必要本機／真服務驗收已合併；2026-09-30 正式 Web／Server 已部署版本 `43ab10c`，啟用 ADK、既有 Prompt Pack、最小向量 RAG 及正常 worker，原資料保留／公開 HTTP／配對還原通過。S17-W02 的兩條公開展示、本人來源／任務確認及真通知回報已通過，完整照片／分享／摘要等面板瀏覽器情景未另行全驗。下表區分已落碼介面及具體證據，不能把單一 HTTP／模型結果當整套 UI 驗收；功能 API 已接通不代表隔離前端設計已接回。最新進度見 [P2 交付](P2_DELIVERY.md)。

| 功能 | 使用者可做的事 | 必須能呈現的資料及狀態 | 工作包／對接落點 |
|---|---|---|---|
| UI-P2-01 家庭與成員 | 邀請、接受邀請、查看成員；owner 變更角色或撤權 | owner／caregiver／viewer、邀請有效性、權限失效；一次性碼及共享範圍二次確認 | S06-W02 [FamilyPanel](../src/client/FamilyPanel.tsx)／[API](API.md#p2-family-http)／[型別](../src/shared/family.ts) 已落碼 |
| UI-P2-02 孩子檔案 | 切換孩子，按需要補充及確認年齡、地區和照護資料 | 精確／約數年齡及日期基準、未知、實際／矯正年齡、共享範圍 | S06-W02 家庭建立／切換；S05-W02 [CarePanel](https://github.com/2NTTY/child-ai-caregiver/blob/0a39e018dc138b29a437ab52679866e3bfcc0378/src/client/CarePanel.tsx)／[API](API.md#p2-care-http)／[型別](../src/shared/care.ts) 已接確認檔案、版本及歷史 |
| UI-P2-03 記錄與確認 | 快捷新增、確認候選、更正、搜尋及查看時間軸 | 原文、來源、精度、確認人、版本、更正歷史；候選不冒充已保存 | S05-W02 [CarePanel](https://github.com/2NTTY/child-ai-caregiver/blob/0a39e018dc138b29a437ab52679866e3bfcc0378/src/client/CarePanel.tsx)／[API](API.md#p2-care-http) 已接；按加入時間分頁，事件原時間分開；AI 提取／核對入口已分別接入照片及分享面板，沿用明確確認後保存 |
| UI-P2-04 記憶與話題 | 新增候選、明確確認／共享、更正／停用／刪除；管理話題終態與按原因重開，查看本人摘要覆蓋 | 候選不作事實，來源變更／過期／版本衝突，私有候選歷史遮蔽；暫緩日期、舊終態保留；未知提交先核對 | S09-W02 [MemoryPanel](https://github.com/2NTTY/child-ai-caregiver/blob/0a39e018dc138b29a437ab52679866e3bfcc0378/src/client/MemoryPanel.tsx)／[API](API.md#p2-memory-http)／[型別](../src/shared/memory.ts) 已接通，必要本機驗收通過，完成隨 PR #34 合併生效；完整記憶面板瀏覽器情景未驗，S11-W02 已接 AI 摘要暫存／覆蓋校驗與候選確認工具，必要核心證據分列於本包驗收記錄 |
| UI-P2-05 Agent 對話 | 提出照護需求、核對候選完整內容及共享範圍、明確接受／略過、查核未知提交；手動查看背景結果 | 運行／工具結果、候選／實際任務分開、版本衝突、停止／unknown、統計未知，不展示內部推理 | S11-W02 [ChatPanel](https://github.com/2NTTY/child-ai-caregiver/blob/0a39e018dc138b29a437ab52679866e3bfcc0378/src/client/ChatPanel.tsx)、[AgentRunPanel](https://github.com/2NTTY/child-ai-caregiver/blob/0a39e018dc138b29a437ab52679866e3bfcc0378/src/client/AgentRunPanel.tsx)、[AgentInbox](https://github.com/2NTTY/child-ai-caregiver/blob/0a39e018dc138b29a437ab52679866e3bfcc0378/src/client/AgentInbox.tsx)／[HTTP](API.md#product-agent-http)／[型別](../src/shared/product-agent.ts) 已接線，必要核心證據見 [EV-S11-W02](../artifacts/verification/S11_W02_CHECKS.json)；完整 Agent UI 情景未全驗；設定預設關閉，現網已明確啟用 |
| UI-P2-06 知識引用 | 從原回答查看支持片段及官方頁、辨認降級／來源時間；使用固定緊急求助入口 | 標題、章節、短原文、版本／核對時間、來源分類、降級；原引用不保證目前仍適用 | S11-W02 [AgentRunPanel](https://github.com/2NTTY/child-ai-caregiver/blob/0a39e018dc138b29a437ab52679866e3bfcc0378/src/client/AgentRunPanel.tsx) 已接既有 public [retriever](../server/knowledge-retriever.ts)；[EmergencyHelp](../src/client/EmergencyHelp.tsx) 在模型回覆前可見。S10-W02 已驗；本包有限真引用樣例及成長引用修正的離線證據分列，完整 UI 情景未全驗，公開部署已完成；CHP／RTHK 組內限制不變 |
| UI-P2-07 成長關注 | 閱讀「為何現在」、接受、暫緩、關閉或永久停用主題 | 所依據的已確認資料、觀察／安排／諮詢建議、來源、處理結果及新提示原因 | S13-W08 [GrowthPanel](https://github.com/2NTTY/child-ai-caregiver/blob/0a39e018dc138b29a437ab52679866e3bfcc0378/src/client/GrowthPanel.tsx)／[對接](#growth-ui-handoff) 已接線，必要規則／真背景及抑制驗收通過；完整面板瀏覽器情景未驗 |
| UI-P2-08 任務與預約 | 查看、確認、指派、改期、完成、取消、衝突覆核及歷史 | 任務／穩定發生實例、含 offset 時間／IANA 時區、合資格負責人、原版本、原因／備註及終態；過期不等於完成 | S13-W01 [API](API.md#p2-task-http)／[型別](../src/shared/tasks.ts) 已接 [TaskPanel](https://github.com/2NTTY/child-ai-caregiver/blob/0a39e018dc138b29a437ab52679866e3bfcc0378/src/client/TaskPanel.tsx)／[client API](../src/client/task-api.ts)，本機 HTTP 及 Web export 通過；公開候選確認建任務已通過；改期／完成以使用者批准後的 API 核對，不冒充全 TaskPanel E2E |
| UI-P2-09 聯絡授權 | 設定或撤回預授權，核對對象、內容、渠道及 fallback | 授權範圍／版本、合資格對象、待確認的超範圍動作 | S13-W07 [ContactPanel](https://github.com/2NTTY/child-ai-caregiver/blob/0a39e018dc138b29a437ab52679866e3bfcc0378/src/client/ContactPanel.tsx)／[對接](#contact-handoff) 已接線，本機真 Agent 聯絡／收到／明確完成通過；公開真聯絡已通過；任務 grant 按使用者批准以 API 補存，完整面板操作未全驗 |
| UI-P2-10 通知偏好 | 個別設定渠道、安靜時段及明確的預約例外 | 香港時間預設 22:00–08:00、普通提示合併及跟進限制 | S06-W02 已有偏好保存；S13-W04 已接站內持久批次及執行，必要 DB 驗收通過；W05／W06／W07 已接渠道授權與執行時偏好檢查 |
| UI-P2-11 Web Push | 訂閱、退訂及查看裝置渠道狀態 | 未授權／已拒絕／不支援／已訂閱／訂閱失效，站內仍可查事項 | S13-W05 [WebPushPanel](https://github.com/2NTTY/child-ai-caregiver/blob/0a39e018dc138b29a437ab52679866e3bfcc0378/src/client/WebPushPanel.tsx)／[HTTP](API.md#p2-web-push-http)／[型別](../src/shared/web-push.ts) 已落碼：本人訂閱／撤銷、固定測試、原操作查核及投遞狀態；SQL／一次 Firefox 真 Push 及撤銷通過；公開 origin 一則 Firefox Push 已收到，Server 綁定已撤銷；未操作瀏覽器 provider 退訂 |
| UI-P2-12 Telegram | 啟動 bot 後完成綁定、解除綁定及回覆正確事項 | 綁定狀態、接收者、事項關聯；收到回覆不自動當作照護完成 | S13-W06 本人雙向綁定／撤銷、一般測試及原操作查核已落碼；[功能及未驗項](#telegram-ui-handoff)，SQL 及真本人接收／回覆通過；公開 webhook／本人綁定／一般訊息 callback 已通過；公開照護聯絡／本人 callback 及明確完成已通過 |
| UI-P2-13 執行與投遞台帳 | 查看實際聯絡進度及待處理結果 | 渠道接受、送達、已讀、回應、照護完成各自的證據；unknown 不冒充失敗 | S13-W04 已接站內提醒／處理狀態，必要 DB 驗收通過；W07 已接真渠道台帳、收到及完成分開呈現 |
| UI-P2-14 照片輸入 | 選圖、上傳、查看提取結果、修正及確認 | 原檔／來源、上傳與提取狀態、不確定欄位、容量／權限錯誤 | S12-W03 [PhotoPanel](https://github.com/2NTTY/child-ai-caregiver/blob/0a39e018dc138b29a437ab52679866e3bfcc0378/src/client/PhotoPanel.tsx)／[對接](#photo-handoff) 已接線，原圖／真提取／確認及備份必要證據已驗；完整面板瀏覽器情景未驗 |
| UI-P2-15 分享輸入 | 貼上、上傳或主動分享指定來源；管理本人私人資料來源 | 原文、來源／時間、可讀性、候選與確認；不背景讀私人動態 | S12-W04 [SharedInputPanel](https://github.com/2NTTY/child-ai-caregiver/blob/0a39e018dc138b29a437ab52679866e3bfcc0378/src/client/SharedInputPanel.tsx)／[對接](#shared-input-handoff) 已接線，文字提取及私人來源保存／取得／隔離必要驗收通過；完整面板瀏覽器情景未驗 |
| UI-P2-16 到診準備與摘要 | 選孩子／期間，查看到診問題、準備清單及日／週摘要 | 程式計算的數字、來源、缺項、版本、更正後更新 | S14-W01 [CareSummaryPanel](https://github.com/2NTTY/child-ai-caregiver/blob/0a39e018dc138b29a437ab52679866e3bfcc0378/src/client/CareSummaryPanel.tsx)／[對接](#care-summary-handoff)，必要 API／Agent 驗收通過、完整面板 E2E 未驗 |
| UI-P2-17 在線確認與更新 | 查核未知提交、沿原操作重試、查看最新資料及比較版本 | 未提交／未知／已確認但結果不可用、版本／世代衝突、搜尋頁面失效、權限變更；不可按文字相同猜測成功 | S07-W03 [API](API.md#online-http)／[型別](../src/shared/online.ts)／[transport](../src/client/online-transport.ts) 已接；本機 PostgreSQL／HTTP 及 S16-W05 Chromium 原 opId／撤權情景通過；不代表所有面板已全驗 |

## 共同互動與對接要求

S13-W04 在既有 TaskPanel 增加[清單 metadata](API.md#p2-task-worker-http)：每項可顯示站內 initial／follow_up 時間、worker pending／processed／stopped／failed／unknown、排定檢查時間及失敗次數。`workerEnabled=false` 或欄位尚不存在時顯示未啟用／恢復後暫停；true 亦不代表程序在線。站內提醒只給當前有權的本人，改期／終態後隱藏舊版本，換帳號／孩子／角色或撤權時清除。沿既有可見頁面刷新，不新增用戶端背景排程；前端改版可用同一 view model。外發送達／已讀／照護完成繼續分開，真正渠道台帳已由 S13-W07 接通，見[聯絡對接](#contact-handoff)。

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

[CareSummaryPanel](https://github.com/2NTTY/child-ai-caregiver/blob/0a39e018dc138b29a437ab52679866e3bfcc0378/src/client/CareSummaryPanel.tsx) 已接基本頁；props 為 apiBaseUrl／userId／childId／online／onSessionChanged，契約見 [API](API.md#care-summary-http)。沿用現有孩子選擇器；切換後面板以帳號／孩子／Server 身份重建，沒有混算不同孩子。

功能清單：開始日、一日／七日、時區 → 手動產生摘要；孩子／年齡依據、期間／生成時間、各類紀錄及數值／原單位／約數、未知與缺項、原始記錄版本／更正、已確認預約及待覆核任務；到診問題／準備勾選／可選預約、明確共享保存及家長核對。未知時間不可假歸入當週；所有資料變動後需重核。PDF／分享未交付。

viewer 唯讀；未保存草稿不因一般重新讀取悄悄覆蓋，unknown 保留原操作識別及內容。確認前顯示共享範圍；切換身份或撤權清理，離線不提交。不要把純計算或 UI 型別證據當成真資料接線驗收；獨立 frontend 可依此替換視覺，保留版本／錯誤及範圍清理語義。

S14 必要真 API 保存／統計／來源失效及真 Agent 工具證據見 [驗收](../artifacts/verification/S14_W01_CHECKS.json)；未另跑整套 UI，不以純計算或型別結果冒充瀏覽器接線通過。

<a id="growth-ui-handoff"></a>
## S13-W08 功能接線清單（必要後端驗收通過；完整 UI 情景未驗）

[GrowthPanel](https://github.com/2NTTY/child-ai-caregiver/blob/0a39e018dc138b29a437ab52679866e3bfcc0378/src/client/GrowthPanel.tsx)／[growth-api](../src/client/growth-api.ts)／[共享型別](../src/shared/growth.ts)／[HTTP](API.md#growth-attention-http)。正式 App 以帳號及孩子掛載，使用既有 online refresh；未變更 `frontend/**` 的視覺預覽。

- 查看四主題的關注理由、建議、限制、官方片段／版本、前次關係及真實狀態；來源／依據失效時顯示歷史限制，停止現行建議及操作。
- 接受只作知悉，或經明確核對新增已確認任務；API 亦支援連接指定版本既有任務。顯示任務 ID／實際終態，改期／完成／取消到既有任務區。没有另建不存在的任務導航路由。
- 暫緩至明確時間、關閉、永久停用主題及明確重新啟用；相同依據不復活。只把到期暫緩改回原候選，不另建任務。
- 以頁面有限選項補充近況；「供家庭共享」須明確勾選，寫入既有確認事實及更正歷史。未知不預填否定；衝突／已失效事實到記憶區覆核。
- viewer 唯讀、離線禁提交、帳號／孩子切換清理；unknown 先重讀再選擇原 body 重試，凍結項目版本、授權版本及原 fact refs。歷史顯示上限及 worker 失敗均如實提示。

必要 SQL／背景及呈現修正的證據見 [W08](../artifacts/verification/S13_W08_CHECKS.json)。完整關注面板的瀏覽器互動未驗，不能以型別或其他面板的 Chromium 證據代替；本包不含外發，預授權联絡由 W07 交付。

<a id="photo-handoff"></a>
## 照片功能接線（S12-W03）

正式入口 `PhotoPanel`／`photo-api` 已供主 App 接線；獨立 `frontend/` 不變。設計須保留以下可操作狀態：

- 選 JPEG／PNG、檔名／來源／容量提示及原圖預覽；當前檔案和輸入在網絡失敗時保留，刷新／關閉風險明示。
- metadata 預留、上傳中／ready、失敗或未知各自呈現；查原 ID 後才由使用者重傳相同原檔。
- 明確「送交 AI 提取」；候選文字、數字、單位、約數、模糊時間及不確定處可核對修改，亦可直接人工填寫；提取不是已保存家庭事實。
- 確認前明示原圖與記錄共享家庭，版本衝突先重讀核對；原 opId 未確認時不換 ID 重送。
- 家庭原圖與私人未確認候選分離；viewer 唯讀。刪除明示包括已連結照護記錄，磁碟清理 pending 與 SQL 已刪分開。
- 孩子／帳號／Server 切換、撤權清理檔案、blob URL 及候選；不將私人原圖寫入持久 Web 快取。

共用型別見 [photos](../src/shared/photos.ts)，API 以 [照片契約](API.md#p2-photos) 為準。真 API 原圖、確認／隔離及一次合成 Gemini 候選品質已有必要證據；瀏覽器選檔／預覽完整情景未驗，不以型別檢查或 API 代替。

<a id="shared-input-handoff"></a>
## 主動分享輸入（S12-W04）

[SharedInputPanel](https://github.com/2NTTY/child-ai-caregiver/blob/0a39e018dc138b29a437ab52679866e3bfcc0378/src/client/SharedInputPanel.tsx)／[shared-input-api](../src/client/shared-input-api.ts) 掛在正式基本頁；props 與照片面板一致。獨立 frontend 可依 [契約](API.md#p2-shared-inputs) 替換視覺，未修改其預覽。

- 預設「自行設定私人來源」：名稱、HTTPS 網址、備註、來源日期及可選正文；網址／正文至少一項，可貼上自備訂閱／付費材料。按目前孩子保存，只供本人讀取。另保留原 paste 模式（網址只保存）及固定公開來源；照片沿用 PhotoPanel。
- 只存連結時顯示「連結已保存，尚未取得正文」，不呈現可提取／確認的假狀態。可明確「取得此網頁內容」，只支援公開可直接訪問的 HTML；登入／付費正文可自行貼上，沒有帳密連接欄位。
- 缺正文時「返回新增私人來源並自行貼上正文」帶回名稱／URL／備註／日期，但明示保存為另一項，原來源仍保留；沒有新增修改或背景訂閱 API。需登入的提示頁亦須由家長核對，不等於已取得文章。
- 選既定公開來源、明確取得、呈現原文／來源／日期／hash；not_requested、running、ready、failed、unknown 分開顯示。
- 選取原文片段後，明確送模型；長文不自動截斷。候選可採用／編輯，約數、時間及不確定處保留；可跳過 AI 直接人工填寫。
- 預設「外部參考」；選「孩子實際記錄」須額外明確確認孩子關係。確認前呈現共享內容，原文／網址及私人候選不跟著公開。
- 原 opId 回查、版本衝突、失敗草稿保留、身份／孩子切換及撤權清理；viewer 唯讀。刪除明示連結記錄範圍，兩次確認。
- 不將來源發布日期、本站保存日期及取得日期混成一個日期；不把待提取／候選／確認當作同一狀態。

必要真 SQL、私人來源取得／隔離及日期修正版提取已有證據；完整面板瀏覽器未驗，不以型別或其他面板情景代替。S12-W04 不增加系統分享、新聞自動閱讀、PDF／Android 或 UI polish。

<a id="contact-handoff"></a>
## S13-W07 聯絡功能交接

[ContactPanel](https://github.com/2NTTY/child-ai-caregiver/blob/0a39e018dc138b29a437ab52679866e3bfcc0378/src/client/ContactPanel.tsx) 已掛正式基本頁，props 為 apiBaseUrl／userId／childId／online／onSessionChanged；[contact-api](../src/client/contact-api.ts) 復用原操作收據，wire contract 見 [API](API.md#proactive-contact-http)。獨立 frontend 可按此對接，沒有改動其預覽。

- 本人同意：可選已綁定的 Web Push／Telegram 及順序、後備資格、明確保存／撤銷；綁定本身不是同意。
- 每項任務：顯示負責人與版本、明確期限、最多一次跟進、已知失敗 fallback 及可選後備；超期／改期／轉派須重新確認。viewer 唯讀。
- 結果：pending／sending／accepted／rejected／unknown／stopped，以及每日已有普通提示而未另發的 coalesced；只顯示真實台帳。本人可確認收到，完成仍在任務入口；不展示模型內部推理。
- 離線停用提交；unknown 保留原內容與 opId，先查收據和 GET，再由使用者明確重試。換帳號／孩子／Server、失去權限時清除資料及草稿。手動重新讀取最新狀態，不加客戶端背景排程。
- 當前有最多 50 任務及最近 50 聯絡的顯示上限，不能假稱完整歷史。型別與掛載 review 已核對；真 API／渠道／瀏覽器未驗。沿用既有美術，不做 UI polish。

<a id="personal-model-ui"></a>
## UI-P2-18 本人模型 key 與可調上限（S06-W05 增補）

入口：[ModelSettingsPanel](https://github.com/2NTTY/child-ai-caregiver/blob/0a39e018dc138b29a437ab52679866e3bfcc0378/src/client/ModelSettingsPanel.tsx)，props userId／online／apiBaseUrl，掛於正式 Web 登入帳號區；[API](API.md#personal-model-http)／[共用型別](../src/shared/model-settings.ts)。獨立前端後續接此 view model，毋須接觸或讀回密鑰。

- 選平台／個人 key／停用，輸入或替換 key、明確費用／外送同意、背景 opt-in、二次確認刪除。
- 可編輯個人每日總呼叫數、每次 Agent 生成呼叫數及查詢 embedding 數；顯示目前版本、全站個人安全上限、固定工具／逾時／輸出限額及 UTC 重置時間。
- 分別呈現平台／私人用量、metadata 未知及供應商限制；key 保存不等於連線成功，metadata 可讀不等於生成／embedding 已驗。
- 保存 unknown 不重播，清除密鑰輸入後重讀版本；身份／Server／離線切換清除輸入及舊請求，孩子切換不切換本人 key。
- 本包先完成設定及本機接線；Google Developer API 地區限制導致真服務待驗。正式試用網站尚未部署此增補，Android 於 S04-W01 復用，不以共用 RN 元件當作真機已驗。
