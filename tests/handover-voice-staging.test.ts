import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreVoiceStore } from '../server/firestore-voice.ts';
import { voiceObjectAddress, type VoiceObjects, type VoiceObjectDescriptor } from '../server/firebase-voice-objects.ts';
import { firebaseErasureIntentHash, type FirebaseErasureIntent, type FirebaseErasureJournal } from '../server/firebase-erasure-journal.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { VOICE_LIMITS } from '../src/shared/voice.ts';
import type { ImportProvenance } from '../src/shared/import-provenance.ts';

test('imported voices stage one original object and publish with a receipt while preserving duration bounds and cleanup', async () => {
  const fixture = serialFirestoreFixture(), now = Date.now(); let clock = now;
  const options = { database: fixture.database, cipher: createStorageCipher(Buffer.alloc(32, 53)), projectId: 'synthetic-import', namespace: 'voice_stage' };
  const authority = createFirestoreAuthority(options), online = createFirestoreOnlineStore(options);
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  for (const userId of ['parent', 'other']) {
    const email = userId + '@example.invalid';
    await authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(now + 3600000).toISOString() });
    await authority.admitIdentity({ userId, email, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  }
  const path = '/api/children', payload = { displayName: 'Voice import' };
  const child = await online.submit('parent', { path, payload,
    operation: { ...await online.context('parent', { path, payload }), opId: randomUUID(), deviceId: randomUUID() } });
  const childId = (child.result as { child: { id: string } }).child.id;
  const initialWork = [...fixture.records.keys()].filter(path => path.includes('_voice_transcripts/') || path.includes('_background_work/'));
  const bytes = Buffer.from('Synthetic voice transport'), sha256 = createHash('sha256').update(bytes).digest('hex');
  const stored = new Map<string, VoiceObjectDescriptor>(); let writes = 0, corruptDuration = false;
  // The object port is synthetic; this checks the voice descriptor duration boundary, not an audio decoder.
  const objects: VoiceObjects = {
    address: (scope, id) => voiceObjectAddress({ ...options, bucketName: 'synthetic-private' }, scope, id).objectName,
    async write(scope, id, base64, mimeType) {
      assert.equal(base64, bytes.toString('base64')); assert.equal(mimeType, 'audio/wav');
      const objectName = this.address(scope, id); assert.equal(stored.has(objectName), false); writes++;
      stored.set(objectName, { objectName, generation: '1', cipherSha256: 'a'.repeat(64), sha256, bytes: bytes.length, mimeType: 'audio/wav', durationMs: 1000 });
      throw Error('Synthetic lost voice upload response');
    },
    async inspect(scope, id) { const descriptor = stored.get(this.address(scope, id));
      return descriptor ? { ...descriptor, ...(corruptDuration ? { durationMs: VOICE_LIMITS.durationMs + 1 } : {}) } : null; },
    async read(scope, id, descriptor) { assert.deepEqual(descriptor, stored.get(this.address(scope, id))); return { descriptor, buffer: Buffer.from(bytes), base64: bytes.toString('base64') }; },
    async remove(scope, id, descriptor) { assert.deepEqual(descriptor, stored.get(this.address(scope, id))); stored.delete(this.address(scope, id)); },
  };
  const entries = new Map<string, FirebaseErasureIntent>();
  const journal: Pick<FirebaseErasureJournal, 'writeOnce' | 'read'> = {
    async writeOnce(intent) { const hash = firebaseErasureIntentHash(intent); entries.set(hash, intent);
      return { objectName: 'erasures/v1/' + hash, generation: '1', cipherSha256: 'b'.repeat(64), intentSha256: hash, bytes: 1, format: 'yuban-erasure-journal/v1' }; },
    async read(intent, descriptor) { assert.deepEqual(entries.get(descriptor.intentSha256), intent); return intent; },
  };
  const store = createFirestoreVoiceStore({ ...options, objects, journal, serverClock: () => clock });
  const id = randomUUID(), stage = { batchId: randomUUID(), operationId: randomUUID(), actorUserId: 'parent', sourceHash: 'c'.repeat(64) };
  const reservation = { opId: id, fileName: 'original.wav', mimeType: 'audio/wav' as const, bytes: bytes.length, sha256 };
  const reserve = () => authority.runTransaction('parent', childId, async b => {
    const prepared = await store.prepareImportReservation(b, reservation, stage); prepared.commit(); return prepared.value;
  });
  const reserved = await reserve(); assert.deepEqual(await reserve(), reserved);
  await assert.rejects(store.uploadImported('parent', childId, id, reserved.version, bytes.toString('base64'), stage), { code: 'voice_upload_unknown' });
  await assert.rejects(store.reconcile('parent', childId, id), { code: 'voice_import_pending' });
  corruptDuration = true;
  await assert.rejects(store.uploadImported('parent', childId, id, reserved.version, bytes.toString('base64'), stage), { code: 'voice_integrity' });
  corruptDuration = false; await store.uploadImported('parent', childId, id, reserved.version, bytes.toString('base64'), stage);
  assert.equal(writes, 1); await assert.rejects(store.content('parent', childId, id), { code: 'voice_not_available' });
  const provenance: ImportProvenance = { current: { source: { serverId: 'source', accountId: 'source-parent', childId: randomUUID(), section: 'voices', resourceId: randomUUID(), resourceVersion: 3,
    authorUserId: null, createdAt: new Date(now - 1000).toISOString(), confirmedBy: null, confirmedAt: null, confirmationBasis: null, assigneeUserId: null },
    sourceHash: stage.sourceHash, packageId: randomUUID(), packageVersion: 1, manifestSha256: 'd'.repeat(64), integrity: 'trusted', importedBy: 'parent', importedAt: new Date(now).toISOString() }, previous: [] };
  const receipt = options.database.collection('synthetic_voice_import_receipts').doc(stage.operationId);
  const publish = (rollback = false) => authority.runTransaction('parent', childId, async b => {
    const prepared = await store.prepareImportPublication(b, id, stage, provenance);
    prepared.commit(); b.transaction.set(receipt, { id, operationId: stage.operationId });
    if (rollback) throw Error('Synthetic publication rollback'); return prepared.value;
  });
  await assert.rejects(publish(true), /Synthetic publication rollback/u);
  await assert.rejects(store.content('parent', childId, id), { code: 'voice_not_available' });
  assert.equal((await options.database.runTransaction(tx => tx.get(receipt))).exists, false);
  const published = await publish(); assert.equal(published.state, 'ready'); assert.equal(published.durationMs, 1000); assert.deepEqual(await publish(), published);
  assert.equal((await store.content('parent', childId, id)).base64, bytes.toString('base64'));
  await assert.rejects(store.get('other', childId, id));
  await assert.rejects(authority.runTransaction('parent', childId, b => store.prepareImportPublication(b, id, { ...stage, sourceHash: 'e'.repeat(64) }, provenance)), { code: 'operation_conflict' });
  clock += 86400_001;
  const scope = await authority.runTransaction('parent', childId, b => Promise.resolve(b.scope));
  assert.equal(await store.expireUnlinked(scope, id), false);
  assert.deepEqual([...fixture.records.keys()].filter(path => path.includes('_voice_transcripts/') || path.includes('_background_work/')), initialWork,
    'staging and publication add no transcription or background work beyond the existing child setup');
  const deleted = await store.delete('parent', childId, id, published.version, randomUUID()); assert.equal(deleted.cleanupPending, true);
  assert.equal((await store.cleanupDeleted(scope, id)).state, 'complete'); assert.equal(stored.size, 0); assert.equal(entries.size, 1);
  await assert.rejects(publish(), { code: 'voice_deleted' });
});
