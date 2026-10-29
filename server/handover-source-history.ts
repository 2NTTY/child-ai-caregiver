import { firestoreCareSchema, firestoreProfileSchema } from './firestore-care.ts';
import { FirestoreDomainData, domainParse, domainReject, firestoreDomainHash, firestoreTaskRevisionSchema, firestoreTaskSchema } from './firestore-domain-data.ts';
import type { FirestoreAuthorityTransaction as Binding } from './firestore-authority.ts';
import type { HandoverImportRow } from './handover-import.ts';
import type { HandoverIntegrity } from '../src/shared/handover.ts';
import { makeImportProvenance } from './handover-provenance.ts';
import { contentVisible } from './firestore-disclosure.ts';
import { sourceHistoryExportSchema, sourceHistoryRecordSchema, sourceHistoryId, sourceHistoryMetadata,
  type SourceHistoryRecord, type HistoryModule } from './handover-history-records.ts';

function parseRevision(module: HistoryModule, raw: unknown) {
  if (module === 'tasks') {
    const value = domainParse(firestoreTaskRevisionSchema, raw, 'invalid_package_data');
    return { value: value as unknown as Record<string, unknown>, resource: value.task };
  }
  const value = module === 'care' ? domainParse(firestoreCareSchema, raw, 'invalid_package_data')
    : domainParse(firestoreProfileSchema, raw, 'invalid_package_data');
  return { value: value as unknown as Record<string, unknown>, resource: value };
}
export function validateSourceHistory<T extends Pick<SourceHistoryRecord, 'evidence'>>(value: T): T {
  const { evidence } = value, original = parseRevision(evidence.module, evidence.value), source = evidence.source.current.source;
  if (firestoreDomainHash(original.value) !== evidence.source.current.sourceHash || evidence.module !== source.section
    || original.resource.childId !== source.childId || original.resource.version !== source.resourceVersion
    || (evidence.module === 'profile' ? original.resource.childId : (original.resource as { id: string }).id) !== source.resourceId)
    domainReject('source_history_binding', 500);
  return value;
}
export function parseHistoryRow(row: HandoverImportRow, module: HistoryModule, integrity: HandoverIntegrity, actor: string) {
  const now = new Date().toISOString();
  if (row.value.format === 'yuyoufang-source-revision:1') {
    const wrapper = domainParse(sourceHistoryExportSchema, row.value, 'invalid_package_data');
    if (wrapper.childId !== row.childId || wrapper.evidence.module !== module) domainReject('invalid_package_scope', 400);
    validateSourceHistory(wrapper);
    const provenance = makeImportProvenance({ ...row, section: module, value: { childId: row.childId, id: wrapper.resource.id,
      version: wrapper.resource.version, importedFrom: wrapper.evidence.source } }, integrity, actor, now);
    provenance.current.sourceHash = firestoreDomainHash(wrapper);
    return { evidence: wrapper.evidence, provenance, parentId: wrapper.resource.id, parentVersion: wrapper.resource.version };
  }
  const parsed = parseRevision(module, row.value), source = parsed.resource;
  const provenance = makeImportProvenance({ ...row, section: module, value: source as unknown as Record<string, unknown> }, integrity, actor, now);
  provenance.current.sourceHash = firestoreDomainHash(parsed.value);
  return { evidence: { module, source: provenance, value: parsed.value }, provenance,
    parentId: module === 'profile' ? source.childId : (source as { id: string }).id, parentVersion: source.version };
}
export async function sourceHistoryVisible(data: FirestoreDomainData, b: Binding, value: SourceHistoryRecord) {
  if (value.childId !== b.scope.childId) domainReject('source_history_binding', 500);
  if (value.evidence.module !== 'tasks') return contentVisible(data, b, value.evidence.module, value.resource.id, value.resource.version);
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
