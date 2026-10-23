import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { FieldPath, Timestamp, type Firestore, type Transaction, type DocumentReference, type DocumentData } from '@google-cloud/firestore';
import type { Bucket } from '@google-cloud/storage';
import type { UserRecord } from 'firebase-admin/auth';
import { z } from 'zod';
import { createFirebaseRecoveryOperator, type FirebaseRecoveryOperatorOptions } from '../server/firebase-recovery-operator.ts';
import { createFirebaseManagedBackup } from '../server/firebase-managed-backup.ts';
import { createFirestoreAuthority, firestoreAuthoritySchemas } from '../server/firestore-authority.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { FirestoreDeviceSessions } from '../server/firestore-device-sessions.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { firebaseRestoreEpoch, firebaseRestoreGeneration } from '../server/firestore-restore.ts';
import { setFirebaseBackupControl, firebaseBackupDocumentDigest, assertFirebaseBackupInventory,
  type FirebaseBackupDocument, type FirebaseBackupInventory } from '../server/firestore-backup.ts';
import { firebaseBackupManifestPayloadSchema, firebaseBackupManifestDescriptorSchema, firebaseBackupInventorySchema,
  type FirebaseBackupManifestPayload, type FirebaseBackupArtifacts } from '../server/firebase-backup-artifacts.ts';
import type { FirebaseNativeRecovery, FirebaseNativeRecoveryOperation } from '../server/firebase-native-recovery.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { canonical } from '../server/firestore-session-codec.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import type { OnlineSubmission } from '../src/shared/online.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';
import { recoveryOperatorAvatar } from './helpers/recovery-operator-avatar.ts';
import { avatarHeadRecordSchema, avatarCleanupRecordSchema } from '../server/avatar-data.ts';

const OWNER = 'synthetic-operator-owner', EMAIL = 'synthetic-operator@example.test';
const PROJECT = 'synthetic-operator-project', NAMESPACE = 'unit_recovery_operator';
const SOURCE = 'synthetic-source-db', TARGET = 'yuban-restore-synthetic', BUCKET = 'synthetic-backup-bucket';
const KEY = 'projects/' + PROJECT + '/secrets/synthetic-storage-key/versions/1';
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const code = (expected: string) => (error: unknown) => error instanceof Error && 'code' in error && error.code === expected;
interface Write { action: 'set' | 'create' | 'update' | 'delete'; path: string }
interface Attempt { writes: Write[]; acknowledged: boolean }
interface DocumentOrderQuery {
  documentOrder: true; path: string; count: number; cursor: string | null;
  limit(count: number): DocumentOrderQuery; startAfter(id: string): DocumentOrderQuery;
  get(): Promise<{ docs: { id: string; ref: { path: string }; data(): DocumentData | undefined }[]; size: number }>;
}
function isDocumentOrder(value: unknown): value is DocumentOrderQuery {
  return typeof value === 'object' && value !== null && 'documentOrder' in value && value.documentOrder === true;
}

