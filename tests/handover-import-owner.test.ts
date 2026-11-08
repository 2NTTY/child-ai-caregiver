import test from 'node:test';
import assert from 'node:assert/strict';
import { HandoverImportOwner, originalRestoreResourceSection } from '../frontend/src/production/HandoverImportOwner.ts';
import { HandoverApiError, createHandoverApi, type HandoverApi } from '../src/client/handover-api.ts';
import type { HandoverUploadView } from '../src/shared/handover-uploads.ts';
import { handoverImportTargetSchema, originalBackupModuleSchema, type HandoverImportView, type HandoverImportModule,
  type HandoverImportCommand, type OriginalBackupComparison, type OriginalBackupComparisonQuery } from '../src/shared/handover-imports.ts';
import { packageHash } from '../frontend/src/platform/package-import-hash.ts';
import { FamilyDocumentApiError } from '../src/client/family-documents-api.ts';
import { handoverSourceHistoryKey } from '../frontend/src/production/HandoverImportOwner.ts';

test('original restore maps module selections to their existing resource section',()=>{
  assert.equal(originalRestoreResourceSection('sources'),'private_sources');
  for (const module of ['care','profile','tasks'] as const) assert.equal(originalRestoreResourceSection(module),module);
  assert.equal(originalRestoreResourceSection('memory'),null);
});

