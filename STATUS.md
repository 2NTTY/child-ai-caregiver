# STATUS

只作根 PLAN 的短現況投影；工作包、前置、未驗與完成門檻見 [PLAN 當前入口](PLAN.md#active)。

## 目前與接手

- **完整 P2 尚未完成；當前為 [P2-F08 原站交付收尾](PLAN.md#p2-f08)。** F01～F07 已合併，最新核對 master 為 `353cf70`（#200）；F08 分支 `codex/p2-f08-original-site`／draft PR #201 尚未合併。原 P2／INT／A01～A08 成果保留，A09 剩餘成果由本包承接。
- **原前後端已共同使用 Firestore。** 原網站保留新前端設計，真 Agent 的官方引用、同一準備單修改／確認／保存及刷新讀回已通過。摘要 Firestore 接線缺口已補回並部署；容量操作及保存讀回已補必要證據，回覆替身與真 Agent 結果分開記錄。正式 API／worker 已退出 SQL，PostgreSQL 停止；不是分開的預覽站。排程、queue 及既有通知入口已恢復，本包未追加外發訊息。
- **主要未完成：原生每日備份首份產生及一次隔離還原。** 每日 14 天排程已建立，還原接點已實作及作必要本機檢查，尚無真原生還原證據。配對備份及 F02～F07 還原證據保持分開，不能把排程存在當作恢復完成。剩餘 gate 及下一步只見 PLAN；結果、失敗與限制見 [F08 EV](artifacts/verification/F08_ORIGINAL_SITE_20261013.json)。
- **操作範圍：**本輪只用主模型、最低必要驗收，不派子代理、不用 Computer Use 或全量測試。原用量不清零、不加額；本次原生備份／必要還原增量上限 US$1，實際帳單未知。P2 只啟用聊天及現有工具，其他三角色留 [P3](PLAN.md#p3-agent-roles)。
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
