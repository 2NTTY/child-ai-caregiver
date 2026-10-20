# STATUS

只作根 PLAN 的短現況投影；工作包、前置、未驗與完成門檻見 [PLAN 當前入口](PLAN.md#active)。

## 目前與接手

- **本分支處理 PR #229 的 master 衝突。** 已接回 `3795858` 的三個角色及後續確認修正；Android 停止原因與審核未完成提示共用同一文案入口。只補合併接點，首條真機聊天／重開讀回仍待驗，沒有追加部署；當前範圍見 [PLAN](PLAN.md#active)。

- **Firestore／正式零 SQL 及本輪 P2 review 修正已交付。** [R01～R04](PLAN.md#p2-review-repair) 分別於 #203～#206 合併，並已部署 `2c17aa7`。修正刪除披露、清理恢復、Agent 正式組裝、成果狀態及通知歷史；不把有限檢查當全面驗收。[P2-ADM01 Web 管理後台](PLAN.md#p2-adm01) 已於 #208／#209 合併並部署，指定的已驗證 UID 已綁定；正式瀏覽器管理身份讀取的 fetch 接收者缺陷已於 #211 修正及部署；上述是既有交付；本輪新增 OPT／LAY／STR 目標尚未完成，家庭多人仍在 P4。
- **原前後端已共同使用 Firestore。** 原網站保留新前端設計，真 Agent 的官方引用、同一準備單修改／確認／保存及刷新讀回已通過。摘要 Firestore 接線缺口已補回並部署；容量操作及保存讀回已補必要證據，回覆替身與真 Agent 結果分開記錄。正式 API／worker 已退出 SQL，PostgreSQL 停止；不是分開的預覽站。排程、queue 及既有通知入口已恢復，本包未追加外發訊息。
- **使用者明確延後：原生每日備份首份核對及一次隔離還原。** 每日 14 天排程、還原入口及測試保留，尚無真原生還原證據；不阻塞本次合併與功能使用。後續只見 [PLAN 待驗入口](PLAN.md#p2-backup-followup)，不持續輪詢或重跑既有驗收。配對備份與 F02～F07 證據保持分開；結果、失敗與限制見 [F08 EV](artifacts/verification/F08_ORIGINAL_SITE_20261013.json)。
- **後續成果分開保留：**語音、附件、通知、裝置接續及更新入口在 Android draft #234～#239；本地開發／個人模型接線在 #241／#242／#244。它們不是本 PR 已合併成果，原真機及模型 gate 不因同步 master 消失。#214～#216／#243 已合併，角色真實能力仍按各包證據區分。

- **操作範圍：**主模型處理必要衝突與 review；按包交付身份、單作者提交。只做最低必要檢查，不全量、Computer Use 或重做前端設計；此次不重跑已合併角色的驗收。
- 前端依 [frontend/AGENTS](frontend/AGENTS.md) → [frontend/PLAN#active](frontend/PLAN.md#active)；本人模型 key／限額仍為可選，平台基本 AI 不要求家長提供 key。未改 UI 設計。

<a id="deployment"></a>
## 本分支保留的部署觀察（歷史，非現網最新狀態）

**2026-10-15 17:32～17:33 UTC 核對：**原 VM `yuban-p1`／ID `2846984358678394356` 的 API／worker／Web 均為 `admin-8ba66e7`；三服務及公開健康入口正常，管理頁與 JS hash 相符，同一已保存 policy v2 的實際限額不變。Android OTA 仍為 `b44fb753`，毋須為後台改動更新 App。沒有遷移、真模型、通知或重發聊天；[部署證據](artifacts/verification/ADMIN_AGENT_RUN_LIMITS_20261016.json)。首條真人聊天及原生備份真還原仍待驗。

保留舊映像、受保護配置及資料；新摘要／卡片寫入後須維持相容 API reader，不能盲退舊 API，詳見[部署方法](docs/PRODUCTION_FRONTEND.md#firestore-deployment)。主機只剩約 1.2 GB 時採小型更新層；未刪除舊上載壓縮包。備份部署前唯讀 metadata 顯示 10 月 13／14 日兩份原生備份 READY、各保留 14 天；未檢查還原內容、未執行真還原，原延期仍有效。既有配對備份與獨立刪除日誌保留，不回寫舊證據。

VM 最後核對仍為 e2-small，既有停止期限 **2026-10-17 20:50:44 香港時間**，本次沒有續期。保留 VM 固定費與雲端保存費；未取得新的實際帳單，不宣稱免費或已降低固定費。

<a id="preview-history"></a>
## 按需追溯

[歷史索引](_archive/README.md#recent-history) → 指定 LOG／EV；前端預覽見 [frontend/STATUS](frontend/STATUS.md)，不代替正式站版本。舊 A09、F02 及 F08 失敗保留在固定證據／WORKLOG，不把舊部署或舊批准當成今日現況與剩餘用量。

Codex 額度：未有最新百分比，餘額未知；不推算重置。
