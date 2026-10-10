import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { FinishReason } from '@google/genai';
import { FirestoreWorkContinuationStore } from '../server/firestore-work-continuation-store.ts';
import { FirestoreSessionService } from '../server/firestore-session-service.ts';
import { FirestoreRootBudget } from '../server/firestore-root-budget.ts';
import { FirestoreAiUsage } from '../server/firestore-ai-usage.ts';
import { createProductAgentServices } from '../server/product-agent-services.ts';
import { createAgentWorkContinuationProcessor } from '../server/agent-work-continuation-worker.ts';
import { workRecoveryAad, workRecoveryDocumentId } from '../server/firestore-work-continuation-recovery.ts';
import { readAiConfig } from '../server/ai-config.ts';
import { loadAgentPrompt } from '../server/agent-prompt.ts';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { workRecoveryFixture } from './helpers/firestore-work-recovery.ts';

async function fixture(dailyLimit = 20) {
  const fake = serialFirestoreFixture();
  const original = fake.database.runTransaction.bind(fake.database);
  let discard = false, lost = false, onRetry: (() => Promise<void>) | undefined;
  const database = { collection: fake.database.collection.bind(fake.database), batch: fake.database.batch.bind(fake.database),
    async runTransaction(callback: any, options: any) {
      if (discard) { discard = false;
        const sentinel = new Error('discarded callback');
        await assert.rejects(original(async tx => { await callback(tx); throw sentinel; }, options), error => error === sentinel);
        await onRetry?.(); onRetry = undefined;
      }
      const value = await original(callback, options);
      if (lost) { lost = false; throw new Error('Synthetic lost commit acknowledgement'); }
      return value;
    } } as typeof fake.database;
  const f = workRecoveryFixture(database); f.setNow(Date.now());
  f.rows.followup.dueAt = f.values.followUp.dueAt = new Date(f.now() - 1000).toISOString();
  f.rows.followup.dueConsumed = false;
  f.rows.work.payloadEncrypted = f.options.cipher.encrypt(JSON.stringify(f.values), `agent-work:${f.scope.childId}:${f.scope.ownerUserId}:${f.rows.work.id}:1`);
  await f.seed(); for (const kind of ['event', 'claim', 'run'] as const) fake.records.delete(f.ref(kind).path);
  const authority = new FirestoreWorkContinuationStore(f.options);
  const enqueue = () => authority.enqueueDue({ workerGeneration: f.job.workerGeneration, workIds: [f.rows.work.id] });
  const open = (kind: 'event' | 'run' | 'claim', id: string) => {
    const value = fake.records.get(database.collection(f.options.namespace).doc(workRecoveryDocumentId(kind, id)).path);
    return value && JSON.parse(f.options.cipher.decrypt(value.ciphertext,
      workRecoveryAad(f.options.projectId, f.options.namespace, kind, id, f.scope, value.version)));
  };
  const providerInputs: unknown[] = [], opens: any[] = [];
  let calls = 0, sql = 0, beforeProvider: (() => Promise<void>) | undefined;
  const config = readAiConfig({ AI_ENABLED: 'true', GCP_PROJECT_ID: 'synthetic-project', AI_DAILY_USER_ATTEMPTS: String(dailyLimit) });
  const pack = (await loadAgentPrompt('product-work-followup', 'tool_cycle', ['run', 'scope', 'conversation', 'context', 'evidence', 'capabilities'])).packVersion;
  const storage = { database, cipher: f.options.cipher, projectId: f.options.projectId };
  const daily = new FirestoreAiUsage({ ...storage, namespace: 'authority_daily_usage', billingSource: 'platform' });
  const roots = new FirestoreRootBudget({ ...storage, namespace: 'authority_root_budget' });
  const openRoot = roots.open.bind(roots); roots.open = async context => { opens.push(structuredClone(context)); return openRoot(context); };
  const persistence = { nativeSessionService: new FirestoreSessionService({ ...storage, namespace: 'authority_sessions' }),
    rootBudget: roots, dailyUsage: daily,
    profile: { config, workflowVersion: 'due-v1', promptPackVersion: pack, settingsVersion: 'fixed-v1', billingVersion: 'fixed-v1', billingSource: 'platform' as const },
    provider: { async generate(input: unknown) { providerInputs.push(input); calls++; await beforeProvider?.(); return { content: { role: 'model' as const, parts: [{ functionCall: {
      id: 'present-' + calls, name: 'present_answer', args: { kind: 'clarification', paragraphs: [{ text: '這項跟進已有新進展嗎？', citationIds: [] }] },
    } }] }, finishReason: FinishReason.STOP, usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } }; } } };
  const build = () => createProductAgentServices({ query() { sql++; throw new Error('SQL forbidden'); }, connect() { sql++; throw new Error('SQL forbidden'); } } as any,
    f.options.cipher, config, undefined, false, undefined, undefined, undefined, undefined, undefined,
    { claimedRunPersistence: persistence, workContinuationAuthority: authority });
  return { ...f, fake, database, authority, enqueue, open, build, daily, roots, persistence, providerInputs, opens,
    retry(callback?: () => Promise<void>) { discard = true; onRetry = callback; }, lose() { lost = true; },
    beforeProvider(callback: () => Promise<void>) { beforeProvider = callback; }, stats: () => ({ calls, sql }) };
}

