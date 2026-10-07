import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import type { LlmRequest } from "@google/adk";
import { FinishReason } from "@google/genai";
import { createAgentRuntime } from "../server/agent-runtime.ts";
import { createProductAgent } from "../server/product-agent.ts";
import { readAiConfig } from "../server/ai-config.ts";
import type { AgentProposal, ProductAgentResult } from "../src/shared/product-agent.ts";

for (const { kind, proposal } of [
  { kind: "interactive", proposal: "none" }, { kind: "worker", proposal: "none" },
  { kind: "interactive", proposal: "invalid" }, { kind: "interactive", proposal: "pending" },
] as const) test(`product ${kind} repairs presentation after ${proposal} proposal through existing tools and final validation`, async () => {
  const userId = "synthetic-user", childId = randomUUID(), runId = randomUUID(), workspaceId = randomUUID(), messageId = randomUUID();
  const scope = { userId, childId, workspaceId, authorizationVersion: "1", dataVersion: "epoch:1" };
  const requests: LlmRequest[] = [];
  const writtenProposals: AgentProposal[] = [];
  let saved: ProductAgentResult | null = null, finalized = 0, proposals = 0;
  const messages = [{ id: messageId, childId, role: "user", text: proposal === "none" ? "請說明還欠哪些資料。" : "請建立純合成普通待辦：2026年10月12日香港時間19:30整理繪本袋，分派給我本人。只在站內記錄。", authorUserId: userId,
    inReplyTo: null, createdAt: "2026-10-07T12:00:00Z" }];
  const runtime = createAgentRuntime({ config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
    usage: { reserve: async () => true, record: async () => {} }, provider: { generate: async request => {
      const index = requests.length; requests.push(structuredClone({ ...request, toolsDict: {} }));
      if (!index && proposal !== "none") return { finishReason: FinishReason.STOP, content: { role: "model", parts: [{
        functionCall: { id: "synthetic-proposal", name: "propose_task", args: { values: { title: "Synthetic task", details: "Synthetic details",
          kind: "ordinary", assigneeUserId: userId, dueAt: proposal === "invalid" ? "2026-10-12" : "2026-10-12T11:30:00Z", timeZone: "Asia/Hong_Kong" } } },
        thoughtSignature: "synthetic-proposal-signature",
      }] } };
      if (index === (proposal === "none" ? 0 : 1)) {
        if (proposal !== "none") {
          const response = request.contents.flatMap(content => content.parts ?? []).find(part => part.functionResponse?.name === "propose_task")!.functionResponse!.response!;
          assert.equal(response.status, proposal === "invalid" ? "rejected" : "succeeded");
          assert.equal(proposals, proposal === "pending" ? 1 : 0);
        }
        if (kind === "worker") for (const forbidden of ["propose_task", "propose_fact", "read_private_source", "stage_private_summary"])
          assert.equal(Object.hasOwn(request.toolsDict, forbidden), false, forbidden);
        return { finishReason: FinishReason.STOP, content: { role: "model", parts: [{ text: "未完成操作；需要補充資料。", thoughtSignature: "synthetic-natural-signature" }] } };
      }
      assert.equal(index, proposal === "none" ? 1 : 2); assert.deepEqual(Object.keys(request.toolsDict), ["present_answer"]);
      assert.deepEqual(request.config?.toolConfig, { functionCallingConfig: { mode: "ANY", allowedFunctionNames: ["present_answer"] } });
      assert.ok(request.contents.flatMap(content => content.parts ?? []).some(part => part.thoughtSignature === "synthetic-natural-signature"));
      return { finishReason: FinishReason.STOP, content: { role: "model", parts: [{ functionCall: { name: "present_answer", args: {
        kind: "clarification", paragraphs: [{ text: proposal === "pending" ? "已保存待確認候選；尚未建立正式待辦。" : "未完成操作；請補充要處理的事項。", citationIds: [] }],
      } } }] } };
    } } });
  const service = createProductAgent({ runtime, store: {
    claim: async () => ({ runId, scope, created: true, expiresAt: new Date(Date.now() + 90000).toISOString() }), authorize: async () => true,
    propose: async (_scope: unknown, _runId: string, callId: string, value: AgentProposal["value"]) => {
      assert.equal(proposal, "pending"); assert.equal(callId, "synthetic-proposal"); assert.equal(proposals++, 0);
      const item: AgentProposal = { id: randomUUID(), runId, childId, version: 1, status: "pending", value,
        createdAt: "2026-10-07T12:00:00Z", expiresAt: "2099-10-07T12:00:00Z", result: null, targetLabel: null };
      writtenProposals.push(item); return item;
    },
    finish: async (_scope: unknown, result: ProductAgentResult) => { finalized++; saved = { ...result, proposals: writtenProposals }; return true; }, get: async () => saved,
  }, chat: { listForUser: async () => ({ messages }) }, memory: { context: async () => ({ profile: { childId, version: 0, data: null },
    profileApplicable: false, facts: [], topics: [], summary: null, recentMessages: messages,
    conflictingKeys: [], unavailableFactKeys: [], truncated: { facts: false, topics: false, messages: false } }) },
    tasks: { list: async () => ({ items: [], eligibleAssignees: [{ userId, name: "Synthetic User" }], nextAfterId: null }) },
    knowledge: { createRun: () => ({ revalidateCitations: async () => true }) },
  } as unknown as Parameters<typeof createProductAgent>[0]);
  const result = kind === "interactive" ? await service.reply(userId, childId, messageId, async () => true)
    : await service.background({ userId, childId, reference: "synthetic-background", context: { eventType: "synthetic-event" }, authorize: async () => true });
  assert.equal(result?.status, "completed", JSON.stringify(result)); assert.equal(result.text, proposal === "pending" ? "已保存待確認候選；尚未建立正式待辦。" : "未完成操作；請補充要處理的事項。");
  assert.deepEqual(result.counts, { modelCalls: proposal === "none" ? 2 : 3, toolCalls: proposal === "none" ? 1 : 2, queryEmbeddings: 0 });
  assert.deepEqual(result.tools.map(tool => ({ name: tool.name, status: tool.status })), [
    ...(proposal === "none" ? [] : [{ name: "propose_task", status: proposal === "invalid" ? "rejected" : "succeeded" }]),
    { name: "present_answer", status: "succeeded" },
  ]);
  assert.equal(requests.length, proposal === "none" ? 2 : 3); assert.equal(finalized, 1); assert.equal(proposals, proposal === "pending" ? 1 : 0);
  assert.equal(result.proposals.length, proposal === "pending" ? 1 : 0);
  if (proposal === "pending") { assert.equal(result.proposals[0]!.status, "pending"); assert.equal(result.proposals[0]!.result, null); }
});
