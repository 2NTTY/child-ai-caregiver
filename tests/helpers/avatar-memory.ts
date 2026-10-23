import { createHash, randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { FirebasePhotoBucketPort } from '../../server/firebase-photo-objects.ts';
import { createStorageCipher } from '../../server/storage-crypto.ts';
import { createAvatarObjects } from '../../server/firebase-avatar-objects.ts';
import { createFirebaseErasureJournal } from '../../server/firebase-erasure-journal.ts';
import { createFirestoreAuthority } from '../../server/firestore-authority.ts';
import { createFirestoreAvatarStore } from '../../server/firestore-avatars.ts';
import { createFirestoreAvatarCleanup } from '../../server/firestore-avatar-cleanup.ts';
import { createFirestoreAvatarData } from '../../server/firestore-avatar-data.ts';
import { createFirestoreOnlineStore } from '../../server/firestore-online.ts';
import { avatarBinding } from '../../server/avatar-data.ts';
import { readAvatarConfig } from '../../server/avatar-config.ts';
import { SERVICE_POLICY_VERSION } from '../../src/shared/account-service.ts';
import type { AvatarTarget } from '../../src/shared/avatars.ts';
import type { AvatarCodec } from '../../server/avatar-codec.ts';
import type { OnlineSubmission } from '../../src/shared/online.ts';
import { firestoreDomainFixture } from './firestore-domain-memory.ts';

export function avatarMemoryBucket(name: string) {
  const records = new Map<string, { bytes: Buffer; metadata: any }>(); let writes = 0, removes = 0, lose = false, unavailable = false;
  const port: FirebasePhotoBucketPort = {
    async writeNew(objectName, bytes, options) {
      writes++; if (records.has(objectName)) throw Object.assign(new Error('Synthetic immutable conflict'), { code: 412 });
      const metadata = { ...structuredClone(options.metadata), name: objectName, bucket: name, generation: String(9007199254740993n + BigInt(writes)), size: String(bytes.length) };
      records.set(objectName, { bytes: Buffer.from(bytes), metadata });
      if (lose) { lose = false; throw new Error('Synthetic lost object reply'); } return structuredClone(metadata);
    },
    async metadata(objectName, generation) {
      if (unavailable) throw Object.assign(new Error('Synthetic metadata unavailable'), { code: 503 });
      const row = records.get(objectName);
      if (!row || generation !== undefined && generation !== row.metadata.generation) throw Object.assign(new Error('Synthetic absent'), { code: 404 });
      return structuredClone(row.metadata);
    },
    readPinned(objectName, generation) {
      let sent = false; return new Readable({ read() {
        if (sent) return; sent = true; const row = records.get(objectName);
        if (!row || unavailable) { this.destroy(new Error('Synthetic read unavailable')); return; }
        this.emit('response', { statusCode: 206, headers: { 'x-goog-generation': generation, 'content-length': String(row.bytes.length) } });
        this.push(Buffer.from(row.bytes)); this.push(null);
      } });
    },
    async removePinned(objectName, generation) {
      const row = records.get(objectName); if (row && row.metadata.generation !== generation) throw new Error('Synthetic wrong generation');
      removes++; records.delete(objectName);
    },
  };
  return { port, records, writes: () => writes, removes: () => removes, lose: () => { lose = true; }, unavailable: (value: boolean) => { unavailable = value; } };
}
export async function avatarDomainFixture(injected: { codec?: Pick<AvatarCodec, 'normalize'> } = {}) {
  const fake = firestoreDomainFixture(), cipher = createStorageCipher(Buffer.alloc(32, 49));
  let now = Date.now(), decodes = 0, decodeHook: (() => Promise<void>) | undefined;
  const options = { database: fake.database, cipher, projectId: 'synthetic-avatar-project', namespace: 'synthetic_avatar', serverClock: () => now };
  const config = readAvatarConfig({ AVATAR_WRITES_ENABLED: 'true' }), bucket = avatarMemoryBucket('synthetic-avatar-private'), journalBucket = avatarMemoryBucket('synthetic-avatar-journal');
  const objects = createAvatarObjects({ config: { projectId: options.projectId, namespace: options.namespace, bucketName: 'synthetic-avatar-private' }, cipher, bucket: bucket.port });
  const journal = createFirebaseErasureJournal({ config: { projectId: options.projectId, namespace: options.namespace, bucketName: 'synthetic-avatar-journal' }, cipher, bucket: journalBucket.port });
  // Codec boundary is mocked here; the separate native probe verifies actual decode/orientation/metadata behavior.
  const normalized = Buffer.from([255, 216, 255, 224, 0, 2, 255, 217]);
  const codec: Pick<AvatarCodec, 'normalize'> = injected.codec ?? { async normalize(_actor, _input, _mime, _crop, recipe) {
    decodes++; await decodeHook?.(); return { buffer: Buffer.from(normalized), bytes: normalized.length, mimeType: 'image/jpeg',
      sha256: createHash('sha256').update(normalized).digest('hex'), width: recipe.outputSize, height: recipe.outputSize };
  } };
  const authority = createFirestoreAuthority(options), generation = randomUUID(), owner = 'synthetic-avatar-owner';
  await authority.initializeControl({ generation, enabled: true });
  await authority.issueInvitation({ email: 'avatar@example.test', operationId: randomUUID(), expiresAt: new Date(now + 86400000).toISOString() });
  await authority.admitIdentity({ userId: owner, email: 'avatar@example.test', emailVerified: true });
  await authority.acknowledge({ userId: owner, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const scope = await authority.runTransaction(owner, null, async value => value.scope);
  const makeStore = () => createFirestoreAvatarStore({ ...options, config, codec, objects, journal });
  const avatars = makeStore(), online = createFirestoreOnlineStore({ ...options, avatars }), data = createFirestoreAvatarData(options);
  const cleanup = createFirestoreAvatarCleanup({ ...options, objects, journal });
  const target: AvatarTarget = { kind: 'self' }, input = Buffer.from('synthetic-original-never-persisted');
  const binding = avatarBinding(scope, target), deviceId = randomUUID();
  function submission(action: 'uploads' | 'commit' | 'remove', payload: Record<string, unknown>, selected: AvatarTarget = target): OnlineSubmission {
    return { path: (selected.kind === 'self' ? '/api/me/avatar' : '/api/children/' + selected.childId + '/avatar') + '/' + action, payload,
      operation: { opId: randomUUID(), deviceId, workspaceId: scope.workspaceId, storageEpoch: scope.storageEpoch } };
  }
  const reserve = (expectedVersion = 0, selected = target) => submission('uploads', { expectedVersion, policyId: config.policy.policyId,
    mimeType: 'image/png', bytes: input.length, sha256: createHash('sha256').update(input).digest('hex'), crop: { centerX: .5, centerY: .5, zoom: 1 } }, selected);
  async function upload(uploadId: string, selected: AvatarTarget = target) {
    const admitted = await avatars.uploadAdmission(owner, selected, uploadId);
    try { return await admitted.upload(Buffer.from(input), new AbortController().signal); } finally { admitted.release(); }
  }
  return { fake, options, config, bucket, journalBucket, journal, objects, authority, generation, owner, scope, binding, target, input,
    avatars, online, data, cleanup, makeStore, submission, reserve, upload, now: () => now, advance: (ms: number) => { now += ms; },
    decodes: () => decodes, decodeHook: (hook?: () => Promise<void>) => { decodeHook = hook; } };
}
