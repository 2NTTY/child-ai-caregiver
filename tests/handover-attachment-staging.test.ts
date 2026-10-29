import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreChatFilesStore } from '../server/firestore-chat-files.ts';
import { createFirestoreAccountExport } from '../server/firestore-account-export.ts';
import { chatFileObjectAddress, type ChatFileObjects, type ChatFileObjectDescriptor } from '../server/firebase-chat-file-objects.ts';
import { firebaseErasureIntentHash, type FirebaseErasureIntent, type FirebaseErasureJournal } from '../server/firebase-erasure-journal.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import type { ImportProvenance } from '../src/shared/import-provenance.ts';

test('imported files stage original objects once and publish atomically with their import receipt', async () => {
  const fixture = serialFirestoreFixture(), now = Date.now(); let clock = now;
  const options = { database: fixture.database, cipher: createStorageCipher(Buffer.alloc(32, 52)), projectId: 'synthetic-import', namespace: 'attachment_stage' };
  const authority = createFirestoreAuthority(options), online = createFirestoreOnlineStore(options);
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  for (const userId of ['parent', 'other']) {
    const email = userId + '@example.invalid';
    await authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(now + 3600000).toISOString() });
    await authority.admitIdentity({ userId, email, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  }
  const path = '/api/children', payload = { displayName: 'Attachment import' };
  const child = await online.submit('parent', { path, payload,
    operation: { ...await online.context('parent', { path, payload }), opId: randomUUID(), deviceId: randomUUID() } });
  const childId = (child.result as { child: { id: string } }).child.id;
  const bytes = Buffer.from('Imported original file'), sha256 = createHash('sha256').update(bytes).digest('hex');
  const objectsByName = new Map<string, ChatFileObjectDescriptor>(); let writes = 0;
  const objects: ChatFileObjects = {
    address: (scope, id) => chatFileObjectAddress({ ...options, bucketName: 'synthetic-private' }, scope, id).objectName,
    async write(scope, id, base64, mimeType) {
      assert.equal(base64, bytes.toString('base64')); const objectName = this.address(scope, id); assert.equal(objectsByName.has(objectName), false); writes++;
      objectsByName.set(objectName, { objectName, generation: '1', cipherSha256: 'a'.repeat(64), sha256, bytes: bytes.length, mimeType });
      throw Error('Synthetic lost upload response');
    },
    async inspect(scope, id) { return objectsByName.get(this.address(scope, id)) ?? null; },
    async read(scope, id, descriptor) { assert.deepEqual(descriptor, objectsByName.get(this.address(scope, id))); return { descriptor, buffer: Buffer.from(bytes), base64: bytes.toString('base64') }; },
    async remove(scope, id, descriptor) { assert.deepEqual(descriptor, objectsByName.get(this.address(scope, id))); objectsByName.delete(this.address(scope, id)); },
  };
  const journalEntries = new Map<string, FirebaseErasureIntent>();
  const journal: Pick<FirebaseErasureJournal, 'writeOnce' | 'read'> = {
    async writeOnce(intent) { const hash = firebaseErasureIntentHash(intent); journalEntries.set(hash, intent);
      return { objectName: 'erasures/v1/' + hash, generation: '1', cipherSha256: 'b'.repeat(64), intentSha256: hash, bytes: 1, format: 'yuban-erasure-journal/v1' }; },
    async read(intent, descriptor) { assert.deepEqual(journalEntries.get(descriptor.intentSha256), intent); return intent; },
  };
  const store = createFirestoreChatFilesStore({ ...options, objects, journal, serverClock: () => clock });
  const exporter = createFirestoreAccountExport({ ...options, files: store,
    photos: { async content() { throw Error('Unrelated photo export must not run'); } } });
  const id = randomUUID(), stage = { batchId: randomUUID(), operationId: randomUUID(), actorUserId: 'parent', sourceHash: 'c'.repeat(64) };
  const reservation = { opId: id, fileName: 'original.txt', mimeType: 'text/plain', bytes: bytes.length, sha256 };
  const reserve = () => authority.runTransaction('parent', childId, async b => {
    const prepared = await store.prepareImportReservation(b, reservation, stage); prepared.commit(); return prepared.value;
  });
  const reserved = await reserve(); assert.deepEqual(await reserve(), reserved);
  await assert.rejects(store.uploadImported('parent', childId, id, reserved.version, bytes.toString('base64'), stage), { code: 'chat_file_upload_unknown' });
  await store.uploadImported('parent', childId, id, reserved.version, bytes.toString('base64'), stage);
  assert.equal(writes, 1); await assert.rejects(store.content('parent', childId, id), { code: 'chat_file_not_available' });
  assert.deepEqual((await exporter.page('parent', { section: 'files', childId })).items, [], 'Unpublished imports are not exported');
  const provenance: ImportProvenance = { current: { source: { serverId: 'source', accountId: 'source-parent', childId: randomUUID(), section: 'files', resourceId: randomUUID(), resourceVersion: 3,
    authorUserId: null, createdAt: new Date(now - 1000).toISOString(), confirmedBy: null, confirmedAt: null, confirmationBasis: null, assigneeUserId: null },
    sourceHash: stage.sourceHash, packageId: randomUUID(), packageVersion: 1, manifestSha256: 'd'.repeat(64), integrity: 'trusted', importedBy: 'parent', importedAt: new Date(now).toISOString() }, previous: [] };
  const receipt = options.database.collection('synthetic_import_receipts').doc(stage.operationId);
  const publish = (rollback = false) => authority.runTransaction('parent', childId, async b => {
    const prepared = await store.prepareImportPublication(b, id, stage, provenance);
    prepared.commit(); b.transaction.set(receipt, { id, operationId: stage.operationId });
    if (rollback) throw Error('Synthetic transaction rollback'); return prepared.value;
  });
  await assert.rejects(publish(true), /Synthetic transaction rollback/u);
  await assert.rejects(store.content('parent', childId, id), { code: 'chat_file_not_available' });
  assert.equal((await options.database.runTransaction(tx => tx.get(receipt))).exists, false);
  const published = await publish(); assert.equal(published.state, 'ready'); assert.deepEqual(await publish(), published);
  assert.equal((await store.content('parent', childId, id)).base64, bytes.toString('base64'));
  const exported = (await exporter.page('parent', { section: 'files', childId })).items as { importedFrom?: ImportProvenance; importStage?: unknown }[];
  assert.equal(exported.length, 1); assert.deepEqual(exported[0].importedFrom, provenance); assert.equal(exported[0].importStage, undefined);
  await assert.rejects(store.get('other', childId, id));
  await assert.rejects(authority.runTransaction('parent', childId, b => store.prepareImportPublication(b, id, { ...stage, sourceHash: 'e'.repeat(64) }, provenance)), { code: 'operation_conflict' });
  clock += 86400_001;
  const scope = await authority.runTransaction('parent', childId, b => Promise.resolve(b.scope));
  assert.equal(await store.expireUnlinked(scope, id), false);
  const deleted = await store.delete('parent', childId, id, published.version, randomUUID());
  assert.equal(deleted.cleanupPending, true);
  assert.equal((await store.cleanupDeleted(scope, id)).state, 'complete'); assert.equal(objectsByName.size, 0);
  await assert.rejects(publish(), { code: 'chat_file_deleted' });
});