test('import owner preserves unknown operations, resumes server batches and clears identity-bound files', async () => {
  const bytes = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([97])); c.enqueue(new Uint8Array([98, 99])); c.close(); } });
  assert.equal(await packageHash(bytes, 3, new AbortController().signal), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  await assert.rejects(packageHash(new Blob(['abc']).stream(), 2, new AbortController().signal), /invalid_package_file/);
  const id = '00000000-0000-4000-8000-000000000001', target = '00000000-0000-4000-8000-000000000002';
  let upload!: HandoverUploadView;
  let batch: HandoverImportView, writes = 0, contentWrites = 0, released = 0;
  const api = { setIdentity() {}, async reserveUpload(_u: string, c: any) {
    upload = { id: c.opId, version: 1, filename: c.filename, bytes: c.bytes, state: 'reserved', error: null, preview: null,
      createdAt: '2026-10-29T00:00:00Z', expiresAt: '2026-10-30T00:00:00Z' }; return upload;
  }, async uploadContent() { contentWrites++; upload = { ...upload, state: 'ready', version: 2,
    preview: { manifestSha256: 'a'.repeat(64), integrity: 'missing_proof', children: [{ id, displayName: 'Source' }], coverage: [] } as any }; return upload;
  }, async getUpload() { return upload; }, async createImport(_u: string, c: any) {
    writes++; batch = { id: c.opId, version: 1, uploadId: c.uploadId, targets: c.targets, packageId: id, packageVersion: 1,
      manifestSha256: 'a'.repeat(64), integrity: 'missing_proof', state: 'queued', totalItems: 1, processedItems: 0,
      counts: { created: 0, updated: 0, skipped: 0, conflict: 0 }, error: null, createdAt: upload.createdAt, updatedAt: upload.createdAt };
    throw new HandoverApiError();
  }, async getImport() { return batch; }, async listImports() { return { items: batch ? [batch] : [], nextCursor: null }; },
  } as unknown as HandoverApi;
  const owner = new HandoverImportOwner(api); owner.syncContext('alice', 'session-a', true);
  const picker = async () => ({ filename: 'care.zip', bytes: 3, sha256: 'b'.repeat(64), body: new Blob(['zip']), release: () => { released++; } });
  await owner.choose(picker); assert.equal(contentWrites, 1); assert.equal(released, 1);
  const targets = [{ sourceChildId: id, target: { childId: target, spaceId: null }, sections: ['care' as const] }];
  await owner.create(targets, false); assert.equal(writes, 0, 'missing proof must be acknowledged');
  await owner.create(targets, true); assert.equal(writes, 1); assert.equal(owner.getSnapshot().pending?.kind, 'create');
  await owner.retryOriginal(); assert.equal(writes, 1, 'unknown requests must be checked first');
  await owner.checkOriginal(); assert.equal(owner.getSnapshot().pending, null); assert.equal(writes, 1);
  assert.equal(owner.getSnapshot().items[0].id, batch!.id);
  const reopened = new HandoverImportOwner(api); reopened.syncContext('alice', 'session-b', true);
  await reopened.load(); assert.equal(reopened.getSnapshot().items[0].id, batch!.id);
  let late!: (v: HandoverImportView) => void; api.getImport = () => new Promise(resolve => { late = resolve; });
  const reading = reopened.refresh(batch!.id); reopened.syncContext('bob', 'session-c', true); late(batch!); await reading;
  assert.deepEqual(reopened.getSnapshot().items, []);
  api.uploadContent = async () => { contentWrites++; throw new HandoverApiError(); };
  owner.syncContext('alice', 'session-new', true); await owner.choose(picker);
  assert.equal(owner.getSnapshot().pending?.kind, 'upload'); assert.equal(released, 1, 'unknown upload retains local body for original retry');
  await owner.checkOriginal(); assert.equal(owner.getSnapshot().pending?.checked, true);
  owner.syncContext(null, null, false); assert.equal(released, 2); assert.equal(owner.getSnapshot().upload, null);
  owner.syncContext('alice', 'session-failed', true);
  api.uploadContent = async () => { upload = { ...upload, state: 'failed', version: 2, error: 'package_integrity_failed' }; throw new HandoverApiError(400, 'package_integrity_failed'); };
  await owner.choose(picker);
  assert.equal(owner.getSnapshot().pending?.kind, 'upload', 'failed validation must retain its original lookup');
  await owner.checkOriginal(); assert.equal(owner.getSnapshot().upload?.version, 2); assert.equal(released, 3);
  api.cancelUpload = async (_u, _id, command) => { assert.equal(command.expectedVersion, 2); return { ...upload, state: 'cancelled', version: 3 }; };
  await owner.discard(); assert.equal(owner.getSnapshot().upload, null);

  const originalBatch = { ...batch!, targets: [{ ...targets[0], sections: ['care' as const, 'profile' as const] }], state: 'completed' as const, version: 4, processedItems: 1,
    counts: { created: 0, updated: 0, skipped: 0, conflict: 1 } };
  const resultId = '00000000-0000-4000-8000-000000000005';
  const result = { id: resultId, batchId: originalBatch.id, sourceChildId: id, module: 'care' as const,
    sourceResourceId: id, sourceVersion: 3, sourceSection: null, at: originalBatch.updatedAt, outcome: 'conflict' as const,
    reason: 'target_changed', recordedResource: { id: target, version: 1 }, currentResource: { id: target, version: 7, deleted: false },
    availableResolution: 'replace_current' as const };
  let resultRead!: (value: any) => void;
  api.getImport = async () => originalBatch; await owner.refresh(originalBatch.id);
  owner.selectResults(originalBatch.id, id, 'care');
  api.importResults = () => new Promise(resolve => { resultRead = resolve; });
  const oldScope = owner.readResults(); owner.selectResults(originalBatch.id, id, 'profile');
  resultRead({ batchId: originalBatch.id, sourceChildId: id, module: 'care', items: [result], nextCursor: null, complete: true }); await oldScope;
  assert.equal(owner.getSnapshot().results?.module, 'profile'); assert.deepEqual(owner.getSnapshot().results?.items, []);
  owner.selectResults(originalBatch.id, id, 'care');
  api.importResults = async (_u, batchId, query) => ({ batchId, sourceChildId: query.sourceChildId, module: query.module,
    items: [result], nextCursor: query.cursor ? null : 'page-2', complete: !!query.cursor });
  await owner.readResults(); await owner.readResults(true);
  assert.equal(owner.getSnapshot().results?.items.length, 1, 'appending pages does not duplicate a receipt');
  upload = { ...upload, state: 'ready', version: 5, preview: { ...upload.preview!, manifestSha256: originalBatch.manifestSha256,
    header: { packageId: originalBatch.packageId, packageVersion: originalBatch.packageVersion } } as any };
  let decided: any, originalLookups: string[] = [];
  api.createImport = async (_u, command) => {
    writes++; decided = command; batch = { ...originalBatch, id: command.opId, state: 'queued',
      targets: command.targets.map(row => handoverImportTargetSchema.parse(row)) };
    throw new HandoverApiError();
  };
  api.getImport = async (_u, batchId) => { originalLookups.push(batchId); return batchId === originalBatch.id ? originalBatch : batch; };
  await owner.resolveResults('replace_current', [resultId]);
  assert.notEqual(decided.opId, originalBatch.id); assert.deepEqual(decided.targets, originalBatch.targets);
  assert.equal(decided.resolutionOnly, true, 'a resolution batch must not import unselected rows from the original targets');
  assert.equal(decided.expectedUploadVersion, 5); assert.equal(decided.acceptedManifestSha256, originalBatch.manifestSha256);
  assert.deepEqual(decided.resolutions, [{ sourceChildId: id, section: 'care', resourceId: id,
    resolution: { mode: 'replace_current', targetId: target, expectedVersion: 7 } }]);
  const decidedWrites = writes; await owner.retryOriginal(); assert.equal(writes, decidedWrites, 'unknown resolution is not resubmitted');
  await owner.checkOriginal(); assert.equal(originalLookups.at(-1), decided.opId); assert.equal(writes, decidedWrites);
  const memoryBatch = { ...originalBatch, id: '00000000-0000-4000-8000-000000000006', targets: [{ ...targets[0], sections: ['memory' as const] }] };
  const memoryResult = { ...result, id: '00000000-0000-4000-8000-000000000007', batchId: memoryBatch.id,
    module: 'memory' as const, resourceSection: 'memory_topics' as const, currentResource: { id: target, version: 9, deleted: false } };
  const ambiguous = { ...memoryResult, id: '00000000-0000-4000-8000-000000000008', resourceSection: undefined };
  const summaryResult = { ...memoryResult, id: '00000000-0000-4000-8000-000000000009', resourceSection: 'summary_history' as const,
    sourceResourceId: '00000000-0000-4000-8000-000000000010', reason: 'target_deleted', currentResource: { id: target, version: 0, deleted: true },
    availableResolution: 'restore_deleted' as const };
  api.getImport = async (_u, batchId) => batchId === memoryBatch.id ? memoryBatch : batchId === originalBatch.id ? originalBatch : batch;
  await owner.refresh(memoryBatch.id); owner.selectResults(memoryBatch.id, id, 'memory');
  api.importResults = async () => ({ batchId: memoryBatch.id, sourceChildId: id, module: 'memory', items: [memoryResult, ambiguous, summaryResult], nextCursor: null, complete: true });
  await owner.readResults();
  await owner.resolveResults('replace_current', [ambiguous.id]); assert.equal(writes, decidedWrites, 'memory cannot infer its resource section');
  await owner.resolveResults('replace_current', [memoryResult.id]); assert.equal(writes, decidedWrites + 1);
  assert.equal(decided.resolutionOnly, true); assert.deepEqual(decided.targets, memoryBatch.targets);
  assert.deepEqual(decided.resolutions, [{ sourceChildId: id, section: 'memory_topics', resourceId: id,
    resolution: { mode: 'replace_current', targetId: target, expectedVersion: 9 } }]);
  await owner.checkOriginal();
  owner.selectResults(memoryBatch.id, id, 'memory'); await owner.readResults();
  await owner.resolveResults('restore_deleted', [summaryResult.id]); assert.equal(writes, decidedWrites + 2);
  assert.equal(decided.resolutionOnly, true); assert.deepEqual(decided.targets, memoryBatch.targets);
  assert.deepEqual(decided.resolutions, [{ sourceChildId: id, section: 'summary_history', resourceId: summaryResult.sourceResourceId,
    resolution: { mode: 'restore_deleted', targetId: target, expectedVersion: 0 } }], 'only the selected summary follows the Server resolution and exact version');
  await owner.checkOriginal();
  owner.selectResults(originalBatch.id, id, 'care');
  api.importResults = () => new Promise(resolve => { resultRead = resolve; });
  let capabilityReply!: (value: { classEnrolment: boolean }) => void;
  api.importCapabilities = () => new Promise(resolve => { capabilityReply = resolve; });
  const lateCapability = owner.readImportCapabilities(), lateResults = owner.readResults();
  owner.syncContext('bob', 'results-other-session', true);
  capabilityReply({ classEnrolment: true }); await lateCapability;
  assert.equal(owner.getSnapshot().classEnrolmentEnabled, false, 'a previous login cannot enable enrolment');
  resultRead({ batchId: originalBatch.id, sourceChildId: id, module: 'care', items: [result], nextCursor: null, complete: true }); await lateResults;
  assert.equal(owner.getSnapshot().results, null, 'late results do not enter another identity');
});

