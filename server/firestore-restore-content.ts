import { createHash } from 'node:crypto';
import { VectorValue } from '@google-cloud/firestore';
import { z } from 'zod';
import { KNOWLEDGE_EMBEDDING } from '../src/shared/knowledge.ts';
import { FirestoreRestoreCodecError, type FirestoreRestoreDecoded, type FirestoreRestoreDomainKind } from './firestore-restore-codec.ts';
import { firestoreTaskSchema, firestoreTaskRevisionSchema, firestoreReminderOutboxSchema, firestoreDomainHash } from './firestore-domain-data.ts';
import { firestoreTaskReminderSchema, firestoreTaskReminderBatchSchema, firestoreTaskNotificationOutboxSchema } from './firestore-task-worker.ts';
import { firestoreFamilyDocumentSchemas } from './firestore-family-documents.ts';
import { firestoreFamilyDocumentSnapshotSchemas, firestoreDocumentSnapshotSchema } from './firestore-family-document-snapshots.ts';
import { assertDocumentCapacity } from './family-document-edits.ts';
import { firestoreKnowledgeSchemas } from './firestore-knowledge.ts';
import { embeddingDocument, internalKnowledgeSource, knowledgeHash, parseKnowledgeSource, sourceVersionHash } from './knowledge-inputs.ts';
import type { WorkRecoveryScope } from './firestore-work-continuation-recovery.ts';

const NIL = '00000000-0000-0000-0000-000000000000';
function fail(code = 'restore_content_binding'): never { throw new FirestoreRestoreCodecError(code); }
function parsed<T>(schema: z.ZodType<T>, record: FirestoreRestoreDecoded): T {
  const result = schema.safeParse(record.value); if (!result.success) fail('restore_content_invalid'); return result.data;
}
function scope(record: FirestoreRestoreDecoded): WorkRecoveryScope {
  if (record.context.family === 'knowledge') fail(); return record.context.scope;
}
const sameScope = (left: WorkRecoveryScope, right: WorkRecoveryScope) => left.ownerUserId === right.ownerUserId
  && left.workspaceId === right.workspaceId && left.childId === right.childId && left.storageEpoch === right.storageEpoch;
