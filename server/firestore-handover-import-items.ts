import { z } from 'zod';
import { FieldPath } from '@google-cloud/firestore';
import { handoverSourceHistoryQuerySchema, handoverSourceHistoryPageSchema } from '../src/shared/handover-imports.ts';
import type { CareRecord, ChildProfile } from '../src/shared/care.ts';
import type { CareTask } from '../src/shared/tasks.ts';
import type { HandoverIntegrity } from '../src/shared/handover.ts';
import type { HandoverImportRow } from './handover-import.ts';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import { createFirestoreSharingStore } from './firestore-sharing.ts';
import { createFirestoreCareStore, firestoreCareSchema, firestoreProfileSchema } from './firestore-care.ts';
import { createFirestoreOnlineStore } from './firestore-online.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash, firestoreTaskSchema, type FirestoreDomainOptions } from './firestore-domain-data.ts';
import { makeImportProvenance } from './handover-provenance.ts';
import { historyModule, sourceHistoryRecordSchema, sourceHistoryExport, sourceHistoryId } from './handover-history-records.ts';
import { parseHistoryRow, prepareSourceHistory, sourceHistoryVisible, validateSourceHistory } from './handover-source-history.ts';
import { handoverSourceIdentitySchema, handoverImportItemSchema, handoverImportMappingSchema,
  handoverImportResolutionSchema, handoverImportItemId, handoverImportMappingId,
  handoverImportItemMetadata, handoverImportMappingMetadata,
  type HandoverImportItem, type HandoverImportMapping, type HandoverImportResolution } from './handover-import-records.ts';

const targetSchema = z.object({ childId: z.uuid(), spaceId: z.uuid().nullable() }).strict();
type Target = z.infer<typeof targetSchema>;
type Section = 'care' | 'profile' | 'tasks';
export interface HandoverImportItemCommand {
  opId: string; batchId: string; target: Target; row: HandoverImportRow; integrity: HandoverIntegrity; resolution: HandoverImportResolution;
}
/** Internal batch guard: read its claim before domain writes, then seal progress before committing either. */
export type HandoverImportFence = (actor: Binding, target: Binding) => Promise<(item: HandoverImportItem, repeated: boolean) => () => void>;

