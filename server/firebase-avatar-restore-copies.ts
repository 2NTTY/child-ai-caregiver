import { randomUUID } from 'node:crypto';
import { FieldPath, type Transaction } from '@google-cloud/firestore';
import { z } from 'zod';
import { avatarBindingSchema, avatarCleanupRecordSchema, avatarCleanupId, avatarHeadId, avatarObjectDescriptorSchema,
  sameAvatarBinding, type AvatarCleanupRecord, type AvatarObjectDescriptor } from './avatar-data.ts';
import { avatarRecoveryBatchSchema, readAvatarRecoveryBatchConfig, type AvatarRecoveryBatch } from './avatar-config.ts';
import { avatarBackupDescriptorSchema } from './firebase-avatar-recovery.ts';
import { avatarObjectAddress, type AvatarObjects } from './firebase-avatar-objects.ts';
import { firebaseRestoreEpoch } from './firestore-restore.ts';
import { FirestoreDomainData, firestoreDomainHash, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { firebaseBackupDocumentDigest } from './firestore-backup.ts';
import type { FirebaseRestoreCheckpointState } from './firebase-restore-apply.ts';
import { canonical } from './firestore-session-codec.ts';

const FORMAT = 'yuyoufang-avatar-restore-copy/v1', INDEX = 'avatar-copy-index';
const hash = z.string().regex(/^[a-f0-9]{64}$/u), uuid = z.uuid(), count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const intentId = z.string().regex(/^avatar-copy-[a-f0-9]{64}$/u);
export const avatarCopyEvidenceSchema = z.object({ journalHash: hash, authHash: hash, authorityHash: hash }).strict();
export const avatarCopyPayloadSchema = z.object({ format: z.literal(FORMAT), identity: hash, restoreId: uuid, sourceGeneration: uuid,
  provenanceHash: hash, originalInventoryHash: hash, targetDatabaseId: z.string().min(1).max(64), targetBucket: z.string().min(3).max(222),
  evidence: avatarCopyEvidenceSchema,
  source: z.object({ path: z.string().min(1).max(6144), binding: avatarBindingSchema, version: z.number().int().min(1).max(2147483647),
    descriptor: avatarObjectDescriptorSchema, backup: avatarBackupDescriptorSchema.optional() }).strict(),
  cleanup: avatarCleanupRecordSchema,
}).strict();
export type AvatarCopyPayload = z.infer<typeof avatarCopyPayloadSchema>;
const recordSchema = z.object({ setHash: hash, payload: avatarCopyPayloadSchema, state: z.enum(['prepared', 'writing', 'unknown', 'known']),
  token: uuid.nullable(), descriptor: avatarObjectDescriptorSchema.nullable() }).strict()
  .refine(value => (value.state === 'prepared') === (value.token === null) && (value.state === 'known') === (value.descriptor !== null));
const setSchema = z.object({ identity: hash, contextHash: hash, count: count.positive(), entriesHash: hash }).strict();
const handoffSchema = z.object({ recordsHash: hash, finalHash: hash, count, cursor: intentId.nullable(), digest: hash }).strict();
const indexSchema = z.object({ set: setSchema, phase: z.enum(['preparing', 'copying', 'handoff', 'activated']),
  handoff: handoffSchema.nullable(), retired: z.object({ count, cursor: intentId.nullable() }).strict().nullable() }).strict()
  .refine(v => (v.phase === 'preparing' || v.phase === 'copying') === (v.handoff === null)
    && (v.phase === 'activated') === (v.retired !== null)
    && (!v.handoff || v.handoff.count <= v.set.count) && (!v.retired || v.retired.count <= v.set.count));
export interface AvatarCopyFrozen { identity: string; setHash: string; recordsHash: string;
  rows: { id: string; recordHash: string; responsibility: AvatarCleanupRecord }[] }
function reject(code: string): never { throw Object.assign(new Error('Avatar restore copy is unconfirmed'), { code }); }
function check(value: unknown, code = 'recovery_avatar_copy_binding'): asserts value { if (!value) reject(code); }
const digest = (value: unknown) => firestoreDomainHash(value);
const same = (left: unknown, right: unknown) => canonical(left) === canonical(right);
const common = ({ source: _source, cleanup: _cleanup, ...context }: AvatarCopyPayload) => context;
const idFor = (value: AvatarCopyPayload) => 'avatar-copy-' + digest([value.identity, value.cleanup.binding, value.cleanup.assetId, value.targetBucket]);
const EMPTY_DIGEST = digest([]);

/** Avatar-only checkpoint metadata. Batches bound requests, never total copy population. No product activation gate is implied. */
export function createFirebaseAvatarRestoreCopies(options: FirestoreDomainOptions & {
  targetBucket: string; objects: Pick<AvatarObjects, 'inspect'>; batches?: AvatarRecoveryBatch;
}) {
  const { database, cipher, projectId, namespace } = options, data = new FirestoreDomainData(options);
  const batches = avatarRecoveryBatchSchema.parse(options.batches ?? readAvatarRecoveryBatchConfig({}));
  const collection = database.collection(namespace + '_restore_operations'), indexRef = collection.doc(INDEX);
  const aad = (id: string) => canonical([FORMAT, projectId, database.databaseId, namespace, id]);
  const seal = (id: string, value: unknown) => ({ format: FORMAT, ciphertext: cipher.encrypt(canonical(value), aad(id)) });
  function open(id: string, raw: unknown) {
    const envelope = z.object({ format: z.literal(FORMAT), ciphertext: z.string().min(1).max(600000) }).strict().parse(raw);
    return JSON.parse(cipher.decrypt(envelope.ciphertext, aad(id)));
  }
  function payload(raw: unknown): AvatarCopyPayload {
    const value = avatarCopyPayloadSchema.parse(raw), { source, cleanup } = value;
    check(value.targetDatabaseId === database.databaseId && value.targetBucket === options.targetBucket
      && source.path === data.ref('avatar_heads', 'avatar-head', avatarHeadId(source.binding)).path
      && cleanup.assetId === source.descriptor.asset.id && cleanup.expectedVersion + 1 === source.version
      && cleanup.committedVersion === source.version && cleanup.reason === 'staging' && cleanup.state === 'writing'
      && cleanup.writeLease === null && cleanup.descriptor === null && same(cleanup.preparedAsset, source.descriptor.asset)
      && cleanup.binding.scope.storageEpoch === firebaseRestoreEpoch(projectId, database.databaseId, value.restoreId, source.binding.scope.workspaceId)
      && cleanup.binding.scope.storageEpoch !== source.binding.scope.storageEpoch
      && sameAvatarBinding({ ...source.binding, scope: { ...source.binding.scope, storageEpoch: cleanup.binding.scope.storageEpoch } }, cleanup.binding));
    return value;
  }
  function checkedDescriptor(value: AvatarCopyPayload, raw: unknown) {
    const descriptor = avatarObjectDescriptorSchema.parse(raw);
    check(same(descriptor.asset, value.source.descriptor.asset) && descriptor.objectName === avatarObjectAddress({ projectId, namespace,
      bucketName: value.targetBucket }, value.cleanup.binding, value.cleanup.assetId).objectName); return descriptor;
  }
  function record(id: string, raw: unknown) {
    const value = recordSchema.parse(open(id, raw)); payload(value.payload); check(id === idFor(value.payload));
    if (value.descriptor) checkedDescriptor(value.payload, value.descriptor); return value;
  }
  function expectedSet(values: readonly AvatarCopyPayload[]) {
    check(values.length > 0); const checked = values.map(payload), first = checked[0]!;
    check(checked.every(value => same(common(value), common(first))));
    const entries = checked.map(value => ({ id: idFor(value), payloadHash: digest(value) })).sort((a, b) => a.id.localeCompare(b.id));
    check(new Set(entries.map(value => value.id)).size === entries.length);
    return setSchema.parse({ identity: first.identity, contextHash: digest(common(first)), count: entries.length, entriesHash: digest(entries) });
  }
  async function scan() {
    const rows = []; let cursor: string | undefined;
    while (true) {
      let query = collection.orderBy(FieldPath.documentId()).limit(batches.scanPageSize); if (cursor) query = query.startAfter(cursor);
      const page = await query.get(); rows.push(...page.docs);
      if (page.size < batches.scanPageSize) return rows; cursor = page.docs.at(-1)!.id;
    }
  }
  async function requireIndex(identity: string, tx?: Transaction) {
    const snapshot = tx ? await tx.get(indexRef) : await indexRef.get(); check(snapshot.exists, 'recovery_avatar_copy_header_missing');
    const index = indexSchema.parse(open(INDEX, snapshot.data())); check(index.set.identity === identity); return index;
  }
  function member(index: z.infer<typeof indexSchema>, value: z.infer<typeof recordSchema>) {
    check(value.setHash === digest(index.set) && value.payload.identity === index.set.identity
      && digest(common(value.payload)) === index.set.contextHash, 'recovery_avatar_copy_inventory_changed');
  }
  async function allRecords(index: z.infer<typeof indexSchema>) {
    const rows = (await scan()).filter(row => row.id !== INDEX && row.id.startsWith('avatar-copy-'));
    const records = rows.map(row => { const value = record(row.id, row.data()); member(index, value); return { id: row.id, value }; });
    if (index.phase !== 'activated') {
      const entries = records.map(({ id, value }) => ({ id, payloadHash: digest(value.payload) }));
      check(records.length === index.set.count && digest(entries) === index.set.entriesHash, 'recovery_avatar_copy_inventory_changed');
    } else {
      check(records.length + index.retired!.count === index.set.count
        && records.every(row => index.retired!.cursor === null || row.id > index.retired!.cursor), 'recovery_avatar_copy_inventory_changed');
    }
    return records;
  }
  async function markKnown(value: AvatarCopyPayload, descriptor: AvatarObjectDescriptor) {
    const id = idFor(value), checked = checkedDescriptor(value, descriptor);
    await database.runTransaction(async tx => {
      const index = await requireIndex(value.identity, tx), ref = collection.doc(id), snapshot = await tx.get(ref); check(snapshot.exists);
      const prior = record(id, snapshot.data()); member(index, prior); check(same(prior.payload, value) && prior.state !== 'prepared');
      if (prior.state === 'known') { check(same(prior.descriptor, checked)); return; }
      check(index.phase === 'copying', 'recovery_avatar_copy_stage_closed');
      tx.set(ref, seal(id, { ...prior, state: 'known', descriptor: checked }));
    }, { maxAttempts: 1 }); return checked;
  }
  function chunk(rows: AvatarCopyFrozen['rows'], offset: number) {
    let bytes = 0; const result: AvatarCopyFrozen['rows'] = [];
    for (const row of rows.slice(offset, offset + batches.handoffBatchSize)) {
      const size = Buffer.byteLength(canonical(row));
      check(size <= batches.handoffBatchBytes, 'recovery_avatar_batch_record_size');
      if (result.length && bytes + size > batches.handoffBatchBytes) break;
      result.push(row); bytes += size;
    }
    return result;
  }
  const api = {
    /** Must run before either final/progress fast path. Unsupported unindexed page-* remains fail-closed. */
    async inventory(identity: string, plan: FirebaseRestoreCheckpointState, validateContext: (value: AvatarCopyPayload) => void) {
      const found = await scan(), indexSnapshot = found.find(row => row.id === INDEX);
      const index = indexSnapshot ? indexSchema.parse(open(INDEX, indexSnapshot.data())) : null;
      if (index) check(index.set.identity === identity);
      const records = [];
      for (const row of found) {
        if (row.id === INDEX) continue;
        if (!row.id.startsWith('avatar-copy-')) { check(plan.ids.has(row.id), 'recovery_checkpoint_inventory_unconfirmed'); continue; }
        check(index, 'recovery_avatar_copy_header_missing');
        const value = record(row.id, row.data()); member(index, value); validateContext(value.payload); records.push({ id: row.id, value });
        if (index.phase === 'preparing') check(value.state === 'prepared', 'recovery_avatar_copy_header_unfinished');
      }
      if (plan.phase === 'avatar-staging') {
        check(index && index.phase === 'copying' && plan.identity === identity
          && records.every(row => row.value.state === 'known' && row.value.payload.originalInventoryHash === plan.binding.originalInventoryHash)
          && digest(index.set) === plan.binding.setHash
          && digest(records.map(({ id, value }) => ({ id, recordHash: digest(value) }))) === plan.binding.recordsHash,
          'recovery_avatar_copy_phase');
      }
      if (index) {
        if (index.phase === 'preparing') check(plan.phase === 'none', 'recovery_avatar_copy_phase');
        if (index.phase === 'copying') check(plan.phase !== 'current' && (plan.phase !== 'progress'
          || plan.identity === identity && records.every(row => row.value.state === 'known')), 'recovery_avatar_copy_phase');
        if (index.phase === 'handoff') check(plan.phase === 'progress' && plan.identity === identity && plan.completed
          && plan.finalHash === index.handoff!.finalHash, 'recovery_avatar_copy_phase');
        if (index.phase === 'activated') check(plan.phase === 'current' && plan.finalHash === index.handoff!.finalHash, 'recovery_avatar_copy_phase');
      }
      if (index?.phase === 'preparing') check(records.length <= index.set.count);
      else if (index) {
        if (index.phase === 'activated') {
          const current = await collection.doc('current').get();
          check(current.exists && digest(current.data()) === index.handoff!.finalHash, 'recovery_avatar_copy_handoff_missing');
          check(records.length + index.retired!.count === index.set.count && records.every(row => index.retired!.cursor === null || row.id > index.retired!.cursor));
        } else check(records.length === index.set.count
          && digest(records.map(({ id, value }) => ({ id, payloadHash: digest(value.payload) }))) === index.set.entriesHash, 'recovery_avatar_copy_inventory_changed');
      }
      return { present: index !== null, phase: index?.phase ?? null, payloads: records.map(row => row.value.payload) };
    },
    async stage(raw: readonly AvatarCopyPayload[]) {
      const values = raw.map(payload), set = expectedSet(values), setHash = digest(set);
      // The immutable complete-set digest is durable first; preparing never authorizes Storage I/O.
      await database.runTransaction(async tx => {
        const [prior, progress, current] = await tx.getAll(indexRef, collection.doc('progress'), collection.doc('current'));
        check(!progress.exists && !current.exists, 'recovery_avatar_copy_stage_closed');
        if (prior.exists) { check(same(indexSchema.parse(open(INDEX, prior.data())).set, set)); return; }
        tx.create(indexRef, seal(INDEX, { set, phase: 'preparing', handoff: null, retired: null }));
      }, { maxAttempts: 1 });
      for (const value of values) await database.runTransaction(async tx => {
        const index = await requireIndex(value.identity, tx), id = idFor(value), ref = collection.doc(id), prior = await tx.get(ref);
        check(same(index.set, set));
        if (prior.exists) { const saved = record(id, prior.data()); member(index, saved); check(same(saved.payload, value)); return; }
        check(index.phase === 'preparing', 'recovery_avatar_copy_stage_closed');
        tx.create(ref, seal(id, { setHash, payload: value, state: 'prepared', token: null, descriptor: null }));
      }, { maxAttempts: 1 });
      const before = await requireIndex(set.identity); await allRecords(before);
      await database.runTransaction(async tx => {
        const index = await requireIndex(set.identity, tx); check(same(index.set, set));
        if (index.phase === 'preparing') tx.set(indexRef, seal(INDEX, { ...index, phase: 'copying' }));
      }, { maxAttempts: 1 });
    },
    async execute(raw: AvatarCopyPayload, writeOriginal: () => Promise<AvatarObjectDescriptor>) {
      const value = payload(raw), id = idFor(value), token = randomUUID();
      // Confirm the claim before any Storage I/O. A lost acknowledgement can be read back only by this invocation's fresh token.
      const claim = await database.runTransaction(async tx => {
        const index = await requireIndex(value.identity, tx), ref = collection.doc(id), row = await tx.get(ref);
        check(index.phase === 'copying' && row.exists, 'recovery_avatar_copy_stage_closed');
        const prior = record(id, row.data()); member(index, prior); check(same(prior.payload, value));
        if (prior.state !== 'prepared') return { won: false, prior };
        tx.set(ref, seal(id, { ...prior, state: 'writing', token })); return { won: true, prior };
      }, { maxAttempts: 1 }).catch(async error => {
        const recovered = await database.runTransaction(async tx => {
          const index = await requireIndex(value.identity, tx), row = await tx.get(collection.doc(id));
          check(index.phase === 'copying' && row.exists, 'recovery_avatar_copy_stage_closed');
          const prior = record(id, row.data()); member(index, prior); check(same(prior.payload, value));
          return prior.state === 'writing' && prior.token === token ? { won: true, prior } : null;
        }, { maxAttempts: 1 }).catch(() => null);
        if (!recovered) throw error;
        return recovered;
      });
      if (claim.won) {
        try { return await markKnown(value, await writeOriginal()); }
        catch {
          try { await database.runTransaction(async tx => { const ref = collection.doc(id), row = await tx.get(ref); check(row.exists);
            const prior = record(id, row.data()); if (prior.state === 'writing' && prior.token === token) tx.set(ref, seal(id, { ...prior, state: 'unknown' })); }, { maxAttempts: 1 }); }
          catch { /* Durable writing/unknown evidence remains. Never retry the external write. */ }
        }
      }
      const descriptor = await options.objects.inspect(value.cleanup.objectBinding, value.cleanup.assetId, value.cleanup.preparedAsset!);
      if (!descriptor) reject('recovery_avatar_copy_unknown');
      if (claim.prior.descriptor) check(same(claim.prior.descriptor, descriptor));
      return markKnown(value, descriptor);
    },
    async freeze(identity: string): Promise<AvatarCopyFrozen> {
      const index = await requireIndex(identity); check(index.phase === 'copying' || index.phase === 'handoff');
      const found = await allRecords(index), rows: AvatarCopyFrozen['rows'] = [];
      for (const { id, value } of found) {
        check(value.state === 'known' && value.descriptor, 'recovery_avatar_copy_unknown');
        rows.push({ id, recordHash: digest(value), responsibility: avatarCleanupRecordSchema.parse({ ...value.payload.cleanup,
          state: 'known', descriptor: value.descriptor, preparedAsset: value.descriptor.asset }) });
      }
      return { identity, setHash: digest(index.set), recordsHash: digest(rows.map(({ id, recordHash }) => ({ id, recordHash }))), rows };
    },
    /** Caller validates completed same-identity plan progress in EACH transaction; no intent is removed here. */
    async handoff(frozen: AvatarCopyFrozen, finalHash: string, finalInventory: ReadonlyMap<string, string>, validateCompletedPlan: (tx: Transaction) => Promise<void>) {
      hash.parse(finalHash);
      while (true) {
        const before = await requireIndex(frozen.identity); check(digest(before.set) === frozen.setHash);
        const offset = before.handoff?.count ?? 0, batch = chunk(frozen.rows, offset);
        if (before.handoff) check(before.handoff.recordsHash === frozen.recordsHash && before.handoff.finalHash === finalHash);
        if (offset === frozen.rows.length && before.phase === 'handoff') return;
        await database.runTransaction(async tx => {
          await validateCompletedPlan(tx); const index = await requireIndex(frozen.identity, tx);
          check(digest(index.set) === frozen.setHash && (index.phase === 'copying' || index.phase === 'handoff')
            && (index.handoff?.count ?? 0) === offset && index.set.count === frozen.rows.length, 'recovery_avatar_copy_handoff_changed');
          if (index.handoff) check(index.handoff.recordsHash === frozen.recordsHash && index.handoff.finalHash === finalHash);
          const refs = batch.map(row => collection.doc(row.id));
          const cleanups = batch.map(row => data.ref('avatar_cleanup', 'avatar-cleanup', avatarCleanupId(row.responsibility.binding, row.responsibility.assetId)));
          const snapshots = await tx.getAll(...refs, ...cleanups);
          for (let i = 0; i < batch.length; i++) {
            const expected = batch[i]!, copy = snapshots[i]!, cleanup = snapshots[i + batch.length]!;
            check(copy.exists && digest(record(expected.id, copy.data())) === expected.recordHash && cleanup.exists, 'recovery_avatar_copy_handoff_missing');
            check(finalInventory.get(cleanup.ref.path) === firebaseBackupDocumentDigest({ path: cleanup.ref.path, data: cleanup.data()! }).sha256,
              'recovery_avatar_copy_handoff_missing');
            const responsibility = data.open('avatar-cleanup', avatarCleanupId(expected.responsibility.binding, expected.responsibility.assetId),
              expected.responsibility.binding.scope, avatarCleanupRecordSchema, cleanup);
            check(sameAvatarBinding(responsibility.binding, expected.responsibility.binding)
              && sameAvatarBinding(responsibility.objectBinding, expected.responsibility.objectBinding)
              && responsibility.assetId === expected.responsibility.assetId && responsibility.uploadId === expected.responsibility.uploadId
              && responsibility.expectedVersion === expected.responsibility.expectedVersion && responsibility.committedVersion === expected.responsibility.committedVersion
              && same(responsibility.descriptor, expected.responsibility.descriptor) && responsibility.state === 'known', 'recovery_avatar_copy_handoff_missing');
          }
          let running = index.handoff?.digest ?? EMPTY_DIGEST;
          for (const row of batch) running = digest([running, row.id, row.recordHash]);
          tx.set(indexRef, seal(INDEX, { ...index, phase: 'handoff', handoff: { recordsHash: frozen.recordsHash, finalHash,
            count: offset + batch.length, cursor: batch.at(-1)?.id ?? null, digest: running } }));
        }, { maxAttempts: 1 });
      }
    },
    /** Read before any final transaction writes; returned write joins current creation atomically. */
    async prepareActivation(tx: Transaction, frozen: AvatarCopyFrozen, finalHash: string): Promise<() => void> {
      const index = await requireIndex(frozen.identity, tx);
      let running = EMPTY_DIGEST; for (const row of frozen.rows) running = digest([running, row.id, row.recordHash]);
      check(digest(index.set) === frozen.setHash && index.phase === 'handoff' && index.handoff!.recordsHash === frozen.recordsHash
        && index.handoff!.count === index.set.count && index.handoff!.finalHash === finalHash && index.handoff!.digest === running,
      'recovery_avatar_copy_handoff_missing');
      return () => tx.set(indexRef, seal(INDEX, { ...index, phase: 'activated', retired: { count: 0, cursor: null } }));
    },
    /** Activated marker and exact current transfer responsibility; retirement is bounded and restartable. */
    async retire(identity: string) {
      while (true) {
        const snapshot = await indexRef.get(); if (!snapshot.exists) return;
        const before = indexSchema.parse(open(INDEX, snapshot.data())); check(before.set.identity === identity && before.phase === 'activated');
        const remaining = await allRecords(before), batch = remaining.slice(0, batches.handoffBatchSize);
        await database.runTransaction(async tx => {
          const index = await requireIndex(identity, tx), current = await tx.get(collection.doc('current'));
          check(index.phase === 'activated' && same(index, before) && current.exists && digest(current.data()) === index.handoff!.finalHash,
            'recovery_avatar_copy_handoff_missing');
          const refs = batch.map(row => collection.doc(row.id)), rows = refs.length ? await tx.getAll(...refs) : [];
          for (let i = 0; i < rows.length; i++) check(rows[i]!.exists && same(record(batch[i]!.id, rows[i]!.data()), batch[i]!.value));
          if (!batch.length) { check(index.retired!.count === index.set.count); tx.delete(indexRef); return; }
          for (const ref of refs) tx.delete(ref);
          tx.set(indexRef, seal(INDEX, { ...index, retired: { count: index.retired!.count + batch.length, cursor: batch.at(-1)!.id } }));
        }, { maxAttempts: 1 });
      }
    },
  };
  return api;
}
