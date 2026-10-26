# Codex 非前端 Skills 安裝報告

核對日期：2026-10-26。這批共加入 **8 項倉庫級「專案適配版」**，不是原封不動安裝整套框架，也不是安裝到使用者電腦或全域 Codex。後加的兩項安全 skills 採用「保留安全編碼庫＋新版威脅建模方法」；先前 6 項內容原樣保留。產品程式、根 AGENTS、PLAN／STATUS、模型配置及部署均未修改。

## 已加入甚麼

全部入口位於 `.agents/skills/<名稱>/SKILL.md`：

| 名稱 | 用途 | 來源 |
|---|---|---|
| `brainstorming` | 釐清有實質不確定性的需求、選擇方案；不重問已確認事項 | Superpowers |
| `systematic-debugging` | 按證據追根因、形成假設、最小修正及驗證 | Superpowers |
| `test-driven-development` | 必要的針對性測試採 red → green → refactor | Superpowers |
| `verification-before-completion` | 完成／修好／通過的聲明必須對應精確版本與證據 | Superpowers |
| `requesting-code-review` | 準備清楚的 review 範圍、要求、版本及驗證交接 | Superpowers |
| `agents-md-improver` | 審核 AGENTS 品質、先報告再提出局部修改；安裝不會自動改規則 | Anthropic `claude-md-improver` 適配 |
| `security-best-practices` | 按實際技術棧查安全編碼規則、檢查證據及校準風險 | OpenAI 舊安全編碼庫適配，保留全部 10 份參考 |
| `security-threat-model` | 追蹤實際資料流、消費端、有效權限及信任邊界，區分假設與已驗漏洞 | OpenAI 新 Codex Security 方法的純文字適配 |

### 固定來源與授權

