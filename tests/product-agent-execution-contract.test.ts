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

test("daily records capability reads exact household locators without exposing writes", async () => {
  const noteId = "66666666-6666-4666-8666-666666666666", recordId = "77777777-7777-4777-8777-777777777777";
  const at = "2026-11-11T17:00:00.000Z";
  const note = { id: noteId, childId, version: 1, title: "Synthetic due observation",
    text: "Synthetic parent asked to check the missing water bottle after returning home.", sourceMessageId: reference,
    createdAt: at, updatedAt: at, provenance: "user_statement" as const };
  const record = { id: recordId, childId, version: 1, authorUserId: userId, createdAt: at, confirmedBy: userId,
    confirmedAt: at, reason: "Synthetic parent statement", text: "Synthetic parent returned home.", source: "Synthetic parent",
    confirmationBasis: "preauthorized_user_statement" as const,
    details: { kind: "note" as const, quantity: null,
      eventTime: { rawText: at, at, timeZone: "Asia/Hong_Kong", precision: "exact" as const } } };
  const exactReads: string[] = [], providerErrors: string[] = [];
  const writeNames = ["save_ordinary_record", "revise_ordinary_record", "save_private_instruction", "revise_private_instruction",
    "create_ordinary_reminder", "change_ordinary_reminder", "save_work", "request_confirmation", "contact_caregiver"];
  let calls = 0;
  const f = fixture(async request => {
    try {
      const step = calls++;
      for (const name of writeNames) assert.equal(Object.hasOwn(request.toolsDict, name), false, `Daily run exposed ${name}`);
      if (step === 0) {
        assert.equal(Object.hasOwn(request.toolsDict, "read_private_instructions"), false);
        assert.equal(Object.hasOwn(request.toolsDict, "read_care_records"), false);
        return call("load_capabilities", { capabilities: ["records"] }, "load-daily-records");
      }
      if (step === 1) {
        assert.ok(Object.hasOwn(request.toolsDict, "read_private_instructions"), "The loaded daily records capability must expose the canonical private-note reader");
        assert.ok(Object.hasOwn(request.toolsDict, "read_care_records"), "The loaded daily records capability must expose the canonical care-record reader");
      }
      const responses = request.contents.flatMap(content => content.parts ?? []).flatMap(part => part.functionResponse ? [part.functionResponse] : []);
      if (step === 1) return call("read_private_instructions", { id: noteId, query: "", afterId: null }, "read-exact-note");
      const noteResponse = responses.find(response => response.name === "read_private_instructions")?.response;
      assert.equal(noteResponse?.status, "succeeded");
      assert.deepEqual((noteResponse?.data as { items?: unknown } | undefined)?.items, [note], "The model must receive the original exact note, including its source");
      if (step === 2) return call("read_care_records", { id: recordId, query: "" }, "read-exact-record");
      const recordResponse = responses.find(response => response.name === "read_care_records")?.response;
      assert.equal(recordResponse?.status, "succeeded");
      assert.deepEqual((recordResponse?.data as { records?: unknown } | undefined)?.records, [record], "The model must receive the original exact care record");
      assert.equal(step, 3, "The scripted daily assessment must terminate after the two exact reads");
      return call("present_answer", { kind: "no_action", paragraphs: [] }, "daily-locators-read");
    } catch (error) { providerErrors.push((error as Error).message); throw error; }
  });
  f.options.actions = {
    noteById: async (owner: string, child: string, id: string) => {
      assert.deepEqual([owner, child, id], [userId, childId, noteId]); exactReads.push("note"); return note;
    },
    recordById: async (owner: string, child: string, id: string) => {
      assert.deepEqual([owner, child, id], [userId, childId, recordId]); exactReads.push("record"); return record;
    },
    notes: async () => { assert.fail("An exact private-note locator must not fall back to a search page"); },
    records: async () => { assert.fail("An exact care-record locator must not fall back to a search page"); },
    execute: async () => { assert.fail("A read-only daily assessment must never execute an action"); },
  } as unknown as NonNullable<typeof f.options.actions>;
  const result = await f.service().background({ userId, childId, reference, context: { eventType: "proactive_daily",
    householdChanged: true, householdChangesComplete: true,
    householdChanges: [{ revision: 1, domain: "private_note", id: noteId }, { revision: 2, domain: "care_record", id: recordId }] },
    authorize: async () => true });
  assert.deepEqual(providerErrors, [], "The standard daily capability loader must expose both original resource readers");
  assert.equal(result?.status, "completed", JSON.stringify(result));
  assert.deepEqual(exactReads, ["note", "record"]);
  assert.deepEqual(result.tools.map(({ name, status }) => ({ name, status })), [
    { name: "load_capabilities", status: "succeeded" }, { name: "read_private_instructions", status: "succeeded" },
    { name: "read_care_records", status: "succeeded" }, { name: "present_answer", status: "succeeded" },
  ]);
  assert.equal(calls, 4);
});

