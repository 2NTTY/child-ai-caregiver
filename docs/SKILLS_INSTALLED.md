# Codex 非前端 Skills 安裝報告

核對日期：2026-10-26。這次只加入 **6 項倉庫級「專案適配版」**，不是原封不動安裝整套框架，也不是安裝到使用者電腦或全域 Codex。既有 skills 保持不變；產品程式、根 AGENTS、PLAN／STATUS、模型配置及部署均未修改。

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

### 固定來源與授權

- Superpowers **v7.0.1**：[`obra/superpowers@2ce8aa15d05bd57213e6f746f953aafb7ded7a8b`](https://github.com/obra/superpowers/tree/2ce8aa15d05bd57213e6f746f953aafb7ded7a8b)，MIT，Copyright (c) 2025 Jesse Vincent。
- Anthropic：[`anthropics/claude-plugins-official@58267944f92187b7d6a1c822165c96c81c864806`](https://github.com/anthropics/claude-plugins-official/tree/58267944f92187b7d6a1c822165c96c81c864806/plugins/claude-md-management/skills/claude-md-improver)，沿用該 plugin 的 Apache-2.0 LICENSE；沒有假設整個 marketplace 使用同一授權。
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

## 沒有加入

- **所有前端／設計 skills**；沒有新增前端 discovery 入口。
- **`security-threat-model`、`security-best-practices` 暫未安裝**：截至核對日，舊 [`openai/skills` README](https://github.com/openai/skills/blob/49f948faa9258a0c61caceaf225e179651397431/README.md) 已標 deprecated；新 `openai/plugins@0722921d5542fc593105c27bd52630babd8b8c2a` 沒有兩個同名獨立入口。新 Codex Security 內容另有工具／儲存工作流，不能假裝無縫替代；等待新舊對比後的選擇，未偷換成 scanner／plugin。
- 可選 ADK／Firebase／GCP／QA／CI 套件、額外 skills、hooks、MCP、plugin manifest、auto-updater、帳戶／權限／全域配置。倉庫原來已存在的同類技術 skills 不移除。
- 沒有執行上游腳本／套件 lifecycle、產品測試、真模型、家庭資料或正式服務操作。

## 已驗與未驗

安裝驗證只涵蓋本批文字與來源：來源原文和 license 的 Git blob SHA 對上固定 tree；6 個入口 metadata/name 合法且與目錄一致；相對參考存在；安裝檔案 hash 與 manifest 一致；保留原文的 patch 可重建適配結果；沒有新增可執行檔、symlink、hooks、MCP 或依賴 manifest；新增路徑沒有覆寫既有 skill；`git diff --check` 通過。

**未把以上當成 Codex runtime 已載入或行為驗收。** 沒有啟動額外模型驗證，沒有在使用者本機安裝，亦沒有因此宣稱產品測試／CI／合併通過。PR 的獨立 review 與遠端檢查依正常流程另行確認。

## 告訴 Codex 的簡短交接

同步包含這批變更的分支或已合併 commit，然後在下一個 Codex turn 使用。若當前環境未在 catalog 自動顯示 repo skills，可直接讀相應 `.agents/skills/<名稱>/SKILL.md`；不要另裝一套同名全域版本。

> 本倉庫新增 6 項非前端專案適配版 skills：brainstorming、systematic-debugging、test-driven-development、verification-before-completion、requesting-code-review、agents-md-improver。入口在 `.agents/skills/`，來源與差異見 `docs/SKILLS_INSTALLED.md`。它們補充方法，不覆蓋 AGENTS／SPEC／PLAN 或模型、驗收及授權限制。前端 skills 沒有安裝；兩項 OpenAI 安全 skills 暫未安裝。
