# STATUS

只作根 PLAN 的短現況投影；工作包狀態、下一步及未驗項在 [PLAN 當前入口](PLAN.md#active)，不在本頁累積交付史。

## 目前與接手

- **P1／P2 原定工作包已結案，P3 未啟動。** INT 新前端已接線並切換至公開入口，最後 INT-W07 隨本包 PR 合併結案；[當前包及未驗项](PLAN.md#active)／[階段及證據](PLAN.md#phases)。
- 新前端設計保持；最後一則真 Agent 對話的收據／記錄／聊天核對一致，合成孩子已清理。完整瀏覽器序列在 HTTP 上限停批，未重跑；以既有各包證據及同一 fixture 的 API 補核作必要交付依據，不冒稱本輪全部 UI 斷言通過。[唯一當前入口](PLAN.md#active)。
- **前端工作**：直接讀 [frontend/AGENTS](frontend/AGENTS.md) → [frontend/PLAN 當前包](frontend/PLAN.md#active)，該處區分已合併成果與活動前端 PR；不用先讀整份根計劃或歷史 HANDOFF。
- **Server／Agent／正式整合、文件維護**：讀 [根 PLAN 當前包](PLAN.md#active)，再按範圍讀契約或 [正式 UI 接點](docs/P2_UI_HANDOFF.md#chat-handoff)。
- 本人模型 key／限額設定已隨 INT 部署；個人 Gemini 真生成／embedding 的服務地區限制仍保留，見 [所屬包](PLAN.md#s06-w05)／[正式入口及限制](docs/PRODUCTION_FRONTEND.md)。

<a id="deployment"></a>
## 最後部署觀察（非即時狀態）

2026-10-07 的部署觀察：https://ex-machina.eu.org 已使用 `053658b` 的新前端、API／worker；遷移至 028、原 68 張資料表既有欄位數量／hash 相同，升級前配對加密備份保留。啟動／部署及功能清單見 [正式 Web](docs/PRODUCTION_FRONTEND.md)。

已核對使用者先前續期生效，VM 的 STOP 為 **2026-10-10 20:50:44 HKT**；本包未再續期。觀察時 VM running／API healthy；這是有日期的結果，不代替日後操作前核對。

## 按需追溯

[歷史索引](_archive/README.md#recent-history) → 指定階段／工作包 → 該 LOG／EV。完整舊 STATUS 只作歷史快照，不再是接續入口。

用量：最近使用者於 2026-09-30 表示「有额度了，继续开始任务」，未提供百分比；餘額未知，不推算重置。
