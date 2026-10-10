# Firestore 背景工作窄接點（未啟用）

原 `FirestoreWorkContinuationRecovery`（#184）仍只收束已存在 claim／run 的本人純到期跟進事件。新的 `FirestoreWorkContinuationStore` 在同一 canonical 權威前提下，補齊純到期 event 建立、原子起始輸入／claim、受限執行及原結果收束，詳見下節。兩者均未由正式 bootstrap 選用，沒有 Cloud Tasks／Scheduler 或正式 authority 建立／遷移；測試以合成 fixture 提供 account／workspace／child／work 等前置文件。這不是完整 Firestore 遷移、通用接續或逐工作完成 outcome。

## 原 V1 recovery 接點與不變條件

既有 `createAgentWorkContinuationWorker` 使用抽出的 `createAgentWorkContinuationProcessor`，仍走 `mode: execute` 及原 PostgreSQL 路線。新的 `mode: recover` 只接受 `WorkContinuationRecovery.recoverBackground`；沒有模型、`backgroundInput`、新 claim 或 SQL fallback。兩種模式由 Server 組裝選擇，HTTP／模型不能指定。原 run 尚未到期則回 pending，consumer 拋出原等待錯誤；不執行剩餘工作。

`FirestoreWorkContinuationRecovery` 由受信 Server 提供既有 SDK 9.3.1 client、cipher、project／namespace，以及原 owner／workspace／child／storageEpoch。adapter 不讀環境憑據、不建資源。client 與 project 配對沿既有受信組裝責任，未透過私有 SDK getter 推斷。

- 只支援 workspace owner；不假裝已有 member／device session 遷移。
- event 須已有原 runId 和確定 trigger claim；同批最多五個不同 work，全部變更為 due=true、resources／knowledge 空陣列。仍有效的 work 亦須純 due，沒有 resource／knowledge watch。
- 每次原生 read-write transaction 重讀 control、account 准入／邀請／電郵核實／目前服務同意／刪除閘、workspace owner／accessVersion／epoch／刪除閘、child、event、claim、run 及至多五組 work／followup。followup 必須同 workVersion／scope；有效資格再核 enabled、active-or-waiting 及到期。
- 取消或改版的 work 不再提供有效資格。全部失效時，取消結論只屬 event；若原 running 亦已到期，同次依過期規則收束 run，保留原 receipt、不改 work。部分仍有效則保留同批結果語義，不改任何 work 的 completed。缺失文件不是取消證據，會阻塞。
- receipt 僅作原 runId／status／stopReason 綁定及有界結構驗證，不返回 text／citations／tools；本切片沒有目前來源重驗，不可拿它顯示私人結果或照護結論。
- 缺失或損壞的 authority／claim／run／必要 receipt、身份／epoch／世代衝突均拋錯，零寫且不能補建 claim。唯一新推導的 unknown 是已存在 running、原 deadline 已到且原 receipt=null；已知終態保留。缺少 stopped／completed receipt 不當作 unknown。
- 全讀後寫、callback 可重跑。成功收束最多寫 event、到期 run、workspace changeSeq、同事件確定的 private change marker 四份文件；不發 outbox／通知／模型，不新增工作。不確定 commit 回覆由原 job／event 查回，不能重執行。
- event 已終態時仍重核權威及綁定，然後 no-op；這不宣稱 event 終態與之後 run 結果相同，不修復或覆寫兩者或原 receipt。到期／取消先後的結果只能來自成功提交的 attempt。

## 原 V1 保存格式與 writer 歸屬

所有資料在受信固定 namespace 的單一 collection，document ID 為 SHA-256(JSON([kind, originalId]))，只作點讀，不需複合索引。不可按某次 child／epoch 另選 namespace 複製 current authority。原 ID 保存在加密 payload，hash 不是新的業務 ID。

control 的 originalId 固定 current；account 用 owner ID；workspace／child／work／followup／event／run 各沿原 ID；claim 用本人＋孩子＋worker＋event ID；change marker 用 workspace＋epoch＋event ID。

外層 envelope 固定 format=yuban-work-recovery、version=1、ciphertext。AAD 含 format／version／project／namespace／kind／originalId 及該類 canonical scope：control 無 scope、account 只綁 owner、workspace 只綁 workspace ID；其餘綁原 owner／workspace／child／epoch。current workspace 的 epoch 從同一 canonical 文件讀出再核對，不能以舊 epoch 找回另一份 authority。內層 work／event／run receipt 保留既有 SQL AAD 及密文，不靜默改綁。

