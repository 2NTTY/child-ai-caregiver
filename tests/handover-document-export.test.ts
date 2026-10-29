import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreFamilyDocumentStore } from '../server/firestore-family-documents.ts';
import { createFirestoreAccountExport } from '../server/firestore-account-export.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import type { DocumentRequest } from '../src/shared/family-documents.ts';
import type { CareTask } from '../src/shared/tasks.ts';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';

test('document exports retain reconstruction metadata and identities when source-backed bodies are redacted', async () => {
  const fixture = serialFirestoreFixture(), options = { database: fixture.database,
    cipher: createStorageCipher(Buffer.alloc(32, 87)), projectId: 'demo-document-export', namespace: 'unit_document_export' };
  const authority = createFirestoreAuthority(options), online = createFirestoreOnlineStore(options);
  const documents = createFirestoreFamilyDocumentStore(options);
  const exporter = createFirestoreAccountExport({ ...options, photos: { async content() { throw Error('Unused photo port'); } } });
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  async function admit(userId: string) {
    const email = userId + '@example.test';
    await authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(Date.now() + 60000).toISOString() });
    await authority.admitIdentity({ userId, email, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    return (await authority.createChild({ userId, operationId: randomUUID(), displayName: userId })).child.id;
  }
  const childId = await admit('parent'); await admit('other');
  async function taskCommand(path: string, payload: Record<string, unknown>) {
    return online.submit('parent', { path, payload, operation: {
      ...await online.context('parent', { path, payload }), opId: randomUUID(), deviceId: randomUUID() } });
  }
  const task = (await taskCommand(`/api/children/${childId}/tasks`, { confirm: true, values: { title: 'Bring notes',
    details: 'Source text to be withheld after its version changes', kind: 'ordinary', assigneeUserId: 'parent',
    dueAt: '2026-10-30T12:00:00Z', timeZone: 'Asia/Hong_Kong' } })).result as { task: CareTask };
  const request: DocumentRequest = { kind: 'preparation', purpose: 'appointment', title: 'Original request title',
    eventDate: '2026-10-31', period: { from: '2026-10-01', to: '2026-10-31' } };
  const original = (await documents.create('parent', childId, request, randomUUID()))!;
  const edited = (await documents.change('parent', childId, original.id, { action: 'patch', expectedVersion: original.version,
    authorityVersion: (await documents.describe('parent', childId, original.id))!.authorityVersion, confirmShared: true,
    edits: [{ op: 'set_metadata', title: 'Edited rendered title' }] }, randomUUID()))!;
  const archived = (await documents.change('parent', childId, original.id, { action: 'archive', expectedVersion: edited.version,
    authorityVersion: (await documents.describe('parent', childId, original.id))!.authorityVersion }, randomUUID()))!;
  const exported = (await exporter.page('parent', { section: 'documents', childId })).items[0] as any;
  assert.deepEqual(exported.request, request, 'rendered edits cannot replace the original request');
  assert.equal(exported.format, 'yuyoufang-document:1');
  assert.equal(exported.id, original.id); assert.equal(exported.version, archived.version);
  assert.equal(exported.archivedAt, archived.archivedAt); assert.equal(exported.status, 'archived');
  assert.match(exported.createdAt, /\.\d{6}Z$/u); assert.equal(exported.autoRefresh, false);
  assert.deepEqual(exported.currentSnapshot, { id: edited.current!.id, version: edited.current!.version, readable: true });
  assert.deepEqual(exported.recentSnapshotIds, [original.current!.id]);
  for (const field of ['ownerUserId', 'sourceSelection', 'progress', 'lease']) assert.equal(field in exported, false);
  async function all(section: 'document_content' | 'document_versions') {
    const items: any[] = []; let cursor: string | undefined, scopeVersion: string | undefined;
    do { const page = await exporter.page('parent', { section, childId, ...(cursor ? { cursor, scopeVersion } : {}) });
      items.push(...page.items); cursor = page.nextCursor ?? undefined; scopeVersion = page.scopeVersion;
    } while (cursor);
    return items;
  }
  const bodies = await all('document_content'), versions = await all('document_versions');
  assert.equal(bodies.length, 2); assert.equal(versions.length, 2);
  for (const body of bodies) {
    assert.equal(body.snapshotId, body.snapshot.id); assert.equal(body.snapshotVersion, body.snapshot.version);
    assert.equal(body.documentId, original.id);
    const version = versions.find(value => value.snapshotId === body.snapshotId)!;
    assert.equal(version.snapshotVersion, body.snapshotVersion); assert.equal(version.generatedAt, body.snapshot.generatedAt);
  }
  assert.equal(bodies.find(value => value.snapshotId === edited.current!.id)!.snapshot.title, 'Edited rendered title');
  await assert.rejects(exporter.page('other', { section: 'documents', childId }));
  await taskCommand(`/api/children/${childId}/tasks/${task.task.id}/change`, {
    action: 'complete', expectedVersion: task.task.version, confirm: true, note: '' });
  const redacted = await all('document_content');
  assert.deepEqual(redacted.map(value => value.snapshotId).sort(), bodies.map(value => value.snapshotId).sort());
  assert.ok(redacted.every(value => value.snapshot === null && value.invalidated && value.snapshotVersion > 0));
  assert.equal(JSON.stringify(redacted).includes('Source text to be withheld'), false);
  const changed = (await exporter.page('parent', { section: 'documents', childId })).items[0] as any;
  assert.deepEqual(changed.currentSnapshot, { id: edited.current!.id, version: edited.current!.version, readable: false });
  assert.equal(changed.invalidated, true);
});
