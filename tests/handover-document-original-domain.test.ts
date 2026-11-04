import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreFamilyDocumentStore, firestoreFamilyDocumentSchemas } from '../server/firestore-family-documents.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import type { HandoverImportRow } from '../server/handover-import.ts';
import type { CareTask } from '../src/shared/tasks.ts';
import type { DocumentSnapshot } from '../src/shared/family-documents.ts';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';

test('original document restoration preserves live citation authority and existing operational settings', async () => {
  const fixture = serialFirestoreFixture(), options = { database: fixture.database,
    cipher: createStorageCipher(Buffer.alloc(32, 113)), projectId: 'original-document-domain', namespace: 'original_document_domain' };
  const authority = createFirestoreAuthority(options), documents = createFirestoreFamilyDocumentStore(options);
  const online = createFirestoreOnlineStore(options), owner = 'original-owner';
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  const email = 'original-owner@example.test';
  await authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(Date.now() + 60000).toISOString() });
  await authority.admitIdentity({ userId: owner, email, emailVerified: true });
  await authority.acknowledge({ userId: owner, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const childId = (await authority.createChild({ userId: owner, operationId: randomUUID(), displayName: 'Original document child' })).child.id;
  const path = `/api/children/${childId}/tasks`, payload = { confirm: true, values: { title: 'Current cited task', details: 'Existing source evidence',
    kind: 'ordinary', assigneeUserId: owner, dueAt: '2026-11-04T12:00:00Z', timeZone: 'Asia/Hong_Kong' } };
  const task = ((await online.submit(owner, { path, payload, operation: { ...await online.context(owner, { path, payload }),
    opId: randomUUID(), deviceId: randomUUID() } })).result as { task: CareTask }).task;
  const original = (await documents.create(owner, childId, { kind: 'preparation', purpose: 'appointment', title: 'Original title',
    eventDate: '2026-11-05', period: { from: '2026-11-01', to: '2026-11-30' } }, randomUUID()))!;
  const archived = (await documents.change(owner, childId, original.id, { action: 'archive', expectedVersion: original.version,
    authorityVersion: (await documents.describe(owner, childId, original.id))!.authorityVersion }, randomUUID()))!;
  const metadata = (await documents.readExportMetadata(owner, childId, original.id))!;
  const row: HandoverImportRow = { section: 'documents', childId, value: metadata, source: { serverId: 'https://original.example.test',
    accountId: owner, packageId: randomUUID(), packageVersion: 1, manifestSha256: 'c'.repeat(64), path: 'data/document.json', rowIndex: 0 } };
  const backup = structuredClone(original.current!);
  const active = (await documents.change(owner, childId, original.id, { action: 'restore', expectedVersion: archived.version,
    authorityVersion: (await documents.describe(owner, childId, original.id))!.authorityVersion }, randomUUID()))!;
  const edited = (await documents.change(owner, childId, original.id, { action: 'patch', expectedVersion: active.version,
    authorityVersion: (await documents.describe(owner, childId, original.id))!.authorityVersion, confirmShared: true,
    edits: [{ op: 'set_metadata', title: 'Changed title' }] }, randomUUID()))!;
  const restore = (source = row, body: DocumentSnapshot | null = backup, id = original.id, expectedVersion = edited.version) =>
    authority.runTransaction(owner, childId, async binding => {
      const plan = await documents.prepareImported(binding, randomUUID(), source, 'trusted', body, { id, expectedVersion }, true);
      plan.commit(); return plan.value;
    });
  const saved = await restore();
  assert.equal(saved.id, original.id); assert.equal(saved.version, edited.version + 1);
  const restored = (await documents.get(owner, childId, original.id))!;
  assert.equal(restored.current!.title, 'Original title');
  assert.equal(restored.status, 'archived'); assert.equal(restored.archivedAt, archived.archivedAt);
  assert.equal(restored.current!.coverageNote, backup.coverageNote, 'Original evidence must not become an independent imported copy');
  assert.deepEqual(restored.current!.sources, backup.sources);
  assert.ok(restored.history.some(value => value.id === edited.current!.id));
  assert.equal((await documents.readExportMetadata(owner, childId, original.id))!.importedFrom, undefined);
  const beforeWrong = structuredClone([...fixture.records]);
  await assert.rejects(restore(row, backup, randomUUID(), 0), { code: 'document_changed' });
  await assert.rejects(restore({ ...row, source: { ...row.source, accountId: 'another-owner' } }, backup,
    original.id, restored.version), { code: 'document_changed' });
  assert.deepEqual([...fixture.records], beforeWrong);

  const changePath = `${path}/${task.id}/change`, change = { action: 'complete', expectedVersion: task.version, confirm: true, note: '' };
  await online.submit(owner, { path: changePath, payload: change, operation: { ...await online.context(owner, { path: changePath, payload: change }),
    opId: randomUUID(), deviceId: randomUUID() } });
  assert.equal((await documents.get(owner, childId, original.id))!.current, null, 'Original citations remain bound to the current local source');
  const beforeStale = structuredClone([...fixture.records]);
  await assert.rejects(restore(row, backup, original.id, restored.version), { code: 'document_source_changed' });
  assert.deepEqual([...fixture.records], beforeStale);

  const copied = await authority.runTransaction(owner, childId, async binding => {
    const plan = await documents.prepareImported(binding, randomUUID(), { ...row, source: { ...row.source, accountId: 'foreign-issuer' } },
      'trusted', backup); plan.commit(); return plan.value;
  });
  const localCopy = (await documents.get(owner, childId, copied.id))!;
  const copyMetadata = (await documents.readExportMetadata(owner, childId, copied.id))!;
  const copyRow = { ...row, value: copyMetadata }, copyBody = structuredClone(localCopy.current!);
  const copySaved = await restore(copyRow, copyBody, copied.id, localCopy.version);
  assert.equal((await documents.get(owner, childId, copied.id))!.readState, 'ready', 'Existing exact local detached evidence remains readable');
  const unproved = structuredClone(copyBody); unproved.sources[0].text += ' Unapproved altered evidence';
  await assert.rejects(restore(copyRow, unproved, copied.id, copySaved.version), { code: 'document_source_changed' });

  let report = (await documents.create(owner, childId, { ...metadata.request, kind: 'growth_report', purpose: 'family', reportMode: 'fixed' }, randomUUID()))!;
  for (let page = 0; report.report?.phase === 'building' && page < 6; page++) report = (await documents.change(owner, childId, report.id,
    { action: 'refresh', expectedVersion: report.version, authorityVersion: (await documents.describe(owner, childId, report.id))!.authorityVersion }, randomUUID()))!;
  assert.equal(report.report?.phase, 'complete'); assert.equal(report.autoRefresh, true);
  const reportMetadata = (await documents.readExportMetadata(owner, childId, report.id))!, reportBody = structuredClone(report.current!);
  const reportRow = { ...row, value: reportMetadata };
  const reportSaved = await restore(reportRow, reportBody, report.id, report.version);
  const reportAfter = (await documents.get(owner, childId, report.id))!;
  assert.equal(reportAfter.autoRefresh, true);
  assert.equal(reportAfter.report?.phase, 'complete');
  assert.deepEqual(reportAfter.current!.reportCoverage, reportBody.reportCoverage);
  await assert.rejects(restore(reportRow, { ...reportBody, period: { from: '2026-01-01', to: '2026-01-31' } }, report.id, reportSaved.version),
    { code: 'document_source_changed' });
  const data = new FirestoreDomainData(options);
  await authority.runTransaction(owner, childId, async binding => {
    const ref = data.ref('documents', 'family-document', report.id), snapshot = await binding.transaction.get(ref);
    const head = data.open('family-document', report.id, binding.scope, firestoreFamilyDocumentSchemas.metadata, snapshot);
    assert.ok(head.progress); head.progress.stage = 'records';
    binding.transaction.set(ref, { ...snapshot.data(), ...data.seal('family-document', report.id, binding.scope,
      firestoreFamilyDocumentSchemas.metadata, head, head.version) });
  });
  const beforeRunning = structuredClone([...fixture.records]);
  await assert.rejects(restore(reportRow, reportBody, report.id, reportSaved.version), { code: 'document_changed' });
  assert.deepEqual([...fixture.records], beforeRunning, 'An in-progress generation cannot be replaced by a backup body');
  await authority.runTransaction(owner, childId, async binding => {
    const ref = data.ref('documents', 'family-document', report.id), snapshot = await binding.transaction.get(ref);
    const head = data.open('family-document', report.id, binding.scope, firestoreFamilyDocumentSchemas.metadata, snapshot);
    head.progress!.stage = 'done';
    head.sourceSelection = { actorUserId: 'another-actor', spaceId: randomUUID(), expectedBasis: {
      spaceVersion: 1, membershipVersion: 1, shareVersion: 1, actorAuthorizationVersion: '1', sourceAuthorizationVersion: '1' } };
    binding.transaction.set(ref, { ...snapshot.data(), ...data.seal('family-document', report.id, binding.scope,
      firestoreFamilyDocumentSchemas.metadata, head, head.version) });
  });
  const beforeRestricted = structuredClone([...fixture.records]);
  await assert.rejects(restore(reportRow, reportBody, report.id, reportSaved.version), { code: 'document_source_changed' });
  assert.deepEqual([...fixture.records], beforeRestricted, 'An owner restore cannot widen a saved shared-source selection');
});