/** Adds public SDK inventory/point-read methods without changing the shared serial transaction fixture. */
function memoryDatabase(databaseId: string) {
  const fake = firestoreDomainFixture(), attempts: Attempt[] = [];
  let updateTimeMs = Date.now() - 420_000, loseWriteReply = false, lostWriteReplies = 0;
  function reference(path: string) {
    return { path, id: path.slice(path.lastIndexOf('/') + 1), async set(value:DocumentData){
      const split=path.lastIndexOf('/'),ref=fake.database.collection(path.slice(0,split)).doc(path.slice(split+1));
      await fake.database.runTransaction(async tx=>{tx.set(ref,value);});
    }, async get() {
      return { exists: fake.records.has(path), ref: { path }, data: () => structuredClone(fake.records.get(path)),
        updateTime: Timestamp.fromMillis(updateTimeMs) };
    } };
  }
  function documentOrder(path: string, count = Infinity, cursor: string | null = null): DocumentOrderQuery {
    return { documentOrder: true, path, count, cursor, limit: value => documentOrder(path, value, cursor),
      startAfter: id => documentOrder(path, count, id), async get() {
        const paths = [...fake.records.keys()].filter(key => key.startsWith(path + '/') && !key.slice(path.length + 1).includes('/'))
          .sort().filter(key => cursor === null || key.slice(path.length + 1) > cursor).slice(0, count);
        const docs = await Promise.all(paths.map(async key => ({ ...await reference(key).get(), id: key.slice(path.length + 1) })));
        return { docs, size: docs.length };
      } };
  }
  function collection(path: string) {
    const base = fake.database.collection(path);
    return { ...base, id: path, doc: (id: string) => reference(path + '/' + id),
      orderBy(field: string | FieldPath, direction?: 'asc' | 'desc') {
        if (field instanceof FieldPath && field.isEqual(FieldPath.documentId())) {
          assert.equal(direction === undefined || direction === 'asc', true); return documentOrder(path);
        }
        return base.orderBy(field, direction);
      } };
  }
  const database = {
    databaseId, collection, doc: reference,
    async listCollections() { return [...new Set([...fake.records.keys()].map(path => path.split('/')[0]))]
      .map(path => { assert.ok(path); return collection(path); }); },
    async runTransaction<T>(callback: (transaction: Transaction) => Promise<T>) {
      const attempt: Attempt = { writes: [], acknowledged: false }; attempts.push(attempt);
      const result = await fake.database.runTransaction(async native => {
        const transaction = {
          async get(target: unknown) {
            if (!isDocumentOrder(target)) return native.get(target as DocumentReference);
            // Get through the original harness, so its read-before-write assertion still applies.
            const page = await native.get(fake.database.collection(target.path));
            const docs = page.docs.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
              .filter(row => target.cursor === null || row.id > target.cursor).slice(0, target.count);
            return { docs:docs.map(row=>({...row,updateTime:Timestamp.fromMillis(updateTimeMs)})), size: docs.length };
          },
          getAll: (...refs: DocumentReference[]) => native.getAll(...refs),
          set(ref: DocumentReference, value: DocumentData) { attempt.writes.push({ action: 'set', path: ref.path }); native.set(ref, value); },
          create(ref: DocumentReference, value: DocumentData) { attempt.writes.push({ action: 'create', path: ref.path }); native.create(ref, value); },
          update(ref: DocumentReference, value: DocumentData) { attempt.writes.push({ action: 'update', path: ref.path }); native.update(ref, value); },
          delete(ref: DocumentReference) { attempt.writes.push({ action: 'delete', path: ref.path }); native.delete(ref); },
        } as unknown as Transaction;
        const value = await callback(transaction);
        if (loseWriteReply && attempt.writes.some(row=>!row.path.startsWith(NAMESPACE+'_restore_operations/'))) {
          loseWriteReply = false; lostWriteReplies++; fake.loseReply();
        }
        return value;
      });
      attempt.acknowledged = true; return result;
    },
  } as unknown as Firestore;
  function documents(): FirebaseBackupDocument[] { return [...fake.records].map(([path, data]) => ({ path, data: structuredClone(data) })); }
  function seed(documents: readonly FirebaseBackupDocument[]) {
    assert.equal(fake.records.size, 0); for (const row of documents) fake.records.set(row.path, structuredClone(row.data));
  }
  return { database, records: fake.records, attempts, documents, seed,
    setUpdateTime: (value: number) => { updateTimeMs = value; },
    loseNextWriteReply: () => { loseWriteReply = true; },
    get lostWriteReplies() { return lostWriteReplies; } };
}
async function fixture(withAvatar = false) {
  const source = memoryDatabase(SOURCE), target = memoryDatabase(TARGET), now = Date.now();
  const cipher = createStorageCipher(Buffer.alloc(32, 81));
  const options = { database: source.database, cipher, projectId: PROJECT, namespace: NAMESPACE, serverClock: () => now };
  const authority = createFirestoreAuthority(options), online = createFirestoreOnlineStore(options), codec = createFirestoreRestoreCodec(options);
  let generation = randomUUID();
  await authority.initializeControl({ generation, enabled: true });
  await authority.issueInvitation({ email: EMAIL, expiresAt: new Date(now + 86_400_000).toISOString(), operationId: randomUUID() });
  await authority.admitIdentity({ userId: OWNER, email: EMAIL, emailVerified: true });
  await authority.acknowledge({ userId: OWNER, policyVersion: SERVICE_POLICY_VERSION, operationId: randomUUID() });
  async function command(path: string, payload: unknown): Promise<OnlineSubmission> {
    return { path, payload, operation: { ...await online.context(OWNER, { path, payload }), opId: randomUUID(), deviceId: randomUUID() } };
  }
  const childReceipt = await online.submit(OWNER, await command('/api/children', { displayName: '合成 operator 孩子' }));
  const childId = z.object({ child: z.object({ id: z.uuid() }) }).parse(childReceipt.result).child.id;
  const binding = await authority.readScope(OWNER, childId);
  await online.submit(OWNER, await command('/api/children/' + childId + '/tasks', { confirm: true, values: {
    title: 'Synthetic operator task', details: 'Synthetic operator source', kind: 'ordinary', assigneeUserId: OWNER,
    dueAt: new Date(now + 86_400_000).toISOString(), timeZone: 'Asia/Hong_Kong' } }));
  await new FirestoreDeviceSessions({ ...options, namespace: NAMESPACE + '_sessions' }).issue({ userId: OWNER,
    sessionHash: '1'.repeat(64), expiresAtMs: now + 86_400_000, authTimeSeconds: Math.floor(now / 1000) });
  const avatar = withAvatar ? await recoveryOperatorAvatar(options, binding.scope, now) : null;
  if (avatar) {
    for (const row of avatar.records) source.records.set(row.path, row.data);
    // Existing valid synthetic session records make the real final apply plan span multiple bounded pages.
    const sessions = new FirestoreDeviceSessions({ ...options, namespace: NAMESPACE + '_sessions' });
    for (let i = 0; i < 80; i++) await sessions.issue({ userId: OWNER, sessionHash: (i + 2).toString(16).padStart(64, '0'),
      expiresAtMs: now + 86_400_000, authTimeSeconds: Math.floor(now / 1000) });
  }
  async function switchControl(enabled: boolean) {
    const next = randomUUID();
    await setFirebaseBackupControl(options, { expectedGeneration: generation, generation: next, enabled }); generation = next;
  }
  await switchControl(false);
  const snapshot = source.documents(), backupId = randomUUID(), restoreId = randomUUID();
  const snapshotTime = new Date(Math.floor((now - 360_000) / 60_000) * 60_000).toISOString();
  const rows = snapshot.map(row => ({ path: row.path, ...firebaseBackupDocumentDigest(row) })).sort((a, b) => a.path.localeCompare(b.path));
  const documents = rows.map(({ path, sha256 }) => ({ path, sha256 }));
  const inventory: FirebaseBackupInventory = { schema: 'yuban-firestore-backup-inventory/v1', projectId: PROJECT,
    databaseId: SOURCE, namespace: NAMESPACE, snapshotTime, documents, documentCount: rows.length,
    bytes: rows.reduce((sum, row) => sum + row.bytes, 0), sha256: digest(documents) };
  assertFirebaseBackupInventory(inventory, snapshot);
  const outputUriPrefix = 'gs://' + BUCKET + '/firebase-backups/v1/' + backupId + '/firestore';
  const manifest: FirebaseBackupManifestPayload = firebaseBackupManifestPayloadSchema.parse({
    format: 'yuban-firebase-backup-manifest/v1', backupId, databaseId: SOURCE, snapshotTime, controlGeneration: generation,
    sourceCommit: 'a'.repeat(40), keyVersionRef: KEY, retainedUntil: new Date(now + 14 * 86_400_000).toISOString(),
    ...(avatar ? { avatars: [await avatar.entry(backupId, new Date(now + 14 * 86_400_000).toISOString())] } : {}),
    nativeExport: { outputUriPrefix, objects: [{ name: 'firebase-backups/v1/' + backupId + '/firestore/export.overall_export_metadata',
      generation: '1', size: 48, crc32c: 'AAAAAA==' }] }, inventory, photos: [],
  });
  // The artifact port is synthetic; the real inventory and operator validators remain enabled.
  const descriptor = firebaseBackupManifestDescriptorSchema.parse({ format: 'yuban-firebase-backup-manifest/v1',
    objectName: 'firebase-backups/v1/' + backupId + '/manifest', generation: '1', cipherSha256: digest(manifest),
    bytes: Buffer.byteLength(canonical(manifest)), retainedUntil: manifest.retainedUntil });
  const calls = { findImport: 0, startImport: 0, getImport: 0, readManifest: 0, assertExport: 0, restorePhoto: 0, backupPhoto: 0, auth: 0, journal: 0 };
  const operation: FirebaseNativeRecoveryOperation = { name: 'projects/' + PROJECT + '/databases/' + TARGET + '/operations/synthetic-import',
    done: true, metadata: { operationState: 'SUCCESSFUL', inputUriPrefix: outputUriPrefix,
      progressDocuments: { completedWork: String(snapshot.length) } } };
  let existingImport: FirebaseNativeRecoveryOperation | null = null, disabled = false;
  const unexpected = async (): Promise<never> => { throw new Error('Unexpected synthetic recovery port call'); };
  const native: FirebaseNativeRecovery = {
    startExport: unexpected, getExport: unexpected, findExport: unexpected,
    async findImport(input) { calls.findImport++; assert.deepEqual(input, { backupId, outputUriPrefix }); return existingImport; },
    async startImport(input) { calls.startImport++; assert.deepEqual(input, { backupId, outputUriPrefix });
      target.seed(snapshot); existingImport = operation; return operation; },
    async getImport(name) { calls.getImport++; assert.equal(name, operation.name); return structuredClone(operation); },
  };
  const artifacts: FirebaseBackupArtifacts = {
    holdNativeExport: unexpected, writeManifest: unexpected,
    async readManifest(input) { calls.readManifest++; z.object({ backupId: z.uuid(), descriptor: firebaseBackupManifestDescriptorSchema }).strict().parse(input);
      assert.deepEqual(input, { backupId, descriptor }); return firebaseBackupManifestPayloadSchema.parse(manifest); },
    async assertNativeExportObjects(input) { calls.assertExport++; assert.deepEqual(input, { backupId, objects: manifest.nativeExport.objects }); },
  };
  const ports: FirebaseRecoveryOperatorOptions = { ...options, targetDatabase: target.database, backupBucketName: BUCKET,
    keyVersionRef: KEY, native, artifacts, ...(avatar ? { avatars: avatar.ports } : {}),
    photos: {
      async backupPhoto() { calls.backupPhoto++; return unexpected(); },
      async restorePhoto() { calls.restorePhoto++; return unexpected(); },
    },
    auth: { async getUser(userId): Promise<UserRecord> { calls.auth++; assert.equal(userId, OWNER);
      return { uid: userId, email: EMAIL, emailVerified: true, disabled, providerData: [],
        metadata: { creationTime: new Date(now).toUTCString(), lastSignInTime: new Date(now).toUTCString(), toJSON: () => ({}) },
        toJSON: () => ({ uid: userId, disabled, emailVerified: true, email: EMAIL }) };
    } },
    journalBucket: { async request() { calls.journal++; return [{ items: [] }, { statusCode: 200 }]; } } as unknown as Bucket,
    journal: { readObject: unexpected },
  };
  const operator = createFirebaseRecoveryOperator(ports);
  const importInput = { backupId, descriptor };
  function applyInput() { return { ...importInput, restoreId, operationName: operation.name, sourceGeneration: generation }; }
  return { source, target, options, ports, authority, codec, binding, snapshot, manifest, descriptor, calls, operator, operation, importInput, applyInput,
    avatar, switchControl, clearImport: () => { existingImport = null; }, disableAuth: (value: boolean) => { disabled = value; } };
}
let stopped = false;
void test('managed hot snapshot uses native provenance and the existing paused restore pipeline', async()=>{
  const f=await fixture();
  await f.switchControl(true);const hot=f.source.documents();f.target.seed(hot);
  const backupName=`projects/${PROJECT}/locations/asia-east2/backups/${randomUUID()}`,
    operationName=`projects/${PROJECT}/databases/${TARGET}/operations/synthetic-native`,
    sourceName=`projects/${PROJECT}/databases/${SOURCE}`,targetName=`projects/${PROJECT}/databases/${TARGET}`,
    sourceUid=randomUUID(),targetUid=randomUUID(),at=new Date().toISOString();
  let wrongSource=false;
  const managed=createFirebaseManagedBackup({projectId:PROJECT,sourceDatabaseId:SOURCE,targetDatabaseId:TARGET,location:'asia-east2',
    request:async request=>{
      assert.equal(request.method,'GET');assert.equal(request.retry,false);
      const resource=request.url.slice('https://firestore.googleapis.com/v1/'.length);
      const data=resource===backupName?{name:backupName,database:wrongSource?'wrong':sourceName,databaseUid:sourceUid,
        snapshotTime:at,expireTime:new Date(Date.now()+86400000).toISOString(),state:'READY',stats:{documentCount:String(hot.length),sizeBytes:'4096'}}:
        resource===sourceName?{name:sourceName,uid:sourceUid,locationId:'asia-east2'}:
        resource===targetName?{name:targetName,uid:targetUid,locationId:'asia-east2',type:'FIRESTORE_NATIVE',sourceInfo:{operation:operationName,backup:{backup:backupName}}}:
        resource===operationName?{name:operationName,done:true,metadata:{'@type':'type.googleapis.com/google.firestore.admin.v1.RestoreDatabaseMetadata',
          backup:backupName,database:targetName,operationState:'SUCCESSFUL',endTime:at},response:{name:targetName,uid:targetUid}}:null;
      assert.ok(data);return{status:200,data};
    }});
  const operator=createFirebaseRecoveryOperator({...f.ports,managed});
  const input=()=>({backupName,operationName,restoreId:f.applyInput().restoreId,sourceGeneration:f.applyInput().sourceGeneration});
  const originalTarget=structuredClone([...f.target.records]);
  await assert.rejects(operator.applyRestore(input()),code('recovery_source_not_paused'));
  await f.switchControl(false);wrongSource=true;
  await assert.rejects(operator.applyRestore(input()),code('managed_backup_binding'));
  assert.deepEqual([...f.target.records],originalTarget);
  wrongSource=false;const sourceBefore=structuredClone([...f.source.records]);
  const result=await operator.applyRestore(input());assert.equal(result.state,'applied-paused');
  const restored=f.target.documents().filter(row=>!row.path.startsWith(NAMESPACE+'_restore_operations/')).map(row=>f.codec.decode(row));
  const control=restored.find(row=>row.context.kind==='control');assert.ok(control);
  assert.equal(firestoreAuthoritySchemas.control.parse(control.value).enabled,false);
  assert.equal(restored.some(row=>row.context.kind==='task'),true);
  assert.equal(f.target.documents().some(row=>row.path.startsWith(NAMESPACE+'_sessions/')),false);
  assert.deepEqual([...f.source.records],sourceBefore);
  assert.equal((await operator.applyRestore(input())).replayed,true);
  assert.equal(f.calls.getImport,0);assert.equal(f.calls.readManifest,0);
});
function check(name: string, body: () => Promise<void>) {
  void test(name, async context => {
    if (stopped) { context.skip('Stopped after the first local acceptance failure'); return; }
    try { await body(); } catch (error) { stopped = true; throw error; }
  });
}

