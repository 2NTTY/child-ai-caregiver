import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreFamilyDocumentStore } from '../server/firestore-family-documents.ts';
import { FirestoreFamilyDocumentSnapshots, firestoreSnapshotManifestSchema } from '../server/firestore-family-document-snapshots.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import type { DocumentRequest, DocumentChange, FamilyDocument, DocumentSnapshot } from '../src/shared/family-documents.ts';
import type { CareTask } from '../src/shared/tasks.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';

const request: DocumentRequest = { kind: 'preparation', purpose: 'appointment', title: 'Private preparation document', eventDate: '2026-10-15',
  period: { from: '2026-10-01', to: '2026-10-31' } };
function fixture() {
  const fake = firestoreDomainFixture(), options = { database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 85)),
    projectId: 'synthetic-documents-project', namespace: 'synthetic_family_documents' };
  const authority = createFirestoreAuthority(options), online = createFirestoreOnlineStore(options), store = createFirestoreFamilyDocumentStore(options);
  async function initialize() { await authority.initializeControl({ enabled: true, generation: randomUUID() }); }
  async function identity(userId = 'synthetic-owner', email = 'owner@example.test') {
    await authority.issueInvitation({ email, expiresAt: new Date(Date.now() + 60_000).toISOString(), operationId: randomUUID() });
    await authority.admitIdentity({ userId, email, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    return (await authority.createChild({ userId, operationId: randomUUID(), displayName: '合成文件孩子' })).child;
  }
  async function task(childId: string, details = 'Private source body', userId = 'synthetic-owner') {
    const path = `/api/children/${childId}/tasks`, payload = { confirm: true, values: { title: 'Private source task', details, kind: 'ordinary',
      assigneeUserId: userId, dueAt: '2026-10-14T12:00:00Z', timeZone: 'Asia/Hong_Kong' } };
    const receipt = await online.submit(userId, { path, payload, operation: { ...await online.context(userId, { path, payload }), opId: randomUUID(), deviceId: randomUUID() } });
    return (receipt.result as { task: CareTask }).task;
  }
  async function version(item: FamilyDocument, userId = 'synthetic-owner') {
    return (await store.describe(userId, item.childId, item.id))!.authorityVersion;
  }
  async function change(item: FamilyDocument, action: DocumentChange['action'], extra: any = {}, opId = randomUUID()) {
    const input = { action, expectedVersion: item.version, authorityVersion: await version(item), ...extra } as DocumentChange;
    return { input, opId, item: (await store.change('synthetic-owner', item.childId, item.id, input, opId))! };
  }
  return { fake, options, authority, online, store, initialize, identity, task, version, change };
}
const rejects = (code: string, status?: number) => (error: any) => error?.code === code && (status === undefined || error.status === status);

test('canonical task-backed preparation document supports reads, typed patches, check/refresh/archive/restore and original receipts', async () => {
  const f = fixture(); await f.initialize(); const child = await f.identity(), task = await f.task(child.id), opId = randomUUID();
  let item = (await f.store.create('synthetic-owner', child.id, request, opId))!;
  assert.equal(item.readState, 'ready'); assert.equal(item.autoRefresh, false); assert.equal(item.current!.ageLabel, '年齡未確認');
  assert.equal(item.current!.coverageNote.includes('尚未納入'), false);
  assert.deepEqual(item.current!.sources.map(source => source.resourceId), [child.id, task.id]); assert.equal(item.current!.reportCoverage, undefined);
  const first = item, before = [...f.fake.records]; assert.deepEqual(await f.store.create('synthetic-owner', child.id, request, opId), item);
  assert.deepEqual([...f.fake.records], before);
  assert.deepEqual(await f.store.operationReceipt('synthetic-owner', child.id, opId), { operationId: opId, documentId: item.id, savedVersion: 1 });
  const basis = await f.version(item), patch = { action: 'patch' as const, expectedVersion: item.version, authorityVersion: basis,
    edits: [{ op: 'set_metadata' as const, title: 'Family edited title' }] };
  assert.equal((await f.store.validatePatch('synthetic-owner', child.id, item.id, patch))?.version, 1);
  item = (await f.change(item, 'patch', { edits: patch.edits, confirmShared: true })).item;
  assert.equal(item.current!.title, 'Family edited title'); assert.equal(item.version, 2);
  item = (await f.change(item, 'check_item', { sectionId: 'checklist', itemId: 'template-0', checked: true })).item;
  assert.equal(item.current!.sections.find(section => section.id === 'checklist')!.items[0].checked, true);
  item = (await f.change(item, 'refresh')).item; assert.equal(item.current!.title, 'Family edited title');
  assert.equal(item.current!.sections.find(section => section.id === 'checklist')!.items[0].checked, true);
  const archived = (await f.change(item, 'archive')).item; assert.equal(archived.status, 'archived'); assert.ok(archived.archivedAt);
  const restored = (await f.change(archived, 'restore')).item; assert.equal(restored.status, 'active'); assert.equal(restored.archivedAt, null);
  assert.deepEqual(await f.store.create('synthetic-owner', child.id, request, opId), first);
  const page = await f.store.list('synthetic-owner', child.id); assert.equal(page!.items[0].version, restored.version);
  const versions = await f.store.listVersions('synthetic-owner', child.id, first.id); assert.equal(versions!.items.length, 4);
  assert.equal((await f.store.exportSnapshot('synthetic-owner', child.id, first.id, { snapshotId: first.current!.id,
    snapshotVersion: 1, authorityVersion: basis, purpose: 'family', includeSources: true, includeRevision: true }))!.id, first.current!.id);
  for (const raw of f.fake.records.values()) assert.equal(JSON.stringify(raw).includes('Private source body'), false);
});

test('document operation identity binds the complete action/payload/child per owner before any changed target reads', async () => {
  const f = fixture(); await f.initialize(); const child = await f.identity(), opId = randomUUID();
  const item = (await f.store.create('synthetic-owner', child.id, request, opId))!, committed = [...f.fake.records];
  await assert.rejects(f.store.create('synthetic-owner', child.id, { ...request, title: 'Changed payload' }, opId), rejects('operation_mismatch', 409));
  await assert.rejects(f.store.create('synthetic-owner', randomUUID(), request, opId), rejects('operation_mismatch', 409));
  await assert.rejects(f.store.change('synthetic-owner', child.id, randomUUID(), { action: 'archive', expectedVersion: 1, authorityVersion: await f.version(item) }, opId), rejects('operation_mismatch', 409));
  assert.deepEqual([...f.fake.records], committed);
  const other = await f.identity('another-owner', 'another@example.test'); const otherItem = (await f.store.create('another-owner', other.id, request, opId))!;
  assert.notEqual(otherItem.id, item.id); assert.equal(await f.store.operationReceipt('another-owner', child.id, opId), null);
  await assert.rejects(f.store.get('another-owner', child.id, item.id));
  assert.equal((await f.store.create('synthetic-owner', child.id, { ...request, kind: 'growth_report', purpose: 'family' }, randomUUID()))?.report?.phase, 'building');
});

test('source changes invalidate old bodies and receipts; provenance gates stale patches, version/authority guards remain zero-write', async () => {
  const f = fixture(); await f.initialize(); const child = await f.identity(), task = await f.task(child.id), opId = randomUUID();
  const item = (await f.store.create('synthetic-owner', child.id, request, opId))!, basis = await f.version(item);
  await f.task(child.id, 'New independent source'); assert.equal((await f.store.get('synthetic-owner', child.id, item.id))!.readState, 'stale');
  const check = { action: 'check_item' as const, expectedVersion: 1, authorityVersion: basis, sectionId: 'checklist', itemId: 'template-0', checked: true };
  await assert.rejects(f.store.change('synthetic-owner', child.id, item.id, check, randomUUID()), rejects('source_changed', 409));
  const path = `/api/children/${child.id}/tasks/${task.id}/change`, payload = { action: 'complete', expectedVersion: 1, confirm: true, note: '' };
  await f.online.submit('synthetic-owner', { path, payload, operation: { ...await f.online.context('synthetic-owner', { path, payload }), opId: randomUUID(), deviceId: randomUUID() } });
  const before = [...f.fake.records], read = (await f.store.get('synthetic-owner', child.id, item.id))!;
  assert.equal(read.current, null); assert.equal(read.readState, 'invalidated'); assert.equal(read.history.length, 0);
  assert.equal((await f.store.create('synthetic-owner', child.id, request, opId))!.current, null);
  assert.equal(await f.store.operationReceipt('synthetic-owner', child.id, opId), null);
  const content = await f.store.readContent('synthetic-owner', child.id, item.id, { snapshotId: item.current!.id, snapshotVersion: 1, offset: 0 });
  assert.equal(content!.contentKind, 'redacted_manifest_json'); assert.equal(content!.text.includes('Private source body'), false);
  await assert.rejects(f.store.change('synthetic-owner', child.id, item.id, { action: 'patch', expectedVersion: 1, authorityVersion: basis, confirmShared: true,
    edits: [{ op: 'set_metadata', title: 'Retain old source text' }] }, randomUUID()), rejects('source_changed', 409));
  await assert.rejects(f.store.change('synthetic-owner', child.id, item.id, { action: 'refresh', expectedVersion: 2, authorityVersion: basis }, randomUUID()), rejects('document_changed', 409));
  await assert.rejects(f.store.change('synthetic-owner', child.id, item.id, { action: 'refresh', expectedVersion: 1, authorityVersion: 'wrong' }, randomUUID()), rejects('document_changed', 409));
  assert.deepEqual([...f.fake.records], before);
  const refreshed = (await f.change(item, 'refresh')).item; assert.equal(refreshed.readState, 'ready'); assert.equal(refreshed.current!.sources.find(source => source.resourceId === task.id)!.version, 2);
});

test('document metadata/chunks/change/receipt roll back together and callback retry or lost commit reply returns original immutable IDs', async () => {
  const f = fixture(); await f.initialize(); const child = await f.identity(), opId = randomUUID(), before = [...f.fake.records];
  f.fake.failCommit(); await assert.rejects(f.store.create('synthetic-owner', child.id, request, opId), /Synthetic transaction commit failed/u);
  assert.deepEqual([...f.fake.records], before);
  f.fake.retry(); f.fake.loseReply(); await assert.rejects(f.store.create('synthetic-owner', child.id, request, opId), /Synthetic lost commit acknowledgement/u);
  const rows = [...f.fake.records.keys()]; assert.equal(rows.filter(path => path.startsWith(f.options.namespace + '_documents/')).length, 1);
  assert.equal(rows.filter(path => path.startsWith(f.options.namespace + '_document_snapshots/')).length, 1);
  assert.equal(rows.filter(path => path.startsWith(f.options.namespace + '_document_operations/')).length, 1);
  const item = (await f.store.create('synthetic-owner', child.id, request, opId))!, committed = [...f.fake.records];
  assert.deepEqual(await f.store.create('synthetic-owner', child.id, request, opId), item); assert.deepEqual([...f.fake.records], committed);
});

test('snapshots over the envelope byte cap retain every UTF8 character in immutable chunks and original 4000-character content pages', async () => {
  const f = fixture(); await f.initialize(); const child = await f.identity();
  for (let i = 0; i < 45; i++) await f.task(child.id, '記'.repeat(1990) + '🙂');
  const item = (await f.store.create('synthetic-owner', child.id, request, randomUUID()))!, snapshot = item.current!;
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) > 192 * 1024);
  const helper = new FirestoreFamilyDocumentSnapshots(f.options), binding = await f.authority.readScope('synthetic-owner', child.id);
  const recovered = await f.authority.runTransaction('synthetic-owner', child.id, tx => helper.read(tx.transaction, binding.scope, item.id, snapshot.id));
  assert.deepEqual(recovered, snapshot);
  let text = '', offset = 0;
  for (;;) {
    const page = (await f.store.readContent('synthetic-owner', child.id, item.id, { snapshotId: snapshot.id, snapshotVersion: snapshot.version, offset }))!;
    assert.ok(page.text.length <= 4000); text += page.text;
    if (page.nextOffset === null) { assert.equal(page.complete, true); break; } offset = page.nextOffset;
  }
  assert.deepEqual(JSON.parse(text), snapshot);
  const data = new FirestoreDomainData(f.options), manifestRef = data.ref('document_snapshots', 'document-snapshot', snapshot.id), envelope = f.fake.records.get(manifestRef.path);
  const manifest = data.open('document-snapshot', snapshot.id, binding.scope, firestoreSnapshotManifestSchema, { exists: true, data: () => envelope } as any);
  assert.ok(manifest.count > 1);
  const corrupt = { ...manifest, hash: '0'.repeat(64) };
  f.fake.records.set(manifestRef.path, { ...envelope, ...data.seal('document-snapshot', snapshot.id, binding.scope, firestoreSnapshotManifestSchema, corrupt, snapshot.version) });
  await assert.rejects(f.store.readContent('synthetic-owner', child.id, item.id, { snapshotId: snapshot.id, snapshotVersion: 1, offset: 0 }), rejects('snapshot_binding', 500));
});

