# STATUS

只作根 PLAN 的短現況投影；工作包、前置、未驗與完成門檻見 [PLAN 當前入口](PLAN.md#active)。

## 目前與接手

- **S04 回覆收尾修正：**#231 預算接點已合併並部署。新回報關閉 App 後顯示中斷；已修期限後拒存結果及 JSON 斷線取消兩處，兩項定向檢查與受影響型別通過，已於 #232 合併並部署 `reply-8d3fc29`。沒有重發使用者聊天；真機首條聊天仍由使用者驗收。管理員總控增補其後接續，#229 不提前標完成。

- **Firestore／正式零 SQL 及本輪 P2 review 修正已交付。** [R01～R04](PLAN.md#p2-review-repair) 分別於 #203～#206 合併，並已部署 `2c17aa7`。修正刪除披露、清理恢復、Agent 正式組裝、成果狀態及通知歷史；不把有限檢查當全面驗收。[P2-ADM01 Web 管理後台](PLAN.md#p2-adm01) 已於 #208／#209 合併並部署，指定的已驗證 UID 已綁定；正式瀏覽器管理身份讀取的 fetch 接收者缺陷已於 #211 修正及部署；上述是既有交付；本輪新增 OPT／LAY／STR 目標尚未完成，家庭多人仍在 P4。
- **原前後端已共同使用 Firestore。** 原網站保留新前端設計，真 Agent 的官方引用、同一準備單修改／確認／保存及刷新讀回已通過。摘要 Firestore 接線缺口已補回並部署；容量操作及保存讀回已補必要證據，回覆替身與真 Agent 結果分開記錄。正式 API／worker 已退出 SQL，PostgreSQL 停止；不是分開的預覽站。排程、queue 及既有通知入口已恢復，本包未追加外發訊息。
- **使用者明確延後：原生每日備份首份核對及一次隔離還原。** 每日 14 天排程、還原入口及測試保留，尚無真原生還原證據；不阻塞本次合併與功能使用。後續只見 [PLAN 待驗入口](PLAN.md#p2-backup-followup)，不持續輪詢或重跑既有驗收。配對備份與 F02～F07 證據保持分開；結果、失敗與限制見 [F08 EV](artifacts/verification/F08_ORIGINAL_SITE_20261013.json)。
- **當前工作：**Android preview 已安裝登入，S04 的原生畫面接線在 draft #229；首條聊天由使用者驗收，舊「服務未能使用」的預算接點已部署修正；目前處理回覆斷線／期限收尾問題。已獲准先準備 S05 裝置會話與後續獨立部分，保留依賴合併次序。鍵盤切換位移仍待修；語音、拍照／相簿及 FCM 未交付，iOS 未開始。OPT／LAY 已交付，STR01 依原備忘等協作者，#214～#216 不接管。

- **操作範圍：**最新指示為後續只用主模型、不開子代理；此前有效成果保留。只做最低必要檢查，不全量、Computer Use 或重做前端設計；協作者角色實作不納入本聊天。
- 前端依 [frontend/AGENTS](frontend/AGENTS.md) → [frontend/PLAN#active](frontend/PLAN.md#active)；本人模型 key／限額仍為可選，平台基本 AI 不要求家長提供 key。未改 UI 設計。

<a id="deployment"></a>
## 最後部署觀察（非即時狀態）

**2026-10-15 17:13 UTC 核對：**API／worker 已部署 `reply-8d3fc29`（#232 及 S04 原生接點），兩服務及公開 health 通過；Web 仍 `s04-8992ce9`、Android OTA 仍 `b44fb753`。只更新兩個 Server 檔案，沒有模型、通知、資料遷移或用量調整。首條聊天仍由使用者驗收；[收尾證據](artifacts/verification/AGENT_DISCONNECTED_RESULT_20261016.json)。

保留舊映像、受保護配置及資料；新摘要／卡片寫入後須維持相容 API reader，不能盲退舊 API，詳見[部署方法](docs/PRODUCTION_FRONTEND.md#firestore-deployment)。主機只剩約 1.2 GB 時採小型更新層；未刪除舊上載壓縮包。備份部署前唯讀 metadata 顯示 10 月 13／14 日兩份原生備份 READY、各保留 14 天；未檢查還原內容、未執行真還原，原延期仍有效。既有配對備份與獨立刪除日誌保留，不回寫舊證據。

VM 最後核對仍為 e2-small，既有停止期限 **2026-10-17 20:50:44 香港時間**，本次沒有續期。保留 VM 固定費與雲端保存費；未取得新的實際帳單，不宣稱免費或已降低固定費。

<a id="preview-history"></a>
## 按需追溯

[歷史索引](_archive/README.md#recent-history) → 指定 LOG／EV；前端預覽見 [frontend/STATUS](frontend/STATUS.md)，不代替正式站版本。舊 A09、F02 及 F08 失敗保留在固定證據／WORKLOG，不把舊部署或舊批准當成今日現況與剩餘用量。

Codex 額度：未有最新百分比，餘額未知；不推算重置。