check('restore import starts only on an empty target and reuses an existing native operation', async () => {
  const f = await fixture(); assert.equal(f.target.records.size, 0);
  const operation = await f.operator.startRestoreImport(f.importInput);
  assert.deepEqual(operation, f.operation); assert.equal(f.calls.startImport, 1);
  assert.deepEqual(f.target.documents(), f.snapshot);
  const imported = structuredClone([...f.target.records]);
  assert.deepEqual(await f.operator.startRestoreImport(f.importInput), operation);
  assert.equal(f.calls.startImport, 1); assert.equal(f.calls.findImport, 2); assert.deepEqual([...f.target.records], imported);
  f.clearImport();
  await assert.rejects(f.operator.startRestoreImport(f.importInput), code('recovery_target_not_empty'));
  assert.equal(f.calls.startImport, 1); assert.equal(f.calls.restorePhoto, 0);
  assert.equal(f.target.attempts.some(attempt => attempt.writes.length > 0), false);
  assert.deepEqual([...f.target.records], imported);
});

check('restore rejects unpaused, undrained and mismatched inventories before any restore or target write', async () => {
  const f = await fixture(); await f.operator.startRestoreImport(f.importInput);
  const imported = structuredClone([...f.target.records]);
  await f.switchControl(true);
  await assert.rejects(f.operator.applyRestore(f.applyInput()), code('recovery_source_not_paused'));
  assert.equal(f.calls.getImport, 0); assert.equal(f.calls.auth, 0);
  await f.switchControl(false); f.source.setUpdateTime(Date.now() - 60_000);
  await assert.rejects(f.operator.applyRestore(f.applyInput()), code('recovery_source_not_drained'));
  assert.equal(f.calls.getImport, 0); assert.equal(f.calls.auth, 0);
  f.source.setUpdateTime(Date.now() - 420_000);
  const missing = f.snapshot.at(-1); assert.ok(missing); f.target.records.delete(missing.path);
  await assert.rejects(f.operator.applyRestore(f.applyInput()), code('inventory_invalid'));
  assert.equal(f.calls.getImport, 1); assert.equal(f.calls.auth, 0); assert.equal(f.calls.restorePhoto, 0);
  assert.equal(f.target.attempts.some(attempt => attempt.writes.length > 0), false);
  const remaining = imported.filter(([path]) => path !== missing.path);
  assert.deepEqual([...f.target.records], remaining);
});

