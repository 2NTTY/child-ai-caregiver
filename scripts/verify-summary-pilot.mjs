import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Firestore } from '@google-cloud/firestore';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreMemoryStore } from '../server/firestore-memory.ts';
import { createFirestoreProductAgent } from '../server/firestore-product-agent.ts';
import { createFirestorePrivateSummaryInventory } from '../server/firestore-private-summary-inventory.ts';
import { FirestoreDomainData, firestoreDomainHash } from '../server/firestore-domain-data.ts';
import { summaryPartBackgroundIdentity } from '../server/private-summary-work.ts';
import { readContextBasis } from '../server/firestore-context-basis.ts';
import { prepareFirestoreBackgroundWork, readFirestoreBackgroundClaim, firestoreBackgroundWorkSchema } from '../server/firestore-background-work.ts';
import { createFirebaseWorkerServices } from '../server/firebase-worker-services.ts';
import { readAiConfig } from '../server/ai-config.ts';

const projectId = process.env.GCLOUD_PROJECT;
assert.match(projectId ?? '', /^demo-[a-z0-9-]+$/);
assert.match(process.env.FIRESTORE_EMULATOR_HOST ?? '', /^127\.0\.0\.1:\d{1,5}$/);
const db = new Firestore({ projectId });
const userId = 'summary-local-owner', email = 'owner@example.test';
const config = readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: projectId });
function stores({ namespace, key }) {
  assert.match(namespace, /^summary_[a-f0-9]{32}$/);
  const options = { projectId, database: db, namespace, cipher: createStorageCipher(Buffer.from(key, 'hex')) };
  const authority = createFirestoreAuthority(options), online = createFirestoreOnlineStore(options);
  const chat = createFirestoreChatStore(options), care = createFirestoreCareStore(options);
  const memory = createFirestoreMemoryStore({ ...options, chat, care });
  return { options, authority, online, chat, care, memory, data: new FirestoreDomainData(options) };
}

function historicalProjections(request) {
  return request.contents.flatMap(content => content.parts ?? []).flatMap(part => {
    const lines = part.text?.split('\n');
    if (!lines || lines.length !== 2) return [];
    try {
      const projection = JSON.parse(JSON.parse(lines[1]).text);
      return projection.mode === 'historical_batches_not_current_facts' ? [projection] : [];
    } catch { return []; }
  });
}

