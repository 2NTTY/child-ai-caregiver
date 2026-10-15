import assert from "node:assert/strict";
import test from "node:test";
import { FinishReason } from "@google/genai";
import type { AgentModelProvider } from "../server/agent-model-gateway.ts";
import { createAgentRuntime } from "../server/agent-runtime.ts";
import { createProductAgent } from "../server/product-agent.ts";
import { readAiConfig } from "../server/ai-config.ts";
import { agentAnswerSchema, agentBackgroundAnswerSchema, type ProductAgentResult } from "../src/shared/product-agent.ts";
import { productAgentResultSchema } from "../src/shared/product-agent-result.ts";
import { workRecoveryReceiptSchema } from "../server/firestore-work-continuation-recovery.ts";
import { projectAgentRun } from "../frontend/src/production/agent-projection.ts";

const userId = "synthetic-user", childId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222", reference = "33333333-3333-4333-8333-333333333333";
const scope = { userId, childId, workspaceId: "workspace", authorizationVersion: "1", dataVersion: "epoch:1" };
const call = (name: string, args: Record<string, unknown>, id: string) => ({ content: { role: "model", parts: [{ functionCall: { name, args, id }, thoughtSignature: "opaque-original" }] }, finishReason: FinishReason.STOP });
function fixture(generate: AgentModelProvider["generate"]) {
  let claimed = false, saved: ProductAgentResult | null = null;
  const runtime = createAgentRuntime({ config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project" }),
    usage: { reserve: async () => true, record: async () => {} }, provider: { generate } });
  const options = { runtime,
    store: { claim: async () => { const created = !claimed; claimed = true; return { runId, scope, created, expiresAt: new Date(Date.now() + 90_000).toISOString() }; },
      authorize: async () => true, finish: async (_scope: unknown, result: ProductAgentResult) => { saved = productAgentResultSchema.parse(JSON.parse(JSON.stringify(result))); return true; }, get: async () => saved },
    memory: { context: async () => ({ profile: { childId, version: 0, data: null }, profileApplicable: false, facts: [], topics: [], summary: null, recentMessages: [],
      conflictingKeys: [], unavailableFactKeys: [], truncated: { facts: false, topics: false, messages: false } }) },
    chat: { listForUser: async () => ({ messages: [{ id: reference, role: "user", text: "請查看剛才的事情。" }] }) },
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) }, knowledge: { createRun: () => ({}) },
  } as unknown as Parameters<typeof createProductAgent>[0];
  return { options, service: () => createProductAgent(options) };
}

test("background no-action persists and replays without fake text; interactive schema still requires an answer", async () => {
  const empty = { kind: "no_action", paragraphs: [] };
  assert.equal(agentAnswerSchema.safeParse(empty).success, false);
  assert.equal(agentBackgroundAnswerSchema.safeParse(empty).success, true);
  assert.equal(agentAnswerSchema.safeParse({ kind: "mixed", paragraphs: [{ text: "missing kind", citationIds: [] }] }).success, false);
  let calls = 0;
  const f = fixture(async () => { calls++; return call("present_answer", empty, "quiet-result"); });
  const input = { userId, childId, reference, context: { eventType: "concern_followup" }, authorize: async () => true };
  const result = await f.service().background(input);
  assert.equal(result?.status, "completed", JSON.stringify(result)); assert.equal(result.outcome, "no_action");
  assert.equal(result.text, ""); assert.deepEqual(result.citations, []); assert.deepEqual(result.proposals, []);
  assert.deepEqual(await f.service().background(input), result); assert.equal(calls, 1);
  const recovery = { ...result, provenance: { ...result.provenance!, recipeId: "product-work-followup" } };
  assert.equal(workRecoveryReceiptSchema.parse(recovery).outcome, "no_action");
  assert.equal(productAgentResultSchema.safeParse({ ...result, text: "Invented saved chat" }).success, false);
  assert.equal(projectAgentRun(result, childId, null).text, "已核對，這次沒有需要新增的回饋或行動。");
});

test("read-only failure permits bounded recovery; each step uses a fresh non-cumulative summary", async () => {
  let calls = 0, reads = 0, summaries = 0;
  const f = fixture(async request => {
    const step = calls++;
    const parts = request.contents.flatMap((content: any) => content.parts ?? []);
    const summaryParts = parts.filter((part: any) => part.text?.startsWith("以下為 Server 提供的歷史對話摘要資料"));
    assert.equal(summaryParts.length, step < 2 ? 1 : 0);
    if (step < 2) assert.ok(summaryParts[0].text.includes("current-summary-" + (step + 1)));
    if (step > 0) assert.ok(parts.some((part: any) => part.thoughtSignature === "opaque-original"));
    if (step === 1) assert.ok(parts.some((part: any) => part.functionResponse?.response?.data?.code === "read_unavailable"));
    return step < 2 ? call("read_context", {}, "read-" + step)
      : call("present_answer", { kind: "record_restatement", paragraphs: [{ text: "已核對目前資料。", citationIds: [] }] }, "answer");
  });
  const original = f.options.memory.context;
  f.options.memory.context = async (...args) => { reads++; if (reads === 2) throw new Error("Transient synthetic read failure"); return original(...args); };
  f.options.memory.initialConversationSummary = async () => { summaries++; return summaries === 3 ? null : {
    summary: { id: reference, version: summaries, text: "current-summary-" + summaries, createdAt: new Date().toISOString(), lastCoveredMessageId: reference }, basis: "a".repeat(64), validUntil: null }; };
  const result = await f.service().reply(userId, childId, reference, async () => true);
  assert.equal(result?.status, "completed", JSON.stringify(result)); assert.equal(calls, 3); assert.equal(summaries, 3);
  assert.deepEqual(result.tools.map(t => t.status), ["failed", "succeeded", "succeeded"]);
  assert.deepEqual(await f.service().reply(userId, childId, reference, async () => true), result); assert.equal(calls, 3);
});
