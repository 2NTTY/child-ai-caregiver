import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Firestore } from '@google-cloud/firestore';
import { FirestoreSessionService, type FirestoreSessionServiceOptions } from '../server/firestore-session-service.ts';
import { SessionContractError } from '../server/firestore-session-codec.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';

function configured() {
  const calls: string[] = [];
  // Only public methods are supplied; constructor validation must do no I/O.
  const database = {
    collection() { calls.push('collection'); throw new Error('No I/O expected'); },
    runTransaction() { calls.push('runTransaction'); throw new Error('No I/O expected'); },
    batch() { calls.push('batch'); throw new Error('No I/O expected'); },
    terminate() { calls.push('terminate'); throw new Error('Caller owns lifecycle'); },
  } as unknown as Firestore;
  const options: FirestoreSessionServiceOptions = { database, projectId: 'server-owned-project', namespace: 'native_agent_sessions', cipher: createStorageCipher(Buffer.alloc(32, 23)) };
  return { options, calls };
}

test('trusted server client/project pairing accepts non-demo ID without I/O or lifecycle takeover', () => {
  const { options, calls } = configured();
  const service = new FirestoreSessionService(options);
  assert.ok(service);
  assert.deepEqual(calls, []);
  assert.equal('terminate' in service, false);
  assert.equal('close' in service, false);
});

test('explicit project string, namespace, public client methods and cipher are required', () => {
  const { options, calls } = configured();
  for (const patch of [
    { projectId: '' }, { projectId: ' whitespace ' }, { projectId: undefined }, { projectId: '\ud800' },
    { namespace: undefined }, { namespace: '' }, { namespace: 'unsafe/path' }, { namespace: 'A' },
    { database: undefined }, { cipher: undefined }, { cipher: { encrypt() {} } },
  ]) {
    assert.throws(() => new FirestoreSessionService({ ...options, ...patch } as unknown as FirestoreSessionServiceOptions),
      error => error instanceof SessionContractError && error.code === 'invalid_configuration');
  }
  assert.deepEqual(calls, []);
});

test('configuration failures expose only a fixed message and code', () => {
  const { options } = configured();
  assert.throws(() => new FirestoreSessionService({ ...options, namespace: 'PRIVATE_CONFIGURATION_SENTINEL' }), error => {
    assert.ok(error instanceof SessionContractError);
    assert.equal(error.message, 'Session storage request rejected');
    assert.equal(error.code, 'invalid_configuration');
    assert.doesNotMatch(String(error), /PRIVATE_CONFIGURATION_SENTINEL/);
    return true;
  });
});
