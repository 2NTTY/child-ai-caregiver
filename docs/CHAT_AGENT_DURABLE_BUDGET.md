# 聊天根預算與 attempt 准入

2026-10-09；基線754f8816。這是獨立受信儲存 adapter，尚未接 runtime／SQL／Auth／index／worker，也沒有啟用恢復。沿用 Firestore9.3.1及現有StorageCipher，不新增workflow或業務台帳替代品。

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
