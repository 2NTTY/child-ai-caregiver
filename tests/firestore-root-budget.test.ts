import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import type { Firestore } from '@google-cloud/firestore';
import { FirestoreRootBudget, MAX_ROOT_BUDGET_BYTES, type FirestoreRootBudgetOptions } from '../server/firestore-root-budget.ts';
import { RootBudgetError, type RootBudgetContext, type BudgetAttempt } from '../server/durable-root-budget.ts';
import { AgentBudget, AGENT_LIMITS, PLATFORM_AGENT_RUN_LIMITS } from '../server/agent-budget.ts';
import { PERSONAL_RUN_LIMITS } from '../src/shared/model-settings.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
function context(patch: Partial<RootBudgetContext['binding']> = {}): RootBudgetContext {
  return { generation: 7, binding: { rootRunId: 'synthetic-root', ownerId: 'synthetic-owner', workspaceId: 'synthetic-workspace', childId: 'synthetic-child',
    authorizationVersion: 'original-auth-version', storageEpoch: 'synthetic-epoch', trigger: { kind: 'message', reference: 'synthetic-message' },
    workflowVersion: 'workflow-v1', promptPackVersion: 'pack-v1', settingsVersion: 'settings-v1', billingVersion: 'billing-v1',
    limits: { modelCalls: 4, toolCalls: 8, queryEmbeddings: 2 }, deadlineAtMs: 20_000, ...patch } };
}
const model = (key = 'original-accepted-model-step', payload = 'synthetic-request'): BudgetAttempt => ({ key, fingerprint: digest(payload), kind: 'model', units: 1 });
const code = (expected: string) => (error: unknown) => error instanceof RootBudgetError && error.code === expected;
function fixture() {
  const records = new Map<string, unknown>(); let now = 10_000, closed = false, loss = false, retry = false;
  let tail = Promise.resolve();
  const database = {
    collection(namespace: string) { return { doc(id: string) { return { path: `${namespace}/${id}` }; } }; },
    async runTransaction(callback: (tx: unknown) => Promise<unknown>) {
      let release!: () => void; const before = tail; tail = new Promise<void>(resolve => { release = resolve; }); await before;
      try {
        const run = async () => {
          const pending = new Map<string, unknown>();
          const result = await callback({
            async get(ref: { path: string }) { const value = records.get(ref.path); return { exists: value !== undefined, data: () => structuredClone(value) }; },
            create(ref: { path: string }, value: unknown) { assert.equal(records.has(ref.path), false); pending.set(ref.path, structuredClone(value)); },
            set(ref: { path: string }, value: unknown) { pending.set(ref.path, structuredClone(value)); },
          });
          return { result, pending };
        };
        if (retry) { retry = false; await run(); }
        const { result, pending } = await run(); for (const [key, value] of pending) records.set(key, value);
        if (loss) { loss = false; throw new Error('Synthetic lost commit response'); }
        return result;
      } finally { release(); }
    },
    async terminate() { closed = true; },
  } as unknown as Firestore;
  const cipher = createStorageCipher(Buffer.alloc(32, 31));
  const options = { database, cipher, projectId: 'synthetic-server-project', namespace: 'budget_unit', serverClock: () => now };
  const service = new FirestoreRootBudget(options);
  return { service, options, records, setNow: (value: number) => { now = value; }, loseNextReply: () => { loss = true; },
    retryNextCallback: () => { retry = true; }, isClosed: () => closed };
}

test('root budget constructor is inert, requires trusted pairing/cipher, and never owns client lifecycle', async () => {
  const f = fixture(); assert.equal(f.records.size, 0);
  for (const patch of [{ database: undefined }, { cipher: undefined }, { namespace: '../unsafe' }, { projectId: '' }, { serverClock: 1 }]) {
    assert.throws(() => new FirestoreRootBudget({ ...f.options, ...patch } as unknown as FirestoreRootBudgetOptions), code('invalid_configuration'));
  }
  await f.service.open(context()); await f.service.stop(context());
  assert.equal(f.isClosed(), false); assert.equal('close' in f.service, false); assert.equal('delete' in f.service, false);
});