test('committed same-database due claim feeds the real consumer and ProductAgent once, with original durable budgets', async () => {
  const f = await fixture(); f.lose(); await assert.rejects(f.enqueue(), /Synthetic lost commit acknowledgement/);
  const job = await f.enqueue(); assert.ok(job); assert.deepEqual(await f.enqueue(), job);
  f.retry(); await f.build().continuation!.process(job, job.jobId);
  const event = f.open('event', job.eventId), run = f.open('run', event.runId);
  assert.equal(event.state, 'completed'); assert.equal(run.state, 'completed');
  assert.deepEqual(event.inputEvidence.works, [{ workId: f.rows.work.id, workVersion: 1, selection: 'included' }]);
  assert.equal((await f.daily.getForUser(f.scope.ownerUserId)).attempts, 1);
  assert.equal(f.opens.length, 1); assert.equal(f.opens[0].binding.trigger.kind, 'worker');
  assert.equal(f.opens[0].binding.trigger.reference, job.eventId);
  assert.ok(f.opens[0].binding.workflowVersion.endsWith(':worker:' + job.workerGeneration));
  assert.equal((await f.roots.read(f.opens[0])).used.modelCalls, 1);
  const originalCiphertext = run.resultEncrypted, before = f.stats();
  await f.build().continuation!.process(job, job.jobId);
  assert.deepEqual(f.stats(), before); assert.equal(f.open('run', event.runId).resultEncrypted, originalCiphertext);
  assert.equal(f.stats().calls, 1); assert.equal(f.stats().sql, 0);
});

test('discarded claim context never escapes; cancellation before the committed retry excludes the complete original candidate', async () => {
  const f = await fixture(), job = await f.enqueue(); assert.ok(job);
  f.retry(async () => { f.cancelWork(); await f.write('work'); await f.write('followup'); });
  await f.build().continuation!.process(job, job.jobId);
  const event = f.open('event', job.eventId);
  assert.equal(event.state, 'cancelled'); assert.equal(event.runId, null);
  assert.deepEqual(event.inputEvidence.works, [{ workId: f.rows.work.id, workVersion: 1, selection: 'not_included' }]);
  assert.deepEqual(f.stats(), { calls: 0, sql: 0 });
});

test('lost original claim commit stays lookup-only through reconstruction and becomes unknown at the original deadline', async () => {
  const f = await fixture(), job = await f.enqueue(); assert.ok(job);
  f.lose(); await assert.rejects(f.build().continuation!.process(job, job.jobId), /Synthetic lost commit acknowledgement/);
  let event = f.open('event', job.eventId), run = f.open('run', event.runId);
  await assert.rejects(f.build().continuation!.process(job, job.jobId), /work_continuation_run_pending/);
  f.setNow(run.expiresAtMs);
  await f.build().continuation!.process(job, job.jobId);
  assert.equal(f.open('event', job.eventId).state, 'unknown'); assert.equal(f.open('run', run.id).state, 'unknown');
  assert.deepEqual(f.stats(), { calls: 0, sql: 0 });
});

