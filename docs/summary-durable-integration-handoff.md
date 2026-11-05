# 私人摘要單一整合交接

本文件只記 #410 後續修復與 #447 整合的接口選擇及啟用前置，不取代 API／資料契約或另建待辦。候選狀態、分項證據及最終驗收 gate 只見 [PLAN](../PLAN.md#req005-summary01)。基底已接 master `f0149b79e2f7f653f63559a237f53ee3b7a34b4c`。原 #447 head `dc1f16cfb39ac74fe5d4d13ef250b88fdf7ffc34` 保留追溯；替換前 head `c14cea1e1b9a65c7c22665ed1c5116632a8a7e6c` 僅 rebase，原四項 blocker 未修，本包改採下述單一 durable 方案。

驗收分開記錄：`88ce04f` 封定候選的完整型別及 554 項本地驗收、`235ddd3` 的完整型別與 13 整檔／44 項定向補驗均保留；最新 `f0149b` 同源候選再通過完整型別及 21 整檔／87 項定向補驗（含 CI 契約 6 項）。三批不相加，也不稱最新基線全套已重跑。最新 registry 為 87 檔／555 項＋CI 6 項，遠端精確 head 預期 561 項仍須成功；尚未正式啟用或部署。

## 唯一工作與保存路徑

- Firestore 長來源／大 repair 沿 [private-summary-work](../server/private-summary-work.ts) 及 [durable store](../server/firestore-private-summary-work.ts) 的 work、immutable source revision、grant、usage、attempt、lineage／outbox 接續。新訊息、跨日、重啟與重送不重設同一工作的帳。
- 部分累積只存 server-only durable work，不走普通 `summarySave.part`，亦不保留第二套 `conversation-summary-progress` writer／restore 協定。完整來源 cursor 到尾、來源與權限仍有效，才由 [memory writer](../server/firestore-memory.ts) 原子發布完整 coverage；保留 sourcePeriod 及以實際時間比較的 expiry。
- 原完整 prefix fast 及 [SQL writer](../server/memory-summary.ts) 保留；每次供應商請求按完整 native request fitting，不以固定原文字數切片、截斷首筆或跳過長來源充當修復。終態保存／查回須先於 session cleanup，未知結果不換 run、root 或 grant 重試。

## Fast 轉慢路徑與公平排程

1. Fast 在同一 authority 交易綁原來源及 lineage，並在 admission 前持久保存原 root context；選定完整 prefix 後，每次 authorize 都重新核實真正 payload 與全部 pointer。
2. 只有原 root 已 stopped、原 admission 確實全零，才保存 no-dispatch 證明並允許一次 T0。runtime 回報 counts=0、找不到 root 或逾時均不足作證。ACK 晚到由 scheduler 查回同一持久證明，不再次派發。
3. [持久 scan](../server/firestore-private-summary-scan.ts) 固定每輪 source／work 上界，跨過有效或 blocked 舊項，不因新聊天反覆重開最近窗口。只有已提交的實際進度才切換 fresh／repair 偏好；選取本身不算進度。
4. unknown 的完整來源映射須由 [實際 worker](../server/firebase-worker-services.ts) 在最後排程交易再核原 claim、run 及所有 selected pointers。早一步讀到的 Boolean 只作路由提示，不能解除全域 fence。清除 pending 須同 basis 掃描完結、fresh 已追上、無 unfinished work／pending wake／未知屏障，並與原 context request 作 CAS。
5. completion wake 只是既有 queue 的 scope scan 提示，不授新 grant 或 coverage。suppressed marker 必須源自當前權威觀察，不能覆蓋 unknown ownership 或跳過最舊 fresh；其 writer 與 refresh administrative-progress hook 已完成同一候選的合成驗證及獨立覆核。

## 正式啟用及恢復邊界

- production 尚缺可信累積 work-grant 政策數值，不從既有每 run／每日上限推算或自行填值。
- [inventory](../server/firestore-private-summary-inventory.ts) 每頁須讀實際 authority，證明舊 writer 在捕獲固定上界之前已受 fencing，且至今沒有中斷。現時缺 production reader，空 scope 亦不能視作完成；`installed:true`、`control.paused` 或 inventory `complete` 本身不證明舊 binary 已失去派發權。缺原身份、跨世代或不完整 pointer 映射保持 unmapped，不自動補造授權。
- [入口 gate](../server/firestore-private-summary-cutover.ts) 對已建立的 activation／inventory／blocked／restore_suspended 狀態保守拒絕；policy 消失不回退 legacy 新帳。只有從未啟用、沒有 retained durable 歷史的 scope 保留原完整 fast。
- [restore](../server/firestore-restore-private-summary.ts) 在新 epoch 建立 `restore_suspended`，保留原 grant、usage、reservation 及未知結果；沒有 resume／transfer／grant renewal 授權，R0／R2 仍 blocked。
- 本地 index comparator 通過不代表雲端索引 READY；合成 worker 全鏈通過亦不代表真 Firestore 競爭、模型品質、設備或正式啟用。正式政策、持續 fencing、索引及完整最終候選驗收未齊前，不得將本整合表述為用戶修復已上線。
