import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEvent, createEventActions } from '@google/adk';
import { contentErasureSchema, createFirestoreContentErasure } from '../server/firestore-content-erasure.ts';
import { privateSummaryWorkSchema, summarySourceRevisionSchema, privateSummaryAttemptSchema, privateSummaryUsageSchema,
  summaryGrantRecordId } from '../server/private-summary-work.ts';
import { firestoreAgentRunSchema } from '../server/firestore-agent-runs.ts';
import { FirestoreSessionService } from '../server/firestore-session-service.ts';
import { createFirestoreErasureStore, type FirestoreScopeErasure } from '../server/firestore-erasure.ts';
import { createFirestoreErasureCleanup } from '../server/firestore-erasure-cleanup.ts';
import { FIREBASE_BACKUP_COLLECTION_SUFFIXES } from '../server/firestore-backup.ts';
import { firebaseErasureIntentHash, type FirebaseErasureIntent, type FirebaseErasureDescriptor } from '../server/firebase-erasure-journal.ts';
import { summaryErasureFixture } from './helpers/summary-erasure-fixture.ts';

test('physical cleanup visits bounded historical revision pages before completing its journal checkpoint', async () => {
  const f = await summaryErasureFixture(2);
  for (let version = 1; version <= 28; version++) {
    const revision = f.revision(version);
    f.store('private_summary_revisions', 'private-summary-revision', revision.id, summarySourceRevisionSchema, revision);
  }
  const job = { intent: f.intent, journal: f.descriptor, stage: 'receipts' as const, after: null };
  f.store('content_erasures', 'content-erasure', f.intent.operationId, contentErasureSchema, job, f.scope, { stage: job.stage });
  const ref = f.data.ref('content_erasures', 'content-erasure', f.intent.operationId), cleanup = createFirestoreContentErasure({ ...f.options, journal: f.journal });
  const read = () => f.fake.database.runTransaction(tx => tx.get(ref));
  await cleanup.advance(await read());
  const first = f.data.open('content-erasure', f.intent.operationId, f.scope, contentErasureSchema, await read());
  assert.equal(first.stage, 'summary_revisions');
  await cleanup.advance(await read());
  const second = f.data.open('content-erasure', f.intent.operationId, f.scope, contentErasureSchema, await read());
  assert.equal(second.stage, 'summary_revisions');
  assert.notEqual(second.after, null, 'A full page records its final inspected ID even if most revisions do not match');
  for (let remaining = 0; remaining < 4; remaining++) await cleanup.advance(await read());
  const completed = f.data.open('content-erasure', f.intent.operationId, f.scope, contentErasureSchema, await read());
  assert.equal(completed.stage, 'done');
  const work = await f.fake.database.runTransaction(async tx => f.data.open('private-summary-work', f.work.id, f.scope, privateSummaryWorkSchema,
    await tx.get(f.data.ref('private_summary_works', 'private-summary-work', f.work.id))));
  assert.equal(work.accumulator, null);
  assert.equal(work.state, 'invalidated');
});

test('the journal coordinator rejects a wrong original run before erasing only the historical dependency and its native output', async () => {
  const f = await summaryErasureFixture(), old = f.seed(1), current = f.seed(2);
  const sessions = new FirestoreSessionService({ ...f.options, namespace: 'synthetic_summary_content_native' });
  const key = (runId: string) => ({ appName: 'yuban_hk', userId: f.scope.ownerUserId, sessionId: runId });
  for (const candidate of [old, current]) {
    const session = await sessions.createSession({ ...key(candidate.run.id), state: { text: candidate.originalText } });
    await sessions.appendEvent({ session, event: createEvent({ id: 'synthetic-output', invocationId: candidate.run.id, timestamp: 1000,
      author: 'summary', actions: createEventActions({}), content: { role: 'model', parts: [{ text: candidate.originalText }] } }) });
  }
  const usage = f.store('private_summary_usage', 'private-summary-usage', f.work.id, privateSummaryUsageSchema,
    { format: 'private-summary-usage/v1', workId: f.work.id, grant: f.work.grant, grantRecordId: f.work.grantRecordId,
      used: { modelCalls: 2, toolCalls: 2 }, revision: 3, unresolvedRetiredCount: 0 });
  const usageBefore = structuredClone(f.fake.records.get(usage.path));
  const job = { intent: f.intent, journal: f.descriptor, stage: 'summary_attempts' as const, after: null };
  const saveJob = () => f.store('content_erasures', 'content-erasure', f.intent.operationId, contentErasureSchema, job, f.scope, { stage: job.stage });
  saveJob();
  const ref = f.data.ref('content_erasures', 'content-erasure', f.intent.operationId), cleanup = createFirestoreContentErasure({ ...f.options,
    journal: f.journal, summarySessions: sessions });
  const read = () => f.fake.database.runTransaction(tx => tx.get(ref));
  const altered = { ...old.run, trigger: { ...old.run.trigger, reference: randomUUID() } };
  const saveRun = (run: typeof old.run) => f.store('agent_runs', 'agent-run', run.id, firestoreAgentRunSchema, run, f.scope,
    { runId: run.id, createdAt: run.createdAt, triggerKind: run.trigger.kind });
  saveRun(altered);
  let rejected = false;
  for (let page = 0; page < 2 && !rejected; page++) {
    const before = JSON.stringify([...f.fake.records]);
    try { await cleanup.advance(await read()); }
    catch (error) {
      assert.equal((error as { code: string }).code, 'private_summary_erasure_run_binding');
      assert.equal(JSON.stringify([...f.fake.records]), before, 'The invalid binding must not commit any native, domain or cursor mutation');
      rejected = true;
    }
  }
  assert.equal(rejected, true);
  saveRun(old.run); saveJob();
  for (let page = 0; page < 3; page++) await cleanup.advance(await read());
  const complete = f.data.open('content-erasure', f.intent.operationId, f.scope, contentErasureSchema, await read());
  assert.equal(complete.stage, 'done');
  assert.equal(complete.privateSummaryComplete, true);
  const attempt = await f.fake.database.runTransaction(async tx => f.data.open('private-summary-attempt', old.value.id, f.scope,
    privateSummaryAttemptSchema, await tx.get(f.data.ref('private_summary_attempts', 'private-summary-attempt', old.value.id))));
  assert.equal(attempt.contentState, 'erased'); assert.equal(attempt.resultText, null);
  assert.equal(attempt.erasureIntentId, f.intent.operationId); assert.deepEqual(attempt.receipt, old.value.receipt);
  const erasedRun = await f.fake.database.runTransaction(async tx => f.data.open('agent-run', old.run.id, f.scope, firestoreAgentRunSchema,
    await tx.get(f.data.ref('agent_runs', 'agent-run', old.run.id))));
  assert.equal(erasedRun.result!.text, '');
  await assert.rejects(sessions.getSession(key(old.run.id)), { code: 'session_deleting' });
  await assert.rejects(sessions.createSession(key(old.run.id)), { code: 'session_exists' });
  assert.equal((await sessions.getSession(key(current.run.id)))!.events[0].content!.parts![0].text, current.originalText);
  assert.deepEqual(f.fake.records.get(usage.path), usageBefore);
});

