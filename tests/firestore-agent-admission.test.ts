import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAgentAdmission } from '../server/firestore-agent-admission.ts';

test('two Agent instances share one capacity gate and an old lease cannot release its successor', async () => {
  const fake = firestoreDomainFixture(); let now = Date.now();
  const options = { database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 14)),
    projectId: 'synthetic-admission-project', namespace: 'synthetic_admission', serverClock: () => now };
  const a = createFirestoreAgentAdmission(options), b = createFirestoreAgentAdmission(options);
  const request = (userId: string) => ({ runId: randomUUID(), userId, deadlineAtMs: now + 90_000 });
  const first = await a.acquire(request('parent'));
  assert.ok(first); assert.equal(await b.acquire(request('parent')), null);
  const other = await Promise.all(['b', 'c', 'd'].map(userId => b.acquire(request(userId))));
  assert.ok(other.every(Boolean)); assert.equal(await a.acquire(request('fifth')), null);
  await first.release(); const successor = await b.acquire(request('parent')); assert.ok(successor);
  await first.release(); assert.equal(await successor.authorize(), true);
  now += 95_001;
  assert.equal(await successor.authorize(), false);
  const afterRestart = await createFirestoreAgentAdmission(options).acquire(request('parent'));
  assert.ok(afterRestart); await successor.release(); assert.equal(await afterRestart.authorize(), true);
});
