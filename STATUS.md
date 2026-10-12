# STATUS

只作根 PLAN 的短現況投影；工作包、前置、未驗與完成門檻見 [PLAN 當前入口](PLAN.md#active)。

## 目前與接手

- **完整 P2 尚未完成。** 原 P2／INT 及 A01～A08 的已合併成果保留；A09 剩餘成果由 F07／F08 承接。P2 啟用聊天及現有工具，另外三角色明確移至 [P3-M01～M03](PLAN.md#p3-agent-roles)，只留最小接口。
- **當前產品包：[P2-F08](PLAN.md#p2-f08)，原站交付。** F07 已由 #200 合併為 `353cf70`，F08 分支 `codex/p2-f08-original-site`。2026-10-13 原站已切至 `f08-cce4667` 的 Firestore API／worker／新前端，PostgreSQL 已停止；登入及保存已通過，完整 Agent 成果與營運收尾仍未完成，不改 UI。
- **最新次序：[ADR-025](docs/DECISIONS.md#adr-025)。** 先完成所有資料域及正式執行的 SQL 退出，使用 GCP 香港 Firestore；受邀用戶、真 Agent 完整使用及原站交付排在其後。保留原網址／VM／Compose／Caddy、前端及可用服務；舊 SQL 測試資料不必搬遷／對帳，舊備份暫留。F03 不再要求首次聊天即上線。
- **證據與未完成：**[F07 EV](artifacts/verification/F07_FIRESTORE_SQL_EXIT_20261013.json) 保留資料接線、還原及 SQL 退出證據。F08 已在原站完成合成獲邀註冊、驗證關卡、登入／同意、孩子與原文保存及刷新讀回；電郵驗證用 fixture，不重寄或冒稱收信。真聊天在 Gemini 前因缺 ADK 事件排序索引停止（零模型呼叫），已補索引，尚待補完。背景 queue 仍暫停，未發通知；部署、完整聊天及恢復能力分開判斷。
- **操作範圍：**持續完成 [P2 路線](PLAN.md#p2-completion-execution)，本輪只用主模型，不派子代理、不用 Computer Use 或全量測試。2026-10-13 已授權同類最低必要驗收直接執行，具體邊界見 PLAN；失敗仍停批查根因、不重跑已通過項。費用／傳送及期限不任意擴大，不建新站或 Kubernetes。
- 新前端保持正式入口的設計及互動；前端按 [frontend/AGENTS](frontend/AGENTS.md) → [frontend/PLAN#active](frontend/PLAN.md#active)。本人 key／限額及其限制見 [S06-W05](PLAN.md#s06-w05)；平台 AI 不要求家長自備 key。


<a id="deployment"></a>
## 最後部署觀察（非即時狀態）

**2026-10-12 本輪唯讀核對：**原 VM `yuban-p1`／ID `2846984358678394356` 為 RUNNING／e2-small，停止期限 `2026-10-17T12:50:44Z`（香港 20:50:44）；原附加身份初查只有 Vertex 專案權限；使用者明確批准後，已加入僅限命名來源庫的 Firestore user、既有最小 Session 自訂角色、私人附件 objectUser、journal 只新增／讀取、指定 queue 自訂派送角色及指定 dispatcher actAs，逐項讀回一致。沒有新增資源、Owner／Editor 或 service-account key。來源及還原 Firestore 庫均在 asia-east2、PITR 關閉；`yuban-firebase` queue PAUSED。兩個私人 bucket 的 soft-delete 實際為 14 天，不能把單項保留設定當完整配對備份證據。IAP 唯讀核 VM 仍運行 `85e3a846` 的 API／worker／Web 與 PostgreSQL；根磁碟餘 2.1 GB（89% 已用），沒有改服務或清理 volume。實際帳單仍未知；以下歷史部署／驗收仍保留。

2026-10-08 約 01:41 UTC，A09 既有唯讀觀察：正式網址 https://ex-machina.eu.org 的 Web／API／worker 均為 `85e3a846`，API／PostgreSQL healthy；A01～A08 尚未部署，SMTP／正式帳號設定未配置，根磁碟餘約 2.2 GB（89% 已用）。[固定版本證據](https://github.com/2NTTY/child-ai-caregiver/blob/93c64e41de076d9429cbe6f938fbc6042d2de857/artifacts/verification/P2_A09_REMOTE_PREFLIGHT.log)不是本輪重新探測；新 master 不等於部署版本。

**2026-10-11 19:26 UTC 最後核對：**隔離 API `00004-vn6`／worker `00004-nls` 來源 `97de268`，均設為 MANUAL 0，監測讀回全部已用 revisions 的實例為零；來源 control 停用、Tasks queue PAUSED 且空。隔離還原庫為 `applied-paused`，operator `1584f6e`；96 份快照文件及一張照片已配對備份，還原後 84 筆資料／零舊會話／一份 checkpoint，刪除屏障及清理責任保留。備份保留至 2026-10-26T19:02:44Z；臨時 PITR 已關閉，資料／附件／journal 及舊資源未刪除。Hosting `f0bd20c01b744ba1`（client `2471e4d`）及 blocking function `00003-viq` 維持原版本；測試 API 因暫停不可用，正式網址未切換。來源／還原庫及私人 buckets、17 指定索引沿先前讀回；舊 VM 最後於 10:23 UTC 觀察 RUNNING，本次未操作。F02 額度 US$6（內含 US$2 收尾），另保留 US$24；本批保守成本界線 US$3.0932，不是帳單。Build 累計 1130.121／1800 秒；本輪零模型生成／零通知外發，保留儲存及既有資源仍可能計費，實際帳單未知。詳見 [F02 EV](artifacts/verification/F02_FIREBASE_PREFLIGHT_20261011.json)及[正式 Web 方法](docs/PRODUCTION_FRONTEND.md)。


<a id="preview-history"></a>
## 已記錄的預覽觀察

2026-10-10T08:45:53Z 公開 Sites v67 發布，Sites source `b77c79bf17dca00c1a5f35393c6b4b941e8ab473`（不是 Git commit）；#177 原碼隨 v66／v67 發布，#182 已合併。當時四尺寸 radio 定向瀏覽器觀察通過，PDF 只有 fixture 預期錯誤，實際下載／pending race 未驗；完整次數與收據見 [當時 LOG](WORKLOG.md#log-20261010-followup-input-evidence)及[前端現況](frontend/STATUS.md)。這不是本輪驗收或正式 Server 部署，也不以 v67 代表今天公開預覽的最新版本。

## 按需追溯

[歷史索引](_archive/README.md#recent-history) → 指定包／LOG／EV；根 PLAN 整理前完整版本見 [固定快照](_archive/README.md#plan-20261011)。舊真模型 20／20 與累計費用授權只屬歷史，不是本聊天可重新使用的餘額。

用量：最近使用者於 2026-09-30 表示「有额度了，继续开始任务」，未提供百分比；餘額未知，不推算重置。