test('current cancellation after claim prevents finish without rewriting the original input selection', async () => {
  const f = await fixture(), job = await f.enqueue(); assert.ok(job);
  const admitted = await f.authority.beginBackground(job); assert.equal(admitted.decision, 'execute');
  if (admitted.decision !== 'execute') return;
  f.cancelWork(); await f.write('work'); await f.write('followup');
  const before = structuredClone(f.fake.records);
  assert.equal(await f.authority.finishBackground(job, admitted.claim, { ...f.original, runId: admitted.claim.runId, status: "completed", retrievalMode: "not_used" }), false);
  assert.deepEqual(f.fake.records, before);
  assert.equal(f.open('event', job.eventId).inputEvidence.works[0].selection, 'included');
  await f.authority.recoverBackground(job); assert.equal(f.open('event', job.eventId).state, 'cancelled');
});

test('missing authority, corrupt evidence, wrong generation and missing budget refuse without SQL or provider fallback', async () => {
  for (const defect of ['missing_account', 'wrong_generation', 'corrupt_event', 'missing_budget'] as const) {
    const f = await fixture(), job = await f.enqueue(); assert.ok(job);
    if (defect === 'missing_account') f.fake.records.delete(f.ref('account').path);
    if (defect === 'wrong_generation') job.workerGeneration = randomUUID();
    if (defect === 'corrupt_event') f.fake.records.set(f.database.collection(f.options.namespace).doc(workRecoveryDocumentId('event', job.eventId)).path,
      { format: 'yuban-work-recovery', version: 2, ciphertext: 'corrupt' });
    const before = structuredClone(f.fake.records);
    if (defect === 'missing_budget') assert.throws(() => createProductAgentServices({} as any, f.options.cipher, {} as any,
      undefined, false, undefined, undefined, undefined, undefined, undefined, { workContinuationAuthority: f.authority }), /work_continuation/);
    else await assert.rejects(f.build().continuation!.process(job, job.jobId), /work_(?:recovery|continuation)_/);
    assert.deepEqual(f.fake.records, before); assert.deepEqual(f.stats(), { calls: 0, sql: 0 });
  }
});


test('mixed candidates use only the committed live work and concurrent consumers cannot start another run', async () => {
  const f = await fixture(), secondId = randomUUID();
  f.values.goal = 'DISCARDED-CONTEXT-CANCELLED';
  f.rows.work.payloadEncrypted = f.options.cipher.encrypt(JSON.stringify(f.values), `agent-work:${f.scope.childId}:${f.scope.ownerUserId}:${f.rows.work.id}:1`);
  await f.write('work');
  const secondValues = { ...f.values, goal: 'COMMITTED-ONLY-LIVE-WORK' };
  const second = { ...f.rows.work, id: secondId, payloadEncrypted: f.options.cipher.encrypt(JSON.stringify(secondValues),
    `agent-work:${f.scope.childId}:${f.scope.ownerUserId}:${secondId}:1`) };
  for (const [kind, value] of [['work', second], ['followup', { ...f.rows.followup, workId: secondId }]] as const) {
    const ref = f.database.collection(f.options.namespace).doc(workRecoveryDocumentId(kind, secondId));
    f.fake.records.set(ref.path, { format: 'yuban-work-recovery', version: 1, ciphertext: f.options.cipher.encrypt(JSON.stringify(value),
      workRecoveryAad(f.options.projectId, f.options.namespace, kind, secondId, f.scope)) });
  }
  const job = await f.authority.enqueueDue({ workerGeneration: f.job.workerGeneration, workIds: [f.rows.work.id, secondId] }); assert.ok(job);
  f.retry(async () => { f.cancelWork(); await f.write('work'); await f.write('followup'); });
  // The retry's cancellation must commit before another consumer can claim. Deliver
  // the competing job while the successful first consumer is inside its provider.
  f.beforeProvider(async () => {
    await assert.rejects(f.build().continuation!.process(job, job.jobId), /work_continuation_run_pending/);
  });
  await f.build().continuation!.process(job, job.jobId);
  const event = f.open('event', job.eventId);
  assert.deepEqual(event.inputEvidence.works, [{ workId: f.rows.work.id, workVersion: 1, selection: 'not_included' },
    { workId: secondId, workVersion: 1, selection: 'included' }]);
  assert.ok(JSON.stringify(f.providerInputs).includes('COMMITTED-ONLY-LIVE-WORK'));
  assert.ok(!JSON.stringify(f.providerInputs).includes('DISCARDED-CONTEXT-CANCELLED'));
  assert.equal(f.stats().calls, 1); assert.equal(f.stats().sql, 0);
});

