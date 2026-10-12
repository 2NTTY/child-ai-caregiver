import { createHash } from 'node:crypto';
import { Timestamp, VectorValue, FieldValue, type Firestore, type DocumentData } from '@google-cloud/firestore';
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

/** Bounded, resumable application to an isolated, paused database. Business HTTP never calls this operator. */
export function createFirebaseRestoreApply(options: { database: Firestore; cipher: StorageCipher; projectId: string; namespace: string }) {
  const { database, cipher, projectId, namespace } = options, collection = database.collection(namespace + '_restore_operations');
  const ref = collection.doc('progress'), finalRef = collection.doc('current');
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
  return {
    read,
    async stage(identity: string, original: readonly FirebaseBackupDocument[], records: readonly FirebaseBackupDocument[], removePaths: readonly string[], final: DocumentData) {
      sha.parse(identity); const prior = await read(identity); if (prior) return prior;
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
      // Interrupted staging is safe: deterministic page ids and authenticated hashes are reread before use.
      for (let i = 0; i < pages.length; i++) await collection.doc(pageId(identity, i)).set(seal(pageId(identity, i), pages[i]));
      await database.runTransaction(async tx => {
        const [old, finished] = await tx.getAll(ref, finalRef);
        if (finished.exists) reject('recovery_checkpoint_exists');
        if (old.exists) { const saved = headerSchema.parse(open('progress', old.data())); if (saved.identity !== identity) reject('recovery_plan_conflict'); return; }
        tx.create(ref, seal('progress', header));
      }, { maxAttempts: 1 }); return header;
    },
    async resume(identity: string, validateSource: () => Promise<void>, validateResult: () => Promise<void>) {
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
      await database.runTransaction(async tx => {
        const [progress, finished] = await tx.getAll(ref, finalRef), current = headerSchema.parse(open('progress', progress.data()));
        if (current.identity !== identity || current.nextPage !== current.pageHashes.length) reject('recovery_progress_changed');
        if (finished.exists) { if (hash(finished.data()) !== hash(current.final)) reject('recovery_checkpoint_conflict'); return; }
        tx.create(finalRef, current.final);
        // Do not retain a hidden copy of restored private data after verification.
        // The checkpoint and plan removal commit together, before traffic may resume.
        for (let i = 0; i < current.pageHashes.length; i++) tx.delete(collection.doc(pageId(identity, i)));
        tx.delete(ref);
      }, { maxAttempts: 1 });
    },
  };
}
