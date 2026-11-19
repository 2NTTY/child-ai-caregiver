import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { FinishReason } from '@google/genai';
import { AgentStopped } from '../server/agent-budget.ts';
import { originalKnowledgePdf } from '../server/agent-model-gateway.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { createEmbeddingGateway } from '../server/embedding-gateway.ts';
import { FirestoreAiUsage } from '../server/firestore-ai-usage.ts';
import { FirestoreRootBudget } from '../server/firestore-root-budget.ts';
import { requireDurableUsage, createFirestoreModelRouting, type FirestoreModelRouting } from '../server/firestore-model-routing.ts';
import { createPrivateSourceModelSession } from '../server/private-source-model-session.ts';
import { firestoreUsageFixture } from './helpers/firestore-ai-usage.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import type { ModelBillingSource } from '../src/shared/model-settings.ts';

const stopped = (reason: string) => (error: unknown) => error instanceof AgentStopped && error.reason === reason;
async function fixture(billingSource: ModelBillingSource = 'platform', interactive = false) {
  const f = firestoreUsageFixture(Date.now());
  const daily = new FirestoreAiUsage({ ...f.options, billingSource });
  const root = new FirestoreRootBudget({ ...f.options, namespace: 'synthetic_private_root' });
  const config = { ...readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'synthetic-project' }), agentMaxRetries: 0 };
  let models = 0, vectors = 0, live = true, policy = true, settings = true;
  let onModel = () => {}, onEmbedding = () => {};
  const gateway = createEmbeddingGateway({ config, billingSource, usage: requireDurableUsage,
    provider: { async embed() { vectors++; onEmbedding(); return { values: [1, ...Array<number>(1023).fill(0)], inputTokens: 4, billableCharacters: 15 }; } } });
  const selected = { config, billingSource, settingsVersion: 'synthetic-settings:policy:1', dailyUsage: daily,
    runLimits: { modelCalls: 4, toolCalls: 8, queryEmbeddings: 4, deadlineMs: 90000 },
    authorize: async () => settings,
    readPolicyTransition: async () => policy ? null : { enabled: false },
    embeddings: gateway,
    provider: { async generate(request: { contents: unknown }) {
      models++; onModel();
      assert.ok(JSON.stringify(request.contents).includes('application/pdf'));
      return { content: { role: 'model', parts: [{ text: 'Synthetic reviewed content' }] }, finishReason: FinishReason.STOP,
        usageMetadata: { promptTokenCount: 8, totalTokenCount: 12 } };
    } },
  };
  const triggers: string[] = [];
  const routing = { async resolve(owner: string, trigger: string) {
    assert.equal(owner, 'synthetic-owner'); triggers.push(trigger); return selected;
  } } as unknown as Pick<FirestoreModelRouting, 'resolve'>;
  const options = { routing, rootBudget: root, owner: 'synthetic-owner', scope: { ownerUserId: 'synthetic-owner',
    workspaceId: randomUUID(), childId: randomUUID(), storageEpoch: randomUUID() },
    authorizationVersion: '7', rootRunId: randomUUID(), reference: 'synthetic-original:version:1',
    signal: new AbortController().signal, authorize: async () => live, interactive, deadlineAtMs: Date.now() + 90000 };
  const bytes = Buffer.from('%PDF-1.7 synthetic private original');
  const pdf = originalKnowledgePdf(bytes, createHash('sha256').update(bytes).digest('hex'));
  const input = { system: 'Synthetic reader', user: 'Read the authorized original', attemptKey: 'model:read-original', pdf };
  return { f, daily, root, options, input, triggers,
    counts: () => ({ models, vectors }), revoke: () => { live = false; }, changeSettings: () => { settings = false; },
    changePolicy: () => { policy = false; }, afterModel: (callback: () => void) => { onModel = callback; },
    afterEmbedding: (callback: () => void) => { onEmbedding = callback; } };
}

for (const payer of ['platform', 'personal'] as const) test(`private stages retain ${payer} payer and charge model/PDF and document vectors once`, async () => {
  const f = await fixture(payer), session = await createPrivateSourceModelSession(f.options);
  try {
    assert.equal(session.billingSource, payer); assert.equal(session.settingsVersion, 'synthetic-settings:policy:1');
    assert.equal(await session.completeText(f.input), 'Synthetic reviewed content');
    assert.equal((await session.embed({ task: 'RETRIEVAL_DOCUMENT', title: 'Synthetic source', text: 'Synthetic approved content' }, 'embedding:segment:1')).length, 1024);
    await assert.rejects(session.embed({ task: 'RETRIEVAL_DOCUMENT', title: 'Synthetic source', text: 'Synthetic approved content' }, 'embedding:segment:1'), stopped('unavailable'));
    assert.deepEqual(f.counts(), { models: 1, vectors: 1 });
    assert.equal((await f.daily.getForUser(f.options.owner)).attempts, 2);
    assert.equal((await f.daily.getForUser('other-owner')).attempts, 0);
    const global = await f.daily.getGlobal(new Date().toISOString().slice(0, 10));
    assert.equal(global.breakdown.model, 1); assert.equal(global.breakdown.documentEmbedding, 1);
    assert.equal(global.breakdown.otherEmbedding, 0); assert.equal(global.maintenanceFinance?.unsettledAttempts ?? 0, 0);
    assert.deepEqual(f.triggers, ['private-source-worker']);
  } finally { session.close(); }
  const recovered = await createPrivateSourceModelSession(f.options);
  try { await assert.rejects(recovered.completeText(f.input), stopped('unavailable')); }
  finally { recovered.close(); }
  assert.deepEqual(f.counts(), { models: 1, vectors: 1 });
  assert.equal((await f.daily.getForUser(f.options.owner)).attempts, 2);
});

