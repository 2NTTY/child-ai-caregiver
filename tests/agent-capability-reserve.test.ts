import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { FinishReason } from "@google/genai";
import type { LlmRequest, LlmResponse } from "@google/adk";
import { createAgentRuntime, type AgentTool } from "../server/agent-runtime.ts";
import { AGENT_TOOL_RESPONSE_RESERVE, AgentBudget, AgentStopped } from "../server/agent-budget.ts";
import { agentRequestCharacters } from "../server/agent-model-gateway.ts";
import { AgentCapabilitySelection } from "../server/agent-tool-capabilities.ts";
import { readAiConfig } from "../server/ai-config.ts";

const call = (name: string, id: string, args: Record<string, unknown> = {}) => ({ functionCall: { name, id, args } });
const response = (...parts: ReturnType<typeof call>[]): LlmResponse => ({ finishReason: FinishReason.STOP, content: { role: "model", parts } });
const loader = { name: "load_capabilities", description: "Load a trusted synthetic capability.", parameterDescription: "Trusted capability IDs." };
const catalog = { coreToolNames: ["read_context"], loader, groups: [
  { id: "alpha", description: "Synthetic alpha.", toolNames: ["write_alpha"], promptModuleIds: ["module.task-intents"] },
  { id: "beta", description: "Synthetic beta.", toolNames: ["write_beta"], promptModuleIds: ["module.memory-maintenance"] },
] };

function fixture(mode: "growth" | "same_batch" | "overflow" | "terminal" | "invalid" | "boundary", limit = 32000, boundaryCharacters = 1, initialSummary = false) {
  let budget: AgentBudget, accepted = false, reads = 0, writes = 0, records = 0;
  const requests: LlmRequest[] = [], modelSizes: number[] = [], allowances: number[] = [], providerErrors: string[] = [];
  const runtime = createAgentRuntime({ config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project", AI_AGENT_MAX_INPUT_CHARACTERS: String(limit) }),
    usage: { reserve: async () => true, record: async () => { records++; } }, provider: { generate: async request => {
      try {
        const index = requests.length; requests.push(structuredClone({ ...request, toolsDict: {} }));
        assert.ok(agentRequestCharacters(request) <= limit);
        let value: LlmResponse;
        if (index === 0) {
          assert.equal(Object.hasOwn(request.toolsDict, "write_alpha"), false);
          value = mode === "growth" ? response(call("read_context", "read-1"), call(loader.name, "alpha", { capabilities: ["alpha", "alpha"] }),
            call(loader.name, "beta", { capabilities: ["beta"] }), call(loader.name, "invalid", { capabilities: ["missing"] }))
            : mode === "same_batch" ? response(call(loader.name, "alpha", { capabilities: ["alpha"] }), call("write_alpha", "forbidden"))
            : mode === "overflow" || mode === "boundary" ? response(call("read_context", "read-1"), call(loader.name, "alpha", { capabilities: ["alpha"] }))
            : mode === "terminal" ? response(call(loader.name, "alpha", { capabilities: ["alpha"] }), call("present_answer", "answer", { text: "Synthetic" }))
            : response(call("read_context", "read-1"), call(loader.name, "invalid", { capabilities: ["alpha"], extra: true }));
        } else if (mode === "growth" && index === 1) {
          assert.ok(Object.hasOwn(request.toolsDict, "write_alpha")); assert.ok(Object.hasOwn(request.toolsDict, "write_beta"));
          value = response(call("read_context", "read-2"), call(loader.name, "repeat", { capabilities: ["alpha"] }));
        } else {
          if (mode === "invalid") assert.equal(Object.hasOwn(request.toolsDict, "write_alpha"), false);
          value = response(call("present_answer", "answer", { text: "Synthetic validated result" }));
        }
        modelSizes.push(JSON.stringify(value.content).length); return value;
      } catch (error) { providerErrors.push(String(error)); throw error; }
    } } });
  const input = { scope: { userId: "synthetic-user", childId: "synthetic-child", workspaceId: "synthetic-workspace", authorizationVersion: "1", dataVersion: "1" },
    recipeId: "product-interactive", trigger: { kind: "interactive" as const, reference: "synthetic" },
    availableInputs: ["run", "scope", "conversation", "context", "evidence", "capabilities"],
    messages: [{ role: "user" as const, text: "Synthetic capability-reserve check" }], toolCatalog: catalog, authorize: async () => true,
    ...(initialSummary ? { initialConversationSummary: { summary: { id: "synthetic-summary", version: 1,
      text: "Synthetic first-request-only history", createdAt: "2026-10-09T00:00:00.000Z", lastCoveredMessageId: "synthetic-message" },
      basis: "a".repeat(64), validUntil: null } } : {}),
    tools: (run: { budget: AgentBudget }): AgentTool[] => {
      budget = run.budget;
      return [{ name: "read_context", description: "Read synthetic context.", parameters: z.object({}), authorize: async () => true,
        execute: async () => { reads++; allowances.push(budget.toolResponseCharacters); return { status: "succeeded", data: { read: reads } }; } },
      ...["alpha", "beta"].map(id => ({ name: "write_" + id, description: mode === "boundary" ? "x".repeat(boundaryCharacters) : "Synthetic schema metadata. ".repeat(mode === "overflow" ? 1600 : 90),
        parameters: z.object({ value: z.string().describe("Synthetic parameter metadata. ".repeat(20)) }), authorize: async () => true,
        execute: async () => { writes++; return { status: "succeeded" as const }; } })),
      { name: "present_answer", description: "Present a validated synthetic response.", terminal: true, parameters: z.object({ text: z.string() }), authorize: async () => true,
        execute: async () => { accepted = true; return { status: "succeeded" }; } }];
    }, finalize: async () => accepted ? "Synthetic validated result" : null };
  return { run: () => runtime.run(input), requests, modelSizes, allowances, providerErrors,
    reads: () => reads, writes: () => writes, records: () => records };
}

