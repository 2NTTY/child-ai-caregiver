import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { factIsApplicable, looksLikeDurableMemoryFactQuestion, looksLikeDurableMemoryFactStatement, normalizedFactKey, preserveMemoryFactUserWording, profileIsApplicable, requireTopicTransition, sanitizeDurableMemoryFactValidUntil, topicMayAsk } from "../server/memory-policy.ts";
import { factValuesSchema, summarySaveSchema } from "../server/memory-validation.ts";
import { handleMemoryRequest } from "../server/memory-api.ts";
import type { MemoryStore } from "../server/memory.ts";
import { FamilyError } from "../server/family-access.ts";
import { createMemoryStore } from "../server/memory.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";
import type { Pool } from "pg";
import type { MemoryFact } from "../src/shared/memory.ts";

test("only confirmed, current and unexpired facts are applicable", () => {
  const base = { status: "confirmed" as const, sourceState: "current" as const, validUntil: null };
  assert.equal(factIsApplicable(base), true);
  for (const status of ["candidate", "inactive"] as const) assert.equal(factIsApplicable({ ...base, status }), false);
  assert.equal(factIsApplicable({ ...base, sourceState: "changed" }), false);
  assert.equal(factIsApplicable({ ...base, validUntil: "2026-01-01T00:00:00Z" }, Date.parse("2026-01-01T00:00:00Z")), false);
});
test("new sessions do not reopen answered or resolved topics; snooze has an explicit boundary", () => {
  for (const status of ["answered", "resolved"] as const) {
    assert.equal(topicMayAsk({ status, resumeAfter: null }, Number.MAX_SAFE_INTEGER), false);
    assert.throws(() => requireTopicTransition(status, "pending", null), /terminal_topic/u);
  }
  const due = "2027-01-01T00:00:00Z";
  assert.equal(topicMayAsk({ status: "snoozed", resumeAfter: due }, Date.parse(due) - 1), false);
  assert.equal(topicMayAsk({ status: "snoozed", resumeAfter: due }, Date.parse(due)), true);
  assert.throws(() => requireTopicTransition("pending", "snoozed", null), /invalid_snooze/u);
});
test("fact input preserves precision and rejects fabricated or incomplete source shapes", () => {
  const raw = { key: " 睡眠安排 ", content: "  大概半小時\n未確認精確時間  ", source: { kind: "manual", description: "原文" }, validUntil: null };
  assert.deepEqual(factValuesSchema.parse(raw), raw);
  assert.equal(factValuesSchema.safeParse({ ...raw, source: { kind: "private_chat", description: "shared source with private ID omitted" } }).success, true);
  assert.equal(factValuesSchema.safeParse({ ...raw, source: { kind: "private_chat", description: "invalid ID", messageId: "not-a-uuid" } }).success, false);
  assert.equal(factValuesSchema.safeParse({ ...raw, source: { kind: "care_record", description: "wrong version", recordId: randomUUID(), version: "1" } }).success, false);
  assert.equal(factValuesSchema.safeParse({ ...raw, content: "\ud800" }).success, false);
  assert.equal(normalizedFactKey("  ＡＢＣ "), "abc");
});
test("profile validity keeps the original Hong Kong calendar-date boundary", () => {
  const data = { validUntil: "2026-09-24" };
  assert.equal(profileIsApplicable(data, new Date("2026-09-24T15:59:59Z")), true);
  assert.equal(profileIsApplicable(data, new Date("2026-09-24T16:00:00Z")), false);
  assert.equal(profileIsApplicable(null), false);
});
const childId = randomUUID(), factId = randomUUID();
const request = (path: string, body?: unknown, headers: Record<string, string> = {}) => new Request(`http://localhost/api/children/${childId}/memory/${path}`, {
  method: body === undefined ? "GET" : "POST", headers: { "content-type": "application/json", "x-expected-user-id": "owner", ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
test("memory writes require the current account and an explicit confirmation", async () => {
  let calls = 0;
  const store = { confirmFact: async () => { calls++; return {}; } } as unknown as MemoryStore;
  const body = { expectedVersion: 1, confirm: true, confirmShared: true };
  assert.equal((await handleMemoryRequest(request(`facts/${factId}/confirm`, body), null, store)).status, 401);
  assert.equal((await handleMemoryRequest(request(`facts/${factId}/confirm`, body, { "x-expected-user-id": "other" }), "owner", store)).status, 409);
  assert.equal((await handleMemoryRequest(request(`facts/${factId}/confirm`, { ...body, confirm: false }), "owner", store)).status, 400);
  assert.equal((await handleMemoryRequest(request(`facts/${factId}/confirm`, body), "owner", store)).status, 200);
  assert.equal(calls, 1);
});
test("memory HTTP does not expose a model summary write or hide a version conflict", async () => {
  const store = { reviseFact: async () => { throw new FamilyError(409, "version_conflict"); } } as unknown as MemoryStore;
  assert.equal((await handleMemoryRequest(request("summary", { text: "invented" }), "owner", store)).status, 404);
  const values = { key: "日常", content: "合成", source: { kind: "manual", description: "本人" }, validUntil: null };
  const response = await handleMemoryRequest(request(`facts/${factId}/revise`, { values, expectedVersion: 1, confirm: true, confirmShared: true, reason: "更正" }), "owner", store);
  assert.equal(response.status, 409); assert.equal((await response.json()).error.code, "version_conflict");
});
test("summary writes need exact coverage metadata and cannot carry fact or task mutations", () => {
  const value = { previousVersion: 0, basis: "a".repeat(64), text: "摘要", coveredMessageIds: [randomUUID()] };
  assert.deepEqual(summarySaveSchema.parse(value), value);
  assert.equal(summarySaveSchema.safeParse({ ...value, taskStatus: "completed" }).success, false);
  assert.equal(summarySaveSchema.safeParse({ ...value, coveredMessageIds: [] }).success, false);
});

test("deactivating shared memory hides another author's private message identifier and publishes only metadata", async () => {
  const child = randomUUID(), factId = randomUUID(), workspace = randomUUID(), messageId = randomUUID();
  const cipher = createStorageCipher(Buffer.alloc(32, 31));
  const value: MemoryFact = { id: factId, childId: child, createdBy: "author", visibility: "family", intendedVisibility: "family", status: "confirmed",
    version: 2, key: "作息", content: "已獲確認的合成內容", source: { kind: "private_chat", messageId, description: "主動分享" }, validUntil: null,
    confirmedBy: "author", confirmedAt: "2026-09-24T00:00:00Z", reason: "確認", applicable: true, sourceState: "current" };
  const row = { id: factId, child_id: child, created_by: "author", visibility: "family", version: 2,
    payload_encrypted: cipher.encrypt(JSON.stringify(value), `memory-fact:${child}:${factId}:2`) };
  let change: unknown[] | undefined, parentLocked = false;
  const client = { release() {}, async query(sql: string, params?: unknown[]) {
    if (sql.includes("FROM workspaces")) { parentLocked = sql.endsWith("FOR UPDATE"); return { rows: [{ owner_user_id: "owner", access_version: 1 }], rowCount: 1 }; }
    if (sql.includes("FROM family_members")) { assert.ok(parentLocked); return { rows: [{ role: "caregiver" }], rowCount: 1 }; }
    if (sql.startsWith("SELECT workspace_id")) return { rows: [{ workspace_id: workspace }], rowCount: 1 };
    if (sql.includes("FROM children")) return { rows: [{ profile_version: 0 }], rowCount: 1 };
    if (sql.includes("FROM memory_facts")) return { rows: [row], rowCount: 1 };
    if (sql.startsWith("UPDATE workspaces")) return { rows: [{ change_seq: "8" }], rowCount: 1 };
    if (sql.startsWith("INSERT INTO online_changes")) change = params;
    return { rows: [], rowCount: 1 };
  } };
  const pool = { query: client.query, connect: async () => client } as unknown as Pool;
  const result = await createMemoryStore(pool, cipher, true).deactivateFact("caregiver", child, factId, { expectedVersion: 2, reason: "更正使用範圍" });
  assert.equal(result?.status, "inactive");
  assert.deepEqual(result?.source, { kind: "private_chat", description: "主動分享" });
  assert.deepEqual(change, [workspace, "8", "memory", child, null, false, false]);
  assert.ok(!JSON.stringify(change).includes(messageId));
});
test("memory fact content keeps the user child nickname from the source message", () => {
  assert.equal(preserveMemoryFactUserWording("BB 對雞蛋過敏", "寶寶對雞蛋過敏"), "BB對雞蛋過敏");
  assert.equal(preserveMemoryFactUserWording("BB對花生過敏", "寶寶對花生過敏"), "BB對花生過敏");
  assert.equal(preserveMemoryFactUserWording("寶寶對雞蛋過敏", "BB對雞蛋過敏"), "寶寶對雞蛋過敏");
  assert.equal(preserveMemoryFactUserWording("記低：bb 對蛋過敏", "寶寶對蛋過敏"), "bb對蛋過敏");
  assert.equal(preserveMemoryFactUserWording("今日天氣好好", "寶寶對雞蛋過敏"), "寶寶對雞蛋過敏");
  assert.equal(preserveMemoryFactUserWording("", "寶寶對雞蛋過敏"), "寶寶對雞蛋過敏");
  assert.equal(preserveMemoryFactUserWording("BB 對雞蛋過敏", "BB 對雞蛋過敏"), "BB 對雞蛋過敏");
});


test("durable memory fact statements are distinguished from allergy questions", () => {
  assert.equal(looksLikeDurableMemoryFactStatement("BB 對雞蛋過敏"), true);
  assert.equal(looksLikeDurableMemoryFactStatement("寶寶對花生過敏"), true);
  assert.equal(looksLikeDurableMemoryFactStatement("BB 有冇對雞蛋過敏？"), false);
  assert.equal(looksLikeDurableMemoryFactStatement("BB 有冇花生過敏"), false);
  assert.equal(looksLikeDurableMemoryFactStatement("確認"), false);
});

test("lasting preference statements require propose_fact; preference questions do not", () => {
  assert.equal(looksLikeDurableMemoryFactStatement("BB 鍾意香蕉"), true);
  assert.equal(looksLikeDurableMemoryFactStatement("BB 喜歡蘋果"), true);
  assert.equal(looksLikeDurableMemoryFactStatement("BB 唔鍾意西蘭花"), true);
  assert.equal(looksLikeDurableMemoryFactStatement("BB likes bananas"), true);
  assert.equal(looksLikeDurableMemoryFactStatement("BB 鍾唔鍾意香蕉"), false);
  assert.equal(looksLikeDurableMemoryFactStatement("BB 鍾意香蕉嗎"), false);
  assert.equal(looksLikeDurableMemoryFactStatement("BB 有冇鍾意香蕉？"), false);
});

test("allergy questions are not durable statements and are classified as questions", () => {
  assert.equal(looksLikeDurableMemoryFactStatement("Esther\u5c0d\u829d\u9ebb\u904e\u654f"), true);
  assert.equal(looksLikeDurableMemoryFactStatement("Esther\u5c0d\u829d\u9ebb\u904e\u654f\u55ce\uff1f"), false);
  assert.equal(looksLikeDurableMemoryFactQuestion("Esther\u5c0d\u829d\u9ebb\u904e\u654f\u55ce\uff1f"), true);
  assert.equal(looksLikeDurableMemoryFactQuestion("Esther\u5c0d\u829d\u9ebb\u904e\u654f\uff1f"), true);
  assert.equal(looksLikeDurableMemoryFactQuestion("Esther\u5c0d\u829d\u9ebb\u904e\u654f"), false);
  assert.equal(looksLikeDurableMemoryFactQuestion("BB \u5c0d\u96de\u86cb\u904e\u654f\u55ce\uff1f"), true);
});

test("short validUntil on allergy proposals is coerced to null", () => {
  const now = Date.parse("2026-10-22T01:53:52.706Z");
  assert.equal(sanitizeDurableMemoryFactValidUntil("Esther\u5c0d\u829d\u9ebb\u904e\u654f", "2026-10-22T02:00:00.000Z", now), null);
  assert.equal(sanitizeDurableMemoryFactValidUntil("Esther\u5c0d\u829d\u9ebb\u904e\u654f", null, now), null);
  const long = "2099-12-31T23:59:00.000Z";
  assert.equal(sanitizeDurableMemoryFactValidUntil("Esther\u5c0d\u829d\u9ebb\u904e\u654f", long, now), long);
  assert.equal(sanitizeDurableMemoryFactValidUntil("\u666e\u901a\u5099\u8a3b", "2026-10-22T02:00:00.000Z", now), "2026-10-22T02:00:00.000Z");
});

test("explicit short-lived preference keeps short validUntil; durable preference still clamps", () => {
  const now = Date.parse("2026-10-22T12:00:00.000Z");
  const sixHours = "2026-10-22T18:00:00.000Z";
  assert.equal(
    sanitizeDurableMemoryFactValidUntil("BB 只係今日偏好飲暖水，今晚後不適用", sixHours, now),
    sixHours,
  );
  assert.equal(sanitizeDurableMemoryFactValidUntil("BB 偏好飲暖水", sixHours, now), null);
  // Allergy without short-lived wording still clamps.
  assert.equal(sanitizeDurableMemoryFactValidUntil("BB 對雞蛋過敏", sixHours, now), null);
});

test("mixed remember + question is a statement, not a pure question", () => {
  const mixed = "請記住：BB 對雞蛋過敏。明天要帶甚麼？";
  assert.equal(looksLikeDurableMemoryFactQuestion(mixed), false);
  assert.equal(looksLikeDurableMemoryFactStatement(mixed), true);
  assert.equal(looksLikeDurableMemoryFactQuestion("BB 對雞蛋過敏嗎？"), true);
  assert.equal(looksLikeDurableMemoryFactStatement("BB 對雞蛋過敏嗎？"), false);
});

test("asking whether a fact was remembered never becomes a record request", () => {
  for (const text of ["你有冇記住 BB 對雞蛋過敏？", "你有冇記住 BB 對雞蛋過敏", "是否記住 BB 喜歡香蕉？"]) {
    assert.equal(looksLikeDurableMemoryFactQuestion(text), true, text);
    assert.equal(looksLikeDurableMemoryFactStatement(text), false, text);
  }
});

test("an explicit tonight-to-tomorrow window keeps its expiry", () => {
  const now = Date.parse("2026-10-28T12:00:00.000Z");
  const until = "2026-10-29T00:00:00.000Z";
  assert.equal(sanitizeDurableMemoryFactValidUntil("BB 今晚不吃雞蛋，明早恢復", until, now), until);
  assert.equal(factIsApplicable({ status: "confirmed", sourceState: "current", validUntil: until }, Date.parse(until) - 1), true);
  assert.equal(factIsApplicable({ status: "confirmed", sourceState: "current", validUntil: until }, Date.parse(until)), false);
});

async function proposalMemoryFixture(policyVersion = () => 0) {
  const { firestoreDomainFixture } = await import('./helpers/firestore-domain-memory.ts');
  const { SERVICE_POLICY_VERSION } = await import('../src/shared/account-service.ts');
  const { createFirestoreAuthority } = await import('../server/firestore-authority.ts');
  const { createFirestoreOnlineStore } = await import('../server/firestore-online.ts');
  const { createFirestoreChatStore } = await import('../server/firestore-chat.ts');
  const { createFirestoreCareStore } = await import('../server/firestore-care.ts');
  const { createFirestoreMemoryStore } = await import('../server/firestore-memory.ts');
  const { createFirestoreAgentRuns } = await import('../server/firestore-agent-runs.ts');
  const { createFirestoreAgentProposals } = await import('../server/firestore-agent-proposals.ts');
  const { createFirestoreAgentConfirmations } = await import('../server/firestore-agent-confirmations.ts');
  const fake = firestoreDomainFixture(), options = { database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 42)),
    projectId: 'synthetic-memory-policy', namespace: 'synthetic_memory_policy' };
  const authority = createFirestoreAuthority(options);
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  await authority.issueInvitation({ email: 'parent@example.test', expiresAt: new Date(Date.now() + 60_000).toISOString(), operationId: randomUUID() });
  await authority.admitIdentity({ userId: 'parent', email: 'parent@example.test', emailVerified: true });
  await authority.acknowledge({ userId: 'parent', operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const chat = createFirestoreChatStore(options), care = createFirestoreCareStore(options);
  const memory = createFirestoreMemoryStore({ ...options, chat, care });
  const online = createFirestoreOnlineStore({ ...options, mutations: [chat.mutation, care.mutation, memory.mutation] });
  const runs = createFirestoreAgentRuns({ ...options, chat, memory });
  const proposals = createFirestoreAgentProposals({ runs, chat, memory, online });
  const confirmations = createFirestoreAgentConfirmations({ runs, proposals, chat, policyVersion: async () => policyVersion() });
  const scope = await online.context('parent', { path: '/api/children', payload: { displayName: '合成孩子' } });
  const created = await online.submit('parent', { path: '/api/children', payload: { displayName: '合成孩子' },
    operation: { ...scope, opId: randomUUID(), deviceId: randomUUID() } });
  const childId = (created.result as { child: { id: string } }).child.id;
  return { chat, memory, runs, proposals, confirmations, childId,
    async start(text: string) {
      const message = await chat.createUserMessageForUser('parent', childId, text);
      const claim = await runs.claim('parent', childId, { kind: 'interactive', reference: message!.id }, 'product-interactive');
      return { message: message!, claim };
    } };
}

test("trusted original short expiry survives durable pending and explicit confirmation, then expires", async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-28T12:00:00Z') });
  const h = await proposalMemoryFixture();
  const { message, claim } = await h.start('BB 今晚不吃雞蛋，明早恢復');
  const until = '2026-10-29T00:00:00.000Z';
  const candidate = await h.proposals.propose(claim.scope, claim.runId, 'temporary', {
    kind: 'memory_fact', key: 'egg-tonight', content: '寶寶不吃雞蛋', validUntil: until, intendedVisibility: 'private',
  });
  assert.equal(candidate.status, 'pending');
  assert.equal(candidate.value.kind, 'memory_fact');
  if (candidate.value.kind !== 'memory_fact') assert.fail('wrong candidate kind');
  assert.equal(candidate.value.validUntil, until);
  assert.equal(candidate.value.content, 'BB不吃雞蛋');
  assert.deepEqual((await h.memory.facts('parent', h.childId))!.items, []);
  const ask = await h.confirmations.requestConfirmation(claim.scope, claim.runId, {
    runId: claim.runId, proposalId: candidate.id, expectedVersion: 1, workId: null,
  });
  await h.runs.finish(claim.scope, { runId: claim.runId, provenance: null, status: 'completed', stopReason: null,
    text: ask!.question, citations: [], retrievalMode: 'not_used', tools: [], counts: { modelCalls: 0, toolCalls: 0, queryEmbeddings: 0 }, proposals: [] });
  const reply = await h.chat.createModelMessageForUser('parent', h.childId, message.id, ask!.question);
  await h.confirmations.bindConfirmationQuestion('parent', h.childId, reply!.id);
  const yes = await h.chat.createUserMessageForUser('parent', h.childId, '確認');
  const accepted = await h.confirmations.consumeConfirmation('parent', h.childId, yes!.id);
  assert.equal(accepted!.status, 'accepted');
  const fact = (await h.memory.facts('parent', h.childId))!.items[0]!;
  assert.equal(fact.status, 'confirmed');
  assert.equal(fact.validUntil, until);
  assert.equal(fact.applicable, true);
  t.mock.timers.setTime(Date.parse(until));
  assert.equal((await h.memory.getFact('parent', h.childId, fact.id))!.applicable, false);
});

test("durable proposal store cannot treat model-invented temporary wording as trusted expiry intent", async () => {
  const h = await proposalMemoryFixture();
  const { claim } = await h.start('BB 對雞蛋過敏');
  const candidate = await h.proposals.propose(claim.scope, claim.runId, 'invented-temporary', {
    kind: 'memory_fact', key: 'egg-allergy', content: 'BB 只係今晚對雞蛋過敏',
    validUntil: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(), intendedVisibility: 'private',
  });
  assert.equal(candidate.value.kind, 'memory_fact');
  if (candidate.value.kind !== 'memory_fact') assert.fail('wrong candidate kind');
  assert.equal(candidate.value.validUntil, null);
});

test("durable proposal store independently rejects question sources", async () => {
  const h = await proposalMemoryFixture();
  const { claim } = await h.start('你有冇記住 BB 對雞蛋過敏？');
  await assert.rejects(h.proposals.propose(claim.scope, claim.runId, 'read-not-write', {
    kind: 'memory_fact', key: 'egg-allergy', content: 'BB 對雞蛋過敏', validUntil: null, intendedVisibility: 'private',
  }), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'memory_read_not_propose');
  assert.deepEqual((await h.proposals.pendingProposals('parent', h.childId)).proposals, []);
});


test("durable proposal store binds mixed memory requests to the explicit declarative clause", async () => {
  const h = await proposalMemoryFixture();
  const { claim } = await h.start('請記住：BB 對雞蛋過敏。明天帶甚麼？');
  await assert.rejects(h.proposals.propose(claim.scope, claim.runId, 'inferred-later-answer', {
    kind: 'memory_fact', key: 'tomorrow-food', content: 'BB 明天不吃雞蛋', validUntil: null, intendedVisibility: 'private',
  }), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'memory_fact_source_mismatch');
  const accepted = await h.proposals.propose(claim.scope, claim.runId, 'explicit-fact', {
    kind: 'memory_fact', key: 'egg-allergy', content: '寶寶對雞蛋過敏', validUntil: null, intendedVisibility: 'private',
  });
  assert.equal(accepted.status, 'pending');
  assert.equal(accepted.value.kind, 'memory_fact');
  if (accepted.value.kind !== 'memory_fact') assert.fail('wrong candidate kind');
  assert.equal(accepted.value.content, 'BB對雞蛋過敏');
  assert.deepEqual((await h.memory.facts('parent', h.childId))!.items, []);
});


for (const [currentText, code] of [
  ['你有冇記住 BB 喜歡香蕉？', 'memory_read_not_propose'],
  ['請記住：BB 對雞蛋過敏。明天帶甚麼？', 'memory_fact_source_mismatch'],
]) {
  test(`durable original-source selection preserves current-turn intent: ${code}`, async () => {
    const h = await proposalMemoryFixture();
    const original = await h.start('BB 喜歡香蕉');
    const current = await h.start(currentText!);
    await assert.rejects(h.proposals.propose(current.claim.scope, current.claim.runId, 'old-unrequested-fact', {
      kind: 'memory_fact', key: 'banana', content: 'BB 喜歡香蕉', sourceMessageId: original.message.id,
      validUntil: null, intendedVisibility: 'private',
    }), (error: unknown) => error instanceof Error && 'code' in error && error.code === code);
    assert.deepEqual((await h.proposals.pendingProposals('parent', h.childId)).proposals, []);
  });
}


for (const change of ['dismissed', 'policy_changed', 'source_removed', 'work_changed'] as const) {
  test(`durable confirmation question is unavailable after ${change}`, async () => {
    let policy = 0;
    const h = await proposalMemoryFixture(() => policy);
    const workValues = { goal: '核對合成記憶', focus: '', questions: [], sourceMessageIds: [], resources: [], pending: [], status: 'waiting' as const, followUp: null };
    const work = change === 'work_changed' ? await h.runs.authority.runTransaction('parent', h.childId, async b => {
      const prepared = await b.prepareWork({ operationId: randomUUID(), workId: null, expectedVersion: 0, values: workValues });
      prepared.commit(); return prepared.value;
    }) : null;
    const { message, claim } = await h.start('BB 對雞蛋過敏');
    const candidate = await h.proposals.propose(claim.scope, claim.runId, 'candidate', {
      kind: 'memory_fact', key: 'egg-allergy', content: 'BB 對雞蛋過敏', validUntil: null, intendedVisibility: 'private',
    });
    const confirmation = await h.confirmations.requestConfirmation(claim.scope, claim.runId, {
      runId: claim.runId, proposalId: candidate.id, expectedVersion: 1, workId: work?.id ?? null,
    });
    assert.deepEqual(await h.confirmations.confirmationQuestions('parent', h.childId, claim.runId), [confirmation!.question]);
    if (change === 'dismissed') await h.proposals.decide('parent', h.childId, claim.runId, candidate.id, { expectedVersion: 1, decision: 'dismiss', confirmShared: false });
    if (change === 'policy_changed') policy++;
    if (change === 'source_removed') await h.runs.authority.runTransaction('parent', h.childId, async b => {
      b.transaction.delete(h.runs.data.ref('chat_messages', 'chat-message', message.id));
    });
    if (change === 'work_changed') await h.runs.authority.runTransaction('parent', h.childId, async b => {
      const prepared = await b.prepareWork({ operationId: randomUUID(), workId: work!.id, expectedVersion: work!.version,
        values: { ...workValues, status: 'cancelled' } });
      prepared.commit();
    });
    assert.deepEqual(await h.confirmations.confirmationQuestions('parent', h.childId, claim.runId), []);
  });
}


test("durable expiry uses the matching original fact clause, not a neighboring temporary fact", async () => {
  const h = await proposalMemoryFixture();
  const { claim } = await h.start('BB 暫時不吃雞蛋；BB 對牛奶過敏。');
  const candidate = await h.proposals.propose(claim.scope, claim.runId, 'different-fact-window', {
    kind: 'memory_fact', key: 'milk-allergy', content: 'BB 對牛奶過敏', intendedVisibility: 'private',
    validUntil: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
  });
  assert.equal(candidate.value.kind, 'memory_fact');
  if (candidate.value.kind !== 'memory_fact') assert.fail('wrong candidate kind');
  assert.equal(candidate.value.validUntil, null);
});

test("SQL confirmation questions revalidate the current pending proposal without committing effects", async () => {
  const { createHash } = await import('node:crypto');
  const { canonicalJson } = await import('../server/online-routing.ts');
  const { createAgentConfirmationStore } = await import('../server/agent-confirmation-store.ts');
  const userId = 'synthetic-parent', childId = randomUUID(), runId = randomUUID(), proposalId = randomUUID(), confirmationId = randomUUID(), sourceId = randomUUID();
  const cipher = createStorageCipher(Buffer.alloc(32, 58));
  const value = { kind: 'memory_fact', key: 'egg-allergy', content: 'BB 對雞蛋過敏', intendedVisibility: 'private', validUntil: null };
  let proposalState = 'pending';
  const confirmation = { id: confirmationId, owner_user_id: userId, child_id: childId, asking_run_id: runId,
    proposal_run_id: runId, proposal_id: proposalId, proposal_version: 1, authorization_version: '1', storage_epoch: 'epoch',
    policy_version: 0, work_id: null, work_version: null, state: 'waiting', ask_message_id: null, response_message_id: null,
    expires_at: new Date(Date.now() + 60_000), payload_encrypted: cipher.encrypt(JSON.stringify({
      hash: createHash('sha256').update(canonicalJson(value)).digest('hex'), question: '請確認合成記憶', shared: false, result: null,
    }), `agent-confirmation:${childId}:${userId}:${confirmationId}`) };
  const rows = (items: unknown[] = []) => ({ rows: items, rowCount: items.length });
  const query = async (sql: string) => {
    if (/^(INSERT|UPDATE|DELETE)/u.test(sql)) assert.fail('Question lookup must not commit an effect');
    if (/^(BEGIN|COMMIT|ROLLBACK|SET LOCAL)/u.test(sql)) return rows();
    if (sql === 'SELECT workspace_id FROM children WHERE id=$1') return rows([{ workspace_id: 'workspace' }]);
    if (sql.startsWith('SELECT owner_user_id, access_version')) return rows([{ owner_user_id: userId, access_version: 1 }]);
    if (sql.startsWith('SELECT 1 FROM children')) return rows([{}]);
    if (sql.startsWith('SELECT access_version::text,storage_epoch::text FROM workspaces')) return rows([{ access_version: '1', storage_epoch: 'epoch' }]);
    if (sql.includes('FROM agent_operation_policies')) return rows([]);
    if (sql.includes('FROM agent_confirmations')) return rows([confirmation]);
    if (sql.includes('FROM agent_proposals')) return rows([{ id: proposalId, version: 1, state: proposalState,
      authorization_version: '1', data_version: 'epoch:1', source_message_id: sourceId, created_at: new Date(), expires_at: confirmation.expires_at,
      payload_encrypted: cipher.encrypt(JSON.stringify({ value, targetLabel: null, targetVisibility: 'private', result: null }),
        `agent-run:${childId}:${userId}:${runId}:proposal:${proposalId}:1`) }]);
    if (sql.includes('FROM chat_messages')) return rows([{}]);
    throw new Error('Unexpected synthetic query: ' + sql);
  };
  const pool = { query, connect: async () => ({ query, release() {} }) } as unknown as Pool;
  const store = createAgentConfirmationStore(pool, cipher, async () => { assert.fail('Question lookup must not decide a proposal'); });
  assert.deepEqual(await store.confirmationQuestions(userId, childId, runId), ['請確認合成記憶']);
  proposalState = 'dismissed';
  assert.deepEqual(await store.confirmationQuestions(userId, childId, runId), []);
});
