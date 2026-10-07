# STATUS

只作根 PLAN 的短現況投影；工作包狀態、下一步及未驗項在 [PLAN 當前入口](PLAN.md#active)，不在本頁累積交付史。

## 目前與接手

- 新前端能力正在逐項核對後端與Agent覆蓋：準備單現為確定性資料組裝，未支援Agent自訂正文；固定期間報告的關注觀察日期篩選缺陷正作有界修復。舊功能歸檔須保留共用controllers、資料與原操作恢復，詳見PLAN；不把頁面或API存在當成功能完整。

- **目前仍在正式使用驗收與修復**：PR #105–#108 已部署，普通 Agent 記錄未知數量已真 UI 讀回；PR #109 記憶讀取及 #110 收據解析已合併未部署。PR #112 待辦意圖／互動輸入上限及設定頁真值已合併未部署，最終文字與完整 Agent 待辦流程仍未全部通過。PR #111 保持 draft，未通過真 PostgreSQL 遷移驗證；ADK 指令資料分層與安全終結已獲批准，已通過最終組合定向及獨立覆核，Prompt Pack 0.1.25尚未部署。詳見根 PLAN 當前入口。

- **P1／P2 原定工作包已結案，P3 未啟動。** INT 新前端已接線並切換至公開入口，最後 INT-W07 隨本包 PR 合併結案；[當前包及未驗项](PLAN.md#active)／[階段及證據](PLAN.md#phases)。
- 新前端設計保持；最後一則真 Agent 對話的收據／記錄／聊天核對一致，合成孩子已清理。完整瀏覽器序列在 HTTP 上限停批，未重跑；以既有各包證據及同一 fixture 的 API 補核作必要交付依據，不冒稱本輪全部 UI 斷言通過。[唯一當前入口](PLAN.md#active)。
- **前端工作**：直接讀 [frontend/AGENTS](frontend/AGENTS.md) → [frontend/PLAN 當前包](frontend/PLAN.md#active)，該處區分已合併成果與活動前端 PR；不用先讀整份根計劃或歷史 HANDOFF。
- **Server／Agent／正式整合、文件維護**：讀 [根 PLAN 當前包](PLAN.md#active)，再按範圍讀契約或 [正式 UI 接點](docs/P2_UI_HANDOFF.md#chat-handoff)。
- 本人模型 key／限額設定已隨 INT 部署；個人 Gemini 真生成／embedding 的服務地區限制仍保留，見 [所屬包](PLAN.md#s06-w05)／[正式入口及限制](docs/PRODUCTION_FRONTEND.md)。

<a id="deployment"></a>
## 最後部署觀察（非即時狀態）

2026-10-07 07:33:47 UTC 的部署觀察：https://ex-machina.eu.org 的 Web／API 使用 `4a2257a`，worker 保持 `053658b`；本次未執行 migration，DB 卷與既有備份保留。API／worker 共用映像設定已更新，後續整包 Compose 啟動可能改動 worker，必須先核對目標，不能當作 Web-only 操作。啟動／部署及功能清單見 [正式 Web](docs/PRODUCTION_FRONTEND.md)。

已核對使用者先前續期生效，VM 的 STOP 為 **2026-10-10 20:50:44 HKT**；本包未再續期。觀察時 VM running／API healthy；這是有日期的結果，不代替日後操作前核對。

## 按需追溯

[歷史索引](_archive/README.md#recent-history) → 指定階段／工作包 → 該 LOG／EV。完整舊 STATUS 只作歷史快照，不再是接續入口。

用量：最近使用者於 2026-09-30 表示「有额度了，继续开始任务」，未提供百分比；餘額未知，不推算重置。

