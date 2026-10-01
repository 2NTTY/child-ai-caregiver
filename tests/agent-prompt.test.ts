import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assembleAgentPrompt, loadAgentPrompt } from "../server/agent-prompt.ts";
import type { PromptManifest } from "../server/agent-prompt.ts";

const inputs = ["run", "scope", "conversation", "capabilities"];
test("existing prompt recipe includes safety once and excludes maintenance examples", async () => {
  const result = await loadAgentPrompt("p1-chat", "tool_cycle", inputs);
  assert.equal(result.moduleIds.length, new Set(result.moduleIds).size);
  assert.ok(result.moduleIds.includes("domain.childcare-hk.safety"));
  assert.ok(result.moduleIds.includes("core.identity-and-trust"));
  assert.doesNotMatch(result.text, /<!-- prompt:|## 維護與靜態例子|^- ID：/mu);
  assert.match(result.text, /育有方/u);
  assert.ok(result.text.length < 32000);
});

test("unsupported modes and missing required context fail before model execution", async () => {
  await assert.rejects(loadAgentPrompt("p1-chat", "structured", inputs));
  await assert.rejects(loadAgentPrompt("p1-chat", "text", ["run"]));
  await assert.rejects(loadAgentPrompt("not-a-recipe", "text", inputs));
  await assert.rejects(loadAgentPrompt("memory-refresh", "structured", ["run", "scope", "context", "evidence", "capabilities"]));
});

test("missing dependencies, unsafe paths, mismatched versions and duplicate boundaries fail closed", async () => {
  const original = JSON.parse(await readFile(new URL("../prompts/manifest.json", import.meta.url), "utf8")) as PromptManifest;
  const readModule = (path: string) => readFile(new URL(`../prompts/${path}`, import.meta.url), "utf8");
  for (const mutate of [
    (manifest: PromptManifest) => { manifest.modules[0]!.requires.push("missing"); },
    (manifest: PromptManifest) => { manifest.modules[0]!.path = "../AGENTS.md"; },
    (manifest: PromptManifest) => { manifest.modules[0]!.version = "invalid"; },
    (manifest: PromptManifest) => { manifest.modules.push(manifest.modules[0]!); },
  ]) {
    const manifest = structuredClone(original);
    mutate(manifest);
    await assert.rejects(assembleAgentPrompt({ manifest, recipeId: "p1-chat", mode: "text", availableInputs: inputs, readModule }));
  }
  await assert.rejects(assembleAgentPrompt({ manifest: original, recipeId: "p1-chat", mode: "text", availableInputs: inputs,
    readModule: async path => `${await readModule(path)}\n<!-- prompt:begin -->` }));
});
