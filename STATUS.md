# STATUS

## 當前工作包
[S17-W01 — P1 試用交付](PLAN.md#s17-w01)（待驗收：技術驗收通過，待另一組員獨立試玩回報及最後 review／合併）。

## 現況
- **試用 URL：https://ex-machina.eu.org**。使用者指定根網域，A=35.241.127.20；DNS 由使用者設定。
- S05／PR #21、S16／PR #22 已合併；S17 在 `codex/s17-w01-p1-delivery`／草稿 PR #23，部署版本 `cc3dae4`。P1 尚未完成，不開始 P2。
- 本機隔離容器、公開 TLS／登入隔離／原文保存／API 重建持久化、Linux 密鑰權限、磁碟與 WAL、metadata ADC、實際 maintenance 加密備份／空庫還原均通過。[EV-S17-W01](artifacts/verification/S17_W01_CHECKS.json)
- 兩次 Gemini 驗收成功，合計 1,793 input／42 output tokens；cached metadata 不完整，沒有帳單或優惠餘額證據。AI 每人每日 5 次／全站 20 次，每請求僅 1 次嘗試、6,000 字元／512 output tokens。
- 雲端加密備份與恢復密鑰已分開存於工程外、當前 Windows 使用者專用 ACL 目錄；既有本機合成庫保持不變。未執行額外 E2E、全量回歸或 UI polish；Prompt Pack／美術沿用。

## 七天試用與限制
- 香港 e2-small／20 GiB pd-balanced／固定 IP；GCE 已設定 maxRunDuration=604800／STOP，預計 **2026-09-30 20:50:44 HKT** 停止。
- 初估七天固定費 US$5.28，流量／AI 另計；停機後保留 disk／IP 仍約 US$5.85／月。不是硬性金額上限，不自行續期。
- [交付及操作](docs/P1_DELIVERY.md)／[組員試玩指引](docs/P1_TRIAL.md)。組員試玩結果未收到，不以自動驗收代填。

## 下一步
收取另一組員的瀏覽器與核心流程實際回報，修復必要問題；全部門檻通過後，完成 S17 review／PR #23 合併及 P1 結案。

## 用量快照
最後使用者原值為 2026-09-22 19:12 的「5%」；使用者已恢復 P1，現時餘額未知。沒有查詢或推算重置，沿用 Luna Max／Sol 規則。

## 更新記錄
2026-09-23（Asia/Hong_Kong）；[LOG-20260923-010](WORKLOG.md#log-20260923-010)。
