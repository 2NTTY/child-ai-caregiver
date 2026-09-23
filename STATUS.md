# STATUS

## 當前工作包
[S17-W01 — P1 試用交付](PLAN.md#s17-w01)（進行中；部署檔案及靜態 review 已完成，待容器驗收／雲端資源批准）。

## 狀態
S05／PR #21 及 S16／PR #22 已合併；基線 master 為 2b55eb0。S05 七項本機加密／備份還原、S16 十七項 HTTP／Server 重啟及最新 Web 匯出通過。S17 使用獨立 `codex/s17-w01-p1-delivery` 分支；P1 尚未完成。

## 已準備交付
- [P1 雲端交付方案](docs/P1_DELIVERY.md)：一台香港區 GCP VM、私有 PostgreSQL、Caddy HTTPS、非 root API、獨立維護容器、新工程外密鑰與七天停止方案。
- 使用者提供 `ex-machina.eu.org`；採 `yuban.ex-machina.eu.org` 子網域，DNS 尚未修改。原 Prompt Pack／P1 prompt 及視覺資產沿用，沒有 UI polish。
- [組員試玩指引](docs/P1_TRIAL.md) 已準備，但尚無可用 URL 或人工結果。新雲端試用庫不搬移／清空本機已加密合成資料。
- 首次部署官方研究压縮為一份短 Skill；固定 Caddy 2.11.4 並保存原 Apache-2.0 license。API 不掛 Docker socket／backup key。

## 核查與限制
- [EV-S17-W01](artifacts/verification/S17_W01_CHECKS.json)：YAML／Skill frontmatter、Python 語法、Compose 設定、port／secret／network 關係、Docker COPY 來源、license hash 及 diff 檢查通過。
- review 修正了 root-only server.env 必須由 sudo/root Compose 讀取的操作說明，維持私密權限。
- 尚未 build／run 容器、啟用 Compute API、建立資源、改 DNS 或呼叫新模型；實際 image digest、HTTPS、部署磁碟／WAL、metadata ADC 及備份維護仍需驗收。
- 初步固定費約 US$23／月、七天約 US$5.28，流量與 Gemini 另計；停止 VM 後磁碟／固定 IP 仍有費用。不是帳單或硬性金額上限，未核實優惠餘額。

## 下一步
批准具體範圍後先完成本機隔離容器必要驗收，再建立已審閱的 GCP 試用資源；取得 IP 後由使用者設定子網域 A 記錄。實際環境通過並收到組員獨立試玩回報後，才完成 S17 review／合併及 P1 結案。

## 用量快照
最後使用者原值為 2026-09-22 19:12 的「5%」；沒有查詢或推算重置。使用者已恢復 P1，現時餘額未知；沿用 Luna Max／Sol 規則，不延續 Astra 例外。

## 更新記錄
2026-09-23（Asia/Hong_Kong）；[LOG-20260923-007](WORKLOG.md#log-20260923-007)。