check('restore commits staged data, recovers a lost acknowledgement and rejects changed replay evidence', async () => {
  const f = await fixture(); await f.operator.startRestoreImport(f.importInput);
  const input = f.applyInput(), sourceBefore = structuredClone([...f.source.records]);
  f.target.loseNextWriteReply();
  const result = await f.operator.applyRestore(input);
  assert.equal(result.state, 'applied-paused'); assert.equal(result.replayed, false); assert.equal(f.target.lostWriteReplies, 1);
  assert.equal(result.generation, firebaseRestoreGeneration(PROJECT, TARGET, input.restoreId));
  const checkpointPath = NAMESPACE + '_restore_operations/current', checkpointRaw = f.target.records.get(checkpointPath);
  assert.ok(checkpointRaw);
  const checkpoint = z.object({ format: z.literal('yuban-firebase-restore/v1'), state: z.literal('applied-paused'), restoreId: z.uuid(),
    generation: z.uuid(), inventory: firebaseBackupInventorySchema }).passthrough().parse(JSON.parse(f.options.cipher.decrypt(
      checkpointRaw.ciphertext, canonical(['yuban-firebase-restore', 1, PROJECT, TARGET, NAMESPACE, 'current']))));
  assert.equal(checkpoint.restoreId, input.restoreId); assert.equal(checkpoint.generation, result.generation);
  const restored = f.target.documents().filter(row => row.path !== checkpointPath);
  assertFirebaseBackupInventory(checkpoint.inventory, restored);
  const decoded = restored.map(row => f.codec.decode(row));
  const control = decoded.find(row => row.context.kind === 'control'); assert.ok(control);
  assert.deepEqual(firestoreAuthoritySchemas.control.parse(control.value), { enabled: false, generation: result.generation });
  const workspace = decoded.find(row => row.context.kind === 'workspace'); assert.ok(workspace);
  const currentWorkspace = firestoreAuthoritySchemas.workspace.parse(workspace.value);
  assert.equal(currentWorkspace.storageEpoch, firebaseRestoreEpoch(PROJECT, TARGET, input.restoreId, f.binding.scope.workspaceId));
  assert.notEqual(currentWorkspace.storageEpoch, f.binding.scope.storageEpoch);
  assert.equal(currentWorkspace.accessVersion, '2');
  const sessions = f.snapshot.filter(row => row.path.startsWith(NAMESPACE + '_sessions/')); assert.equal(sessions.length, 2);
  for (const session of sessions) assert.equal(f.target.records.has(session.path), false);
  const writing = f.target.attempts.filter(attempt => attempt.writes.length > 0);
  assert.ok(writing.length>=3);assert.equal(writing.filter(row=>!row.acknowledged).length,1);
  const writes=writing.flatMap(row=>row.writes);
  assert.equal(writes.filter(row=>row.action==='create'&&row.path===checkpointPath).length,1);
  assert.deepEqual(new Set(writes.filter(row => row.action === 'set'&&!row.path.startsWith(NAMESPACE+'_restore_operations/')).map(row => row.path)), new Set(restored.map(row => row.path)));
  for (const session of sessions) assert.equal(writes.some(row => row.action === 'delete' && row.path === session.path), true);
  assert.deepEqual([...f.source.records], sourceBefore);
  const committed = structuredClone([...f.target.records]), writeCount = writes.length;
  assert.deepEqual(await f.operator.applyRestore(input), { ...result, replayed: true });
  assert.equal(f.calls.getImport, 1); assert.equal(f.calls.restorePhoto, 0);
  assert.equal(f.target.attempts.filter(attempt => attempt.writes.length > 0).length, writing.length);
  assert.equal(writes.length, writeCount); assert.deepEqual([...f.target.records], committed); assert.deepEqual([...f.source.records], sourceBefore);
  f.disableAuth(true);
  await assert.rejects(f.operator.applyRestore(input), code('recovery_latest_state_changed'));
  assert.deepEqual([...f.target.records], committed); assert.deepEqual([...f.source.records], sourceBefore);
  f.disableAuth(false); await f.authority.revokeInvitation({ email: EMAIL, operationId: randomUUID() });
  const revoked = structuredClone([...f.source.records]);
  await assert.rejects(f.operator.applyRestore(input), code('recovery_latest_state_changed'));
  assert.deepEqual([...f.target.records], committed); assert.deepEqual([...f.source.records], revoked);
  assert.equal(f.target.attempts.filter(attempt => attempt.writes.length > 0).length, writing.length);
  assert.equal(f.calls.restorePhoto, 0);
});