async function runWorker(input) {
  const { options, authority, online, chat, care, memory, data } = stores(input);
  const { childId, sponsor, action } = input, calls = [], chatRequests = [], fragments = [];
  const agent = {
    async generate(request) {
      if (Object.hasOwn(request.toolsDict, 'present_answer')) {
        chatRequests.push(historicalProjections(request));
        return { content: { role: 'model', parts: [{ functionCall: { id: randomUUID(), name: 'present_answer',
          args: { kind: 'clarification', paragraphs: [{ text: '你想跟進哪個安排？', citationIds: [] }] } } }] },
          finishReason: 'STOP', usageMetadata: { promptTokenCount: 10, totalTokenCount: 15 } };
      }
      assert.ok(Object.hasOwn(request.toolsDict, 'stage_private_summary'), 'Unexpected provider request');
      const payloads = request.contents.flatMap(c => c.parts ?? []).flatMap(p => {
        try { return [JSON.parse(p.text)]; } catch { return []; }
      });
      const batch = payloads.flatMap(payload => payload?.sourceMessages ?? []);
      const parts = payloads.filter(payload => payload?.purpose === 'private_summary_part/v1');
      let text;
      if (parts.length) {
        assert.equal(parts.length, 1);
        assert.equal(batch.length, 0);
        const { range, accumulator, text: source } = parts[0].fragment;
        fragments.push({ ...range, accumulator, hash: createHash('sha256').update(source).digest('hex') });
        text = '已整理至 ' + range.endUtf16;
        assert.ok(text.length <= parts[0].outputTextLimit);
      } else {
        assert.ok(batch.length);
        calls.push(batch.map(message => message.text));
        text = batch.map(message => message.text).join(' ');
      }
      return { content: { role: 'model', parts: [{ functionCall: { id: randomUUID(), name: 'stage_private_summary',
        args: { text } } }] }, finishReason: 'STOP',
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } };
    },
  };
  const offline = async () => { throw new Error('external_transport_disabled'); };
  const product = await createFirestoreProductAgent({ ...options, online, chat, care, memory, config,
    summarySponsor: sponsor, platformProviders: () => ({ agent, model: { generate: offline }, embedding: { embed: offline } }),
    async authorizeWorker(b, reference, recipe) {
      const claim = await readFirestoreBackgroundClaim(data, b, reference);
      return claim?.kind === 'memory-refresh' && recipe === 'memory-refresh';
    },
  });
  if (action === 'chat') {
    try {
      const result = await product.agent.reply(userId, childId, input.messageId, async () => true);
      return { status: result?.status ?? null, stopReason: result?.stopReason ?? null, chatRequests, summaryCalls: calls.length + fragments.length };
    } catch (error) {
      if (error.code !== 'account_inactive') throw error;
      return { status: 'revoked', chatRequests, summaryCalls: calls.length + fragments.length };
    }
  }
  if (action === 'gate') {
    const gate = await authority.runTransaction(userId, childId, b => product.summaryWork.readEntryGate(b));
    return { gate: gate.kind, reason: gate.reason, calls: calls.length + fragments.length };
  }
  if (action === 'context') {
    const value = await memory.context(userId, childId, 'private');
    return { text: value?.summary?.text, calls: calls.length + fragments.length };
  }
  const at = new Date(Date.now() - 500).toISOString();
  const id = input.jobId ?? await authority.runTransaction(userId, childId, async b => {
    const current = await readContextBasis(data, b);
    const job = await prepareFirestoreBackgroundWork(data, b.transaction, { kind: 'memory-refresh', scope: b.scope,
      resourceId: childId, basis: String(current.value.summaryRequest), generation: b.generation, authorizationVersion: b.authorizationVersion }, at);
    job.commit(); return job.id;
  });
  const runtime = { ...options, authority, product, config: { projectId, namespace: options.namespace, taskWorkerEnabled: true },
    async currentAuth() { return { disabled: false, emailVerified: true, email }; } };
  const worker = createFirebaseWorkerServices(runtime, { taskName: () => 'synthetic', enqueue: offline, probe: offline },
    { enqueue: offline, probe: offline }, new AbortController());
  const read = () => authority.runTransaction(userId, childId, async b =>
    data.open('background-work', id, b.scope, firestoreBackgroundWorkSchema, await b.transaction.get(data.ref('background_work', 'background-work', id))));
  const job = await read();
  await worker.background.process({ kind: 'product-work', id, generation: job.generation, dispatchRevision: job.dispatchRevision, scheduledAt: job.dueAt });
  const head = (await memory.summary(userId, childId)).summary;
  const result = { state: (await read()).state, calls, summary: head?.text };
  if (action !== 'multipart') return result;
  let workId = input.workId;
  if (!workId) {
    const lookup = await product.summaryWork.start(userId, childId, { kind: 'next_fresh' });
    assert.equal(lookup.kind, 'lookup', 'Scope worker must have created durable work');
    workId = lookup.work.id;
  }
  const { work, usage } = await product.summaryWork.readState(userId, childId, workId);
  return { ...result, fragments, workId, grantId: work.grantRecordId, used: usage.used,
    covered: head?.coveredMessageIds ?? [], published: work.finalReceipt?.kind === 'published',
    nextJob: work.state === 'ready' ? firestoreDomainHash(['product-work', summaryPartBackgroundIdentity(work)]) : null };
}

