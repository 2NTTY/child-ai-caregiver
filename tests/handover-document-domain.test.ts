import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreFamilyDocumentStore } from '../server/firestore-family-documents.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import type { HandoverImportRow } from '../server/handover-import.ts';
import type { CareTask } from '../src/shared/tasks.ts';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';

test('imported document copies use original reads, edits, checks and PDF snapshots without foreign authority', async () => {
  const fixture = serialFirestoreFixture(), options = { database: fixture.database,
    cipher: createStorageCipher(Buffer.alloc(32, 88)), projectId: 'demo-document-import', namespace: 'unit_document_import' };
  const authority = createFirestoreAuthority(options), online = createFirestoreOnlineStore(options), documents = createFirestoreFamilyDocumentStore(options);
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  async function admit(userId: string) {
    const email = userId + '@example.test';
    await authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(Date.now() + 60000).toISOString() });
    await authority.admitIdentity({ userId, email, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    return (await authority.createChild({ userId, operationId: randomUUID(), displayName: userId })).child.id;
  }
  const sourceChild = await admit('source'), targetChild = await admit('recipient'); await admit('other');
  const path = `/api/children/${sourceChild}/tasks`, payload = { confirm: true, values: { title: 'Original task', details: 'Original source evidence',
    kind: 'ordinary', assigneeUserId: 'source', dueAt: '2026-10-30T12:00:00Z', timeZone: 'Asia/Hong_Kong' } };
  const task = ((await online.submit('source', { path, payload, operation: {
    ...await online.context('source', { path, payload }), opId: randomUUID(), deviceId: randomUUID() } })).result as { task: CareTask }).task;
  const original = (await documents.create('source', sourceChild, { kind: 'preparation', purpose: 'appointment', title: 'Source document',
    eventDate: '2026-10-31', period: { from: '2026-10-01', to: '2026-10-31' } }, randomUUID()))!;
  const metadata = (await documents.readExportMetadata('source', sourceChild, original.id))!;
  const row: HandoverImportRow = { section: 'documents', childId: sourceChild, value: metadata,
    source: { serverId: 'https://source.test', accountId: 'source', packageId: randomUUID(), packageVersion: 1,
      manifestSha256: 'b'.repeat(64), path: 'data/documents.json', rowIndex: 0 } };
  const imported = await authority.runTransaction('recipient', targetChild, async b => {
    const prepared = await documents.prepareImported(b, randomUUID(), row, 'missing_proof', original.current);
    prepared.commit(); return prepared.value;
  });
  assert.notEqual(imported.id, original.id); assert.equal(imported.version, 1);
  const reopened = createFirestoreFamilyDocumentStore(options);
  let item = (await reopened.get('recipient', targetChild, imported.id))!;
  assert.equal(item.readState, 'ready'); assert.equal(item.current!.title, original.current!.title);
  assert.deepEqual(item.current!.sections, original.current!.sections); assert.equal(item.autoRefresh, false);
  assert.deepEqual(item.current!.sources, original.current!.sources);
  await assert.rejects(reopened.get('other', targetChild, imported.id));
  const taskPath = `${path}/${task.id}/change`, taskPayload = { action: 'complete', expectedVersion: task.version, confirm: true, note: '' };
  await online.submit('source', { path: taskPath, payload: taskPayload, operation: {
    ...await online.context('source', { path: taskPath, payload: taskPayload }), opId: randomUUID(), deviceId: randomUUID() } });
  assert.equal((await reopened.get('source', sourceChild, original.id))!.current, null);
  assert.notEqual((await reopened.get('recipient', targetChild, imported.id))!.current, null, 'accepted copies do not follow foreign mutations');
  item = (await reopened.change('recipient', targetChild, item.id, { action: 'check_items', expectedVersion: item.version,
    authorityVersion: (await reopened.describe('recipient', targetChild, item.id))!.authorityVersion,
    checks: [{ sectionId: 'checklist', itemId: 'template-0', checked: true }] }, randomUUID()))!;
  assert.equal(item.current!.sections.find(section => section.id === 'checklist')!.items[0].checked, true);
  item = (await reopened.change('recipient', targetChild, item.id, { action: 'patch', expectedVersion: item.version, confirmShared: true,
    authorityVersion: (await reopened.describe('recipient', targetChild, item.id))!.authorityVersion,
    edits: [{ op: 'set_metadata', title: 'Recipient edit' }] }, randomUUID()))!;
  assert.equal(item.readState, 'ready'); assert.equal(item.current!.title, 'Recipient edit');
  assert.equal(item.history.length, 2);
  const exported = await reopened.exportSnapshot('recipient', targetChild, item.id, { snapshotId: item.current!.id,
    snapshotVersion: item.current!.version, authorityVersion: (await reopened.describe('recipient', targetChild, item.id))!.authorityVersion,
    purpose: 'family', includeSources: true, includeRevision: true });
  assert.equal(exported!.id, item.current!.id); assert.deepEqual(exported!.sources, original.current!.sources);
  const transfer = (await reopened.readExportMetadata('recipient', targetChild, item.id))!;
  assert.equal(transfer.importedFrom!.current.source.resourceId, original.id);
  assert.equal(transfer.importedFrom!.current.source.resourceVersion, original.version);
  await assert.rejects(authority.runTransaction('recipient', targetChild, b => reopened.prepareImported(b, randomUUID(), row,
    'missing_proof', original.current, { id: item.id, expectedVersion: item.version - 1 })), { code: 'document_changed' });
  await assert.rejects(authority.runTransaction('recipient', targetChild, b => reopened.prepareImported(b, randomUUID(), row,
    'missing_proof', { ...original.current!, id: randomUUID() })), { code: 'invalid_package_data' });
  await assert.rejects(authority.runTransaction('recipient', targetChild, b => reopened.prepareImported(b, randomUUID(),
    { ...row, value: { ...metadata, readState: 'invalidated', invalidated: true } }, 'missing_proof', original.current)), { code: 'invalid_package_data' });
  const localPath = `/api/children/${targetChild}/tasks`, localPayload = { ...payload, values: { ...payload.values, assigneeUserId: 'recipient' } };
  const localTask = ((await online.submit('recipient', { path: localPath, payload: localPayload, operation: {
    ...await online.context('recipient', { path: localPath, payload: localPayload }), opId: randomUUID(), deviceId: randomUUID() } })).result as { task: CareTask }).task;
  item = (await reopened.change('recipient', targetChild, item.id, { action: 'patch', expectedVersion: item.version, confirmShared: true,
    authorityVersion: (await reopened.describe('recipient', targetChild, item.id))!.authorityVersion,
    edits: [{ op: 'upsert_section', sectionId: 'local', title: 'Local notes', kind: 'notes' },
      { op: 'upsert_item', sectionId: 'local', itemId: 'local-task', text: 'Read the local task', sourceIds: ['task:' + localTask.id] }] }, randomUUID()))!;
  assert.equal(item.readState, 'ready');
  const localChangePath = `${localPath}/${localTask.id}/change`, localChange = { ...taskPayload, expectedVersion: localTask.version };
  await online.submit('recipient', { path: localChangePath, payload: localChange, operation: {
    ...await online.context('recipient', { path: localChangePath, payload: localChange }), opId: randomUUID(), deviceId: randomUUID() } });
  assert.equal((await reopened.get('recipient', targetChild, item.id))!.current, null, 'copy evidence cannot bypass local source validity');
  let report = (await documents.create('source', sourceChild, { ...metadata.request, kind: 'growth_report', purpose: 'family', reportMode: 'fixed' }, randomUUID()))!;
  for (let batch = 0; report.report?.phase === 'building' && batch < 5; batch++) report = (await documents.change('source', sourceChild, report.id,
    { action: 'refresh', expectedVersion: report.version, authorityVersion: (await documents.describe('source', sourceChild, report.id))!.authorityVersion }, randomUUID()))!;
  assert.equal(report.report?.phase, 'complete');
  const reportRow: HandoverImportRow = { ...row, value: (await documents.readExportMetadata('source', sourceChild, report.id))! };
  const importedReport = await authority.runTransaction('recipient', targetChild, async b => {
    const prepared = await reopened.prepareImported(b, randomUUID(), reportRow, 'missing_proof', report.current); prepared.commit(); return prepared.value;
  });
  let reportCopy = (await reopened.get('recipient', targetChild, importedReport.id))!;
  assert.equal(reportCopy.report?.phase, 'complete'); assert.equal(reportCopy.autoRefresh, false);
  assert.deepEqual(reportCopy.current!.reportCoverage, report.current!.reportCoverage);
  const retainedSource = reportCopy.current!.sources[0]; assert.ok(retainedSource);
  reportCopy = (await reopened.change('recipient', targetChild, reportCopy.id, { action: 'patch', expectedVersion: reportCopy.version, confirmShared: true,
    authorityVersion: (await reopened.describe('recipient', targetChild, reportCopy.id))!.authorityVersion,
    edits: [{ op: 'upsert_section', sectionId: 'retained', title: 'Source comparison', kind: 'notes' },
      { op: 'upsert_item', sectionId: 'retained', itemId: 'reference', text: 'Retain the original evidence', sourceIds: [retainedSource.id] }] }, randomUUID()))!;
  let refresh = (await reopened.change('recipient', targetChild, reportCopy.id, { action: 'refresh', expectedVersion: reportCopy.version,
    authorityVersion: (await reopened.describe('recipient', targetChild, reportCopy.id))!.authorityVersion }, randomUUID()))!;
  assert.equal(refresh.report?.phase, 'building'); assert.equal(refresh.autoRefresh, true, 'explicit local refresh starts new local work');
  for (let batch = 0; refresh.report?.phase === 'building' && batch < 5; batch++) refresh = (await reopened.change('recipient', targetChild, refresh.id,
    { action: 'refresh', expectedVersion: refresh.version, authorityVersion: (await reopened.describe('recipient', targetChild, refresh.id))!.authorityVersion }, randomUUID()))!;
  assert.equal(refresh.report?.phase, 'complete');
  assert.equal(refresh.current!.sections.find(section => section.id === 'retained')!.items[0].text, 'Retain the original evidence');
  assert.ok(refresh.current!.sources.some(source => source.id === retainedSource.id));
  const updated = await authority.runTransaction('recipient', targetChild, async b => {
    const prepared = await reopened.prepareImported(b, randomUUID(), row, 'missing_proof', original.current,
      { id: item.id, expectedVersion: item.version }); prepared.commit(); return prepared.value;
  });
  assert.equal(updated.id, item.id); assert.equal(updated.version, item.version + 1);
  const refreshedPreparation = (await reopened.change('recipient', targetChild, updated.id, { action: 'refresh', expectedVersion: updated.version,
    authorityVersion: (await reopened.describe('recipient', targetChild, updated.id))!.authorityVersion }, randomUUID()))!;
  assert.equal(refreshedPreparation.readState, 'ready');
  const nextPayload = { ...localPayload, values: { ...localPayload.values, title: 'A new local task' } };
  await online.submit('recipient', { path: localPath, payload: nextPayload, operation: {
    ...await online.context('recipient', { path: localPath, payload: nextPayload }), opId: randomUUID(), deviceId: randomUUID() } });
  assert.equal((await reopened.get('recipient', targetChild, updated.id))!.readState, 'stale',
    'an explicitly refreshed preparation resumes normal current-source staleness');
  const codec = createFirestoreRestoreCodec(options);
  for (const [path, data] of fixture.records) if (/_(documents|document_snapshots|document_chunks|document_operations)\//u.test(path)) codec.decode({ path, data });
});
