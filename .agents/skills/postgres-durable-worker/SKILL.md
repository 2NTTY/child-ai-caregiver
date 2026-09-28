---
name: postgres-durable-worker
description: 接入或修改 pg-boss 的 PostgreSQL 交易入列、worker 領取、有限重試、shutdown 或備份還原時使用；不適用純 UI、產品 prompt 或通知渠道協定。
---

# PostgreSQL 持久工作

適用 pg-boss 12.34.0／schema 42、pg 8.23、Node 24、PostgreSQL 18。最後官方型別／原碼核對：2026-09-28；文件及 TypeScript 接口已核對，真資料庫行為仍待本包必要驗收。產品規則以專案權威文件為準。

- `send(...,{db})` 的 `db.executeSql(text,values)` 必須綁目前已 BEGIN 的同一 PoolClient；不能改用 Pool.query，或由 adapter 偷開／提交另一交易。業務與入列一起 commit／rollback，核對 send 返回 ID；null 不是成功。[adapter](https://github.com/timgit/pg-boss/blob/12.34.0/docs/api/adapters.md)／[createJob](https://github.com/timgit/pg-boss/blob/12.34.0/src/manager.ts)
- 安裝／升級由明確 migration 流程負責。runtime 用 migrate:false，要求 schema 精確匹配；migrate:true 不保證拒絕更新的 DB schema。start 返回也不保證 BAM 背景 migration 全部完成，需核對狀態。自訂 DB adapter 的 pool 由呼叫者在 stop 之後關閉。[contractor](https://github.com/timgit/pg-boss/blob/12.34.0/src/contractor.ts)／[start／stop](https://github.com/timgit/pg-boss/blob/12.34.0/src/index.ts)
- heartbeatSeconds／expireInSeconds／retryLimit／retryDelay／retentionSeconds／deleteAfterSeconds 是 queue/job 選項；monitorIntervalSeconds 是 instance 選項，heartbeatRefreshSeconds 是 worker 選項。heartbeat 預設關閉；設定後 work 會自動 touch。retryLimit 指首次以外的重試次數，延期／重建 job 不可重置業務總預算。keep_until 從 startAfter 計算，處理很久前到期的工作時應把框架 startAfter 設為現在，保留原業務 dueAt。[型別](https://github.com/timgit/pg-boss/blob/12.34.0/src/types.ts)／[SQL](https://github.com/timgit/pg-boss/blob/12.34.0/src/plans.ts)
- 框架 claim／heartbeat 不能替代領取後的業務核權、版本、終態及唯一效果檢查。cancel 更新 job 不保證中止 active handler；unschedule 也不撤回已產生的工作。singleton 不等於永久或外部 exactly-once。先定義穩定業務識別與可查核的結果，再處理重領／回應丟失。短 SQL 效果可評估 work transactional 原生選項；已有權威交易／冪等台帳時不另包互不協調的交易。
- 自行接 SIGTERM／SIGINT 並 await stop，然後關自訂 pool；停止可能標記活躍工作失敗並 abort，handler 應有界且能重領。job data／錯誤／output 都可能持久保存；僅放必要參照，進入 SDK 前清理任意錯誤文字，log 使用 allowlist。
- 完整備份包含 framework schema／version／active job，restore 不是排空或自動重新入列。還原目標先保持停止，阻擋舊工作自動執行；核對業務台帳、執行者世代及唯一有效來源後，才啟用重排。官方沒有專門 restore 保證，這是從持久 schema／過期 SQL 得出的操作約束，必須實測。
- 必要驗證：交易回滾、雙程序、hard-kill 真時間恢復、終態／撤權、有限重試、成功後確認丟失及空庫還原。fake DB／mock success 不能當作真 PostgreSQL 證據；執行成本及批准仍按 AGENTS。
