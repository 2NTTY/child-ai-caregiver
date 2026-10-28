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
  let upload: HandoverUploadView, batch: HandoverImportView, writes = 0, contentWrites = 0, released = 0;
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
