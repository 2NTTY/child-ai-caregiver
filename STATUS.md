# STATUS

只作根 PLAN 的短現況投影；工作包、前置、未驗與完成門檻見 [PLAN 當前入口](PLAN.md#active)。

## 目前與接手

- **完整 P2 尚未完成。** 原二十包及 INT 已交付；A01～A08 已合併，A09 的剩餘聊天成果／穩定服務由 F07／F08 承接。本輪只做聊天 Agent，其他三角色內部實作暫緩，見 [ADR-021](docs/DECISIONS.md#adr-021)。
- **當前產品包：[P2-F02](PLAN.md#p2-f02)。** F01 已由 [#191](https://github.com/2NTTY/child-ai-caregiver/pull/191) 合併為 `d5dbf61`，遠端全樹與審核 head 一致；F02 分支 `codex/p2-f02-firebase-cloud-slice` 正在接通真雲端最小完整流程。身份 client／blocking function、Firestore 孩子／事項／原收據已接正式組裝；不可變附件 port、定向測試、型別及 Web 建置已有本機證據。文件、附件／獨立刪除 journal、少量公共知識及提醒 worker／dispatcher 已有定向本機實作與審核，正式 API／client 接線已完成，隔離還原與配對備份已完成本機核心實作，operator 編排定向測試及獨立覆核已通過，真雲端還原尚未驗證；整體 gate 未通過，不能當 F02 完成。審核指出的斷線容量及排程續頁已修，當前電郵身份核對已接線並通過定向測試。Firebase 條款阻塞已解除；隔離 Firestore／Storage／專用身份與 secret、最小 runtime 權限及私人 blocking function 已建立。電郵登入仍關閉，尚未寄信／執行雲端產品驗收。
- **最新決定：**乾淨 Firebase 起點、正式零 SQL；不搬舊帳號／私人資料，不刪舊版本或備份，見 [ADR-022](docs/DECISIONS.md#adr-022)。容量候選併 F03／F08，原 dirty 工作區與失敗保留；不再先交舊 SQL 容量包或停在規劃階段。本機前端預覽仍不作產品驗收，正式流程到 GCP 驗證。
- **本聊天有效範圍：**新增 US$30 只供本次遷移與驗收，不重用舊 20／20 模型批次；F02／F07／F08 依已批准有界範圍、首次失敗停批及最多兩輪定向修正執行。專用測試收件地址已由使用者提供，僅供本次驗收；驗證連結由本人處理；持續正式服務另待 F08 實測成本／月費估算後決定營運預算，不能據此提前標完整 P2 完成。
- **接手與證據：**本包前已核 open PR 為空；#186～#190 已合併，Firestore 既有切片仍不是正式流量。正式程式型別通過；全 Server 型別仍有五項已重現於原 master 的舊測試錯誤，F03 承接。原容量 16 檔 SHA-256、依賴版本與本包實際驗證分層見 [F01 證據](artifacts/verification/F01_FIREBASE_FOUNDATION_20261011.json)。
- 新前端已是正式入口，後續保留設計／互動；前端工作沿 [frontend/AGENTS](frontend/AGENTS.md) → [frontend/PLAN#active](frontend/PLAN.md#active)。本人 key／限額已接線，Developer API 地區限制及真服務未驗見 [S06-W05](PLAN.md#s06-w05)；平台 AI 不要求家長自備 key。

<a id="deployment"></a>
## 最後部署觀察（非即時狀態）

2026-10-08 約 01:41 UTC，A09 既有唯讀觀察：正式網址 https://ex-machina.eu.org 的 Web／API／worker 均為 `85e3a846`，API／PostgreSQL healthy；A01～A08 尚未部署，SMTP／正式帳號設定未配置，根磁碟餘約 2.2 GB（89% 已用）。[固定版本證據](https://github.com/2NTTY/child-ai-caregiver/blob/93c64e41de076d9429cbe6f938fbc6042d2de857/artifacts/verification/P2_A09_REMOTE_PREFLIGHT.log)不是本輪重新探測；新 master 不等於部署版本。

**2026-10-11 10:23 UTC 重新核對：**GCP 專案 ACTIVE、計費已啟用，舊 VM `yuban-p1` 仍為 RUNNING；本次沒有讀回產品部署 revision／健康，不能把 RUNNING 當完整產品可用。原 STOP 時間已過，舊時間不再代表即時狀態。當時 bucket 清單為空；所需建資源權限已存在，沒有改 IAM。其後必要 API 已啟用。12:32 UTC 在本人確認條款後讀回 Firebase ACTIVE，Identity Platform 已初始化、登入供應商尚未啟用；已建立香港區 `yuban-firebase-20261011`（Standard Native）、私人附件／獨立 journal bucket、五個專用服務身份及加密 secret version 1。Firestore 拒絕 client 直讀寫規則已發布；13:11 UTC 已讀回 blocking function ACTIVE、專用身份／secret version 1／256 MiB／CPU 1／min 0／max 1／7 秒期限均符合設定；仍未公開或接通登入。13:58 UTC 已讀回全部 17 個複合／向量索引 READY；照片 scope 單欄索引亦已就緒。14:06 UTC 隔離 Tasks queue 已建立並讀回 PAUSED，沒有入列工作。14:49 UTC 已建立空的香港區隔離還原庫，client 拒絕規則已發布，API／worker 的資料權限仍只限來源庫；已批准的 Tasks 最小權限讀回一致，queue 維持 PAUSED。隔離 Hosting site／Web app 已建立，正式前端已帶 Firebase 設定完成型別及建置，尚未發布。API／worker／Hosting 及產品流程未部署驗收。原條款 403 及 Rules 範例欄位首次失敗保留於證據。F02 依當期價格預留 US$6 批次額度（內含 US$2 收尾餘額），本次 US$30 另保留 US$24；估算不是實際帳單或硬限額。沒有模型呼叫或讀取家庭資料，實際遷移費用尚未量測，見 [F02 前置證據](artifacts/verification/F02_FIREBASE_PREFLIGHT_20261011.json)；正式部署入口見 [正式 Web](docs/PRODUCTION_FRONTEND.md)。

<a id="preview-history"></a>
## 已記錄的預覽觀察

2026-10-10T08:45:53Z 公開 Sites v67 發布，Sites source `b77c79bf17dca00c1a5f35393c6b4b941e8ab473`（不是 Git commit）；#177 原碼隨 v66／v67 發布，#182 已合併。當時四尺寸 radio 定向瀏覽器觀察通過，PDF 只有 fixture 預期錯誤，實際下載／pending race 未驗；完整次數與收據見 [當時 LOG](WORKLOG.md#log-20261010-followup-input-evidence)及[前端現況](frontend/STATUS.md)。這不是本輪驗收或正式 Server 部署，也不以 v67 代表今天公開預覽的最新版本。

## 按需追溯

[歷史索引](_archive/README.md#recent-history) → 指定包／LOG／EV；根 PLAN 整理前完整版本見 [固定快照](_archive/README.md#plan-20261011)。舊真模型 20／20 與累計費用授權只屬歷史，不是本聊天可重新使用的餘額。

用量：最近使用者於 2026-09-30 表示「有额度了，继续开始任务」，未提供百分比；餘額未知，不推算重置。
