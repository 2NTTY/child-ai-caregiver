# STATUS

## 當前階段
**P1 基礎成品驗收完成；依使用者 2026-09-28 指示恢復 P2，S13-W01 已隨 PR #47 合併；S13-W04 持久 worker 必要驗收通過，完成隨本包 PR 合併生效**。P1 [S17-W01](PLAN.md#s17-w01) 結案隨 [PR #23](https://github.com/2NTTY/child-ai-caregiver/pull/23) 合併生效；[S11-W03](PLAN.md#s11-w03) 已隨 [PR #30](https://github.com/2NTTY/child-ai-caregiver/pull/30) 合併；S06-W02 已隨 [PR #31](https://github.com/2NTTY/child-ai-caregiver/pull/31) 合併；S05-W02 已隨 [PR #32](https://github.com/2NTTY/child-ai-caregiver/pull/32) 合併。S07-W03 已隨 [PR #36](https://github.com/2NTTY/child-ai-caregiver/pull/36) 合併；S09-W02 必要驗收通過，完成隨 [PR #34](https://github.com/2NTTY/child-ai-caregiver/pull/34) 合併生效。

## 現況
- **試用 URL：https://ex-machina.eu.org**。使用者指定根網域，DNS 由使用者設定；執行版本 `d654b8f`，其後結案修改僅涉及文件。
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
- 香港 e2-small／20 GiB pd-balanced／固定 IP；GCE 已設定 maxRunDuration=604800／STOP，預計 **2026-09-30 20:50:44 HKT** 停止。
- 初估七天固定費 US$5.28，流量／AI 另計；停機後保留 disk／IP 仍約 US$5.85／月。不是硬性金額上限，不自行續期。
- [交付及操作](docs/P1_DELIVERY.md)／[組員試玩指引](docs/P1_TRIAL.md)。已收到使用者實際試玩確認；只適用 P1 合成資料範圍。

## 下一步
S13-W01 已交付手動任務／發生實例、版本／終態／衝突、確定性提醒資格及功能表單；27 項相關輕量檢查、兩份 typecheck、Web export 及獲准的 11 組／47 次 HTTP 通過，原有 33 筆業務資料不變。S13-W01 已隨 [PR #47](https://github.com/2NTTY/child-ai-caregiver/pull/47) 合併；S13-W04 已在 master `a591f87` 基線接上 pg-boss／原子入列、重啟去重、站內提醒及暫停還原；27 項相關輕量檢查、兩份 typecheck、腳本語法及必要靜態檢查通過。獲批 PostgreSQL 驗收經同範圍補驗通過：累計 12 次 HTTP／72 次業務呼叫，hard-kill 恢復 68.895 秒，加密備份／空庫還原暫停及原資料保留有證據，[範圍及證據](artifacts/verification/S13_W04_CHECKS.json)；完成隨本包 PR 合併生效；尚未驗真通知。S16-W05 已 Ready，仍未開始；S10-W02 須等待 S13-W04。沿用既有 Prompt Pack／美術及獨立前端預覽，維護 UI 功能／API 對接清單，不在本包重設 UI。P2 未完成，現網仍是 P1；新真服務／integration 驗收另列範圍批准，七天試用不自行續期。

## 用量快照
最後使用者原值為 2026-09-22 19:12 的「5%」；使用者已恢復 P2，現時餘額未知。沒有查詢或推算重置，沿用 Luna Max／Sol 規則。

## 更新記錄
2026-09-28（Asia/Hong_Kong）：S13-W04 必要驗收通過及交付準備；[證據](artifacts/verification/S13_W04_CHECKS.json)／[LOG-20260928-003](WORKLOG.md#log-20260928-003)。