- control、account、workspace 初始值、child、work／followup 仍只有測試 fixture writer；原 V1 event／claim／run 的來源亦只經合成前置驗證。下述 V2 切片另寫原子 event／claim／run／receipt，但正式建立、同意／撤權、刪除與遷移 writer 尚未接通，不能拿 fixture 當正式准入。
- 本 adapter 只在上述讀集有效時寫 event 終態、到期 run unknown、workspace sequence 及 private memory change marker。marker 帶 suppressWorkWake=true，不能再次喚醒跟進。
- 每個 envelope／明文有 192 KiB 上限；event 最多五個 constituent；原 receipt text／tools／引用陣列有界。單次最多 18 次點讀、4 次寫入；沒有私人明文索引、掃描、TTL 或不受控 delete。

## 原 V1 驗證與未驗

復用固定 SDK、Node 原生 test runner、Zod 與既有 cipher，沒有新增依賴或通用 workflow 框架。合成 transaction 檢查 callback 丟棄重跑、撤權／epoch／取消、失回覆及壞 binding；真 SDK／本機官方 Emulator 檢查同 consumer 的原子收束與重投，兩種證據分開。

Emulator、scripted provider 和 fixture 均不是真雲端驗收。原 V1 接點未包含 account／work／event／run writers 或原子新 claim；下述新增純到期 V2 切片只補其中有界部分。正式權威生命週期、資源／知識變更事件、membership、資料／裝置遷移、Cloud Tasks／Scheduler、索引豁免、清理／還原、正式 publication／bootstrap 及完整產品成果仍未交付。既有 session／root budget／usage 不代替此業務權威。


## 純到期同庫 writer／consumer 切片

本節只涵蓋 `FirestoreWorkContinuationStore` 與既有 services／processor 的受信 opt-in，沒有改正式 `index.ts`／`worker-main.ts`。不是把 SQL 的 work 或 run 寫入後再鏡像到 Firestore。新分支的業務讀寫只到同一 database／namespace；舊 PostgreSQL processor、原 V1 recovery 及互動聊天路徑保留。

### 前置與能力

- Server 必須先提供真實有效、同庫、單一 canonical 的 control／account／workspace／child／work／followup。當前測試只有 fixture 建立這些前置；正式建立、服務同意、撤邀請、刪除及 epoch／accessVersion writer 沒有因此完成，也不准用 SQL precheck 後鏡像作替代。control 仍唯一 `current`，account 沿 owner，workspace 沿 workspace ID，不能按孩子或 epoch 另建可重播的 gate。
- `enqueueDue` 的最多 5 個 work ID 是受信 Server 候選，不是 HTTP／模型輸入，也不是新的掃描／排程器。只接受 owner 本人、active／waiting、enabled、已到期，且沒有 resource／knowledge watch、resources 或 pending proposal 的 work。原 work／followup 綁定、payload 狀態及 dueAt 必須一致。尚未到期的首次候選可略過；已入 event 的原到期條件矛盾則拒絕。
- `createProductAgentServices` 只有收到實際 `workContinuationAuthority`、既有完整 `claimedRunPersistence` 及顯式 provider，才組裝 `.continuation`。不可落預設 Vertex provider、memory budget 或 SQL 日額；本次 provider 全為 deterministic stub。這個有界分支只提供 `read_work` 與 `present_answer`，不開其他 SQL 工具、知識搜尋、外發、確認或業務修改。`read_work` 只讀本次 included 且目前有效的工作，沒有來源時間戳時不捏造標準公開 `AgentWork` DTO；它是內部工具投影，不開新 HTTP shape。
- presentation 沿既有 `agentAnswerSchema` 及共用 URL 檢查，只接受 clarification／record_restatement、空 citation IDs。caregiving／safety_help／operation／private_reference 不在此切片能力內。這是機械能力與格式限制，沒有聲稱已驗證真模型理解、每句事實或通用照護品質。

### 交易及起始輸入

1. `enqueueDue` 在同次交易重核 canonical gates、候選 work／followup，以及確定的 owner＋child＋香港日期 daily marker。首次提交同寫 event、marker、被選 followup 的 dueConsumed、workspace changeSeq 及 suppressWorkWake 的 private change。event／job 新 UUID 於 callback 外固定。重試或失回覆查到 marker，回原 job；不同候選亦不能同日新建第二個 event。marker 缺失／變造等不一致不能靠覆寫原 event 修復。
2. `beginBackground` 在同次交易讀完整原 event 候選、確定 trigger claim、目前 gates 與每項 current work／followup。原 workVersion 改變、取消、完成或停用者分類 not_included；缺失／解密失敗／錯誤綁定不是排除證據。快照覆蓋全部候選，最多 5 項、無重複，順序及 workVersion 與原 event 完全相同。
3. 若有 included，原子建立原 trigger claim／run 與單份 event inputEvidence。snapshot 綁 eventId、runId、owner／workspace／child／epoch、authorizationVersion、workerGeneration、每項 workId／workVersion 及 included／not_included。context 使用同一 attempt 已讀工作，只有 transaction fulfilled 的結果交 processor，不能從丟棄 callback 洩出；提交後不重新選工作或以另一查詢重建起始 context。若全排除，只有同次確認 deterministic claim 不存在，才提交 cancelled event、全排除 snapshot 及 runId:null。
4. processor 的 `durable` 分支直接把這次已提交 claim／context 交 `ProductAgent.backgroundClaimed`，不調原 SQL `backgroundInput` 或 `store.claim`。重投只走原 claim／snapshot 查回；尚未到期 running 回 pending，過期且沒有 receipt 才按原結果規則 unknown，絕不接管或再次呼叫 provider。claim commit 失回覆也沒有 execute 許可，即使本次未送 provider，亦不重播。

