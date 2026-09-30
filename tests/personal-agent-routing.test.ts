import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { FinishReason } from "@google/genai";
import { createAgentRuntime, type AgentRunInput } from "../server/agent-runtime.ts";
import { readAiConfig } from "../server/ai-config.ts";
import type { ModelRouting } from "../server/model-routing.ts";

async function run(revoke: boolean) {
  const config = readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" });
  let current = true, platform = 0, calls = 0, executed = 0, embedding = 0;
  const usage = { reserve: async () => true, record: async () => {}, getForUser: async () => ({ day: "2026-09-30", attempts: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, unknownUsageAttempts: 0 }) };
  const resolve: ModelRouting["resolve"] = async () => ({ config, usage,
    runLimits: { modelCalls: 5, queryEmbeddings: 3 }, authorize: async () => current,
    model: { generate: async () => { throw new Error("P1 unused"); } },
    embeddings: { embed: async () => { embedding++; return [1]; } },
    provider: { generate: async () => {
      calls++;
      if (revoke) current = false;
      return { finishReason: FinishReason.STOP, content: { role: "model", parts: [calls < 5
        ? { functionCall: { id: `call-${calls}`, name: "read_context", args: {} } }
        : { text: "已讀取合成資料。" }] } };
    } },
  });
  const runtime = createAgentRuntime({ config, usage, resolve, provider: { generate: async () => { platform++; throw new Error("No platform fallback"); } } });
  const input: AgentRunInput = { scope: { userId: "synthetic-user", childId: "child", workspaceId: "workspace", authorizationVersion: "1", dataVersion: "1" },
    recipeId: "p1-chat", trigger: { kind: "interactive", reference: "message" }, messages: [{ role: "user", text: "Synthetic question" }], authorize: async () => true,
    tools: context => [{ name: "read_context", description: "Read synthetic context", parameters: z.object({}), authorize: async () => true,
      execute: async () => {
        executed++;
        if (executed === 1) {
          context.budget.take("queryEmbeddings", 3);
          assert.throws(() => context.budget.take("queryEmbeddings"), { reason: "embedding_limit" });
          await context.embeddings!.embed({ task: "RETRIEVAL_QUERY", text: "synthetic" }, { kind: "query_embedding", actorId: "synthetic-user", operationId: context.runId }, context.budget.signal, context.authorize!);
        }
        return { status: "succeeded", data: { value: "synthetic" } };
      } }],
  };
  return { result: await runtime.run(input), calls, executed, platform, embedding };
}

test("personal call settings reach Runner and the selected embedding gateway without platform fallback", async () => {
  const evidence = await run(false);
  assert.equal(evidence.result.status, "completed");
  assert.equal(evidence.calls, 5); assert.equal(evidence.executed, 4);
  assert.equal(evidence.embedding, 1); assert.equal(evidence.platform, 0);
});
test("revoked personal settings stop the next tool and never switch billing source", async () => {
  const evidence = await run(true);
  assert.equal(evidence.result.stopReason, "unauthorized");
  assert.equal(evidence.calls, 1); assert.equal(evidence.executed, 0); assert.equal(evidence.platform, 0);
});