- Superpowers **v7.0.1**：[`obra/superpowers@2ce8aa15d05bd57213e6f746f953aafb7ded7a8b`](https://github.com/obra/superpowers/tree/2ce8aa15d05bd57213e6f746f953aafb7ded7a8b)，MIT，Copyright (c) 2025 Jesse Vincent。
- Anthropic：[`anthropics/claude-plugins-official@58267944f92187b7d6a1c822165c96c81c864806`](https://github.com/anthropics/claude-plugins-official/tree/58267944f92187b7d6a1c822165c96c81c864806/plugins/claude-md-management/skills/claude-md-improver)，沿用該 plugin 的 Apache-2.0 LICENSE；沒有假設整個 marketplace 使用同一授權。
- 安全編碼庫：[`openai/skills@49f948faa9258a0c61caceaf225e179651397431`](https://github.com/openai/skills/tree/49f948faa9258a0c61caceaf225e179651397431/skills/.curated/security-best-practices)，沿用該 skill 的 Apache-2.0 LICENSE。來源倉庫已 deprecated，這是固定版本的編碼基線，**不是最新 CVE 資料庫**。
- 威脅建模：[`openai/codex-security@8ed8d9dffc766343c8534601286dc5980afcb1c8`](https://github.com/openai/codex-security/tree/8ed8d9dffc766343c8534601286dc5980afcb1c8/plugins/codex-security)，Apache-2.0；只取 `skills/threat-model/SKILL.md` 及 `references/threat-model.md` 的方法。選用核對日較新的 canonical main 固定 commit，不沿用較舊 plugin catalog 0.1.32；沒有安裝整個 plugin。
- 每項附完整 `LICENSE`、`UPSTREAM.md`、逐項 `UPSTREAM.patch`；選用來源原文以 `upstream/*.txt` 原樣保留，**只供追溯，不是有效指令**。精確來源／安裝後 SHA-256、來源 Git blob SHA、略過檔案見 [manifest](SKILLS_INSTALLED.json)。沒有自動更新。

## 為何需要專案適配

核心方法保留，適配限於現行 AGENTS、授權、工具與範圍相容：

- 不強制安裝 `writing-plans`、`executing-plans` 或整套 Superpowers；用既有 PLAN／SPEC 工作流，不建立第二套計劃目錄。
- Brainstorming 的視覺 companion、伺服器及腳本不加入；前端技能仍只供 dot 使用。
- TDD 保留先確認預期失敗再修正及通過；移除強制全套測試、刪除既有程式重來等與項目規則衝突的指令。
- Debugging 不輸出私密 payload／環境密鑰，不附會簽署操作；省略會刪路徑並反覆跑測試的 `find-polluter.sh`。失敗停批／兩輪上報依 AGENTS，不以框架延長重試。
- Verification 保留證據先於聲明；有效既有證據可復用，不為每次回覆機械重跑，亦不把靜態核對當 runtime 通過。
- Review 保留必要獨立覆核與主模型最終驗收；不強制每個小任務新增子代理，不改模型／角色／額度。技術 review 不是 GitHub approval、CI 或 merge 授權的替代。
- Anthropic 的 audit → report → proposed diff → authorized edit 次序保留，改為倉庫 `AGENTS.md`，移除 Claude 專用工具／快捷鍵／全域設定假設；不自動審改專案規則。
- 安全編碼庫保留 Go、Express、通用瀏覽器、jQuery、Next.js、React、Vue、Django、FastAPI、Flask 共 10 份參考，按需讀取。逐份標明固定版本、適用範圍及風險校準：規則優先級不等於漏洞嚴重度，須核對攻擊者控制、可達性、影響及有效保護；版本／安全資訊有變或不確定時，查現行官方文件。瀏覽器／React 內容只談安全，**不是前端設計 skill**，不增加前端修改權限。
- 修正舊 React `REACT-REDIRECT-001` 的相對路徑 regex：原式可接受 `//example.invalid`。適配版改用 URL 解析、protocol／origin 核對及具體流程的目的地 allowlist，附同一範例的離線合成回歸；不是產品漏洞發現或通用 OAuth validator。
- 新威脅建模保留消費端、配置優先次序、mount、有效身份及 caller／worker／host 權限追蹤，要求核實 `path:line`、區分假設／已驗漏洞／信心與嚴重度，列出覆蓋缺口。新上下文審核按複雜度及既有代理額度安排，不強迫每次開代理或湊固定威脅數；倉庫內容只是分析資料，不能變成命令權限。
- 兩項安全 skill 都不更改 Astra xhigh 指導執筆規則、真後端／真模型限制、授權及驗收門檻。純分析不會自行執行產品程式、掃描、修補或發布。

## 沒有加入

- **所有前端／設計 skills**；沒有新增前端 discovery 入口。安全編碼庫中的 browser／React 安全參考不屬設計工具。
- **整套 Codex Security plugin**：不含 scanner、scripts／binaries、服務／daemon、model-worker pool、artifact MCP、shared cache／checkpoint 寫入、認證、網絡或模型設定。`security-threat-model` 是專案名稱，並非宣稱把新版 plugin 原樣或無縫裝入舊入口。
- 可選 ADK／Firebase／GCP／QA／CI 套件、額外 skills、hooks、MCP、plugin manifest、auto-updater、帳戶／權限／全域配置。倉庫原來已存在的同類技術 skills 不移除。
- 沒有執行上游腳本／套件 lifecycle、產品測試、真模型、家庭資料或正式服務操作。

## 已驗與未驗

安裝驗證只涵蓋本批文字與來源：28 份來源原文和 8 份 license 的 Git blob SHA 對上固定 tree；8 個入口 metadata/name 合法且與目錄一致；相對參考存在；安裝檔案 hash 與 manifest 一致；8 組 patch 可從保留原文精確重建適配結果；沒有新增可執行檔、symlink、hooks、MCP 或依賴 manifest；新增路徑沒有覆寫原有 skill，先前 6 項保持逐 byte 相同。

有效適配文件與報告的 `git diff --check` 通過。完整檢查仍會指出上游原文自帶的尾隨空白及精確 patch 的對應刪除行；這些只存在非入口的 `upstream/*.txt`／`UPSTREAM.patch`，為保留來源 hash 原樣保留，沒有更改 Git whitespace 設定或 `.gitattributes` 隱藏警告。沒有把完整檢查說成零警告。

React 回歸只在本機 Node 對合成字串操作：直接從原文擷取 regex，確認它錯誤接受外部 protocol-relative URL；再直接擷取適配文件中的函式及測試，18 個允許／拒絕案例通過。沒有瀏覽器導航、網絡請求或真站測試；不是產品驗收。

**未把以上當成 Codex runtime 已載入或行為驗收。** 沒有啟動額外模型驗證，沒有在使用者本機安裝，亦沒有因此宣稱產品測試／CI／合併通過。PR 的獨立 review 與遠端檢查依正常流程另行確認。

## 告訴 Codex 的簡短交接

同步包含這批變更的分支或已合併 commit，然後在下一個 Codex turn 使用。若當前環境未在 catalog 自動顯示 repo skills，可直接讀相應 `.agents/skills/<名稱>/SKILL.md`；不要另裝一套同名全域版本。

> 本倉庫新增 8 項非前端設計的專案適配版 skills：brainstorming、systematic-debugging、test-driven-development、verification-before-completion、requesting-code-review、agents-md-improver、security-best-practices、security-threat-model。入口在 `.agents/skills/`，來源與差異見 `docs/SKILLS_INSTALLED.md`。安全部分保留舊編碼庫並採用新版威脅建模方法，不是整套 Codex Security plugin。它們補充方法，不覆蓋 AGENTS／SPEC／PLAN 或模型、驗收及授權限制。前端設計 skills 沒有安裝，也沒有改動電腦／全域 Codex runtime。
