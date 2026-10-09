import assert from 'node:assert/strict';
import test from 'node:test';
import { createEvent, type AppendEventRequest, type CreateSessionRequest, type Session } from '@google/adk';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { FirestoreSessionService } from '../server/firestore-session-service.ts';
import { SessionContractError } from '../server/firestore-session-codec.ts';
import { NATIVE_SESSION_CLEANUP_TIMEOUT_MS } from '../server/agent-runtime.ts';
import { AgentStopped } from '../server/agent-budget.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { nativeSessionProductFixture } from './helpers/native-session-product.ts';

const options = (database: ReturnType<typeof serialFirestoreFixture>['database']) => ({ database, projectId: 'synthetic-project',
  namespace: 'synthetic_owned_cleanup', cipher: createStorageCipher(Buffer.alloc(32, 41)) });
const key = { appName: 'synthetic-app', userId: 'synthetic-user', sessionId: 'synthetic-session' };
const event = () => createEvent({ id: 'synthetic-reused-event', invocationId: 'synthetic-invocation', author: 'user',
  content: { role: 'user', parts: [{ text: 'Synthetic private content' }] } });
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

test('cancelled native product run removes its acknowledged session while preserving the original document receipt', async () => {
  const f = serialFirestoreFixture(), controller = new AbortController();
  const sessions = new class extends FirestoreSessionService {
    override async appendEvent(request: AppendEventRequest) {
      const result = await super.appendEvent(request);
      if (request.event.content?.parts?.some(part => part.functionResponse?.name === 'change_family_document')) controller.abort();
      return result;
    }
  }(options(f.database));
  const s = nativeSessionProductFixture(sessions, 'synthetic-owned-cancelled');
  const result = await s.reply(controller.signal);
  assert.equal(result?.status, 'stopped'); assert.equal(result.stopReason, 'cancelled');
  assert.equal(s.observe().writes, 1); assert.equal(s.observe().calls, 2);
  assert.deepEqual(s.observe().ledger.map(value => value.operationId), [s.operationId]);
  assert.equal(Boolean(await sessions.getSession(s.key)), false, 'Acknowledged session must be removed after cancellation');
  assert.deepEqual(await s.reply(), result); assert.equal(s.observe().calls, 2);
});

test('revoked native product run cleans its owned content without revealing the existing domain result', async () => {
  const f = serialFirestoreFixture(); let revoke!: () => void;
  const sessions = new class extends FirestoreSessionService {
    override async appendEvent(request: AppendEventRequest) {
      const result = await super.appendEvent(request);
      if (request.event.content?.parts?.some(part => part.functionResponse?.name === 'change_family_document')) revoke();
      return result;
    }
  }(options(f.database));
  const s = nativeSessionProductFixture(sessions, 'synthetic-owned-revoked'); revoke = s.revoke;
  assert.equal(await s.reply(), null); assert.equal(await sessions.getSession(s.key), undefined);
  assert.equal(s.observe().writes, 1); assert.equal(s.observe().calls, 2);
  assert.equal(await s.reply(), null); assert.equal(s.observe().writes, 1);
});

test('owned cleanup removes only its created session and events, preserving shared state and other ledgers', async () => {
  const f = serialFirestoreFixture(), sessions = new FirestoreSessionService(options(f.database));
  const session = await sessions.createSession({ ...key, state: { 'app:setting': 'synthetic-app', 'user:setting': 'synthetic-user', private: 'synthetic-session' } });
  await sessions.appendEvent({ session, event: event() });
  f.records.set('synthetic_root/existing', { sentinel: 'synthetic-root-counter' });
  f.records.set('synthetic_daily/existing', { sentinel: 'synthetic-daily-counter' });
  const untouched = structuredClone([...f.records].filter(([path]) => !path.includes('/sessions/')));
  await sessions.cleanupCreatedSession(session);
  assert.deepEqual([...f.records], untouched); assert.equal(await sessions.getSession(key), undefined);
  await sessions.cleanupCreatedSession(session); assert.deepEqual([...f.records], untouched);
});

test('read, list, reconstructed and foreign-instance session objects grant no cleanup ownership', async () => {
  const f = serialFirestoreFixture(), sessions = new FirestoreSessionService(options(f.database));
  const original = await sessions.createSession(key);
  const read = (await sessions.getSession(key))!, listed = (await sessions.listSessions(key)).sessions[0];
  for (const value of [read, listed, structuredClone(original)]) await assert.rejects(sessions.cleanupCreatedSession(value),
    error => error instanceof SessionContractError && error.code === 'session_cleanup_not_owned');
  await assert.rejects(new FirestoreSessionService(options(f.database)).cleanupCreatedSession(original),
    error => error instanceof SessionContractError && error.code === 'session_cleanup_not_owned');
  assert.ok(await sessions.getSession(key));
});

test('delayed owned cleanup cannot delete a replacement with the same tuple or event IDs', async () => {
  const f = serialFirestoreFixture(), sessions = new FirestoreSessionService(options(f.database));
  const old = await sessions.createSession(key); await sessions.appendEvent({ session: old, event: event() });
  await sessions.deleteSession(key);
  const replacement = await sessions.createSession({ ...key, state: { sentinel: 'synthetic-replacement' } });
  await sessions.appendEvent({ session: replacement, event: event() });
  const before = structuredClone([...f.records]);
  await sessions.cleanupCreatedSession(old);
  assert.deepEqual([...f.records], before); assert.equal((await sessions.getSession(key))?.events.length, 1);
});