test('source history stays bound to its result target and clears on selection, identity and permission changes', async () => {
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const batch = { id: uuid(1), targets: [{ sourceChildId: uuid(2), target: { childId: uuid(3), spaceId: uuid(4) }, sections: ['memory'] }] } as HandoverImportView;
  const row = (n: number) => ({ id: uuid(n), batchId: batch.id, sourceChildId: uuid(2), module: 'memory', resourceSection: 'memory_topics',
    recordedResource: { id: uuid(n + 10), version: 1 }, sourceSection: null });
  const evidence = (resource: string, version = 1) => ({ format: 'yuyoufang-source-revision:1', childId: uuid(3), resource: { id: resource, version: 1 },
    evidence: { module: 'memory_topics', source: { current: { source: { serverId: 'https://source.test', accountId: 'external', childId: uuid(2),
      section: 'memory_topics', resourceId: uuid(20), resourceVersion: version } } }, value: { title: 'Foreign topic', note: 'Original content' } } });
  const page = (resource: string, version = 1, nextCursor: string | null = null) => ({ items: [evidence(resource, version)], nextCursor, complete: nextCursor === null });
  const queries: any[] = [];
  const api = { setIdentity() {}, async listImports() { return { items: [batch], nextCursor: null }; },
    async importResults(_u: string, _batch: string, query: { cursor?: string }) { return { batchId: batch.id, sourceChildId: uuid(2), module: 'memory', items: [row(5), row(6)], nextCursor: query.cursor ? null : 'results-next', complete: !!query.cursor }; },
    async sourceHistory(_u: string, query: any) { queries.push(query); return query.cursor ? { ...page(query.resourceId, 2), items: [evidence(query.resourceId), evidence(query.resourceId, 2)] } : page(query.resourceId, 1, 'next'); },
  } as unknown as HandoverApi;
  const owner = new HandoverImportOwner(api); owner.syncContext('alice', 'history-a', true); await owner.load();
  owner.selectResults(batch.id, uuid(2), 'memory'); await owner.readResults();
  await owner.openSourceHistory(uuid(5));
  assert.deepEqual(queries[0], { childId: uuid(3), spaceId: uuid(4), module: 'memory_topics', resourceId: uuid(15) });
  assert.equal(owner.getSnapshot().sourceHistory?.page, 1); assert.equal(owner.getSnapshot().sourceHistory?.complete, false);
  await owner.readSourceHistory(true); assert.equal(owner.getSnapshot().sourceHistory?.items.length, 2); assert.equal(owner.getSnapshot().sourceHistory?.page, 2);
  let late!: (value: any) => void;
  api.sourceHistory = () => new Promise(resolve => { late = resolve; });
  const interruptedHistory = owner.readSourceHistory(); assert.equal(owner.getSnapshot().sourceHistory?.loading, true);
  await owner.readResults(true); assert.equal(owner.getSnapshot().sourceHistory?.loading, false, 'appending results stops an interrupted history loading state');
  late(page(uuid(15))); await interruptedHistory; assert.equal(owner.getSnapshot().sourceHistory?.loading, false);
  api.sourceHistory = async () => { throw new HandoverApiError(409, 'source_history_scope_changed'); };
  await owner.readSourceHistory(); assert.deepEqual(owner.getSnapshot().sourceHistory?.items, []); assert.ok(owner.getSnapshot().sourceHistory?.error);
  api.sourceHistory = async (_u, query) => query.resourceId === uuid(15) ? new Promise(resolve => { late = resolve; }) : page(query.resourceId) as any;
  const oldResult = owner.openSourceHistory(uuid(5)); await owner.openSourceHistory(uuid(6));
  late(page(uuid(15))); await oldResult; assert.equal(owner.getSnapshot().sourceHistory?.resultId, uuid(6));
  api.sourceHistory = () => new Promise(resolve => { late = resolve; });
  const oldScope = owner.readSourceHistory(); owner.selectResults(batch.id, uuid(2), 'memory');
  assert.equal(owner.getSnapshot().sourceHistory, null); late(page(uuid(16))); await oldScope;
  await owner.readResults(); const oldIdentity = owner.openSourceHistory(uuid(5));
  owner.syncContext('bob', 'history-b', true); late(page(uuid(15))); await oldIdentity;
  assert.equal(owner.getSnapshot().sourceHistory, null);
  owner.syncContext('alice', 'history-c', true); await owner.load(); owner.selectResults(batch.id, uuid(2), 'memory'); await owner.readResults();
  api.sourceHistory = async () => { throw new HandoverApiError(403, 'forbidden'); };
  await owner.openSourceHistory(uuid(5)); assert.equal(owner.getSnapshot().sourceHistory, null); assert.equal(owner.getSnapshot().results, null);
  let sourceBatch = { ...batch, id: uuid(30), targets: [{ sourceChildId: uuid(2), target: { childId: uuid(3), spaceId: null as string | null }, sections: ['sources' as const] }] };
  const sourceRow = { ...row(7), batchId: sourceBatch.id, module: 'sources' as const, resourceSection: 'private_sources' as const };
  const originalEvidence = evidence(uuid(17), 2);
  const sourceEvidence = { ...originalEvidence, evidence: { ...originalEvidence.evidence, module: 'private_sources',
    source: { current: { source: { ...originalEvidence.evidence.source.current.source, section: 'private_sources' } } },
    value: { inputId: uuid(20), childId: uuid(2), ownerUserId: 'external', version: 2, previousVersion: 1,
      changedAt: '2026-10-30T00:00:00Z', reason: 'Original change', previousManagement: null,
      management: { intention: 'Original use', purpose: 'answer_reference', nature: 'external_material', timeScope: 'recent', validityText: '', enabled: true, modelExcerpt: 'Private original excerpt' } } } };
  const sourcePage = { items: [sourceEvidence], nextCursor: null, complete: true } as any;
  api.listImports = async () => ({ items: [sourceBatch], nextCursor: null });
  api.importResults = async () => ({ batchId: sourceBatch.id, sourceChildId: uuid(2), module: 'sources', items: [sourceRow], nextCursor: null, complete: true } as any);
  api.sourceHistory = async (_u, query) => { queries.push(query); return sourcePage; };
  owner.syncContext('alice', 'private-history', true); await owner.load(); owner.selectResults(sourceBatch.id, uuid(2), 'sources'); await owner.readResults();
  await owner.openSourceHistory(sourceRow.id);
  assert.deepEqual(queries.at(-1), { childId: uuid(3), spaceId: null, module: 'private_sources', resourceId: uuid(17) });
  assert.deepEqual(owner.getSnapshot().sourceHistory?.items, [sourceEvidence]);
  api.sourceHistory = () => new Promise(resolve => { late = resolve; });
  const privateLate = owner.readSourceHistory(); owner.syncContext('bob', 'private-history-other', true); late(sourcePage); await privateLate;
  assert.equal(owner.getSnapshot().sourceHistory, null, 'late private management history cannot enter another identity');
  sourceBatch = { ...sourceBatch, targets: [{ ...sourceBatch.targets[0], target: { childId: uuid(3), spaceId: uuid(4) } }] };
  api.sourceHistory = async (_u, query) => { queries.push(query); return sourcePage; };
  owner.syncContext('alice', 'shared-history', true); await owner.load(); owner.selectResults(sourceBatch.id, uuid(2), 'sources'); await owner.readResults();
  const beforeShared = queries.length; await owner.openSourceHistory(sourceRow.id);
  assert.equal(queries.length, beforeShared, 'private management history never uses a shared target');
});