test('document list and version cursors continue the bounded catalogs without dropping history', async () => {
  const f = fixture(); await f.initialize(); const child = await f.identity();
  const created: FamilyDocument[] = [];
  for (let i = 0; i < 3; i++) created.push((await f.store.create('synthetic-owner', child.id, { ...request, title: 'Document ' + i }, randomUUID()))!);
  const first = (await f.store.list('synthetic-owner', child.id, { limit: 2 }))!, second = (await f.store.list('synthetic-owner', child.id, { limit: 2, cursor: first.nextCursor }))!;
  assert.equal(first.items.length, 2); assert.equal(first.hasMore, true); assert.equal(second.items.length, 1); assert.equal(second.hasMore, false);
  assert.equal(new Set([...first.items, ...second.items].map(item => item.id)).size, 3);
  let item = created[0]; for (let i = 0; i < 11; i++) item = (await f.change(item, 'check_item', { sectionId: 'checklist', itemId: 'template-0', checked: i % 2 === 0 })).item;
  const versions = (await f.store.listVersions('synthetic-owner', child.id, item.id))!, remaining = (await f.store.listVersions('synthetic-owner', child.id, item.id, versions.nextCursor))!;
  assert.equal(versions.items.length, 10); assert.equal(remaining.items.length, 2); assert.equal(remaining.nextCursor, null);
  assert.deepEqual([...versions.items, ...remaining.items].map(item => item.snapshotVersion), Array.from({ length: 12 }, (_, index) => 12 - index));
});
