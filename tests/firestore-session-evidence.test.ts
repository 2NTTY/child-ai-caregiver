import assert from 'node:assert/strict';
import test from 'node:test';
import { createEvent, createEventActions, createSession } from '@google/adk';
import { FirestoreSessionService } from '../server/firestore-session-service.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createCodec, encodeId, MAX_EVENTS } from '../server/firestore-session-codec.ts';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';

async function fixture() {
  const fake = serialFirestoreFixture(), options = { database: fake.database, projectId: 'synthetic-session-evidence',
    namespace: 'synthetic_session_evidence', cipher: createStorageCipher(Buffer.alloc(32, 61)) };
  const service = new FirestoreSessionService(options), key = { appName: 'synthetic-fixed-app', userId: 'owner', sessionId: 'original-run' };
  const session = await service.createSession({ ...key, state: { 'app:shared': 'app', 'user:preference': 'user', value: 'before' } });
  const event = (id: string, timestamp = 1000) => createEvent({ id, invocationId: 'original-invocation', author: 'summary-agent', timestamp,
    actions: createEventActions({ stateDelta: { value: id, 'temp:transient': 'not saved' } }),
    content: { role: 'model', parts: [{ functionCall: { id: 'original-terminal', name: 'stage_private_summary', args: { text: 'Synthetic terminal' } } }] } });
  await service.appendEvent({ session, event: event('first') });
  const app = fake.database.collection(options.namespace).doc(encodeId(key.appName)), user = app.collection('users').doc(encodeId(key.userId));
  const ref = user.collection('sessions').doc(encodeId(key.sessionId)), events = ref.collection('events');
  const read = () => fake.database.runTransaction(tx => service.readSessionEvidenceInTransaction(key, tx), { readOnly: true });
  return { fake, options, service, key, session, event, ref, events, read, codec: createCodec(options.cipher, options.projectId, options.namespace) };
}

test('same-transaction session evidence equals the original full read without append or cleanup ownership and never writes', async () => {
  const f = await fixture(); await f.service.appendEvent({ session: f.session, event: f.event('second', 1001) });
  const before = JSON.stringify([...f.fake.records]), full = (await f.service.getSession(f.key))!, evidence = (await f.read())!;
  assert.deepEqual(evidence.key, f.key); assert.equal(evidence.revision, 2); assert.match(evidence.incarnation!, /^[a-f0-9-]{36}$/u);
  assert.deepEqual(evidence.events, full.events); assert.deepEqual(evidence.state, full.state); assert.equal(evidence.lastUpdateTime, full.lastUpdateTime);
  assert.equal(JSON.stringify([...f.fake.records]), before);
  const forged = createSession({ ...f.key, id: f.key.sessionId, state: { ...evidence.state }, events: [...evidence.events], lastUpdateTime: evidence.lastUpdateTime });
  await assert.rejects(f.service.appendEvent({ session: forged, event: f.event('unauthorized') }), { code: 'session_requires_reload' });
  await assert.rejects(f.service.cleanupCreatedSession(forged), { code: 'session_cleanup_not_owned' });
  assert.equal((await f.service.getSession({ ...f.key, config: { numRecentEvents: 1 } }))!.events.length, 1);
  assert.equal((await f.service.getSession({ ...f.key, config: { afterTimestamp: 1001 } }))!.events.length, 1);
  assert.equal((await f.service.getSession({ ...f.key, config: { numRecentEvents: 0 } }))!.events.length, 0);
  // A widened caller object must not silently request a truncated terminal proof.
  const truncated = { ...f.key, config: { numRecentEvents: 1 } };
  await assert.rejects(f.fake.database.runTransaction(tx => f.service.readSessionEvidenceInTransaction(truncated, tx)), { code: 'evidence_query_not_supported' });
  assert.equal(JSON.stringify([...f.fake.records]), before);
});

test('session evidence keeps the complete native history including repeated terminal calls for later verifier rejection', async () => {
  const f = await fixture(); await f.service.appendEvent({ session: f.session, event: f.event('duplicate-terminal', 1001) });
  const evidence = (await f.read())!;
  assert.deepEqual(evidence.events.map(event => event.id), ['first', 'duplicate-terminal']);
  assert.equal(evidence.events.flatMap(event => event.content?.parts ?? []).filter(part => part.functionCall?.name === 'stage_private_summary').length, 2);
});

test('missing, deleting and tampered native sessions are not evidence of no dispatch', async () => {
  const f = await fixture();
  assert.equal(await f.fake.database.runTransaction(tx => f.service.readSessionEvidenceInTransaction({ ...f.key, sessionId: 'missing' }, tx)), undefined);
  const original = structuredClone(f.fake.records.get(f.ref.path));
  f.fake.records.set(f.ref.path, { ...original, status: 'deleting' });
  await assert.rejects(f.read(), { code: 'session_deleting' });
  f.fake.records.set(f.ref.path, original);
  const path = f.events.doc(encodeId('first')).path, saved = structuredClone(f.fake.records.get(path));
  f.fake.records.set(path, { ...saved, timestamp: 9999 });
  await assert.rejects(f.read(), { code: 'event_identity_mismatch' });
  f.fake.records.set(path, { ...saved, event: { ...saved.event, ciphertext: 'tampered' } });
  await assert.rejects(f.read(), { code: 'ciphertext_rejected' });
});

test('evidence reader enforces the original complete-history bound instead of silently taking the latest page', async () => {
  const f = await fixture();
  for (let index = 1; index <= MAX_EVENTS; index++) {
    const event = f.event('overflow-' + index, 1000 + index);
    f.fake.records.set(f.events.doc(encodeId(event.id)).path, { version: 1, id: event.id, timestamp: event.timestamp,
      event: f.codec.seal('event', f.key, event, event.id) });
  }
  await assert.rejects(f.read(), { code: 'event_capacity' });
  assert.equal((await f.service.getSession({ ...f.key, config: { numRecentEvents: 1 } }))!.events.length, 1,
    'The original explicitly paged API keeps its existing contract');
});