test('document import owner binds resource decisions and one paged source body to current authority and selection', async () => {
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const batch = { id: uuid(1), version: 1, state: 'completed', uploadId: uuid(2), packageId: uuid(3), packageVersion: 1, manifestSha256: 'a'.repeat(64), integrity: 'trusted',
    targets: [{ sourceChildId: uuid(4), target: { childId: uuid(5), spaceId: uuid(6) }, sections: ['documents'] }] } as HandoverImportView;
  const rows = ['documents', 'visit_preparation'].map((resourceSection, i) => ({ id: uuid(10 + i), batchId: batch.id, sourceChildId: uuid(4), module: 'documents', resourceSection,
    sourceResourceId: uuid(20 + i), sourceVersion: 4, sourceSection: null, outcome: 'conflict', reason: 'target_changed', recordedResource: { id: uuid(30 + i), version: 1 },
    currentResource: { id: uuid(30 + i), version: 9 + i, deleted: false }, availableResolution: 'replace_current' }));
  const history = [40, 41].map(n => ({ childId: uuid(5), resource: { id: uuid(30), version: 1 }, evidence: { module: 'documents',
    source: { current: { source: { serverId: 'https://foreign.test', accountId: 'foreign', childId: uuid(4), resourceId: uuid(20), resourceVersion: 4 } } },
    value: { documentId: uuid(30), snapshotId: uuid(n), snapshotVersion: 1, generatedAt: '2026-10-30T00:00:00Z', invalidated: false } } }));
  let decided: any, mode = 'normal', late!: (value: any) => void;
  const calls: any[] = [];
  const api = { setIdentity() {}, async listImports() { return { items: [batch], nextCursor: null }; }, async getImport() { return batch; },
    async getUpload() { return { id: batch.uploadId, state: 'ready', version: 2, preview: { manifestSha256: batch.manifestSha256, header: { packageId: batch.packageId, packageVersion: 1 } } }; },
    async createImport(_user: string, command: any) { decided = command; return { ...batch, id: command.opId, state: 'queued' }; },
    async importResults() { return { batchId: batch.id, sourceChildId: uuid(4), module: 'documents', items: rows, nextCursor: null, complete: true }; },
    async sourceHistory(_user: string, query: any) { return { items: query.module === 'documents' ? history : [], nextCursor: null, complete: true }; },
  } as unknown as HandoverApi;
  const snapshot = (id: string) => ({ id, version: 1, generatedAt: '2026-10-30T00:00:00Z', sourceBasis: 'b'.repeat(64), title: 'Original title', summary: 'Source text '.repeat(500),
    ageLabel: '', period: { from: '2026-10-01', to: '2026-10-31' }, eventDate: null, coverageNote: '', sections: [], sources: [], changes: [] });
  const page = (query: any, changed = false, invalidated = false) => { const value = JSON.stringify(snapshot(query.snapshotId)), end = Math.min(value.length, query.offset + 4000);
    return { documentId: uuid(30), documentVersion: 15, authorityVersion: changed ? 'changed' : 'current-authority', snapshotId: query.snapshotId, snapshotVersion: 1,
      offset: query.offset, text: value.slice(query.offset, end), totalCharacters: value.length, nextOffset: end === value.length ? null : end, complete: end === value.length,
      invalidated, contentKind: invalidated ? 'redacted_manifest_json' : 'snapshot_json' }; };
  const owner = new HandoverImportOwner(api, () => {}, async (user, target, id, query, signal) => {
    calls.push({ user, target, id, query, signal });
    if (mode === 'held') return new Promise(resolve => { late = resolve; });
    if (mode === 'forbidden') throw new FamilyDocumentApiError(403, 'forbidden');
    return page(query, mode === 'changed', mode === 'invalidated') as any;
  });
  const select = async () => { await owner.load(); owner.selectResults(batch.id, uuid(4), 'documents'); await owner.readResults(); await owner.openSourceHistory(rows[0].id); };
  owner.syncContext('alice', 'documents-a', true); await select();
  assert.equal(owner.getSnapshot().sourceHistory?.items.length, 2);
  const keys = owner.getSnapshot().sourceHistory!.items.map(handoverSourceHistoryKey); assert.notEqual(keys[0], keys[1], 'distinct snapshots of one source version have separate keys');
  await owner.resolveResults('replace_current', rows.map(row => row.id));
  assert.equal(decided.resolutionOnly, true); assert.deepEqual(decided.resolutions.map((item: any) => [item.section, item.resolution.expectedVersion]), [['documents', 9], ['visit_preparation', 10]]);
  await select(); await owner.openDocumentContent(keys[0]);
  assert.equal(calls.length, 1); assert.deepEqual(calls[0].target, batch.targets[0].target); assert.equal(calls[0].id, uuid(30));
  assert.deepEqual(calls[0].query, { snapshotId: uuid(40), snapshotVersion: 1, offset: 0 });
  assert.equal(owner.getSnapshot().sourceHistory?.documentContent?.documentVersion, 15, 'current document version is independent of import binding version');
  assert.equal(owner.getSnapshot().sourceHistory?.documentContent?.snapshot, null); assert.equal(owner.getSnapshot().sourceHistory?.documentContent?.complete, false);
  await owner.readDocumentContent(); assert.equal(calls[1].query.offset, 4000);
  assert.deepEqual(owner.getSnapshot().sourceHistory?.documentContent?.snapshot, snapshot(uuid(40))); assert.equal(owner.getSnapshot().sourceHistory?.documentContent?.text, '');
  mode = 'held'; const closed = owner.openDocumentContent(keys[1]); owner.closeSourceHistory(); assert.equal(calls.at(-1).signal.aborted, true);
  late(page({ snapshotId: uuid(41), offset: 0 })); await closed; assert.equal(owner.getSnapshot().sourceHistory, null);
  await select(); const switched = owner.openDocumentContent(keys[0]); owner.selectResults(batch.id, uuid(4), 'documents');
  late(page({ snapshotId: uuid(40), offset: 0 })); await switched; assert.equal(owner.getSnapshot().sourceHistory, null, 'switching results clears the only body buffer');
  mode = 'normal'; await select(); await owner.openDocumentContent(keys[0]); mode = 'changed'; await owner.readDocumentContent();
  assert.equal(owner.getSnapshot().sourceHistory?.documentContent?.text, ''); assert.equal(owner.getSnapshot().sourceHistory?.documentContent?.snapshot, null);
  assert.ok(owner.getSnapshot().sourceHistory?.documentContent?.error);
  mode = 'normal'; await owner.openDocumentContent(keys[0]); mode = 'invalidated'; await owner.readDocumentContent();
  assert.equal(owner.getSnapshot().sourceHistory?.documentContent?.invalidated, true); assert.equal(owner.getSnapshot().sourceHistory?.documentContent?.text, '');
  history[1].evidence.value.invalidated = true; const beforeInvalidated = calls.length; await owner.openDocumentContent(keys[1]);
  assert.equal(calls.length, beforeInvalidated, 'invalidated metadata never starts a content read'); history[1].evidence.value.invalidated = false;
  mode = 'forbidden'; await owner.openDocumentContent(keys[1]); assert.equal(owner.getSnapshot().sourceHistory, null); assert.equal(owner.getSnapshot().results, null);
  mode = 'normal'; await select(); mode = 'held'; const identity = owner.openDocumentContent(keys[0]); owner.syncContext('bob', 'documents-b', true);
  late(page({ snapshotId: uuid(40), offset: 0 })); await identity; assert.equal(owner.getSnapshot().sourceHistory, null);
});

