import test from 'node:test';
import assert from 'node:assert/strict';
import type { Firestore } from '@google-cloud/firestore';
import type { LlmRequest } from '@google/adk';
import { FinishReason } from '@google/genai';
import type { InitialConversationSummary } from '../server/memory-summary.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { createProductAgentTools } from '../server/product-agent-tools.ts';
import { historicalSummaryText, summaryExpiry } from '../server/summary-projection.ts';
import { randomUUID } from 'node:crypto';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreMemoryStore, firestoreMemoryRecoverySchemas } from '../server/firestore-memory.ts';
import { AgentGatewayModel, agentRequestCharacters, agentGenerationConfig, createVertexAgentPayloadBuilder } from '../server/agent-model-gateway.ts';
import { AgentBudget, AGENT_TOOL_RESPONSE_RESERVE } from '../server/agent-budget.ts';
import { readAiConfig } from '../server/ai-config.ts';

async function fixture() {
  const fake = firestoreDomainFixture();
  function query(raw: any): any { return new Proxy(raw, { get(target, key) {
    if (key === 'get') return () => fake.database.runTransaction(tx => tx.get(target));
    const value = target[key]; return typeof value === 'function' ? (...args: any[]) => {
      const result = value(...args); return result?.query ? query(result) : result?.path ? { ...result, id: result.path.split('/').at(-1) } : result;
    } : value;
  } }); }
  const database = { ...fake.database, collection: (path: string) => query(fake.database.collection(path)) } as Firestore;
  const options = { database, cipher: createStorageCipher(Buffer.alloc(32, 90)), projectId: 'synthetic-pr411-deep-review', namespace: 'review_projection' };
  const authority = createFirestoreAuthority(options);
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  await authority.issueInvitation({ email: 'review@example.test', operationId: randomUUID(), expiresAt: new Date(Date.now() + 60000).toISOString() });
  await authority.admitIdentity({ userId: 'review', email: 'review@example.test', emailVerified: true });
  await authority.acknowledge({ userId: 'review', operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const { child } = await authority.createChild({ userId: 'review', displayName: '合成覆核孩子', operationId: randomUUID() });
  const chat = createFirestoreChatStore(options), care = createFirestoreCareStore(options);
  const memory = createFirestoreMemoryStore({ ...options, chat, care });
  async function save(text: string) {
    const message = await chat.createUserMessageForUser('review', child.id, 'Synthetic source ' + randomUUID());
    assert.ok(message);
    const input = await memory.prepareSummary('review', child.id);
    assert.ok(input);
    const value = await memory.saveSummary('review', child.id, { previousVersion: input.previousVersion, basis: input.basis, text, coveredMessageIds: [message.id] });
    assert.ok(value); assert.ok(message); return { value, message };
  }
  return { child, memory, save, authority, options, chat, care, data: new FirestoreDomainData(options) };
}

const config = readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'synthetic-pr411-deep-review' });
const request = (): LlmRequest => ({ contents: [{ role: 'user', parts: [{ text: 'Synthetic current request' }] }], toolsDict: {}, liveConnectConfig: {} });
async function dispatch(f: Awaited<ReturnType<typeof fixture>>, options: {
  reserve?: () => Promise<boolean>; read?: () => Promise<InitialConversationSummary | null>;
  authorize?: () => Promise<boolean>; input?: LlmRequest; captures?: LlmRequest[]; times?: number; between?: () => Promise<void>;
} = {}) {
  const budget = new AgentBudget(), captures = options.captures ?? [];
  const model = new AgentGatewayModel({ config, userId: 'review', childId: f.child.id, budget,
    authorize: options.authorize ?? (async () => true), readConversationSummary: options.read ?? (() => f.memory.initialConversationSummary!('review', f.child.id)),
    usage: { reserve: options.reserve ?? (async () => true), record: async () => {} }, provider: { generate: async input => {
      captures.push(structuredClone({ ...input, toolsDict: {} }));
      return { content: { role: 'model', parts: [{ text: 'Synthetic response' }] }, finishReason: FinishReason.STOP };
    } } });
  try {
    for (let i = 0; i < (options.times ?? 1); i++) {
      for await (const _ of model.generateContentAsync(options.input ?? request())) { /* Drain the real gateway. */ }
      if (i + 1 < (options.times ?? 1)) await options.between?.();
    }
    const last = captures.at(-1); assert.ok(last); return last;
  } finally { budget.close(); }
}
function delivered(outgoing: LlmRequest) {
  const text = outgoing.contents.at(-1)?.parts?.[0]?.text;
  assert.ok(typeof text === 'string' && text.startsWith('以下為 Server 提供的歷史對話摘要資料'));
  const summary = JSON.parse(text.slice(text.indexOf('\n') + 1));
  return { summary, projection: JSON.parse(summary.text) };
}
async function fact(f: Awaited<ReturnType<typeof fixture>>, key: string, validUntil: string | null) {
  const candidate = await f.memory.createFact('review', f.child.id, { intendedVisibility: 'private', values: {
    key, content: 'Synthetic current claim ' + key, source: { kind: 'manual', description: 'Synthetic review' }, validUntil } });
  assert.ok(candidate);
  return f.memory.confirmFact('review', f.child.id, candidate.id, { expectedVersion: 1, confirm: true, confirmShared: false });
}

