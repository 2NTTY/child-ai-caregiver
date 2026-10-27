# 原版來源與相容差異

原版：[Anthropic claude-md-improver](https://github.com/anthropics/claude-plugins-official/tree/58267944f92187b7d6a1c822165c96c81c864806/plugins/claude-md-management/skills/claude-md-improver)，Apache-2.0。

由 Codex 官方 skill-installer 安裝原目錄及全部三份 references，再作 CLAUDE／Codex 名稱、工具、路徑及規範檔載入語義的最小修改。評分、等級、五階段、模板及先報告再確認流程均保留。完整差異見 [UPSTREAM.patch](UPSTREAM.patch)，亦包含同來源命令轉成 revise-agents-md 的差異。

安裝方式、必要依賴、原版已知問題及實際驗證見 [安裝紀錄](../../../docs/SKILLS_INSTALLED.md)；固定來源及 hash 見 [manifest](../../../docs/SKILLS_INSTALLED.json)。此文件只說明來源，不另立使用規則。
