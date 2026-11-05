import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createEvent, createEventActions } from '@google/adk';
import type { Transaction } from '@google-cloud/firestore';
import { FirestoreSessionService } from '../server/firestore-session-service.ts';
import { encodeId, createCodec } from '../server/firestore-session-codec.ts';
import { summaryErasureFixture } from './helpers/summary-erasure-fixture.ts';

type ErasureStorage = { prepareContentErasure(tx: Transaction,
  input: { ownerUserId: string; runId: string; erasureIntentId: string }): Promise<() => void> };

test('journaled session storage clears private native output and permanently fences late append, create and ordinary owned cleanup', async () => {
  const f = await summaryErasureFixture(), service = new FirestoreSessionService({ ...f.options, namespace: 'synthetic_summary_native' });
  const key = { appName: 'yuban_hk', userId: f.scope.ownerUserId, sessionId: randomUUID() };
  const session = await service.createSession({ ...key, state: { 'app:shared': 'keep-app', 'user:shared': 'keep-user', text: 'Synthetic private state' } });
  const event = createEvent({ id: 'synthetic-output', invocationId: 'synthetic-invocation', timestamp: 1000, author: 'summary',
    actions: createEventActions({}), content: { role: 'model', parts: [{ text: 'Synthetic private native output' }] } });
  await service.appendEvent({ session, event });
  const app = f.fake.database.collection('synthetic_summary_native').doc(encodeId(key.appName)), user = app.collection('users').doc(encodeId(key.userId));
  const ref = user.collection('sessions').doc(encodeId(key.sessionId));
  const sharedBefore = [structuredClone(f.fake.records.get(app.path)), structuredClone(f.fake.records.get(user.path))];
  const eraser = service as unknown as ErasureStorage;
  assert.equal(typeof eraser.prepareContentErasure, 'function');
  const input = { ownerUserId: key.userId, runId: key.sessionId, erasureIntentId: f.intent.operationId };
  await f.fake.database.runTransaction(async tx => {
    const commit = await eraser.prepareContentErasure(tx, input);
    assert.equal((await tx.get(ref)).get('status'), 'active', 'Prepared storage performs every read before its commit closure');
    commit();
  });
  const first = structuredClone(f.fake.records.get(ref.path));
  assert.equal(first.status, 'deleting');
  assert.equal(first.contentErasureIntentId, input.erasureIntentId);
  assert.deepEqual(createCodec(f.options.cipher, f.options.projectId, 'synthetic_summary_native').open('session', key, first.state), {});
  assert.equal([...f.fake.records.keys()].some(path => path.startsWith(ref.path + '/events/')), false);
  await assert.rejects(service.appendEvent({ session, event: { ...event, id: 'late-output' } }), { code: 'session_deleting' });
  await assert.rejects(service.createSession(key), { code: 'session_exists' });
  await service.cleanupCreatedSession(session);
  await service.deleteSession(key);
  assert.deepEqual(f.fake.records.get(ref.path), first, 'Ordinary cleanup cannot remove an erasure tombstone and reopen this run');
  await f.fake.database.runTransaction(async tx => (await eraser.prepareContentErasure(tx, input))());
  assert.deepEqual(f.fake.records.get(ref.path), first, 'A lost-ACK retry does not mint a new revision or session');
  assert.deepEqual([f.fake.records.get(app.path), f.fake.records.get(user.path)], sharedBefore);
});

test('an authorized missing native session still receives a persistent fence against a late create', async () => {
  const f = await summaryErasureFixture(), service = new FirestoreSessionService({ ...f.options, namespace: 'synthetic_missing_native' });
  const eraser = service as unknown as ErasureStorage, input = { ownerUserId: f.scope.ownerUserId, runId: randomUUID(), erasureIntentId: f.intent.operationId };
  assert.equal(typeof eraser.prepareContentErasure, 'function');
  await f.fake.database.runTransaction(async tx => (await eraser.prepareContentErasure(tx, input))());
  await assert.rejects(service.createSession({ appName: 'yuban_hk', userId: input.ownerUserId, sessionId: input.runId }), { code: 'session_exists' });
});
