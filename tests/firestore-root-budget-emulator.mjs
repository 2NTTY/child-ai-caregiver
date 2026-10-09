import { port, host, projectId, connections, blocked } from './firestore-session-emulator-guard.mjs';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
const { Firestore } = await import('@google-cloud/firestore');
const { FirestoreRootBudget, MAX_ROOT_BUDGET_BYTES } = await import('../server/firestore-root-budget.ts');
const { createStorageCipher } = await import('../server/storage-crypto.ts');
const digest = value => createHash('sha256').update(value).digest('hex');
const namespace = `budget_contract_${randomBytes(8).toString('hex')}`;
const database = new Firestore({ projectId, host: '127.0.0.1', port, ssl: false, ignoreUndefinedProperties: false });
const cipher = createStorageCipher(Buffer.alloc(32, 47));
const options = { database, projectId, namespace, cipher };
const service = new FirestoreRootBudget(options);
const roots = new Set(), children = new Set(), results = [], childAudits = [];
const output = process.argv[3];
const summary = { projectId, host, namespace, results, childAudits, realProviders: 0, syntheticOnly: true, runtimeWired: false, sqlEffectFencing: false };
function context(rootRunId, patch = {}) {
  roots.add(rootRunId);
  return { generation: 4, binding: { rootRunId, ownerId: 'synthetic-owner', workspaceId: 'synthetic-workspace', childId: 'synthetic-child',
    authorizationVersion: 'original-auth-version', storageEpoch: 'epoch-1', trigger: { kind: 'message', reference: 'synthetic-original-message' },
    workflowVersion: 'workflow-1', promptPackVersion: 'pack-1', settingsVersion: 'settings-1', billingVersion: 'billing-1',
    limits: { modelCalls: 4, toolCalls: 8, queryEmbeddings: 2 }, deadlineAtMs: Date.now() + 90_000, ...patch } };
}
const model = (key, payload = key) => ({ key, fingerprint: digest(payload), kind: 'model', units: 1 });
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);
function launch(c, attempt, dropReply = false) {
  const child = fork(new URL('./firestore-root-budget-process.mjs', import.meta.url), [String(port), JSON.stringify({ namespace, context: c, attempt, dropReply })],
    { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  children.add(child); let value, resolveReady; const ready = new Promise(resolve => { resolveReady = resolve; }); let diagnostic = '';
  child.stdout.on('data', data => { diagnostic += data.toString(); }); child.stderr.on('data', data => { diagnostic += data.toString(); });
  child.on('message', message => { if (message.ready) resolveReady(); else if (message.audit) childAudits.push({ pid: child.pid, ...message.audit }); else value = message; });
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Synthetic child timeout')); }, 30_000);
    child.once('error', reject);
    child.once('exit', (code, signal) => { clearTimeout(timer); children.delete(child);
      if (code !== 0 || !value) reject(new Error(`Child failed: ${code}/${signal}: ${diagnostic}`)); else resolve(value); });
  });
  // Attach the rejection handler now so an early exit cannot become unhandled.
  done.catch(() => {});
  return { ready: Promise.race([ready, done.then(() => { throw new Error('Child exited before start'); })]), done, start: () => child.send({ start: true }) };
}
async function race(c, attempts) {
  const workers = attempts.map(attempt => launch(c, attempt)); await Promise.all(workers.map(worker => worker.ready));
  for (const worker of workers) worker.start(); return Promise.all(workers.map(worker => worker.done));
}
async function one(c, attempt, dropReply = false) { const worker = launch(c, attempt, dropReply); await worker.ready; worker.start(); return worker.done; }
async function check(name, callback) {
  const start = Date.now();
  try { await callback(); results.push({ name, passed: true, milliseconds: Date.now() - start }); }
  catch (error) { results.push({ name, passed: false, message: error.message, code: error.code ?? null }); throw error; }
  finally { await writeFile(output, JSON.stringify(summary, null, 2) + '\n'); }
}
try {
  await check('independent processes share one same-key permit and immutable binding', async () => {
    const c = context('same-key'); await service.open(c);
    const values = await race(c, [model('original-step'), model('original-step')]);
    assert.notEqual(values[0].pid, values[1].pid);
    assert.deepEqual(values.map(value => value.admission.decision).sort(), ['execute', 'lookup']);
    assert.equal((await service.read(c)).used.modelCalls, 1);
    const conflict = await one(c, model('original-step', 'changed')); assert.equal(conflict.error, 'attempt_conflict');
    for (const patch of [{ ownerId: 'other-owner' }, { authorizationVersion: 'changed-auth-version' }, { storageEpoch: 'epoch-2' }]) {
      await rejects(service.read({ ...c, binding: { ...c.binding, ...patch } }), 'binding_conflict');
    }
    await rejects(service.reserve({ ...c, generation: 5 }, model('other')), 'generation_conflict');
  });
  await check('different processes compete for last slot and restart preserves counts', async () => {
    const c = context('last-slot', { limits: { modelCalls: 1, toolCalls: 8, queryEmbeddings: 2 } }); await service.open(c);
    const values = await race(c, [model('a'), model('b')]);
    assert.equal(values.filter(value => value.admission?.decision === 'execute').length, 1);
    assert.equal(values.filter(value => value.error === 'budget_exhausted').length, 1);
    const winner = values.find(value => value.admission)?.admission.attempt.key;
    const restart = await one(c, model(winner)); assert.equal(restart.opened.used.modelCalls, 1); assert.equal(restart.admission.decision, 'lookup');
    assert.equal((await service.read(c)).attempts.length, 1);
  });
  await check('committed lost reply and unknown cannot refund or reissue execution', async () => {
    const c = context('lost-reply'); await service.open(c);
    assert.equal((await one(c, model('original-step'), true)).committedReplyLost, true);
    assert.equal((await one(c, model('original-step'))).admission.decision, 'lookup');
    await service.settle(c, model('original-step'), { status: 'unknown' }); await service.settle(c, model('original-step'), { status: 'unknown' });
    const duplicate = await one(c, model('original-step')); assert.equal(duplicate.admission.attempt.outcome.status, 'unknown');
    assert.equal(duplicate.admission.snapshot.used.modelCalls, 1);
    await rejects(service.settle(c, model('original-step'), { status: 'known', reference: 'new-result' }), 'settlement_conflict');
  });
  await check('batch is atomic and persisted stop/deadline fence late completion', async () => {
    const c = context('batch-stop'); await service.open(c);
    const batch = { key: 'original-batch', fingerprint: digest('batch'), kind: 'tool_batch', units: 6 };
    await service.reserve(c, batch);
    await rejects(service.reserve(c, { ...batch, key: 'oversized', units: 3 }), 'budget_exhausted');
    assert.equal((await service.read(c)).used.toolCalls, 6); assert.equal((await service.read(c)).attempts.length, 1);
    await service.stop(c); await service.stop(c);
    await rejects(service.reserve(c, batch), 'root_stopped');
    await rejects(service.settle(c, batch, { status: 'known', reference: 'late' }), 'root_stopped');
    assert.equal((await new FirestoreRootBudget(options).read(c)).attempts[0].outcome.status, 'reserved');
    const expiry = context('deadline', { deadlineAtMs: Date.now() + 1000 }); await service.open(expiry); await service.reserve(expiry, model('step'));
    await new Promise(resolve => setTimeout(resolve, Math.max(0, expiry.binding.deadlineAtMs - Date.now()) + 5));
    await rejects(service.open(expiry), 'deadline_exceeded'); await rejects(service.reserve(expiry, model('step')), 'deadline_exceeded');
    await rejects(service.settle(expiry, model('step'), { status: 'known', reference: 'late' }), 'deadline_exceeded');
    assert.equal((await service.read(expiry)).status, 'expired');
  });
  await check('encrypted bounded document rejects tampering/oversize while caller client remains usable', async () => {
    const c = context('cipher-bound'); await service.open(c); await service.reserve(c, model('step'));
    const ref = database.collection(namespace).doc(digest(c.binding.rootRunId)), original = (await ref.get()).data();
    assert.deepEqual(Object.keys(original).sort(), ['ciphertext', 'format', 'version']);
    assert.doesNotMatch(JSON.stringify(original), /synthetic-owner|synthetic-original-message/);
    const oversized = new FirestoreRootBudget({ ...options, cipher: { ...cipher, encrypt: () => '界'.repeat(MAX_ROOT_BUDGET_BYTES / 2) } });
    await rejects(oversized.stop(c), 'document_too_large'); assert.deepEqual((await ref.get()).data(), original);
    await rejects(new FirestoreRootBudget({ ...options, projectId: 'demo-other-project' }).read(c), 'ciphertext_rejected');
    await ref.set({ format: original.format, version: original.version }); await rejects(service.read(c), 'ciphertext_rejected');
    await ref.set({ ...original, ciphertext: 'yb1.tampered' }); await rejects(service.read(c), 'ciphertext_rejected');
    await ref.set(original); assert.equal((await service.read(c)).used.modelCalls, 1);
    // Adapter stop did not close the caller-owned SDK client.
    await service.stop(c); assert.equal((await ref.get()).exists, true);
  });
} catch (error) { summary.failure = { message: error.message, code: error.code ?? null }; process.exitCode = 1; }
finally {
  const outstanding = [...children];
  await Promise.all(outstanding.map(child => new Promise(resolve => { child.once('exit', resolve); child.kill('SIGKILL'); })));
  summary.childProcessesStopped = children.size === 0;
  const batch = database.batch(); for (const root of roots) batch.delete(database.collection(namespace).doc(digest(root)));
  try { await batch.commit(); summary.ownedSyntheticDocumentsDeleted = roots.size; } catch (error) { summary.cleanupError = error.message; process.exitCode = 1; }
  await database.terminate(); summary.clientClosedByComposer = true; summary.connections = connections.length; summary.blocked = blocked;
  if (blocked.length || childAudits.some(audit => audit.blocked.length)) process.exitCode = 1;
  await writeFile(output, JSON.stringify(summary, null, 2) + '\n');
}
