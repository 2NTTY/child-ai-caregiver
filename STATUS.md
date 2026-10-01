# STATUS

## 當前階段
**P1 已完成；P2 的 20 個工作包已隨 PR #71／5098d64 結案。** S16 已隨 [PR #67](https://github.com/2NTTY/child-ai-caregiver/pull/67) 合併；S17 公開兩段 Agent 流程、真通知、明確完成及清理均通過。不啟動 P3；後續先接續獨立前端聊天的 Web 設計與正式整合。

## 品牌更名

2026-10-01 使用者指定現行品牌為「育有方」（原名「育伴港」）；改名在獨立分支處理，公開網站仍待部署。歷史文件、驗收證據及 `yuban-*` 技術識別保留；前端 FE-W21 由原前端聊天交付，不以主線舊預覽覆蓋。

## 最近交付的增補

S06-W05：本人 Gemini key 設定、加密保存、用量分流及 UI 可調每日／單次生成／query embedding 上限已接通。024 遷移、10 HTTP／31 store及必要 scripted Runner 驗收通過，原合成資料保留，新資料已清理；本次設定／本機接線交付隨 PR 合併生效。[證據](artifacts/verification/S06_W05_CHECKS.json)／[UI 功能清單](docs/P2_UI_HANDOFF.md#personal-model-ui)。Google Developer API 回覆地區不支援；依使用者確認，真生成／向量保留待驗，測試 key 已刪除。增補尚未部署至公開網站；不啟動 P3或取代前端聊天。

## 現況
- **試用 URL：https://ex-machina.eu.org**。正式功能 Web／Server 執行 **`43ab10c`**，保留原帳號、資料卷及密鑰；新前端的隔離預覽尚未取代正式 App。
- 原八張 P1 表的欄位摘要保留、migration 至 023、pgvector 0.8.6、四來源／五片段向量發布、23 次合成 HTTP 及一次 DB＋照片配對備份／空庫還原均通過；正常 worker 已運行。
- 公開展示 A：使用者在 Firefox 確認有 FHS 來源及接受任務候選；真 ADK／記憶／向量檢索／工具成功。展示 B：關頁後正常 worker 處理已授權到期預約，Telegram 接受、本人收到及 callback 均可核對；一次公開 Firefox Push 亦已確認收到。
- 首次公開互動因四次生成後未執行 Server 收尾而失敗，保留原失敗；修正只接回既有授權／引用 finalizer，不增加單次上限或重做工具。12 項必要 Runner 檢查及兩條公開補驗通過；完整本機 Server typecheck 因缺少既有通知套件受阻，未當作通過。
- 使用者明確確認後，合成預約已完成且無待催辦工作；專用孩子及附屬資料清理，Telegram／Push 的 Server 綁定撤銷。沒有刪原資料、沒有再發訊息；未操作 Firefox 本身的通知權限或 provider 退訂。
- S17 累計 3 個 Agent 運行（含首次失敗）、12 次生成、2 次查詢及 5 次文件 embedding，Telegram 2 則、Firefox Push 1 則。每日上限已恢復每人 **12／全站 20**，不清零用量；驗收帳號當日 14 次已超過恢復後個人上限，今日不能再發 AI 請求。用量 metadata 不完整，不當作完整帳單。
- 加密配對備份已按明確批准存於本機工程外並核對 hash，密鑰分開保存。主機固定於 **2026-10-03 20:50:44 HKT** 停止。[交付與限制](docs/P2_DELIVERY.md)／[實際展示回報](docs/P2_TRIAL.md)／[S17 證據](artifacts/verification/S17_W02_CHECKS.json)／[UI 功能與 API 清單](docs/P2_UI_HANDOFF.md)。


## P1 及分包歷史驗收

以下描述各包當時的驗收範圍；其中「未部署」等註記不代表上述現網狀態。

- P1 十個工作包的實作及必要驗收齊備；前置包均已合併。共享 Prompt Pack／美術沿用，沒有重做或 UI polish。
- 本機隔離容器、公開 TLS／登入隔離／原文保存／API 重建持久化、Linux 密鑰權限、磁碟與 WAL、metadata ADC、maintenance 加密備份／空庫還原通過。[EV-S16-W01](artifacts/verification/S16_W01_CHECKS.json)／[EV-S17-W01](artifacts/verification/S17_W01_CHECKS.json)
- Firefox 試玩曾回報可能閒置後呈現登出及限流；代理來源與未確認會話 UI 已修正。39 項針對性單元檢查、typecheck、建置及獲准的 15 次 HTTPS 讀取通過；使用者修正版覆核回覆「没问题了」，人工試玩門檻通過。未捏造原始 HTTP trace 或逐步時間。
- 本包兩次 Gemini 驗收成功，合計 1,793 input／42 output tokens；cached metadata 不完整，沒有帳單或優惠餘額證據。AI 每人每日 5 次／全站 20 次，每請求僅 1 次嘗試、6,000 字元／512 output tokens。
- 加密備份與恢復密鑰分開存於工程外、當前 Windows 使用者專用 ACL 目錄；既有本機合成庫保留。沒有額外 E2E、全量回歸或結案模型呼叫。
- P2 總計劃已定案，按工作包開始實作；[工作包](PLAN.md#roadmap-packages)／[Agent 規則](SPEC.md#section-5-11)／[ADR-011](docs/DECISIONS.md#adr-011)。S11-W03 已接入 ADK 與既有 Prompt Pack，18 項輕量測試及兩次真 Gemini 呼叫／一次工具循環通過；[證據](artifacts/verification/S11_W03_CHECKS.json)。Prompt Pack／美術未重做，現網仍是 P1。
- S06-W02 已有家庭邀請／角色／撤權、共享記錄與私人聊天隔離、個人通知偏好及功能 UI；62 項相關輕量測試及兩份 typecheck 通過。獲批本機 PostgreSQL 驗收 13 組／51 次 HTTP 通過，新增 migration、角色／撤權及私人聊天隔離正常，既有加密資料保留；未部署。[EV-S06-W02](artifacts/verification/S06_W02_CHECKS.json)。
- S05-W02 已接確認記錄／孩子檔案、約數與時間來源、更正歷史、快捷種類、時間軸及加密分頁搜尋；17 項必要輕量測試、兩份 typecheck、獲批本機 13 組／39 次 HTTP 通過，重啟及原資料保留可核對。[EV-S05-W02](artifacts/verification/S05_W02_CHECKS.json)。瀏覽器 E2E 及部署未執行。
- [UI 功能及對接清單](docs/P2_UI_HANDOFF.md) 列出 P2 功能與必要狀態，隨工作包補齊實際對接位置；未接通項目不當作已可用。
- S07-W03 已接原 opId 冪等收據、交易內版本／授權、無正文變更游標、可見頁面重讀及未知提交查核；刪除後不重建、撤權不能讀回舊收據。必要輕量檢查及兩份 typecheck 通過；獲准本機驗收首輪 8 組後中斷，沿用同批資料補足重啟／刪除，合計 54 次 HTTP 嘗試，詳見 [EV-S07-W03](artifacts/verification/S07_W03_CHECKS.json)。沒有模型／通知呼叫、E2E 或部署。


- S09-W02 已接候選／確認事實、來源版本、私人摘要精確覆蓋及話題終態／明確重開，功能 UI 復用 S07 收據、原操作重試及線上刷新。19 項相關輕量測試、兩份 typecheck 通過；獲准本機驗收 16 組、59 次 HTTP／35 次 store 呼叫通過，008／011 migration、重啟、隔離、刪除及原資料逐列保留可核對。[EV-S09-W02](artifacts/verification/S09_W02_CHECKS.json)。模型摘要及完整 Agent 記憶工具接線仍待 S11-W02，未部署或跑 E2E。
- S10-W01 必要驗收通過，完成隨 [PR #35](https://github.com/2NTTY/child-ai-caregiver/pull/35) 合併生效：官方套件 hash／相容性及離線映像核對通過，原 volume 保留、009 migration 成功；7 組／15 次真 embedding／79 次 store，原 23 張業務表不變，31 表加密備份／空庫還原及向量查詢通過。[EV-S10-W01](artifacts/verification/S10_W01_CHECKS.json)。Agent／引用 UI 接線及來源更新仍待後續包；未部署或跑 E2E。

## 七天試用與限制
- 香港 e2-small／20 GiB pd-balanced／固定 IP；GCE 已設定 maxRunDuration=604800／STOP，原定 2026-09-30 20:50:44 HKT 停止；使用者於 2026-09-30 明確批准續期三天，GCP 已改為 **2026-10-03 20:50:44 HKT** 固定時間 STOP，主機恢復 RUNNING、HTTPS health 200。續期後已按另行批准部署 P2，停止時間不變。
- 初估七天固定費 US$5.28，流量／AI 另計；停機後保留 disk／IP 仍約 US$5.85／月。不是硬性金額上限，不自行續期。
- [交付及操作](docs/P1_DELIVERY.md)／[組員試玩指引](docs/P1_TRIAL.md)。已收到使用者實際試玩確認；只適用 P1 合成資料範圍。

## 已合併工作包的驗收紀錄

S16-W05 的 Chromium 單一真 API 情景已通過：家庭隔離／viewer、原 opId 唯一恢復、撤權清 UI／草稿，147 HTTP；新孩子清理、服務停止。使用者確認 Firefox 專項延後，不阻塞 P2，後續必要功能檢查用 Codex 內置瀏覽器。完成隨本包 PR 合併生效；[證據](artifacts/verification/S16_W05_CHECKS.json)。未重跑已通過項、未改現網。
S13-W01 已隨 [PR #47](https://github.com/2NTTY/child-ai-caregiver/pull/47) 合併；S13-W04 的 pg-boss／原子入列、重啟去重、站內提醒及暫停還原已隨 [PR #48](https://github.com/2NTTY/child-ai-caregiver/pull/48) 合併。W04 的 27 項輕量檢查及獲批分段 PostgreSQL 驗收通過，包含 hard-kill 68.895 秒恢復及加密空庫還原，[範圍及證據](artifacts/verification/S13_W04_CHECKS.json)；尚未驗真通知。

S10-W02 必要集中驗收通過：014／原資料保留、來源發布及 hash 去重／向量復用、一次真 cron、六來源 adapter、公開／組內及過期隔離，以及暫時失敗／410／登記改動撤回批准。沿用 A 主責、權重 3、A 60%／C 40%，完成隨本包 PR 合併生效；[證據](artifacts/verification/S10_W02_CHECKS.json)。原失敗及 RTHK HTTPS 修正保留，沒有重跑整套舊腳本或模型。CHP／RTHK 維持組內限制。後續 P2 功能已按集中驗收例外在隔離分支接續，按各包證據及依賴逐一交付，不能把本包通過當成 P2 完成；現網仍 P1，沒有續期或部署。

S13-W05 Web Push：SQL 49 業務／2 輪詢通過，原子入列、隔離、失效／撤銷、unknown 不重發及持久化可核對；本輪合成資料清理、原行保留。一次 Firefox 真通知 HTTP 201，使用者確認關頁後收到及清理，Server 綁定撤銷已核對。內置瀏覽器 staging 訂閱被拒並清理，未擴大 provider；Firefox 整套相容性仍延後。沿用 D 主責、權重 3、D 45%／C 35%／B 20%，[證據](artifacts/verification/S13_W05_CHECKS.json)。未部署或續期，P2 未完成。

S13-W06 Telegram：沿用 D 主責、權重 3，D 60%／C 30%／B 10%。migration／配對備份空庫還原已有 S16 證據；45 業務／2 輪詢 SQL 核對本人綁定、update 去重、unknown、撤銷及持久化，合成資料清理、原行保留。一次真訊息 HTTP 200，使用者確認收到及按鈕回覆，持久台帳 acknowledged；不冒充照護完成。即時 answerCallbackQuery 未成功，公開 webhook 與該回覆接線留 S17-W02，未重發或部署。[證據](artifacts/verification/S13_W06_CHECKS.json)。

S14-W01 必要驗收通過，完成隨本包 PR 合併生效：香港日／七日摘要、到診準備保存及來源刪除後核對失效，沿用 39 次 HTTP 的合成內容流程；020 migration／加密還原及真 Agent 的 read_care_summary 已核對。交付只補 Server 型別及無模型配方載入，不重跑模型或瀏覽器。A 主責、權重 3，A 50%／B 30%／C 20%；[證據](artifacts/verification/S14_W01_CHECKS.json)。完整摘要 UI 情景未驗、PDF／分享留 P4；P2 未完成。

S13-W08 成長關注必要驗收通過，完成隨本包 PR 合併生效。有限四年齡段、家長暫緩／接受／任務唯一性及停用保存已核對；沿用真背景／重啟、關閉抑制及新依據證據。原引用品質失敗保留，修正只以必要 Runner 及捕獲回應離線重播確認，沒有另跑真模型。A 主責、權重 5，A 60%／C 30%／B 10%；[證據](artifacts/verification/S13_W08_CHECKS.json)。外發與公開展示仍待 W07／S17；P2 未完成。

## 用量快照
2026-09-30 使用者表示「有额度了，继续开始任务」；沒有提供百分比，餘額未知，不推算重置。沿用最新 Luna Max／GPT-6.1 Sol 分工規則。

## 更新記錄
2026-09-28（Asia/Hong_Kong）：S10-W02 實作、近期來源使用範圍定案及必要驗收準備；[證據](artifacts/verification/S10_W02_CHECKS.json)／[LOG-20260928-004](WORKLOG.md#log-20260928-004)。

S11-W02：真互動 ADK／向量引用／確認任務、背景 Runtime／重啟去重沿用 S16 分列證據。成長回答曾過度延伸來源，單改 prompt 仍未通過；Server 改呈現已核對片段，3 項必要 Runner 及擷取真回應的離線重播通過，沒有再呼叫模型。整合驗收中的摘要／成長工具分屬後續包，不把本 PR 寫成整個 P2 已可用。沿用 A 主責、權重 5，A 70%／C 20%／B 10%；[證據](artifacts/verification/S11_W02_CHECKS.json)。完整 Agent UI／真照護聯絡／公開部署仍按其範圍交付。

S12-W03 必要驗收通過，完成隨本包 PR 合併生效：復用 39 HTTP 中照片原圖／確認／隔離、單次真照片候選及配對備份／空庫還原證據。刪除原檔／queue 功能通過，舊腳本最終快照因 NULL 選集不一致失敗，限制如實保留；完整照片面板瀏覽器未驗。沒有新模型、通知或部署；[證據](artifacts/verification/S12_W03_CHECKS.json)。

S12-W04 必要驗收通過，完成隨本包 PR 合併生效；照片前置已隨 PR #63 合併。復用 022／023、私人来源保存／取得／隔離、39 HTTP 原文／明確確認及還原證據；原提取日期錯誤保留，修正版真提取通過。完整分享面板瀏覽器未驗，零新增模型或來源 GET；[證據](artifacts/verification/S12_W04_CHECKS.json)。

S12-W04 已接家長本人私人來源（名稱／URL／正文／日期／備註）及明確公開 HTML 取得；原文僅本人讀取，不入公共知識庫、不代登入付費來源，必要既有驗收已歸回本包。

S13-W07 必要驗收通過，完成隨本包 PR 合併生效。沿用 SQL 70 業務的 fallback／撤權／終態及 unknown 證據；一次真背景 Agent／Telegram 發送、本人收到及明確完成已核對。完成階段觸及原累計 80 次上限後停止，僅補剩餘清理，沒有新模型或訊息；原失敗與補清理分開保存。合成孩子／任務清理、測試綁定撤銷及原資料保留可核對；[證據](artifacts/verification/S13_W07_CHECKS.json)。公開 webhook、正常部署 worker 及 S17 交付仍待完成，P2 未完成。

S16 已接回全部正式功能包；實作與真聯絡使用的 `e0653d3` 相同，沒有為合併重跑測試。累計 11 Agent 運行／33 生成嘗試／10 embedding 嘗試／3 真通知；新聯絡 4 次生成的 token 細項未在該回報提供，保留已有已知用量，不當作完整帳單。UI 功能清單見 P2_UI_HANDOFF；公開部署及組員完整演示仍未完成。

P2 必要驗收及交付記錄已完成，結案隨 S17-W02 PR 合併生效。後續 Web 前端整合沿用 UI 功能與 API 清單；Firefox 全套相容性及各面板完整 E2E 未全驗，新前端未整合，不啟動 P3。
