import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Firestore } from '@google-cloud/firestore';
import { createStorageCipher } from '../../server/storage-crypto.ts';
import { createFirebaseAvatarRestoreCopies, type AvatarCopyPayload } from '../../server/firebase-avatar-restore-copies.ts';
import { avatarBinding, avatarHeadId, AVATAR_NIL, type AvatarObjectDescriptor } from '../../server/avatar-data.ts';
import { avatarObjectAddress } from '../../server/firebase-avatar-objects.ts';
import { firebaseRestoreEpoch } from '../../server/firestore-restore.ts';
import { FirestoreDomainData } from '../../server/firestore-domain-data.ts';
import { firestoreDomainFixture } from './firestore-domain-memory.ts';

/** Synthetic serial transactions + document-id pagination, not native concurrency or cloud index evidence. */
export function avatarRestoreFixture() {
  const fake = firestoreDomainFixture();
  type Ref = { path: string; get(): Promise<any>; set(value: unknown): Promise<void> };
  type Query = { path: string; avatarQuery: true; size: number; cursor?: string; doc(id: string): Ref;
    orderBy(field: unknown): Query; limit(size: number): Query; startAfter(cursor: string): Query; get(): Promise<any> };
  const snapshot = (path: string) => ({ id: path.split('/').at(-1)!, ref: ref(path), exists: fake.records.has(path),
    data: () => structuredClone(fake.records.get(path)), get: (field: string) => structuredClone(fake.records.get(path)?.[field]) });
  function ref(path: string): Ref { return { path, async get() { return snapshot(path); }, async set(value) { fake.records.set(path, structuredClone(value)); } }; }
  function read(query: Query) {
    const docs = [...fake.records.keys()].filter(path => path.startsWith(query.path + '/') && !path.slice(query.path.length + 1).includes('/'))
      .sort().map(snapshot).filter(row => !query.cursor || row.id > query.cursor).slice(0, query.size);
    return { docs, size: docs.length };
  }
  function query(path: string, size = Infinity, cursor?: string): Query {
    const value: Query = { path, avatarQuery: true, size, cursor, doc: id => ref(path + '/' + id),
      orderBy: () => query(path, size, cursor), limit: next => query(path, next, cursor), startAfter: next => query(path, size, next), async get() { return read(value); } };
    return value;
  }
  const database = { databaseId: 'synthetic-avatar-restore', collection: query, doc: ref,
    runTransaction(callback: (tx: any) => Promise<any>) {
      return fake.database.runTransaction(async tx => {
        let wrote = false;
        const get = async (target: Ref | Query) => { assert.equal(wrote, false, 'Read after write');
          return 'avatarQuery' in target ? read(target) : tx.get(target as any); };
        return callback({ get, getAll: (...refs: Ref[]) => Promise.all(refs.map(get)),
          create: (target: Ref, value: unknown) => { wrote = true; return tx.create(target as any, value as any); },
          set: (target: Ref, value: unknown) => { wrote = true; return tx.set(target as any, value as any); },
          delete: (target: Ref) => { wrote = true; return tx.delete(target as any); } });
      });
    },
  } as unknown as Firestore;
  const options = { database, cipher: createStorageCipher(Buffer.alloc(32, 57)), projectId: 'synthetic-avatar-project', namespace: 'synthetic_avatar_restore' };
  const data = new FirestoreDomainData(options), targetBucket = 'synthetic-avatar-private', objects = new Map<string, AvatarObjectDescriptor>();
  let inspections = 0, unavailable = false;
  const copies = createFirebaseAvatarRestoreCopies({ ...options, targetBucket,
    batches: { scanPageSize: 2, handoffBatchSize: 2, handoffBatchBytes: 32 * 1024 },
    objects: { async inspect(binding, assetId) { inspections++; if (unavailable) throw new Error('Synthetic inspect unavailable');
      return objects.get(avatarObjectAddress({ projectId: options.projectId, namespace: options.namespace, bucketName: targetBucket }, binding, assetId).objectName) ?? null; } } });
  const identity = '1'.repeat(64), restoreId = randomUUID(), sourceGeneration = randomUUID();
  function value(index = 0): AvatarCopyPayload {
    const source = avatarBinding({ ownerUserId: 'synthetic-owner-' + index, workspaceId: randomUUID(), childId: AVATAR_NIL, storageEpoch: randomUUID() }, { kind: 'self' });
    const binding = { ...source, scope: { ...source.scope, storageEpoch: firebaseRestoreEpoch(options.projectId, database.databaseId, restoreId, source.scope.workspaceId) } };
    const asset = { id: randomUUID(), mimeType: 'image/jpeg' as const, bytes: 8, sha256: '2'.repeat(64), width: 256, height: 256 };
    const descriptor: AvatarObjectDescriptor = { format: 'yuyoufang-avatar-object/v1', asset,
      objectName: avatarObjectAddress({ projectId: options.projectId, namespace: options.namespace, bucketName: targetBucket }, source, asset.id).objectName,
      generation: '9007199254740993', cipherSha256: '3'.repeat(64) };
    return { format: 'yuyoufang-avatar-restore-copy/v1', identity, restoreId, sourceGeneration, targetDatabaseId: database.databaseId, targetBucket,
      provenanceHash: '4'.repeat(64), originalInventoryHash: '5'.repeat(64),
      evidence: { journalHash: '6'.repeat(64), authHash: '7'.repeat(64), authorityHash: '8'.repeat(64) },
      source: { path: data.ref('avatar_heads', 'avatar-head', avatarHeadId(source)).path, binding: source, version: 1, descriptor },
      cleanup: { binding, objectBinding: binding, assetId: asset.id, uploadId: randomUUID(), expectedVersion: 0, committedVersion: 1,
        preparedAsset: asset, descriptor: null, state: 'writing', reason: 'staging', writeLease: null, attempt: 0, nextAttemptAt: '2026-10-23T09:00:00Z' } };
  }
  function stored(value: AvatarCopyPayload) {
    return { ...value.source.descriptor, objectName: avatarObjectAddress({ projectId: options.projectId, namespace: options.namespace, bucketName: targetBucket }, value.cleanup.binding, value.cleanup.assetId).objectName,
      generation: '9007199254740994', cipherSha256: '9'.repeat(64) };
  }
  return { fake, database, options, data, copies, identity, value, stored, objects, inspections: () => inspections,
    unavailable: (next: boolean) => { unavailable = next; } };
}
