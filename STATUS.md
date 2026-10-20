# STATUS

只作根 PLAN 的短現況投影；工作包、前置、未驗與完成門檻見 [PLAN 當前入口](PLAN.md#active)。

## 目前與接手

- **管理員總控已上線：**#233 已合併，生成／工具／查詢向量／期限來自同一 policy；原站 API／worker／Web 已部署 `admin-8ba66e7`。現場唯讀核對仍為每人 200／全站 400、每輪 8 生成／16 工具／4 查詢／90 秒，沒有清零或新增呼叫。S05 原生會話失效／遲到回應修正及兩項本機檢查已通過，待相容客戶端及真機；首條真人聊天仍待驗，S07 同步及 S09 原運行唯讀查回已通過必要本機情景，待 API／包含網絡套件的新 APK及跨端真機。
- **依賴同步：**已接回 master `3795858` 與 #229 的審核停止原因修正；沒有新增部署或驗收。下方部署數字是本分支歷史觀察，產品當前工作及後續 draft 見 [PLAN](PLAN.md#active)。

- **Firestore／正式零 SQL 及本輪 P2 review 修正已交付。** [R01～R04](PLAN.md#p2-review-repair) 分別於 #203～#206 合併，並已部署 `2c17aa7`。修正刪除披露、清理恢復、Agent 正式組裝、成果狀態及通知歷史；不把有限檢查當全面驗收。[P2-ADM01 Web 管理後台](PLAN.md#p2-adm01) 已於 #208／#209 合併並部署，指定的已驗證 UID 已綁定；正式瀏覽器管理身份讀取的 fetch 接收者缺陷已於 #211 修正及部署；上述是既有交付；本輪新增 OPT／LAY／STR 目標尚未完成，家庭多人仍在 P4。
- **原前後端已共同使用 Firestore。** 原網站保留新前端設計，真 Agent 的官方引用、同一準備單修改／確認／保存及刷新讀回已通過。摘要 Firestore 接線缺口已補回並部署；容量操作及保存讀回已補必要證據，回覆替身與真 Agent 結果分開記錄。正式 API／worker 已退出 SQL，PostgreSQL 停止；不是分開的預覽站。排程、queue 及既有通知入口已恢復，本包未追加外發訊息。
- **使用者明確延後：原生每日備份首份核對及一次隔離還原。** 每日 14 天排程、還原入口及測試保留，尚無真原生還原證據；不阻塞本次合併與功能使用。後續只見 [PLAN 待驗入口](PLAN.md#p2-backup-followup)，不持續輪詢或重跑既有驗收。配對備份與 F02～F07 證據保持分開；結果、失敗與限制見 [F08 EV](artifacts/verification/F08_ORIGINAL_SITE_20261013.json)。
- **後續成果分開保留：**語音、附件、通知、裝置接續及更新入口在 Android draft #234～#239；本地開發／個人模型接線在 #241／#242／#244。它們不是本 PR 已合併成果，原真機及模型 gate 不因同步 master 消失。#214～#216／#243 已合併，角色真實能力仍按各包證據區分。
- **本分支語音接線：**原錄音／轉錄與已合併審核／編製共用 runtime 已整合；Prompt Pack 依賴與受影響型別通過。相機、附件、語音的既有本機證據保留，未因此新增部署、真語音或真機通過結論。

- **操作範圍：**主模型處理必要衝突與 review；按包交付身份、單作者提交。只做最低必要檢查，不全量、Computer Use 或重做前端設計；此次不重跑已合併角色的驗收。
- 前端依 [frontend/AGENTS](frontend/AGENTS.md) → [frontend/PLAN#active](frontend/PLAN.md#active)；本人模型 key／限額仍為可選，平台基本 AI 不要求家長提供 key。未改 UI 設計。

<a id="deployment"></a>
## 本分支保留的部署觀察（歷史，非現網最新狀態）

**2026-10-18 05:37 UTC 核對：**原 VM 因舊期限到達已停止；使用者批准續期 5 天後，原機已啟動，API／worker 健康、公開 `/api/health` 回報 Firestore 正常。API／worker／Web 仍為 `admin-8ba66e7`，PostgreSQL 維持停止；沒有部署開發中的語音、遷移或呼叫模型／通知。見[續期及恢復證據](artifacts/verification/VM_RENEWAL_20261018.json)。先前管理員設定及限額觀察仍見[原部署證據](artifacts/verification/ADMIN_AGENT_RUN_LIMITS_20261016.json)，本次沒有重新讀取或修改用量。Android OTA 仍以已發布版本為準；首條真人聊天及原生備份真還原仍待驗。

保留舊映像、受保護配置及資料；新摘要／卡片寫入後須維持相容 API reader，不能盲退舊 API，詳見[部署方法](docs/PRODUCTION_FRONTEND.md#firestore-deployment)。主機此次剩約 1.0 GiB，後續部署採小型更新層；未刪除舊上載壓縮包。備份部署前唯讀 metadata 顯示 10 月 13／14 日兩份原生備份 READY、各保留 14 天；未檢查還原內容、未執行真還原，原延期仍有效。既有配對備份與獨立刪除日誌保留，不回寫舊證據。

VM 此次核對為 e2-small，已按使用者要求續期 5 天，新的自動停止期限為 **2026-10-23 13:33:50 香港時間**。保留 VM 固定費與雲端保存費；未取得新的實際帳單，不宣稱免費或已降低固定費。

<a id="preview-history"></a>
## 按需追溯

[歷史索引](_archive/README.md#recent-history) → 指定 LOG／EV；前端預覽見 [frontend/STATUS](frontend/STATUS.md)，不代替正式站版本。舊 A09、F02 及 F08 失敗保留在固定證據／WORKLOG，不把舊部署或舊批准當成今日現況與剩餘用量。

Codex 額度：未有最新百分比，餘額未知；不推算重置。