test('reopened import owner discovers staged packages without resending contents and rejects late identity results', async () => {
  const row: HandoverUploadView = { id: '00000000-0000-4000-8000-000000000003', version: 3,
    filename: 'backup.zip', bytes: 3, state: 'ready', error: null,
    createdAt: '2026-10-29T00:00:00Z', expiresAt: '2026-10-30T00:00:00Z',
    preview: { manifestSha256: 'a'.repeat(64), integrity: 'missing_proof', children: [], coverage: [] } as any };
  const { preview, ...summary } = row;
  let writes = 0;
  const api = { setIdentity() {}, async listUploads() { return { items: [summary], nextCursor: null }; },
    async getUpload() { return row; }, async uploadContent() { writes++; return row; },
    async cancelUpload(_user: string, id: string, command: {expectedVersion: number}) {
      assert.equal(id, row.id); assert.equal(command.expectedVersion, 3);
      return { ...row, version: 4, state: 'cancelled' as const, preview: null };
    } } as unknown as HandoverApi;
  const owner = new HandoverImportOwner(api); owner.syncContext('alice', 'session-a', true);
  await owner.loadUploads(); assert.equal(owner.getSnapshot().uploads[0].id, row.id);
  assert.equal('preview' in owner.getSnapshot().uploads[0], false);
  assert.equal(owner.getSnapshot().upload, null, 'discovery alone must not choose or upload');
  await owner.openUpload(row.id); assert.deepEqual(owner.getSnapshot().upload?.preview, preview);
  assert.equal(owner.getSnapshot().pending, null); assert.equal(writes, 0);
  api.getUpload = async () => { throw new HandoverApiError(404, 'package_upload_not_found'); };
  await owner.openUpload('00000000-0000-4000-8000-000000000004');
  assert.equal(owner.getSnapshot().upload, null, 'failed selection of B cannot leave A available for import');
  api.getUpload = async () => row; await owner.openUpload(row.id);
  await owner.discard(); assert.equal(owner.getSnapshot().upload, null);
  assert.equal(owner.getSnapshot().uploads[0].state, 'cancelled');
  api.getUpload = async () => ({ ...row, state: 'reserved', preview: null });
  await owner.openUpload(row.id); assert.equal(owner.getSnapshot().pending, null, 'lost local body cannot be silently re-uploaded');
  owner.leaveUpload(); assert.equal(owner.getSnapshot().upload, null); assert.equal(writes, 0);
  let late!: (value: Awaited<ReturnType<HandoverApi['listUploads']>>) => void;
  api.listUploads = () => new Promise(resolve => { late = resolve; });
  const reading = owner.loadUploads(); owner.syncContext('bob', 'session-b', true);
  late({ items: [summary], nextCursor: null }); await reading;
  assert.deepEqual(owner.getSnapshot().uploads, []); assert.equal(owner.getSnapshot().upload, null);
});

function inspectionUpload(uploadId: string, childId: string, modules: HandoverImportModule[]): HandoverUploadView {
  const at='2026-11-05T00:00:00Z';
  return {id:uploadId,version:3,state:'ready',filename:'backup.zip',bytes:3,createdAt:at,expiresAt:'2026-11-06T00:00:00Z',error:null,
    preview:{manifestSha256:'a'.repeat(64),integrity:'trusted',coverage:[],header:{format:'yuyoufang-data',version:1,packageId:uploadId,
      packageVersion:1,createdAt:at,purpose:'backup',source:{serverId:'https://app.example.test',accountId:'owner'},
      selection:{childIds:[childId],modules,period:null}},children:[{id:childId,displayName:'Original'}]}};
}
function inspectionBatch(id: string, uploadId: string): HandoverImportView {
  const at='2026-11-05T00:00:00Z';
  return {id,uploadId,version:1,packageId:uploadId,packageVersion:1,manifestSha256:'a'.repeat(64),integrity:'trusted',state:'completed',
    targets:[],createdAt:at,updatedAt:at,totalItems:4,processedItems:4,counts:{created:0,updated:0,skipped:0,conflict:0},error:null};
}

test('backup inspection stays read-only, paged and bound to its upload and identity', async () => {
  const childId='00000000-0000-4000-8000-000000000101',uploadId='00000000-0000-4000-8000-000000000102',batchId='00000000-0000-4000-8000-000000000103';
  const batch=inspectionBatch(batchId,uploadId), upload=inspectionUpload(uploadId,childId,['care','tasks']);
  batch.counts.created=99;
  let resolveLate!: (value: OriginalBackupComparison) => void,reads=0;
  const api: Partial<HandoverApi>={setIdentity(){},listImports:async()=>({items:[batch],nextCursor:null}),getUpload:async()=>upload,
    importSummary:async()=>({batchId,state:'completed',processedItems:4,totalItems:4,modules:[{module:'care',created:2,updated:0,skipped:0,conflict:0}]}),
    compareOriginal:async(_user,query)=>{reads++;return {uploadId,manifestSha256:'a'.repeat(64),childId,module:query.module,items:[{id:childId,backupVersion:1,localVersion:2,state:'local_newer',changedFields:['text']}],nextCursor:query.cursor?null:'next'};}};
  const owner=new HandoverImportOwner(api as unknown as HandoverApi);owner.syncContext('owner','identity',true);await owner.load();await owner.openUpload(uploadId);
  await owner.readSummary(batchId);assert.equal(owner.getSnapshot().summary?.value?.modules?.[0].created,2);
  api.importSummary=async()=>({batchId,state:'completed',processedItems:4,totalItems:4,modules:null});
  await owner.readSummary(batchId);assert.equal(owner.getSnapshot().summary?.status,'ready');assert.equal(owner.getSnapshot().summary?.value?.modules,null);
  api.importSummary=async()=>{throw new HandoverApiError(403,'forbidden');};await owner.readSummary(batchId);
  assert.equal(owner.getSnapshot().summary?.status,'unauthorized');assert.equal(owner.getSnapshot().items.length,1);
  api.importSummary=async()=>{throw new HandoverApiError(503);};await owner.readSummary(batchId);assert.equal(owner.getSnapshot().summary?.status,'unavailable');
  assert.equal(reads,0,'Opening a backup cannot scan it automatically');
  await owner.compareOriginal(childId,'care');assert.equal(reads,1);assert.equal(owner.getSnapshot().comparison?.nextCursor,'next');
  await owner.compareOriginal(childId,'care',true);assert.equal(reads,2);assert.equal(owner.getSnapshot().comparison?.nextCursor,null);
  api.compareOriginal=()=>new Promise(resolve=>{resolveLate=resolve;});const late=owner.compareOriginal(childId,'tasks');
  owner.clearComparison();resolveLate({uploadId,manifestSha256:'a'.repeat(64),childId,module:'tasks',items:[],nextCursor:null});await late;
  assert.equal(owner.getSnapshot().comparison,null);assert.equal(owner.getSnapshot().busy,null);
  const identityLate=owner.compareOriginal(childId,'care');owner.syncContext('other','next-identity',true);
  resolveLate({uploadId,manifestSha256:'a'.repeat(64),childId,module:'care',items:[],nextCursor:null});await identityLate;
  assert.equal(owner.getSnapshot().comparison,null);assert.equal(owner.getSnapshot().summary,null);
});