test('actual projection and gateway retain a fitting newest batch when an older escaped batch cannot fit the provider envelope', async () => {
  const f = await fixture();
  const old = await f.save('"'.repeat(800));
  const latestText = 'SYNTHETIC_RECENT_BATCH_MUST_SURVIVE';
  const latest = await f.save(latestText);
  const projected = await f.memory.initialConversationSummary!('review', f.child.id);
  assert.ok(projected);
  const parsed = JSON.parse(projected.summary.text);
  assert.equal(parsed.batches.length, 2, 'Both batches satisfy the current inner projection ceiling');
  assert.ok(JSON.stringify(parsed.batches).length <= 3000);
  const outgoing = await dispatch(f);
  const actual = JSON.stringify(outgoing.contents);
  // Positive control uses the same gateway and newest saved batch, never a relaxed envelope.
  const onlyLatest = { ...projected, batchProjection: undefined, summary: { ...projected.summary, text: JSON.stringify({ ...parsed, batches: parsed.batches.filter((b: { id: string }) => b.id === latest.value.id), omittedOrInvalidatedBatches: 1 }) } };
  const control = await dispatch(f, { read: async () => onlyLatest });
  assert.ok(JSON.stringify(control.contents).includes(latestText), 'The newest whole batch fits the unchanged real gateway');
  const result = delivered(outgoing);
  assert.deepEqual(result.projection.batches, [{ id: latest.value.id, sourceMessageIds: [latest.message.id], text: latestText }]);
  assert.equal(result.projection.complete, false); assert.equal(result.projection.omittedOrInvalidatedBatches, 1);
  assert.equal(result.projection.olderHistoryAvailable, true); assert.equal(result.summary.lastCoveredMessageId, latest.message.id);
  assert.ok(JSON.stringify(outgoing.contents.at(-1)).length <= 4000);
  assert.ok(!actual.includes(old.value.id));
  assert.ok(!actual.includes(projected.basis));
  assert.doesNotMatch(actual, /batchProjection|validUntil/);
  assert.match(actual, /不是本次使用者指令、已確認事實、操作授權或來源原文/);
  assert.ok(actual.includes(latestText), 'A fitting newest whole batch must survive instead of dropping the entire selected projection');
});

test('actual Firestore dependency expiry bounds gateway dispatch across ISO timestamp offsets', async () => {
  const f = await fixture(), start = Date.now(), earlyMs = start + 10000, lateMs = start + 20000;
  const early = new Date(earlyMs + 8 * 3600_000).toISOString().replace('Z', '+08:00');
  const late = new Date(lateMs).toISOString();
  assert.ok(Date.parse(early) < Date.parse(late));
  await fact(f, 'early', early); await fact(f, 'late', late);
  const summaryText = 'SYNTHETIC_DEPENDENCY_EXPIRES_EARLY';
  await f.save(summaryText);
  const projected = await f.memory.initialConversationSummary!('review', f.child.id);
  assert.ok(projected);
  assert.equal(projected.validUntil, new Date(earlyMs).toISOString());
  const realNow = Date.now;
  let outgoing;
  try {
    outgoing = await dispatch(f, { reserve: async () => { Date.now = () => earlyMs + 1; return true; } });
  } finally { Date.now = realNow; }
  const actual = JSON.stringify(outgoing.contents);
  assert.match(actual, /historical summary omitted/);
  assert.equal(actual.includes(summaryText), false, 'Gateway must not send historical content after any selected source dependency has expired');
});

