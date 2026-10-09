# 聊天根預算與 attempt 准入

2026-10-09；基線754f8816。此段記錄原 #160 adapter-only 基線；目前的隔離 runtime 接線見[單次接線](#runtime-connection)。正式 Auth／index／worker 與恢復尚未啟用。沿用 Firestore9.3.1及現有StorageCipher，不新增workflow或業務台帳替代品。

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

v2在authorizationVersion字串對齊後重新驗：12項unit、原typecheck、688／688原npm test、Emulator5組含獨立process競爭／重啟／lost reply／終態／加密與容量，皆通過；9個自有child及4個listeners停止。v1的688／5不是v2證據，另保存；首次TS narrowing錯誤與修正亦保留。只驗adapter語義，未驗真模型、runtime扣額接線、SQLeffect原子、HTTP／UI／雲端／部署或產品resume。三個其他Agent內部暫緩，真模型批次20／20用盡不變。

[固定驗證](../artifacts/verification/DURABLE_BUDGET_ADMISSION_20261009.json)。本契約與根文件於程式驗證後另審，不在test source manifest內。


<a id="runtime-connection"></a>
## 2026-10-09：單次 runtime 持久扣額接線

以上adapter-only為 #160 歷史；本輪以48571cef基線新增受信constructor `{adapter, context, runLimits?}` 的局部接線候選。僅 fixed config、無 resolve 組裝；default memory不變，正式index／worker／services未啟用。context與config複製凍結，後改caller options不能切換resolver/session。scope／原run／trigger／pack／effective limits／絕對deadline由runtime比對；workflow/settings/billing/storageEpoch的來源仍由受信組裝者負責，不以重複同值或key hash假裝獨立核實。

- ADK2.1公開beforeModel context已保存session events提供anchor。first用原business message/trigger＋固定step，不用新Runner user event；next只用當前agent/branch已提交實際event。保留PresentationRepair callbacks，不用私有hook或一般allocator。
- 整批工具身份沿已committed model attempt固定子步，先原子扣batch再由SDK補call ID／保存event；不誤稱當前call event已在扣額前保存。embedding沿已保存call event＋callId唯一對應；缺失／重複即停止。
- 原扣額位置保留，snapshot.used不雙扣；lookup禁止再進daily reserve/provider/handler，不退款或換key。query cache在第一個await前保存整個promise，真正Promise.all同query僅一次准入及gateway。
- fingerprint在最終outgoing固定後計算，包含effective config與首輪摘要。durable路徑quota後摘要到期則保守停止、不改payload再發；memory舊行為保留。remaining model零在Runner前停止，正數才給maxLlmCalls，framework-limit沿剩餘量辨識。
- 新runtime用同root重投只停止，不恢復provider或tool結果；原deadline不續命。已提交domain receipt依舊查原權威，SQL日額仍非冪等，跨庫取消／副作用沒有原子fencing。

本輪原typecheck、692／692原npm test、固定Emulator v2六組通過，自有3 listeners停止。原6組案例曾錯稱同query並發，已正名為SDK串行批次重用；另補真Promise.all測試，未用delay假裝並發。初兩個TS narrowing、constructor snapshot漏洞、首聚合691／692因缺基線seed造成ENOENT皆保留；按固定Git blob補回資料而未改斷言。

npm launcher兩次socket嘗試被guard阻擋；113受監測子程序無嘗試。stack定位npm notifier／manifest查詢是來源推論，沒有流量capture目的地證明；不能把本批描述為零網絡嘗試，亦未解除guard。Emulator沒有非loopback連線。

未驗真模型語義／HTTP／UI／production／resume／dynamic setting／其他三Agent內部。真模型批次20／20用盡，不因新離線結果增加。根文件在程式測試後另審。[固定記錄](../artifacts/verification/DURABLE_BUDGET_RUNTIME_20261009.json)。