const identity = (family: string, kind: string, id: string) => JSON.stringify([family, kind, id]);
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/** Pure whole-content validation, in addition to the codec's individual envelope/schema checks. */
export function assertFirestoreRestoreContent(records: readonly FirestoreRestoreDecoded[]): void {
  const index = new Map<string, FirestoreRestoreDecoded>(), kinds = new Map<string, FirestoreRestoreDecoded[]>();
  for (const record of records) {
    const { family, kind, id } = record.context, key = identity(family, kind, id), group = identity(family, kind, '');
    if (index.has(key)) fail('restore_content_duplicate'); index.set(key, record);
    const rows = kinds.get(group) ?? []; rows.push(record); kinds.set(group, rows);
  }
  const rows = (kind: string, family = 'domain') => kinds.get(identity(family, kind, '')) ?? [];
  function required(family: string, kind: string, id: string): FirestoreRestoreDecoded {
    const record = index.get(identity(family, kind, id)); if (!record) fail('restore_content_missing'); return record;
  }
  function domain(kind: FirestoreRestoreDomainKind, id: string, expected: WorkRecoveryScope): FirestoreRestoreDecoded {
    const record = required('domain', kind, id); if (!sameScope(scope(record), expected)) fail(); return record;
  }
  function revision(taskId: string, version: number, expected: WorkRecoveryScope) {
    const parent = parsed(firestoreTaskSchema, domain('task', taskId, expected));
    const historical = parsed(firestoreTaskRevisionSchema, domain('task-revision', JSON.stringify([taskId, version]), expected)).task;
    if (historical.id !== parent.id || historical.version !== version || version > parent.version) fail();
    return historical;
  }
  for (const record of rows('task')) {
    const current = parsed(firestoreTaskSchema, record), saved = revision(current.id, current.version, scope(record));
    if (firestoreDomainHash(current) !== firestoreDomainHash(saved)) fail();
  }
  for (const record of rows('task-revision')) {
    const saved = parsed(firestoreTaskRevisionSchema, record).task, current = parsed(firestoreTaskSchema, domain('task', saved.id, scope(record)));
    if (saved.version > current.version) fail();
  }
  for (const record of rows('task-reminder-outbox')) {
    const work = parsed(firestoreReminderOutboxSchema, record), historical = revision(work.taskId, work.taskVersion, scope(record));
    if (historical.occurrence.id !== work.occurrenceId) fail();
  }
  for (const record of rows('task-reminder')) {
    const reminder = parsed(firestoreTaskReminderSchema, record), expected = scope(record), historical = revision(reminder.taskId, reminder.taskVersion, expected);
    const batch = parsed(firestoreTaskReminderBatchSchema, domain('task-reminder-batch', reminder.batchId, { ...expected, childId: NIL }));
    const notification = parsed(firestoreTaskNotificationOutboxSchema, domain('task-notification-outbox', reminder.id, expected));
    if (historical.occurrence.id !== reminder.occurrenceId || batch.category !== historical.kind || batch.recipientUserId !== expected.ownerUserId
      || historical.kind === 'appointment' && batch.key !== reminder.occurrenceId
      || notification.reminderId !== reminder.id || notification.taskId !== reminder.taskId || notification.taskVersion !== reminder.taskVersion
      || notification.occurrenceId !== reminder.occurrenceId || notification.createdAt !== reminder.createdAt) fail();
  }
  for (const record of rows('task-notification-outbox')) {
    const notification = parsed(firestoreTaskNotificationOutboxSchema, record), expected = scope(record);
    const historical = revision(notification.taskId, notification.taskVersion, expected);
    const reminder = parsed(firestoreTaskReminderSchema, domain('task-reminder', notification.reminderId, expected));
    if (historical.occurrence.id !== notification.occurrenceId || reminder.id !== notification.id || reminder.taskId !== notification.taskId
      || reminder.taskVersion !== notification.taskVersion || reminder.occurrenceId !== notification.occurrenceId
      || reminder.createdAt !== notification.createdAt || notification.recipientUserId !== expected.ownerUserId) fail();
  }

  const snapshotChunks = new Map<string, FirestoreRestoreDecoded[]>();
  for (const record of rows('document-snapshot-chunk')) {
    const chunk = parsed(firestoreFamilyDocumentSnapshotSchemas.chunk, record);
    let parts: unknown; try { parts = JSON.parse(record.context.id); } catch { fail(); }
    if (!Array.isArray(parts) || parts.length !== 2 || typeof parts[0] !== 'string' || parts[1] !== chunk.index
      || JSON.stringify(parts) !== record.context.id) fail();
    const manifest = domain('document-snapshot', parts[0], scope(record));
    if (record.context.family === 'knowledge' || manifest.context.family === 'knowledge'
      || record.context.recordVersion !== manifest.context.recordVersion || Buffer.byteLength(chunk.text) > 48 * 1024) fail();
    const group = snapshotChunks.get(parts[0]) ?? []; group.push(record); snapshotChunks.set(parts[0], group);
  }
  function documentPointers(metadata: z.infer<typeof firestoreFamilyDocumentSchemas.metadata>, expected: WorkRecoveryScope) {
    const ids = [metadata.currentId, ...metadata.historyIds]; if (new Set(ids).size !== ids.length) fail();
    for (const id of ids) {
      const manifest = parsed(firestoreFamilyDocumentSnapshotSchemas.manifest, domain('document-snapshot', id, expected));
      if (manifest.documentId !== metadata.id || manifest.childId !== metadata.childId || manifest.snapshotVersion > metadata.version) fail();
    }
  }
  for (const record of rows('family-document')) documentPointers(parsed(firestoreFamilyDocumentSchemas.metadata, record), scope(record));
  for (const record of rows('document-operation')) {
    const operation = parsed(firestoreFamilyDocumentSchemas.operation, record), expected = { ...scope(record), childId: operation.childId };
    const current = parsed(firestoreFamilyDocumentSchemas.metadata, domain('family-document', operation.document.id, expected));
    if (operation.document.version > current.version || operation.document.childId !== current.childId || operation.document.ownerUserId !== current.ownerUserId) fail();
    documentPointers(operation.document, expected);
  }
  for (const record of rows('document-snapshot')) {
    const manifest = parsed(firestoreFamilyDocumentSnapshotSchemas.manifest, record), expected = scope(record);
    const metadata = parsed(firestoreFamilyDocumentSchemas.metadata, domain('family-document', manifest.documentId, expected));
    if (manifest.childId !== metadata.childId || manifest.snapshotVersion > metadata.version
      || record.context.family === 'knowledge' || record.context.recordVersion !== manifest.snapshotVersion) fail();
    const chunks = snapshotChunks.get(manifest.snapshotId) ?? [];
    if (chunks.length !== manifest.count) fail('restore_content_missing');
    const parts = new Map<number, string>();
    for (const chunkRecord of chunks) {
      const chunk = parsed(firestoreFamilyDocumentSnapshotSchemas.chunk, chunkRecord);
      if (chunk.index >= manifest.count || parts.has(chunk.index)) fail(); parts.set(chunk.index, chunk.text);
    }
    const serialized = Array.from({ length: manifest.count }, (_, i) => { const part = parts.get(i); if (part === undefined) fail('restore_content_missing'); return part; }).join('');
    if (Buffer.byteLength(serialized) !== manifest.totalBytes || serialized.length !== manifest.totalCharacters || sha256(serialized) !== manifest.hash) fail();
    let raw: unknown; try { raw = JSON.parse(serialized); } catch { fail('restore_content_invalid'); }
    const parsedSnapshot = firestoreDocumentSnapshotSchema.safeParse(raw); if (!parsedSnapshot.success) fail('restore_content_invalid');
    const snapshot = parsedSnapshot.data; try { assertDocumentCapacity(snapshot); } catch { fail('restore_content_invalid'); }
    if (snapshot.id !== manifest.snapshotId || snapshot.version !== manifest.snapshotVersion || snapshot.generatedAt !== manifest.generatedAt) fail();
    for (const source of snapshot.sources) {
      if (source.kind !== 'task') fail('unsupported_restore_domain');
      revision(source.resourceId, source.version, expected);
    }
  }

  type KnowledgeSource = z.infer<typeof firestoreKnowledgeSchemas.source>;
  type KnowledgeVersion = z.infer<typeof firestoreKnowledgeSchemas.version>;
  type KnowledgeChunk = z.infer<typeof firestoreKnowledgeSchemas.chunk>;
  const editions = new Map<string, { version: KnowledgeVersion; chunks: KnowledgeChunk[] }>(), claimedChunks = new Set<string>();
  const sameKnowledgeScope = (left: KnowledgeSource | KnowledgeVersion | KnowledgeChunk, right: KnowledgeSource | KnowledgeVersion | KnowledgeChunk) =>
    left.projectId === right.projectId && left.namespace === right.namespace && left.sourceId === right.sourceId;
  for (const record of rows('knowledge-version', 'knowledge')) {
    const version = parsed(firestoreKnowledgeSchemas.version, record);
    const source = parsed(firestoreKnowledgeSchemas.source, required('knowledge', 'knowledge-source', version.sourceId));
    if (!sameKnowledgeScope(source, version) || source.url !== version.header.url || version.header.sourceId !== source.sourceId
      || new Set(version.chunks.map(chunk => chunk.key)).size !== version.chunks.length) fail();
    const chunks = version.chunks.map((listed, index) => {
      const chunk = parsed(firestoreKnowledgeSchemas.chunk, required('knowledge', 'knowledge-chunk', listed.chunkId));
      if (claimedChunks.has(chunk.chunkId)) fail('restore_content_duplicate'); claimedChunks.add(chunk.chunkId);
      if (!sameKnowledgeScope(source, chunk) || chunk.versionId !== version.versionId || chunk.chunkId !== listed.chunkId || listed.order !== index + 1
        || chunk.order !== listed.order || chunk.document.key !== listed.key || chunk.contentHash !== knowledgeHash(chunk.document)
        || chunk.embeddingHash !== embeddingDocument(version.header.title, chunk.document.section, chunk.document.text).hash) fail();
      return chunk;
    });
    let document: ReturnType<typeof parseKnowledgeSource>;
    try { document = parseKnowledgeSource({ ...version.header, chunks: chunks.map(chunk => chunk.document) }); } catch { fail('restore_content_invalid'); }
    if (document.classification !== 'official_guidance' || internalKnowledgeSource(document.url) || sourceVersionHash(document) !== version.versionHash) fail();
    if (version.review?.assessment.comparedVersionId) {
      const baseline = parsed(firestoreKnowledgeSchemas.version, required('knowledge', 'knowledge-version', version.review.assessment.comparedVersionId));
      if (!sameKnowledgeScope(source, baseline) || baseline.versionHash !== version.review.assessment.comparedHash || baseline.header.url !== source.url) fail();
    }
    editions.set(version.versionId, { version, chunks });
  }
  for (const record of rows('knowledge-chunk', 'knowledge')) {
    const chunk = parsed(firestoreKnowledgeSchemas.chunk, record); if (!claimedChunks.has(chunk.chunkId)) fail('restore_content_missing');
  }
  for (const record of rows('knowledge-source', 'knowledge')) {
    const source = parsed(firestoreKnowledgeSchemas.source, record);
    const active = source.activeVersionId === null ? null : editions.get(source.activeVersionId);
    if (source.activeVersionId !== null && (!active || !sameKnowledgeScope(source, active.version) || active.version.header.url !== source.url)) fail('restore_content_missing');
    if (source.enabled && (!active || active.version.reviewState !== 'reviewed' || active.version.checkedAt === null || active.version.publishedAt === null
      || active.version.review?.assessment.decision !== 'approve' || active.version.review.assessment.growthRuleImpact === 'requires_review'
      || active.chunks.some(chunk => !(chunk.embedding instanceof VectorValue) || chunk.model !== KNOWLEDGE_EMBEDDING.model
        || chunk.dimensions !== KNOWLEDGE_EMBEDDING.dimensions || chunk.pipeline !== KNOWLEDGE_EMBEDDING.pipeline))) fail();
  }
}