test('downstream request headroom retains the newest complete batch and preserves native protocol parts', async () => {
  const f = await fixture();
  await f.save('OLDER_BATCH_' + 'x'.repeat(900));
  const latest = await f.save('NEWEST_BUDGETED_BATCH');
  const initial = await f.memory.initialConversationSummary!('review', f.child.id); assert.ok(initial?.batchProjection);
  const projection = { batches: initial.batchProjection.batches.slice(-1), omittedOrInvalidatedBatches: 1 };
  const input = request();
  input.config = { systemInstruction: 'Synthetic system ' + '"'.repeat(100) };
  input.contents.unshift({ role: 'model', parts: [{ functionCall: { name: 'synthetic_read', args: { quote: '"' } }, thoughtSignature: 'opaque-signature' }] },
    { role: 'user', parts: [{ functionResponse: { name: 'synthetic_read', response: { result: 'Synthetic source' } } }] });
  const control = await dispatch(f, { input, read: async () => ({ ...initial, batchProjection: projection, summary: { ...initial.summary, text: historicalSummaryText(projection) } }) });
  const limit = 32000;
  const padding = limit - AGENT_TOOL_RESPONSE_RESERVE - agentRequestCharacters({ ...control, config: agentGenerationConfig(config, control.config) }) - 1;
  assert.ok(padding > 0);
  input.contents.at(-1)!.parts![0].text += 'x'.repeat(padding);
  const before = structuredClone(input), outgoing = await dispatch(f, { input });
  const result = delivered(outgoing);
  assert.deepEqual(result.projection.batches.map((batch: { id: string }) => batch.id), [latest.value.id]);
  assert.equal(result.projection.omittedOrInvalidatedBatches, 1);
  assert.deepEqual(outgoing.contents.slice(0, input.contents.length), before.contents);
  assert.deepEqual(input, before);
  assert.ok(agentRequestCharacters({ ...outgoing, config: agentGenerationConfig(config, outgoing.config) }) + AGENT_TOOL_RESPONSE_RESERVE <= limit);
});

test('an oversized newest escaped batch never exposes an older batch across the omitted head', async () => {
  const f = await fixture(); await f.save('SMALL_OLDER_BATCH_MUST_NOT_REAPPEAR');
  const head = await f.save('"'.repeat(1000));
  const outgoing = await dispatch(f), result = delivered(outgoing);
  assert.deepEqual(result.projection.batches, []);
  assert.equal(result.projection.headBatchOmittedForCapacity, true);
  assert.equal(result.projection.omittedOrInvalidatedBatches, 2);
  assert.equal(result.projection.complete, false);
  assert.equal(result.summary.id, head.value.id);
  assert.equal(result.summary.lastCoveredMessageId, head.message.id);
  assert.ok(!JSON.stringify(outgoing.contents).includes('SMALL_OLDER_BATCH_MUST_NOT_REAPPEAR'));
});

test('a saved head omitted from the initial projection remains readable through the authorized bounded context tool', async () => {
  const f = await fixture(), text = 'SYNTHETIC_LONG_HISTORY_' + 'x'.repeat(4900), head = await f.save(text);
  const initial = delivered(await dispatch(f));
  assert.deepEqual(initial.projection.batches, []); assert.equal(initial.projection.headBatchOmittedForCapacity, true);
  const budget = new AgentBudget(); budget.prepareToolResponseBudget(1000, 100);
  const scope = { userId: 'review', childId: f.child.id, workspaceId: randomUUID(), authorizationVersion: '1', dataVersion: '1' }, runId = randomUUID();
  const product = createProductAgentTools({ run: { scope, runId, budget }, visibility: 'private', memory: f.memory,
    tasks: { list: async () => ({ items: [], eligibleAssignees: [], nextAfterId: null }) }, store: {},
    knowledge: { createRun: () => ({}) }, authorize: async () => true,
  } as unknown as Parameters<typeof createProductAgentTools>[0]);
  try {
    const tool = product.tools.find(value => value.name === 'read_context'); assert.ok(tool);
    assert.equal(await tool.authorize({}, scope), true);
    const response = await tool.execute(tool.parameters.parse({}), { scope, runId, callId: 'synthetic-read', signal: budget.signal });
    assert.equal(response.status, 'succeeded'); const result = response.data!.result as any;
    assert.equal(result.summary.id, head.value.id); assert.equal(result.summary.text, text);
    assert.equal(result.summaryOmittedForCapacity, false);
    assert.ok(JSON.stringify(response).length <= budget.toolResponseCharacters - 512);
  } finally { budget.close(); }
});