/** Internal coordinator: the package worker supplies verified rows and a fixed, authorized batch selection. */
export function createFirestoreHandoverImportItems(options: FirestoreDomainOptions) {
  const data = new FirestoreDomainData(options), authority = createFirestoreAuthority(options), sharing = createFirestoreSharingStore(options);
  const care = createFirestoreCareStore(options), online = createFirestoreOnlineStore(options);
  const sectionSchema = z.enum(['care', 'profile', 'tasks']);
  const schemas = { care: firestoreCareSchema, profile: firestoreProfileSchema, tasks: firestoreTaskSchema };
  const access = <T>(userId: string, target: Target, section: Section, mode: 'read' | 'write', use: (b: Binding, actor: Binding) => Promise<T>) => target.spaceId
    ? authority.runTransaction(userId, null, actor => sharing.inResourceTransaction(actor,
      { spaceId: target.spaceId!, childId: target.childId, module: section, mode }, value => use(value.binding, actor)))
    : authority.runTransaction(userId, target.childId, b => use(b, b));
  async function receipt(b: Binding, opId: string, section: Section) {
    const id = handoverImportItemId(b.scope, opId), row = await b.transaction.get(data.ref('handover_import_items', 'handover-import-item', id));
    if (!row.exists) return null;
    const value = data.open('handover-import-item', id, b.scope, handoverImportItemSchema, row);
    if (value.opId !== opId || value.source.source.section !== section || value.actorUserId !== b.actorUserId || row.get('recordVersion') !== 1)
      domainReject('import_item_binding', 403);
    return value;
  }
  async function apply(userId: string, raw: HandoverImportItemCommand, fence?: HandoverImportFence) {
    const target = domainParse(targetSchema, raw.target), historySection = historyModule(raw.row.section);
    const section = domainParse(sectionSchema, historySection ?? raw.row.section);
    const opId = domainParse(z.uuid(), raw.opId), batchId = domainParse(z.uuid(), raw.batchId);
    const resolution = domainParse(handoverImportResolutionSchema, raw.resolution);
    const sourceValue = historySection ? null : domainParse(schemas[section] as z.ZodType<CareRecord | ChildProfile | CareTask>, raw.row.value, 'invalid_package_data');
    const fingerprint = firestoreDomainHash({ ...raw, userId });
    return access(userId, target, section, 'write', async (b, actor) => {
      const sealProgress = fence ? await fence(actor, b) : null;
      const prior = await receipt(b, opId, section);
      if (prior) {
        if (prior.fingerprint !== fingerprint) domainReject('operation_conflict');
        sealProgress?.(prior, true)();
        return prior;
      }
      const history = historySection ? parseHistoryRow(raw.row, historySection, raw.integrity, b.actorUserId) : null;
      const provenance = history?.provenance ?? makeImportProvenance(raw.row, raw.integrity, b.actorUserId, new Date().toISOString());
      const { serverId, accountId, childId } = provenance.current.source;
      const resourceId = history?.parentId ?? provenance.current.source.resourceId;
      const source = handoverSourceIdentitySchema.parse({ serverId, accountId, childId, section, resourceId });
      const mappingId = handoverImportMappingId(b.scope, source), mappingRef = data.ref('handover_import_mappings', 'handover-import-mapping', mappingId);
      const snapshot = await b.transaction.get(mappingRef);
      const mapping = snapshot.exists ? data.open('handover-import-mapping', mappingId, b.scope, handoverImportMappingSchema, snapshot) : null;
      if (mapping && (firestoreDomainHash(mapping.source) !== firestoreDomainHash(source) || mapping.revision !== snapshot.get('recordVersion')))
        domainReject('import_mapping_binding', 500);
      const careState = section === 'care' && mapping ? await care.readImportRecordState(b, mapping.target.id) : null;
      const current = section === 'profile' ? await care.readProfile(b)
        : mapping ? section === 'care' ? careState!.value
          : await online.readImportTask(b, target.childId, mapping.target.id) : null;
      const currentVersion = current?.version ?? careState?.version ?? 0;
      const currentId = current ? 'id' in current ? current.id : current.childId : mapping?.target.id ?? (section === 'profile' ? target.childId : null);
      const deleted = mapping !== null && (current === null || section === 'profile' && (current as ChildProfile).data === null)
        || section === 'profile' && currentVersion > 0 && (current as ChildProfile).data === null;
      const resultResource = currentId ? { id: currentId, version: currentVersion } : null;
      async function finish(outcome: HandoverImportItem['outcome'], reason: string | null, resource = resultResource,
        prepared?: { changeSeq: string; commit(): void }, historyCommit?: () => void) {
        const auditChange = prepared ? null : await b.prepareChange(opId, section, false);
        const item = handoverImportItemSchema.parse({ opId, batchId, fingerprint, actorUserId: b.actorUserId, at: provenance.current.importedAt,
          ...(history ? { sourceSection: raw.row.section } : {}),
          source: provenance.current, outcome, reason, resource, changeSeq: prepared?.changeSeq ?? auditChange!.changeSeq });
        const id = handoverImportItemId(b.scope, opId), envelope = data.seal('handover-import-item', id, b.scope, handoverImportItemSchema, item);
        let next: HandoverImportMapping | null = null;
        if (prepared && resource) next = handoverImportMappingSchema.parse({ source, sourceVersion: sourceValue!.version,
          sourceHash: provenance.current.sourceHash, target: resource, revision: (mapping?.revision ?? 0) + 1,
          operationId: opId, importedAt: provenance.current.importedAt });
        // Seal all records before the first write. Model/storage/network calls never occur in the callback.
        const mappingEnvelope = next ? data.seal('handover-import-mapping', mappingId, b.scope, handoverImportMappingSchema, next, next.revision) : null;
        const commitProgress = sealProgress?.(item, false);
        prepared?.commit(); auditChange?.commit(); historyCommit?.();
        if (next) b.transaction.set(mappingRef, { ...data.tags(b.scope), ...handoverImportMappingMetadata(next), ...mappingEnvelope });
        b.transaction.create(data.ref('handover_import_items', 'handover-import-item', id), { ...data.tags(b.scope), ...handoverImportItemMetadata(item), ...envelope });
        commitProgress?.();
        return item;
      }
      if (history) {
        if (!mapping) return finish('conflict', 'history_parent_not_imported');
        const retained = { format: 'yuyoufang-source-revision:1' as const, childId: target.childId, resource: mapping.target,
          evidence: history.evidence, opId, importedBy: b.actorUserId, importedAt: provenance.current.importedAt };
        if (deleted || !await sourceHistoryVisible(data, b, retained)) return finish('conflict', 'target_deleted');
        if (history.parentVersion > mapping.sourceVersion) return finish('conflict', 'history_parent_version_unavailable');
        const prepared = await prepareSourceHistory(data, b, retained);
        return finish(prepared.outcome, prepared.reason, mapping.target, undefined, prepared.commit);
      }
      if (section === 'profile' && (sourceValue as ChildProfile).data === null) return finish('skipped', 'empty_profile');
      if (mapping && sourceValue!.version === mapping.sourceVersion && provenance.current.sourceHash !== mapping.sourceHash)
        return finish('conflict', 'source_version_conflict');
      if (resolution.mode !== 'preserve' && (resolution.targetId !== currentId || resolution.expectedVersion !== currentVersion))
        return finish('conflict', 'target_version_conflict');
      if (deleted && resolution.mode !== 'restore_deleted') return finish('conflict', 'target_deleted');
      if (!deleted && resolution.mode === 'restore_deleted') return finish('conflict', 'target_not_deleted');
      if (mapping && sourceValue!.version < mapping.sourceVersion) return finish('skipped', 'older_source');
      const locallyChanged = mapping ? currentVersion !== mapping.target.version : section === 'profile' && (current as ChildProfile).data !== null;
      if (!deleted && locallyChanged && resolution.mode !== 'replace_current') return finish('conflict', 'target_changed');
      if (!deleted && !locallyChanged && mapping && sourceValue!.version === mapping.sourceVersion) return finish('skipped', 'already_imported');
      if (section === 'care') {
        const prepared = await care.prepareImportedRecord(b, opId, raw.row, raw.integrity,
          current ? { id: (current as CareRecord).id, expectedVersion: current.version } : undefined);
        return finish(current ? 'updated' : 'created', null, { id: prepared.value.id, version: prepared.value.version }, prepared);
      }
      if (section === 'profile') {
        const prepared = await care.prepareImportedProfile(b, opId, raw.row, raw.integrity, currentVersion);
        return finish(currentVersion > 0 ? 'updated' : 'created', null, { id: prepared.value.childId, version: prepared.value.version }, prepared);
      }
      const prepared = await online.prepareImportedTask(b, target.childId, opId, raw.row, raw.integrity,
        current ? { id: (current as CareTask).id, expectedVersion: current.version } : undefined);
      return finish(current ? 'updated' : 'created', null, { id: prepared.task.id, version: prepared.task.version }, prepared);
    });
  }
  return { apply, async history(userId: string, raw: unknown) {
    const input = domainParse(handoverSourceHistoryQuerySchema, raw);
    return access(userId, input, input.module, 'read', async b => {
      const { cursor, ...selection } = input, scope = firestoreDomainHash([userId, selection, b.scope, b.authorizationVersion, b.changeSeq]);
      const aad = 'handover-source-history:1:' + userId;
      let after: string | null = null;
      if (cursor) {
        try { const parsed = z.object({ scope: z.string(), after: z.string().regex(/^[a-f0-9]{64}$/u) }).strict()
          .parse(JSON.parse(options.cipher.decrypt(Buffer.from(cursor, 'base64url').toString(), aad)));
          if (parsed.scope !== scope) domainReject('source_history_scope_changed'); after = parsed.after;
        } catch (error) { if ((error as { code?: string }).code === 'source_history_scope_changed') throw error; domainReject('invalid_history_cursor', 400); }
      }
      let query = data.collection('handover_source_history');
      for (const [key, value] of Object.entries(data.tags(b.scope))) query = query.where(key, '==', value) as typeof query;
      let page = query.where('module', '==', input.module).where('entityId', '==', input.resourceId).orderBy(FieldPath.documentId()).limit(11);
      if (after) page = page.startAfter(data.ref('handover_source_history', 'handover-source-history', after).id);
      const rows = await b.transaction.get(page), results = [];
      for (const row of rows.docs.slice(0, 10)) {
        // Logical IDs are separate from the hashed Firestore document addresses.
        const value = data.open('handover-source-history', row.get('historyId'), b.scope, sourceHistoryRecordSchema, row);
        validateSourceHistory(value);
        if (value.resource.id !== input.resourceId || value.evidence.module !== input.module || row.get('recordVersion') !== 1
          || row.get('historyId') !== sourceHistoryId(b.scope, value)
          || data.ref('handover_source_history', 'handover-source-history', row.get('historyId')).path !== row.ref.path) domainReject('source_history_binding', 500);
        if (await sourceHistoryVisible(data, b, value)) results.push(sourceHistoryExport(value));
      }
      const nextCursor = rows.size > 10 ? Buffer.from(options.cipher.encrypt(JSON.stringify({ scope, after: rows.docs[9].get('historyId') }), aad)).toString('base64url') : null;
      return handoverSourceHistoryPageSchema.parse({ items: results, nextCursor, complete: nextCursor === null });
    });
  }, get(userId: string, raw: Target, opId: string, section: Section) {
    const target = domainParse(targetSchema, raw); domainParse(z.uuid(), opId); domainParse(sectionSchema, section);
    return access(userId, target, section, 'read', b => receipt(b, opId, section));
  } };
}
