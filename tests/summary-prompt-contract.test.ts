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
      assert.match(result.text, /當提供 stage_private_summary 時，只傳 text 摘要正文/u);
      assert.match(result.text, /覆蓋清單、游標及版本由 Server 綁定，不新增參數/u);
      assert.match(result.text, /不把這些控制資料塞進摘要/u);
      assert.match(result.text, /其他模式只在當次 outputContract 要求時回覆精確覆蓋資訊/u);
      assert.match(result.text, /moreUncovered=true 只表示仍有後續批次/u);
      assert.match(result.text, /本批指定的全部原訊息與必要前一摘要已取得時，仍可整理本批/u);
      assert.match(result.text, /指定批次缺原訊息、覆蓋倒退或 Server 明示本批不完整時才停止更新/u);
      assert.doesNotMatch(result.text, /輸出新摘要時必須帶回實際覆蓋到的最後消息游標/u);
      if (recipe.id === "product-interactive") {
        assert.match(result.text, /privateSummaryInput.messageIds/u);
        assert.match(result.text, /同次 uncoveredConversation/u);
        assert.match(result.text, /不能假設 privateSummaryInput 另帶正文/u);
        assert.match(result.text, /不能把模型文字當使用者原話/u);
      }
    }
  }
});
