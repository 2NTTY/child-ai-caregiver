# STATUS

## 當前階段
**P1 基礎成品驗收完成**；[S17-W01](PLAN.md#s17-w01) 結案隨 [PR #23](https://github.com/2NTTY/child-ai-caregiver/pull/23) 合併 master 生效。P2 未開始。

## 現況
- **試用 URL：https://ex-machina.eu.org**。使用者指定根網域，DNS 由使用者設定；執行版本 `d654b8f`，其後結案修改僅涉及文件。
- P1 十個工作包的實作及必要驗收齊備；前置包均已合併。共享 Prompt Pack／美術沿用，沒有重做或 UI polish。
- 本機隔離容器、公開 TLS／登入隔離／原文保存／API 重建持久化、Linux 密鑰權限、磁碟與 WAL、metadata ADC、maintenance 加密備份／空庫還原通過。[EV-S16-W01](artifacts/verification/S16_W01_CHECKS.json)／[EV-S17-W01](artifacts/verification/S17_W01_CHECKS.json)
- Firefox 試玩曾回報可能閒置後呈現登出及限流；代理來源與未確認會話 UI 已修正。39 項針對性單元檢查、typecheck、建置及獲准的 15 次 HTTPS 讀取通過；使用者修正版覆核回覆「没问题了」，人工試玩門檻通過。未捏造原始 HTTP trace 或逐步時間。
- 本包兩次 Gemini 驗收成功，合計 1,793 input／42 output tokens；cached metadata 不完整，沒有帳單或優惠餘額證據。AI 每人每日 5 次／全站 20 次，每請求僅 1 次嘗試、6,000 字元／512 output tokens。
- 加密備份與恢復密鑰分開存於工程外、當前 Windows 使用者專用 ACL 目錄；既有本機合成庫保留。沒有額外 E2E、全量回歸或結案模型呼叫。

## 七天試用與限制
- 香港 e2-small／20 GiB pd-balanced／固定 IP；GCE 已設定 maxRunDuration=604800／STOP，預計 **2026-09-30 20:50:44 HKT** 停止。
- 初估七天固定費 US$5.28，流量／AI 另計；停機後保留 disk／IP 仍約 US$5.85／月。不是硬性金額上限，不自行續期。
- [交付及操作](docs/P1_DELIVERY.md)／[組員試玩指引](docs/P1_TRIAL.md)。已收到使用者實際試玩確認；只適用 P1 合成資料範圍。

## 下一步
P1 結案後停在本階段。下一輪按 PLAN 依賴選擇 P2 Ready 工作包；不在本輪自動開始 P2。七天試用到期後，續期或釋放資源均須使用者決定。

## 用量快照
最後使用者原值為 2026-09-22 19:12 的「5%」；使用者已恢復 P1，現時餘額未知。沒有查詢或推算重置，沿用 Luna Max／Sol 規則。

## 更新記錄
2026-09-23（Asia/Hong_Kong）；[LOG-20260923-012](WORKLOG.md#log-20260923-012)。
