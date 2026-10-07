import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { LlmRequest } from "@google/adk";
import { FinishReason } from "@google/genai";
import { createAgentRuntime } from "../server/agent-runtime.ts";
import { createProductAgent } from "../server/product-agent.ts";
import { readAiConfig } from "../server/ai-config.ts";
import type { ProductAgentResult } from "../src/shared/product-agent.ts";

for (const kind of ["interactive", "worker"] as const) test(`product ${kind} explicitly repairs presentation through its existing tools and final validator`, async () => {
  const userId = "synthetic-user", childId = randomUUID(), runId = randomUUID(), workspaceId = randomUUID(), messageId = randomUUID();
  const scope = { userId, childId, workspaceId, authorizationVersion: "1", dataVersion: "epoch:1" };
  const requests: LlmRequest[] = [];
  let saved: ProductAgentResult | null = null, finalized = 0, proposals = 0;
  const messages = [{ id: messageId, childId, role: "user", text: "請說明還欠哪些資料。", authorUserId: userId,
    inReplyTo: null, createdAt: "2026-10-07T12:00:00Z" }];
  const runtime = createAgentRuntime({ config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
    usage: { reserve: async () => true, record: async () => {} }, provider: { generate: async request => {
      const index = requests.length; requests.push(structuredClone({ ...request, toolsDict: {} }));
      if (!index) {
        if (kind === "worker") for (const forbidden of ["propose_task", "propose_fact", "read_private_source", "stage_private_summary"])
          assert.equal(Object.hasOwn(request.toolsDict, forbidden), false, forbidden);
        return { finishReason: FinishReason.STOP, content: { role: "model", parts: [{ text: "未完成操作；需要補充資料。", thoughtSignature: "synthetic-natural-signature" }] } };
      }
      assert.equal(index, 1); assert.deepEqual(Object.keys(request.toolsDict), ["present_answer"]);
      assert.deepEqual(request.config?.toolConfig, { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["present_answer"] } });
      assert.ok(request.contents.flatMap(content => content.parts ?? []).some(part => part.thoughtSignature === "synthetic-natural-signature"));
      return { finishReason: FinishReason.STOP, content: { role: "model", parts: [{ functionCall: { name: "present_answer", args: {
        kind: "clarification", paragraphs: [{ text: "未完成操作；請補充要處理的事項。", citationIds: [] }],
      } } }] } };
    } } });
  const service = createProductAgent({ runtime, store: {
    claim: async () => ({ runId, scope, created: true, expiresAt: new Date(Date.now() + 90000).toISOString() }), authorize: async () => true,
    propose: async () => { proposals++; assert.fail("Presentation repair cannot create a candidate"); },
    finish: async (_scope: unknown, result: ProductAgentResult) => { finalized++; saved = result; return true; }, get: async () => saved,
  }, chat: { listForUser: async () => ({ messages }) }, memory: { context: async () => ({ profile: { childId, version: 0, data: null },
    profileApplicable: false, facts: [], topics: [], summary: null, recentMessages: messages,
    conflictingKeys: [], unavailableFactKeys: [], truncated: { facts: false, topics: false, messages: false } }) },
    tasks: { list: async () => ({ items: [], eligibleAssignees: [{ userId, name: "Synthetic User" }], nextAfterId: null }) },
    knowledge: { createRun: () => ({ revalidateCitations: async () => true }) },
  } as unknown as Parameters<typeof createProductAgent>[0]);
  const result = kind === "interactive" ? await service.reply(userId, childId, messageId, async () => true)
    : await service.background({ userId, childId, reference: "synthetic-background", context: { eventType: "synthetic-event" }, authorize: async () => true });
  assert.equal(result?.status, "completed", JSON.stringify(result)); assert.equal(result.text, "未完成操作；請補充要處理的事項。");
  assert.deepEqual(result.counts, { modelCalls: 2, toolCalls: 1, queryEmbeddings: 0 });
  assert.deepEqual(result.tools.map(tool => ({ name: tool.name, status: tool.status })), [{ name: "present_answer", status: "succeeded" }]);
  assert.equal(requests.length, 2); assert.equal(finalized, 1); assert.equal(proposals, 0); assert.deepEqual(result.proposals, []);
});
