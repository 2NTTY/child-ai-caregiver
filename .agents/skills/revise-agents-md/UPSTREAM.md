# 原版來源與相容差異

原版：[Anthropic revise-claude-md 命令](https://github.com/anthropics/claude-plugins-official/blob/58267944f92187b7d6a1c822165c96c81c864806/plugins/claude-md-management/commands/revise-claude-md.md)，Apache-2.0。

將原 slash command 包成 Codex 可明確呼叫的 Skill；新增 name 及原生 invocation metadata，僅替換規範檔／工具／路徑差異。保留反思、定位、草擬、顯示變更、獲准後套用五步。

完整差異見 [同批 patch](../agents-md-improver/UPSTREAM.patch)，詳細來源與驗證見 [安裝紀錄](../../../docs/SKILLS_INSTALLED.md)。
