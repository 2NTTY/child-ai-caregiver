# STATUS

只作根 PLAN 的短現況投影；工作包、前置、未驗與完成門檻見 [PLAN 當前入口](PLAN.md#active)。

## 目前與接手

- **S04 聊天阻塞修正：**[單次預算可見與收尾](PLAN.md#agent-budget-followup) 已於 #230 合併並部署 `1150193`，必要 scripted／管理接線及型別核對通過。模型每輪知道剩餘次數，普通招呼直接短答；平台新上限 8 次生成／16 工具／4 查詢向量，正式政策 v2 已保存，前後使用量不變。每日 200／400 不變。Android #229 仍未合併，不因此宣稱真聊天已通過。

- **Firestore／正式零 SQL 及本輪 P2 review 修正已交付。** [R01～R04](PLAN.md#p2-review-repair) 分別於 #203～#206 合併，並已部署 `2c17aa7`。修正刪除披露、清理恢復、Agent 正式組裝、成果狀態及通知歷史；不把有限檢查當全面驗收。[P2-ADM01 Web 管理後台](PLAN.md#p2-adm01) 已於 #208／#209 合併並部署，指定的已驗證 UID 已綁定；正式瀏覽器管理身份讀取的 fetch 接收者缺陷已於 #211 修正及部署；上述是既有交付；本輪新增 OPT／LAY／STR 目標尚未完成，家庭多人仍在 P4。
- **原前後端已共同使用 Firestore。** 原網站保留新前端設計，真 Agent 的官方引用、同一準備單修改／確認／保存及刷新讀回已通過。摘要 Firestore 接線缺口已補回並部署；容量操作及保存讀回已補必要證據，回覆替身與真 Agent 結果分開記錄。正式 API／worker 已退出 SQL，PostgreSQL 停止；不是分開的預覽站。排程、queue 及既有通知入口已恢復，本包未追加外發訊息。
- **使用者明確延後：原生每日備份首份核對及一次隔離還原。** 每日 14 天排程、還原入口及測試保留，尚無真原生還原證據；不阻塞本次合併與功能使用。後續只見 [PLAN 待驗入口](PLAN.md#p2-backup-followup)，不持續輪詢或重跑既有驗收。配對備份與 F02～F07 證據保持分開；結果、失敗與限制見 [F08 EV](artifacts/verification/F08_ORIGINAL_SITE_20261013.json)。
- **當前工作：**[S04-W01](PLAN.md#s04-w01)，draft PR #229。Android preview 已安裝登入；原生事件／輸入框／折疊量度修正後，主頁、助手重開及孩子表單已有真機證據。最新 `8992ce9` 的鍵盤避讓和清空後縮回亦已實機核對，Web／Android 共用換行清理與停止原因顯示已發布。首條有來源聊天／讀回仍待驗，不能以額度停止訊息當通過；不自動重發。搜尋標籤延遲／切頁不順尚無可靠根因。語音、拍照／相簿及 FCM 仍在本輪 Android 後續包，iOS 未開始。OPT／LAY 已交付，灰色正文依 [STR01 備忘](PLAN.md#p2-str01-handoff) 等協作者 #214；#214～#216 不接管。

- **操作範圍：**最新指示為後續只用主模型、不開子代理；此前有效成果保留。只做最低必要檢查，不全量、Computer Use 或重做前端設計；協作者角色實作不納入本聊天。
- 前端依 [frontend/AGENTS](frontend/AGENTS.md) → [frontend/PLAN#active](frontend/PLAN.md#active)；本人模型 key／限額仍為可選，平台基本 AI 不要求家長提供 key。未改 UI 設計。

<a id="deployment"></a>
## 最後部署觀察（非即時狀態）

**2026-10-15 16:26 UTC 核對：**正式網址 https://ex-machina.eu.org 的原 VM API／worker 為 `budget-1150193`，Web 沿 `s04-8992ce9`；新服務及公開 API 健康，Web `/chat` 靜態 hash 沿 15:49 有效證據；零資料遷移、模型及通知。Android 相容 preview group `b44fb753` 已發布，真機鍵盤與輸入框核對通過；首條有來源聊天仍未驗。使用者指定每日每人 200／全站 400 已於 15:37 UTC 保存政策 v1；16:26 UTC 的 v2 只調單次生成 8／查詢向量 4，工具 16，使用量保留。[本包證據](artifacts/verification/S04_W01_ANDROID_FOUNDATION_20261015.json)。先前公開 SSE 證據沿[原記錄](artifacts/verification/P2_OPT_DELIVERY_20261015.json)，本次不重跑。

保留舊映像、受保護配置及資料；新摘要／卡片寫入後須維持相容 API reader，不能盲退舊 API，詳見[部署方法](docs/PRODUCTION_FRONTEND.md#firestore-deployment)。主機只剩約 1.2 GB 時採小型更新層；未刪除舊上載壓縮包。備份部署前唯讀 metadata 顯示 10 月 13／14 日兩份原生備份 READY、各保留 14 天；未檢查還原內容、未執行真還原，原延期仍有效。既有配對備份與獨立刪除日誌保留，不回寫舊證據。

VM 最後核對仍為 e2-small，既有停止期限 **2026-10-17 20:50:44 香港時間**，本次沒有續期。保留 VM 固定費與雲端保存費；未取得新的實際帳單，不宣稱免費或已降低固定費。

<a id="preview-history"></a>
## 按需追溯

[歷史索引](_archive/README.md#recent-history) → 指定 LOG／EV；前端預覽見 [frontend/STATUS](frontend/STATUS.md)，不代替正式站版本。舊 A09、F02 及 F08 失敗保留在固定證據／WORKLOG，不把舊部署或舊批准當成今日現況與剩餘用量。

Codex 額度：未有最新百分比，餘額未知；不推算重置。