test('child scope cleanup deletes old-epoch summary domains while preserving the dedicated usage collection', async () => {
  const f = await summaryErasureFixture(), old = f.seed(1), restoredScope = { ...f.scope, storageEpoch: randomUUID() };
  const intent: FirebaseErasureIntent = { type: 'child-delete', scope: restoredScope, assetId: f.scope.childId,
    operationId: randomUUID(), at: '2026-11-04T00:00:00Z' };
  const descriptor: FirebaseErasureDescriptor = { ...f.descriptor, intentSha256: firebaseErasureIntentHash(intent) };
  const journal = { async writeOnce(value: FirebaseErasureIntent) { assert.deepEqual(value, intent); return descriptor; },
    async read(value: FirebaseErasureIntent, proof: FirebaseErasureDescriptor) { assert.deepEqual(value, intent); assert.deepEqual(proof, descriptor); return intent; } };
  const options = { ...f.options, journal, serverClock: () => Date.parse('2026-11-04T01:00:00Z') }, erasures = createFirestoreErasureStore(options);
  const ordinary = FIREBASE_BACKUP_COLLECTION_SUFFIXES.filter(suffix => !['_erasures', '_erasure_receipts', '_sessions', '_adk', '_root_budget', '_ai_usage'].includes(suffix)
    && !suffix.startsWith('_knowledge_'));
  const initial: FirestoreScopeErasure = { intent, authorizationVersion: '1', generation: f.generation, state: 'cleaning', journal: descriptor,
    receiptToken: null, expiresAt: null, blockedAt: intent.at, scopeVersion: '1', childCount: 1,
    cleanup: { stage: 'data:' + ordinary.indexOf('_agent_runs'), cursor: null } };
  f.fake.records.set(erasures.ref(f.scope.ownerUserId, intent.operationId).path, erasures.seal(initial));
  const usageWorkId = randomUUID();
  const usage = f.store('private_summary_usage', 'private-summary-usage', usageWorkId, privateSummaryUsageSchema,
    { format: 'private-summary-usage/v1', workId: usageWorkId, grant: f.work.grant, grantRecordId: summaryGrantRecordId(usageWorkId, f.work.grant),
      used: { modelCalls: 4, toolCalls: 3 }, revision: 5, unresolvedRetiredCount: 0 }, restoredScope);
  const usageBefore = structuredClone(f.fake.records.get(usage.path)), removedNative: string[] = [];
  const cleaner = createFirestoreErasureCleanup({ ...options, erasures,
    photos: { async eraseForScope() { throw Error('No synthetic photos'); } }, async deleteAgentSession(_owner, runId) { removedNative.push(runId); },
    async eraseAgentUserPage() { throw Error('Child deletion must not erase another account scope'); },
    async eraseDeviceSessions() { throw Error('Child deletion must not erase device sessions'); }, async eraseAuthUser() { throw Error('Child deletion must not erase an auth user'); } });
  let job = initial;
  for (let page = 0; page < ordinary.length && job.cleanup.stage !== 'device-sessions'; page++) {
    await cleaner.advance(f.scope.ownerUserId, intent.operationId);
    job = (await f.fake.database.runTransaction(tx => erasures.read(tx, f.scope.ownerUserId, intent.operationId)))!;
  }
  assert.equal(job.cleanup.stage, 'device-sessions');
  for (const row of [f.workRow, ...old.rows]) assert.equal(f.fake.records.has(row.path), false, 'Old-epoch summary domain remains: ' + row.context.kind);
  assert.deepEqual(removedNative, [old.run.id]);
  assert.deepEqual(f.fake.records.get(usage.path), usageBefore, 'Scope erasure must not refund or delete the dedicated usage ledger');
});
