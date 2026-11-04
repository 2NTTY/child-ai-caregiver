import { z } from 'zod';
import type { FirebaseErasureDescriptor, FirebaseErasureIntent } from './firebase-erasure-journal.ts';
import { firebaseErasureDescriptorSchema, firebaseErasureIntentHash } from './firebase-erasure-journal.ts';
import { FirestoreDomainData, domainReject, firestoreDomainHash } from './firestore-domain-data.ts';
import { contentErasureSchema, contentHistory } from './firestore-content-erasure.ts';
import { contentPointerSchema, contentResult } from './firestore-disclosure.ts';
import { firestoreCareRecoverySchemas, firestoreProfileStorageSchema as firestoreProfileSchema } from './firestore-care.ts';
import { firestoreOnlineRecordSchema, isFirestoreOnlinePending, privateInputReceiptTarget } from './firestore-online-receipts.ts';
import { firestoreSharedInputPartSchema, firestoreSharedInputTombstoneSchema, firestoreSourceManagementRevisionSchema } from './firestore-shared-inputs.ts';
import { sourceHistoryRecordSchema, historyResourceForContent } from './handover-history-records.ts';
import type { createFirestoreRestoreCodec, FirestoreRestoreDecoded } from './firestore-restore-codec.ts';
import { firestoreAgentManualSchema } from './firestore-agent-actions.ts';
import { firestoreAgentActionSavedSchema, redactErasedNoteEvidence } from './firestore-private-note-receipt.ts';

// Legacy successful deletions recorded a request hash but no target ID. A stale backup cannot supply that identity by name.
function checkLegacyNoteDeletions(records: readonly FirestoreRestoreDecoded[], live: readonly FirestoreRestoreDecoded[],
  intents: readonly FirebaseErasureIntent[], removedScopes: ReadonlySet<string>) {
  const key = (scope: FirebaseErasureIntent['scope']) => JSON.stringify([scope.ownerUserId, scope.workspaceId, scope.childId]);
  const noteKey = (scope: FirebaseErasureIntent['scope'], id: string) => JSON.stringify([key(scope), id]);
  const knownOps = new Map<string, string>(), erased = new Set<string>(), unresolved = new Set<string>();
  for (const intent of intents) if (intent.content?.kind === 'private_instruction') {
    const operationId = intent.content.sourceOperationId;
    knownOps.set(noteKey(intent.scope, operationId), noteDeletionRequestHash(intent.assetId, intent.content.throughVersion, operationId));
    erased.add(noteKey(intent.scope, intent.assetId));
  }
  const inBackup = new Map(records.map(row => [row.path, row]));
  for (const row of live) {
    const ctx = row.context;
    if (ctx.family !== 'domain' || ctx.kind !== 'agent-manual-operation') continue;
    const receipt = firestoreAgentManualSchema.parse(row.value);
    if (receipt.kind !== 'delete_note' || receipt.result !== true) continue;
    const proven = knownOps.get(noteKey(ctx.scope, JSON.parse(ctx.id)[1]));
    if (proven) {
      if (receipt.hash !== proven) domainReject('restore_erasure_binding');
      continue;
    }
    const prior = inBackup.get(row.path);
    if (prior && firestoreDomainHash(prior.value) === firestoreDomainHash(receipt)) continue;
    unresolved.add(key(ctx.scope));
  }
  if (!unresolved.size) return;
  const current = new Set<string>();
  for (const { context: ctx } of live) if (ctx.family === 'domain' && ctx.kind === 'private-instruction') current.add(noteKey(ctx.scope, ctx.id));
  for (const row of records) {
    const ctx = row.context;
    if (ctx.family !== 'domain' || removedScopes.has(row.path) || !unresolved.has(key(ctx.scope))) continue;
    let id: string | undefined;
    if (ctx.kind === 'private-instruction') id = ctx.id;
    else if (ctx.kind === 'memory-key' && JSON.parse(ctx.id)[2] === 'instructions') id = z.object({ id: z.uuid() }).parse(row.value).id;
    else if (ctx.kind === 'agent-action-receipt') {
      const saved = firestoreAgentActionSavedSchema.parse(row.value);
      if (saved.voiceEvidence && saved.receipt.resource.kind === 'private_note') id = saved.receipt.resource.id;
    }
    if (id && !current.has(noteKey(ctx.scope, id)) && !erased.has(noteKey(ctx.scope, id))) domainReject('restore_instruction_legacy_delete_unresolved');
  }
}

function noteDeletionRequestHash(noteId: string, expectedVersion: number, operationId: string) {
  return firestoreDomainHash({ noteId, expectedVersion, confirmDelete: true, operationId });
}

