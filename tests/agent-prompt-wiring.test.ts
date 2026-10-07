import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadAgentPrompt, type AgentOutputMode, type PromptManifest } from "../server/agent-prompt.ts";

const manifest = JSON.parse(await readFile(new URL("../prompts/manifest.json", import.meta.url), "utf8")) as PromptManifest;
const directRecipes = ["product-interactive", "product-background", "summary-visit", "photo-capture", "shared-capture"];

test("pack, module and synthetic format versions are valid independently", async () => {
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/u);
  for (const module of manifest.modules) {
    assert.match(module.version, /^\d+\.\d+\.\d+$/u);
    const document = await readFile(new URL(`../prompts/${module.path}`, import.meta.url), "utf8");
    assert.ok(document.includes(`- 版本：\`${module.version}\``));
  }
  for (const path of ["contracts/examples.json", "review/cases.json"]) {
    const data = JSON.parse(await readFile(new URL(`../prompts/${path}`, import.meta.url), "utf8"));
    assert.match(data.formatVersion, /^\d+\.\d+\.\d+$/u);
  }
});

test("every declared recipe loads its complete dependency closure and enforces structured input", async () => {
  for (const recipe of manifest.recipes) {
    for (const mode of recipe.outputModes) {
      const inputs = [...new Set([...recipe.requiredInputs, ...(manifest.outputModeRequirements[mode] ?? [])])];
      const result = await loadAgentPrompt(recipe.id, mode as AgentOutputMode, inputs);
      assert.equal(result.packVersion, manifest.version);
      assert.equal(result.moduleIds.length, new Set(result.moduleIds).size);
      assert.ok(result.moduleIds.includes("core.conversation"));
      assert.ok(result.moduleIds.includes("domain.childcare-hk.safety"));
      assert.doesNotMatch(result.text, /<!-- prompt:|## 維護與靜態例子|^- ID：/mu);
      if (mode === "structured") {
        await assert.rejects(loadAgentPrompt(recipe.id, mode, inputs.filter(input => input !== "outputContract")));
      } else {
        await loadAgentPrompt(recipe.id, mode as AgentOutputMode, inputs.filter(input => input !== "outputContract"));
      }
    }
  }
});

test("documented direct entry recipes match the current server and module union", async () => {
  assert.equal(manifest.modules.length, 22);
  assert.equal(manifest.recipes.length, 12);
  const selectedModules = new Set([...manifest.baseModules, ...manifest.domain.requiredModules]);
  const recipesDoc = await readFile(new URL("../prompts/recipes/README.md", import.meta.url), "utf8");
  const productAgent = await readFile(new URL("../server/product-agent.ts", import.meta.url), "utf8");
  for (const id of directRecipes) {
    const recipe = manifest.recipes.find(item => item.id === id);
    assert.ok(recipe);
    assert.ok(recipesDoc.includes(id));
    recipe.additionalModules.forEach(id => selectedModules.add(id));
  }
  for (const id of directRecipes.slice(0, 3)) assert.ok(productAgent.includes(`"${id}"`));
  assert.match(await readFile(new URL("../server/photo-agent.ts", import.meta.url), "utf8"), /recipeId:\s*"photo-capture"/u);
  assert.match(await readFile(new URL("../server/shared-input-service.ts", import.meta.url), "utf8"), /recipeId:\s*"shared-capture"/u);
  assert.equal(selectedModules.size, 20);
  assert.deepEqual(manifest.modules.filter(module => !selectedModules.has(module.id)).map(module => module.id).sort(),
    ["module.authorized-contact", "module.knowledge-maintenance"]);
});

test("current product instructions include context and quantity contracts without requiring a fake P1 tool", async () => {
  const recipe = manifest.recipes.find(item => item.id === "product-interactive")!;
  const result = await loadAgentPrompt(recipe.id, "tool_cycle", recipe.requiredInputs);
  assert.equal(result.text.split("privateSummaryInput.messageIds").length - 1, 1);
  assert.equal(result.text.split("quantityEvidence").length - 1, 1);
  assert.match(result.text, /removed／absent/u);
  assert.match(result.text, /unchanged 只表示舊欄位未改/u);
  assert.match(result.text, /不能把模型文字當使用者原話/u);
  assert.match(result.text, /不能直接用自然 final 跳過/u);
  const p1 = await loadAgentPrompt("p1-chat", "text", ["run", "scope", "conversation", "capabilities"]);
  assert.match(p1.text, /當本次 tool_cycle 提供 present_answer 時/u);
  assert.match(p1.text, /工具未提供時依本次輸出模式回覆，不猜工具名稱/u);
  assert.doesNotMatch(p1.text, /quantityEvidence|privateSummaryInput/u);
});
