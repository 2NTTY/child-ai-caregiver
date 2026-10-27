# 非前端 Skills 安裝紀錄

2026-10-26 重新從原作者及官方來源核對。PR #331 的專案適配版已先由 #332 撤回（`dac29144db9f2e810013ba6c20e7aa86e25e48a4`）；本紀錄不沿用其驗證結論。

## 已安裝及範圍

| 項目 | 位置與安裝方式 | 固定來源 |
|---|---|---|
| Superpowers 7.0.1 | 使用者原生插件：`$CODEX_HOME/plugins/cache/openai-curated-remote/superpowers/7.0.1`；`codex plugin add superpowers@openai-curated-remote --json` | [obra/superpowers](https://github.com/obra/superpowers/tree/2ce8aa15d05bd57213e6f746f953aafb7ded7a8b)；MIT |
| AGENTS 規範檢查 | [agents-md-improver](../.agents/skills/agents-md-improver/SKILL.md)；官方 skill-installer 指定 `--dest .agents/skills`、固定 ref 及 `--name agents-md-improver` | [Anthropic claude-md-management](https://github.com/anthropics/claude-plugins-official/tree/58267944f92187b7d6a1c822165c96c81c864806/plugins/claude-md-management)，插件 1.0.0；Apache-2.0 |
| 本輪經驗整理 | [revise-agents-md](../.agents/skills/revise-agents-md/SKILL.md)；同一 Anthropic `/revise-claude-md` 命令作最小 Codex Skill 包裝，明確呼叫使用 | 同上，未另寫整理方法 |
| 安全編碼庫 | [security-best-practices](../.agents/skills/security-best-practices/SKILL.md)；官方 skill-installer、專案安裝 | [openai/skills](https://github.com/openai/skills/tree/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/security-best-practices)；Apache-2.0 |
| 新版威脅建模 | 使用者原生 Codex Security 0.1.32 插件：`$CODEX_HOME/plugins/cache/openai-curated-remote/codex-security/0.1.32`；`codex plugin add codex-security@openai-curated-remote --json` | [官方分發套件](https://github.com/openai/plugins/tree/0722921d5542fc593105c27bd52630babd8b8c2a/plugins/codex-security)，依其原版授權標示；使用 `threat-model` Skill |

使用者插件亦可供其他專案使用；三個專案 Skills 隨本倉庫保存，沒有另裝同名使用者 Skills。其他協作者仍須在自己的 Codex 安裝兩個插件；拉取倉庫不會替其啟用插件。未安裝前端設計 Skills，也未更改前端實驗分支。

Superpowers 保留整套十五項 Skills：指定的 brainstorming、systematic-debugging、test-driven-development、verification-before-completion、requesting-code-review，以及 using-superpowers、writing-plans、executing-plans、using-git-worktrees、subagent-driven-development、dispatching-parallel-agents、receiving-code-review、finishing-a-development-branch、writing-skills、diagnosing-superpowers。視覺輔助器、review 範本、腳本及原作者參考資料均保留；本次沒有啟動其流程。

Codex Security 保留完整插件、Windows launcher、原生模組、MCP、artifact storage 及十五項 Skills。安裝不會自動執行掃描。`openai/skills` 已標示 deprecated；此處依需求保留其原版安全編碼庫，威脅建模改用正式插件。另核對的 [openai/codex-security 原始碼](https://github.com/openai/codex-security/tree/8ed8d9dffc766343c8534601286dc5980afcb1c8) manifest 為 0.1.95，並非本次安裝版本，也沒有把未建置的原始碼當成插件安裝。

## 僅有的相容修改

Superpowers、安全編碼庫及 Security 插件沒有本專案修改。官方分發本身的包裝差異另記於下方，不冒稱由本專案製作。

Anthropic 的完整差異見 [UPSTREAM.patch](../.agents/skills/agents-md-improver/UPSTREAM.patch)：

1. `CLAUDE.md`／Claude Code／Claude 改為 `AGENTS.md`／Codex；保留全部五個階段、評分、等級、模板及先報告再確認的流程。
2. 移除 Codex 不執行的 Claude `tools`／`allowed-tools` metadata；以 `exec_command`、Git Bash 及 `apply_patch` 對應讀取、搜尋和修改。
3. 查找 AGENTS.md／AGENTS.override.md，改正 CODEX_HOME 路徑及逐目錄載入語義。明示 override 會取代同層檔案，不能當作 Claude 私人增補檔。
4. Claude `#` 快捷鍵改為明確呼叫 `$revise-agents-md`；原 slash command 加必要的 Skill 名稱及 `allow_implicit_invocation: false`，保留其需主動呼叫的性質。

沒有加入安全、成本、測試次數或專案工作習慣限制，沒有修改任何 AGENTS.md。參考 [Codex 規範檔載入](https://learn.chatgpt.com/docs/agent-configuration/agents-md)及[原生 Skills 安裝](https://learn.chatgpt.com/docs/build-skills)。

## 依賴與實際驗證

- 使用 Codex CLI `0.163.0-alpha.11.2` 的原生插件管理及 bundled 官方 skill-installer；沒有另寫安裝器。
- 已核 Node 24.19.0、Python 3.12.14、Git Bash 5.2.37、Git 2.51.2 及 rg。Git Bash 的既有 PATH 使用 Node 24.11.0；Security 沿原版 Windows launcher 的 runtime 搜尋次序啟動。沒有新增 runtime、帳戶或權限。
- Git Bash 在受限 shell 首次啟動被 Windows sandbox 拒絕；相同命令在已授權的 shell 正常取得既有依賴，未修改 sandbox 或系統政策。
- Superpowers 的 **84 個原作者 Skill／資源檔逐檔 Git blob hash 一致**；官方分發另加十五份 `agents/openai.yaml`，原文未變。沒有以較舊的 `openai/plugins` Superpowers 副本代替 v7.0.1。
- 安全編碼庫 **13 檔完全一致**；Anthropic installer 原始輸入 **4 檔完全一致**，再套用可見相容差異。評分仍為 20／20／15／15／15／15，共 100 分。
- Security 分發的 142 個來源檔均存在。除官方目錄的兩項 metadata 差異外，**140 檔完全一致**：`.app.json` 使用目錄的 Atlassian app ID，manifest 的 repository URL 使用內部來源標示；另有目錄自帶 `integrity.json`。未改動這些檔案或連接 Atlassian。
- `codex plugin list --json` 已確認兩插件 installed／enabled；Codex app-server `plugin/read` 真正列出兩插件各十五項 enabled Skills，`skills/list` 發現三個 repo Skills且無解析錯誤。
- Security 原版 Windows launcher 已完成 MCP `initialize`／`tools/list`，取得 47 個工具，包含 artifact 保存／讀取。服務回報內部版本 `0.1.160`，與插件 manifest 0.1.32 分開記錄；沒有呼叫任何業務工具、掃描或模型。
- GitHub／Linear／Atlassian 是插件的可選整合，不是本次新連接的必要依賴。沒有變更既有連接或授權。

精確 hash、來源及驗證狀態見 [機器可讀紀錄](SKILLS_INSTALLED.json)。當前桌面對話已載入的舊 Skill 清單不代表新版本；下輪重新發現，必要時開新對話。已驗證的是安裝、資源、發現及 MCP 啟動，**沒有宣稱原作者所有工作流、掃描品質、視覺輔助器或子代理流程已實跑**。

## 保留的原版問題／差異

- 全包 `git diff --check` 回報安全編碼庫五處原版行尾空白（Express 379、general frontend 185、React 980／982、Django 644）；已與上游逐檔一致性核對，保留原樣。相容修改及本批文件另作 whitespace 核對，不將全包結果寫成通過。
- 安全編碼庫 `REACT-REDIRECT-001` 的 `/^\/[^\s]*$/` 範例會接受 `//example.invalid`，不是可靠的同源網址判斷。原文保留，未偷偷修補。
- Superpowers 的 Codex 參考表稱 full-history fork 可帶模型／effort override；本次 host 的實際工具契約只允許 isolated fork 使用該 override。原作者本身要求以實際工具清單為準；此處記錄差異，不改寫原方法或代改代理配置。
- 未跑產品測試、安全掃描、額外模型、帳戶連接或真服務操作。安裝成功不等於這些操作獲授權或已驗證。