/** Reapply independent content barriers before rebuilding any readable data graph. */
export function replayContentErasures(data: FirestoreDomainData, codec: ReturnType<typeof createFirestoreRestoreCodec>,
  records: FirestoreRestoreDecoded[], live: readonly FirestoreRestoreDecoded[], journal: readonly FirebaseErasureIntent[], liveMetadata: ReadonlyMap<string, Record<string, unknown>>,
  descriptors: ReadonlyMap<string, FirebaseErasureDescriptor> = new Map(), removedScopes: ReadonlySet<string> = new Set()): Set<string> {
  const intents = journal.filter(v => v.type === 'content-delete').sort((a, b) => a.content!.throughVersion - b.content!.throughVersion), removed = new Set<string>();
  for (const row of live.filter(v => v.context.kind === 'content-erasure')) {
    const value = contentErasureSchema.parse(row.value);
    if (!intents.some(v => firebaseErasureIntentHash(v) === firebaseErasureIntentHash(value.intent))) domainReject('restore_content_journal_pending');
  }
  checkLegacyNoteDeletions(records, live, intents, removedScopes);
  // Pre-upgrade tombstones must be journaled too; absence of a new job is not permission to resurrect them.
  for (const row of live) {
    const ctx = row.context; if (ctx.family !== 'domain') continue;
    const value = row.value as { version?: number; operationId?: string };
    const kind = ctx.kind === 'shared-input-tombstone' ? 'private_source' : ctx.kind === 'care-tombstone' ? 'care' : ctx.kind === 'memory-tombstone'
      ? row.path.startsWith(data.options.namespace + '_memory_facts/') ? 'fact' : 'topic'
      : ctx.kind === 'child-profile' && Number(liveMetadata.get(row.path)?.historyFloor) > 1 ? 'profile' : null;
    if (!kind) continue;
    const through = kind === 'profile' ? Number(liveMetadata.get(row.path)?.historyFloor) - 1 : value.version! - 1;
    if (!intents.some(v => v.content!.kind === kind && v.assetId === ctx.id && v.scope.ownerUserId === ctx.scope.ownerUserId
      && v.scope.workspaceId === ctx.scope.workspaceId && v.scope.childId === ctx.scope.childId && v.content!.throughVersion >= through
      && (v.content!.kind !== 'private_source' || v.content!.throughVersion > through || v.content!.sourceOperationId === value.operationId)))
      domainReject('restore_content_journal_pending');
  }
  for (const intent of intents) {
    const content = intent.content!;
    let proofScope: typeof intent.scope | undefined;
    const notePath = content.kind === 'private_instruction' ? data.ref('private_instructions', 'private-instruction', intent.assetId).path : null;
    for (let i = 0; i < records.length; i++) {
      const row = records[i], ctx = row.context; if (ctx.family === 'knowledge') continue;
      if (ctx.scope.ownerUserId !== intent.scope.ownerUserId || ctx.scope.workspaceId !== intent.scope.workspaceId) continue;
      if (content.kind === 'private_instruction') {
        if (ctx.scope.childId !== intent.scope.childId || removedScopes.has(row.path)) continue;
        if (ctx.kind === 'authority-child-detail' || (ctx.kind === 'private-instruction' && row.path === notePath)) proofScope = ctx.scope;
        if (row.path === notePath && ctx.kind === 'private-instruction') removed.add(row.path);
        if (ctx.kind === 'memory-key' && JSON.parse(ctx.id)[2] === 'instructions'
          && z.object({ id: z.uuid() }).parse(row.value).id === intent.assetId) removed.add(row.path);
        if (ctx.kind === 'agent-action-receipt') {
          const saved = firestoreAgentActionSavedSchema.parse(row.value);
          row.value = redactErasedNoteEvidence(saved, intent.assetId);
        }
        continue;
      }
      if (ctx.kind === 'online-receipt') {
        const receipt = firestoreOnlineRecordSchema.safeParse(row.value);
        if (!receipt.success || isFirestoreOnlinePending(receipt.data) || receipt.data.childId !== intent.scope.childId) continue;
        const pointer = contentPointerSchema.safeParse(receipt.data.result);
        const target = content.kind === 'private_source' ? privateInputReceiptTarget(receipt.data.path, receipt.data.result)
          : pointer.success ? pointer.data : contentResult(receipt.data.path, receipt.data.result);
        if (target && (!('kind' in target) || target.kind === content.kind) && target.id === intent.assetId
          && target.version <= content.throughVersion) row.value = { ...receipt.data, result: null };
        continue;
      }
      if (ctx.scope.childId !== intent.scope.childId) continue;
      if (ctx.kind === 'handover-source-history') {
        const retained = sourceHistoryRecordSchema.parse(row.value);
        if (retained.evidence.module === historyResourceForContent(content.kind) && retained.resource.id === intent.assetId && retained.resource.version <= content.throughVersion)
          removed.add(row.path);
        continue;
      }
      if (content.kind === 'private_source') {
        if (ctx.kind === 'shared-input-part' || ctx.kind === 'shared-input-management') {
          const value = ctx.kind === 'shared-input-part' ? firestoreSharedInputPartSchema.parse(row.value) : firestoreSourceManagementRevisionSchema.parse(row.value);
          if (value.inputId === intent.assetId && value.version <= content.throughVersion) removed.add(row.path);
          continue;
        }
        if (ctx.id !== intent.assetId || removedScopes.has(row.path)) continue;
        if (ctx.kind === 'shared-input-tombstone') {
          const tombstone = firestoreSharedInputTombstoneSchema.parse(row.value);
          if (tombstone.version === content.throughVersion + 1 && tombstone.operationId === content.sourceOperationId) proofScope = ctx.scope;
          continue;
        }
        if (ctx.kind !== 'shared-input' || ctx.recordVersion! > content.throughVersion) continue;
        const original = z.object({ createdAt: z.string() }).parse(row.value);
        const tombstone = firestoreSharedInputTombstoneSchema.parse({ id: ctx.id, childId: ctx.scope.childId,
          version: content.throughVersion + 1, operationId: content.sourceOperationId, deletedAt: intent.at });
        records[i] = codec.decode({ path: row.path, data: { ...data.tags(ctx.scope), live: false, entityId: ctx.id, createdAt: original.createdAt,
          ...data.seal('shared-input-tombstone', ctx.id, ctx.scope, firestoreSharedInputTombstoneSchema, tombstone, tombstone.version) } });
        proofScope = ctx.scope;
        continue;
      }
      if (ctx.kind === contentHistory[content.kind][1]) {
        const revision = z.object({ id: z.uuid().optional(), childId: z.uuid(), version: z.number().int().positive() }).passthrough().parse(row.value);
        if ((content.kind === 'profile' ? revision.childId : revision.id) === intent.assetId && revision.version <= content.throughVersion) removed.add(row.path);
      }
      const parentKind = { care: 'care-record', profile: 'child-profile', fact: 'memory-fact', topic: 'memory-topic' }[content.kind];
      if (ctx.kind !== parentKind || ctx.id !== intent.assetId) continue;
      const old = z.object({ version: z.number().int().positive(), createdAt: z.string().optional() }).passthrough().parse(row.value);
      if (content.kind === 'profile') {
        const original = firestoreProfileSchema.parse(row.value), floor = content.throughVersion + 1;
        const value = original.version <= content.throughVersion ? { childId: original.childId, version: floor, data: null, confirmedBy: null, confirmedAt: null, reason: null } : original;
        records[i] = codec.decode({ path: row.path, data: { ...data.tags(ctx.scope), historyFloor: floor,
          ...data.seal('child-profile', ctx.id, ctx.scope, firestoreProfileSchema, value, value.version) } });
      } else if (old.version <= content.throughVersion) {
        const value = { id: ctx.id, childId: ctx.scope.childId, version: content.throughVersion + 1, operationId: intent.operationId, deletedAt: intent.at };
        records[i] = codec.decode({ path: row.path, data: { ...data.tags(ctx.scope), live: false,
          entityId: ctx.id, entityVersion: value.version, ...(content.kind === 'care' ? { createdAt: old.createdAt } : {}),
          ...data.seal(content.kind === 'care' ? 'care-tombstone' : 'memory-tombstone', ctx.id, ctx.scope, firestoreCareRecoverySchemas.tombstone, value, value.version) } });
      }
    }
    if (proofScope) {
      // The independent proof still refers to the original epoch after the restored workspace gets a new one.
      const hash = firebaseErasureIntentHash(intent), journal = firebaseErasureDescriptorSchema.parse(descriptors.get(hash));
      if (journal.intentSha256 !== hash) domainReject('restore_content_journal_pending');
      const scope = proofScope, id = intent.operationId, path = data.ref('content_erasures', 'content-erasure', id).path;
      const existing = records.findIndex(item => item.path === path);
      if (existing >= 0 && firebaseErasureIntentHash(contentErasureSchema.parse(records[existing]!.value).intent) !== hash)
        domainReject('restore_content_journal_pending');
      const completed = contentErasureSchema.parse({ intent, journal, stage: 'done', after: null });
      const proof = codec.decode({ path, data: { ...data.tags(scope), stage: completed.stage, ...data.seal('content-erasure', id, scope, contentErasureSchema, completed) } });
      if (existing < 0) records.push(proof); else records[existing] = proof;
      if (content.kind === 'private_instruction') {
        const operationId = content.sourceOperationId, receiptId = JSON.stringify([scope.ownerUserId, operationId]);
        const receiptPath = data.ref('agent_manual_operations', 'agent-manual-operation', receiptId).path;
        const result = { childId: scope.childId, kind: 'delete_note' as const, result: true,
          hash: noteDeletionRequestHash(intent.assetId, content.throughVersion, operationId) };
        const previous = records.find(item => item.path === receiptPath);
        if (previous) {
          if (firestoreDomainHash(previous.value) !== firestoreDomainHash(result)) domainReject('restore_erasure_binding');
        } else records.push(codec.decode({ path: receiptPath, data: { ...data.tags(scope),
          ...data.seal('agent-manual-operation', receiptId, scope, firestoreAgentManualSchema, result) } }));
      }
    }
  }
  return removed;
}
