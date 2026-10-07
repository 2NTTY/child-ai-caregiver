import assert from "node:assert/strict";
import test from "node:test";
import { FinishReason } from "@google/genai";
import { AgentBudget, AGENT_LIMITS, AGENT_INTERACTIVE_INPUT } from "../server/agent-budget.ts";
import { readAiConfig } from "../server/ai-config.ts";
import { createAgentRuntime } from "../server/agent-runtime.ts";
import type { AgentRunInput } from "../server/agent-runtime.ts";

test("interactive input configuration is finite and independent of the P1 text limit", () => {
  const defaults = readAiConfig({});
  assert.equal(defaults.agentMaxInputCharacters, 64000); assert.equal(defaults.maxInputCharacters, 10000);
  for (const value of ["32000", "48000", "64000"]) assert.equal(readAiConfig({ AI_AGENT_MAX_INPUT_CHARACTERS: value }).agentMaxInputCharacters, Number(value));
  for (const value of ["0", "31999", "64001", "128000", "32000.5", "064000", "6.4e4", "NaN", "Infinity", " 64000", "64000\n"])
    assert.throws(() => readAiConfig({ AI_AGENT_MAX_INPUT_CHARACTERS: value }), { message: "Invalid AI_AGENT_MAX_INPUT_CHARACTERS configuration" });
  assert.equal(readAiConfig({ AI_MAX_INPUT_CHARACTERS: "20000" }).agentMaxInputCharacters, 64000);
  assert.equal(readAiConfig({ AI_AGENT_MAX_INPUT_CHARACTERS: "32000" }).maxInputCharacters, 10000);
  assert.deepEqual(AGENT_INTERACTIVE_INPUT, { default: 64000, min: 32000, max: 64000 });
  assert.deepEqual(AGENT_LIMITS, { modelCalls: 4, toolCalls: 8, queryEmbeddings: 2, deadlineMs: 90000, outputTokens: 1024, inputCharacters: 32000 });
});

test("one selected ceiling drives tool allowance and personal call settings cannot change it", () => {
  for (const limit of [32000, 64000]) {
    const budget = new AgentBudget();
    try {
      budget.configureInputCharacters(limit);
      budget.configurePersonal({ modelCalls: 6, queryEmbeddings: 3, inputCharacters: 999999 } as { modelCalls: number; queryEmbeddings: number });
      assert.equal(budget.limits.inputCharacters, limit);
      budget.prepareToolResponseBudget(24000, 100);
      assert.equal(budget.toolResponseCharacters, limit - 24000 - 100 - 4096);
      budget.accountToolResponse(250); assert.equal(budget.toolResponseCharacters, limit - 24000 - 100 - 4096 - 250);
      assert.throws(() => budget.configureInputCharacters(64000));
    } finally { budget.close(); }
  }
  for (const invalid of [31999, 64001, NaN, Infinity, 32000.5]) {
    const budget = new AgentBudget();
    try { assert.throws(() => budget.configureInputCharacters(invalid)); } finally { budget.close(); }
  }
});

for (const setting of [
  { name: "interactive default", trigger: "interactive", env: undefined, limit: 64000 },
  { name: "interactive rollback", trigger: "interactive", env: "32000", limit: 32000 },
  { name: "worker keeps base limit", trigger: "worker", env: "64000", limit: 32000 },
] as const) test(`native Runner enforces exact logical boundary: ${setting.name}`, async context => {
  let measured = 0, reservations = 0, calls = 0;
  const config = readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project", AI_AGENT_MAX_INPUT_CHARACTERS: setting.env });
  const runtime = createAgentRuntime({ config, usage: { reserve: async () => { reservations++; return true; }, record: async () => {} },
    provider: { generate: async request => {
      calls++; measured = JSON.stringify({ contents: request.contents, config: request.config }).length;
      const instruction = JSON.stringify(request.config?.systemInstruction);
      assert.ok(instruction.includes(`\\\"inputCharacters\\\":${setting.limit}`) || instruction.includes(`\"inputCharacters\":${setting.limit}`));
      return { finishReason: FinishReason.STOP, content: { role: "model", parts: [{ text: "Synthetic result" }] } };
    } } });
  const input: AgentRunInput = { runId: "11111111-1111-4111-8111-111111111111", scope: { userId: "synthetic", childId: "synthetic-child", workspaceId: "synthetic-workspace", authorizationVersion: "1", dataVersion: "1" },
    trigger: { kind: setting.trigger, reference: "synthetic" }, recipeId: "p1-chat", messages: [{ role: "user", text: "x" }], tools: [], authorize: async () => true };
  const probe = await runtime.run(input); assert.equal(probe.status, "completed", JSON.stringify(probe));
  const characters = setting.limit - measured + 1;
  assert.ok(characters > 0); input.messages[0].text = "x".repeat(characters);
  assert.equal((await runtime.run(input)).status, "completed"); assert.equal(measured, setting.limit);
  const before = { calls, reservations }; input.messages[0].text += "x";
  const over = await runtime.run(input);
  assert.equal(over.stopReason, "input_limit"); assert.equal(calls, before.calls); assert.equal(reservations, before.reservations);
  context.diagnostic(JSON.stringify({ scope: setting.name, acceptedLogicalCharacters: measured, rejectedLogicalCharacters: measured + 1, reserveBeforeRejection: before.reservations, reserveAfterRejection: reservations }));
});
