# STATUS

## 當前階段
**P1 基礎成品驗收完成；P2 開發進行中**。P1 [S17-W01](PLAN.md#s17-w01) 結案隨 [PR #23](https://github.com/2NTTY/child-ai-caregiver/pull/23) 合併生效；[S11-W03](PLAN.md#s11-w03) 已隨 [PR #30](https://github.com/2NTTY/child-ai-caregiver/pull/30) 合併；S06-W02 已隨 [PR #31](https://github.com/2NTTY/child-ai-caregiver/pull/31) 合併；S05-W02 已通過必要驗收，完成隨本包 PR 合併生效。

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

## 七天試用與限制
- 香港 e2-small／20 GiB pd-balanced／固定 IP；GCE 已設定 maxRunDuration=604800／STOP，預計 **2026-09-30 20:50:44 HKT** 停止。
- 初估七天固定費 US$5.28，流量／AI 另計；停機後保留 disk／IP 仍約 US$5.85／月。不是硬性金額上限，不自行續期。
- [交付及操作](docs/P1_DELIVERY.md)／[組員試玩指引](docs/P1_TRIAL.md)。已收到使用者實際試玩確認；只適用 P1 合成資料範圍。

## 下一步
[S05-W02](PLAN.md#s05-w02) review／PR 合併後，接續 [S09-W02](PLAN.md#s09-w02) 長期記憶與話題狀態；[S07-W03](PLAN.md#s07-w03) 同時解鎖。[S10-W01](PLAN.md#s10-w01) 亦已 Ready，依工作包逐一推進，前置驗收並合併後才解鎖依賴包。指導／計劃／AI 提示詞由主模型親自處理。真服務及高成本驗收先列明範圍及成本待批准；七天試用不自行續期。

## 用量快照
最後使用者原值為 2026-09-22 19:12 的「5%」；使用者已恢復 P1，現時餘額未知。沒有查詢或推算重置，沿用 Luna Max／Sol 規則。

## 更新記錄
2026-09-24（Asia/Hong_Kong）；[LOG-20260924-007](WORKLOG.md#log-20260924-007)。
