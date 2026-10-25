import { createHash, randomUUID } from 'node:crypto';
import { Timestamp, VectorValue, FieldValue, type Firestore, type DocumentData, type Transaction } from '@google-cloud/firestore';
import { z } from 'zod';
import { canonical } from './firestore-session-codec.ts';
import { firebaseBackupDocumentDigest, type FirebaseBackupDocument } from './firestore-backup.ts';
import type { StorageCipher } from './storage-crypto.ts';

const hash = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const headerSchema = z.object({ identity: sha, nextPage: z.number().int().nonnegative(), pageHashes: z.array(sha).max(200),
  final: z.record(z.string(), z.unknown()) }).strict();
const actionSchema = z.object({ path: z.string().max(1000), before: sha.nullable(), after: z.unknown() }).strict();
type Action = z.infer<typeof actionSchema>;
const avatarPlanBindingSchema = z.object({ setHash: sha, recordsHash: sha, originalInventoryHash: sha }).strict();
const avatarStageSchema = z.object({ attempt: z.uuid(), phase: z.enum(['building', 'discarding']),
  binding: avatarPlanBindingSchema, header: headerSchema }).strict().refine(value => value.header.nextPage === 0);
type AvatarStage = z.infer<typeof avatarStageSchema>;
export type AvatarRestorePlanBinding = z.infer<typeof avatarPlanBindingSchema>;
const AVATAR_STAGE = 'avatar-plan-stage';
function reject(code: string): never { throw Object.assign(new Error('Isolated restore apply rejected'), { code }); }
// Preserve Firestore-native values inside encrypted plan pages, without ambiguous map tags.
function encode(value: unknown): unknown {
  if (value instanceof VectorValue) return ['v', value.toArray()];
  if (value instanceof Timestamp) return ['t', value.seconds, value.nanoseconds];
  if (Buffer.isBuffer(value)) return ['b', value.toString('base64')];
  if (Array.isArray(value)) return ['a', value.map(encode)];
  if (value && typeof value === 'object') return ['o', Object.entries(value).map(([key, v]) => [key, encode(v)])];
  return ['s', value];
}
function decode(value: unknown): unknown {
  if (!Array.isArray(value)) reject('recovery_plan_value');
  const [kind, body, extra] = value;
  if (kind === 'v') return FieldValue.vector(z.array(z.number()).parse(body));
  if (kind === 't') return new Timestamp(z.number().int().parse(body), z.number().int().parse(extra));
  if (kind === 'b') return Buffer.from(z.string().parse(body), 'base64');
  if (kind === 'a') return z.array(z.unknown()).parse(body).map(decode);
  if (kind === 'o') return Object.fromEntries(z.array(z.tuple([z.string(), z.unknown()])).parse(body).map(([key, v]) => [key, decode(v)]));
  if (kind === 's' && (body === null || ['string', 'boolean', 'number'].includes(typeof body))) return body;
  reject('recovery_plan_value');
}

export type FirebaseRestoreCheckpointState = { phase: 'none'; ids: ReadonlySet<string> }
  | { phase: 'avatar-staging'; identity: string; finalHash: string; binding: AvatarRestorePlanBinding; ids: ReadonlySet<string> }
  | { phase: 'progress'; identity: string; completed: boolean; finalHash: string; ids: ReadonlySet<string> }
  | { phase: 'current'; finalHash: string; ids: ReadonlySet<string> };
export interface FirebaseRestoreFinalization {
  prepare(finalHash: string, validateCompletedPlan: (tx: Transaction) => Promise<void>): Promise<void>;
  activate(tx: Transaction, finalHash: string): Promise<() => void>;
}

