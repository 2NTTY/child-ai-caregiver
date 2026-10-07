# STATUS

只作根 PLAN 的短現況投影；工作包狀態、下一步及未驗項在 [PLAN 當前入口](PLAN.md#active)，不在本頁累積交付史。

## 目前與接手

- **P2-A01 語義工具循環已實作、完成最低離線驗收及 review，待本包 PR 合併。** 唯一當前入口為 [PLAN#active](PLAN.md#active)，完整目標／九包／前移與延後見 [總計劃](PLAN.md#p2-agent-service)。本包只接語義能力目錄及 ADK 工具循環，其他增補依真實前置推進；舊 P1／P2／INT 完成證據保留，P3 未啟動。
- 新前端已是正式入口，設計與互動保留；後續以單人對話辦事、真正文件修改、跨輪接續及 GCP 真實資料服務補齊能力。PR #118 的舊測試前端歸檔已合併，不能仍當待合併；master 新修正不等於已部署，未部署內容及其他聊天 draft 由 PLAN 記錄。
- 前端工作讀 [frontend/AGENTS](frontend/AGENTS.md) → [frontend/PLAN#active](frontend/PLAN.md#active)；Server／Agent／正式整合讀根 PLAN，再按包讀契約與 [UI 接點](docs/P2_UI_HANDOFF.md#chat-handoff)。既有真流程的失敗／未驗界線保留在原包證據，不由新計劃抹除。
- 本人模型 key／限額已接線；Gemini Developer API 地區限制仍在，見 [S06-W05](PLAN.md#s06-w05)。新服務預設提供平台 AI，不要求家長自備 key。

<a id="deployment"></a>
## 最後部署觀察（非即時狀態）

2026-10-07 07:33:47 UTC 的部署觀察：https://ex-machina.eu.org 的 Web／API 使用 `4a2257a`，worker 保持 `053658b`；本次未執行 migration，DB 卷與既有備份保留。API／worker 共用映像設定已更新，後續整包 Compose 啟動可能改動 worker，必須先核對目標，不能當作 Web-only 操作。啟動／部署及功能清單見 [正式 Web](docs/PRODUCTION_FRONTEND.md)。

已核對使用者先前續期生效，VM 的 STOP 為 **2026-10-10 20:50:44 HKT**；本包未再續期。觀察時 VM running／API healthy；這是有日期的結果，不代替日後操作前核對。

## 按需追溯

[歷史索引](_archive/README.md#recent-history) → 指定階段／工作包 → 該 LOG／EV。完整舊 STATUS 只作歷史快照，不再是接續入口。

用量：最近使用者於 2026-09-30 表示「有额度了，继续开始任务」，未提供百分比；餘額未知，不推算重置。

