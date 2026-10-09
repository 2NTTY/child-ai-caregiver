import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';

// Synthetic contract probe. Network confinement is retained from the environment gate.
const port = Number(process.argv[2]);
assert.ok(Number.isInteger(port) && port > 1024 && port < 65536);
const host = `127.0.0.1:${port}`;
const projectId = 'demo-yuban-session-validation';
const reportPath = process.argv[3];
assert.ok(reportPath);
function requireEmulatorTarget(candidateHost, candidateProject) {
  if (candidateHost !== host || candidateProject !== projectId || !candidateProject.startsWith('demo-')) {
    throw new Error('Explicit isolated emulator target required');
  }
}
requireEmulatorTarget(process.env.FIRESTORE_EMULATOR_HOST, projectId);
for (const name of ['GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_CLOUD_PROJECT', 'GCLOUD_PROJECT', 'GOOGLE_API_KEY', 'GEMINI_API_KEY']) {
  assert.equal(process.env[name], undefined, 'No credentials or production project configuration is permitted');
}
assert.throws(() => requireEmulatorTarget(undefined, projectId));
assert.throws(() => requireEmulatorTarget('firestore.googleapis.com:443', projectId));
assert.throws(() => requireEmulatorTarget(host, 'non-demo-project'));

const connections = [];
const blocked = [];
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const values = Array.isArray(args[0]) ? args[0] : args;
  const options = typeof values[0] === 'object' ? values[0] : { port: values[0], host: values[1] };
  if (options?.path || options?.host !== '127.0.0.1' || Number(options?.port) !== port) {
    blocked.push({ kind: 'socket', host: options?.host ?? null, port: options?.port ?? null });
    throw new Error('Non-emulator network connection denied');
  }
  connections.push({ host: options.host, port: Number(options.port) });
  return connect.apply(this, args);
};
tls.connect = () => { blocked.push({ kind: 'tls' }); throw new Error('TLS/cloud connection denied in emulator probe'); };
const lookup = dns.lookup;
dns.lookup = (hostname, ...args) => {
  if (hostname !== '127.0.0.1') {
    blocked.push({ kind: 'dns' });
    throw new Error('External DNS denied in emulator probe');
  }
  return lookup(hostname, ...args);
};
const lookupAsync = dns.promises.lookup;
dns.promises.lookup = async (hostname, ...args) => {
  if (hostname !== '127.0.0.1') {
    blocked.push({ kind: 'dns' });
    throw new Error('External DNS denied in emulator probe');
  }
  return lookupAsync(hostname, ...args);
};

const { Firestore } = await import('@google-cloud/firestore');
const { BaseSessionService, State, createSession, createEvent, createEventActions } = await import('@google/adk');
const { createStorageCipher } = await import('../server/storage-crypto.ts');
const { FirestoreSessionService } = await import('../server/firestore-session-service.ts');
const { canonical, createCodec, encodeId } = await import('../server/firestore-session-codec.ts');
const database = new Firestore({ projectId, host, ssl: false, preferRest: false });
const secondDatabase = new Firestore({ projectId, host, ssl: false, preferRest: false });
const namespace = 'adk_session_fixture';
const cipher = createStorageCipher(Buffer.alloc(32, 23));
const codec = createCodec(cipher, projectId, namespace);
const make = db => new FirestoreSessionService({ database: db, cipher, projectId, namespace });
const service = make(database), second = make(secondDatabase);
const key = (sessionId, userId = 'synthetic-owner', appName = 'synthetic-app') => ({ appName, userId, sessionId });
const paths = value => {
  const app = database.collection(namespace).doc(encodeId(value.appName));
  const user = app.collection('users').doc(encodeId(value.userId));
  const session = user.collection('sessions').doc(encodeId(value.sessionId));
  return { app, user, session, events: session.collection('events') };
};
const event = (id, value, timestamp = 100) => createEvent({ id, invocationId: 'synthetic-invocation', author: 'synthetic-node', timestamp,
  actions: createEventActions({ stateDelta: value }) });
const report = { status: 'running', currentCase: null, results: [], realModelCalls: 0, cloudRequests: 0, connections, blocked,
  versions: { adk: '2.1.0', genai: '2.24.0', firestore: '9.3.1' } };