test('handover inspection client checks the real endpoints and rejects mismatched comparison metadata',async()=>{
  const id='00000000-0000-4000-8000-000000000111',childId='00000000-0000-4000-8000-000000000112';
  const calls: [Parameters<typeof fetch>[0],RequestInit | undefined][]=[];
  let mismatch=false;
  const api=createHandoverApi('https://app.example.test',async(url,init)=>{
    calls.push([url,init]);return Response.json(String(url).endsWith('/summary')?{batchId:id,state:'completed',processedItems:4,totalItems:4,modules:null}
      :{uploadId:id,manifestSha256:'a'.repeat(64),childId:mismatch?id:childId,module:'care',items:[],nextCursor:null});});
  api.setIdentity('owner');const signal=new AbortController().signal;
  assert.equal((await api.importSummary('owner',id,signal)).modules,null);
  assert.equal(calls[0][0],`https://app.example.test/api/account/package-imports/${id}/summary`);assert.equal(calls[0][1]?.method,'GET');
  const query: OriginalBackupComparisonQuery={uploadId:id,expectedUploadVersion:3,childId,module:'care'};
  await api.compareOriginal('owner',query,signal);assert.equal(calls[1][0],'https://app.example.test/api/account/package-imports/compare-original');
  assert.equal(calls[1][1]?.method,'POST');const body=calls[1][1]?.body;assert.ok(typeof body==='string');assert.deepEqual(JSON.parse(body),query);
  mismatch=true;await assert.rejects(api.compareOriginal('owner',query,signal),{code:'handover_response_invalid'});
});

test('original restore submits only selected observed targets with one retained operation and never retries as a copy',async()=>{
  const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const exercised: readonly HandoverImportModule[]=['care','sources'];
  for (const module of originalBackupModuleSchema.options.filter(value=>exercised.includes(value))) {
  const section=module==='care'?'care':'private_sources';
  const upload=inspectionUpload(id(1),id(2),[module]);
  const pageRows: OriginalBackupComparison['items']=[{id:id(3),targetId:id(13),backupVersion:1,localVersion:4,state:'local_newer',changedFields:['text']},
    {id:id(4),targetId:id(14),backupVersion:2,localVersion:5,state:'deleted',changedFields:[]},
    {id:id(5),backupVersion:1,localVersion:4,state:'different',changedFields:['text']}];
  const sent:HandoverImportCommand[]=[],queries:OriginalBackupComparisonQuery[]=[];let committed!:HandoverImportView;
  const api:Partial<HandoverApi>={setIdentity(){},getUpload:async()=>upload,compareOriginal:async(_u,query)=>{queries.push(query);return {uploadId:id(1),childId:id(2),module,manifestSha256:'a'.repeat(64),items:query.cursor?[{...pageRows[0],id:id(6),targetId:id(16),state:'backup_newer'}]:pageRows,nextCursor:query.cursor?null:'next'};},
    createImport:async(_u,command)=>{sent.push(command);committed={...inspectionBatch(command.opId,id(1)),state:'queued',targets:command.targets.map(target=>handoverImportTargetSchema.parse(target))};throw new HandoverApiError();},getImport:async()=>committed};
  const owner=new HandoverImportOwner(api as unknown as HandoverApi);owner.syncContext('owner','owner:1',true);await owner.openUpload(id(1));
  await owner.compareOriginal(id(2),module);assert.equal(queries[0].includeRestoreTarget,true);assert.deepEqual(owner.getSnapshot().comparison?.selected,[]);
  owner.selectComparison(id(5),true);assert.deepEqual(owner.getSnapshot().comparison?.selected,[],'No received target means no selectable restore');
  owner.selectReadComparison('replace_current',true);owner.selectReadComparison('restore_deleted',true);
  await owner.compareOriginal(id(2),module,true);assert.deepEqual(owner.getSnapshot().comparison?.selected,[id(3),id(4)],'Reading another page cannot select its differences');
  await owner.restoreComparison();assert.equal(sent.length,1);const command=sent[0];
  assert.equal(command.restoreOriginal,true);assert.equal(command.resolutionOnly,true);assert.equal(command.acceptedManifestSha256,'a'.repeat(64));
  assert.deepEqual(command.targets,[{sourceChildId:id(2),target:{childId:id(2),spaceId:null},sections:[module]}]);
  assert.deepEqual(command.resolutions.map(row=>{assert.notEqual(row.resolution.mode,'preserve');
    assert.ok(row.resolution.mode !== 'preserve');return [row.section,row.resourceId,row.resolution.mode,row.resolution.targetId,row.resolution.expectedVersion];}),
    [[section,id(3),'replace_current',id(13),4],[section,id(4),'restore_deleted',id(14),5]]);
  assert.equal(owner.getSnapshot().comparison,null);assert.equal(owner.getSnapshot().pending?.checked,false);
  await owner.retryOriginal();assert.equal(sent.length,1,'Unknown submission must first look up the same operation');
  await owner.checkOriginal();assert.equal(owner.getSnapshot().pending,null);assert.equal(owner.getSnapshot().items[0].id,command.opId);assert.equal(sent.length,1);
  owner.syncContext('owner','owner:2',true);await owner.openUpload(id(1));await owner.compareOriginal(id(2),module);
  owner.selectReadComparison('replace_current',true);const observed=owner.getSnapshot().comparison;
  await owner.compareOriginal(id(2),module);assert.deepEqual(owner.getSnapshot().comparison?.selected,[],'Fresh comparison clears old checked versions');
  owner.selectReadComparison('replace_current',true);await owner.restoreComparison(observed);assert.equal(sent.length,1,'A stale rendered submit cannot restore a newly compared selection');
  }
});

test('revoked import access clears previously read summary and comparison across list reopening and version changes',async()=>{
  const batchId='00000000-0000-4000-8000-000000000201',childId='00000000-0000-4000-8000-000000000202',uploadId='00000000-0000-4000-8000-000000000203';
  const batch=inspectionBatch(batchId,uploadId);let listed=[batch],denied=false;
  const api:Partial<HandoverApi>={setIdentity(){},listImports:async()=>{if(denied)throw new HandoverApiError(403,'forbidden');return {items:listed,nextCursor:'more'};},
    importSummary:async()=>({batchId,state:'completed',processedItems:3,totalItems:3,modules:[{module:'care',created:3,updated:0,skipped:0,conflict:0}]}),
    getUpload:async()=>inspectionUpload(uploadId,childId,['care']),
    compareOriginal:async()=>({uploadId,manifestSha256:'a'.repeat(64),childId,module:'care',items:[{id:childId,targetId:childId,backupVersion:1,localVersion:2,state:'different',changedFields:['text']}],nextCursor:null})};
  const owner=new HandoverImportOwner(api as unknown as HandoverApi);owner.syncContext('owner','owner:1',true);
  await owner.load();await owner.readSummary(batchId);assert.equal(owner.getSnapshot().summary?.value?.modules?.[0].created,3);
  await owner.openUpload(uploadId);await owner.compareOriginal(childId,'care');owner.selectComparison(childId,true);
  denied=true;await owner.load();assert.equal(owner.getSnapshot().summary,null);assert.equal(owner.getSnapshot().comparison,null);
  denied=false;await owner.load();assert.equal(owner.getSnapshot().items[0].id,batchId);assert.equal(owner.getSnapshot().summary,null,'Reopening an actor-owned batch cannot disclose a revoked cached summary');
  await owner.readSummary(batchId);listed=[{...batch,version:2}];await owner.load(true);assert.equal(owner.getSnapshot().summary,null,'Merged newer batch versions invalidate cached summary');
  await owner.readSummary(batchId);listed=[{...batch,version:3}];await owner.load();assert.equal(owner.getSnapshot().summary,null,'Replaced newer batch versions invalidate cached summary');
  await owner.readSummary(batchId);listed=[];await owner.load();assert.equal(owner.getSnapshot().summary,null,'A batch absent from a replacement first page has no cached summary');
});


