import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreFamilyDocumentStore } from '../server/firestore-family-documents.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreErasureStore } from '../server/firestore-erasure.ts';
import { createFirestoreErasureCleanup } from '../server/firestore-erasure-cleanup.ts';
import { createFirestoreAccountExport } from '../server/firestore-account-export.ts';
import { firebaseErasureIntentHash, type FirebaseErasureIntent, type FirebaseErasureDescriptor } from '../server/firebase-erasure-journal.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { createFirebaseRequestHandler } from '../server/firebase-app.ts';
import type { FirebaseAuthPort } from '../server/firebase-auth.ts';
import { createAccountApi } from '../src/client/account-api.ts';

test('F04 scoped export and journal-backed erasure preserve original operations and isolate another owner', async () => {
  const fixture = serialFirestoreFixture(); let now = Date.parse('2026-10-12T12:00:00Z');
  const options = { database: fixture.database, cipher: createStorageCipher(Buffer.alloc(32, 61)), projectId: 'synthetic-f04',
    namespace: 'unit_f04_exit', serverClock: () => now };
  const authority = createFirestoreAuthority(options), care = createFirestoreCareStore(options);
  const intents = new Map<string, FirebaseErasureIntent>(); let loseJournalReply = false;
  const journal = {
    async writeOnce(intent: FirebaseErasureIntent): Promise<FirebaseErasureDescriptor> {
      const old = intents.get(intent.operationId); if (old) assert.deepEqual(old, intent); else intents.set(intent.operationId, structuredClone(intent));
      if (loseJournalReply) { loseJournalReply = false; throw new Error('synthetic lost journal reply'); }
      return { objectName: 'erasures/v1/' + 'a'.repeat(64), generation: '1', cipherSha256: 'b'.repeat(64),
        intentSha256: firebaseErasureIntentHash(intent), bytes: 256, format: 'yuban-erasure-journal/v1' };
    },
    async read(intent: FirebaseErasureIntent, proof: FirebaseErasureDescriptor) {
      assert.equal(proof.intentSha256, firebaseErasureIntentHash(intent)); assert.deepEqual(intents.get(intent.operationId), intent); return intent;
    },
  };
  const erasures = createFirestoreErasureStore({ ...options, journal });
  const online = createFirestoreOnlineStore({ ...options, erasures, mutations: [care.mutation] });
  const removedAuth: string[] = [];
  const cleaner = createFirestoreErasureCleanup({ ...options, journal, erasures,
    photos: { async eraseForScope() { throw new Error('no photo in this scenario'); } },
    async deleteAgentSession() {}, async eraseAgentUserPage() { return true; }, async eraseDeviceSessions() { return { cursor: null, complete: true }; },
    async eraseAuthUser(owner) { if (!removedAuth.includes(owner)) removedAuth.push(owner); },
  });
  const exporter = createFirestoreAccountExport({ ...options, photos: { async content() { throw new Error('no photo in this scenario'); } } });
  let reauthenticated = false;
  const session = { user: { id: 'owner', name: 'Synthetic', email: 'owner@example.test' }, session: { id: 'synthetic' } };
  const auth = { async getSession() { return session; }, async handler() { throw Error('Auth provider is outside this local wire check'); },
    async assertRecentReauthentication() { assert.equal(reauthenticated, true); return session; } } as unknown as FirebaseAuthPort;
  const handler = createFirebaseRequestHandler({ authority, auth, accountData: { erasures, exporter },
    publicOrigin: 'https://example.test', mailConfigured: false });
  const client = createAccountApi('https://example.test', (async (url, init) => {
    if (String(url).endsWith('/account/delete')) assert.equal('password' in JSON.parse(String(init?.body)), false);
    const headers = new Headers(init?.headers); headers.set('origin', 'https://example.test');
    return handler(new Request(String(url), { ...init, headers }));
  }) as typeof fetch, { async reauthenticate(owner, password) {
    assert.equal(owner, 'owner'); assert.equal(password, 'synthetic-password'); reauthenticated = true;
  } });
  client.setIdentity('owner'); const signal = new AbortController().signal;
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  const creationIds = new Map<string, string>();
  async function identity(owner: string) {
    const email = owner + '@example.test';
    await authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: '2026-10-13T12:00:00Z' });
    await authority.admitIdentity({ userId: owner, email, emailVerified: true });
    await authority.acknowledge({ userId: owner, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    const operationId = randomUUID(); creationIds.set(owner, operationId);
    return (await authority.createChild({ userId: owner, operationId, displayName: '合成孩子' })).child.id;
  }
  const child = await identity('owner'), peerChild = await identity('peer');
  async function submitRecord(owner: string, childId: string, text: string) {
    const path = '/api/children/' + childId + '/records', payload = { text };
    return online.submit(owner, { path, payload, operation: { ...await online.context(owner, { path, payload }), opId: randomUUID(), deviceId: randomUUID() } });
  }
  await submitRecord('owner', child, '只屬本人'); await submitRecord('peer', peerChild, '另一帳戶');
  const documents = createFirestoreFamilyDocumentStore(options);
  await documents.create('owner', child, { kind: 'preparation', purpose: 'appointment', title: 'Private erasure document',
    eventDate: '2026-10-15', period: { from: '2026-10-01', to: '2026-10-31' } }, randomUUID());
  const exported = await client.exportPage('owner', { section: 'care', childId: child }, signal);
  assert.equal((exported.items[0] as any).text, '只屬本人'); assert.equal(exported.complete, true);
  await assert.rejects(exporter.page('peer', { section: 'care', childId: child }));
  const path = '/api/children/' + child + '/delete', payload = { confirmChildId: child };
  const submission = { path, payload, operation: { ...await online.context('owner', { path, payload }), opId: randomUUID(), deviceId: randomUUID() } };
  loseJournalReply = true;
  await assert.rejects(online.submit('owner', submission), /lost journal reply/);
  const receipt = await online.submit('owner', submission);
  assert.equal((receipt.result as any).cleanupPending, true);
  assert.deepEqual(await online.submit('owner', submission), receipt);
  await assert.rejects(exporter.page('owner', { section: 'care', childId: child }));
  now += 121_000;
  let state = await cleaner.advance('owner', submission.operation.opId);
  for (let i = 0; state.state !== 'completed' && i < 100; i++) state = await cleaner.advance('owner', submission.operation.opId);
  assert.equal(state.state, 'completed');
  assert.equal([...fixture.records.keys()].filter(key => key.startsWith(options.namespace + '_document_operations/')).length, 0);
  await assert.rejects(authority.createChild({ userId: 'owner', operationId: creationIds.get('owner')!, displayName: '合成孩子' }),
    (error: any) => error.code === 'operation_erased');
  assert.deepEqual(await online.lookup('owner', submission.operation.opId), receipt);
  assert.equal([...fixture.records.keys()].filter(key => key.startsWith(options.namespace + '_care_records/')).length, 1);
  assert.equal((await exporter.page('peer', { section: 'care', childId: peerChild })).items.length, 1);
  const prepared = await client.prepareDeletion('owner', signal);
  assert.equal(prepared.summary.childCount, 0);
  const processing = await client.executeDeletion('owner', { password: 'synthetic-password', confirmation: '永久刪除我的帳戶' }, signal);
  assert.equal(processing.state, 'processing');
  await assert.rejects(authority.runTransaction('owner', null, async () => true));
  now += 121_000;
  state = await cleaner.advance('owner', prepared.operationId);
  for (let i = 0; state.state !== 'completed' && i < 100; i++) state = await cleaner.advance('owner', prepared.operationId);
  assert.equal(state.state, 'completed'); assert.deepEqual(removedAuth, ['owner']);
  assert.equal((await client.deletionStatus(prepared, signal)).state, 'completed');
  await assert.rejects(erasures.status('owner', prepared.operationId, 'z'.repeat(43)));
  assert.equal((await exporter.page('peer', { section: 'care', childId: peerChild })).items.length, 1);
});
