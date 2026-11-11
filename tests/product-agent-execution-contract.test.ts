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
import type { KnowledgeEvidence } from '../src/shared/knowledge.ts';

const userId = "synthetic-user", childId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222", reference = "33333333-3333-4333-8333-333333333333";
const scope = { userId, childId, workspaceId: "workspace", authorizationVersion: "1", dataVersion: "epoch:1" };
const call = (name: string, args: Record<string, unknown>, id: string) => ({ content: { role: "model", parts: [{ functionCall: { name, args, id }, thoughtSignature: "opaque-original" }] }, finishReason: FinishReason.STOP });
function fixture(generate: AgentModelProvider["generate"], reviewCalls?: 6) {
  let claimed = false, saved: ProductAgentResult | null = null;
  const runtime = createAgentRuntime({ config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project",
    ...(reviewCalls ? { AI_CHAT_DELIVERY_REVIEW_MODEL_CALLS: String(reviewCalls) } : {}) }),
    ...(reviewCalls ? { chatDeliveryReviewModelCalls: reviewCalls } : {}),
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

test("a daily assessment can stay quiet and persist one future observation with the original run", async () => {
  const nextCheck = { at: new Date(Date.now() + 86_400_000).toISOString(), reason: "家長約定明天再問一次。" };
  let calls = 0;
  const f = fixture(async () => {
    calls++;
    return call("present_answer", { kind: "no_action", paragraphs: [], nextCheck }, "observation");
  });
  const run = { userId, childId, reference, context: { eventType: "proactive_daily" }, authorize: async () => true };
  const result = await f.service().background(run);
  assert.equal(result?.status, "completed", JSON.stringify(result));
  assert.deepEqual(result.nextCheck, nextCheck);
  assert.equal(result.outcome, "no_action");
  assert.equal(result.text, "");
  assert.deepEqual(await f.service().background(run), result);
  assert.equal(calls, 1);
});

test("a reviewed daily repair withdraws the original observation and replays only the repaired result", async () => {
  const nextCheck = { at: new Date(Date.now() + 86_400_000).toISOString(), reason: "Synthetic observation proposed by the original draft" };
  const chunk: KnowledgeEvidence = { chunkId: '44444444-4444-4444-8444-444444444444', classification: 'official_guidance',
    text: '合成指引只適用於六個月以上，而且沒有提到加鹽。', key: 'synthetic-feeding', section: 'Synthetic feeding section',
    sourceExcerpt: 'Synthetic official excerpt', keywords: ['feeding'],
    applicability: { region: 'HK', ageBasis: 'any', minAgeMonths: null, maxAgeMonths: null, topics: ['feeding'], conditions: [] },
    sourceId: 'synthetic-feeding', versionId: '55555555-5555-4555-8555-555555555555', versionHash: 'a'.repeat(64), contentHash: 'b'.repeat(64),
    url: 'https://www.fhs.gov.hk/synthetic-feeding', title: 'Synthetic feeding guidance', publisher: 'Synthetic official institution',
    sourcePublishedAt: null, sourceUpdatedAt: null, fetchedAt: new Date().toISOString(), checkedAt: new Date().toISOString(), reviewState: 'reviewed' };
  const originalText = '所有新生兒都應立即加鹽。';
  let calls = 0, reviews = 0, repairs = 0;
  const f = fixture(async request => {
    calls++;
    const text = request.contents.flatMap(content => content.parts ?? []).map(part => part.text ?? '').join('\n');
    if (text.includes('Repair the draft')) {
      repairs++;
      return { content: { role: 'model', parts: [{ text: JSON.stringify({ kind: 'caregiving',
        paragraphs: [{ text: chunk.text, citationIds: [chunk.chunkId] }] }) }] }, finishReason: FinishReason.STOP };
    }
    if (text.includes('chat-delivery-review')) {
      const body = JSON.parse(text.slice(text.indexOf('{')));
      reviews++;
      assert.equal(body.paragraphs[0].text, reviews === 1 ? originalText : chunk.text);
      return { content: { role: 'model', parts: [{ text: JSON.stringify({ draftHash: body.draftHash,
        decision: reviews === 1 ? 'revise' : 'pass', issues: reviews === 1
          ? [{ paragraph: 0, reason: 'Unsupported meaning', support: 'The supplied excerpt does not support the original draft' }] : [] }) }] }, finishReason: FinishReason.STOP };
    }
    return calls === 1 ? call('search_knowledge', { query: '合成餵食主題', classification: 'official_guidance' }, 'source')
      : call('present_answer', { kind: 'caregiving', paragraphs: [{ text: originalText, citationIds: [chunk.chunkId] }], nextCheck }, 'observation-draft');
  }, 6);
  f.options.knowledge = { createRun: () => ({ search: async () => ({ mode: 'vector_keyword', chunks: [chunk] }),
    revalidateCitations: async () => true }) } as unknown as typeof f.options.knowledge;
  const input = { userId, childId, reference, context: { eventType: 'proactive_daily' }, authorize: async () => true };
  const result = await f.service().background(input);
  assert.equal(result?.status, 'completed', JSON.stringify(result));
  assert.equal(result.text, chunk.text + ' [1]'); assert.equal(result.deliveryReview?.decision, 'pass');
  assert.equal(result.nextCheck, undefined, 'The final reviewed replacement must not retain the original draft observation');
  assert.equal('nextCheck' in result, false, 'The persisted receipt must omit the withdrawn observation');
  assert.equal(reviews, 2); assert.equal(repairs, 1); assert.equal(calls, 5);
  assert.deepEqual(await f.service().background(input), result);
  assert.equal(calls, 5, 'Replaying the original worker run neither regenerates nor restores the withdrawn observation');
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
