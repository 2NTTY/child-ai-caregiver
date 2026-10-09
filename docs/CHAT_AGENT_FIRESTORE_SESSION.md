# 聊天 Agent 的 Firestore 會話適配

本契約定義 Firestore Session 儲存適配及[可選單次 runtime 接點](#runtime-port)。預設每 run InMemory 不變；正式 Firestore 遷移、跨輪產品接線與全面驗收尚未完成。各批基線及原失敗見下列固定證據。

## 選擇與復用

完成品採 Firestore Standard Native，業務資料及運算預設香港 asia-east2，保留應用層加密。SQL 專用會話候選停止交付。保留 ADK JS 原生 Runner／Workflow／RequestInput／ResumeInputs，只在公開 BaseSessionService 補儲存接點，不複製 SDK workflow、private write-order 或另一套業務工作台帳。

已比較最新正式 Python ADK 2.11.0 與 JS core 2.2.1；兩者都有原生追問恢復及取消。Python 有官方 FirestoreSessionService，但沒有專案所需的 cipher／serializer hook；保留加密仍需適配。改 Python 另須建立目前不存在的受控跨程序工具邊界，維持原 owner、run／call／op、確認、取消與收據；不能直接傳 TypeScript closure。資料從 SQL 遷至 Firestore 是兩路共同成本，不能算作 Python 獨有成本。

本包沿已驗的 ADK JS 2.1.0／GenAI 2.24.0，不因最新版存在便升級；採固定 Firestore Node SDK 9.3.1。這是目前證據支持的局部方案，不是禁止日後依實證改選 Python。

## 組裝與權威

- 只接受受信 Server 組裝者提供的既有 Firestore client、明確 project／namespace 及現有 StorageCipher；不建立 client、讀 ADC、建資源、取得身份或由 HTTP／模型指定配置。client 生命週期仍由建立它的組裝者管理。
- Firestore 9.3.1 沒有公開 typed projectId getter；client與明確project的配對由組裝者負責，本模組只驗project字串及用作AAD，不宣稱同步核實遠端project。不得cast／反射讀取private getter。先前JS fixture的該配置讀取已另記補正，原測試結果未改寫。
- 儲存適配只經下列[受信單次 runtime 接點](#runtime-port)可選注入，HTTP、正式 index／worker 未啟用；存在此模組不表示前端已能跨程序追問。身份 ID 的儲存路徑隔離不等於產品已做 Firebase／家庭授權。
- 原生事件為執行進度，業務 operation receipt 才是提交證據。使用者回答追問不代表批准副作用；不得把 ResumeInputs 或 functionResponse 當確認、保存或送達證據。

## 持久化不變量

- 保留完整 JS camelCase Event JSON、原生 parts／IDs／signatures／workflow 欄位；不轉 Python 欄位或時間單位。symbol／undefined／prototype 按明示 JSON 邊界處理；不得把任意非 JSON 資料當已支持。
- app／user／session state 及 Event 全部使用現有 StorageCipher，加密 AAD 綁格式、project／namespace、種類及 tuple。metadata 索引不保存正文；不能另存明文 stateDelta 或 rawEvent。共享 app/user scope 不可因此存放孩子私人狀態。
- create 拒絕既存；append 以 Firestore 原生交易核 session revision，原子更新事件與狀態。marker 綁已讀出的 Session 物件，lastUpdateTime 不是 CAS。任意構造、list 投影、stale 或 poisoned Session 不可直接 append。
- 相同 event.id 可合法 replacement；完全相同持久 payload 的重送在 super 前識別，不能將較舊事件重新套用造成 state 回退。業務防重仍獨立處理。
- 公開 super 作用於原物件，保留原生程序內 write-order；不得在 Firestore 可重試 callback 中執行它、模型或工具。交易失敗／回應丟失及 Event 在 await 期間被改動會使該 Session 失效，必須 fresh get；不宣稱記憶體或已提交資料自動回滾。
- shared state 只合併本次有效 keys，保留其他 Session 最新 keys。刪除先可靠標 deleting，再以同一快照 updateTime 作原生 batch precondition，避免舊清理刪掉同 tuple 新 Session。

## 有界範圍與未啟用限制

每 Session 最多64個 event documents、每 outgoing document 保守上限900 KiB UTF-8 JSON；超界拒絕而非截斷。owner list 最多讀101筆以辨識超過100筆的範圍，超界明確拒絕，不捏造完整列表或總數。這是本候選的有限範圍，並非完整長期歷史／分段／附件或大型清理方案。

app/user shared documents 不隨單 Session 刪除。產品准入仍須沿帳戶／孩子刪除、家庭撤權、獨立刪除 journal、備份還原及 storage epoch 固定生命週期；不能假定 Firestore 子集合會自動 cascade。Emulator fixtures 須明確參數、在載入 SDK 前拒絕非 demo 配置並安裝 loopback 網路 guard；不得把本地測試接到正式服務。

## 已核可行性與下一步 gate

隔離 JavaScript fixture、69da307 上的 TypeScript 模組及其精確 app lock 驗證，依[模組固定證據](../artifacts/verification/CHAT_AGENT_FIRESTORE_SESSION_CHECKS.json)區分。原生跨 process 追問、原 call／effect receipt 及根剩餘額度的合成結果不等於產品 resume、真模型語意或正式雲端驗收；原 typing／依賴閉包／診斷失敗及修正保留，不能把局部通過稱為整套 app 安裝或 full build 通過。

特別已觀察到：NodeTool 的背景函式可能在 Runner 儲存失敗後繼續。合成安全 gate 由外層 abort、持久 stopped/cancelled 及 mutation 交易內重驗共同提供；不能聲稱 SDK 已 kill 工具。functionResponse 保存失敗時，已提交 receipt 仍須可查且同 op 不重寫。停止 ledger 本身不可用或工具繞過領域提交邊界時，這份證據不提供通用保證。

正式接線前還須驗原 run／work／interrupt／原訊息／孩子／版本綁定、根預算跨恢復原子累計、確認與回答分開、取消／撤權競爭、已保存效果查回、錯誤／unknown不重做，以及真 Firestore 索引／IAM／交易／配額／跨 instance 與刪除恢復。Emulator 通過不能代替上述 gate；另外三個 Agent 不在本包實作。

## 全倉離線回歸的額外核對

69da307 基線與候選的原聚合 typecheck 均有 20 項相同 diagnostics，npm test 均有 44 項失敗；首輪 guard 誤擋固定 Yoga 內嵌 WASM 的 45 fail 亦保留。完整成對結果、修正範圍及當時 required checks 的 403 未知記錄見[固定證據 aggregateOffline](../artifacts/verification/CHAT_AGENT_FIRESTORE_SESSION_CHECKS.json)。這些是歷史失敗／觀察，不能改稱全倉通過；後續接線批次另有證據，不能回填覆蓋舊結果。

## 官方依據

- [ADK JS 2.1 公開 Session 基類](https://github.com/google/adk-js/blob/adk-v2.1.0/core/src/sessions/base_session_service.ts)
- [ADK JS 原生 Event](https://github.com/google/adk-js/blob/adk-v2.1.0/core/src/events/event.ts)
- [Python 2.11 官方 Firestore 實作](https://github.com/google/adk-python/blob/v2.11.0/src/google/adk/integrations/firestore/firestore_session_service.py)
- [Firestore Emulator 邊界](https://docs.cloud.google.com/firestore/native/docs/emulator)


<a id="runtime-port"></a>
## 2026-10-09：可選單次 runtime 接線

`createAgentRuntime` 接受受信的 `nativeSessionService` 公開 BaseSessionService 接點；預設每 run InMemory 不變。尚未在正式 index／worker 或共用 services 工廠啟用，不改照片、私人來源及背景其他配方。

- 注入實作須原子拒絕已存在的 app/user/session；公開 BaseSessionService 型別本身不保證 create-only。原生 InMemory 的覆寫語義不可當作已符合此注入契約；本 Firestore 實作以交易拒絕 collision，並有本地實測。
- 本輪 create-only，使用原 runId，不恢復舊 session、不 fallback 或重做工具。只對成功確認本次建立的 session 擁有清理責任；create 回應不確定／collision 不盲刪，seed 也在同一生命週期管理內。公開方法 guard 沿現有 budget／authorize，不複製 SDK private write-order；native Session/Event 原物件保留。
- 取消／撤權／deadline 後無法安全執行 cleanup 時，不能稱已清除。清理錯誤不覆蓋原主要錯誤；無主要錯誤但清理失敗則保守 stopped/unavailable。已提交業務效果仍查原 receipt，不宣稱 storage error 能撤銷效果或殺死背景工具。測試組裝者另清自己的合成資料不等於 runtime 已清理。
- 未驗真模型、HTTP／UI、正式 Firestore／Auth、雲端及部署。跨程序恢復還須 owner／child／auth／epoch 與原 run/work/message/interrupt 綁定、持久根 budget、lease/generation、取消和 domain receipt/changes/outbox 協調；原生事件不替代業務 authority。現有取消已 SQL 持久化，process Map 只是 Abort 加速。

9544b3cc 上的[單次接線固定證據](../artifacts/verification/FIRESTORE_RUNTIME_INTEGRATION_20261009.json)記錄原 typecheck、離線及 Emulator 結果，並保留 focused 52／58、ES2023 型別錯誤、前置 guard 停止及依賴探針缺陷；不是早期 CRUD／workflow 的重跑。根文件及摘要另審，不包含在程式 test manifest。