for (const sourceState of ["unchanged", "changed", "deleted"] as const) test(`private continuation exact-note citations reach independent review (${sourceState} source)`, async () => {
  const noteId = "88888888-8888-4888-8888-888888888888";
  const at = "2026-11-11T17:00:00.000Z";
  const note = { id: noteId, childId, version: 7, title: "Synthetic parent observation",
    text: "合成家長交代：回家後請問水樽找到了沒有。", sourceMessageId: reference,
    createdAt: at, updatedAt: at, provenance: "user_statement" as const };
  let currentNote: typeof note | null = note;
  const draftText = `你曾交代：「${note.text}」`;
  let generationCalls = 0, reviews = 0, reads = 0;
  let citationId: string | undefined;
  const providerErrors: string[] = [];
  const f = fixture(async request => {
    try {
      const text = request.contents.flatMap(content => content.parts ?? []).map(part => part.text ?? "").join("\n");
      if (text.includes("chat-delivery-review")) {
        reviews++;
        assert.equal(reviews, 1, "The original supported draft needs one independent review");
        const body = JSON.parse(text.slice(text.indexOf("{"))) as { draftHash: string; visibility: string;
          paragraphs: { text: string; citationIds: string[] }[];
          sources: { citationId: string; version: string; classification: string; excerpt: string; excerptComplete: boolean }[] };
        assert.equal(body.visibility, "private");
        assert.deepEqual(body.paragraphs.map(({ text, citationIds }) => ({ text, citationIds })), [{ text: draftText, citationIds: [citationId] }]);
        const original = body.sources.find(source => source.citationId === citationId);
        assert.ok(original, "The independent reviewer must receive the exact-note original, not only the generator's restatement");
        assert.equal(original.version, String(note.version));
        assert.equal(original.classification, "private");
        assert.ok(original.excerpt.includes(note.text), "Reviewer source evidence must contain the original private-note text");
        assert.equal(original.excerptComplete, true);
        // Change the authoritative item after review read it, before a pass can be committed.
        if (sourceState === "changed") currentNote = { ...note, version: note.version + 1,
          text: "合成家長已改口：水樽已找到，不用再問。", updatedAt: "2026-11-11T17:01:00.000Z" };
        if (sourceState === "deleted") currentNote = null;
        return { content: { role: "model", parts: [{ text: JSON.stringify({ draftHash: body.draftHash,
          decision: "pass", issues: [] }) }] }, finishReason: FinishReason.STOP };
      }
      for (const name of ["save_private_instruction", "revise_private_instruction", "save_work", "request_confirmation", "contact_caregiver"])
        assert.equal(Object.hasOwn(request.toolsDict, name), false, `Private continuation exposed ${name}`);
      const step = generationCalls++;
      if (step === 0) return call("load_capabilities", { capabilities: ["records"] }, "load-note-evidence");
      if (step === 1) return call("read_private_instructions", { id: noteId }, "read-note-evidence");
      assert.equal(step, 2, "The continuation must present the exact read without extra generation or fabricated sources");
      const response = request.contents.flatMap(content => content.parts ?? [])
        .find(part => part.functionResponse?.name === "read_private_instructions")?.functionResponse?.response;
      assert.equal(response?.status, "succeeded");
      const data = response?.data as { items?: unknown; citationId?: string } | undefined;
      assert.deepEqual(data?.items, [note]);
      citationId = data?.citationId;
      assert.equal(typeof citationId, "string", "Exact private-note reads must return data.citationId");
      assert.ok(citationId!.length > 0);
      return call("present_answer", { kind: "private_reference", paragraphs: [{ text: draftText, citationIds: [citationId] }] }, "present-note-evidence");
    } catch (error) { providerErrors.push((error as Error).message); throw error; }
  }, 6);
  f.options.actions = {
    noteById: async (owner: string, child: string, id: string) => {
      assert.deepEqual([owner, child, id], [userId, childId, noteId]); reads++; return currentNote;
    },
    notes: async () => { assert.fail("An exact note citation must not substitute search results"); },
    execute: async () => { assert.fail("Private source verification must never execute a write"); },
  } as unknown as NonNullable<typeof f.options.actions>;
  const input = { userId, childId, reference, context: { eventType: "work_continuation",
    householdChanges: [{ revision: 1, domain: "private_note", id: noteId }] }, authorize: async () => true };
  const result = await f.service().background(input);
  assert.deepEqual(providerErrors, [], "Private-note evidence must survive the real capability and independent-review path");
  assert.ok(result);
  assert.equal(generationCalls, 3);
  assert.equal(reviews, 1, "A private-reference label must never bypass independent review");
  assert.ok(reads >= 2, "Final delivery must reread the authoritative note instead of trusting run-local evidence");
  if (sourceState === "unchanged") {
    assert.equal(result.status, "completed", JSON.stringify(result));
    assert.ok(result.text.includes(draftText));
    assert.ok(result.deliveryReview);
    assert.equal(result.deliveryReview?.decision, "pass");
    assert.ok(result.deliveryReview.sourceVersions.some(source => source.citationId === citationId && source.version === String(note.version)));
  } else {
    assert.notEqual(result.status, "completed", "A changed or deleted original cannot receive formal delivery");
    assert.notEqual(result.deliveryReview?.decision, "pass");
    assert.ok(!result.text.includes(draftText), "The stale private-note draft must not escape through an unfinished result");
  }
  assert.deepEqual(await f.service().background(input), result);
  assert.equal(generationCalls, 3, "Replaying the original run must not regenerate a stale-source answer");
  assert.equal(reviews, 1);
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