test('immutable root binding, generation, deadline and effective limits cannot reset consumed counts', async () => {
  const { service } = fixture(), c = context(); await service.open(c); await service.reserve(c, model());
  assert.equal((await service.open(c)).used.modelCalls, 1);
  for (const patch of [{ ownerId: 'other' }, { workspaceId: 'other' }, { childId: 'other' }, { authorizationVersion: 'changed-auth-version' }, { storageEpoch: 'other' },
    { trigger: { kind: 'message', reference: 'other' } }, { workflowVersion: 'other' }, { promptPackVersion: 'other' }, { settingsVersion: 'other' },
    { billingVersion: 'other' }, { deadlineAtMs: 21_000 }, { limits: { modelCalls: 5, toolCalls: 8, queryEmbeddings: 2 } }]) {
    await assert.rejects(service.open(context(patch)), code('binding_conflict'));
  }
  for (const operation of [() => service.open({ ...c, generation: 8 }), () => service.read({ ...c, generation: 8 }),
    () => service.reserve({ ...c, generation: 8 }, model()), () => service.settle({ ...c, generation: 8 }, model(), { status: 'unknown' }),
    () => service.stop({ ...c, generation: 8 })]) await assert.rejects(operation(), code('generation_conflict'));
  assert.equal((await service.read(c)).used.modelCalls, 1);
});

test('only first same-key transaction issues execute, duplicates remain lookup-only and mismatches conflict', async () => {
  const f = fixture(), c = context(); await f.service.open(c); f.retryNextCallback();
  const results = await Promise.all([f.service.reserve(c, model()), f.service.reserve(c, model())]);
  assert.deepEqual(results.map(result => result.decision), ['execute', 'lookup']);
  assert.equal(results[1].attempt.outcome.status, 'reserved');
  await assert.rejects(f.service.reserve(c, model(undefined, 'changed')), code('attempt_conflict'));
  await assert.rejects(f.service.reserve(c, { ...model(), kind: 'tool_batch', units: 1 }), code('attempt_conflict'));
  assert.equal((await f.service.read(c)).used.modelCalls, 1);
});

