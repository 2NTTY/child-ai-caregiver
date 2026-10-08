# STATUS

只作根 PLAN 的短現況投影；工作包狀態、下一步及未驗項在 [PLAN 當前入口](PLAN.md#active)，不在本頁累積交付史。

## 目前與接手

- **P2-A01～A08均已合併，A09穩定交付進行中。** 唯一當前入口為 [PLAN#active](PLAN.md#active)。正式帳號、Agent資料／文件與歷史接點已有最低本機證據；代表Agent已補問並保存準備單，但引用／局部修改未完整通過；修正版只完成離線核對及建置。新部署及真SMTP仍未完成。邀請規模／保留與運行設定尚待核定，不能把本機SMTP當公開服務；P3未啟動。
- 新前端已是正式入口，設計與互動保留；後續以單人對話辦事、真正文件修改、跨輪接續及 GCP 真實資料服務補齊能力。PR #118 的舊測試前端歸檔已合併，不能仍當待合併；master 新修正不等於已部署，未部署內容及其他聊天 draft 由 PLAN 記錄。
- 前端工作讀 [frontend/AGENTS](frontend/AGENTS.md) → [frontend/PLAN#active](frontend/PLAN.md#active)；Server／Agent／正式整合讀根 PLAN，再按包讀契約與 [UI 接點](docs/P2_UI_HANDOFF.md#chat-handoff)。既有真流程的失敗／未驗界線保留在原包證據，不由新計劃抹除。
- 本人模型 key／限額已接線；Gemini Developer API 地區限制仍在，見 [S06-W05](PLAN.md#s06-w05)。新服務預設提供平台 AI，不要求家長自備 key。

<a id="deployment"></a>
## 最後部署觀察（非即時狀態）

2026-10-08 約01:41 UTC，經已核實 VM／IAP 唯讀觀察：Web、API、worker 均使用 `85e3a846`；API／PostgreSQL healthy，服務正在運行。本輪 A01～A08 尚未部署，SMTP／帳號服務設定未配置，根磁碟剩約2.2GB（89%已用）。原資料卷／秘密保留；證據見 [A09現場](artifacts/verification/P2_A09_REMOTE_PREFLIGHT.log)，後續部署及容量另須重新核對。啟動／部署方法見 [正式Web](docs/PRODUCTION_FRONTEND.md#p2-a09-deployment)。

Compute API 已重新核對原 VM ID 2846984358678394356，STOP 仍為 **2026-10-10 20:50:44 HKT**；本包沒有續期或擴容。以上是有日期的觀察，不是即時狀態。

## 按需追溯

[歷史索引](_archive/README.md#recent-history) → 指定階段／工作包 → 該 LOG／EV。完整舊 STATUS 只作歷史快照，不再是接續入口。

用量：最近使用者於 2026-09-30 表示「有额度了，继续开始任务」，未提供百分比；餘額未知，不推算重置。

