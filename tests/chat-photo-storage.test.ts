import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestorePhotoStore } from '../server/firestore-photos.ts';
import { createFirestoreChatStore, firestoreChatMessageSchema } from '../server/firestore-chat.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { photoHash } from '../server/photo-files.ts';
import { firebaseErasureIntentHash, type FirebaseErasureJournal } from '../server/firebase-erasure-journal.ts';
import type { FirebasePhotoObjects, FirebasePhotoObjectDescriptor } from '../server/firebase-photo-objects.ts';
import type { WorkRecoveryScope } from '../server/firestore-work-continuation-recovery.ts';
import type { ChatMessage } from '../src/shared/chat.ts';
import type { PhotoMetadata } from '../src/shared/photos.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';

test('chat photos reuse one original and receipt while version, owner and deletion checks keep image reads private', async () => {
  const fake = firestoreDomainFixture(), options = { database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 47)),
    projectId: 'synthetic-chat-photo-project', namespace: 'synthetic_chat_photos' };
  const authority = createFirestoreAuthority(options);
  await authority.initializeControl({ generation: randomUUID(), enabled: true });
  const children = new Map<string, string>();
  for (const userId of ['parent', 'other']) {
    const email = userId + '@example.test';
    await authority.issueInvitation({ email, expiresAt: new Date(Date.now() + 60_000).toISOString(), operationId: randomUUID() });
    await authority.admitIdentity({ userId, email, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    children.set(userId, (await authority.createChild({ userId, operationId: randomUUID(), displayName: '合成照片孩子' })).child.id);
  }
  // The same synthetic PNG header used by the existing photo storage fixture.
  const bytes = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(4), Buffer.from('IHDR'), Buffer.alloc(8)]);
  const base64 = bytes.toString('base64'), metadata: PhotoMetadata = { fileName: 'synthetic-chat.png', source: 'Synthetic private original',
    mimeType: 'image/png', bytes: bytes.length, sha256: photoHash(bytes) };
  const stored = new Map<string, { base64: string; descriptor: FirebasePhotoObjectDescriptor }>();
  let writes = 0, reads = 0;
  const address = (scope: WorkRecoveryScope, id: string) => 'photos/v1/' + photoHash(Buffer.from(JSON.stringify([
    'yuban-photo-object', 1, options.projectId, options.namespace,
    { ownerUserId: scope.ownerUserId, workspaceId: scope.workspaceId, childId: scope.childId, storageEpoch: scope.storageEpoch },
  ]))) + '/' + id;
  const objects: Pick<FirebasePhotoObjects, 'write' | 'recover' | 'read'> = {
    async write(scope, id, input) {
      writes++; const objectName = address(scope, id); assert.equal(stored.has(objectName), false);
      const descriptor = { objectName, generation: '9007199254740993999', cipherSha256: '1'.repeat(64),
        sha256: photoHash(Buffer.from(input.base64, 'base64')), bytes: bytes.length, mimeType: input.mimeType };
      stored.set(objectName, { base64: input.base64, descriptor }); return descriptor;
    },
    async recover(scope, id, input) { const value = stored.get(address(scope, id))!; assert.equal(value.base64, input.base64); return value.descriptor; },
    async read(scope, id, descriptor) {
      reads++; const value = stored.get(address(scope, id))!; assert.deepEqual(value.descriptor, descriptor);
      return { buffer: Buffer.from(value.base64, 'base64'), base64: value.base64, mimeType: descriptor.mimeType };
    },
  };
  const journal: Pick<FirebaseErasureJournal, 'writeOnce'> = { async writeOnce(intent) {
    return { objectName: 'erasures/v1/' + '2'.repeat(64), generation: '9007199254740993998', cipherSha256: '3'.repeat(64),
      intentSha256: firebaseErasureIntentHash(intent), bytes: 512, format: 'yuban-erasure-journal/v1' };
  } };
  const photos = createFirestorePhotoStore({ ...options, objects, journal }), chat = createFirestoreChatStore({ ...options, photos });
  const online = createFirestoreOnlineStore({ ...options, mutations: [chat.mutation] }), childId = children.get('parent')!;
  const command = async (userId: string, child: string, expectedVersion: number) => {
    const path = `/api/children/${child}/messages`, payload = { text: '', photo: { id: ready.id, expectedVersion } };
    return { path, payload, operation: { ...await online.context(userId, { path, payload }), opId: randomUUID(), deviceId: randomUUID() } };
  };
  const reserved = await photos.reserve('parent', childId, randomUUID(), metadata);
  const ready = await photos.upload('parent', childId, reserved.id, base64);
  const first = await command('parent', childId, ready.version);
  fake.loseReply();
  await assert.rejects(online.submit('parent', first), /Synthetic lost commit acknowledgement/u);
  const receipt = await online.submit('parent', first), message = (receipt.result as { message: ChatMessage }).message;
  assert.deepEqual(message.photo, { ...metadata, id: ready.id, version: ready.version }); assert.equal(message.text, '');
  const second = await online.submit('parent', await command('parent', childId, ready.version));
  assert.notEqual((second.result as { message: ChatMessage }).message.id, message.id);
  assert.deepEqual((second.result as { message: ChatMessage }).message.photo, message.photo);
  assert.deepEqual(await photos.get('parent', childId, ready.id), ready); assert.equal(writes, 1); assert.equal(reads, 0);
  const committed = [...fake.records];
  assert.deepEqual(await online.submit('parent', first), receipt); assert.deepEqual([...fake.records], committed);
  assert.equal((await chat.listForUser('parent', childId))!.messages.length, 2);
  assert.equal(firestoreChatMessageSchema.safeParse({ ...message, role: 'model', authorUserId: null, inReplyTo: randomUUID() }).success, false);

  const wrongVersion = await command('parent', childId, ready.version + 1), other = await command('other', children.get('other')!, ready.version);
  const unchanged = [...fake.records];
  await assert.rejects(online.submit('parent', wrongVersion), (error: any) => error.code === 'version_conflict');
  await assert.rejects(online.submit('other', other), (error: any) => error.code === 'not_found');
  assert.deepEqual([...fake.records], unchanged);
  assert.equal(await photos.authorizeImage('parent', childId, message.photo!), true);
  assert.equal(await photos.authorizeImage('other', children.get('other')!, message.photo!), false);
  assert.equal(await photos.authorizeImage('parent', childId, { ...message.photo!, source: 'Changed source' }), false);
  assert.equal(reads, 0, 'authorization reads only current metadata');
  const claim = await photos.claimExtraction('parent', childId, ready.id, ready.version);
  const advanced = await photos.finishExtraction('parent', childId, ready.id, claim.photo.extraction.runId!, null, 'synthetic-no-model', null);
  assert.ok(advanced.version > message.photo!.version);
  assert.deepEqual(await photos.agentImage('parent', childId, message.photo!), { data: base64, mimeType: metadata.mimeType, reference: message.photo });
  assert.equal(reads, 1); assert.equal(writes, 1);
  await photos.delete('parent', childId, ready.id, advanced.version, randomUUID());
  assert.equal(await photos.authorizeImage('parent', childId, message.photo!), false);
  await assert.rejects(photos.agentImage('parent', childId, message.photo!), (error: any) => error.code === 'photo_deleted');
  assert.equal(reads, 1, 'deleted originals never reach the binary port');
});
