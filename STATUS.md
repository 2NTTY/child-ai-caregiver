# STATUS

只作根 PLAN 的短現況投影；工作包、前置、未驗與完成門檻見 [PLAN 當前入口](PLAN.md#active)。

## 目前與接手

- **完整 P2 尚未完成。** 原 P2／INT 及 A01～A08 的已合併成果保留；A09 剩餘成果由 F07／F08 承接。P2 啟用聊天及現有工具，另外三角色明確移至 [P3-M01～M03](PLAN.md#p3-agent-roles)，只留最小接口。
- **當前產品包：[P2-F02](PLAN.md#p2-f02)。** F01 已隨 PR #191 合併，文件基線 master 為 d5dbf61。F02 原分支 codex/p2-f02-firebase-cloud-slice 的 6a87632 未合併，資料／身份／附件／排程／恢復成果及原失敗照用，先 review 原 VM 接線缺口，不另起空分支重做。
- **本輪文件定案：[ADR-024](docs/DECISIONS.md#adr-024)。** 保留原網址／VM／Compose／Caddy；正式 SQL 改 Firestore，復用 Firebase Auth／Storage／Tasks。取消 Hosting／Cloud Run／縮零及最後才接前端的必達門檻；F03 首次可用聊天即更新原站。乾淨起點不搬舊測試帳號／私人資料，也不刪舊備份。
- **證據與未完成：**[候選取捨已核對](PLAN.md#f02-candidate-disposition)：保留 F02 有效資料／服務接點及容量五檔小修正；Hosting／Cloud Run 專用部署和失敗的容量模擬預覽退出後續工作，只留歷史參考。F03 接容量行為並處理 F01 原 master 五項測試型別錯誤，見 [F01 證據](artifacts/verification/F01_FIREBASE_FOUNDATION_20261011.json)。F02 及容量候選未合併／待驗狀態不變，額外雲端部署僅列[清理範圍](docs/PRODUCTION_FRONTEND.md#firestore-deployment)。
- **操作範圍：**本輪只修文件並交付，未跑產品測試、遷移或部署；合併後停下，不啟動 F02。原 US$30 驗收批次及舊模型次數不是可推定的剩餘預算，後續操作先核有效範圍、實際使用及資源期限；持續服務預算另按實測核定。
- 新前端保持正式入口的設計及互動；前端按 [frontend/AGENTS](frontend/AGENTS.md) → [frontend/PLAN#active](frontend/PLAN.md#active)。本人 key／限額及其限制見 [S06-W05](PLAN.md#s06-w05)；平台 AI 不要求家長自備 key。

<a id="deployment"></a>
## 最後部署觀察（非即時狀態）

2026-10-08 約 01:41 UTC，A09 既有唯讀觀察：正式網址 https://ex-machina.eu.org 的 Web／API／worker 均為 `85e3a846`，API／PostgreSQL healthy；A01～A08 尚未部署，SMTP／正式帳號設定未配置，根磁碟餘約 2.2 GB（89% 已用）。[固定版本證據](https://github.com/2NTTY/child-ai-caregiver/blob/93c64e41de076d9429cbe6f938fbc6042d2de857/artifacts/verification/P2_A09_REMOTE_PREFLIGHT.log)不是本輪重新探測；新 master 不等於部署版本。

**F02 原分支最後記錄：2026-10-11 19:26 UTC（本輪未重新探測）。**已建立 Firestore／Storage／Auth／Tasks 及額外 Hosting／Cloud Run API／worker 切片，故更早「未啟用 API、無 bucket」觀察已不代表當時最新狀態。該記錄中 API／worker 為手動零 instance、佇列暫停、還原環境 applied-paused，原網站 DNS 未換；PITR 關閉，保留備份及待處理清理項，實際帳單未知。證據在未合併 6a87632 的 STATUS／verification，按 [F02](PLAN.md#p2-f02) 接回，不把切片或舊 VM RUNNING 當正式產品已完成／可用。

<a id="preview-history"></a>
## 已記錄的預覽觀察

2026-10-10T08:45:53Z 公開 Sites v67 發布，Sites source `b77c79bf17dca00c1a5f35393c6b4b941e8ab473`（不是 Git commit）；#177 原碼隨 v66／v67 發布，#182 已合併。當時四尺寸 radio 定向瀏覽器觀察通過，PDF 只有 fixture 預期錯誤，實際下載／pending race 未驗；完整次數與收據見 [當時 LOG](WORKLOG.md#log-20261010-followup-input-evidence)及[前端現況](frontend/STATUS.md)。這不是本輪驗收或正式 Server 部署，也不以 v67 代表今天公開預覽的最新版本。

## 按需追溯

[歷史索引](_archive/README.md#recent-history) → 指定包／LOG／EV；根 PLAN 整理前完整版本見 [固定快照](_archive/README.md#plan-20261011)。舊真模型 20／20 與累計費用授權只屬歷史，不是本聊天可重新使用的餘額。

用量：最近使用者於 2026-09-30 表示「有额度了，继续开始任务」，未提供百分比；餘額未知，不推算重置。
