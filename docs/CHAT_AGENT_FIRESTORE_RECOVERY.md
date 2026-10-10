# Firestore 原背景結果收束窄接點

本模組是 F01 的未啟用 adapter：只收束已存在 claim／run 的本人純到期跟進事件。沒有正式 authority 建立／遷移 writer、bootstrap、Cloud Tasks consumer 或新 run claim；測試以合成 fixture 建立前置文件。它不代替完整 work／event／run 權威遷移，也不實作逐工作起始輸入或執行 outcome。

## 接點與不變條件

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

## 有界保存格式與 writer 歸屬

所有資料在受信固定 namespace 的單一 collection，document ID 為 SHA-256(JSON([kind, originalId]))，只作點讀，不需複合索引。不可按某次 child／epoch 另選 namespace 複製 current authority。原 ID 保存在加密 payload，hash 不是新的業務 ID。

control 的 originalId 固定 current；account 用 owner ID；workspace／child／work／followup／event／run 各沿原 ID；claim 用本人＋孩子＋worker＋event ID；change marker 用 workspace＋epoch＋event ID。

外層 envelope 固定 format=yuban-work-recovery、version=1、ciphertext。AAD 含 format／version／project／namespace／kind／originalId 及該類 canonical scope：control 無 scope、account 只綁 owner、workspace 只綁 workspace ID；其餘綁原 owner／workspace／child／epoch。current workspace 的 epoch 從同一 canonical 文件讀出再核對，不能以舊 epoch 找回另一份 authority。內層 work／event／run receipt 保留既有 SQL AAD 及密文，不靜默改綁。

- control、account、workspace 初始值、child、work／followup、event 初始值、trigger claim、run 初始值及原 receipt：目前只有測試 fixture writer。正式建立、同意／撤權、刪除與遷移 writer 尚未接通，不能拿 fixture 當正式准入。
- 本 adapter 只在上述讀集有效時寫 event 終態、到期 run unknown、workspace sequence 及 private memory change marker。marker 帶 suppressWorkWake=true，不能再次喚醒跟進。
- 每個 envelope／明文有 192 KiB 上限；event 最多五個 constituent；原 receipt text／tools／引用陣列有界。單次最多 18 次點讀、4 次寫入；沒有私人明文索引、掃描、TTL 或不受控 delete。

## 驗證與未驗

復用固定 SDK、Node 原生 test runner、Zod 與既有 cipher，沒有新增依賴或通用 workflow 框架。合成 transaction 檢查 callback 丟棄重跑、撤權／epoch／取消、失回覆及壞 binding；真 SDK／本機官方 Emulator 檢查同 consumer 的原子收束與重投，兩種證據分開。

Emulator、scripted provider 和 fixture 均不是真雲端驗收。正式 account／work／event／run writers、原子新 claim、資源／知識變更事件、membership、資料／裝置遷移、Cloud Tasks／Scheduler、索引豁免、清理／還原、正式 publication／bootstrap 及完整產品成果仍未交付。既有 session／root budget／usage 不代替此業務權威。
