# STATUS

只作根 PLAN 的短現況投影；工作包狀態、下一步及未驗項在 [PLAN 當前入口](PLAN.md#active)，不在本頁累積交付史。

## 目前與接手

- **目前聚焦聊天 Agent 可靠辦事及 F01 接點。** 本輪只有家長聊天 Agent；其他三角色只保留接口，唯一工作入口及 gate 見 [PLAN#active](PLAN.md#active)／[ADR-021](docs/DECISIONS.md#adr-021)。原 A09 引用、同文件修改、新對話讀回與穩定服務仍未完成。#164～#166 的 HTTP Auth、交易對照／授權／照片停機及原收據 reader 均已合併、未部署；Firebase 身份／裝置 session 及完整 F01 尚未完成。
- 本輪已核 master `5b832f68`；#183 起始輸入證據契約及 #184 recovery-only Firestore 原收據 adapter 已合併。當前受控純到期 writer／consumer 已經獨立 review Allow 及 dot 核准正常 PR 交付，尚未 PR／啟用；只在完整既有同庫 canonical authority 前提下提供站內補問／記錄回述、原子起始快照及原收據 lookup。正式 lifecycle writers、bootstrap／排程／outbox／cleanup／restore／migration、API query／DTO 及 per-work outcome 仍未完成；測試及未驗界線見 [PLAN#active](PLAN.md#active)。#182 已合併；既有公開 Sites v67 於 2026-10-10T08:45:53Z 發布，Sites source `b77c79bf17dca00c1a5f35393c6b4b941e8ab473`，radio 在 1440／1024／390／320 四尺寸的 31 項真瀏覽器觀察通過。PDF 只見 fixture 預期錯誤，實際下載／pending race 仍未驗；前端包入口見 [frontend/STATUS](frontend/STATUS.md)。本 Server 未部署，局部接線不代表完整 F01／A09 已完成。累計 US$30 授權包含先前支出，原 20／20 歷史台帳不重置，完整成本核對未成立前不執行新付費批次；全平台共額及跨庫 fencing 仍未完成，未啟用正式持久流量。
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

