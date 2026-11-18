import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
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
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
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
async function runWorker(input) {
  const { options, authority, online, chat, care, memory, data } = stores(input);
  const { childId, sponsor, action } = input, calls = [];
  const product = await createFirestoreProductAgent({ ...options, online, chat, care, memory, config,
    summarySponsor: sponsor,
    async authorizeWorker(b, reference, recipe) {
      const claim = await readFirestoreBackgroundClaim(data, b, reference);
      return claim?.kind === 'memory-refresh' && recipe === 'memory-refresh';
    },
    platformProvider: { async generate(request) {
      const batch = request.contents.flatMap(c => c.parts ?? []).flatMap(p => {
        try { return JSON.parse(p.text).sourceMessages ?? []; } catch { return []; }
      });
      assert.ok(batch.length);
      calls.push(batch.map(m => m.text));
      return { content: { role: 'model', parts: [{ functionCall: { id: randomUUID(), name: 'stage_private_summary',
        args: { text: batch.map(m => m.text).join(' ') } } }] }, finishReason: 'STOP',
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } };
    } },
  });
  if (action === 'gate') {
    const gate = await authority.runTransaction(userId, childId, b => product.summaryWork.readEntryGate(b));
    return { gate: gate.kind, reason: gate.reason, calls: calls.length };
  }
  if (action === 'context') {
    const value = await memory.context(userId, childId, 'private');
    return { text: value?.summary?.text, calls: calls.length };
  }
  const at = new Date(Date.now() - 500).toISOString();
  const id = await authority.runTransaction(userId, childId, async b => {
    const current = await readContextBasis(data, b);
    const job = await prepareFirestoreBackgroundWork(data, b.transaction, { kind: 'memory-refresh', scope: b.scope,
      resourceId: childId, basis: String(current.value.summaryRequest), generation: b.generation, authorizationVersion: b.authorizationVersion }, at);
    job.commit(); return job.id;
  });
  const offline = async () => { throw new Error('external_transport_disabled'); };
  const runtime = { ...options, authority, product, config: { projectId, namespace: options.namespace, taskWorkerEnabled: true },
    async currentAuth() { return { disabled: false, emailVerified: true, email }; } };
  const worker = createFirebaseWorkerServices(runtime, { taskName: () => 'synthetic', enqueue: offline, probe: offline },
    { enqueue: offline, probe: offline }, new AbortController());
  const read = () => authority.runTransaction(userId, childId, async b =>
    data.open('background-work', id, b.scope, firestoreBackgroundWorkSchema, await b.transaction.get(data.ref('background_work', 'background-work', id))));
  const job = await read();
  await worker.background.process({ kind: 'product-work', id, generation: job.generation, dispatchRevision: job.dispatchRevision, scheduledAt: job.dueAt });
  return { state: (await read()).state, calls, summary: (await memory.summary(userId, childId)).summary?.text };
}
async function verify() {
  // Only this supervisor and its short-lived child ever receive this new namespace and its random cipher.
  const options = { namespace: 'summary_' + randomUUID().replaceAll('-', ''), key: randomBytes(32).toString('hex') };
  const { authority, online, chat } = stores(options);
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
  const processOnce = (action, funded) => new Promise((resolve, reject) => {
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
    child.send({ ...options, childId, action, sponsor: funded ? sponsor : undefined });
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
  const first = '家長原先約了星期五。', second = '家長更正為星期六。';
  await chat.createUserMessageForUser(userId, childId, first);
  const firstResult = await processOnce('work', true);
  assert.equal(firstResult.state, 'completed'); assert.deepEqual(firstResult.calls, [[first]]);
  assert.deepEqual(await processOnce('context', true), { text: first, calls: 0 });
  await chat.createUserMessageForUser(userId, childId, second);
  const secondResult = await processOnce('work', true);
  assert.equal(secondResult.state, 'completed'); assert.deepEqual(secondResult.calls, [[second]]);
  const restored = await processOnce('context', true);
  assert.deepEqual(restored, { text: second, calls: 0 });
  await authority.setAccountState({ userId, operationId: randomUUID(), state: 'revoked' });
  await assert.rejects(processOnce('context', true), { message: 'account_inactive' });
  console.log(JSON.stringify({ database: 'Firestore Emulator', namespace: options.namespace, originalWriter: 'blocked',
    generatedBatches: [1, 1], restartedContextCalls: 0, correctionReadBack: true, revokedAccountRead: 'denied', provider: 'scripted' }));
}
try {
  if (process.argv[2] === '--worker') {
    await new Promise(resolve => process.once('message', async input => {
      try { process.send(await runWorker(input)); } catch (e) { process.send({ error: String(e.code ?? e.message) }); }
      finally { process.disconnect(); resolve(); }
    }));
  } else await verify();
} finally { await db.terminate(); }