test('the existing atomic batch precondition protects replacement events after cleanup selection', async () => {
  const f = serialFirestoreFixture(), sessions = new FirestoreSessionService(options(f.database));
  const old = await sessions.createSession(key); await sessions.appendEvent({ session: old, event: event() });
  let replacementState: unknown;
  f.beforeBatch(async () => {
    f.beforeBatch(); await sessions.deleteSession(key);
    const replacement = await sessions.createSession({ ...key, state: { sentinel: 'synthetic-replacement' } });
    await sessions.appendEvent({ session: replacement, event: event() });
    replacementState = structuredClone([...f.records]);
  });
  await assert.rejects(sessions.cleanupCreatedSession(old), /Synthetic batch precondition conflict/);
  assert.deepEqual([...f.records], replacementState);
});

test('lost create acknowledgement never calls owned cleanup or starts the provider', async () => {
  const f = serialFirestoreFixture(); let cleanups = 0;
  const sessions = new class extends FirestoreSessionService {
    override async createSession(request: CreateSessionRequest): Promise<Session> {
      await super.createSession(request); throw new Error('Synthetic lost create acknowledgement');
    }
    override async cleanupCreatedSession(session: Session) { cleanups++; await super.cleanupCreatedSession(session); }
  }(options(f.database));
  const s = nativeSessionProductFixture(sessions, 'synthetic-owned-create-unknown');
  const result = await s.reply();
  assert.equal(result?.stopReason, 'unavailable'); assert.equal(cleanups, 0); assert.equal(s.observe().calls, 0);
  assert.ok(await sessions.getSession(s.key));
});

for (const cancelled of [false, true]) test(`lost cleanup acknowledgement keeps the original result honest, cancelled=${cancelled}`, async () => {
  const f = serialFirestoreFixture(), controller = new AbortController(); let cleanups = 0;
  const sessions = new class extends FirestoreSessionService {
    override async appendEvent(request: AppendEventRequest) {
      const result = await super.appendEvent(request);
      if (cancelled && request.event.content?.parts?.some(part => part.functionResponse?.name === 'change_family_document')) controller.abort();
      return result;
    }
    override async cleanupCreatedSession(session: Session) { cleanups++; f.loseBatchReply(); await super.cleanupCreatedSession(session); }
  }(options(f.database));
  const s = nativeSessionProductFixture(sessions, `synthetic-owned-cleanup-unknown-${cancelled}`), result = await s.reply(controller.signal);
  assert.equal(result?.status, 'stopped'); assert.equal(result.stopReason, cancelled ? 'cancelled' : 'unavailable');
  assert.equal(cleanups, 1); assert.equal(await sessions.getSession(s.key), undefined);
  assert.equal(s.observe().writes, 1); assert.deepEqual(await s.reply(), result); assert.equal(cleanups, 1);
});

test('cleanup failure does not replace an original storage stop or the committed receipt', async () => {
  const f = serialFirestoreFixture(); let cleanups = 0;
  const sessions = new class extends FirestoreSessionService {
    override async appendEvent(request: AppendEventRequest) {
      const result = await super.appendEvent(request);
      if (request.event.content?.parts?.some(part => part.functionResponse?.name === 'change_family_document')) throw new AgentStopped('invalid_response');
      return result;
    }
    override async cleanupCreatedSession(_session: Session) { cleanups++; throw new Error('Synthetic cleanup unavailable'); }
  }(options(f.database));
  const s = nativeSessionProductFixture(sessions, 'synthetic-owned-original-failure'), result = await s.reply();
  assert.equal(result?.stopReason, 'invalid_response'); assert.equal(cleanups, 1); assert.ok(await sessions.getSession(s.key));
  assert.equal(s.observe().writes, 1); assert.deepEqual(await s.reply(), result); assert.equal(s.observe().calls, 2);
});

test('cleanup waiting is bounded and a late cleanup cannot delete a new incarnation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = serialFirestoreFixture(), entered = deferred(), release = deferred(), finished = deferred();
  const controller = new AbortController(); let cleanups = 0;
  const sessions = new class extends FirestoreSessionService {
    override async appendEvent(request: AppendEventRequest) {
      const result = await super.appendEvent(request);
      if (request.event.content?.parts?.some(part => part.functionResponse?.name === 'change_family_document')) controller.abort();
      return result;
    }
    override async cleanupCreatedSession(session: Session) {
      cleanups++; entered.resolve(); await release.promise;
      await super.cleanupCreatedSession(session); finished.resolve();
    }
  }(options(f.database));
  const s = nativeSessionProductFixture(sessions, 'synthetic-owned-cleanup-timeout'), pending = s.reply(controller.signal);
  await entered.promise; t.mock.timers.tick(NATIVE_SESSION_CLEANUP_TIMEOUT_MS);
  const result = await pending;
  assert.equal(result?.stopReason, 'cancelled'); assert.equal(cleanups, 1); assert.ok(await sessions.getSession(s.key));
  await sessions.deleteSession(s.key);
  const replacement = await sessions.createSession({ ...s.key, state: { sentinel: 'synthetic-new-incarnation' } });
  await sessions.appendEvent({ session: replacement, event: event() });
  const before = structuredClone([...f.records]); release.resolve(); await finished.promise; await nextTurn();
  assert.deepEqual([...f.records], before); assert.equal(s.observe().calls, 2); assert.equal(s.observe().writes, 1);
});
