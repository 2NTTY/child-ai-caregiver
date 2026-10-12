# STATUS

只作根 PLAN 的短現況投影；工作包、前置、未驗與完成門檻見 [PLAN 當前入口](PLAN.md#active)。

## 目前與接手

- **完整 P2 尚未完成。** 原二十包及 INT 已交付；A01～A08 已合併，A09 的剩餘聊天成果／穩定服務由 F07／F08 承接。本輪只做聊天 Agent，其他三角色內部實作暫緩，見 [ADR-021](docs/DECISIONS.md#adr-021)。
- **當前產品包：[P2-F02](PLAN.md#p2-f02)，2026-10-12 依使用者要求收尾，轉由主開發聊天接手。** F01 已由 [#191](https://github.com/2NTTY/child-ai-caregiver/pull/191) 合併為 `d5dbf61`；F02 分支 `codex/p2-f02-firebase-cloud-slice` 尚未整包驗收或交付。已通過核心 API／文件／照片／原操作收據／跨帳號拒絕／公共知識、真 Tasks 防重、指定信箱驗證，以及配對備份→原照片刪除→隔離還原。還原已核對當前 Auth、新 epoch、舊會話移除及照片不復活，維持暫停；原物件實體清理仍待辦。自動縮零喚醒、真雲端撤權、重設電郵生命週期及必要產品畫面仍待驗；原本人瀏覽器失敗未重現，不聲稱已修復。原失敗及分層結果見 [F02 證據](artifacts/verification/F02_FIREBASE_PREFLIGHT_20261011.json)。本聊天停止開發並暫停目標；接手前重新核對 master、原分支及雲端，沿現有證據收束 F02，不能從新空分支重做或把局部通過當整包完成。
- **本輪執行：**只使用 Astra 主模型，不啟動或續派子代理；由主模型分開實作、差異覆核及驗收判斷，不宣稱有另一代理獨立審核。唯一開發網址沿用 https://ex-machina.eu.org，不再維護另一套公開合成預覽；最新要求是零 SQL，其他服務按成本效益選擇，見 [ADR-023](docs/DECISIONS.md#adr-023)。尚未完成 VM／Hosting 取捨；只建立了 Firebase custom-domain 待驗證記錄，DNS 未改，原站仍指向舊 VM，不需使用者先登入 Cloudflare。
- **最新決定：**乾淨 Firebase 起點、正式零 SQL；不搬舊帳號／私人資料，不刪舊版本或備份，見 [ADR-022](docs/DECISIONS.md#adr-022)。容量候選併 F03／F08，原 dirty 工作區與失敗保留；不再先交舊 SQL 容量包或停在規劃階段。本機前端預覽仍不作產品驗收，正式流程到 GCP 驗證。
- **本聊天有效範圍：**新增 US$30 只供本次遷移與驗收，不重用舊 20／20 模型批次；F02／F07／F08 依已批准有界範圍、首次失敗停批及最多兩輪定向修正執行。專用測試收件地址已由使用者提供，僅供本次驗收；驗證連結由本人處理；持續正式服務另待 F08 實測成本／月費估算後決定營運預算，不能據此提前標完整 P2 完成。
- **接手與證據：**本包前已核 open PR 為空；#186～#190 已合併，Firestore 既有切片仍不是正式流量。正式程式型別通過；全 Server 型別仍有五項已重現於原 master 的舊測試錯誤，F03 承接。原容量 16 檔 SHA-256、依賴版本與本包實際驗證分層見 [F01 證據](artifacts/verification/F01_FIREBASE_FOUNDATION_20261011.json)。
- 新前端已是正式入口，後續保留設計／互動；前端工作沿 [frontend/AGENTS](frontend/AGENTS.md) → [frontend/PLAN#active](frontend/PLAN.md#active)。本人 key／限額已接線，Developer API 地區限制及真服務未驗見 [S06-W05](PLAN.md#s06-w05)；平台 AI 不要求家長自備 key。

<a id="deployment"></a>
## 最後部署觀察（非即時狀態）

2026-10-08 約 01:41 UTC，A09 既有唯讀觀察：正式網址 https://ex-machina.eu.org 的 Web／API／worker 均為 `85e3a846`，API／PostgreSQL healthy；A01～A08 尚未部署，SMTP／正式帳號設定未配置，根磁碟餘約 2.2 GB（89% 已用）。[固定版本證據](https://github.com/2NTTY/child-ai-caregiver/blob/93c64e41de076d9429cbe6f938fbc6042d2de857/artifacts/verification/P2_A09_REMOTE_PREFLIGHT.log)不是本輪重新探測；新 master 不等於部署版本。

**2026-10-11 19:26 UTC 最後核對：**隔離 API `00004-vn6`／worker `00004-nls` 來源 `97de268`，均設為 MANUAL 0，監測讀回全部已用 revisions 的實例為零；來源 control 停用、Tasks queue PAUSED 且空。隔離還原庫為 `applied-paused`，operator `1584f6e`；96 份快照文件及一張照片已配對備份，還原後 84 筆資料／零舊會話／一份 checkpoint，刪除屏障及清理責任保留。備份保留至 2026-10-26T19:02:44Z；臨時 PITR 已關閉，資料／附件／journal 及舊資源未刪除。Hosting `f0bd20c01b744ba1`（client `2471e4d`）及 blocking function `00003-viq` 維持原版本；測試 API 因暫停不可用，正式網址未切換。來源／還原庫及私人 buckets、17 指定索引沿先前讀回；舊 VM 最後於 10:23 UTC 觀察 RUNNING，本次未操作。F02 額度 US$6（內含 US$2 收尾），另保留 US$24；本批保守成本界線 US$3.0932，不是帳單。Build 累計 1130.121／1800 秒；本輪零模型生成／零通知外發，保留儲存及既有資源仍可能計費，實際帳單未知。詳見 [F02 EV](artifacts/verification/F02_FIREBASE_PREFLIGHT_20261011.json)及[正式 Web 方法](docs/PRODUCTION_FRONTEND.md)。

<a id="preview-history"></a>
## 已記錄的預覽觀察

2026-10-10T08:45:53Z 公開 Sites v67 發布，Sites source `b77c79bf17dca00c1a5f35393c6b4b941e8ab473`（不是 Git commit）；#177 原碼隨 v66／v67 發布，#182 已合併。當時四尺寸 radio 定向瀏覽器觀察通過，PDF 只有 fixture 預期錯誤，實際下載／pending race 未驗；完整次數與收據見 [當時 LOG](WORKLOG.md#log-20261010-followup-input-evidence)及[前端現況](frontend/STATUS.md)。這不是本輪驗收或正式 Server 部署，也不以 v67 代表今天公開預覽的最新版本。

## 按需追溯

[歷史索引](_archive/README.md#recent-history) → 指定包／LOG／EV；根 PLAN 整理前完整版本見 [固定快照](_archive/README.md#plan-20261011)。舊真模型 20／20 與累計費用授權只屬歷史，不是本聊天可重新使用的餘額。

用量：最近使用者於 2026-09-30 表示「有额度了，继续开始任务」，未提供百分比；餘額未知，不推算重置。
