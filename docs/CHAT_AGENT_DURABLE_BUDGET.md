# 聊天根預算與 attempt 准入

本契約定義根預算 adapter、[可選單次 runtime 接線](#runtime-connection)、[模型日額 attempt 台帳](#daily-usage)及[已 claim run 的 services 組裝](#claimed-services)的不變量。沿用 Firestore 9.3.1 及現有 StorageCipher，不另建 workflow 或取代業務台帳；正式 Auth／index／worker 與恢復尚未啟用。各批基線及驗證範圍見[固定證據](#本輪證據)。

## 身份、額度與期限

rootRunId 是原 business run，不是長期work或每次新建的ADK invocation。binding包括owner/workspace/child、authorizationVersion原字串、storageEpoch、原trigger/reference、workflow／pack／settings／billing版本、effective limits及原絕對wall deadline。authorizationVersion依AgentScope／SQL access_version::text保留字串，不能轉Number；全部識別欄有界。無HTTP／模型配置入口，不存密鑰或正文。

同root只在binding／generation完全相同時讀回，不能改限額或重置used。上限沿現有Server設定範圍：model1–12、tool1–8、embedding1–6，預設4／8／2；不意味自動獲得最大額度。原deadline不因重啟／等待續命。serverclock由受信constructor提供，非外部request參數。

## 原子准入

- open／read／reserve／settle／stop均核原binding及generation。root保存在單一原子有界Firestore document，沒有自動takeover／generation遞增、delete或TTL。
- reserve前核終態、期限與剩餘額。預留即耗、無退款，model／embedding每次一格，工具batch全有或全無。僅新提交reservation回execute；同key同fingerprint重投只回lookup，不再扣或授予執行。samekey異內容conflict。lost reply也不能重新發execute。
- attempt key必須由外層已持久受理鏈提供；不得用新invocationId或程序從零ordinal偽裝同attempt。unknown不退款、不重播。settle只能記known reference或unknown；reference不證明業務已提交或現在可讀，仍須原receipt與即時授權。矛盾settle拒絕，terminal後late completion不覆寫。
- stop只終止本budget域，不能當現有SQL cancel或effect transaction fencing。既有SQL日額reserve／record仍無attempt冪等；可選非SQL模型日額接線見下節，兩者均不彌補root與業務的跨庫原子裂縫。

## 儲存與未完成接線

受信caller提供既有Firestore client／cipher／project／namespace；不讀ADC、不建立資源、不關閉caller client。payload整塊加密，AAD綁格式與project/namespace/root；path使用root hash，metadata無帳號或正文。最多26個獲准attempt、64KiB UTF-8加密document，超界拒絕而不截斷。transaction callback不呼模型、工具、SQL或SDKsuper。

正式刪除／retention／restore epoch尚未接，測試由組裝者只清自有合成資料。不在正式路徑使用本adapter，直至同一受理鏈、日額／業務權威、取消及保留策略完成。ADK2.1原生resume可保留未完成call，但每次Runner會有新native invocationId；Server還需保存其與原root/call/interrupt的mapping。剩餘model=0必須在Runner前停止，不能傳maxLlmCalls:0（SDK視為無限制）。

## 本輪證據

[Adapter 固定驗證](../artifacts/verification/DURABLE_BUDGET_ADMISSION_20261009.json) 區分 754f8816 上的 v1／v2、authorizationVersion 字串修正、原 TS 失敗及 Emulator 結果；[runtime 固定驗證](../artifacts/verification/DURABLE_BUDGET_RUNTIME_20261009.json) 保存 48571cef 上的接線結果、原失敗與網絡 guard 記錄。兩批不能互作重測或完整產品驗收。契約及根文件另審，不在程式 test manifest 內。


<a id="runtime-connection"></a>
## 2026-10-09：單次 runtime 持久扣額接線

受信 constructor `{adapter, context, runLimits?, dailyUsage?}` 提供可選局部接線；`dailyUsage` 的模型日額行為見[下節](#daily-usage)。僅 fixed config、無 resolve 組裝；default memory不變，正式index／worker未啟用；services 的受信可選接點見[下節](#claimed-services)。context與config複製凍結，後改caller options不能切換resolver/session。scope／原run／trigger／pack／effective limits／絕對deadline由runtime比對；workflow/settings/billing/storageEpoch的來源仍由受信組裝者負責，不以重複同值或key hash假裝獨立核實。

- ADK2.1公開beforeModel context已保存session events提供anchor。first用原business message/trigger＋固定step，不用新Runner user event；next只用當前agent/branch已提交實際event。保留PresentationRepair callbacks，不用私有hook或一般allocator。
- 整批工具身份沿已committed model attempt固定子步，先原子扣batch再由SDK補call ID／保存event；不誤稱當前call event已在扣額前保存。embedding沿已保存call event＋callId唯一對應；缺失／重複即停止。
- 原扣額位置保留，snapshot.used不雙扣；lookup禁止再進daily reserve/provider/handler，不退款或換key。query cache在第一個await前保存整個promise，真正Promise.all同query僅一次准入及gateway。
- fingerprint在最終outgoing固定後計算，包含effective config與首輪摘要。durable路徑quota後摘要到期則保守停止、不改payload再發；memory舊行為保留。remaining model零在Runner前停止，正數才給maxLlmCalls，framework-limit沿剩餘量辨識。
- 新runtime用同root重投只停止，不恢復provider或tool結果；原deadline不續命。已提交domain receipt依舊查原權威，SQL日額仍非冪等，跨庫取消／副作用沒有原子fencing。

原 TS／snapshot／缺 seed 失敗、串行案例正名及真正 Promise.all 補驗均保留於[固定記錄](../artifacts/verification/DURABLE_BUDGET_RUNTIME_20261009.json)；npm launcher 曾有兩次被 guard 擋下的 socket 嘗試，不能描述為整批零網絡嘗試。未驗真模型語義、HTTP／UI、production、resume、dynamic setting 或其他三 Agent 內部，尚未部署。真模型批次 20／20 已用盡，不因離線結果增加。


<a id="daily-usage"></a>
## 模型日額 attempt 台帳及實際 gateway 接線

`FirestoreAiUsage` 實作 `DurableAiUsage`，沿用已鎖定的 Firestore 9.3.1、StorageCipher 及現有 daily attempts 上限，不引入新 SDK／SQL migration。受信組裝者在 `createAgentRuntime` 的 `durableBudget.dailyUsage` 注入 adapter；實際 `AgentGatewayModel` 使用它取代該 run 的舊 `usage.reserve/record`，不雙扣 SQL。未注入時完全沿用舊路徑。仍只容許既有 fixed-config＋native session 組裝，不能混入 dynamic routing；正式 index／worker 尚未啟用，services 僅有[受信固定平台可選組裝](#claimed-services)。

### 權威及執行界線

- **root 與日額分工：**root 管原工作所有 model／tool／embedding 次數、binding／generation 及絕對期限；日額只管 model attempt 的本人／全站 UTC 日額及必要 accounting metadata。先取得原 root execute，再取得日額 execute，之後重查 root 與授權才可調 provider。日額 quota／lookup／儲存錯誤、遺失或過期回覆都不退 root 額、不換 key、不退回 SQL。
- **不冒稱跨 store 原子：**root 與日額是兩筆交易。root 已扣而日額未完成時保守停止，可能消耗額度而未呼叫 provider。日額不擁有 run/cancel、業務 effect 或原收據權威，不能取代 transaction fencing。模型請求和 Firestore 也無共同交易；只對遵循此准入協定的同 attempt 發出一次新的 dispatch permission，不保證外部模型 exactly-once，未取得可證實回覆一律保留 unknown。
- **固定身份：**attempt 文件由原 rootRunId＋已持久模型 step key 定址；不含 UTC 日期、billing source 或新 ADK invocationId，所以跨日、換來源或重建程序都不能另建同 attempt。加密 request 綁完整 root context 的 fingerprint（含 authorizationVersion 原字串、epoch、generation、版本及原期限），另綁本人／孩子、模型、最終 outgoing fingerprint 與原 daily limits。任一項變動即 conflict。runtime 的原 scope／trigger／pack／limits 檢查保留；版本及 client/project 的真實來源仍由受信組裝者負責。
- **billing 及限額：**platform／personal 由 Server constructor 固定選擇，不能由 HTTP、模型或聊天內容選擇。兩組 counters 分開；原同 attempt 改 billing source 亦拒絕。沿現有 AiConfig 範圍驗證 user 1–1000、global 1–10000，實際使用該 run 既有設定值，沒有提高預設或給額外呼叫。

### 交易、查回及晚到結果

1. reserve 先讀原 attempt；存在只回 lookup 及原 metadata，永不再發 execute。新 attempt 在同一 transaction 讀本人與全站 counter、核原期限及兩個上限，才一次提交兩 counter＋reserved attempt。所有讀先於寫，最多三個點讀／三個文件寫入；回調重試沒有 provider、SQL、工具、通知或其他外部副作用。reserve 的 UTC day／reservedAt 取該成功回調的受信 Server clock，不由 caller 傳入。此為日額台帳時間，不聲稱 Firestore commit timestamp。
2. 遺失 commit 回覆時可能已扣額。重建 adapter 的 read／reserve 只查原 receipt；record=null 代表用量／結果未保存，不代表未執行。未知或部分 token 保留 `unknownUsageAttempts`，已耗 attempt 不退款；所有 metadata 沿同一 user／global counter 原子加總。
3. record 必須已有同 request reservation，使用原 reservation day。期限後或 root 已停止仍可補該次必要 accounting，但不讀寫 root/run 終態、不授予新模型或工具執行。已保存 record 只接受完全相同重送，矛盾晚到結果拒絕；同 record 重投及 commit 回覆遺失不重加 tokens。取消期間 provider 的 late promise 不自動把已保存 timeout／unknown 改為成功。
4. getForUser 僅投影當前 UTC 日、固定 billing source 的合計。原日 token 晚到不算進今天；查回不是對家庭資料的授權入口，caller 仍須依產品身份／准入閘使用。沒有 query／scan 或複合索引要求；實體 index exemption、讀費、真競爭及雲端驗收仍待 F02。

<a id="daily-counter-consistency"></a>
### 可證實的日額不一致

新 reserve 與尚未記錄的 record 在原 transaction 內核對本人／全站 counter：本人存在但全站缺失，或本人 attempts、known、inputTokens、outputTokens、cachedTokens 任一大於全站，即拒絕且零寫入。tokens 各自加總已知值，不假定部分／null metadata 的欄位等式。原 attempt 的 lookup／read 及相同已保存 record 仍可查回，不因此再執行、退款或改 run 終態；缺口與必要定向見[本輪證據](../artifacts/verification/F01_DAILY_COUNTER_CONSISTENCY_20261009.json)。

這只偵測現存資料已能證明的不一致。新用戶缺本人 counter、新 UTC 日兩 counter 皆缺仍沿既有初始化；本人 counter 單獨遺失、兩者一起遺失或一致回退不能與合法初始化／較早狀態區分。getForUser 仍只是單本人投影。尚無獨立現行 epoch、完整 cloud erasure journal／配對 manifest 的共同權威，本修正不是 restore 開放閘，不能解鎖正式持久流量。

### 私隱、保留及未完成範圍

單文件上限 16 KiB；attempt、counters 都使用既有 AES-GCM 應用加密，AAD 綁格式／版本／project／namespace／hashed document identity。路徑只有固定類別及 hash，外層僅 format/version/ciphertext；不存 request/response 正文、prompt、工具資料、圖片、密鑰或原模型內容。request fingerprint 是原 payload 的 hash，仍作私人 metadata 加密，不放公共索引。

此 adapter 不讀 ADC、不建資源、不接管 caller client、不刪資料、不加 TTL。account／child erasure、retention、restore epoch 與日額不能退款的協調仍未完成，故不能直接啟用正式流量。embedding 日額、動態本人設定、持久受理／outbox、跨庫 effect fencing、真正重啟 resume 與服務 bootstrap 均未因本切片完成；另外三個 Agent 內部仍暫緩。

固定證據見 [F01 模型日額驗證](../artifacts/verification/F01_DAILY_AI_USAGE_20261009.json)。合成串行 transaction harness（Promise.all 同時提交）覆蓋重跑回調、並行 caller 防重、跨 instance 重建、回覆遺失及日界線，真 Runner 只搭 scripted provider；不能代替 Firestore 真競爭、真模型或產品 E2E。SDK 方法沿已安裝 9.3.1 公開型別，交易語義已再核[官方 transactions](https://docs.cloud.google.com/firestore/native/docs/manage-data/transactions)的全讀後寫、回調可能重跑及 atomic commit。


<a id="claimed-services"></a>
## 已 claim run 的固定平台 services 組裝

`createProductAgentServices` 的既有第十一個 `ports` 可注入 `claimedRunPersistence`：已建好的 native Session／root budget／daily usage adapter、固定平台 profile，及可選受信 provider。保留原十個位置參數及 SQL／memory／dynamic routing 路徑；正式 index／worker 不傳此選項。此接點只供隔離、受信組裝，不是正式啟用開關，也沒有新 Firestore client、ADC、資源或 client 關閉權。

- **單次固定 profile：**constructor 比對傳入 AiConfig 與 profile 的完整配置 fingerprint，複製凍結配置及 workflow／pack／settings／billing 版本；要求 enabled、platform billing 及對應 daily adapter。settingsVersion 綁明確版本字串加完整 config hash。缺失／不一致或同時傳 routing 一律拒絕，不能略過本人的停用／personal 選擇而偷偷改用平台。真實 provider 沿既有 gateway；測試只注入 scripted provider。這些版本是受信 Server 的宣告，不代表已獨立核實本人動態設定。
- **沿原 claim：**SQL store 明確投影原 storageEpoch、trigger、recipeId；authorizationVersion 保留原字串，不經 Number。ProductAgent.reply 傳原 claim、scope、runId 及 `Date.parse(expiresAt)` 絕對期限。只有 created=true、running、原 sourceMessageId／interactive trigger 與 product-interactive recipe 相符的新 claim 才可綁定。服務層核 epoch 與原 SQL dataVersion 投影一致；runtime 核原 scope／run／trigger／pack／effective limits。期限必須有效且未過期；local deadline 取原 expiry 與既有 90 秒上限較早者，root 綁原 expiry，沒有重新起 90 秒。
- **共用 runtime：**constructor 可選逐 run `bindDurableRun`，與舊單一 `durableBudget` 互斥，且必須有 native Session、不能有 dynamic resolve。binder 只產生該原 run 的 context，不選模型、key 或個人設定。整個 services 仍只建立一個 runtime，共用同 user 排他及每 instance 四個 active slots；成功、拒絕、儲存失敗或取消均沿原 finally 釋放，不以每 run 重建 runtime 繞過容量。這不是跨 instance 併發控制。
- **持久化與中斷：**fresh claim 的 generation 固定為 1，沒有 lease／接管／遞增。provider 前 root.open 保存 bindingFingerprint、generation、原期限／限額及計數；不保存可讀回的完整 profile 或受理快照。Session 僅 create-only，root → daily → root／授權重查 → provider 次序不變。SQL claim 與 root／Session／daily 各自有交易權威，並非跨 store 原子提交。
- **重投只查回：**claim.created=false 沿既有 get 原 run／收據，零 binder、Session create、root open、日額 reserve、provider 或 effect。SQL claim 後、root.open 前失聯亦不補建 profile 或執行；尚未完成的原 run 依既有業務狀態／到期投影保留 unknown。已提交文件仍用原 documentId／expectedVersion／opId 與原收據查回；取消／失聯不升格完成、不重做副作用，root.stop 不等於 SQL cancel。

本切片的 services → ProductAgent.reply → 共用 runtime → 真 ADK Runner／gateway 使用三個實際 Firestore adapters，底層為串行合成 transaction harness；業務 store factories 及 provider 用合成替身。已合併的 SQL 收據／取消測試另作定向回歸，並不把新 harness 當真 SQL／Firestore 競爭。固定證據見 [services 驗證](../artifacts/verification/F01_CLAIMED_SERVICES_20261009.json)。尚未驗真模型理解、HTTP／UI、Emulator、真雲端、正式重啟或部署；原真模型 20／20 已用盡。動態本人設定、embedding 日額、清理／restore、完整持久受理／outbox、跨庫 effect fencing、跨 instance 限流及 resume 仍未完成；其他三個 Agent 只留接口。
