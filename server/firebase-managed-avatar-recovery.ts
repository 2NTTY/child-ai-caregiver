import { z } from 'zod';
import { readAvatarRecoveryBatchConfig, avatarRecoveryBatchSchema, type AvatarRecoveryBatch } from './avatar-config.ts';
import type { Bucket } from '@google-cloud/storage';
import { avatarBindingSchema, avatarObjectDescriptorSchema, type AvatarBinding, type AvatarObjectDescriptor } from './avatar-data.ts';
import { erasureCoversAvatar, firebaseErasureIntentSchema, type FirebaseErasureJournal } from './firebase-erasure-journal.ts';
import type { AvatarObjects } from './firebase-avatar-objects.ts';
import type { createFirestoreAuthority } from './firestore-authority.ts';

const pageSchema = z.object({ items: z.array(z.object({ name: z.string().regex(/^erasures\/v1\/[a-f0-9]{64}$/u),
  generation: z.string().regex(/^[1-9][0-9]*$/u) })).optional(), nextPageToken: z.string().optional() });
export type ManagedAvatarRead = (binding: AvatarBinding, descriptor: AvatarObjectDescriptor, version: number) => Promise<Buffer>;
function reject(code = 'recovery_retained_avatar_unconfirmed'): never { throw Object.assign(new Error('Avatar recovery rejected'), { code }); }
/** Operator-only retained-generation reader. Every return is fenced by the independent journal and paused generation. */
export function createFirebaseManagedAvatarReader(options: { bucket: Bucket; journalBucket: Bucket;
  journal: Pick<FirebaseErasureJournal, 'readObject'>; objects: Pick<AvatarObjects, 'read'>;
  authority: Pick<ReturnType<typeof createFirestoreAuthority>, 'readControl'>; sourceGeneration: string; batches?: AvatarRecoveryBatch }): ManagedAvatarRead {
  const { bucket, journalBucket, journal, objects, authority, sourceGeneration } = options;
  const batches = avatarRecoveryBatchSchema.parse(options.batches ?? readAvatarRecoveryBatchConfig({}));
  z.uuid().parse(sourceGeneration); if (bucket.name === journalBucket.name) reject('recovery_journal_not_independent');
  async function permitted(binding: AvatarBinding, version: number) {
    const control = await authority.readControl(); if (control.enabled || control.generation !== sourceGeneration) reject('recovery_source_not_paused');
    const names = new Set<string>(), tokens = new Set<string>(); let cursor: string | undefined;
    while (true) {
      const [raw, response] = await journalBucket.request({ method: 'GET', uri: '/o', timeout: 20_000,
        qs: { prefix: 'erasures/v1/', maxResults: batches.scanPageSize, fields: 'items(name,generation),nextPageToken', ...(cursor ? { pageToken: cursor } : {}) }, headers: { 'Cache-Control': 'no-store' } });
      if (response?.statusCode !== 200) reject('recovery_journal_unavailable'); const value = pageSchema.parse(raw);
      for (const row of value.items ?? []) {
        if (names.has(row.name)) reject('recovery_journal_incomplete'); names.add(row.name);
        const intent = firebaseErasureIntentSchema.parse((await journal.readObject(row.name, row.generation)).intent);
        if (erasureCoversAvatar(intent, { scope: binding.scope, targetKind: binding.target.kind, targetId: binding.targetId, committedVersion: version }))
          reject('recovery_avatar_permanently_erased');
      }
      if (!value.nextPageToken) return;
      if (tokens.has(value.nextPageToken)) reject('recovery_journal_incomplete'); tokens.add(value.nextPageToken); cursor = value.nextPageToken;
    }
  }
  return async (rawBinding, rawDescriptor, version) => {
    const binding = avatarBindingSchema.parse(rawBinding), descriptor = avatarObjectDescriptorSchema.parse(rawDescriptor);
    z.number().int().min(1).max(2147483647).parse(version); await permitted(binding, version);
    // Avatar recovery is read-only on the source bucket. In particular, no soft-delete restore POST or
    // same-address new-generation fallback is authorized: those would create a new cleanup responsibility.
    let bytes: Buffer;
    try { bytes = await objects.read(binding, descriptor); } catch { reject('recovery_retained_avatar_unconfirmed'); }
    try { await permitted(binding, version); return bytes; } catch (error) { bytes.fill(0); throw error; }
  };
}