void test('interrupted progress revalidates native provenance after entry and before applying a page', async () => {
  const f = await fixture(); await f.operator.startRestoreImport(f.importInput);
  const checkpoint = NAMESPACE + '_restore_operations/', progress = checkpoint + 'progress';
  const verify = f.ports.artifacts.assertNativeExportObjects;
  f.ports.artifacts.assertNativeExportObjects = async input => {
    await verify(input);
    if (f.target.records.has(progress)) throw Object.assign(new Error('synthetic changed provenance'), { code: 'recovery_native_provenance_changed' });
  };
  await assert.rejects(f.operator.applyRestore(f.applyInput()), code('recovery_native_provenance_changed'));
  assert.equal(f.target.records.has(progress), true); assert.equal(f.target.records.has(checkpoint + 'current'), false);
  const before = structuredClone([...f.target.records]); let checks = 0;
  f.ports.artifacts.assertNativeExportObjects = async input => {
    await verify(input);
    if (++checks === 2) throw Object.assign(new Error('synthetic changed after entry'), { code: 'recovery_native_provenance_changed' });
  };
  await assert.rejects(createFirebaseRecoveryOperator(f.ports).applyRestore(f.applyInput()), code('recovery_native_provenance_changed'));
  assert.equal(checks, 2); assert.deepEqual([...f.target.records], before);
  assert.equal(f.calls.restorePhoto, 0); assert.equal(f.target.records.has(checkpoint + 'current'), false);
});


