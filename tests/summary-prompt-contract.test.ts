import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadAgentPrompt, type AgentOutputMode, type PromptManifest } from "../server/agent-prompt.ts";

test("every memory recipe retains contract-specific coverage and complete-batch semantics", async () => {
  const manifest = JSON.parse(await readFile(new URL("../prompts/manifest.json", import.meta.url), "utf8")) as PromptManifest;
  const memoryRecipes = manifest.recipes.filter(recipe => recipe.additionalModules.includes("module.memory-maintenance"));
  assert.deepEqual(memoryRecipes.map(recipe => recipe.id).sort(), ["memory-refresh", "product-interactive"]);
  for (const recipe of memoryRecipes) {
    for (const mode of recipe.outputModes) {
      const inputs = [...new Set([...recipe.requiredInputs, ...(manifest.outputModeRequirements[mode] ?? [])])];
      const result = await loadAgentPrompt(recipe.id, mode as AgentOutputMode, inputs);
      assert.equal(result.moduleIds.filter(id => id === "module.memory-maintenance").length, 1);
      assert.match(result.text, /當提供 stage_private_summary 時，只傳 text 摘要正文/u);
      assert.match(result.text, /覆蓋清單、游標及版本由 Server 綁定，不新增參數/u);
      assert.match(result.text, /不把這些控制資料塞進摘要/u);
      assert.match(result.text, /其他模式只在當次 outputContract 要求時回覆精確覆蓋資訊/u);
      assert.match(result.text, /moreUncovered=true 只表示仍有後續批次/u);
      assert.match(result.text, /本批指定的全部原訊息與必要前一摘要已取得時，仍可整理本批/u);
      assert.match(result.text, /指定批次缺原訊息、覆蓋倒退或 Server 明示本批不完整時才停止更新/u);
      assert.doesNotMatch(result.text, /輸出新摘要時必須帶回實際覆蓋到的最後消息游標/u);
    }
  }
});