### 執行、取消與原收據

- 每次 authorize／read_work／finish 都再讀同庫 canonical gates、event／snapshot、claim／run 及完整原候選 work／followup。run 的原 dataVersion、絕對期限與 scope 要吻合；任一 included 工作後來失效，就不能繼續使用原 context 或 finish。這是保守停止整個在途 run，並不回寫歷史 included。
- 既有 ADK runtime、session、root budget 與日額鏈照常使用。binder 只在上述 Server opt-in 下接受 product-work-followup／worker、sourceMessageId:null 的原 claim，核對 trigger／scope／run／原絕對期限及 UUID workerGeneration，後者亦綁入 durable workflow identity。原數量與日額上限不變；root／daily protocol 仍是各自既有交易，沒有宣稱它們與業務 transaction 是一次跨 store 原子提交。
- `finishBackground` 先完成所有讀取及狀態核對，才同寫原 run receipt／終態、event 終態、workspace sequence 和 suppressWorkWake change。取消、過期、版本／dataVersion 失效或已終態時零寫；已 completed／stopped 的原密文不可被相同或晚到結果覆蓋。receipt 只許本分支的工具名、無公共／私人引用、不含 proposal。
- `recoverBackground` 保留原結果及 event 終態優先。新 V2 event 可以全排除且沒有 run；新 durable consumer 收到 V1 event 時，beginBackground 先在同次交易核原 canonical gate、scope／job 及 claim／run，只回 lookup，再交原 V1 recovery 完整驗證；不補 inputEvidence、不重新加密，也不給執行權。取消只收束 event，不改 work 的 completed，也不代表已撤回在途 provider。取消發生於 run 原期限前時可以留下原 running／null receipt；event 已終態後 recovery 不再改它或 run，正式生命週期清理仍是未完成前置。

### 格式、界限與清理責任

- 原權威／work／followup／claim／run 保持 V1 envelope／原密文 AAD。新 event 使用同 format 的 envelope version=2，AAD 明確含該版本、project／namespace／kind／eventId 及原 owner／workspace／child／epoch；內層亦驗證 inputVersion=2 與 inputEvidence 的 format／version。V2 已有 run 卻缺 snapshot 是錯誤；本切片不把缺欄誤當歷史 unknown，也不啟用 #183 的 query／DTO。
- daily marker 以 kind=daily、owner／child／香港日確定 ID，所有 metadata 均受加密驗證；不存 prompt、context 正文或結果副本。queued 與 terminal change 各有不同確定 ID，不能第二次推進 sequence。單文件仍有 192 KiB 上限，完整候選最多 5。
- 首次 due 建立最多 17 點讀／9 寫；首次有效 claim 最多 17 點讀／3 寫；finish 最多 18 點讀／4 寫。新 recovery 的版本選擇多一個唯讀點讀，V2 主交易最多 18 點讀／4 寫；原 V1 類別自己的界限不變。沒有全庫掃描、索引建立或 TTL。
- 真正投入服務之前，原 owner／child／work／event／run 清理 closure、daily marker、snapshot、兩個 change marker 都必須納入同一 tombstone／epoch／有界清理及獨立 restore journal。這些 lifecycle writers、清理索引、outbox／Cloud Tasks、Scheduler、API projection、遷移／bootstrap 均未交付，不能因本切片測試通過而啟用正式持久流量。

### 本次證據範圍

固定合成前置＋真 services／processor／ProductAgent／ADK runtime／Firestore session、root 和 daily adapters；所有 provider 為 deterministic stub，資料庫為串行 synthetic transaction harness。callback discard／commit 失回覆及 consumer 重投只證明所測機械語義，不當作原生 Firestore 競爭或真雲端證據。新增缺席紅、首版語法／型別失敗、最初 mixed race 錯誤斷言，以及 reviewer 發現新 consumer 未達 V1 recovery 的修前紅保留於固定驗證記錄，沒有把錯誤斷言當產品缺陷。舊 V1 recovery／PG 背景 consumer 是定向回歸，非全量驗收。沒有新真模型、Emulator、HTTP／瀏覽器、雲端資源或部署。最終測試與版本見 `artifacts/verification/F01_DUE_WORK_AUTHORITY_20261010.json`。
