# STATUS

只作根 PLAN 的短現況投影；工作包、前置、未驗與完成門檻見 [PLAN 當前入口](PLAN.md#active)。

## 目前與接手

- **完整 P2 尚未完成。** 原二十包及 INT 已交付；A01～A08 已合併，A09 的剩餘聊天成果／穩定服務由 F07／F08 承接。本輪只做聊天 Agent，其他三角色內部實作暫緩，見 [ADR-021](docs/DECISIONS.md#adr-021)。
- **當前產品包：[P2-F01](PLAN.md#p2-f01)。** 使用者已批准 F01～F08／A09 實施計劃；master 基線 `fd5d4f0`（#190），分支 `codex/p2-f01-firebase-foundation`。正式 Firebase 組裝、canonical writer、身份／逐裝置 session 及完整 SQL 路徑對照已交付候選，定向驗證及獨立審核通過；完成隨本包 PR 正常合併生效，合併後進 F02。未部署、未作真雲端驗收。
- **最新決定：**乾淨 Firebase 起點、正式零 SQL；不搬舊帳號／私人資料，不刪舊版本或備份，見 [ADR-022](docs/DECISIONS.md#adr-022)。容量候選併 F03／F08，原 dirty 工作區與失敗保留；不再先交舊 SQL 容量包或停在規劃階段。本機前端預覽仍不作產品驗收，正式流程到 GCP 驗證。
- **本聊天有效範圍：**新增 US$30 只供本次遷移與驗收，不重用舊 20／20 模型批次；F02／F07／F08 依已批准有界範圍、首次失敗停批及最多兩輪定向修正執行。專用測試收件地址已由使用者提供，僅供本次驗收；驗證連結由本人處理；持續正式服務另待 F08 實測成本／月費估算後決定營運預算，不能據此提前標完整 P2 完成。
- **接手與證據：**本包前已核 open PR 為空；#186～#190 已合併，Firestore 既有切片仍不是正式流量。正式程式型別通過；全 Server 型別仍有五項已重現於原 master 的舊測試錯誤，F03 承接。原容量 16 檔 SHA-256、依賴版本與本包實際驗證分層見 [F01 證據](artifacts/verification/F01_FIREBASE_FOUNDATION_20261011.json)。
- 新前端已是正式入口，後續保留設計／互動；前端工作沿 [frontend/AGENTS](frontend/AGENTS.md) → [frontend/PLAN#active](frontend/PLAN.md#active)。本人 key／限額已接線，Developer API 地區限制及真服務未驗見 [S06-W05](PLAN.md#s06-w05)；平台 AI 不要求家長自備 key。

<a id="deployment"></a>
## 最後部署觀察（非即時狀態）

2026-10-08 約 01:41 UTC，A09 既有唯讀觀察：正式網址 https://ex-machina.eu.org 的 Web／API／worker 均為 `85e3a846`，API／PostgreSQL healthy；A01～A08 尚未部署，SMTP／正式帳號設定未配置，根磁碟餘約 2.2 GB（89% 已用）。[固定版本證據](https://github.com/2NTTY/child-ai-caregiver/blob/93c64e41de076d9429cbe6f938fbc6042d2de857/artifacts/verification/P2_A09_REMOTE_PREFLIGHT.log)不是本輪重新探測；新 master 不等於部署版本。

**2026-10-11 10:23 UTC 重新核對：**GCP 專案 ACTIVE、計費已啟用，舊 VM `yuban-p1` 仍為 RUNNING；本次沒有讀回產品部署 revision／健康，不能把 RUNNING 當完整產品可用。原 STOP 時間已過，舊時間不再代表即時狀態。Firestore／Firebase／Cloud Run API 尚未啟用、bucket 清單為空；所需建資源權限已存在，沒有改 IAM。Cloud Billing 管理 API 已啟用並讀回成功，只供成本核查；沒有新建應用資源、模型呼叫或讀取家庭資料。新遷移實際費用尚未量測，見 F01 證據；正式部署入口見 [正式 Web](docs/PRODUCTION_FRONTEND.md)。

<a id="preview-history"></a>
## 已記錄的預覽觀察

2026-10-10T08:45:53Z 公開 Sites v67 發布，Sites source `b77c79bf17dca00c1a5f35393c6b4b941e8ab473`（不是 Git commit）；#177 原碼隨 v66／v67 發布，#182 已合併。當時四尺寸 radio 定向瀏覽器觀察通過，PDF 只有 fixture 預期錯誤，實際下載／pending race 未驗；完整次數與收據見 [當時 LOG](WORKLOG.md#log-20261010-followup-input-evidence)及[前端現況](frontend/STATUS.md)。這不是本輪驗收或正式 Server 部署，也不以 v67 代表今天公開預覽的最新版本。

## 按需追溯

[歷史索引](_archive/README.md#recent-history) → 指定包／LOG／EV；根 PLAN 整理前完整版本見 [固定快照](_archive/README.md#plan-20261011)。舊真模型 20／20 與累計費用授權只屬歷史，不是本聊天可重新使用的餘額。

用量：最近使用者於 2026-09-30 表示「有额度了，继续开始任务」，未提供百分比；餘額未知，不推算重置。