test('interactive sessions only admit query vectors, while background sessions only admit document vectors', async () => {
  const f = await fixture('personal', true), session = await createPrivateSourceModelSession(f.options);
  try {
    await assert.rejects(session.completeText(f.input), stopped('unauthorized'));
    await assert.rejects(session.embed({ task: 'RETRIEVAL_DOCUMENT', title: 'Source', text: 'Synthetic' }, 'embedding:document'), stopped('unauthorized'));
    assert.equal((await session.embed({ task: 'RETRIEVAL_QUERY', text: 'Synthetic query' }, 'embedding:query')).length, 1024);
    assert.deepEqual(f.triggers, ['interactive']);
    assert.deepEqual(f.counts(), { models: 0, vectors: 1 });
    const global = await f.daily.getGlobal(new Date().toISOString().slice(0, 10));
    assert.equal(global.breakdown.queryEmbedding, 1); assert.equal(global.breakdown.documentEmbedding, 0);
  } finally { session.close(); }
  const worker = await fixture(), background = await createPrivateSourceModelSession(worker.options);
  try {
    await assert.rejects(background.embed({ task: 'RETRIEVAL_QUERY', text: 'Synthetic' }, 'embedding:query'), stopped('unauthorized'));
    await assert.rejects(background.completeText({ ...worker.input, imageIds: ['unbound-image'] }), stopped('unauthorized'));
    assert.deepEqual(worker.counts(), { models: 0, vectors: 0 });
  } finally { background.close(); }
});

for (const revocation of ['original', 'settings', 'policy'] as const) test(`${revocation} revocation during provider dispatch denies both returned content and vectors`, async () => {
  for (const kind of ['model', 'embedding'] as const) {
    const f = await fixture(), session = await createPrivateSourceModelSession(f.options);
    const revoke = revocation === 'original' ? f.revoke : revocation === 'settings' ? f.changeSettings : f.changePolicy;
    if (kind === 'model') f.afterModel(revoke); else f.afterEmbedding(revoke);
    try {
      if (kind === 'model') await assert.rejects(session.completeText(f.input), stopped('unauthorized'));
      else await assert.rejects(session.embed({ task: 'RETRIEVAL_DOCUMENT', title: 'Source', text: 'Synthetic content' }, 'embedding:original'), stopped('unauthorized'));
      assert.equal((await f.daily.getForUser(f.options.owner)).attempts, 1);
      assert.deepEqual(f.counts(), { models: kind === 'model' ? 1 : 0, vectors: kind === 'embedding' ? 1 : 0 });
    } finally { session.close(); }
  }
});

test('owner mismatch and lost daily acknowledgement never fall back or dispatch again', async () => {
  const f = await fixture();
  await assert.rejects(createPrivateSourceModelSession({ ...f.options, owner: 'other-owner' }), stopped('unauthorized'));
  const session = await createPrivateSourceModelSession(f.options);
  const reserve = f.daily.reserve.bind(f.daily);
  f.daily.reserve = async (...args) => { f.f.loseReply(); return reserve(...args); };
  try {
    const embed = () => session.embed({ task: 'RETRIEVAL_DOCUMENT', title: 'Source', text: 'Synthetic content' }, 'embedding:original');
    await assert.rejects(embed(), stopped('unavailable'));
    await assert.rejects(embed(), stopped('unavailable'));
    assert.deepEqual(f.counts(), { models: 0, vectors: 0 });
    assert.equal((await f.daily.getForUser(f.options.owner)).attempts, 1);
  } finally { session.close(); }
});