const snapshots = [];
async function check(name, run) {
  report.currentCase = name; await run(); report.results.push({ name, status: 'passed' }); console.log(`PASS ${name}`);
}
async function rejects(operation, code) {
  await assert.rejects(operation, error => {
    assert.doesNotMatch(error.message, /PRIVATE_|SENSITIVE_/);
    return code === undefined || error.code === code;
  });
}
function deferred() { let release; return { promise: new Promise(resolve => { release = resolve; }), release: () => release() }; }
// A separate public-method facade injects response loss or controlled scheduling.
// No installed SDK class/instance method or private field is patched.
function faultClient(db, faults) {
  return {
    collection: (...args) => db.collection(...args),
    async runTransaction(callback, options) {
      if (!options?.readOnly && faults.beforeWrite) await faults.beforeWrite();
      const result = await db.runTransaction(async transaction => {
        const value = await callback(transaction);
        if (!options?.readOnly && faults.beforeCommit) { faults.beforeCommit = false; throw new Error('Synthetic precommit failure'); }
        return value;
      }, options);
      if (!options?.readOnly && faults.afterCommit) { faults.afterCommit = false; throw new Error('Synthetic committed response lost'); }
      if (options?.readOnly && faults.afterRead) await faults.afterRead();
      return result;
    },
    batch() {
      const native = db.batch();
      const wrapper = { delete(...args) { native.delete(...args); return wrapper; }, async commit() {
        if (faults.beforeBatch) await faults.beforeBatch();
        return native.commit();
      } };
      return wrapper;
    },
  };
}

