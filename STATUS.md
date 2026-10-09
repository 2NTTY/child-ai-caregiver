# STATUS

只作根 PLAN 的短現況投影；工作包狀態、下一步及未驗項在 [PLAN 當前入口](PLAN.md#active)，不在本頁累積交付史。

## 目前與接手

- **現有聊天 Agent 改進並行推進；遷移線仍以 P2-F01 為下一入口。** 首輪私人歷史摘要投影已完成局部實作與有界驗證，尚未合併／部署／真模型品質驗收；詳見 [PLAN 當前入口](PLAN.md#active)。另有 PR #150 的歧義／跨輪接續驗收尚未完成。Firestore／Firebase Auth／Cloud Run 遷移與其他三角色內部實作不在本包；原 A09、F07／F08 未完成門檻及失敗證據保留，P3 未啟動。
- 新前端已是正式入口，設計與互動保留；後續以單人對話辦事、真正文件修改、跨輪接續及 GCP 真實資料服務補齊能力。PR #118 的舊測試前端歸檔已合併，不能仍當待合併；master 新修正不等於已部署，未部署內容及其他聊天 draft 由 PLAN 記錄。
- 前端工作讀 [frontend/AGENTS](frontend/AGENTS.md) → [frontend/PLAN#active](frontend/PLAN.md#active)；Server／Agent／正式整合讀根 PLAN，再按包讀契約與 [UI 接點](docs/P2_UI_HANDOFF.md#chat-handoff)。既有真流程的失敗／未驗界線保留在原包證據，不由新計劃抹除。
- 本人模型 key／限額已接線；Gemini Developer API 地區限制仍在，見 [S06-W05](PLAN.md#s06-w05)。新服務預設提供平台 AI，不要求家長自備 key。

<a id="deployment"></a>
## 最後部署觀察（非即時狀態）

2026-10-08 約 01:41 UTC，A09 既有唯讀現場觀察：正式網址 https://ex-machina.eu.org 的 Web／API／worker 均為 85e3a846，API／PostgreSQL healthy；A01～A08 尚未部署，SMTP／正式帳號設定未配置，根磁碟餘約 2.2 GB（89% 已用）。這是 [#140 固定版本現場證據](https://github.com/2NTTY/child-ai-caregiver/blob/93c64e41de076d9429cbe6f938fbc6042d2de857/artifacts/verification/P2_A09_REMOTE_PREFLIGHT.log)，不是本輪重新探測或部署，也不以 draft 作 master。啟動／現有及目標部署分見 [正式 Web](docs/PRODUCTION_FRONTEND.md)。

該次核對原 VM STOP 為 **2026-10-10 20:50:44 HKT**；本輪未續期、擴容、建資源或遷移，不假定期限前完成。Firebase Auth／Firestore／Cloud Run／Storage 及恢復均待實作／驗證；雲端切片資源／費用及正式切換窗口另核准。

## 按需追溯

[歷史索引](_archive/README.md#recent-history) → 指定階段／工作包 → 該 LOG／EV。完整舊 STATUS 只作歷史快照，不再是接續入口。

用量：最近使用者於 2026-09-30 表示「有额度了，继续开始任务」，未提供百分比；餘額未知，不推算重置。