async function verifyMultipart({ chat, childId, namespace, processOnce, limits }) {
  // Backslashes in a synthetic pasted document also consume space in the real serialized request.
  const source = ('家長備註「原句」\n' + '\\'.repeat(32) + '\n').repeat(230);
  const message = await chat.createUserMessageForUser(userId, childId, source);
  const initial = await processOnce('multipart', true);
  assert.equal(initial.state, 'completed');
  assert.deepEqual(initial.fragments, []);
  assert.deepEqual(initial.calls, []);
  assert.deepEqual(initial.used, { modelCalls: 0, toolCalls: 0 });
  let cursor = 0, folded = null, result = initial, partCount = 0;
  while (result.nextJob && partCount < limits.modelCalls) {
    assert.deepEqual(result.covered, []);
    assert.equal(result.summary, undefined);
    const target = { jobId: result.nextJob, workId: initial.workId };
    result = await processOnce('multipart', true, target);
    assert.equal(result.state, 'completed');
    assert.equal(result.grantId, initial.grantId);
    assert.deepEqual(result.calls, []);
    assert.equal(result.fragments.length, 1);
    const [fragment] = result.fragments;
    assert.equal(fragment.unitIndex, 0);
    assert.equal(fragment.startUtf16, cursor);
    assert.equal(fragment.accumulator, folded);
    assert.ok(fragment.endUtf16 > cursor && fragment.endUtf16 <= source.length);
    assert.equal(fragment.hash, createHash('sha256').update(source.slice(cursor, fragment.endUtf16)).digest('hex'));
    cursor = fragment.endUtf16;
    folded = '已整理至 ' + cursor;
    partCount++;
    assert.deepEqual(result.used, { modelCalls: partCount, toolCalls: partCount });
    if (partCount === 1) {
      const replay = await processOnce('multipart', true, target);
      assert.deepEqual(replay, { ...result, fragments: [] });
    }
  }
  assert.ok(partCount > 1);
  assert.equal(cursor, source.length);
  assert.equal(result.published, true);
  assert.deepEqual(result.covered, [message.id]);
  assert.deepEqual(await processOnce('context', true), { text: folded, calls: 0 });
  console.log(JSON.stringify({ database: 'Firestore Emulator', namespace, sourceUnits: cursor, parts: partCount,
    workId: initial.workId, used: result.used, replayGenerations: 0, coldReadGenerations: 0, provider: 'scripted' }));
}
async function verify() {
  // Only this supervisor and its short-lived child ever receive this new namespace and its random cipher.
  const options = { namespace: 'summary_' + randomUUID().replaceAll('-', ''), key: randomBytes(32).toString('hex') };
  const { authority, online, chat, memory } = stores(options);
  const generation = randomUUID(), expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  await authority.initializeControl({ enabled: true, generation });
  await authority.issueInvitation({ email, expiresAt, operationId: randomUUID() });
  await authority.admitIdentity({ userId, email, emailVerified: true });
  await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const route = { path: '/api/children', payload: { displayName: 'Summary pilot' } };
  const context = await online.context(userId, route);
  const childId = (await online.submit(userId, { ...route, operation: { ...context, opId: randomUUID(), deviceId: randomUUID() } })).result.child.id;
  const sponsor = await authority.runTransaction(userId, childId, async b => ({ scope: b.scope, authorizationVersion: b.authorizationVersion,
    generation, limits: { modelCalls: 4, toolCalls: 8 }, expiresAt, payer: 'platform', model: config.model }));
  const processOnce = (action, funded, target = {}) => new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(import.meta.url), ['--worker'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    let message;
    const timeout = setTimeout(() => child.kill(), 65_000);
    child.once('message', result => { message = result; });
    child.once('error', reject);
    child.once('exit', code => {
      clearTimeout(timeout);
      if (code !== 0 || !message || message.error) reject(Error(message?.error ?? 'worker_exit_' + code));
      else resolve(message);
    });
    child.send({ ...options, childId, action, ...target, sponsor: funded ? sponsor : undefined });
  });
  const retired = await processOnce('gate', false);
  assert.equal(retired.gate, 'legacy');
  // The legacy process has exited. No workers start during the inventory transaction(s).
  // This proof applies only to the newly-created emulator namespace.
  const inventory = createFirestorePrivateSummaryInventory({ ...stores(options).options, async readEntryFence(b) {
    const control = await authority.readControl(b.transaction);
    return control.enabled && control.generation === generation && b.generation === generation && b.scope.childId === childId
      ? { scope: b.scope, authorizationVersion: b.authorizationVersion, workerGeneration: generation, entryFenceVersion: 'private-summary-entry/v1' } : null;
  } });
  const cutover = await authority.runTransaction(userId, childId, b => inventory.advance(b));
  assert.equal(cutover.cutover?.phase, 'complete');
  assert.deepEqual(await processOnce('gate', false), { gate: 'blocked', reason: 'policy_missing', calls: 0 });
  if (process.argv.includes('--multipart')) {
    return verifyMultipart({ chat, childId, namespace: options.namespace, processOnce, limits: sponsor.limits });
  }
  const first = '家長原先約了星期五。', second = '家長更正為星期六。';
  const original = await chat.createUserMessageForUser(userId, childId, first);
  const firstResult = await processOnce('work', true);
  assert.equal(firstResult.state, 'completed'); assert.deepEqual(firstResult.calls, [[first]]);
  assert.deepEqual(await processOnce('context', true), { text: first, calls: 0 });
  const values = { key: '見面日期', content: '星期六', source: { kind: 'manual', description: '本人核對' }, validUntil: null };
  const candidate = await memory.createFact(userId, childId, { values, intendedVisibility: 'private' });
  const fact = await memory.confirmFact(userId, childId, candidate.id, { expectedVersion: candidate.version, confirm: true, confirmShared: false });
  const changed = await chat.createUserMessageForUser(userId, childId, second);
  const secondResult = await processOnce('work', true);
  assert.equal(secondResult.state, 'completed'); assert.deepEqual(secondResult.calls, [[second]]);
  const restored = await processOnce('context', true);
  assert.deepEqual(restored, { text: second, calls: 0 });
  async function checkNewChat(expected) {
    const question = await chat.createUserMessageForUser(userId, childId, '想跟進之前講過的安排。');
    const result = await processOnce('chat', true, { messageId: question.id });
    assert.equal(result.status, 'completed', JSON.stringify(result));
    assert.equal(result.summaryCalls, 0);
    assert.ok(result.chatRequests.length > 0);
    for (const projections of result.chatRequests) {
      assert.equal(projections.length, 1);
      assert.deepEqual(projections[0].batches.map(batch => ({ sourceMessageIds: batch.sourceMessageIds, text: batch.text })), expected);
    }
    return { messageId: question.id, batchCount: result.chatRequests[0][0].batches.length };
  }
  const unchanged = { sourceMessageIds: [original.id], text: first };
  const before = await checkNewChat([unchanged, { sourceMessageIds: [changed.id], text: second }]);
  await memory.reviseFact(userId, childId, fact.id, { expectedVersion: fact.version, confirm: true, confirmShared: false,
    values: { ...values, content: '星期日' }, reason: '本人更正' });
  const after = await checkNewChat([unchanged]);
  await authority.setAccountState({ userId, operationId: randomUUID(), state: 'revoked' });
  await assert.rejects(processOnce('context', true), { message: 'account_inactive' });
  const revoked = await processOnce('chat', true, { messageId: after.messageId });
  assert.deepEqual(revoked, { status: 'revoked', chatRequests: [], summaryCalls: 0 });
  console.log(JSON.stringify({ database: 'Firestore Emulator', namespace: options.namespace, originalWriter: 'blocked',
    generatedBatches: [1, 1], restartedContextCalls: 0, correctionReadBack: true, revokedAccountRead: 'denied', provider: 'scripted',
    coldChatBatchCountsBeforeAndAfterSourceCorrection: [before.batchCount, after.batchCount], revokedChatProviderCalls: revoked.chatRequests.length }));
}
try {
  if (process.argv[2] === '--worker') {
    await new Promise(resolve => process.once('message', async input => {
      try { process.send(await runWorker(input)); } catch (e) { process.send({ error: String(e.code ?? e.message) }); }
      finally { process.disconnect(); resolve(); }
    }));
  } else await verify();
} finally { await db.terminate(); }
