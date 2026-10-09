# STATUS

只作根 PLAN 的短現況投影；工作包狀態、下一步及未驗項在 [PLAN 當前入口](PLAN.md#active)，不在本頁累積交付史。

## 目前與接手

- **目前聚焦聊天 Agent 可靠辦事及 F01 接點。** 本輪只有家長聊天 Agent；其他三角色只保留接口，唯一工作入口及 gate 見 [PLAN#active](PLAN.md#active)／[ADR-021](docs/DECISIONS.md#adr-021)。原 A09 引用、同文件修改、新對話讀回與穩定服務仍未完成。#164～#166 的 HTTP Auth、交易對照／授權／照片停機及原收據 reader 均已合併、未部署；Firebase 身份／裝置 session 及完整 F01 尚未完成。
- 本輪基線 master `8eb984a7`（#171 已正常合併、未部署）；固定平台 services／reply／持久 Session／root／daily 及 owned cleanup 保留。當前候選修既有 work 的本人來源與取消守衛；兩項合成紅保留，必要定向及 Server typecheck 通過，獨立 review 無阻塞、dot 最終驗收通過，准予精確8檔正常 PR 交付，尚未建立 PR，見 [PLAN 當前入口](PLAN.md#active)。#171 單字補問窄修已合併；原四輪中第2輪仍 active、額外查回輪才 completed 的限制保留，不稱自動同輪結案或真模型理解通過。正式 bootstrap、持久受理／resume、清理／restore 及跨庫 fencing 仍未完成，未啟用正式持久流量。
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

