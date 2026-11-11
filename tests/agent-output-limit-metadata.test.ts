import assert from "node:assert/strict";
import test from "node:test";
import { FinishReason } from "@google/genai";
import type { LlmRequest } from "@google/adk";
import { AgentBudget, AGENT_LIMITS } from "../server/agent-budget.ts";
import { AgentGatewayModel, createVertexAgentPayloadBuilder } from "../server/agent-model-gateway.ts";
import { createAgentRuntime } from "../server/agent-runtime.ts";
import { readAiConfig } from "../server/ai-config.ts";

const defaults = readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" });
const usage = { reserve: async () => true, record: async () => {} };
const reply = () => ({ content: { role: "model", parts: [{ text: "Synthetic answer" }] }, finishReason: FinishReason.STOP });
const limits = [[defaults.maxOutputTokens, 1024], [4096, 4096], [512, 512], [20000, 16384]] as const;

function metadata(request: LlmRequest, marker: string) {
  const instruction = request.config?.systemInstruction;
  assert.equal(typeof instruction, "string");
  assert.ok(typeof instruction === "string" && instruction.includes(marker));
  return JSON.parse(instruction.split(marker)[1]!);
}

test("runtime metadata uses the resolved run output limit and keeps the gateway ceiling", async () => {
  for (const [maxOutputTokens, expected] of limits) {
    const selectedConfig = { ...defaults, maxOutputTokens };
    const requests: LlmRequest[] = [];
    const provider = { generate: async (request: LlmRequest) => {
      requests.push(request);
      return reply();
    } };
    const runtime = createAgentRuntime({ config: defaults, usage,
      provider: { generate: async () => { throw Error("Unresolved provider must not run"); } },
      resolve: async () => ({ config: selectedConfig, provider, runLimits: undefined, authorize: async () => true,
        usage: { ...usage, getForUser: async () => { throw Error("Unused usage read"); } },
        model: { generate: async () => { throw Error("Unused model"); } },
        embeddings: { embed: async () => { throw Error("Unused embedding"); } } }),
    });
    const result = await runtime.run({ scope: { userId: "user", childId: "child", workspaceId: "workspace", authorizationVersion: "1", dataVersion: "1" },
      recipeId: "p1-chat", trigger: { kind: "interactive", reference: "message" }, messages: [{ role: "user", text: "Synthetic question" }],
      tools: [], authorize: async () => true });
    assert.equal(result.status, "completed", JSON.stringify(result));
    assert.equal(requests.length, 1);
    assert.equal(metadata(requests[0]!, "Server runtime metadata:\n").limits.outputTokens, expected);
    assert.equal(createVertexAgentPayloadBuilder(selectedConfig)(requests[0]!).config?.maxOutputTokens, expected);
  }
  assert.equal(AGENT_LIMITS.outputTokens, 1024);
});

test("tool-free role metadata matches its effective output limit without changing the shared budget", async t => {
  for (const [maxOutputTokens, expected] of limits) {
    const selectedConfig = { ...defaults, maxOutputTokens };
    const budget = new AgentBudget();
    t.after(() => budget.close());
    const requests: LlmRequest[] = [];
    const model = new AgentGatewayModel({ config: selectedConfig, budget, usage,
      userId: "user", childId: "child", authorize: async () => true,
      provider: { generate: async request => {
        requests.push(request);
        return reply();
      } },
    });
    assert.equal(await model.completeText({ system: "Return a synthetic answer.", user: "Synthetic evidence", attemptKey: "review" }), "Synthetic answer");
    assert.equal(requests.length, 1);
    assert.equal(metadata(requests[0]!, "Server role budget:\n").limits.outputTokens, expected);
    assert.equal(createVertexAgentPayloadBuilder(selectedConfig)(requests[0]!).config?.maxOutputTokens, expected);
    assert.equal(budget.limits.outputTokens, 1024);
    assert.equal(budget.counts.modelCalls, 1);
  }
});
