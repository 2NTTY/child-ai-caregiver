# STATUS

## 當前工作包
[S09-W01 — 私人聊天保存](PLAN.md#s09-w01)（P1；必要驗收及 review 通過，待 PR 合併後接 Ready 的 S11-W01）

## 狀態
使用者於 2026-09-23 指示恢復並持續推進 P1，Web UI 以功能為主，只做必要測試；昂貴／真服務驗收留待另行安排。S06-W01 已於 PR #18 合併（bea0388）；S09-W01 已完成私人聊天保存、授權 API 及必要本機 PostgreSQL 驗收，尚未接真 Gemini。P1 尚未完成。

## 產品現況
- Web 可登入、建立／切換孩子、保存／讀取文字記錄；S03 既有持久化、斷線草稿及隔離證據保留，不重跑等價驗收。
- S06 AI 預設關閉；狀態 API 只向登入者回報可用性。模型呼叫須經權限、UTC 每日持久配額、並發限制、逾時及有限重試。
- Server 新增聊天原文、孩子／擁有者／作者／角色及回覆關係；客戶端不能冒充模型作者。S09 合併後才進入 S11。
- 原有 Prompt Pack 0.1.1／[P1 提示詞](prompts/p1/README.md)、[視覺素材](assets/README.md)及[簡報](presentation/README.md)已合併，後續復用，不重新生成。

## 核查與限制
- S09 的 7 個聊天 API＋1 個 HTTP 接線單元情景、Server typecheck 通過；獲批准的 6 項本機資料庫檢查通過，見 [EV-S09-W01](artifacts/verification/S09_W01_CHECKS.json)。S06 的 22 個相關單元證據復用。
- 已驗證新增遷移、聊天原文／隔離、並發配額及新連線持久化；沒有把新連線當完整 Server 重啟。真 Vertex、部署 URL、加密／備份及組員試玩仍待驗收；未跑 E2E 或真模型。
- 既有 S03／S06 worktree 的忽略配置及合成測試資料保留，不以清空代替升級。

## 下一步
合併 S09-W01 後，由最新 master 的獨立 branch／worktree 開始 S11-W01，復用 P1 prompt 及 Vertex Skill，再推進 S05、S16、S17。P1 仍須真 Gemini、加密備份還原及組員從 URL 獨立試玩的證據；缺項不當作通過。

## 用量快照
最後使用者原值為 2026-09-22 19:12 的「5%」；沒有查詢或推算重置。本次使用者已明確要求恢復 P1，現時餘額未知；按有界工作包及 AGENTS 的 Luna Max／Sol 分工推進，沒有延續 Astra 例外。

## 更新記錄
2026-09-23（Asia/Hong_Kong）；[LOG-20260923-002](WORKLOG.md#log-20260923-002)。