/** Bounded, resumable application to an isolated, paused database. Business HTTP never calls this operator. */
export function createFirebaseRestoreApply(options: { database: Firestore; cipher: StorageCipher; projectId: string; namespace: string }) {
  const { database, cipher, projectId, namespace } = options, collection = database.collection(namespace + '_restore_operations');
  const ref = collection.doc('progress'), finalRef = collection.doc('current'), avatarStageRef = collection.doc(AVATAR_STAGE);
  const aad = (id: string) => canonical(['yuban-restore-apply', 1, projectId, database.databaseId, namespace, id]);
  const seal = (id: string, value: unknown) => ({ format: 'yuban-restore-apply', version: 1, ciphertext: cipher.encrypt(canonical(value), aad(id)) });
  function open(id: string, raw: unknown): unknown {
    const env = z.object({ format: z.literal('yuban-restore-apply'), version: z.literal(1), ciphertext: z.string() }).strict().parse(raw);
    return JSON.parse(cipher.decrypt(env.ciphertext, aad(id)));
  }
  const pageId = (identity: string, index: number) => 'page-' + identity + '-' + index;
  async function read(identity: string) {
    const row = await ref.get(); if (!row.exists) return null;
    const value = headerSchema.parse(open('progress', row.data()));
    if (value.identity !== identity || value.nextPage > value.pageHashes.length) reject('recovery_plan_conflict'); return value;
  }
  async function readAvatarStage(identity: string) {
    const row = await avatarStageRef.get(); if (!row.exists) return null;
    const value = avatarStageSchema.parse(open(AVATAR_STAGE, row.data()));
    if (value.header.identity !== identity) reject('recovery_avatar_plan_conflict'); return value;
  }
  async function requireAvatarStage(tx: Transaction, expected: AvatarStage, phase = expected.phase) {
    const [saved, progress, current] = await tx.getAll(avatarStageRef, ref, finalRef);
    if (!saved.exists || progress.exists || current.exists) reject('recovery_avatar_plan_changed');
    const value = avatarStageSchema.parse(open(AVATAR_STAGE, saved.data()));
    if (value.attempt !== expected.attempt || value.phase !== phase || hash(value.binding) !== hash(expected.binding)
      || hash(value.header) !== hash(expected.header)) reject('recovery_avatar_plan_changed');
  }
  async function avatarPages(value: AvatarStage) {
    const ids = new Set([AVATAR_STAGE]); let complete = true;
    for (let i = 0; i < value.header.pageHashes.length; i++) {
      const id = pageId(value.header.identity, i), row = await collection.doc(id).get();
      if (!row.exists) { complete = false; continue; }
      if (hash(z.array(actionSchema).max(80).parse(open(id, row.data()))) !== value.header.pageHashes[i]) reject('recovery_plan_changed');
      ids.add(id);
    }
    return { ids, complete };
  }
  async function publishAvatarStage(value: AvatarStage, validate: () => Promise<void>) {
    await validate();
    if (!(await avatarPages(value)).complete || value.phase !== 'building') reject('recovery_avatar_plan_incomplete');
    await database.runTransaction(async tx => {
      await requireAvatarStage(tx, value, 'building');
      // Pages are create-only while this marker is building; discarding competes on this exact token.
      tx.create(ref, seal('progress', value.header)); tx.delete(avatarStageRef);
    }, { maxAttempts: 1 });
  }
  return {
    read,
    /** Only authenticated avatar staging may be discarded; its copies remain durable throughout. */
    async recoverAvatarStage(identity: string, validate: (value: AvatarStage) => Promise<void>) {
      let value = await readAvatarStage(identity); if (!value) return 'absent' as const;
      await validate(value);
      if (value.phase === 'building' && (await avatarPages(value)).complete) {
        await publishAvatarStage(value, () => validate(value!)); return 'promoted' as const;
      }
      if (value.phase === 'building') {
        const previous = value;
        await database.runTransaction(async tx => {
          await requireAvatarStage(tx, previous, 'building');
          tx.set(avatarStageRef, seal(AVATAR_STAGE, { ...previous, phase: 'discarding' }));
        }, { maxAttempts: 1 });
        value = { ...previous, phase: 'discarding' };
      }
      const discarding = value;
      for (let i = 0; i < discarding.header.pageHashes.length; i++) {
        await validate(discarding);
        const id = pageId(identity, i), page = collection.doc(id);
        await database.runTransaction(async tx => {
          await requireAvatarStage(tx, discarding, 'discarding'); const row = await tx.get(page);
          if (row.exists) {
            if (hash(z.array(actionSchema).max(80).parse(open(id, row.data()))) !== discarding.header.pageHashes[i]) reject('recovery_plan_changed');
            tx.delete(page);
          }
        }, { maxAttempts: 1 });
      }
      await validate(discarding);
      if ((await avatarPages(discarding)).ids.size !== 1) reject('recovery_avatar_plan_changed');
      await database.runTransaction(async tx => {
        await requireAvatarStage(tx, discarding, 'discarding'); tx.delete(avatarStageRef);
      }, { maxAttempts: 1 });
      return 'discarded' as const;
    },
    /** Only enumerates authenticated complete plan pages; unknown/partial pages are rejected by the caller's full inventory. */
    async checkpointState(identity: string): Promise<FirebaseRestoreCheckpointState> {
      const header = await read(identity), current = await finalRef.get(), avatar = await readAvatarStage(identity);
      if (avatar && (header || current.exists)) reject('recovery_checkpoint_conflict');
      if (avatar) return { phase: 'avatar-staging', identity, finalHash: hash(avatar.header.final), binding: avatar.binding, ids: (await avatarPages(avatar)).ids };
      if (header && current.exists) reject('recovery_checkpoint_conflict');
      if (current.exists) return { phase: 'current', finalHash: hash(current.data()), ids: new Set(['current']) };
      if (!header) return { phase: 'none', ids: new Set() };
      const ids = new Set(['progress']);
      for (let i = 0; i < header.pageHashes.length; i++) {
        const id = pageId(identity, i), row = await collection.doc(id).get();
        if (!row.exists || hash(z.array(actionSchema).max(80).parse(open(id, row.data()))) !== header.pageHashes[i]) reject('recovery_plan_changed');
        ids.add(id);
      }
      return { phase: 'progress', identity, completed: header.nextPage === header.pageHashes.length, finalHash: hash(header.final), ids };
    },
    async stage(identity: string, original: readonly FirebaseBackupDocument[], records: readonly FirebaseBackupDocument[], removePaths: readonly string[], final: DocumentData,
      avatar?: { binding: AvatarRestorePlanBinding; validateSource: () => Promise<void> }) {
      sha.parse(identity); const prior = await read(identity); if (prior) return prior;
      if (await readAvatarStage(identity)) reject('recovery_avatar_plan_recovery_required');
      const before = new Map(original.map(row => [row.path, firebaseBackupDocumentDigest(row).sha256]));
      const actions: Action[] = [...removePaths.map(path => ({ path, before: before.get(path) ?? null, after: null })),
        ...records.map(row => ({ path: row.path, before: before.get(row.path) ?? null, after: encode(row.data) }))];
      const pages: Action[][] = []; let page: Action[] = [], bytes = 0;
      for (const action of actions) {
        if (!action.path.startsWith(namespace) || action.path.startsWith(namespace + '_restore_operations/')) reject('recovery_plan_path');
        const length = Buffer.byteLength(canonical(action));
        if (length > 600_000) reject('recovery_plan_record_size');
        if (page.length && (page.length === 80 || bytes + length > 600_000)) { pages.push(page); page = []; bytes = 0; }
        page.push(action); bytes += length;
      }
      if (page.length) pages.push(page);
      const header = headerSchema.parse({ identity, nextPage: 0, pageHashes: pages.map(hash), final });
      if (avatar) {
        const value = avatarStageSchema.parse({ attempt: randomUUID(), phase: 'building', binding: avatar.binding, header });
        await avatar.validateSource();
        await database.runTransaction(async tx => {
          const [marker, progress, current] = await tx.getAll(avatarStageRef, ref, finalRef);
          if (marker.exists || progress.exists || current.exists) reject('recovery_avatar_plan_changed');
          tx.create(avatarStageRef, seal(AVATAR_STAGE, value));
        }, { maxAttempts: 1 });
        for (let i = 0; i < pages.length; i++) {
          await avatar.validateSource(); const id = pageId(identity, i), pageRef = collection.doc(id);
          await database.runTransaction(async tx => {
            await requireAvatarStage(tx, value, 'building'); const old = await tx.get(pageRef);
            if (old.exists) {
              if (hash(z.array(actionSchema).max(80).parse(open(id, old.data()))) !== header.pageHashes[i]) reject('recovery_plan_changed');
            } else tx.create(pageRef, seal(id, pages[i]));
          }, { maxAttempts: 1 });
        }
        await publishAvatarStage(value, avatar.validateSource); return header;
      }
      // Legacy non-avatar staging remains unchanged; an unindexed partial plan is never avatar-authorized.
      for (let i = 0; i < pages.length; i++) await collection.doc(pageId(identity, i)).set(seal(pageId(identity, i), pages[i]));
      await database.runTransaction(async tx => {
        const [old, finished] = await tx.getAll(ref, finalRef);
        if (finished.exists) reject('recovery_checkpoint_exists');
        if (old.exists) { const saved = headerSchema.parse(open('progress', old.data())); if (saved.identity !== identity) reject('recovery_plan_conflict'); return; }
        tx.create(ref, seal('progress', header));
      }, { maxAttempts: 1 }); return header;
    },
    async resume(identity: string, validateSource: () => Promise<void>, validateResult: () => Promise<void>, finalization?: FirebaseRestoreFinalization) {
      let header = await read(identity); if (!header) reject('recovery_plan_missing');
      while (header.nextPage < header.pageHashes.length) {
        await validateSource();
        const index = header.nextPage, expectedPageHash = header.pageHashes[index], id = pageId(identity, index), saved = await collection.doc(id).get();
        if (!saved.exists) reject('recovery_plan_missing');
        const page = z.array(actionSchema).max(80).parse(open(id, saved.data())); if (hash(page) !== header.pageHashes[index]) reject('recovery_plan_changed');
        try {
          await database.runTransaction(async tx => {
            const progress = await tx.get(ref), current = headerSchema.parse(open('progress', progress.data()));
            if (current.identity !== identity || current.nextPage !== index || current.pageHashes[index] !== expectedPageHash) reject('recovery_progress_changed');
            const snapshots = await tx.getAll(...page.map(action => database.doc(action.path)));
            for (let i = 0; i < page.length; i++) {
              const row = snapshots[i], action = page[i];
              if (action.before === null ? row.exists : !row.exists || firebaseBackupDocumentDigest({ path: row.ref.path, data: row.data()! }).sha256 !== action.before)
                reject('recovery_target_changed');
            }
            for (const action of page) { const target = database.doc(action.path); if (action.after === null) tx.delete(target); else tx.set(target, decode(action.after) as DocumentData); }
            tx.set(ref, seal('progress', { ...current, nextPage: index + 1 }));
          }, { maxAttempts: 1 });
        } catch (error) {
          const observed = await read(identity); if (!observed || observed.nextPage !== index + 1) throw error;
        }
        header = (await read(identity))!;
      }
      await validateSource(); await validateResult();
      const completedHeader = header;
      if (finalization) {
        await finalization.prepare(hash(completedHeader.final), async tx => {
          const [progress, current] = await tx.getAll(ref, finalRef);
          if (!progress.exists || current.exists) reject('recovery_progress_changed');
          const value = headerSchema.parse(open('progress', progress.data()));
          if (value.identity !== identity || value.nextPage !== value.pageHashes.length
            || hash(value.pageHashes) !== hash(completedHeader.pageHashes) || hash(value.final) !== hash(completedHeader.final)) reject('recovery_progress_changed');
        });
        // Paused source, full inventory/metadata/relations and latest evidence are rechecked after paginated handoff.
        await validateSource(); await validateResult();
      }
      await database.runTransaction(async tx => {
        const [progress, finished] = await tx.getAll(ref, finalRef), current = headerSchema.parse(open('progress', progress.data()));
        if (current.identity !== identity || current.nextPage !== current.pageHashes.length) reject('recovery_progress_changed');
        if (finished.exists) { if (hash(finished.data()) !== hash(current.final)) reject('recovery_checkpoint_conflict'); return; }
        if (hash(current.pageHashes) !== hash(completedHeader.pageHashes) || hash(current.final) !== hash(completedHeader.final)) reject('recovery_progress_changed');
        const activate = await finalization?.activate(tx, hash(current.final));
        tx.create(finalRef, current.final); activate?.();
        // Do not retain a hidden copy of restored private data after verification.
        // The checkpoint and plan removal commit together, before traffic may resume.
        for (let i = 0; i < current.pageHashes.length; i++) tx.delete(collection.doc(pageId(identity, i)));
        tx.delete(ref);
      }, { maxAttempts: 1 });
    },
  };
}
