import { z } from 'zod';
import { FieldPath, type DocumentSnapshot } from '@google-cloud/firestore';
import { handoverSourceHistoryQuerySchema, handoverSourceHistoryPageSchema, handoverImportResultPageSchema } from '../src/shared/handover-imports.ts';
import type { CareRecord, ChildProfile } from '../src/shared/care.ts';
import type { CareTask } from '../src/shared/tasks.ts';
import type { HandoverIntegrity } from '../src/shared/handover.ts';
import type { HandoverImportRow } from './handover-import.ts';
import type { HandoverImportBatchRequest } from './handover-import-batch-records.ts';
import type { WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import { createFirestoreSharingStore } from './firestore-sharing.ts';
import { createFirestoreCareStore, firestoreCareSchema, firestoreProfileSchema } from './firestore-care.ts';
import { createFirestoreOnlineStore } from './firestore-online.ts';
import { createFirestoreMemoryStore, firestoreFactSchema, firestoreTopicSchema, firestoreSummarySchema } from './firestore-memory.ts';
import { createFirestoreChatStore } from './firestore-chat.ts';
import { createFirestorePrivateInstructions, firestorePrivateInstructionSchema } from './firestore-private-instructions.ts';
import { createFirestoreSharedInputStore, sharedInputImportSchema } from './firestore-shared-inputs.ts';
import { createFirestoreCareSummary, firestorePreparationSchema } from './firestore-care-summary.ts';
import { createFirestoreFamilyDocumentStore } from './firestore-family-documents.ts';
import { familyDocumentTransferSchema, documentTransferContentSchema, type DocumentTransferContent } from './family-document-transfer.ts';
import { handoverImportModuleOf, handoverImportResourceSectionSchema, type HandoverImportModule, type HandoverImportResourceSection } from '../src/shared/handover-imports.ts';
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
type Section = HandoverImportResourceSection;
export interface HandoverImportItemCommand {
  opId: string; batchId: string; target: Target; row: HandoverImportRow; integrity: HandoverIntegrity; resolution: HandoverImportResolution;
  documentContent?: DocumentTransferContent | null;
}
/** Internal batch guard: read its claim before domain writes, then seal progress before committing either. */
export type HandoverImportFence = (actor: Binding, target: Binding) => Promise<(item: HandoverImportItem, repeated: boolean) => () => void>;

/** Internal coordinator: the package worker supplies verified rows and a fixed, authorized batch selection. */
export function createFirestoreHandoverImportItems(options: FirestoreDomainOptions) {
  const data = new FirestoreDomainData(options), authority = createFirestoreAuthority(options), sharing = createFirestoreSharingStore(options);
  const care = createFirestoreCareStore(options), online = createFirestoreOnlineStore(options);
  const memory = createFirestoreMemoryStore({ ...options, care, chat: createFirestoreChatStore(options) }), notes = createFirestorePrivateInstructions(data);
  const sources = createFirestoreSharedInputStore(options);
  const documents = createFirestoreFamilyDocumentStore(options), preparations = createFirestoreCareSummary(options, care);
  const sectionSchema = handoverImportResourceSectionSchema;
  const schemas = { care: firestoreCareSchema, profile: firestoreProfileSchema, tasks: firestoreTaskSchema,
    memory_facts: firestoreFactSchema, memory_topics: firestoreTopicSchema, instructions: firestorePrivateInstructionSchema, summary_history: firestoreSummarySchema,
    private_sources: sharedInputImportSchema, documents: familyDocumentTransferSchema, visit_preparation: firestorePreparationSchema };
  const access = <T>(userId: string, target: Target, section: Section | HandoverImportModule, mode: 'read' | 'write', use: (b: Binding, actor: Binding) => Promise<T>) => {
    const module = section === 'memory' || section === 'sources' ? section : handoverImportModuleOf(section);
    if (target.spaceId) {
      if (module === 'sources') domainReject('private_scope_unavailable', 403);
      return authority.runTransaction(userId, null, actor => sharing.inResourceTransaction(actor,
        { spaceId: target.spaceId!, childId: target.childId, module, mode }, value => use(value.binding, actor)));
    }
    return authority.runTransaction(userId, target.childId, b => use(b, b));
  };
  async function receipt(b: Binding, opId: string, section: Section, existing?: DocumentSnapshot) {
    const id = handoverImportItemId(b.scope, opId), ref = data.ref('handover_import_items', 'handover-import-item', id);
    const row = existing ?? await b.transaction.get(ref);
    if (!row.exists) return null;
    const value = data.open('handover-import-item', id, b.scope, handoverImportItemSchema, row);
    if (value.opId !== opId || value.source.source.section !== section || value.actorUserId !== b.actorUserId || row.get('recordVersion') !== 1 || row.ref.path !== ref.path)
      domainReject('import_item_binding', 403);
    for (const [key, expected] of Object.entries({ ...data.tags(b.scope), ...handoverImportItemMetadata(value) }))
      if (row.get(key) !== expected) domainReject('import_item_binding', 500);
    return value;
  }
  async function readState(b: Binding, section: Section, source: z.infer<typeof handoverSourceIdentitySchema>) {
    const mappingId = handoverImportMappingId(b.scope, source), mappingRef = data.ref('handover_import_mappings', 'handover-import-mapping', mappingId);
    const snapshot = await b.transaction.get(mappingRef);
    const mapping = snapshot.exists ? data.open('handover-import-mapping', mappingId, b.scope, handoverImportMappingSchema, snapshot) : null;
    if (mapping && (firestoreDomainHash(mapping.source) !== firestoreDomainHash(source) || mapping.revision !== snapshot.get('recordVersion')))
      domainReject('import_mapping_binding', 500);
    const careState = section === 'care' && mapping ? await care.readImportRecordState(b, mapping.target.id) : null;
    const memoryState = mapping && (section === 'memory_facts' || section === 'memory_topics')
      ? await memory.readImportState(b, section === 'memory_facts' ? 'facts' : 'topics', mapping.target.id) : null;
    const sourceState = mapping && section === 'private_sources' ? await sources.readImportState(b, mapping.target.id) : null;
    const documentState = mapping && section === 'documents' ? await documents.readImportState(b, mapping.target.id) : null;
    const preparationState = section === 'visit_preparation' ? await preparations.readImportState(b) : null;
    const current = section === 'profile' ? await care.readProfile(b)
      : preparationState ? preparationState.value
      : !mapping ? null : section === 'care' ? careState!.value : section === 'tasks' ? await online.readImportTask(b, b.scope.childId, mapping.target.id)
      : documentState ? documentState.value : sourceState ? sourceState.value : memoryState ? memoryState.value : section === 'instructions' ? await notes.read(b, mapping.target.id) : await memory.readImportedSummary(b, mapping.target.id);
    const currentVersion = current?.version ?? careState?.version ?? memoryState?.version ?? sourceState?.version ?? 0;
    const currentId = current ? 'id' in current ? current.id : current.childId : mapping?.target.id ?? (section === 'profile' || section === 'visit_preparation' ? b.scope.childId : null);
    const deleted = mapping !== null && (current === null || section === 'profile' && (current as ChildProfile).data === null)
      || section === 'profile' && currentVersion > 0 && (current as ChildProfile).data === null;
    const locallyChanged = mapping ? currentVersion !== mapping.target.version : section === 'profile' && (current as ChildProfile).data !== null
      || section === 'visit_preparation' && currentVersion > 0;
    return { mappingId, mappingRef, mapping, current, currentVersion, currentId, deleted, locallyChanged };
  }
  async function apply(userId: string, raw: HandoverImportItemCommand, fence?: HandoverImportFence) {
    const target = domainParse(targetSchema, raw.target), historySection = historyModule(raw.row.section);
    const section = domainParse(sectionSchema, historySection ?? raw.row.section);
    const opId = domainParse(z.uuid(), raw.opId), batchId = domainParse(z.uuid(), raw.batchId);
    const resolution = domainParse(handoverImportResolutionSchema, raw.resolution);
    const sourceValue = historySection ? null : domainParse(schemas[section] as z.ZodType<{ version: number }>, raw.row.value, 'invalid_package_data');
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
      if (!history && section === 'documents') {
        if (raw.documentContent === undefined) domainReject('document_content_missing', 400);
        provenance.current.sourceHash = firestoreDomainHash({ value: raw.row.value, content: raw.documentContent });
      }
      const { serverId, accountId, childId } = provenance.current.source;
      const resourceId = history?.parentId ?? provenance.current.source.resourceId;
      const source = handoverSourceIdentitySchema.parse({ serverId, accountId, childId, section, resourceId });
      const { mappingId, mappingRef, mapping, current, currentVersion, currentId, deleted, locallyChanged } = await readState(b, section, source);
      const resultResource = currentId ? { id: currentId, version: currentVersion } : null;
      async function finish(outcome: HandoverImportItem['outcome'], reason: string | null, resource = resultResource,
        prepared?: { changeSeq: string; commit(): void }, historyCommit?: () => void) {
        const module = handoverImportModuleOf(section);
        const auditChange = prepared ? null : await b.prepareChange(opId, module === 'sources' ? 'care' : module, false);
        const item = handoverImportItemSchema.parse({ opId, batchId, fingerprint, actorUserId: b.actorUserId, at: provenance.current.importedAt,
          ...(history ? { sourceSection: raw.row.section } : {}),
          source: provenance.current, outcome, reason, resource, changeSeq: prepared?.changeSeq ?? auditChange!.changeSeq });
        const id = handoverImportItemId(b.scope, opId), envelope = data.seal('handover-import-item', id, b.scope, handoverImportItemSchema, item);
        let next: HandoverImportMapping | null = null;
        if (prepared && resource && !history) next = handoverImportMappingSchema.parse({ source, sourceVersion: sourceValue!.version,
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
        if (section === 'documents') {
          if (deleted) return finish('conflict', 'target_deleted');
          if (history.parentVersion > mapping.sourceVersion) return finish('conflict', 'history_parent_version_unavailable');
          if (raw.row.section === 'document_versions') {
            if (!raw.documentContent) domainReject('document_content_missing', 400);
            return finish('skipped', 'document_revision_index', mapping.target);
          }
          const prepared = await documents.prepareImportedRevision(b, opId, raw.row, raw.integrity,
            { id: mapping.target.id, expectedVersion: currentVersion });
          return finish(prepared.outcome, prepared.outcome === 'created' ? null : prepared.outcome === 'skipped'
            ? 'history_already_imported' : 'source_history_conflict', mapping.target,
          prepared.commit ? { changeSeq: prepared.changeSeq!, commit: prepared.commit } : undefined);
        }
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
      if (section === 'tasks') {
        const prepared = await online.prepareImportedTask(b, target.childId, opId, raw.row, raw.integrity,
          current ? { id: (current as CareTask).id, expectedVersion: current.version } : undefined);
        return finish(current ? 'updated' : 'created', null, { id: prepared.task.id, version: prepared.task.version }, prepared);
      }
      if (section === 'documents') {
        const content = raw.documentContent ? domainParse(documentTransferContentSchema, raw.documentContent, 'invalid_package_data') : null;
        const prepared = await documents.prepareImported(b, opId, raw.row, raw.integrity, content?.snapshot ?? null,
          current ? { id: currentId!, expectedVersion: currentVersion } : undefined);
        return finish(current ? 'updated' : 'created', null, prepared.value, prepared);
      }
      if (section === 'visit_preparation') {
        const sourcePreparation = domainParse(firestorePreparationSchema, raw.row.value, 'invalid_package_data');
        const mayReadTasks = !b.sharedAccess || b.sharedAccess.modules?.includes('tasks');
        const task = sourcePreparation.appointmentTaskId && mayReadTasks
          ? await readState(b, 'tasks', { ...source, section: 'tasks', resourceId: sourcePreparation.appointmentTaskId }) : null;
        const localTask = task?.current as CareTask | null | undefined;
        const appointment = localTask?.kind === 'appointment' && localTask.occurrence.state === 'scheduled'
          ? { sourceTaskId: sourcePreparation.appointmentTaskId!, targetTaskId: localTask.id, expectedVersion: localTask.version } : undefined;
        const prepared = await preparations.prepareImported(b, opId, raw.row, raw.integrity, currentVersion, appointment);
        return finish(current ? 'updated' : 'created', null, prepared.value, prepared);
      }
      const expected = current ? { id: currentId!, expectedVersion: current.version } : undefined;
      let prepared;
      try {
        prepared = section === 'private_sources' ? await sources.prepareImported(b, opId, raw.row, raw.integrity, expected)
          : section === 'memory_facts' ? await memory.prepareImportedFact(b, opId, raw.row, raw.integrity, expected)
          : section === 'memory_topics' ? await memory.prepareImportedTopic(b, opId, raw.row, raw.integrity, expected)
          : section === 'instructions' ? await notes.prepareImported(b, opId, raw.row, raw.integrity, expected)
          : await memory.prepareImportedSummary(b, opId, raw.row, raw.integrity, expected);
      } catch (error) {
        // Domain refusals are per-item results, not permission to merge unrelated identities or revive terminal work.
        const code = (error as { code?: string }).code;
        if (code && ['fact_key_conflict', 'topic_exists', 'instruction_key_conflict', 'terminal_topic', 'input_processing', 'input_linked', 'inputs_capacity'].includes(code)) return finish('conflict', code);
        throw error;
      }
      const resource = { id: prepared.value.id, version: prepared.value.version };
      const snapshot = section === 'summary_history' ? await prepareSourceHistory(data, b, {
        format: 'yuyoufang-source-revision:1', childId: target.childId, resource,
        evidence: { module: section, source: provenance, value: raw.row.value },
        opId, importedBy: b.actorUserId, importedAt: provenance.current.importedAt,
      }) : null;
      return finish(current ? 'updated' : 'created', null, resource, prepared, snapshot?.commit);
    });
  }
  return { apply,
    async results(userId: string, selection: { batchId: string; sourceChildId: string; module: HandoverImportModule; target: Target;
      source: HandoverImportBatchRequest['source']; expectedScope: WorkRecoveryScope; cursor?: string }) {
      return access(userId, selection.target, selection.module, 'read', async b => {
        if (firestoreDomainHash(b.scope) !== firestoreDomainHash(selection.expectedScope)) domainReject('import_target_changed');
        const { cursor, ...binding } = selection, scope = firestoreDomainHash([userId, binding, b.authorizationVersion, b.changeSeq]);
        const aad = 'handover-import-results:1:' + userId;
        let after: string | null = null;
        if (cursor) {
          try { const decoded = z.object({ scope: z.string(), after: z.string().regex(/^[a-f0-9]{64}$/u) }).strict()
            .parse(JSON.parse(options.cipher.decrypt(Buffer.from(cursor, 'base64url').toString(), aad)));
            if (decoded.scope !== scope) domainReject('import_results_changed'); after = decoded.after;
          } catch (error) { if ((error as { code?: string }).code === 'import_results_changed') throw error; domainReject('invalid_cursor', 400); }
        }
        let query = data.collection('handover_import_items');
        for (const [key, value] of Object.entries(data.tags(b.scope))) query = query.where(key, '==', value) as typeof query;
        const selected = sectionSchema.options.filter(section => handoverImportModuleOf(section) === selection.module);
        let page = query.where('batchId', '==', selection.batchId).where('section', selected.length === 1 ? '==' : 'in',
          selected.length === 1 ? selected[0] : selected).orderBy(FieldPath.documentId()).limit(21);
        if (after) page = page.startAfter(after);
        const rows = await b.transaction.get(page), result = [];
        for (const row of rows.docs.slice(0, 20)) {
          const resourceSection = domainParse(sectionSchema, row.get('section'), 'import_item_binding', 500);
          if (handoverImportModuleOf(resourceSection) !== selection.module) domainReject('import_item_binding', 500);
          const value = await receipt(b, domainParse(z.uuid(), row.get('opId'), 'import_item_binding', 500), resourceSection, row);
          if (!value || value.batchId !== selection.batchId || value.source.packageId !== selection.source.packageId
            || value.source.packageVersion !== selection.source.packageVersion || value.source.manifestSha256 !== selection.source.manifestSha256
            || value.source.source.serverId !== selection.source.serverId || value.source.source.accountId !== selection.source.accountId)
            domainReject('import_item_binding', 500);
          if (value.source.source.childId !== selection.sourceChildId) continue;
          let currentResource: { id: string; version: number; deleted: boolean } | null = null;
          let availableResolution: 'replace_current' | 'restore_deleted' | null = null;
          if (!value.sourceSection && value.outcome === 'conflict' && ['target_changed', 'target_deleted', 'target_version_conflict'].includes(value.reason ?? '')) {
            const { serverId, accountId, childId, section, resourceId } = value.source.source;
            const live = await readState(b, resourceSection, { serverId, accountId, childId, section, resourceId });
            if (live.currentId) currentResource = { id: live.currentId, version: live.currentVersion, deleted: live.deleted };
            const stale = live.mapping && (value.source.source.resourceVersion < live.mapping.sourceVersion
              || value.source.source.resourceVersion === live.mapping.sourceVersion && value.source.sourceHash !== live.mapping.sourceHash);
            if (currentResource && !stale) availableResolution = live.deleted ? 'restore_deleted' : live.locallyChanged ? 'replace_current' : null;
          }
          result.push({ id: value.opId, batchId: value.batchId, sourceChildId: selection.sourceChildId, module: selection.module,
            ...(selection.module === 'memory' || selection.module === 'sources' || selection.module === 'documents' ? { resourceSection } : {}),
            sourceResourceId: value.source.source.resourceId, sourceVersion: value.source.source.resourceVersion, sourceSection: value.sourceSection ?? null,
            at: value.at, outcome: value.outcome, reason: value.reason, recordedResource: value.resource, currentResource, availableResolution });
        }
        const nextCursor = rows.size > 20 ? Buffer.from(options.cipher.encrypt(JSON.stringify({ scope, after: rows.docs[19].id }), aad)).toString('base64url') : null;
        return handoverImportResultPageSchema.parse({ batchId: selection.batchId, sourceChildId: selection.sourceChildId, module: selection.module,
          items: result, nextCursor, complete: nextCursor === null });
      });
    },
    async history(userId: string, raw: unknown) {
    const input = domainParse(handoverSourceHistoryQuerySchema, raw);
    return access(userId, input, input.module, 'read', async b => {
      if (input.module === 'documents') {
        const store = createFirestoreFamilyDocumentStore({ ...options, transaction: b });
        const page = await store.listSourceVersions(userId, input.childId, input.resourceId, input.cursor);
        if (!page) domainReject('not_found', 404);
        return handoverSourceHistoryPageSchema.parse({ items: page.items.map(({ origin, ...value }) => ({
          format: 'yuyoufang-source-revision:1', childId: input.childId, resource: { id: input.resourceId, version: value.snapshotVersion },
          evidence: { module: 'documents', source: origin.importedFrom, value },
        })), nextCursor: page.nextCursor, complete: page.nextCursor === null });
      }
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