test("capability growth reserves the exact future native configuration without granting access or resetting limits", async () => {
  // The same serializer keeps bounded image bytes and all opaque native parts.
  const jpeg = Buffer.from([255, 216, 255, 217]).toString("base64");
  const imageRequest = { contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: jpeg } }, { thoughtSignature: "opaque" }] }], config: { labels: { synthetic: "preserved" } } };
  assert.equal(agentRequestCharacters(imageRequest), JSON.stringify({ contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/jpeg", data: "[bounded image bytes]" } }, { thoughtSignature: "opaque" }] }], config: imageRequest.config }).length);
  assert.throws(() => agentRequestCharacters({ ...imageRequest, contents: [{ role: "model", parts: imageRequest.contents[0].parts }] }), AgentStopped);

  for (const limit of [32000, 64000]) {
    const f = fixture("growth", limit), result = await f.run();
    assert.equal(result.status, "completed", JSON.stringify({ result, errors: f.providerErrors }));
    const configDelta = JSON.stringify(f.requests[1].config).length - JSON.stringify(f.requests[0].config).length;
    assert.ok(configDelta > 4096, "The combined native capability growth must exceed the existing fixed allowance");
    assert.equal(f.allowances[0], Math.max(0, limit - agentRequestCharacters(f.requests[0]) - f.modelSizes[0] - 4096 - configDelta));
    assert.equal(f.allowances[1], Math.max(0, limit - agentRequestCharacters(f.requests[1]) - f.modelSizes[1] - 4096), "An already-loaded capability must not reserve growth twice");
    assert.deepEqual(result.counts, { modelCalls: 3, toolCalls: 7, queryEmbeddings: 0 });
    assert.equal(result.tools.filter(tool => tool.status === "rejected").length, 1);
    assert.equal(f.reads(), 2); assert.equal(f.writes(), 0); assert.equal(f.records(), 3);
  }
  const invalid = fixture("invalid"), invalidResult = await invalid.run();
  assert.equal(invalidResult.status, "completed", JSON.stringify({ invalidResult, errors: invalid.providerErrors }));
  assert.equal(invalid.allowances[0], 32000 - agentRequestCharacters(invalid.requests[0]) - invalid.modelSizes[0] - 4096);
  assert.equal(invalid.writes(), 0); assert.deepEqual(invalidResult.counts, { modelCalls: 2, toolCalls: 3, queryEmbeddings: 0 });
  for (const [mode, reason] of [["same_batch", "invalid_tool"], ["overflow", "input_limit"], ["terminal", "invalid_response"]] as const) {
    const f = fixture(mode), result = await f.run();
    assert.equal(result.stopReason, reason, JSON.stringify({ result, errors: f.providerErrors }));
    assert.equal(f.reads(), 0); assert.equal(f.writes(), 0); assert.equal(f.records(), 1);
    assert.deepEqual(result.counts, { modelCalls: 1, toolCalls: 2, queryEmbeddings: 0 });
  }
  const stub = (name: string) => ({ name, description: "Synthetic", parameters: z.object({}), authorize: async () => true, execute: async () => ({ status: "succeeded" as const }) });
  const selection = new AgentCapabilitySelection([stub("read_context"), stub("write_alpha"), stub("write_beta")], catalog);
  assert.deepEqual(selection.projectedIds(["beta", "alpha", "alpha"]), ["alpha", "beta"]);
  assert.deepEqual(selection.loadedIds(), []); assert.equal(selection.visibleToolNames().has("write_alpha"), false);
});

test("capability growth at the exact input boundary stops before any handler without continuation headroom", async () => {
  assert.equal(AGENT_TOOL_RESPONSE_RESERVE, 4096);
  // Calibrate using the actual next native config, so prompt changes cannot turn
  // this into an unrelated oversized initial-request check.
  const calibration = fixture("boundary"), calibrationResult = await calibration.run();
  assert.equal(calibrationResult.status, "completed", JSON.stringify({ calibrationResult, errors: calibration.providerErrors }));
  const configDelta = JSON.stringify(calibration.requests[1].config).length - JSON.stringify(calibration.requests[0].config).length;
  const unpaddedFuture = agentRequestCharacters(calibration.requests[0]) + calibration.modelSizes[0] + configDelta;
  const padding = 32000 - unpaddedFuture;
  assert.ok(padding > 0);
  const boundary = fixture("boundary", 32000, 1 + padding), result = await boundary.run();
  assert.equal(agentRequestCharacters(boundary.requests[0]), agentRequestCharacters(calibration.requests[0]));
  assert.equal(boundary.modelSizes[0], calibration.modelSizes[0]);
  assert.equal(agentRequestCharacters(boundary.requests[0]) + boundary.modelSizes[0] + configDelta + padding, 32000);
  assert.equal(result.stopReason, "input_limit", JSON.stringify({ result, errors: boundary.providerErrors }));
  assert.deepEqual(result.tools, [], "Neither the read handler nor the loader may execute at an impossible continuation boundary");
  assert.equal(boundary.reads(), 0); assert.equal(boundary.writes(), 0); assert.equal(boundary.records(), 1);
  assert.equal(boundary.requests.length, 1); assert.deepEqual(boundary.providerErrors, []);
  assert.deepEqual(result.counts, { modelCalls: 1, toolCalls: 2, queryEmbeddings: 0 });
});


test("first-request summary keeps the full prospective loader and read_context reserve without entering later history", async () => {
  for (const limit of [32000, 64000]) {
    const f = fixture("growth", limit, 1, true), result = await f.run();
    assert.equal(result.status, "completed", JSON.stringify({ result, errors: f.providerErrors }));
    const initial = f.requests[0], projection = initial.contents.at(-1)!;
    assert.ok(projection.parts?.[0]?.text?.includes("Synthetic first-request-only history"));
    assert.ok(JSON.stringify(projection).length <= 4000);
    const persistent = { ...initial, contents: initial.contents.slice(0, -1) };
    const configDelta = JSON.stringify(f.requests[1].config).length - JSON.stringify(initial.config).length;
    assert.ok(configDelta > AGENT_TOOL_RESPONSE_RESERVE);
    assert.equal(f.allowances[0], Math.max(0, limit - agentRequestCharacters(persistent) - f.modelSizes[0] - AGENT_TOOL_RESPONSE_RESERVE - configDelta));
    for (const request of f.requests.slice(1)) {
      assert.equal(JSON.stringify(request.contents).includes("Synthetic first-request-only history"), false);
      assert.ok(agentRequestCharacters(request) <= limit);
    }
    assert.equal(f.allowances[1], Math.max(0, limit - agentRequestCharacters(f.requests[1]) - f.modelSizes[1] - AGENT_TOOL_RESPONSE_RESERVE));
    assert.deepEqual(result.counts, { modelCalls: 3, toolCalls: 7, queryEmbeddings: 0 });
    assert.equal(f.reads(), 2); assert.equal(f.writes(), 0); assert.equal(f.records(), 3);
    assert.deepEqual(f.providerErrors, []);
  }
});