test('existing stored batches recompute their expiry from offset dependencies instead of trusting an old late cached expiry', async () => {
  const f = await fixture(), earlyMs = Date.now() + 10000, late = new Date(earlyMs + 20000).toISOString();
  const early = new Date(earlyMs + 8 * 3600_000).toISOString().replace('Z', '+08:00');
  await fact(f, 'legacy-early', early); await fact(f, 'legacy-late', late);
  const head = await f.save('LEGACY_CACHED_EXPIRY_MUST_NOT_LEAK');
  await f.authority.runTransaction('review', f.child.id, async binding => {
    const writes: (() => void)[] = [];
    for (const [collection, kind, id] of [
      ['conversation_summaries', 'conversation-summary', head.value.id],
      ['conversation_summary_heads', 'conversation-summary-head', JSON.stringify(['review', f.child.id])],
    ]) {
      const ref = f.data.ref(collection, kind, id), row = await binding.transaction.get(ref);
      const saved = f.data.open(kind, id, binding.scope, firestoreMemoryRecoverySchemas.summary, row);
      const envelope = { ...row.data(), ...f.data.seal(kind, id, binding.scope,
        firestoreMemoryRecoverySchemas.summary, { ...saved, validUntil: late }, saved.summary.version) };
      writes.push(() => { binding.transaction.set(ref, envelope); });
    }
    for (const write of writes) write();
  });
  const initial = await f.memory.initialConversationSummary!('review', f.child.id); assert.ok(initial);
  assert.equal(initial.validUntil, new Date(earlyMs).toISOString());
  const realNow = Date.now;
  try {
    const outgoing = await dispatch(f, { reserve: async () => { Date.now = () => earlyMs; return true; } });
    assert.ok(!JSON.stringify(outgoing.contents).includes(head.value.text));
    assert.match(JSON.stringify(outgoing.contents), /historical summary omitted/);
  } finally { Date.now = realNow; }
});

test('expiry uses chronological instants across offsets and invalid timestamps fail closed at the actual gateway', async () => {
  assert.equal(summaryExpiry(['2030-01-02T00:30:00+14:00', '2030-01-01T12:00:00Z']), Date.parse('2030-01-01T10:30:00Z'));
  assert.equal(summaryExpiry(['2030-01-01T23:30:00-05:00', '2030-01-02T03:00:00Z']), Date.parse('2030-01-02T03:00:00Z'));
  assert.equal(summaryExpiry([null]), Infinity);
  const f = await fixture(), head = await f.save('INVALID_EXPIRY_MUST_NOT_LEAK');
  const initial = await f.memory.initialConversationSummary!('review', f.child.id); assert.ok(initial?.batchProjection);
  for (const invalid of ['unknown', '2030-02-30T00:00:00Z', '2030-01-01']) {
    assert.ok(Number.isNaN(summaryExpiry([null, invalid])));
    for (const topLevel of [false, true]) {
      const corrupted = structuredClone(initial);
      if (topLevel) corrupted.validUntil = invalid; else corrupted.batchProjection!.batches[0].validUntil = invalid;
      const outgoing = await dispatch(f, { read: async () => corrupted });
      assert.ok(!JSON.stringify(outgoing.contents).includes(head.value.text));
      assert.match(JSON.stringify(outgoing.contents), /historical summary omitted/);
    }
  }
});

