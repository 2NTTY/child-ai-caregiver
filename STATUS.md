# STATUS

只作根 PLAN 的短現況投影；工作包、前置、未驗與完成門檻見 [PLAN 當前入口](PLAN.md#active)。

## 目前與接手

- **Firestore／正式零 SQL 及本輪 P2 review 修正已交付。** [R01～R04](PLAN.md#p2-review-repair) 分別於 #203～#206 合併，並已部署 `2c17aa7`。修正刪除披露、清理恢復、Agent 正式組裝、成果狀態及通知歷史；不把有限檢查當全面驗收。[P2-ADM01 Web 管理後台](PLAN.md#p2-adm01) 已於 #208／#209 合併並部署，指定的已驗證 UID 已綁定；正式瀏覽器管理身份讀取的 fetch 接收者缺陷已於 #211 修正及部署；上述是既有交付；本輪新增 OPT／LAY／STR 目標尚未完成，家庭多人仍在 P4。
- **原前後端已共同使用 Firestore。** 原網站保留新前端設計，真 Agent 的官方引用、同一準備單修改／確認／保存及刷新讀回已通過。摘要 Firestore 接線缺口已補回並部署；容量操作及保存讀回已補必要證據，回覆替身與真 Agent 結果分開記錄。正式 API／worker 已退出 SQL，PostgreSQL 停止；不是分開的預覽站。排程、queue 及既有通知入口已恢復，本包未追加外發訊息。
- **使用者明確延後：原生每日備份首份核對及一次隔離還原。** 每日 14 天排程、還原入口及測試保留，尚無真原生還原證據；不阻塞本次合併與功能使用。後續只見 [PLAN 待驗入口](PLAN.md#p2-backup-followup)，不持續輪詢或重跑既有驗收。配對備份與 F02～F07 證據保持分開；結果、失敗與限制見 [F08 EV](artifacts/verification/F08_ORIGINAL_SITE_20261013.json)。
- **當前工作：**LAY01／LAY02 已由 #217／#218 合併；[LAY03](PLAN.md#p2-lay03) 完成待辦中立接口及三個必要檢查，待交付。2026-10-15 遠端 master 4fe5d3f；#213 登入修正及 LAY02 尚未部署。#214～#216 仍未合併，OPT01 及其後重疊工作等待協作者；本聊天不修改或合併三角色成果。詳細依賴只見 [PLAN](PLAN.md#active)。
- **操作範圍：**主模型親寫規格、計劃、提示詞及 review，使用者本輪另准有收益時用 Astra xhigh 子代理；僅獨立範圍並行。保留新前端設計，只做最低必要定向檢查，不全量或 Computer Use。協作者三角色不在本聊天實作範圍。
- 前端依 [frontend/AGENTS](frontend/AGENTS.md) → [frontend/PLAN#active](frontend/PLAN.md#active)；本人模型 key／限額仍為可選，平台基本 AI 不要求家長提供 key。未改 UI 設計。

<a id="deployment"></a>
## 最後部署觀察（非即時狀態）

**2026-10-13 13:54 UTC 核對範圍：**正式網址 https://ex-machina.eu.org 沿原 VM `yuban-p1`／ID `2846984358678394356`；Web `8f916d0`（#211／master `323e4a7`）、映像 `admin-8f916d0`，API／worker 保持 `334fb4e` 且未重啟。修正管理身份請求在原生瀏覽器送出前失敗；已建置 Web／原生 Edge 配合合成 API 正常載入，正式 HTML 與 JS hash 相符。健康通過，未改帳戶、管理 UID、資料或限額，零模型／通知，未代填本人登入結果。回退映像及受保護配置保留；詳細見 [瀏覽器修正 EV](artifacts/verification/P2_ADM01_BROWSER_FIX_20261013.json)。初始政策及先前管理查詢／索引證據仍見 [ADM01 EV](artifacts/verification/P2_ADM01_WEB_20261013.json)。

來源庫位於香港 `asia-east2`，PITR 關閉；原生每日備份 retention 為 14 天，截至 08:54 UTC 尚無首份備份。已完成的 1,428 筆配對備份保留至 `2026-10-27T07:53:29.841Z`；hold 到期不是自動清理。附件 bucket 的 soft-delete 實際為 14 天，獨立刪除日誌保留。配對 manifest 的 generation、大小及 hold 已於 13:02 UTC 再核；沒有新建備份或執行還原。詳細版本／收據及限制見 [review 交付 EV](artifacts/verification/P2_REVIEW_DELIVERY_20261013.json)、F08 EV 與[部署方法](docs/PRODUCTION_FRONTEND.md#firestore-deployment)。

VM 最後核對仍為 e2-small，既有停止期限 **2026-10-17 20:50:44 香港時間**，本次沒有續期。保留 VM 固定費與雲端保存費；未取得新的實際帳單，不宣稱免費或已降低固定費。

<a id="preview-history"></a>
## 按需追溯

[歷史索引](_archive/README.md#recent-history) → 指定 LOG／EV；前端預覽見 [frontend/STATUS](frontend/STATUS.md)，不代替正式站版本。舊 A09、F02 及 F08 失敗保留在固定證據／WORKLOG，不把舊部署或舊批准當成今日現況與剩餘用量。

Codex 額度：未有最新百分比，餘額未知；不推算重置。
