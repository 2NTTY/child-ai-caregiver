import { z } from 'zod';
import type { FirebaseErasureIntent } from './firebase-erasure-journal.ts';
import { firebaseErasureIntentHash } from './firebase-erasure-journal.ts';
import { FirestoreDomainData, domainReject } from './firestore-domain-data.ts';
import { contentErasureSchema, contentHistory } from './firestore-content-erasure.ts';
import { contentPointerSchema, contentResult } from './firestore-disclosure.ts';
import { firestoreCareRecoverySchemas, firestoreProfileStorageSchema as firestoreProfileSchema } from './firestore-care.ts';
import { firestoreOnlineRecordSchema, isFirestoreOnlinePending } from './firestore-online-receipts.ts';
import type { createFirestoreRestoreCodec, FirestoreRestoreDecoded } from './firestore-restore-codec.ts';

/** Reapply independent content barriers before rebuilding any readable data graph. */
export function replayContentErasures(data: FirestoreDomainData, codec: ReturnType<typeof createFirestoreRestoreCodec>,
  records: FirestoreRestoreDecoded[], live: readonly FirestoreRestoreDecoded[], journal: readonly FirebaseErasureIntent[], liveMetadata: ReadonlyMap<string, Record<string, unknown>>): Set<string> {
  const intents = journal.filter(v => v.type === 'content-delete').sort((a, b) => a.content!.throughVersion - b.content!.throughVersion), removed = new Set<string>();
  for (const row of live.filter(v => v.context.kind === 'content-erasure')) {
    const value = contentErasureSchema.parse(row.value);
    if (!intents.some(v => firebaseErasureIntentHash(v) === firebaseErasureIntentHash(value.intent))) domainReject('restore_content_journal_pending');
  }
  // Pre-upgrade tombstones must be journaled too; absence of a new job is not permission to resurrect them.
  for (const row of live) {
    const ctx = row.context; if (ctx.family !== 'domain') continue;
    const value = row.value as { version?: number };
    const kind = ctx.kind === 'care-tombstone' ? 'care' : ctx.kind === 'memory-tombstone'
      ? row.path.startsWith(data.options.namespace + '_memory_facts/') ? 'fact' : 'topic'
      : ctx.kind === 'child-profile' && Number(liveMetadata.get(row.path)?.historyFloor) > 1 ? 'profile' : null;
    const through = kind === 'profile' ? Number(liveMetadata.get(row.path)?.historyFloor) - 1 : value.version! - 1;
    if (kind && !intents.some(v => v.content!.kind === kind && v.assetId === ctx.id && v.scope.ownerUserId === ctx.scope.ownerUserId
      && v.scope.childId === ctx.scope.childId && v.content!.throughVersion >= through)) domainReject('restore_content_journal_pending');
  }
  for (const intent of intents) {
    const content = intent.content!, parentKind = { care: 'care-record', profile: 'child-profile', fact: 'memory-fact', topic: 'memory-topic' }[content.kind];
    const suffix = { care: 'care_records', profile: 'child_profiles', fact: 'memory_facts', topic: 'memory_topics' }[content.kind];
    for (let i = 0; i < records.length; i++) {
      const row = records[i], ctx = row.context; if (ctx.family === 'knowledge') continue;
      if (ctx.scope.ownerUserId !== intent.scope.ownerUserId || ctx.scope.workspaceId !== intent.scope.workspaceId) continue;
      if (ctx.kind === 'online-receipt') {
        const receipt = firestoreOnlineRecordSchema.safeParse(row.value);
        if (!receipt.success || isFirestoreOnlinePending(receipt.data) || receipt.data.childId !== intent.scope.childId) continue;
        const pointer = contentPointerSchema.safeParse(receipt.data.result), target = pointer.success ? pointer.data : contentResult(receipt.data.path, receipt.data.result);
        if (target?.kind === content.kind && target.id === intent.assetId && target.version <= content.throughVersion) row.value = { ...receipt.data, result: null };
        continue;
      }
      if (ctx.scope.childId !== intent.scope.childId) continue;
      if (ctx.kind === contentHistory[content.kind][1]) {
        const revision = z.object({ id: z.uuid().optional(), childId: z.uuid(), version: z.number().int().positive() }).passthrough().parse(row.value);
        if ((content.kind === 'profile' ? revision.childId : revision.id) === intent.assetId && revision.version <= content.throughVersion) removed.add(row.path);
      }
      if (ctx.kind !== parentKind || ctx.id !== intent.assetId) continue;
      const old = z.object({ version: z.number().int().positive(), createdAt: z.string().optional() }).passthrough().parse(row.value);
      if (content.kind === 'profile') {
        const original = firestoreProfileSchema.parse(row.value), floor = content.throughVersion + 1;
        const value = original.version <= content.throughVersion ? { childId: original.childId, version: floor, data: null, confirmedBy: null, confirmedAt: null, reason: null } : original;
        records[i] = codec.decode({ path: row.path, data: { ...data.tags(ctx.scope), historyFloor: floor,
          ...data.seal('child-profile', ctx.id, ctx.scope, firestoreProfileSchema, value, value.version) } });
      } else if (old.version <= content.throughVersion) {
        const value = { id: ctx.id, childId: ctx.scope.childId, version: content.throughVersion + 1, operationId: intent.operationId, deletedAt: intent.at };
        records[i] = codec.decode({ path: data.ref(suffix, parentKind, ctx.id).path, data: { ...data.tags(ctx.scope), live: false,
          entityId: ctx.id, entityVersion: value.version, ...(content.kind === 'care' ? { createdAt: old.createdAt } : {}),
          ...data.seal(content.kind === 'care' ? 'care-tombstone' : 'memory-tombstone', ctx.id, ctx.scope, firestoreCareRecoverySchemas.tombstone, value, value.version) } });
      }
    }
  }
  return removed;
}
