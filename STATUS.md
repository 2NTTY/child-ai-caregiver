# STATUS

只作根 PLAN 的短現況投影；工作包、前置、未驗與完成門檻見 [PLAN 當前入口](PLAN.md#active)。

## 目前與接手

- **Firestore／正式零 SQL 及本輪 P2 review 修正已交付。** [R01～R04](PLAN.md#p2-review-repair) 分別於 #203～#206 合併，並已部署 `2c17aa7`。修正刪除披露、清理恢復、Agent 正式組裝、成果狀態及通知歷史；不把有限檢查當全面驗收。[P2-ADM01 Web 管理後台](PLAN.md#p2-adm01) 已於 #208／#209 合併並部署，指定的已驗證 UID 已綁定；正式瀏覽器管理身份讀取的 fetch 接收者缺陷已於 #211 修正及部署；上述是既有交付；本輪新增 OPT／LAY／STR 目標尚未完成，家庭多人仍在 P4。
- **原前後端已共同使用 Firestore。** 原網站保留新前端設計，真 Agent 的官方引用、同一準備單修改／確認／保存及刷新讀回已通過。摘要 Firestore 接線缺口已補回並部署；容量操作及保存讀回已補必要證據，回覆替身與真 Agent 結果分開記錄。正式 API／worker 已退出 SQL，PostgreSQL 停止；不是分開的預覽站。排程、queue 及既有通知入口已恢復，本包未追加外發訊息。
- **使用者明確延後：原生每日備份首份核對及一次隔離還原。** 每日 14 天排程、還原入口及測試保留，尚無真原生還原證據；不阻塞本次合併與功能使用。後續只見 [PLAN 待驗入口](PLAN.md#p2-backup-followup)，不持續輪詢或重跑既有驗收。配對備份與 F02～F07 證據保持分開；結果、失敗與限制見 [F08 EV](artifacts/verification/F08_ORIGINAL_SITE_20261013.json)。
- **當前工作：**已批准 [Web／Android 共用產品與 Android 成品計劃](PLAN.md#p3-mobile)，從 [S04-W01](PLAN.md#s04-w01) 正式配置、共用 transport／原生登入及首條聊天開始；文件 #228 已合併；S04-W01 本機原生會話／共用 transport、必要合成檢查及 Android bundle 已完成，尚無 APK／真機證據。Expo 帳號已準備，本機 CLI 登入待本人完成；雲端上載／建置與正式接線未驗。兩端新增完整語音與已提交工作接續；未發送草稿留原設備，iOS 排在 Android 成品之後。OPT01～05、LAY01～05 已合併及部署，灰色正文仍依 [STR01 接續備忘](PLAN.md#p2-str01-handoff) 等協作者 #214，#214～#216 不接管；兩份原計劃不標整體完成。

- **操作範圍：**最新指示為後續只用主模型、不開子代理；此前有效成果保留。只做最低必要檢查，不全量、Computer Use 或重做前端設計；協作者角色實作不納入本聊天。
- 前端依 [frontend/AGENTS](frontend/AGENTS.md) → [frontend/PLAN#active](frontend/PLAN.md#active)；本人模型 key／限額仍為可選，平台基本 AI 不要求家長提供 key。未改 UI 設計。

<a id="deployment"></a>
## 最後部署觀察（非即時狀態）

**2026-10-15 09:04～09:15 UTC 核對：**正式網址 https://ex-machina.eu.org 沿原 VM `yuban-p1`／ID `2846984358678394356`；API／worker／Web 均為 `opt-b1d1565`，包含 #213 及 OPT／LAY 成果。三服務健康、PostgreSQL 保持停止；兩項新增索引查詢及公開 HTML／JS hash 相符。實際公開 SSE 約 4.1 秒先送開始進度，42.6 秒保存完整回覆；不是逐字正文串流或固定加速保證。合成孩子已提交持久刪除／後續清理，驗收帳號已停用並撤銷 token，沒有發通知或調整限額。[交付證據](artifacts/verification/P2_OPT_DELIVERY_20261015.json)。

保留舊映像、受保護配置及資料；新摘要／卡片寫入後須維持相容 API reader，不能盲退舊 API，詳見[部署方法](docs/PRODUCTION_FRONTEND.md#firestore-deployment)。主機只剩約 1.2 GB 時採小型更新層；未刪除舊上載壓縮包。備份部署前唯讀 metadata 顯示 10 月 13／14 日兩份原生備份 READY、各保留 14 天；未檢查還原內容、未執行真還原，原延期仍有效。既有配對備份與獨立刪除日誌保留，不回寫舊證據。

VM 最後核對仍為 e2-small，既有停止期限 **2026-10-17 20:50:44 香港時間**，本次沒有續期。保留 VM 固定費與雲端保存費；未取得新的實際帳單，不宣稱免費或已降低固定費。

<a id="preview-history"></a>
## 按需追溯

[歷史索引](_archive/README.md#recent-history) → 指定 LOG／EV；前端預覽見 [frontend/STATUS](frontend/STATUS.md)，不代替正式站版本。舊 A09、F02 及 F08 失敗保留在固定證據／WORKLOG，不把舊部署或舊批准當成今日現況與剩餘用量。

Codex 額度：未有最新百分比，餘額未知；不推算重置。
