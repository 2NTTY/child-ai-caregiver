import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadAgentPrompt, type AgentOutputMode, type PromptManifest } from "../server/agent-prompt.ts";
import { PRODUCT_AGENT_TOOL_CATALOG, WORK_CONTINUATION_TOOL_CATALOG } from "../server/product-agent-capabilities.ts";

const manifest = JSON.parse(await readFile(new URL("../prompts/manifest.json", import.meta.url), "utf8")) as PromptManifest;
const directEntries = [
  { id: "product-interactive", path: "product-agent.ts", catalog: PRODUCT_AGENT_TOOL_CATALOG },
  { id: "product-background", path: "product-agent.ts" },
  { id: "product-work-followup", path: "product-agent.ts", catalog: WORK_CONTINUATION_TOOL_CATALOG },
  { id: "photo-capture", path: "photo-agent.ts" },
  { id: "shared-capture", path: "shared-input-service.ts" },
];

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
  const coveredModules = new Set<string>();
  assert.equal(new Set(manifest.modules.map(module => module.id)).size, manifest.modules.length);
  assert.equal(new Set(manifest.recipes.map(recipe => recipe.id)).size, manifest.recipes.length);
  for (const recipe of manifest.recipes) {
    for (const mode of recipe.outputModes) {
      const inputs = [...new Set([...recipe.requiredInputs, ...(manifest.outputModeRequirements[mode] ?? [])])];
      const result = await loadAgentPrompt(recipe.id, mode as AgentOutputMode, inputs);
      assert.equal(result.packVersion, manifest.version);
      assert.deepEqual(result.moduleIds,
        [...new Set([...manifest.baseModules, ...manifest.domain.requiredModules, ...recipe.additionalModules])]);
      for (const id of result.moduleIds) {
        coveredModules.add(id);
        const module = manifest.modules.find(module => module.id === id);
        assert.ok(module, id);
        for (const dependency of module.requires) assert.ok(result.moduleIds.includes(dependency), `${id} requires ${dependency}`);
      }
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
  for (const group of PRODUCT_AGENT_TOOL_CATALOG.groups) group.promptModuleIds.forEach(id => coveredModules.add(id));
  assert.deepEqual([...coveredModules].sort(), manifest.modules.map(module => module.id).sort());
});

test("documented direct entry recipes match the server and load their actual capability modules", async () => {
  const recipesDoc = await readFile(new URL("../prompts/recipes/README.md", import.meta.url), "utf8");
  const productAgent = await readFile(new URL("../server/product-agent.ts", import.meta.url), "utf8");
  assert.deepEqual([...new Set(productAgent.match(/product-(?:interactive|background|work-followup)/gu))].sort(),
    directEntries.filter(entry => entry.path === "product-agent.ts").map(entry => entry.id).sort());
  assert.doesNotMatch(productAgent, /["']summary-visit["']/u);
  assert.ok(manifest.recipes.some(recipe => recipe.id === "summary-visit"), "Summary composition remains available without a direct entry");
  for (const { id, path, catalog } of directEntries) {
    const recipe = manifest.recipes.find(item => item.id === id);
    assert.ok(recipe, id);
    assert.ok(recipesDoc.includes(`\`${id}\``), `${id} must be documented`);
    const source = await readFile(new URL(`../server/${path}`, import.meta.url), "utf8");
    assert.ok(source.includes(`"${id}"`), `${path} must select ${id}`);
    const moduleSets = [[], ...(catalog?.groups.map(group => [...group.promptModuleIds]) ?? []),
      catalog?.groups.flatMap(group => [...group.promptModuleIds]) ?? []];
    for (const additionalModules of moduleSets) {
      const result = await loadAgentPrompt(id, "tool_cycle", recipe.requiredInputs, additionalModules);
      assert.deepEqual(result.moduleIds, [...new Set([...manifest.baseModules, ...manifest.domain.requiredModules,
        ...recipe.additionalModules, ...additionalModules])]);
      assert.ok(result.moduleIds.includes("core.conversation"));
      assert.ok(result.moduleIds.includes("domain.childcare-hk.safety"));
    }
  }
});

test("effective product instructions retain summary, provenance and quantity contracts without fake P1 tools", async () => {
  const recipe = manifest.recipes.find(item => item.id === "product-interactive")!;
  const initial = await loadAgentPrompt(recipe.id, "tool_cycle", recipe.requiredInputs);
  const care = PRODUCT_AGENT_TOOL_CATALOG.groups.find(group => group.id === "care_records");
  const memory = PRODUCT_AGENT_TOOL_CATALOG.groups.find(group => group.id === "memory_summary");
  assert.ok(care); assert.ok(memory);
  assert.ok(care.toolNames.includes("save_ordinary_record"));
  assert.ok(memory.toolNames.includes("stage_private_summary"));
  const effective = await loadAgentPrompt(recipe.id, "tool_cycle", recipe.requiredInputs,
    [...care.promptModuleIds, ...memory.promptModuleIds]);
  assert.equal(effective.moduleIds.length, new Set(effective.moduleIds).size);
  assert.equal(effective.text.split("privateSummaryInput.messageIds").length - 1, 1);
  assert.equal(effective.text.split("quantityEvidence").length - 1, 1);
  assert.match(effective.text, /removed／absent/u);
  assert.match(effective.text, /unchanged 只表示舊欄位未改/u);
  assert.match(effective.text, /不能把模型文字當使用者原話/u);
  assert.match(initial.text, /不能直接用自然 final 跳過/u);
  const p1 = await loadAgentPrompt("p1-chat", "text", ["run", "scope", "conversation", "capabilities"]);
  assert.match(p1.text, /當本次 tool_cycle 提供 present_answer 時/u);
  assert.match(p1.text, /工具未提供時依本次輸出模式回覆，不猜工具名稱/u);
  assert.doesNotMatch(p1.text, /quantityEvidence|privateSummaryInput/u);
});
