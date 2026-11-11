import test from 'node:test';
import assert from 'node:assert/strict';
import { HandoverOwner } from '../frontend/src/production/HandoverOwner.ts';
import { HandoverApiError, type HandoverApi } from '../src/client/handover-api.ts';
import type { HandoverExportView } from '../src/shared/handover-jobs.ts';
import { boundedPackageStream } from '../src/client/package-download.ts';

test('package owner resumes the original request and clears late results on identity change', async () => {
  let writes = 0, row: HandoverExportView | undefined, resolveRead: ((v: HandoverExportView) => void) | undefined;
  const api = { setIdentity() {}, async create(_user: string, command: any) {
    writes++; row = { ...command, id: command.opId, version: 1, state: 'queued', createdAt: '2026-10-28T00:00:00Z',
      expiresAt: '2026-10-29T00:00:00Z', bytes: null, error: null }; delete (row as any).opId;
    throw new HandoverApiError();
  }, async get() { return row!; }, async list() { return { items: row ? [row] : [], nextCursor: null }; },
    async cancel(_user: string, _id: string, _command: unknown) { row = { ...row!, state: 'cancelled', version: 2 }; return row; },
  } as unknown as HandoverApi;
  let sessionChecks = 0;
  const owner = new HandoverOwner(api, () => { sessionChecks++; }); owner.syncContext('alice', 'session-a', true);
  await owner.create({ childIds: ['00000000-0000-4000-8000-000000000001'], modules: ['tasks'], period: null }, 'handover');
  assert.equal(writes, 1); assert.equal(owner.getSnapshot().pending?.kind, 'create');
  await owner.checkOriginal(); assert.equal(writes, 1); assert.equal(owner.getSnapshot().pending, null);
  assert.equal(owner.getSnapshot().items[0].id, row!.id);
  await owner.cancel(row!.id); assert.equal(owner.getSnapshot().items[0].state, 'cancelled');
  api.get = () => new Promise(resolve => { resolveRead = resolve; });
  const old = owner.refresh(row!.id); owner.syncContext('bob', 'session-b', true); resolveRead!(row!); await old;
  assert.deepEqual(owner.getSnapshot().items, []); assert.equal(owner.getSnapshot().userId, 'bob');
  await owner.load(); assert.equal(owner.getSnapshot().items.length, 1);
  api.get = async () => { throw new HandoverApiError(409, 'identity_changed'); };
  await owner.refresh(row!.id);
  assert.equal(sessionChecks, 1); assert.equal(owner.getSnapshot().identityKey, null);
  assert.deepEqual(owner.getSnapshot().items, []); assert.equal(owner.getSnapshot().pending, null);
  owner.syncContext('alice', 'session-c', true);
  api.create = async () => { throw new HandoverApiError(403, 'forbidden'); };
  await owner.create({ childIds: ['00000000-0000-4000-8000-000000000001'], modules: ['tasks'], period: null }, 'handover');
  assert.equal(owner.getSnapshot().pending, null, 'a rejected child scope must not trap the next export');
  const read = (chunks: number[][]) => new Response(new ReadableStream({ start(c) { for (const chunk of chunks) c.enqueue(new Uint8Array(chunk)); c.close(); } }));
  assert.equal((await new Response(boundedPackageStream(read([[1], [2, 3]]), 3, () => true)).arrayBuffer()).byteLength, 3);
  await assert.rejects(new Response(boundedPackageStream(read([[1]]), 3, () => true)).arrayBuffer(), /package_download_incomplete/);
  await assert.rejects(new Response(boundedPackageStream(read([[1, 2, 3, 4]]), 3, () => true)).arrayBuffer(), /package_download_invalid/);
  await assert.rejects(new Response(boundedPackageStream(read([[1]]), 1, () => false)).arrayBuffer(), /session_changed/);
});

test('account preference exports require negotiated current scope and bind document review to its selected version', async () => {
  const writes: any[] = [];
  let support = true, resolvePreview: ((value: any) => void) | undefined;
  const api = { setIdentity() {}, async exportCapabilities() { return { classModules: [], ...(support ? { notificationPreferencesBackup: true } : {}) }; },
    async create(_user: string, command: any) {
      writes.push(command); return { ...command, id: command.opId, version: 1, state: 'queued', createdAt: '2026-11-08T00:00:00Z',
        expiresAt: '2026-11-09T00:00:00Z', bytes: null, error: null };
    }, preview() { return new Promise(resolve => { resolvePreview = resolve; }); },
  } as unknown as HandoverApi;
  const owner = new HandoverOwner(api); owner.syncContext('owner', 'identity-a', true);
  const selection = { childIds: [], modules: [], period: null, notificationPreferences: { version: 0 } };
  const basis = { identityKey: 'identity-a', scopeKey: 'preferences-a', version: 0 };
  owner.syncNotificationPreferencesBasis(basis);
  await owner.create(selection, 'backup', undefined, undefined, basis); assert.equal(writes.length, 0);
  await owner.readExportCapabilities();
  await owner.create(selection, 'handover', undefined, undefined, basis); assert.equal(writes.length, 0);
  await owner.create(selection, 'backup', undefined, undefined, { ...basis, scopeKey: 'old-scope' }); assert.equal(writes.length, 0);
  await owner.create(selection, 'backup', undefined, undefined, basis);
  assert.equal(writes.length, 1); assert.deepEqual(writes[0].selection.notificationPreferences, { version: 0 });
  const documentSelection = { ...selection, childIds: ['00000000-0000-4000-8000-000000000001'], modules: ['documents'] as 'documents'[] };
  owner.setReviewSelection(documentSelection, 'review-a');
  assert.deepEqual(owner.getSnapshot().review?.selection.notificationPreferences, { version: 0 });
  const reading = owner.loadReview();
  owner.syncNotificationPreferencesBasis({ ...basis, version: 1 });
  resolvePreview!({ section: 'documents', childId: documentSelection.childIds[0], items: [], scopeVersion: 'a'.repeat(64), nextCursor: null });
  await reading;
  assert.equal(owner.getSnapshot().review, null, 'Changed preference scope/version discards late document review');
  await owner.create(selection, 'backup', undefined, undefined, basis); assert.equal(writes.length, 1);
  owner.syncNotificationPreferencesBasis(basis); owner.setReviewSelection(documentSelection, 'review-a');
  api.preview = async () => ({ items: [], scopeVersion: 'a'.repeat(64), nextCursor: null });
  await owner.loadReview();
  const review = owner.documentReview(documentSelection);
  await owner.create(documentSelection, 'backup', review, undefined, basis, 'old-review'); assert.equal(writes.length, 1);
  await owner.create(documentSelection, 'backup', review, undefined, basis, 'review-a');
  assert.equal(writes.length, 2); assert.deepEqual(writes[1].selection.notificationPreferences, { version: 0 });
  support = false; await owner.readExportCapabilities();
  assert.equal(owner.getSnapshot().review, null);
  await owner.create(selection, 'backup', undefined, undefined, basis); assert.equal(writes.length, 2);
  owner.syncContext('owner', 'identity-b', true);
  assert.equal(owner.getSnapshot().notificationPreferencesBackup, false);
});