test('lost finish acknowledgement preserves the completed original ciphertext and forbids late overwrite', async () => {
  const f = await fixture(), job = await f.enqueue(); assert.ok(job);
  const originalFinish = f.authority.finishBackground.bind(f.authority);
  let admission: any;
  f.authority.finishBackground = async (job, claim, result) => { admission = claim; const committed = await originalFinish(job, claim, result);
    assert.equal(committed, true); throw new Error('Synthetic lost finish acknowledgement'); };
  await assert.rejects(f.build().continuation!.process(job, job.jobId), /Synthetic lost finish acknowledgement/);
  const event = f.open('event', job.eventId), original = f.open('run', event.runId).resultEncrypted;
  const before = f.stats(); await f.build().continuation!.process(job, job.jobId); assert.deepEqual(f.stats(), before);
  assert.equal(await originalFinish(job, admission, { ...f.original, runId: event.runId, text: 'late replacement', status: 'completed', retrievalMode: 'not_used' }), false);
  assert.equal(f.open('run', event.runId).resultEncrypted, original);
});

test('the worker branch stops at the original daily quota and rejects advisory presentation', async () => {
  const f = await fixture(1), job = await f.enqueue(); assert.ok(job); let providerCalls = 0;
  f.persistence.provider.generate = async input => {
    providerCalls++; return { content: { role: 'model' as const, parts: [{ functionCall: { id: 'unsafe-advice', name: 'present_answer',
      args: { kind: 'caregiving', paragraphs: [{ text: 'Synthetic unsupported advice', citationIds: [] }] } } }] },
      finishReason: FinishReason.STOP, usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 } };
  };
  await f.build().continuation!.process(job, job.jobId);
  const event = f.open('event', job.eventId), run = f.open('run', event.runId);
  const result = JSON.parse(f.options.cipher.decrypt(run.resultEncrypted, `agent-run:${f.scope.childId}:${f.scope.ownerUserId}:${run.id}`));
  assert.equal(run.state, 'stopped'); assert.equal(result.stopReason, 'quota_exceeded'); assert.equal(result.text, '');
  assert.equal(providerCalls, 1);
  assert.equal(result.tools[0].name, 'present_answer'); assert.equal(result.tools[0].status, 'rejected');
  assert.equal((await f.daily.getForUser(f.scope.ownerUserId)).attempts, 1); assert.equal(f.stats().sql, 0);
});

test('new durable consumer reads an existing V1 original result without upgrading evidence or creating another claim', async () => {
  const f = await fixture();
  f.rows.followup.dueConsumed = true; await f.write('followup');
  for (const kind of ['event', 'claim', 'run'] as const) await f.write(kind);
  const originalClaim = structuredClone(f.fake.records.get(f.ref('claim').path));
  const originalReceipt = f.rows.run.resultEncrypted;
  await f.build().continuation!.process(f.job, f.job.jobId);
  const event = f.open('event', f.job.eventId);
  assert.equal(event.state, 'completed'); assert.equal('inputEvidence' in event, false);
  assert.equal(f.fake.records.get(f.ref('event').path).version, 1);
  assert.deepEqual(f.fake.records.get(f.ref('claim').path), originalClaim);
  assert.equal(f.open('run', f.rows.run.id).resultEncrypted, originalReceipt);
  assert.deepEqual(f.stats(), { calls: 0, sql: 0 });
});