void test('avatar applyRestore recovers a partial final plan without recopying or retiring early', async () => {
  const f = await fixture(true); assert.ok(f.avatar); await f.operator.startRestoreImport(f.importInput);
  const checkpoint = NAMESPACE + '_restore_operations/', markerPath = checkpoint + 'avatar-plan-stage';
  const verify = f.ports.artifacts.assertNativeExportObjects; let interrupted = false;
  f.ports.artifacts.assertNativeExportObjects = async input => {
    await verify(input);
    const pages = [...f.target.records.keys()].filter(path => path.startsWith(checkpoint + 'page-'));
    if (!interrupted && f.target.records.has(markerPath) && pages.length === 1) {
      interrupted = true; throw new Error('synthetic partial avatar plan crash');
    }
  };
  await assert.rejects(f.operator.applyRestore(f.applyInput()), /partial avatar plan crash/);
  assert.equal(interrupted, true); assert.equal(f.avatar.bucket.writes(), 2); // One source and one exact new-epoch copy.
  const savedMarker = f.target.records.get(markerPath); assert.ok(savedMarker);
  const marker = z.object({ attempt: z.uuid(), phase: z.literal('building'), binding: z.object({ setHash: z.string(),
    recordsHash: z.string(), originalInventoryHash: z.string() }), header: z.object({ pageHashes: z.array(z.string()) }).passthrough() })
    .parse(JSON.parse(f.options.cipher.decrypt(savedMarker.ciphertext,
      canonical(['yuban-restore-apply', 1, PROJECT, TARGET, NAMESPACE, 'avatar-plan-stage']))));
  assert.equal(marker.binding.originalInventoryHash, f.manifest.inventory.sha256); assert.ok(marker.header.pageHashes.length > 1);
  const intents = [...f.target.records].filter(([path]) => path.startsWith(checkpoint + 'avatar-copy-'));
  assert.equal(intents.length, 2); assert.equal(f.target.records.has(checkpoint + 'progress'), false);
  assertFirebaseBackupInventory(f.manifest.inventory, f.target.documents().filter(row => !row.path.startsWith(checkpoint)));
  const before = structuredClone([...f.target.records]), noAvatar = { ...f.ports }; delete noAvatar.avatars;
  await assert.rejects(createFirebaseRecoveryOperator(noAvatar).applyRestore(f.applyInput()), code('recovery_avatar_port_missing'));
  assert.deepEqual([...f.target.records], before);
  f.ports.artifacts.assertNativeExportObjects = async () => { throw Object.assign(new Error('synthetic provenance changed'), { code: 'recovery_native_provenance_changed' }); };
  await assert.rejects(f.operator.applyRestore(f.applyInput()), code('recovery_native_provenance_changed'));
  assert.deepEqual([...f.target.records], before); assert.equal(f.avatar.bucket.writes(), 2);
  let sawRetainedAfterDiscard = false;
  f.ports.artifacts.assertNativeExportObjects = async input => {
    await verify(input);
    if (!f.target.records.has(markerPath) && !f.target.records.has(checkpoint + 'progress')) {
      for (const [path, row] of intents) assert.deepEqual(f.target.records.get(path), row);
      sawRetainedAfterDiscard = true;
    }
    assert.equal(f.avatar!.bucket.writes(), 2);
  };
  const result = await createFirebaseRecoveryOperator(f.ports).applyRestore(f.applyInput());
  assert.equal(result.state, 'applied-paused'); assert.equal(sawRetainedAfterDiscard, true);
  assert.equal(f.avatar.bucket.writes(), 2); assert.equal(f.avatar.bucket.removes(), 0);
  assert.deepEqual([...f.target.records.keys()].filter(path => path.startsWith(checkpoint)), [checkpoint + 'current']);
  const records = f.target.documents().filter(row => !row.path.startsWith(checkpoint)).map(row => f.codec.decode(row));
  const head = avatarHeadRecordSchema.parse(records.find(row => row.context.kind === 'avatar-head')!.value);
  const cleanups = records.filter(row => row.context.kind === 'avatar-cleanup').map(row => avatarCleanupRecordSchema.parse(row.value));
  assert.notEqual(head.binding.scope.storageEpoch, f.avatar.binding.scope.storageEpoch);
  assert.equal(head.version, 1); assert.equal(cleanups.length, 2);
  assert.ok(cleanups.some(row => row.descriptor?.generation === f.avatar!.descriptor.generation));
  assert.ok(cleanups.some(row => row.descriptor?.generation === head.descriptor!.generation && row.reason === 'staging'));
  const activation = f.target.attempts.findIndex(attempt => attempt.acknowledged && attempt.writes.some(row => row.action === 'create' && row.path === checkpoint + 'current'));
  const retirement = f.target.attempts.findIndex(attempt => attempt.writes.some(row => row.action === 'delete' && row.path.startsWith(checkpoint + 'avatar-copy-')));
  assert.ok(activation >= 0 && retirement > activation);
});