test('private instruction restore selects verified deleted targets and pins replacement identities', async () => {
  const id = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
  const upload = inspectionUpload(id(1), id(2), ['memory']);
  const sent: HandoverImportCommand[] = [];
  const rows: OriginalBackupComparison['items'] = [
    { id: id(3), targetId: id(3), resourceSection: 'instructions', backupVersion: 1, localVersion: 2, state: 'deleted', changedFields: [] },
    { id: id(4), targetId: id(14), resourceSection: 'instructions', backupVersion: 1, localVersion: 3, state: 'local_newer', changedFields: ['text'] },
    { id: id(5), resourceSection: 'instructions', backupVersion: 1, localVersion: null, state: 'unavailable', changedFields: [] },
  ];
  const api: Partial<HandoverApi> = {
    setIdentity() {}, getUpload: async () => upload,
    importCapabilities: async () => ({ classEnrolment: false, originalModules: ['memory'] }),
    compareOriginal: async () => ({ uploadId: id(1), childId: id(2), module: 'memory',
      manifestSha256: 'a'.repeat(64), items: rows, nextCursor: null }),
    createImport: async (_user, command) => {
      sent.push(command);
      return { ...inspectionBatch(command.opId, id(1)), state: 'queued',
        targets: command.targets.map(target => handoverImportTargetSchema.parse(target)) };
    },
  };
  const owner = new HandoverImportOwner(api as HandoverApi);
  owner.syncContext('owner', 'owner:1', true);
  await owner.readImportCapabilities();
  await owner.openUpload(id(1));
  await owner.compareOriginal(id(2), 'memory');
  owner.selectReadComparison('restore_deleted', true);
  owner.selectReadComparison('replace_current', true);
  owner.selectComparison(rows[2], true);
  assert.equal(owner.getSnapshot().comparison?.selected.length, 2);
  await owner.restoreComparison();
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].resolutions, [
    { sourceChildId: id(2), section: 'instructions', resourceId: id(3),
      resolution: { mode: 'restore_deleted', targetId: id(3), expectedVersion: 2 } },
    { sourceChildId: id(2), section: 'instructions', resourceId: id(4), useRestoredTarget: true,
      resolution: { mode: 'replace_current', targetId: id(14), expectedVersion: 3 } },
  ]);
});

test('negotiated original memory compares and submits distinct resource sections while legacy servers keep instruction-only queries', async () => {
  const id = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
  const upload = inspectionUpload(id(1), id(2), ['memory']);
  const rows: OriginalBackupComparison['items'] = [
    { id: id(3), targetId: id(13), resourceSection: 'memory_facts', backupVersion: 1, localVersion: 3, state: 'local_newer', changedFields: ['content', 'source'] },
    { id: id(3), targetId: id(3), resourceSection: 'memory_topics', backupVersion: 1, localVersion: 2, state: 'deleted', changedFields: [] },
    { id: id(4), targetId: id(14), resourceSection: 'instructions', backupVersion: 1, localVersion: 4, state: 'different', changedFields: ['text'] },
  ];
  const queries: OriginalBackupComparisonQuery[] = [], commands: HandoverImportCommand[] = [], capabilityHeaders: Headers[] = [];
  let modern = true;
  const api = createHandoverApi('https://app.example.test', async (input, init) => {
    const url = String(input);
    let response: unknown;
    if (url.endsWith('/package-imports/capabilities')) {
      capabilityHeaders.push(new Headers(init?.headers));
      response = { classEnrolment: false, originalModules: ['memory'], ...(modern ? { originalMemoryResources: true } : {}) };
    } else if (url.endsWith('/package-uploads/' + id(1))) response = upload;
    else if (url.endsWith('/compare-original')) {
      const query = JSON.parse(String(init?.body)) as OriginalBackupComparisonQuery; queries.push(query);
      response = { uploadId: id(1), childId: id(2), module: 'memory', manifestSha256: 'a'.repeat(64),
        items: query.includeMemoryResources ? rows : [rows[2]], nextCursor: null };
    } else if (url.endsWith('/package-imports')) {
      const command = JSON.parse(String(init?.body)) as HandoverImportCommand; commands.push(command);
      response = { ...inspectionBatch(command.opId, id(1)), state: 'queued',
        targets: command.targets.map(target => handoverImportTargetSchema.parse(target)) };
    } else throw Error('Unexpected request: ' + url);
    return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const owner = new HandoverImportOwner(api); owner.syncContext('owner', 'owner:1', true);
  await owner.readImportCapabilities();
  assert.ok(capabilityHeaders[0].get('x-handover-original-features')?.split(',').includes('memory-resources'));
  assert.equal(owner.getSnapshot().originalMemoryResourcesEnabled, true);
  await owner.openUpload(id(1)); await owner.compareOriginal(id(2), 'memory');
  assert.equal(queries[0].includeMemoryResources, true);
  assert.equal(owner.getSnapshot().comparison?.items.length, 3);
  for (const row of rows) owner.selectComparison(row, true);
  assert.equal(owner.getSnapshot().comparison?.selected.length, 3, 'A fact and topic sharing an ID remain independently selected');
  await owner.restoreComparison();
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0].resolutions, [
    { sourceChildId: id(2), section: 'memory_facts', resourceId: id(3), useRestoredTarget: true,
      resolution: { mode: 'replace_current', targetId: id(13), expectedVersion: 3 } },
    { sourceChildId: id(2), section: 'memory_topics', resourceId: id(3),
      resolution: { mode: 'restore_deleted', targetId: id(3), expectedVersion: 2 } },
    { sourceChildId: id(2), section: 'instructions', resourceId: id(4), useRestoredTarget: true,
      resolution: { mode: 'replace_current', targetId: id(14), expectedVersion: 4 } },
  ]);
  modern = false; owner.syncContext('owner', 'owner:2', true);
  assert.equal(owner.getSnapshot().originalMemoryResourcesEnabled, false);
  await owner.readImportCapabilities(); await owner.openUpload(id(1)); await owner.compareOriginal(id(2), 'memory');
  assert.equal(owner.getSnapshot().originalMemoryResourcesEnabled, false);
  assert.equal(Object.hasOwn(queries[1], 'includeMemoryResources'), false, 'An absent capability never sends the new comparison flag');
  assert.deepEqual(owner.getSnapshot().comparison?.items.map(row => row.resourceSection), ['instructions']);
});