test('a fresh source deletion removes the summary on the next provider request without replaying the previous projection', async () => {
  const f = await fixture(), source = await fact(f, 'erased', null); assert.ok(source);
  const head = await f.save('ERASED_SYNTHETIC_CLAIM'), captures: LlmRequest[] = [];
  await dispatch(f, { captures, times: 2, between: async () => { await f.memory.delete('review', f.child.id, 'facts', source.id, source.version); } });
  assert.equal(captures.length, 2);
  assert.ok(JSON.stringify(captures[0].contents).includes(head.value.text));
  assert.ok(!JSON.stringify(captures[1].contents).includes(head.value.text));
  assert.equal(captures[1].contents.length, 1);
});

test('revocation blocks dispatch and expiry during final authorization preserves a truthful omission marker', async () => {
  const f = await fixture(), expiryMs = Date.now() + 10000;
  await fact(f, 'final-expiry', new Date(expiryMs).toISOString());
  const head = await f.save('FINAL_AUTH_EXPIRY_MUST_NOT_LEAK'), captures: LlmRequest[] = [];
  let authorized = true;
  await assert.rejects(dispatch(f, { captures, authorize: async () => authorized, reserve: async () => { authorized = false; return true; } }), { message: 'unauthorized' });
  assert.equal(captures.length, 0);
  const realNow = Date.now; let checks = 0;
  try {
    const outgoing = await dispatch(f, { authorize: async () => { if (++checks === 4) Date.now = () => expiryMs; return true; } });
    assert.ok(checks >= 4);
    assert.ok(!JSON.stringify(outgoing.contents).includes(head.value.text));
    assert.match(JSON.stringify(outgoing.contents), /historical summary omitted/);
  } finally { Date.now = realNow; }
});

test('legacy derived JSON is not treated as trusted batch metadata and insufficient request room remains bounded', async () => {
  const f = await fixture(); await f.save('"'.repeat(800)); await f.save('LEGACY_TEXT_IS_NOT_A_BATCH_CONTRACT');
  const initial = await f.memory.initialConversationSummary!('review', f.child.id); assert.ok(initial);
  const legacy = { ...initial, batchProjection: undefined };
  const outgoing = await dispatch(f, { read: async () => legacy });
  assert.ok(!JSON.stringify(outgoing.contents).includes('LEGACY_TEXT_IS_NOT_A_BATCH_CONTRACT'));
  assert.match(JSON.stringify(outgoing.contents), /historical summary omitted/);
  const input = request();
  input.contents[0].parts![0].text += 'x'.repeat(32000 - nativeCharacters(input));
  const before = structuredClone(input), bounded = await dispatch(f, { input });
  assert.deepEqual(bounded.contents, before.contents);
  assert.deepEqual(input, before);
  assert.equal(nativeCharacters(bounded), 32000);
});

function nativeCharacters(input: LlmRequest) {
  const payload = createVertexAgentPayloadBuilder(config)(input);
  return JSON.stringify({ contents: payload.contents, config: payload.config }).length;
}

test('provider admission bounds the final native generation config and never silently trims an oversized base request', async () => {
  const f = await fixture(); await f.save('SYNTHETIC_BASE_OVERFLOW');
  for (const boundary of ['exact_final', 'over_final', 'exact_before_config'] as const) {
    const input = request(), captures: LlmRequest[] = [];
    input.config = { systemInstruction: 'Synthetic original configuration' };
    const beforeSize = boundary === 'exact_before_config' ? agentRequestCharacters(input) : nativeCharacters(input);
    input.contents[0].parts![0].text += 'x'.repeat(32000 + (boundary === 'over_final' ? 1 : 0) - beforeSize);
    const before = structuredClone(input); let reservations = 0;
    const call = () => dispatch(f, { input, captures, reserve: async () => { reservations++; return true; } });
    if (boundary === 'exact_final') {
      const outgoing = await call();
      assert.equal(nativeCharacters(outgoing), 32000); assert.equal(captures.length, 1); assert.equal(reservations, 1);
      assert.deepEqual(outgoing.contents, before.contents);
    } else {
      assert.ok(nativeCharacters(input) > 32000);
      await assert.rejects(call(), { message: 'input_limit' });
      assert.equal(captures.length, 0); assert.equal(reservations, 0);
    }
    assert.deepEqual(input, before);
  }
});