test('private document actors require the original durable payer, owner, root, trigger and task', async () => {
  const f = firestoreUsageFixture(Date.now());
  let providers = 0;
  const gateway = createEmbeddingGateway({ config: readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'synthetic-project' }),
    usage: requireDurableUsage, provider: { async embed() { providers++; throw new Error('Unexpected provider dispatch'); } } });
  const context = { generation: 1, binding: { rootRunId: randomUUID(), ownerId: 'owner', workspaceId: randomUUID(), childId: randomUUID(),
    authorizationVersion: '1', storageEpoch: randomUUID(), trigger: { kind: 'private-source-index', reference: 'source:1' },
    workflowVersion: 'synthetic', promptPackVersion: 'synthetic', settingsVersion: 'synthetic', billingVersion: 'platform',
    limits: { modelCalls: 4, toolCalls: 8, queryEmbeddings: 2 }, deadlineAtMs: Date.now() + 60000 } };
  const actor = { kind: 'private_document_embedding' as const, actorId: 'owner', operationId: context.binding.rootRunId };
  const input = { task: 'RETRIEVAL_DOCUMENT' as const, title: 'Source', text: 'Synthetic content' };
  const daily = { adapter: f.service, context, attemptKey: 'embedding:original', revalidate: async () => {} };
  const signal = new AbortController().signal;
  await assert.rejects(gateway.embed(input, actor, signal, async () => true), stopped('unavailable'));
  await assert.rejects(gateway.embed(input, { ...actor, actorId: 'other' }, signal, async () => true, daily), stopped('unavailable'));
  await assert.rejects(gateway.embed(input, { ...actor, operationId: randomUUID() }, signal, async () => true, daily), stopped('unavailable'));
  await assert.rejects(gateway.embed(input, actor, signal, async () => true,
    { ...daily, context: { ...context, binding: { ...context.binding, trigger: { ...context.binding.trigger, kind: 'interactive' } } } }), stopped('unavailable'));
  await assert.rejects(gateway.embed({ task: 'RETRIEVAL_QUERY', text: 'Synthetic query' }, actor, signal, async () => true, daily), stopped('unavailable'));
  await assert.rejects(gateway.embed(input, { ...actor, kind: 'corpus_maintenance' }, signal, async () => true, daily), stopped('unavailable'));
  await assert.rejects(gateway.embed(input, actor, signal, async () => true,
    { ...daily, adapter: new FirestoreAiUsage({ ...f.options, billingSource: 'personal' }) }), stopped('unavailable'));
  assert.equal(providers, 0); assert.equal(f.records.size, 0);
});

test('real routing preserves personal background opt-in and existing maintenance boundaries', async () => {
  const f = firestoreDomainFixture(), options = { database: f.database, cipher: createStorageCipher(Buffer.alloc(32, 11)),
    projectId: 'synthetic-project', namespace: 'synthetic_private_routing' };
  const authority = createFirestoreAuthority(options);
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  await authority.issueInvitation({ email: 'owner@example.test', expiresAt: new Date(Date.now() + 60000).toISOString(), operationId: randomUUID() });
  await authority.admitIdentity({ userId: 'owner', email: 'owner@example.test', emailVerified: true });
  await authority.acknowledge({ userId: 'owner', operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const routing = createFirestoreModelRouting(options, readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'synthetic-project' }));
  const command = { opId: randomUUID(), expectedVersion: 0, mode: 'personal' as const, provider: 'gemini' as const,
    apiKey: 'synthetic-personal-key-not-a-credential', model: 'gemini-2.5-flash', dailyLimit: 100, maxModelCalls: 4,
    maxQueryEmbeddings: 2, consent: true, backgroundEnabled: false };
  await routing.settings.save('owner', command);
  assert.equal((await routing.resolve('owner', 'private-source-worker')).config.enabled, false);
  assert.equal((await routing.resolve('owner', 'worker')).config.enabled, false);
  assert.equal((await routing.resolve('owner', 'interactive')).config.enabled, true);
  await routing.settings.save('owner', { ...command, opId: randomUUID(), expectedVersion: 1, backgroundEnabled: true });
  const selected = await routing.resolve('owner', 'private-source-worker');
  assert.equal(selected.config.enabled, true); assert.equal(selected.billingSource, 'personal');
  assert.equal(selected.maintenanceEmbedding, undefined); assert.equal(await selected.authorize(), true);
  await assert.rejects(routing.resolve('owner', 'knowledge-maintenance'), stopped('unauthorized'));
  const context = { generation: 1, binding: { rootRunId: randomUUID(), ownerId: 'owner', workspaceId: randomUUID(), childId: randomUUID(),
    authorizationVersion: '1', storageEpoch: randomUUID(), trigger: { kind: 'private-source-index', reference: 'source:1' },
    workflowVersion: 'synthetic', promptPackVersion: 'synthetic', settingsVersion: selected.settingsVersion,
    billingVersion: 'personal', limits: { modelCalls: 4, toolCalls: 8, queryEmbeddings: 2 }, deadlineAtMs: Date.now() + 60000 } };
  const actor = { kind: 'private_document_embedding' as const, actorId: 'owner', operationId: context.binding.rootRunId };
  const durable = { context, adapter: selected.dailyUsage, attemptKey: 'embedding:original', revalidate: async () => {} };
  // Invalid content is checked after routing authorization, without any provider call.
  await assert.rejects(selected.embeddings.embed({ task: 'RETRIEVAL_DOCUMENT', title: 'Source', text: '' }, actor,
    new AbortController().signal, async () => true, durable), { code: 'invalid_input' });
  const worker = await routing.resolve('owner', 'worker');
  await assert.rejects(worker.embeddings.embed({ task: 'RETRIEVAL_DOCUMENT', title: 'Source', text: '' }, actor,
    new AbortController().signal, async () => true, durable), { code: 'unauthorized' });
  assert.throws(() => selected.embeddings.embed({ task: 'RETRIEVAL_DOCUMENT', title: 'Source', text: 'Synthetic' }, actor,
    new AbortController().signal, async () => true), stopped('unavailable'));
});
