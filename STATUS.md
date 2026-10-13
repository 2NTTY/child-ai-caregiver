# STATUS

只作根 PLAN 的短現況投影；工作包、前置、未驗與完成門檻見 [PLAN 當前入口](PLAN.md#active)。

## 目前與接手

- **Firestore／正式零 SQL 里程碑已交付；P2 review 修正進行中。** 已批准按 [P2-R01→R04](PLAN.md#p2-review-repair) 修正刪除披露、清理恢復、Agent 正式組裝及成果狀態。R01／R02 已於 #203／#204 合併；當前 P2-R03，基線 `4851ffa`；舊有效證據保留，不再概括為所有 P2 功能已完整接通。手機實作等 R04 合併；完整家庭多人功能移至 P4。
- **原前後端已共同使用 Firestore。** 原網站保留新前端設計，真 Agent 的官方引用、同一準備單修改／確認／保存及刷新讀回已通過。摘要 Firestore 接線缺口已補回並部署；容量操作及保存讀回已補必要證據，回覆替身與真 Agent 結果分開記錄。正式 API／worker 已退出 SQL，PostgreSQL 停止；不是分開的預覽站。排程、queue 及既有通知入口已恢復，本包未追加外發訊息。
- **使用者明確延後：原生每日備份首份核對及一次隔離還原。** 每日 14 天排程、還原入口及測試保留，尚無真原生還原證據；不阻塞本次合併與功能使用。後續只見 [PLAN 待驗入口](PLAN.md#p2-backup-followup)，不持續輪詢或重跑既有驗收。配對備份與 F02～F07 證據保持分開；結果、失敗與限制見 [F08 EV](artifacts/verification/F08_ORIGINAL_SITE_20261013.json)。
- **操作範圍：**本輪由 Astra 主模型獨立實作、review 及最低必要定向驗證，不派子代理、不做全量或 Computer Use。保留新前端設計；三個新增 Agent 角色仍在 P3。
- 前端依 [frontend/AGENTS](frontend/AGENTS.md) → [frontend/PLAN#active](frontend/PLAN.md#active)；本人模型 key／限額仍為可選，平台基本 AI 不要求家長提供 key。未改 UI 設計。

<a id="deployment"></a>
## 最後部署觀察（非即時狀態）

**2026-10-13 09:06 UTC 核對範圍：**正式網址 https://ex-machina.eu.org 沿原 VM `yuban-p1`／ID `2846984358678394356`；Web／API／worker 內容 `566dd2c`，映像標籤 `f08-566dd2c`。API 回報 `storage: firestore`；Scheduler 啟用且最近自然執行成功，Tasks queue 運行，既有 Telegram webhook 指向原站。原 SQL container 停止，舊 volume／備份及回退映像保留。額外 Hosting 檢查站及 Cloud Run API／worker 已清理，Auth 函式與有效資料保留。

來源庫位於香港 `asia-east2`，PITR 關閉；原生每日備份 retention 為 14 天，截至 08:54 UTC 尚無首份備份。已完成的 1,428 筆配對備份保留至 `2026-10-27T07:53:29.841Z`；hold 到期不是自動清理。附件 bucket 的 soft-delete 實際為 14 天，獨立刪除日誌保留。詳細版本／收據及限制見 F08 EV 與[部署方法](docs/PRODUCTION_FRONTEND.md#firestore-deployment)。

VM 最後核對仍為 e2-small，既有停止期限 **2026-10-17 20:50:44 香港時間**，本次沒有續期。保留 VM 固定費與雲端保存費；未取得新的實際帳單，不宣稱免費或已降低固定費。

<a id="preview-history"></a>
## 按需追溯

[歷史索引](_archive/README.md#recent-history) → 指定 LOG／EV；前端預覽見 [frontend/STATUS](frontend/STATUS.md)，不代替正式站版本。舊 A09、F02 及 F08 失敗保留在固定證據／WORKLOG，不把舊部署或舊批准當成今日現況與剩餘用量。

Codex 額度：未有最新百分比，餘額未知；不推算重置。
