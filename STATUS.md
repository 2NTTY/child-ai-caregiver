# STATUS

## 當前工作包
[S05-W01 — Server 加密、必要刪除及最小備份](PLAN.md#s05-w01)（P1；已實作，待必要本機驗收，不合併、不解鎖 S16）。

## 狀態
S06-W01／PR #18、S09-W01／PR #19、S11-W01／PR #20 已合併；最新穩定 master 為 e2027d5。S11 的三次真 Gemini 合成驗收通過。S05 在獨立 `codex/s05-w01-encrypted-storage` 分支完成程式碼及輕量 review；使用者明確選擇「先保留待驗收」，因此沒有執行資料加密升級、建立密鑰、備份／還原或刪除驗收。P1 尚未完成。

## 產品及分支現況
- master 可登入、保存照護記錄及私人聊天，接真 Gemini／近期上下文／用量；AI 預設關閉，部署前仍須完成資料保護。
- S05 分支新增 AES-256-GCM 正文保護、交易式既有資料升級、工程外獨立 key、加密 PostgreSQL 備份／空庫還原，以及二次確認的 owner 刪除入口。詳見 [P1 儲存操作](docs/P1_STORAGE.md)。
- 原 Prompt Pack／P1 prompt、美術及簡報已復用；沒有重做素材或 UI polish。

## 核查與限制
- S05 crypto 3、record API／store 17、刪除 client 5 個相關情景通過；Sol 另報告原 client／chat 及刪除相關 27 項通過，重疊項不累計為額外情景。双 TypeScript、腳本語法、Skill frontmatter 及 diff 檢查通過。
- [EV-S05-W01](artifacts/verification/S05_W01_CHECKS.json) 明確保留真 PostgreSQL 遷移、原文一致性、刪除 cascade、加密備份還原與恢復登入為未執行。沒有新 E2E／全量回歸或模型呼叫。
- 既有資料、忽略配置及憑據保留；沒有清空資料庫、改全局憑據環境變數或生成新 storage／backup key。S11 已批准的 Google 登入／Vertex API 保持可接續。

## 下一步
取得 S05 本機驗收批准後，依 `scripts/verify-storage.mjs --approved-local-encryption` 準備工程外私密 key，驗證既有合成資料升級、獨立備份／空庫還原及只刪新建合成孩子；結果通過後更新證據、review／合併，才開始 S16-W01，再交付 S17 URL 及組員獨立試玩。當前不重問已延後的驗收。

## 用量快照
最後使用者原值為 2026-09-22 19:12 的「5%」；沒有查詢或推算重置。使用者已恢復 P1，現時餘額未知；沿用 Luna Max／Sol 規則，不延續 Astra 例外。

## 更新記錄
2026-09-23（Asia/Hong_Kong）；[LOG-20260923-004](WORKLOG.md#log-20260923-004)。
