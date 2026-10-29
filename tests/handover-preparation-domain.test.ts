import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreCareSummary } from '../server/firestore-care-summary.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import type { HandoverImportRow } from '../server/handover-import.ts';
import type { CareTask } from '../src/shared/tasks.ts';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createCareSummaryApi } from '../src/client/care-summary-api.ts';

test('imported visit preparation retains source evidence and uses original versioned preparation operations', async () => {
  const fixture = serialFirestoreFixture(), options = { database: fixture.database,
    cipher: createStorageCipher(Buffer.alloc(32, 89)), projectId: 'demo-preparation-import', namespace: 'unit_preparation_import' };
  const authority = createFirestoreAuthority(options), care = createFirestoreCareStore(options);
  const summary = createFirestoreCareSummary(options, care), online = createFirestoreOnlineStore({ ...options, mutations: [summary.mutation] });
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  async function admit(userId: string) {
    const email = userId + '@example.test';
    await authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(Date.now() + 60000).toISOString() });
    await authority.admitIdentity({ userId, email, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    return (await authority.createChild({ userId, operationId: randomUUID(), displayName: userId })).child.id;
  }
  const sourceChild = await admit('source'), targetChild = await admit('recipient'); await admit('other');
  const period = { startDay: '2026-10-30', period: 'day' as const, timeZone: 'Asia/Hong_Kong' };
  const source = { childId: sourceChild, version: 17, appointmentTaskId: randomUUID(), questions: ['Original question'],
    checklist: [{ text: 'Bring the original notes', done: true }], reviewed: true, reviewedBasis: 'source-epoch:42',
    period, updatedBy: 'source', updatedAt: '2026-10-29T12:00:00Z' };
  const row: HandoverImportRow = { section: 'visit_preparation', childId: sourceChild, value: source,
    source: { serverId: 'https://source.test', accountId: 'source', packageId: randomUUID(), packageVersion: 1,
      manifestSha256: 'b'.repeat(64), path: 'data/preparation.json', rowIndex: 0 } };
  const imported = await authority.runTransaction('recipient', targetChild, async b => {
    const prepared = await summary.prepareImported(b, randomUUID(), row, 'missing_proof', 0); prepared.commit(); return prepared.value;
  });
  assert.equal(imported.id, targetChild); assert.equal(imported.version, 1);
  const reopened = createFirestoreCareSummary(options, care);
  let report = await reopened.get('recipient', targetChild, period);
  const client = createCareSummaryApi('https://local.test', async () => Response.json(report));
  assert.deepEqual(await client.summary(targetChild, period, new AbortController().signal, 'recipient'), report);
  assert.deepEqual(report.preparation.questions, source.questions); assert.deepEqual(report.preparation.checklist, source.checklist);
  assert.equal(report.preparation.appointmentTaskId, null, 'foreign appointment IDs never become local relationships');
  assert.equal(report.preparation.reviewed, false); assert.equal(report.reviewCurrent, false);
  const provenance = (await authority.runTransaction('recipient', targetChild, b => reopened.readImportState(b))).value!.importedFrom!;
  assert.equal(provenance.current.source.resourceId, sourceChild);
  assert.equal(provenance.current.source.resourceVersion, 17);
  assert.equal(provenance.current.source.preparation?.appointmentTaskId, source.appointmentTaskId);
  assert.equal(provenance.current.source.preparation?.reviewedBasis, source.reviewedBasis);
  assert.equal(provenance.current.source.authorUserId, 'source');
  await assert.rejects(reopened.get('other', targetChild, period));
  await assert.rejects(authority.runTransaction('recipient', targetChild,
    b => reopened.prepareImported(b, randomUUID(), row, 'missing_proof', 0)), { code: 'version_conflict' });
  const path = `/api/children/${targetChild}/visit-preparation`;
  const payload = { confirmShared: true as const, expectedVersion: 1, basisVersion: report.basisVersion,
    questions: ['Recipient edit'], checklist: source.checklist, reviewed: true, appointmentTaskId: null, period };
  const command = { path, payload, operation: { ...await online.context('recipient', { path, payload }), opId: randomUUID(), deviceId: randomUUID() } };
  const saved = await online.submit('recipient', command);
  assert.deepEqual(await online.submit('recipient', command), saved, 'normal original-operation retry remains idempotent');
  report = await reopened.get('recipient', targetChild, period);
  assert.equal(report.preparation.version, 2); assert.equal(report.reviewCurrent, true);
  assert.deepEqual((await authority.runTransaction('recipient', targetChild, b => reopened.readImportState(b))).value!.importedFrom,
    provenance, 'local edits retain their original import chain');
  assert.deepEqual(await client.summary(targetChild, period, new AbortController().signal, 'recipient'), report);
  assert.equal('importedFrom' in (saved.result as { preparation: object }).preparation, false, 'save receipts preserve the strict public DTO');
  const taskPath = `/api/children/${targetChild}/tasks`, taskPayload = { confirm: true,
    values: { title: 'Local appointment', details: '', kind: 'appointment', assigneeUserId: 'recipient', dueAt: '2026-11-01T09:00:00Z', timeZone: 'Asia/Hong_Kong' } };
  const task = ((await online.submit('recipient', { path: taskPath, payload: taskPayload, operation: {
    ...await online.context('recipient', { path: taskPath, payload: taskPayload }), opId: randomUUID(), deviceId: randomUUID() } })).result as { task: CareTask }).task;
  const mapping = { sourceTaskId: source.appointmentTaskId, targetTaskId: task.id, expectedVersion: task.version };
  await assert.rejects(authority.runTransaction('recipient', targetChild,
    b => reopened.prepareImported(b, randomUUID(), row, 'missing_proof', 2, { ...mapping, expectedVersion: task.version + 1 })), { code: 'appointment_changed' });
  await authority.runTransaction('recipient', targetChild, async b => {
    const prepared = await reopened.prepareImported(b, randomUUID(), row, 'missing_proof', 2, mapping); prepared.commit();
  });
  report = await reopened.get('recipient', targetChild, period);
  assert.equal(report.preparation.appointmentTaskId, task.id); assert.equal(report.preparation.version, 3);
  assert.equal(report.reviewCurrent, false);
  await authority.runTransaction('recipient', targetChild, async b => {
    const state = await reopened.readImportState(b); assert.equal(state.version, 3); assert.equal(state.value!.childId, targetChild);
    await assert.rejects(reopened.prepareImported(b, randomUUID(), { ...row, childId: randomUUID() }, 'missing_proof', 3), { code: 'invalid_package_scope' });
    const prepared = await reopened.prepareImported(b, randomUUID(), row, 'missing_proof', 3);
    assert.equal(prepared.value.version, 4); // Discarding the prepared transaction has no effect.
  });
  assert.equal((await reopened.get('recipient', targetChild, period)).preparation.version, 3);
  const codec = createFirestoreRestoreCodec(options), data = new FirestoreDomainData(options);
  for (const [path, record] of fixture.records) if (/_visit_preparation(?:s|_revisions)\//u.test(path)) codec.decode({ path, data: record });
  await authority.runTransaction('recipient', targetChild, async b => {
    const revision = await b.transaction.get(data.ref('visit_preparation_revisions', 'visit-preparation-revision', JSON.stringify([targetChild, 1])));
    assert.equal(revision.exists, true);
  });
});