test('different keys compete for one remaining slot without creating rejected entries', async () => {
  const { service } = fixture(), c = context({ limits: { modelCalls: 1, toolCalls: 8, queryEmbeddings: 2 } }); await service.open(c);
  const results = await Promise.allSettled([service.reserve(c, model('a')), service.reserve(c, model('b'))]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const failed = results.find(result => result.status === 'rejected'); assert.ok(failed?.status === 'rejected' && code('budget_exhausted')(failed.reason));
  const saved = await service.read(c); assert.equal(saved.used.modelCalls, 1); assert.equal(saved.attempts.length, 1);
});

test('tool batch is all-or-nothing and all categories consume permanently, including unknown', async () => {
  const { service } = fixture(), c = context(); await service.open(c);
  const batch: BudgetAttempt = { key: 'original-batch', fingerprint: digest('batch'), kind: 'tool_batch', units: 6 };
  await service.reserve(c, batch); await service.settle(c, batch, { status: 'unknown' });
  await assert.rejects(service.reserve(c, { ...batch, key: 'too-large', units: 3 }), code('budget_exhausted'));
  await service.reserve(c, { ...batch, key: 'last-batch', units: 2 });
  await service.reserve(c, { key: 'embedding', fingerprint: digest('query'), kind: 'embedding', units: 1 });
  const saved = await service.read(c); assert.deepEqual(saved.used, { modelCalls: 0, toolCalls: 8, queryEmbeddings: 1 }); assert.equal(saved.attempts.length, 3);
  await assert.rejects(service.settle(c, batch, { status: 'known', reference: 'receipt' }), code('settlement_conflict'));
});

test('lost commit response and a reconstructed adapter only permit lookup, with no refund or replay', async () => {
  const f = fixture(), c = context(); await f.service.open(c); f.loseNextReply();
  await assert.rejects(f.service.reserve(c, model()), /Synthetic lost commit response/);
  const restarted = new FirestoreRootBudget(f.options); assert.equal((await restarted.open(c)).used.modelCalls, 1);
  assert.equal((await restarted.reserve(c, model())).decision, 'lookup');
  await restarted.settle(c, model(), { status: 'unknown' }); await restarted.settle(c, model(), { status: 'unknown' });
  assert.equal((await restarted.reserve(c, model())).attempt.outcome.status, 'unknown');
  assert.equal((await restarted.read(c)).used.modelCalls, 1);
});

test('settlement is exact-idempotent and known reference is not execution authority', async () => {
  const { service } = fixture(), c = context(); await service.open(c); await service.reserve(c, model());
  await service.settle(c, model(), { status: 'known', reference: 'synthetic-original-receipt' });
  await service.settle(c, model(), { status: 'known', reference: 'synthetic-original-receipt' });
  await assert.rejects(service.settle(c, model(), { status: 'known', reference: 'different-receipt' }), code('settlement_conflict'));
  await assert.rejects(service.settle(c, model('missing'), { status: 'unknown' }), code('attempt_not_found'));
  assert.equal((await service.reserve(c, model())).decision, 'lookup');
});

test('persistent stop is idempotent, rejects all admissions and fences late completion', async () => {
  const f = fixture(), c = context(); await f.service.open(c); await f.service.reserve(c, model());
  await f.service.stop(c); await f.service.stop(c);
  const restarted = new FirestoreRootBudget(f.options); assert.equal((await restarted.open(c)).status, 'stopped');
  for (const attempt of [model(), model('new')]) await assert.rejects(restarted.reserve(c, attempt), code('root_stopped'));
  await assert.rejects(restarted.settle(c, model(), { status: 'known', reference: 'late' }), code('root_stopped'));
  const saved = await restarted.read(c); assert.equal(saved.attempts[0].outcome.status, 'reserved'); assert.equal(saved.used.modelCalls, 1);
});

test('absolute trusted clock deadline is not renewed and expiry blocks open/admission/late settlement', async () => {
  const f = fixture(), c = context(); await f.service.open(c); await f.service.reserve(c, model()); f.setNow(c.binding.deadlineAtMs);
  await assert.rejects(f.service.open(c), code('deadline_exceeded')); await assert.rejects(f.service.reserve(c, model()), code('deadline_exceeded'));
  await assert.rejects(f.service.settle(c, model(), { status: 'known', reference: 'late' }), code('deadline_exceeded'));
  assert.equal((await f.service.read(c)).status, 'expired');
  await assert.rejects(f.service.open(context({ rootRunId: 'expired-new' })), code('deadline_exceeded'));
  await assert.rejects(f.service.reserve({ ...c, now: 1 } as RootBudgetContext, model()), code('invalid_context'));
  f.setNow(NaN); await assert.rejects(f.service.read(c), code('invalid_server_clock'));
});

test('invalid attempt/limits/reference is rejected without writes, including malformed unicode and caller time', async () => {
  const f = fixture(), c = context(); await f.service.open(c); const before = structuredClone([...f.records]);
  for (const attempt of [{ ...model(), units: 0 }, { ...model(), units: 2 }, { ...model(), fingerprint: 'not-a-digest' },
    { ...model(), key: '界'.repeat(86) }, { ...model(), key: '\ud800' }, { ...model(), now: 1 }]) {
    await assert.rejects(f.service.reserve(c, attempt as BudgetAttempt), code('invalid_attempt'));
  }
  for (const limits of [{ modelCalls: 13, toolCalls: 8, queryEmbeddings: 6 }, { modelCalls: 4, toolCalls: 17, queryEmbeddings: 2 },
    { modelCalls: 4, toolCalls: 8, queryEmbeddings: 7 }, { modelCalls: 0, toolCalls: 8, queryEmbeddings: 2 }]) {
    await assert.rejects(f.service.open(context({ limits })), code('invalid_context'));
  }
  for (const authorizationVersion of [1, '', 'a'.repeat(257)]) {
    await assert.rejects(f.service.open({ ...c, binding: { ...c.binding, authorizationVersion } } as RootBudgetContext), code('invalid_context'));
  }
  await assert.rejects(f.service.settle(c, model(), { status: 'known', reference: 'a'.repeat(513) }), code('invalid_settlement'));
  assert.deepEqual([...f.records], before);
});

test('encrypted records bind project/namespace/root, expose no account metadata and reject tampering or missing ciphertext', async () => {
  const f = fixture(), c = context(); await f.service.open(c); const [path, record] = [...f.records][0];
  assert.deepEqual(Object.keys(record as object).sort(), ['ciphertext', 'format', 'version']);
  assert.doesNotMatch(JSON.stringify([...f.records]), /synthetic-owner|synthetic-child|synthetic-root|synthetic-message/);
  const otherProject = new FirestoreRootBudget({ ...f.options, projectId: 'other-project' }); await assert.rejects(otherProject.read(c), code('ciphertext_rejected'));
  for (const bad of [{ format: 'yuban-root-budget', version: 1 }, { ...(record as object), ciphertext: 'yb1.tampered' }]) {
    f.records.set(path, bad); await assert.rejects(f.service.read(c), code('ciphertext_rejected'));
  }
  f.records.set(path, record);
  const other = context({ rootRunId: 'other-root' }); f.records.set(`budget_unit/${digest('other-root')}`, record);
  await assert.rejects(f.service.read(other), code('ciphertext_rejected'));
  f.records.set(`other_namespace/${digest(c.binding.rootRunId)}`, record);
  await assert.rejects(new FirestoreRootBudget({ ...f.options, namespace: 'other_namespace' }).read(c), code('ciphertext_rejected'));
});

test('legacy 26 admitted entries and encrypted UTF-8 document bound fail closed without partial writes', async () => {
  const f = fixture(), c = context({ limits: { modelCalls: 12, toolCalls: 8, queryEmbeddings: 6 } }); await f.service.open(c);
  for (const [kind, total] of [['model', 12], ['tool_batch', 8], ['embedding', 6]] as const) {
    for (let i = 0; i < total; i++) await f.service.reserve(c, { key: `${kind}-${i}`, fingerprint: digest(`${kind}-${i}`), kind, units: 1 });
  }
  assert.equal((await f.service.read(c)).attempts.length, 26); assert.ok(Buffer.byteLength(JSON.stringify([...f.records][0][1])) < MAX_ROOT_BUDGET_BYTES);
  await assert.rejects(f.service.reserve(c, model('overflow')), code('budget_exhausted'));
  const before = structuredClone([...f.records]);
  const oversized = new FirestoreRootBudget({ ...f.options, cipher: { ...f.options.cipher, encrypt: () => '界'.repeat(MAX_ROOT_BUDGET_BYTES / 2) } });
  await assert.rejects(oversized.stop(c), code('document_too_large')); assert.deepEqual([...f.records], before);
  const [path, record] = [...f.records][0]; f.records.set(path, { ...(record as object), ciphertext: 'a'.repeat(MAX_ROOT_BUDGET_BYTES) });
  await assert.rejects(f.service.read(c), code('document_too_large'));
});


test('Firestore accepts current Agent limits, preserves every reservation and rejects overflow', async () => {
  const f = fixture();
  const platform = context({ rootRunId: 'current-platform', limits: { ...PLATFORM_AGENT_RUN_LIMITS, toolCalls: AGENT_LIMITS.toolCalls } });
  assert.deepEqual((await f.service.open(platform)).limits, platform.binding.limits);
  const budget = new AgentBudget();
  try {
    budget.configurePersonal({ modelCalls: PERSONAL_RUN_LIMITS.modelCalls.max, queryEmbeddings: PERSONAL_RUN_LIMITS.queryEmbeddings.max });
    const limits = { modelCalls: budget.limits.modelCalls, toolCalls: budget.limits.toolCalls, queryEmbeddings: budget.limits.queryEmbeddings };
    const c = context({ rootRunId: 'current-maximum', limits, deadlineAtMs: budget.deadlineAtMs });
    await budget.initializeDurable({ adapter: f.service, context: c });
    for (const [counter, kind] of [['modelCalls', 'model'], ['toolCalls', 'tool_batch'], ['queryEmbeddings', 'embedding']] as const) {
      for (let i = 0; i < limits[counter]; i++) await budget.admit({ key: `${kind}:${i}`, fingerprint: digest(`${kind}:${i}`), kind, units: 1 });
    }
    const reopened = new FirestoreRootBudget(f.options);
    assert.deepEqual((await reopened.read(c)).used, limits);
    assert.deepEqual(budget.counts, limits);
    const original: BudgetAttempt = { key: 'tool_batch:0', fingerprint: digest('tool_batch:0'), kind: 'tool_batch', units: 1 };
    assert.notEqual((await reopened.reserve(c, original)).decision, 'execute');
    await assert.rejects(reopened.reserve(c, { ...original, key: 'overflow' }), code('budget_exhausted'));
    const batch = context({ rootRunId: 'whole-tool-batch', limits });
    await reopened.open(batch);
    assert.equal((await reopened.reserve(batch, { ...original, units: limits.toolCalls })).snapshot.used.toolCalls, limits.toolCalls);
    const legacy = context();
    assert.deepEqual((await reopened.open(legacy)).limits, legacy.binding.limits);
  } finally { budget.close(); }
});
