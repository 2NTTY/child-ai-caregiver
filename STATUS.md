# STATUS

只作根 PLAN 的短現況投影；工作包、前置、未驗與完成門檻見 [PLAN 當前入口](PLAN.md#active)。

## 目前與接手

- **完整 P2 尚未完成。** 原二十包及 INT 已交付；A01～A08 已合併，A09 的剩餘聊天成果／穩定服務由 F07／F08 承接。本輪只做聊天 Agent，其他三角色內部實作暫緩，見 [ADR-021](docs/DECISIONS.md#adr-021)。
- **當前產品包：[聊天容量恢復](PLAN.md#chat-capacity-recovery)。** 原候選仍在 `codex/p2-chat-capacity-recovery`，未提交／PR／合併／部署。核心局部檢查與審核不代表完整流程通過；HTTP／瀏覽器尚有失敗／未驗，詳細證據保留原工作區，沒有混入本次文件交付。
- **2026-10-11 使用者最新安排：**容量包之後先停下，在 Plan 模式重新規劃 SQL → Firebase；已決定捨棄 SQL。本機前端預覽／驗收已取消，預期遷移後到 GCP 測試。本次只重排根 PLAN，不開始遷移、GCP 操作或付費模型批次。
- **接手版本：**2026-10-11 已核遠端 master `a38e03f3`（#189）。#186 受控文件批次已合併，舊「尚未 PR／合併」失效；其離線 consumer、F01 writer／consumer 及其他接點仍未啟用正式流量，不代表完整遷移或成果完成。已合併範圍見 [PLAN 交付索引](PLAN.md#chat-reliability-delivered)。
- 新前端已是正式入口，後續保留設計／互動；前端工作沿 [frontend/AGENTS](frontend/AGENTS.md) → [frontend/PLAN#active](frontend/PLAN.md#active)。本人 key／限額已接線，Developer API 地區限制及真服務未驗見 [S06-W05](PLAN.md#s06-w05)；平台 AI 不要求家長自備 key。

<a id="deployment"></a>
## 最後部署觀察（非即時狀態）

2026-10-08 約 01:41 UTC，A09 既有唯讀觀察：正式網址 https://ex-machina.eu.org 的 Web／API／worker 均為 `85e3a846`，API／PostgreSQL healthy；A01～A08 尚未部署，SMTP／正式帳號設定未配置，根磁碟餘約 2.2 GB（89% 已用）。[固定版本證據](https://github.com/2NTTY/child-ai-caregiver/blob/93c64e41de076d9429cbe6f938fbc6042d2de857/artifacts/verification/P2_A09_REMOTE_PREFLIGHT.log)不是本輪重新探測；新 master 不等於部署版本。

該次核對原 VM STOP 為 **2026-10-10 20:50:44 HKT**，目前已過該時間；本輪未核其後存活／停止情況，不能假定仍可用。沒有續期、擴容、建資源或遷移；正式雲端切片、資料／身份／資源及費用、切換窗口仍須按有效批准核實。現有及目標部署入口見 [正式 Web](docs/PRODUCTION_FRONTEND.md)。

<a id="preview-history"></a>
## 已記錄的預覽觀察

2026-10-10T08:45:53Z 公開 Sites v67 發布，Sites source `b77c79bf17dca00c1a5f35393c6b4b941e8ab473`（不是 Git commit）；#177 原碼隨 v66／v67 發布，#182 已合併。當時四尺寸 radio 定向瀏覽器觀察通過，PDF 只有 fixture 預期錯誤，實際下載／pending race 未驗；完整次數與收據見 [當時 LOG](WORKLOG.md#log-20261010-followup-input-evidence)及[前端現況](frontend/STATUS.md)。這不是本輪驗收或正式 Server 部署，也不以 v67 代表今天公開預覽的最新版本。

## 按需追溯

[歷史索引](_archive/README.md#recent-history) → 指定包／LOG／EV；根 PLAN 整理前完整版本見 [固定快照](_archive/README.md#plan-20261011)。舊真模型 20／20 與累計費用授權只屬歷史，不是本聊天可重新使用的餘額。

用量：最近使用者於 2026-09-30 表示「有额度了，继续开始任务」，未提供百分比；餘額未知，不推算重置。
