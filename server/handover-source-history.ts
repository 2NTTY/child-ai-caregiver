import { firestoreCareSchema, firestoreProfileSchema } from './firestore-care.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash, firestoreTaskRevisionSchema, firestoreTaskSchema } from './firestore-domain-data.ts';
import type { FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import type { HandoverImportRow } from './handover-import.ts';
import type { HandoverIntegrity } from '../src/shared/handover.ts';
import { makeImportProvenance } from './handover-provenance.ts';
import { contentVisible } from './firestore-disclosure.ts';
import { firestoreFactSchema, firestoreTopicSchema, firestoreSummarySchema } from './firestore-memory.ts';
import { createFirestorePrivateInstructions, firestorePrivateInstructionSchema } from './firestore-private-instructions.ts';
import { createFirestoreSharedInputStore, firestoreSourceManagementRevisionSchema } from './firestore-shared-inputs.ts';
import { z } from 'zod';
import { createFirestoreConcernStore, firestoreConcernSchema } from './firestore-concerns.ts';
import { firestoreDocumentConcernEventSchema } from './firestore-document-sources.ts';
import { firestorePreparationSchema } from './firestore-care-summary.ts';
import { documentTransferContentSchema, documentTransferVersionSchema } from './family-document-transfer.ts';
import { sourceHistoryExportSchema, sourceHistoryRecordSchema, sourceHistoryId, sourceHistoryMetadata,
  type SourceHistoryRecord, type HistoryModule } from './handover-history-records.ts';

function parseRevision(module: HistoryModule, raw: unknown, sourceSection?: string) {
  if (module === 'concerns') {
    if (sourceSection === 'concern_events') {
      const value = domainParse(firestoreDocumentConcernEventSchema, raw, 'invalid_package_data');
      return { value: value as unknown as Record<string, unknown>, resource: { ...value, version: 1 } };
    }
    const value = domainParse(firestoreConcernSchema, raw, 'invalid_package_data');
    return { value: value as unknown as Record<string, unknown>, resource: value };
  }
  if (module === 'files' || module === 'voices' || module === 'photos' || module === 'child_avatar' || module === 'chat' || module === 'chat_imports')
    domainReject('invalid_package_data', 400); // Attachment identities are immutable assets, not editable source revisions.
  if (module === 'documents') domainReject('invalid_package_data', 400); // Document bodies use the existing chunked snapshot store.
  if (module === 'visit_preparation') {
    const value = domainParse(firestorePreparationSchema, raw, 'invalid_package_data');
    return { value: value as unknown as Record<string, unknown>, resource: { ...value, id: value.childId } };
  }
  if (module === 'private_sources') {
    const value = domainParse(firestoreSourceManagementRevisionSchema, raw, 'invalid_package_data');
    return { value: value as unknown as Record<string, unknown>,
      resource: { id: value.inputId, childId: value.childId, version: value.version, authorUserId: value.ownerUserId, updatedAt: value.changedAt } };
  }
  if (module === 'tasks') {
    const value = domainParse(firestoreTaskRevisionSchema, raw, 'invalid_package_data');
    return { value: value as unknown as Record<string, unknown>, resource: value.task };
  }
  const schemas = { care: firestoreCareSchema, profile: firestoreProfileSchema, memory_facts: firestoreFactSchema,
    memory_topics: firestoreTopicSchema, instructions: firestorePrivateInstructionSchema, summary_history: firestoreSummarySchema };
  const value = domainParse(schemas[module] as z.ZodType<{ childId: string; version: number; id?: string }>, raw, 'invalid_package_data');
  return { value: value as unknown as Record<string, unknown>, resource: value };
}
export function validateSourceHistory<T extends Pick<SourceHistoryRecord, 'evidence'>>(value: T): T {
  const { evidence } = value, source = evidence.source.current.source, original = parseRevision(evidence.module, evidence.value, source.section);
  if (firestoreDomainHash(original.value) !== evidence.source.current.sourceHash
    || (evidence.module !== source.section && !(evidence.module === 'concerns' && source.section === 'concern_events'))
    || original.resource.childId !== source.childId || original.resource.version !== source.resourceVersion
    || (evidence.module === 'profile' ? original.resource.childId : domainParse(z.uuid(), original.resource.id)) !== source.resourceId)
    domainReject('source_history_binding', 500);
  return value;
}
export function parseHistoryRow(row: HandoverImportRow, module: HistoryModule, integrity: HandoverIntegrity, actor: string) {
  const now = new Date().toISOString();
  if (module === 'documents') {
    const value = row.section === 'document_content' ? domainParse(documentTransferContentSchema, row.value, 'invalid_package_data')
      : domainParse(documentTransferVersionSchema, row.value, 'invalid_package_data');
    const provenance = makeImportProvenance({ ...row, section: module, value: { childId: row.childId, id: value.documentId, version: value.snapshotVersion,
      snapshotId: value.snapshotId, ...(value.origin ? { importedFrom: value.origin.importedFrom } : {}) } }, integrity, actor, now);
    provenance.current.sourceHash = firestoreDomainHash(row.value);
    return { evidence: { module, source: provenance, value: row.value }, provenance, parentId: value.documentId, parentVersion: value.snapshotVersion };
  }
  if (row.value.format === 'yuyoufang-source-revision:1') {
    const wrapper = domainParse(sourceHistoryExportSchema, row.value, 'invalid_package_data');
    if (wrapper.childId !== row.childId || wrapper.evidence.module !== module) domainReject('invalid_package_scope', 400);
    validateSourceHistory(wrapper);
    if (module === 'concerns' && (row.section === 'concern_events') !== (wrapper.evidence.source.current.source.section === 'concern_events'))
      domainReject('invalid_package_scope', 400);
    const provenance = makeImportProvenance({ ...row, section: module, value: { childId: row.childId, id: wrapper.resource.id,
      version: wrapper.resource.version, importedFrom: wrapper.evidence.source } }, integrity, actor, now);
    provenance.current.sourceHash = firestoreDomainHash(wrapper);
    return { evidence: wrapper.evidence, provenance, parentId: wrapper.resource.id, parentVersion: wrapper.resource.version };
  }
  if (module === 'concerns' && row.section === 'concern_events') {
    const event = domainParse(firestoreDocumentConcernEventSchema, row.value, 'invalid_package_data');
    if (event.childId !== row.childId) domainReject('invalid_package_scope', 400);
    const provenance = makeImportProvenance({ ...row, value: { ...event, version: 1, authorUserId: event.actorUserId, createdAt: event.at } }, integrity, actor, now);
    provenance.current.sourceHash = firestoreDomainHash(event);
    return { evidence: { module, source: provenance, value: event as unknown as Record<string, unknown> }, provenance,
      parentId: event.concernId, parentVersion: 1 };
  }
  const parsed = parseRevision(module, row.value), source = parsed.resource;
  const provenance = makeImportProvenance({ ...row, section: module, value: source as unknown as Record<string, unknown> }, integrity, actor, now);
  provenance.current.sourceHash = firestoreDomainHash(parsed.value);
  return { evidence: { module, source: provenance, value: parsed.value }, provenance,
    parentId: module === 'profile' ? source.childId : domainParse(z.uuid(), source.id), parentVersion: source.version };
}
export async function sourceHistoryVisible(data: FirestoreDomainData, b: Binding, value: SourceHistoryRecord) {
  if (value.childId !== b.scope.childId) domainReject('source_history_binding', 500);
  const section = value.evidence.module;
  if (section === 'concerns') {
    const current = await createFirestoreConcernStore(data.options).head(b, value.resource.id);
    return !!current && current.version >= value.resource.version;
  }
  if (section === 'visit_preparation') {
    if (value.resource.id !== b.scope.childId) return false;
    const row = await b.transaction.get(data.ref('visit_preparations', 'visit-preparation', b.scope.childId));
    if (!row.exists) return false;
    const current = data.open('visit-preparation', b.scope.childId, b.scope, firestorePreparationSchema, row);
    if (current.childId !== b.scope.childId || current.version !== row.get('recordVersion')) domainReject('preparation_binding', 500);
    return current.version >= value.resource.version;
  }
  if (section === 'private_sources') {
    if (b.sharedAccess || b.actorUserId !== b.scope.ownerUserId) return false;
    const current = await createFirestoreSharedInputStore(data.options).readImportState(b, value.resource.id);
    return current.value !== null && current.version >= value.resource.version;
  }
  if (section === 'care' || section === 'profile') return contentVisible(data, b, section, value.resource.id, value.resource.version);
  if (section === 'memory_facts' || section === 'memory_topics') {
    const kind = section === 'memory_facts' ? 'fact' : 'topic';
    if (!await contentVisible(data, b, kind, value.resource.id, value.resource.version)) return false;
    const row = await b.transaction.get(data.ref(section, 'memory-' + kind, value.resource.id));
    const current = data.open('memory-' + kind, value.resource.id, b.scope,
      z.object({ visibility: z.enum(['private', 'family']) }).passthrough(), row);
    // Sharing a current resource never widens the visibility of an older private source revision.
    return !b.sharedAccess || current.visibility === 'family' && value.evidence.value.visibility === 'family';
  }
  if (section === 'instructions') {
    if (b.sharedAccess || b.actorUserId !== b.scope.ownerUserId) return false;
    const current = await createFirestorePrivateInstructions(data).read(b, value.resource.id);
    return !!current && current.version >= value.resource.version;
  }
  if (section === 'summary_history') {
    if (b.sharedAccess || b.actorUserId !== b.scope.ownerUserId) return false;
    const row = await b.transaction.get(data.ref('conversation_summaries', 'conversation-summary', value.resource.id));
    if (!row.exists) return false;
    const current = data.open('conversation-summary', value.resource.id, b.scope, z.object({ summary: firestoreSummarySchema }).passthrough(), row).summary;
    if (current.id !== value.resource.id || current.childId !== b.scope.childId || current.version !== row.get('recordVersion')) domainReject('source_history_binding', 500);
    return current.coverageScope === 'imported_source' && row.get('currentBatch') !== true && current.version >= value.resource.version;
  }
  const row = await b.transaction.get(data.ref('tasks', 'task', value.resource.id)); if (!row.exists) return false;
  const task = data.open('task', value.resource.id, b.scope, firestoreTaskSchema, row);
  if (task.childId !== b.scope.childId || task.id !== value.resource.id || task.version !== row.get('recordVersion')) domainReject('source_history_binding', 500);
  return task.version >= value.resource.version;
}
export async function prepareSourceHistory(data: FirestoreDomainData, b: Binding, raw: SourceHistoryRecord) {
  const value = validateSourceHistory(sourceHistoryRecordSchema.parse(raw)), id = sourceHistoryId(b.scope, value);
  const ref = data.ref('handover_source_history', 'handover-source-history', id), snapshot = await b.transaction.get(ref);
  if (snapshot.exists) {
    const prior = validateSourceHistory(data.open('handover-source-history', id, b.scope, sourceHistoryRecordSchema, snapshot));
    if (sourceHistoryId(b.scope, prior) !== id || snapshot.get('recordVersion') !== 1) domainReject('source_history_binding', 500);
    return { outcome: prior.evidence.source.current.sourceHash === value.evidence.source.current.sourceHash ? 'skipped' as const : 'conflict' as const,
      reason: prior.evidence.source.current.sourceHash === value.evidence.source.current.sourceHash ? 'history_already_imported' : 'source_history_conflict' };
  }
  const sealed = data.seal('handover-source-history', id, b.scope, sourceHistoryRecordSchema, value);
  return { outcome: 'created' as const, reason: null,
    commit() { b.transaction.create(ref, { ...data.tags(b.scope), ...sourceHistoryMetadata(value), historyId: id, ...sealed }); } };
}
