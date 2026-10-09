import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { host, projectId, connections, blocked } from './firestore-session-emulator-guard.mjs';

// Explicit CLI-only probe. The loopback guard is loaded before any SDK or product module.
const reportPath = process.argv[3];
assert.ok(reportPath, 'A report path is required');
const { Firestore } = await import('@google-cloud/firestore');
const { BaseSessionService } = await import('@google/adk');
const { createStorageCipher } = await import('../server/storage-crypto.ts');
const { FirestoreSessionService } = await import('../server/firestore-session-service.ts');
const { nativeSessionProductFixture } = await import('./helpers/native-session-product.ts');
const database = new Firestore({ projectId, host, ssl: false, preferRest: false });
const service = new FirestoreSessionService({ database, projectId, namespace: 'native_runtime_integration', cipher: createStorageCipher(Buffer.alloc(32, 31)) });
const results = [];
class ObservedService extends BaseSessionService {
  calls = [];
  afterAppend;
  createSession(request) { this.calls.push('create'); return service.createSession(request); }
  getSession(request) { this.calls.push('get'); return service.getSession(request); }
  listSessions(request) { this.calls.push('list'); return service.listSessions(request); }
  async appendEvent(request) {
    this.calls.push('append');
    const result = await service.appendEvent(request);
    await this.afterAppend?.(request);
    return result;
  }
  deleteSession(request) { this.calls.push('delete'); return service.deleteSession(request); }
}
const isDocumentResponse = request => request.event.content?.parts?.some(part => part.functionResponse?.name === 'change_family_document');
async function record(name, operation) {
  try { results.push({ name, status: 'passed', ...await operation() }); }
  catch (error) { results.push({ name, status: 'failed', error: error instanceof Error ? error.message : String(error) }); throw error; }
  finally { await writeFile(reportPath, JSON.stringify({ projectId, host, results, blocked, connections: connections.length }, null, 2) + '\n'); }
}
function assertCommittedOnce(s) {
  const observed = s.observe();
  assert.equal(observed.writes, 1); assert.equal(observed.documentVersion, 4);
  assert.deepEqual(observed.ledger.map(receipt => receipt.operationId), [s.operationId]);
  return observed;
}
try {
  await record('product tools and terminal presentation use native Firestore then remove the new session', async () => {
    const observed = new ObservedService(), s = nativeSessionProductFixture(observed, 'synthetic-runtime-success');
    const first = await s.reply();
    assert.equal(first?.status, 'completed', JSON.stringify(first));
    assert.equal(first.text, '合成文件項目已按原操作收據更新。');
    assert.deepEqual(first.counts, { modelCalls: 3, toolCalls: 3, queryEmbeddings: 0 });
    assert.deepEqual(await s.reply(), first);
    assert.equal(observed.calls.filter(call => call === 'create').length, 1);
    assert.equal(observed.calls.filter(call => call === 'get').length, 1);
    assert.equal(observed.calls.at(-1), 'delete');
    assert.equal(await service.getSession(s.key), undefined);
    return { ...assertCommittedOnce(s), nativeCalls: observed.calls, cleanup: 'confirmed absent' };
  });
  await record('existing session collision never starts provider, resumes or deletes another session', async () => {
    const observed = new ObservedService(), s = nativeSessionProductFixture(observed, 'synthetic-runtime-collision');
    await service.createSession({ ...s.key, state: { sentinel: 'synthetic-existing-session' } });
    try {
      const result = await s.reply();
      assert.equal(result?.status, 'stopped'); assert.equal(result.stopReason, 'unavailable');
      assert.deepEqual(observed.calls, ['create']);
      assert.equal(s.observe().calls, 0); assert.equal(s.observe().writes, 0);
      assert.equal((await service.getSession(s.key))?.state.sentinel, 'synthetic-existing-session');
      return { nativeCalls: observed.calls, providerCalls: 0, effects: 0, existingSessionPreserved: true };
    } finally { await service.deleteSession(s.key); }
  });
  await record('lost function response acknowledgement preserves the original domain receipt once', async () => {
    const observed = new ObservedService(), s = nativeSessionProductFixture(observed, 'synthetic-runtime-lost-response');
    let persistedResponse = false;
    observed.afterAppend = async request => {
      if (!isDocumentResponse(request)) return;
      const stored = await service.getSession(s.key);
      persistedResponse = Boolean(stored?.events.some(event => isDocumentResponse({ event })));
      throw new Error('Synthetic lost append acknowledgement after commit');
    };
    const first = await s.reply();
    assert.equal(first?.status, 'stopped'); assert.equal(first.stopReason, 'unavailable');
    assert.ok(persistedResponse); assert.match(first.text, /文件操作已保存/);
    assert.ok(first.tools.some(tool => tool.name === 'change_family_document' && tool.reference === s.documentId && tool.status === 'succeeded'));
    assert.deepEqual(await s.reply(), first);
    assert.equal(s.observe().calls, 2); assert.equal(observed.calls.filter(call => call === 'create').length, 1);
    assert.equal(await service.getSession(s.key), undefined);
    return { ...assertCommittedOnce(s), persistedResponse, nativeCalls: observed.calls, cleanup: 'confirmed absent' };
  });
  for (const stop of ['cancelled', 'unauthorized']) await record(`${stop} during committed append prevents later provider and native cleanup`, async () => {
    const observed = new ObservedService(), s = nativeSessionProductFixture(observed, `synthetic-runtime-${stop}`);
    const controller = new AbortController(), entered = Promise.withResolvers(), release = Promise.withResolvers();
    observed.afterAppend = async request => { if (isDocumentResponse(request)) { entered.resolve(); await release.promise; } };
    const pending = s.reply(controller.signal);
    await entered.promise;
    const callsAtStop = observed.calls.length;
    if (stop === 'cancelled') controller.abort(); else s.revoke();
    release.resolve();
    const first = await pending; await nextTurn();
    assert.equal(observed.calls.length, callsAtStop); assert.equal(observed.calls.includes('delete'), false);
    assert.equal(s.observe().calls, 2);
    assert.ok(await service.getSession(s.key), 'Cleanup is unconfirmed; the synthetic session remains');
    if (stop === 'cancelled') {
      assert.equal(first?.status, 'stopped'); assert.equal(first.stopReason, 'cancelled');
      assert.ok(first.tools.some(tool => tool.name === 'change_family_document' && tool.reference === s.documentId));
      assert.match(first.text, /文件操作已保存/);
      assert.deepEqual(await s.reply(), first);
    } else { assert.equal(first, null); assert.equal(await s.reply(), null); }
    const result = { ...assertCommittedOnce(s), nativeCalls: observed.calls, runtimeCleanup: 'not started after stop; session remained', privateResultVisible: first !== null };
    // The fixture owns this acknowledged synthetic tuple; this is not runtime cleanup or rollback.
    await service.deleteSession(s.key); assert.equal(await service.getSession(s.key), undefined);
    return { ...result, fixtureCleanup: 'confirmed absent' };
  });
  assert.deepEqual(blocked, []);
  assert.ok(connections.length > 0);
} finally {
  // Only the composing fixture owns the injected Firestore client's lifecycle.
  await database.terminate();
  await writeFile(reportPath, JSON.stringify({ projectId, host, results, blocked, connections: connections.length, clientTerminatedByFixture: true }, null, 2) + '\n');
}
console.log(JSON.stringify({ status: 'passed', checks: results.length, blockedNetworkCalls: blocked.length, projectId }));
