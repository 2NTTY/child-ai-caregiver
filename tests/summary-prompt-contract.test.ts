import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadAgentPrompt, type AgentOutputMode, type PromptManifest } from "../server/agent-prompt.ts";
import { PRODUCT_AGENT_TOOL_CATALOG } from "../server/product-agent-capabilities.ts";

test("direct and capability-loaded memory prompts retain coverage, complete-batch and role provenance semantics", async () => {
  const manifest = JSON.parse(await readFile(new URL("../prompts/manifest.json", import.meta.url), "utf8")) as PromptManifest;
  const memoryRecipes = manifest.recipes.filter(recipe => recipe.additionalModules.includes("module.memory-maintenance"));
  assert.ok(memoryRecipes.some(recipe => recipe.id === "memory-refresh"));
  const interactive = manifest.recipes.find(recipe => recipe.id === "product-interactive");
  const memory = PRODUCT_AGENT_TOOL_CATALOG.groups.find(group => group.id === "memory_summary");
  assert.ok(interactive); assert.ok(memory);
  assert.ok(memory.toolNames.includes("stage_private_summary"));
  assert.ok(memory.promptModuleIds.includes("module.memory-maintenance"));
  const initial = await loadAgentPrompt(interactive.id, "tool_cycle", interactive.requiredInputs);
  assert.equal(initial.moduleIds.includes("module.memory-maintenance"), false);
  const compositions = [...memoryRecipes.map(recipe => ({ recipe, additionalModules: [] as readonly string[] })),
    { recipe: interactive, additionalModules: memory.promptModuleIds }];
  for (const { recipe, additionalModules } of compositions) {
    for (const mode of recipe.outputModes) {
      const inputs = [...new Set([...recipe.requiredInputs, ...(manifest.outputModeRequirements[mode] ?? [])])];
      const result = await loadAgentPrompt(recipe.id, mode as AgentOutputMode, inputs, additionalModules);
      assert.equal(result.moduleIds.filter(id => id === "module.memory-maintenance").length, 1);
      // Static assembly checks only; these do not claim real-model compliance.
      assert.match(result.text, /stage_private_summary 只傳 text。/u);
      assert.match(result.text, /isolated_batch 不帶入舊 summary，舊 cumulative 模式才結合舊摘要/u);
      assert.match(result.text, /staged:true／saved:false 只是等待 Server 校驗，不能說記憶已更新/u);
      assert.match(result.text, /Server 綁定覆蓋清單、游標與版本，不另添參數/u);
      assert.match(result.text, /不另添參數或把控制資料塞入摘要/u);
      assert.match(result.text, /其他模式只按當次 outputContract 處理/u);
      assert.match(result.text, /moreUncovered=true 表示有後續批次/u);
      assert.match(result.text, /本批原文齊全仍可整理，但不聲稱全史已涵蓋/u);
      assert.match(result.text, /指定來源缺失、Server 明示不完整或版本衝突時，保留缺口/u);
      assert.doesNotMatch(result.text, /輸出新摘要時必須帶回實際覆蓋到的最後消息游標/u);
      if (recipe.id === "product-interactive") {
        assert.match(result.text, /privateSummaryInput.messageIds/u);
        assert.match(result.text, /同次 uncoveredConversation/u);
        assert.match(result.text, /不要假設 privateSummaryInput 另帶正文/u);
        assert.match(result.text, /保留原文依據、適用時間及陳述／推測／確認的區分/u);
      }
    }
  }
});
