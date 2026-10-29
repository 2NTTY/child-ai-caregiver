import test from 'node:test';
import assert from 'node:assert/strict';
import { HandoverImportOwner } from '../frontend/src/production/HandoverImportOwner.ts';
import { HandoverApiError, type HandoverApi } from '../src/client/handover-api.ts';
import type { HandoverUploadView } from '../src/shared/handover-uploads.ts';
import type { HandoverImportView } from '../src/shared/handover-imports.ts';
import { packageHash } from '../frontend/src/platform/package-import-hash.ts';

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
    writes++; decided = command; batch = { ...originalBatch, id: command.opId, state: 'queued', targets: command.targets };
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
  const lateResults = owner.readResults(); owner.syncContext('bob', 'results-other-session', true);
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