try {
  await check('create rejects duplicate; state scopes encrypted; safe identity segments and collision keys roundtrip', async () => {
    const tuple = key('session/with/slashes', 'owner/with/slash', 'app/with/slash');
    const state = { local: 'PRIVATE_SESSION', 'app:shared': 'PRIVATE_APP', 'user:shared': 'PRIVATE_USER', 'temp:ephemeral': 'PRIVATE_TEMP',
      format: 'yuban-adk-firestore-fixture', version: 1, ciphertext: 'ordinary-json-key' };
    const created = await service.createSession({ ...tuple, state });
    assert.equal(created.state['temp:ephemeral'], undefined);
    assert.equal(created.state.local, state.local); assert.equal(created.state['app:shared'], state['app:shared']);
    assert.deepEqual((await service.getSession(tuple)).state, created.state);
    await rejects(service.createSession({ ...tuple, state: { local: 'must-not-replace' } }), 'session_exists');
    const refs = paths(tuple), stored = await database.getAll(refs.app, refs.user, refs.session);
    assert.doesNotMatch(JSON.stringify(stored.map(row => row.data())), /PRIVATE_|ordinary-json-key/);
    assert.equal(await service.getSession({ ...tuple, userId: 'different-owner' }), undefined);
  });

  await check('full native Event JSON persists camelCase protocol and workflow fields; repeated reads are write-free', async () => {
    const tuple = key('full-event'), session = await service.createSession({ ...tuple, state: { initial: 'PRIVATE_START' } });
    const value = createEvent({ id: 'full-event-id', invocationId: 'original-invocation', author: 'node', timestamp: 1234,
      content: { role: 'model', parts: [{ functionCall: { id: 'original-call', name: 'synthetic', args: { snake_key: [1, { Mixed_Key: true }] } }, thoughtSignature: 'PRIVATE_SIGNATURE' },
        { functionResponse: { id: 'other-call', name: 'other', response: { Native_Key: ['PRIVATE_RESPONSE'] } } }] },
      actions: { stateDelta: { local: 'PRIVATE_EVENT_STATE' }, agentState: { node: { input: { Original_Key: 'PRIVATE_NODE' } } }, endOfAgent: false },
      output: { arbitrary_key: [['PRIVATE_OUTPUT']] }, route: ['x', 1, true], nodeInfo: { path: 'workflow.node', outputFor: ['workflow.node', 'workflow'] }, isolationScope: 'scope-a' });
    snapshots.push({ name: 'full-event-call-time', event: JSON.parse(canonical(value)) });
    const accepted = await service.appendEvent({ session, event: value });
    assert.equal(accepted, value); assert.equal(session.events[0], value);
    assert.equal(canonical(accepted), canonical(value));
    const restored = await service.getSession(tuple);
    assert.equal(canonical(restored.events[0]), canonical(value));
    const refs = paths(tuple), eventRef = refs.events.doc(encodeId(value.id));
    const before = await database.getAll(refs.app, refs.user, refs.session, eventRef);
    assert.doesNotMatch(JSON.stringify(before.map(row => row.data())), /PRIVATE_/);
    for (let i = 0; i < 3; i++) { await service.getSession(tuple); const list = await service.listSessions({ appName: tuple.appName, userId: tuple.userId }); assert.ok(list.sessions.every(item => item.events.length === 0)); }
    const after = await database.getAll(refs.app, refs.user, refs.session, eventRef);
    for (let i = 0; i < before.length; i++) { assert.ok(before[i].updateTime.isEqual(after[i].updateTime)); assert.equal(canonical(before[i].data()), canonical(after[i].data())); }
    await rejects(service.listSessions({ appName: tuple.appName }), 'owner_required');
    const listed = (await service.listSessions({ appName: tuple.appName, userId: tuple.userId })).sessions.find(item => item.id === tuple.sessionId);
    await rejects(service.appendEvent({ session: listed, event: event('forged-list-session', {}) }), 'session_requires_reload');
  });

  await check('same-ID replacement with current revision; e1 e2 exact replay never rolls state back', async () => {
    const tuple = key('replacement'), session = await service.createSession(tuple);
    const e1 = event('e1', { value: 1 }, 100), e2 = event('e2', { value: 2 }, 200);
    await service.appendEvent({ session, event: e1 }); await service.appendEvent({ session, event: e2 });
    const fresh = await service.getSession(tuple), before = await paths(tuple).session.get();
    const beforeState = canonical(fresh.state), beforeHistory = canonical(fresh.events);
    await service.appendEvent({ session: fresh, event: e1 });
    assert.equal(canonical(fresh.state), beforeState); assert.equal(canonical(fresh.events), beforeHistory);
    assert.ok(before.updateTime.isEqual((await paths(tuple).session.get()).updateTime));
    const replaced = event('e1', { value: 3 }, 300);
    await service.appendEvent({ session: fresh, event: replaced });
    const saved = await service.getSession(tuple);
    assert.equal(saved.events.length, 2); assert.equal(saved.state.value, 3);
    assert.equal(canonical(saved.events.find(item => item.id === 'e1')), canonical(replaced));
  });

  await check('unknown or changed Session identity and stale writer reject; reload required after conflict', async () => {
    const tuple = key('stale'), first = await service.createSession(tuple), stale = await second.getSession(tuple);
    await rejects(service.appendEvent({ session: structuredClone(first), event: event('forged', {}) }), 'session_requires_reload');
    await service.appendEvent({ session: first, event: event('winner', { value: 1 }) });
    await rejects(second.appendEvent({ session: stale, event: event('loser', { value: 2 }) }), 'revision_conflict');
    await rejects(second.appendEvent({ session: stale, event: event('again', {}) }), 'session_requires_reload');
    const changed = await service.getSession(tuple); changed.userId = 'different-owner';
    await rejects(service.appendEvent({ session: changed, event: event('wrong-owner', {}) }), 'session_identity_changed');
    assert.equal((await service.getSession(tuple)).state.value, 1);
  });

  await check('two independent clients race the same revision without overwrite', async () => {
    const tuple = key('competing'); await service.createSession(tuple);
    let reads = 0; const release = deferred();
    const afterRead = async () => { reads++; if (reads === 2) release.release(); await release.promise; };
    // Get/create markers belong to their service instances; load before arming the barrier.
    const faultsA = {}, faultsB = {}, ca = make(faultClient(database, faultsA)), cb = make(faultClient(secondDatabase, faultsB));
    const sa = await ca.getSession(tuple), sb = await cb.getSession(tuple);
    faultsA.afterRead = afterRead; faultsB.afterRead = afterRead;
    const outcomes = await Promise.allSettled([ca.appendEvent({ session: sa, event: event('a', { winner: 'a' }) }), cb.appendEvent({ session: sb, event: event('b', { winner: 'b' }) })]);
    assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter(item => item.status === 'rejected' && item.reason.code === 'revision_conflict').length, 1);
    const saved = await service.getSession(tuple); assert.equal(saved.events.length, 1); assert.equal(saved.state.winner, saved.events[0].id);
  });

  await check('same Session concurrent append rejects before a second write is admitted', async () => {
    const tuple = key('busy'), faults = {}, observed = make(faultClient(database, faults)), session = await observed.createSession(tuple);
    const entered = deferred(), release = deferred();
    faults.afterRead = async () => { entered.release(); await release.promise; };
    const pending = observed.appendEvent({ session, event: event('once', { value: 1 }) });
    await entered.promise;
    await rejects(observed.appendEvent({ session, event: event('twice', { value: 2 }) }), 'session_busy');
    release.release(); await pending;
    assert.equal((await service.getSession(tuple)).events.length, 1);
  });

  await check('two sessions patch distinct app/user keys without overwriting other shared state', async () => {
    const one = key('shared-one'), two = key('shared-two');
    const first = await service.createSession(one), other = await second.createSession(two);
    await service.appendEvent({ session: first, event: event('one', { 'app:a': 'A', 'user:a': 'UA' }) });
    await second.appendEvent({ session: other, event: event('two', { 'app:b': 'B', 'user:b': 'UB' }) });
    const saved = await service.getSession(two);
    assert.equal(saved.state['app:a'], 'A'); assert.equal(saved.state['app:b'], 'B');
    assert.equal(saved.state['user:a'], 'UA'); assert.equal(saved.state['user:b'], 'UB');
  });

  await check('native State.set newer writes survive older event delta exactly as public super golden', async () => {
    class Golden extends BaseSessionService {}
    const tuple = key('write-order'), session = await service.createSession(tuple);
    const golden = createSession({ ...tuple, id: tuple.sessionId, state: JSON.parse(canonical(session.state)) });
    function prepare(target) {
      const old = {}, pending = new State(target.state, old);
      for (const name of ['localOrder', 'app:appOrder', 'user:userOrder']) pending.set(name, 1);
      const newer = new State(target.state, {});
      for (const name of ['localOrder', 'app:appOrder', 'user:userOrder']) newer.set(name, 2);
      return event('ordered', old, 400);
    }
    const original = prepare(session), expectedEvent = prepare(golden);
    snapshots.push({ name: 'old-delta-call-time', event: JSON.parse(canonical(original)), state: JSON.parse(canonical(session.state)) });
    const expected = await new Golden().appendEvent({ session: golden, event: expectedEvent });
    const accepted = await service.appendEvent({ session, event: original });
    assert.equal(expected, expectedEvent); assert.equal(accepted, original);
    assert.equal(canonical(session.state), canonical(golden.state)); assert.equal(canonical(accepted), canonical(expected));
    const restored = await service.getSession(tuple);
    for (const name of ['localOrder', 'app:appOrder', 'user:userOrder']) assert.equal(restored.state[name], 2);
    assert.equal(restored.events[0].actions.stateDelta.localOrder, 1);
  });

  await check('partial skipped; temp delta excluded; recent/zero/afterTimestamp preserve millisecond boundaries', async () => {
    const tuple = key('filters'), session = await service.createSession(tuple), ref = paths(tuple).session;
    const before = await ref.get();
    await service.appendEvent({ session, event: { ...event('partial', { value: 'ignored' }), partial: true } });
    assert.equal(session.events.length, 0); assert.ok(before.updateTime.isEqual((await ref.get()).updateTime));
    for (const time of [1000, 2000, 3000]) await service.appendEvent({ session, event: event('time-' + time, { value: time, 'temp:secret': 'PRIVATE_TEMP' }, time) });
    const all = await service.getSession(tuple); assert.equal(all.events.length, 3);
    assert.equal(all.state['temp:secret'], undefined); assert.ok(all.events.every(item => !Object.hasOwn(item.actions.stateDelta, 'temp:secret')));
    assert.deepEqual((await service.getSession({ ...tuple, config: { numRecentEvents: 0 } })).events, []);
    assert.deepEqual((await service.getSession({ ...tuple, config: { numRecentEvents: 2 } })).events.map(item => item.timestamp), [2000, 3000]);
    assert.deepEqual((await service.getSession({ ...tuple, config: { afterTimestamp: 2000 } })).events.map(item => item.timestamp), [2000, 3000]);
  });

  await check('wrong key, envelope version, tamper and owner move reject without plaintext fallback', async () => {
    const tuple = key('crypto'), session = await service.createSession({ ...tuple, state: { secret: 'PRIVATE_CRYPTO' } });
    await service.appendEvent({ session, event: event('crypto-id', { value: 'PRIVATE_DELTA' }) });
    const wrong = new FirestoreSessionService({ database, projectId, namespace, cipher: createStorageCipher(Buffer.alloc(32, 24)) });
    await rejects(wrong.getSession(tuple), 'ciphertext_rejected');
    const ref = paths(tuple).session, original = (await ref.get()).data();
    await ref.set({ ...original, state: { ...original.state, version: 2 } });
    await rejects(service.getSession(tuple), 'ciphertext_rejected'); await ref.set(original);
    await ref.set({ ...original, state: { ...original.state, ciphertext: original.state.ciphertext.slice(0, -4) + 'AAAA' } });
    await rejects(service.getSession(tuple), 'ciphertext_rejected'); await ref.set(original);
    const destination = key('crypto', 'other-owner'), target = await service.createSession(destination);
    await service.appendEvent({ session: target, event: event('crypto-id', {}) });
    const from = paths(tuple).events.doc(encodeId('crypto-id')), to = paths(destination).events.doc(encodeId('crypto-id'));
    await to.set((await from.get()).data()); await rejects(service.getSession(destination), 'ciphertext_rejected');
  });

  await check('precommit failure leaves database unchanged and poisons mutated local Session', async () => {
    const tuple = key('rollback'), faults = {}, observed = make(faultClient(database, faults)), session = await observed.createSession(tuple);
    const before = await paths(tuple).session.get(); faults.beforeCommit = true;
    await rejects(observed.appendEvent({ session, event: event('rejected', { value: 1 }) }));
    assert.equal(session.state.value, 1); // Native local mutation is deliberately not claimed rolled back.
    await rejects(observed.appendEvent({ session, event: event('again', {}) }), 'session_requires_reload');
    assert.ok(before.updateTime.isEqual((await paths(tuple).session.get()).updateTime));
    const saved = await observed.getSession(tuple); assert.equal(saved.state.value, undefined); assert.equal(saved.events.length, 0);
  });

  await check('committed response loss requires fresh get; exact retry has no second state/history/revision change', async () => {
    const tuple = key('lost-response'), faults = {}, observed = make(faultClient(database, faults)), session = await observed.createSession(tuple);
    const value = event('committed-once', { value: 7 }); faults.afterCommit = true;
    await rejects(observed.appendEvent({ session, event: value }));
    await rejects(observed.appendEvent({ session, event: value }), 'session_requires_reload');
    const fresh = await observed.getSession(tuple), before = await paths(tuple).session.get();
    assert.equal(fresh.state.value, 7); assert.equal(fresh.events.length, 1);
    await observed.appendEvent({ session: fresh, event: value });
    assert.ok(before.updateTime.isEqual((await paths(tuple).session.get()).updateTime)); assert.equal(fresh.events.length, 1);
  });

  const mutations = {
    id: value => { value.id = 'later-mutated-id'; },
    timestamp: value => { value.timestamp = 9876; },
    content: value => { value.content.parts[0].text = 'PRIVATE_LATER_MUTATION'; },
    delta: value => { value.actions.stateDelta.fixed.value = 'later-mutation'; },
  };
  for (const [field, mutate] of Object.entries(mutations)) {
    await check(`preflight ${field} mutation rejects before native Session/history mutation`, async () => {
      const tuple = key('preflight-' + field), faults = {}, observed = make(faultClient(database, faults)), session = await observed.createSession(tuple);
      const value = createEvent({ ...event('call-time-id', { fixed: { value: 'call-time' } }, 4567), content: { role: 'model', parts: [{ text: 'PRIVATE_CALL_TIME' }] } });
      const beforeState = canonical(session.state), before = await paths(tuple).session.get();
      faults.afterRead = () => mutate(value);
      await rejects(observed.appendEvent({ session, event: value }), 'event_changed_during_preflight');
      assert.equal(canonical(session.state), beforeState); assert.equal(session.events.length, 0);
      assert.ok(before.updateTime.isEqual((await paths(tuple).session.get()).updateTime));
      assert.equal((await paths(tuple).events.get()).size, 0);
      await rejects(observed.appendEvent({ session, event: event('after-rejection', {}) }), 'session_requires_reload');
    });
    await check(`post-super ${field} mutation poisons local alias; fresh get retains committed call-time payload`, async () => {
      const tuple = key('post-super-' + field), faults = {}, observed = make(faultClient(database, faults)), session = await observed.createSession(tuple);
      const value = createEvent({ ...event('call-time-id', { fixed: { value: 'call-time' } }, 4567), content: { role: 'model', parts: [{ text: 'PRIVATE_CALL_TIME' }] } });
      const captured = JSON.parse(canonical(value));
      snapshots.push({ name: 'post-super-' + field + '-before-call', event: captured });
      faults.beforeWrite = () => mutate(value);
      let returned;
      await rejects(observed.appendEvent({ session, event: value }).then(result => { returned = result; return result; }), 'event_changed_during_commit');
      assert.equal(returned, undefined); assert.equal(session.events[0], value);
      assert.notEqual(canonical(session.events[0]), canonical(captured));
      await rejects(observed.appendEvent({ session, event: event('must-reload', {}) }), 'session_requires_reload');
      const restored = await observed.getSession(tuple);
      assert.equal(restored.lastUpdateTime, captured.timestamp);
      assert.equal(canonical(restored.events[0]), canonical(captured));
      assert.equal(restored.state.fixed.value, 'call-time');
      assert.equal((await paths(tuple).events.doc(encodeId('later-mutated-id')).get()).exists, false);
    });
  }
  await check('exact-duplicate preflight mutation also rejects without local state/history changes', async () => {
    const tuple = key('duplicate-mutation'), faults = {}, observed = make(faultClient(database, faults)), original = await observed.createSession(tuple);
    const value = createEvent({ ...event('duplicate-id', { value: 1 }), content: { role: 'model', parts: [{ text: 'PRIVATE_ORIGINAL' }] } });
    await observed.appendEvent({ session: original, event: value });
    const fresh = await observed.getSession(tuple), beforeState = canonical(fresh.state), beforeHistory = canonical(fresh.events), before = await paths(tuple).session.get();
    faults.afterRead = () => { value.content.parts[0].text = 'PRIVATE_CHANGED'; };
    await rejects(observed.appendEvent({ session: fresh, event: value }), 'event_changed_during_preflight');
    assert.equal(canonical(fresh.state), beforeState); assert.equal(canonical(fresh.events), beforeHistory);
    assert.ok(before.updateTime.isEqual((await paths(tuple).session.get()).updateTime));
  });

  await check('oversize document is rejected without truncation; local Session must reload', async () => {
    const tuple = key('oversize'), session = await service.createSession(tuple), before = await paths(tuple).session.get();
    await rejects(service.appendEvent({ session, event: event('huge', { value: 'x'.repeat(700 * 1024) }) }), 'document_too_large');
    await rejects(service.appendEvent({ session, event: event('after-huge', {}) }), 'session_requires_reload');
    assert.ok(before.updateTime.isEqual((await paths(tuple).session.get()).updateTime)); assert.equal((await paths(tuple).events.get()).size, 0);
  });

  await check('event count bounds reject a 65th append; oversized deletion retains deleting state', async () => {
    const tuple = key('capacity'), session = await service.createSession(tuple), refs = paths(tuple), batch = database.batch();
    for (let i = 0; i < 64; i++) {
      const value = event('seed-' + i, {}, i + 1);
      batch.create(refs.events.doc(encodeId(value.id)), { version: 1, id: value.id, timestamp: value.timestamp, event: codec.seal('event', tuple, value, value.id) });
    }
    await batch.commit();
    await rejects(service.appendEvent({ session, event: event('65th', {}) }), 'event_capacity');
    const extra = event('imported-over-limit', {});
    await refs.events.doc(encodeId(extra.id)).create({ version: 1, id: extra.id, timestamp: extra.timestamp, event: codec.seal('event', tuple, extra, extra.id) });
    await rejects(service.deleteSession(tuple), 'event_capacity');
    assert.equal((await refs.session.get()).get('status'), 'deleting'); assert.equal((await refs.events.get()).size, 65);
    await rejects(service.getSession(tuple), 'session_deleting');
  });

  await check('deleting blocks reads/appends; a delayed old delete batch cannot remove a recreated tuple', async () => {
    const tuple = key('delete-recreate'), original = await service.createSession(tuple);
    await service.appendEvent({ session: original, event: event('same-id', { value: 'old' }) });
    const entered = deferred(), release = deferred(), faults = { beforeBatch: async () => { entered.release(); await release.promise; } };
    const delayed = make(faultClient(database, faults));
    const oldDelete = delayed.deleteSession(tuple);
    // Attach rejection handling before the held batch can be released.
    const oldOutcome = oldDelete.then(() => ({ success: true }), error => ({ success: false, error }));
    await entered.promise;
    await rejects(service.getSession(tuple), 'session_deleting');
    await rejects(service.appendEvent({ session: original, event: event('late', {}) }), 'session_deleting');
    await second.deleteSession(tuple);
    const replacement = await second.createSession({ ...tuple, state: { generation: 'new' } });
    await second.appendEvent({ session: replacement, event: event('same-id', { value: 'new' }) });
    release.release(); const outcome = await oldOutcome;
    assert.equal(outcome.success, false);
    const current = await service.getSession(tuple); assert.equal(current.state.generation, 'new'); assert.equal(current.events.length, 1); assert.equal(current.state.value, 'new');
    await service.deleteSession(tuple); assert.equal(await service.getSession(tuple), undefined); assert.equal((await paths(tuple).events.get()).size, 0);
  });

  assert.equal(blocked.length, 0);
  await check('server-owned client remains usable after service create append delete', async () => {
    const tuple = key('owned-client-lifecycle'), session = await service.createSession(tuple);
    await service.appendEvent({ session, event: event('owned-client-event', { local: 'PRIVATE_OWNED_CLIENT' }) });
    await service.deleteSession(tuple);
    assert.equal(await service.getSession(tuple), undefined);
    const probe = paths(tuple).app.collection('caller_lifecycle_probe').doc('probe');
    await probe.create({ synthetic: true });
    assert.equal((await probe.get()).get('synthetic'), true);
    await probe.delete();
  });

  await check('owner list reads at most 101 headers and rejects overflow without a false total', async () => {
    const first = key('bounded-0', 'bounded-owner', 'bounded-app');
    await service.createSession(first);
    const refs = paths(first), batch = database.batch();
    for (let index = 1; index < 100; index++) {
      const tuple = { ...first, sessionId: `bounded-${index}` };
      batch.create(refs.user.collection('sessions').doc(encodeId(tuple.sessionId)), {
        version: 1, status: 'active', revision: 0, lastUpdateTime: index,
        state: codec.seal('session', tuple, {}),
      });
    }
    await batch.commit();
    const bounded = await service.listSessions({ appName: first.appName, userId: first.userId, limit: 2 });
    assert.equal(bounded.totalItems, 100); assert.equal(bounded.sessions.length, 2);
    const overflow = { ...first, sessionId: 'bounded-100' };
    await refs.user.collection('sessions').doc(encodeId(overflow.sessionId)).create({
      version: 1, status: 'active', revision: 0, lastUpdateTime: 100,
      state: codec.seal('session', overflow, {}),
    });
    await rejects(service.listSessions({ appName: first.appName, userId: first.userId, limit: 1 }), 'session_list_capacity');
    assert.equal((await refs.user.collection('sessions').get()).size, 101);
  });

  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.error = { name: error instanceof Error ? error.name : 'UnknownError', code: error?.code ?? null,
    message: 'Synthetic contract validation stopped at first failure', locations: error?.stack?.split('\n').filter(line => line.trimStart().startsWith('at ') && line.includes('firestore_native_session_validation_20261009')) };
  console.error(JSON.stringify(report.error)); process.exitCode = 1;
} finally {
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  await writeFile(reportPath.replace(/\.json$/, '-call-time-snapshots.json'), JSON.stringify(snapshots, null, 2) + '\n');
  await database.terminate(); await secondDatabase.terminate();
}