test('negotiated original attachments restore only proven deleted assets and keep legacy comparison limited to child avatars', async () => {
  const id = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
  const upload = inspectionUpload(id(1), id(2), ['attachments']);
  upload.preview!.coverage = ['files', 'voices', 'photos'].map(section => ({ section, childId: id(2), items: 2 }));
  const rows: OriginalBackupComparison['items'] = [
    { id: id(3), targetId: id(3), resourceSection: 'files', backupVersion: 3, localVersion: 5, state: 'deleted', changedFields: ['asset'] },
    { id: id(3), targetId: id(3), resourceSection: 'voices', backupVersion: 3, localVersion: 6, state: 'deleted', changedFields: ['asset'] },
    { id: id(4), targetId: id(14), resourceSection: 'photos', backupVersion: 2, localVersion: 7, state: 'deleted', changedFields: ['asset'] },
    { id: id(5), targetId: id(5), resourceSection: 'files', backupVersion: 3, localVersion: 3, state: 'unchanged', changedFields: [] },
    { id: id(6), resourceSection: 'photos', backupVersion: 2, localVersion: null, state: 'unavailable', changedFields: [] },
    { id: id(7), targetId: id(7), resourceSection: 'voices', backupVersion: 3, localVersion: 0, state: 'deleted', changedFields: ['asset'] },
    { id: id(8), targetId: id(8), resourceSection: 'files', backupVersion: 2, localVersion: 4, state: 'different', changedFields: ['asset'] },
  ];
  const avatar: OriginalBackupComparison['items'][number] = {
    id: id(2), targetId: id(2), resourceSection: 'child_avatar', backupVersion: 1, localVersion: 0, state: 'different', changedFields: ['asset'],
  };
  const queries: OriginalBackupComparisonQuery[] = [], commands: HandoverImportCommand[] = [], capabilityHeaders: Headers[] = [];
  let modern = true, unexpectedAssets = false;
  const api = createHandoverApi('https://app.example.test', async (input, init) => {
    const url = String(input); let response: unknown;
    if (url.endsWith('/package-imports/capabilities')) {
      capabilityHeaders.push(new Headers(init?.headers));
      response = { classEnrolment: false, originalModules: ['attachments'], ...(modern ? { originalAttachmentResources: true } : {}) };
    } else if (url.endsWith('/package-uploads/' + id(1))) response = upload;
    else if (url.endsWith('/compare-original')) {
      const query = JSON.parse(String(init?.body)) as OriginalBackupComparisonQuery; queries.push(query);
      response = { uploadId: id(1), childId: id(2), module: 'attachments', manifestSha256: 'a'.repeat(64),
        items: query.includeAttachmentResources || unexpectedAssets ? rows : [avatar], nextCursor: null };
    } else if (url.endsWith('/package-imports')) {
      const command = JSON.parse(String(init?.body)) as HandoverImportCommand; commands.push(command);
      response = { ...inspectionBatch(command.opId, id(1)), state: 'queued',
        targets: command.targets.map(target => handoverImportTargetSchema.parse(target)) };
    } else throw Error('Unexpected request: ' + url);
    return Response.json(response);
  });
  const owner = new HandoverImportOwner(api); owner.syncContext('owner', 'owner:1', true);
  await owner.readImportCapabilities();
  assert.ok(capabilityHeaders[0].get('x-handover-original-features')?.split(',').includes('attachment-resources'));
  await owner.openUpload(id(1)); await owner.compareOriginal(id(2), 'attachments');
  assert.equal(queries[0].includeAttachmentResources, true, 'Asset-only backups remain comparable without child avatar coverage');
  assert.equal(queries[0].includeRestoreTarget, true); assert.equal(owner.getSnapshot().comparison?.error, null);
  for (const row of rows) owner.selectComparison(row, true);
  assert.equal(owner.getSnapshot().comparison?.selected.length, 3, 'Only proven positive-version deletions are selectable; immutable live originals stay unchanged');
  await owner.restoreComparison();
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0].resolutions, [
    { sourceChildId: id(2), section: 'files', resourceId: id(3), resolution: { mode: 'restore_deleted', targetId: id(3), expectedVersion: 5 } },
    { sourceChildId: id(2), section: 'voices', resourceId: id(3), resolution: { mode: 'restore_deleted', targetId: id(3), expectedVersion: 6 } },
    { sourceChildId: id(2), section: 'photos', resourceId: id(4), useRestoredTarget: true,
      resolution: { mode: 'restore_deleted', targetId: id(14), expectedVersion: 7 } },
  ]);
  assert.equal(commands[0].restoreOriginal, true); assert.equal(commands[0].resolutionOnly, true);
  assert.deepEqual(commands[0].targets, [{ sourceChildId: id(2), target: { childId: id(2), spaceId: null }, sections: ['attachments'] }]);
  await owner.openUpload(id(1)); await owner.compareOriginal(id(2), 'attachments'); owner.selectReadComparison('restore_deleted', true);
  const observed = owner.getSnapshot().comparison;
  modern = false; await owner.readImportCapabilities();
  assert.equal(owner.getSnapshot().comparison, null, 'A capability downgrade clears read versions and checked rows');
  await owner.restoreComparison(observed); assert.equal(commands.length, 1);
  const reads = queries.length;
  await owner.compareOriginal(id(2), 'attachments'); assert.equal(queries.length, reads, 'Legacy servers cannot compare an asset-only backup');
  upload.preview!.coverage.push({ section: 'child_avatar', childId: id(2), items: 1 });
  await owner.openUpload(id(1)); await owner.compareOriginal(id(2), 'attachments');
  assert.equal(Object.hasOwn(queries.at(-1)!, 'includeAttachmentResources'), false);
  assert.deepEqual(owner.getSnapshot().comparison?.items.map(row => row.resourceSection), ['child_avatar']);
  owner.selectComparison(avatar, true); await owner.restoreComparison();
  assert.equal(commands.length, 2); assert.equal(commands[1].resolutions[0].section, 'child_avatar');
  unexpectedAssets = true; await owner.openUpload(id(1)); await owner.compareOriginal(id(2), 'attachments');
  assert.ok(owner.getSnapshot().comparison?.error, 'Unnegotiated asset rows are rejected');
  assert.deepEqual(owner.getSnapshot().comparison?.items, []);
  upload.preview!.coverage = upload.preview!.coverage.filter(row => row.section !== 'child_avatar');
  modern = true; owner.syncContext('owner', 'owner:2', true); await owner.openUpload(id(1));
  const identityReads = queries.length;
  await owner.compareOriginal(id(2), 'attachments'); assert.equal(queries.length, identityReads, 'Identity changes clear negotiated asset support');
});
