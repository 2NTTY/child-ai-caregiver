# 聊天根預算與 attempt 准入

本契約定義根預算 adapter 及[可選單次 runtime 接線](#runtime-connection)的不變量。沿用 Firestore 9.3.1 及現有 StorageCipher，不另建 workflow 或取代業務台帳；正式 Auth／index／worker 與恢復尚未啟用。各批基線及驗證範圍見[固定證據](#本輪證據)。

## 身份、額度與期限

rootRunId 是原 business run，不是長期work或每次新建的ADK invocation。binding包括owner/workspace/child、authorizationVersion原字串、storageEpoch、原trigger/reference、workflow／pack／settings／billing版本、effective limits及原絕對wall deadline。authorizationVersion依AgentScope／SQL access_version::text保留字串，不能轉Number；全部識別欄有界。無HTTP／模型配置入口，不存密鑰或正文。

同root只在binding／generation完全相同時讀回，不能改限額或重置used。上限沿現有Server設定範圍：model1–12、tool1–8、embedding1–6，預設4／8／2；不意味自動獲得最大額度。原deadline不因重啟／等待續命。serverclock由受信constructor提供，非外部request參數。

## 原子准入

- open／read／reserve／settle／stop均核原binding及generation。root保存在單一原子有界Firestore document，沒有自動takeover／generation遞增、delete或TTL。
- reserve前核終態、期限與剩餘額。預留即耗、無退款，model／embedding每次一格，工具batch全有或全無。僅新提交reservation回execute；同key同fingerprint重投只回lookup，不再扣或授予執行。samekey異內容conflict。lost reply也不能重新發execute。
- attempt key必須由外層已持久受理鏈提供；不得用新invocationId或程序從零ordinal偽裝同attempt。unknown不退款、不重播。settle只能記known reference或unknown；reference不證明業務已提交或現在可讀，仍須原receipt與即時授權。矛盾settle拒絕，terminal後late completion不覆寫。
- stop只終止本budget域，不能當現有SQL cancel或effect transaction fencing。SQL日額reserve／record尚無attempt冪等，本adapter不彌補跨庫原子裂縫。

## 儲存與未完成接線

受信caller提供既有Firestore client／cipher／project／namespace；不讀ADC、不建立資源、不關閉caller client。payload整塊加密，AAD綁格式與project/namespace/root；path使用root hash，metadata無帳號或正文。最多26個獲准attempt、64KiB UTF-8加密document，超界拒絕而不截斷。transaction callback不呼模型、工具、SQL或SDKsuper。

正式刪除／retention／restore epoch尚未接，測試由組裝者只清自有合成資料。不在正式路徑使用本adapter，直至同一受理鏈、日額／業務權威、取消及保留策略完成。ADK2.1原生resume可保留未完成call，但每次Runner會有新native invocationId；Server還需保存其與原root/call/interrupt的mapping。剩餘model=0必須在Runner前停止，不能傳maxLlmCalls:0（SDK視為無限制）。

## 本輪證據

[Adapter 固定驗證](../artifacts/verification/DURABLE_BUDGET_ADMISSION_20261009.json) 區分 754f8816 上的 v1／v2、authorizationVersion 字串修正、原 TS 失敗及 Emulator 結果；[runtime 固定驗證](../artifacts/verification/DURABLE_BUDGET_RUNTIME_20261009.json) 保存 48571cef 上的接線結果、原失敗與網絡 guard 記錄。兩批不能互作重測或完整產品驗收。契約及根文件另審，不在程式 test manifest 內。


<a id="runtime-connection"></a>
## 2026-10-09：單次 runtime 持久扣額接線

受信 constructor `{adapter, context, runLimits?}` 提供可選局部接線。僅 fixed config、無 resolve 組裝；default memory不變，正式index／worker／services未啟用。context與config複製凍結，後改caller options不能切換resolver/session。scope／原run／trigger／pack／effective limits／絕對deadline由runtime比對；workflow/settings/billing/storageEpoch的來源仍由受信組裝者負責，不以重複同值或key hash假裝獨立核實。

- ADK2.1公開beforeModel context已保存session events提供anchor。first用原business message/trigger＋固定step，不用新Runner user event；next只用當前agent/branch已提交實際event。保留PresentationRepair callbacks，不用私有hook或一般allocator。
- 整批工具身份沿已committed model attempt固定子步，先原子扣batch再由SDK補call ID／保存event；不誤稱當前call event已在扣額前保存。embedding沿已保存call event＋callId唯一對應；缺失／重複即停止。
- 原扣額位置保留，snapshot.used不雙扣；lookup禁止再進daily reserve/provider/handler，不退款或換key。query cache在第一個await前保存整個promise，真正Promise.all同query僅一次准入及gateway。
- fingerprint在最終outgoing固定後計算，包含effective config與首輪摘要。durable路徑quota後摘要到期則保守停止、不改payload再發；memory舊行為保留。remaining model零在Runner前停止，正數才給maxLlmCalls，framework-limit沿剩餘量辨識。
- 新runtime用同root重投只停止，不恢復provider或tool結果；原deadline不續命。已提交domain receipt依舊查原權威，SQL日額仍非冪等，跨庫取消／副作用沒有原子fencing。

原 TS／snapshot／缺 seed 失敗、串行案例正名及真正 Promise.all 補驗均保留於[固定記錄](../artifacts/verification/DURABLE_BUDGET_RUNTIME_20261009.json)；npm launcher 曾有兩次被 guard 擋下的 socket 嘗試，不能描述為整批零網絡嘗試。未驗真模型語義、HTTP／UI、production、resume、dynamic setting 或其他三 Agent 內部，尚未部署。真模型批次 20／20 已用盡，不因離線結果增加。
