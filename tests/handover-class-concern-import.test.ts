import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreSharingStore } from '../server/firestore-sharing.ts';
import { createFirestoreConcernStore } from '../server/firestore-concerns.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { emptyCareDetails } from '../src/shared/care.ts';
import { createFirestoreHandoverImportItems, type HandoverImportItemCommand } from '../server/firestore-handover-import-items.ts';
import { firestoreBackgroundWorkSchema } from '../server/firestore-background-work.ts';
import { createFirestoreRestoreCodec } from '../server/firestore-restore-codec.ts';
import { handleHandoverImport } from '../server/firebase-handover-import-api.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';

test('class concern import capability requires an exact negotiated feature token', async () => {
  const service = {} as Parameters<typeof handleHandoverImport>[2];
  for (const [value, expected] of [[null, undefined], ['concerns-extra other-concerns', undefined], ['other, concerns', true]] as const) {
    const headers = new Headers(); if (value !== null) headers.set('x-handover-class-features', value);
    const response = await handleHandoverImport(new Request('https://example.test/api/account/package-imports/capabilities', { headers }),
      'teacher', service, async () => { throw Error('Unexpected body'); }, async () => {});
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal((await response.json()).classConcernImports, expected);
  }
});

test('class concern imports use one canonical shared resource with teacher authority, replay and version fences and no new follow-up work', async () => {
  const fixture = serialFirestoreFixture(), options = { database: fixture.database, cipher: createStorageCipher(Buffer.alloc(32, 193)),
    projectId: 'synthetic-class-concern', namespace: 'class_concern_import' };
  const authority = createFirestoreAuthority(options), sharing = createFirestoreSharingStore(options);
  const concerns = createFirestoreConcernStore(options), items = createFirestoreHandoverImportItems(options), codec = createFirestoreRestoreCodec(options);
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  const expiresAt = new Date(Date.now() + 86400000).toISOString();
  for (const userId of ['source', 'manager', 'teacher', 'viewer']) {
    const email = userId + '@example.test';
    await authority.issueInvitation({ email, expiresAt, operationId: randomUUID() });
    await authority.admitIdentity({ userId, email, emailVerified: true });
    await authority.acknowledge({ userId, policyVersion: SERVICE_POLICY_VERSION, operationId: randomUUID() });
  }
  let classroom = await sharing.create('manager', { operationId: randomUUID(), kind: 'class', name: 'Concern class' });
  const member = await sharing.addClassChild('manager', { operationId: randomUUID(), spaceId: classroom.id,
    expectedVersion: classroom.version, displayName: 'Learner' }); classroom = member.space;
  for (const [userId, role] of [['teacher', 'caregiver'], ['viewer', 'viewer']] as const) {
    const invite = await sharing.invite('manager', { operationId: randomUUID(), spaceId: classroom.id,
      expectedVersion: classroom.version, email: userId + '@example.test', role, expiresAt });
    classroom = await sharing.acceptInvitation(userId, { operationId: randomUUID(), token: invite.token });
  }
  const sourceChild = (await authority.createChild({ userId: 'source', operationId: randomUUID(), displayName: 'Source child' })).child.id;
  const record = await createFirestoreCareStore(options).create('source', sourceChild, { text: 'A linked observation', source: 'Parent', details: emptyCareDetails() });
  assert.ok(record);
  const native = await concerns.create('source', sourceChild, { title: 'Source concern', reason: 'Source context', observation: 'First observation',
    observedAt: new Date().toISOString(), links: { recordId: record.id, taskId: null, attentionId: null },
    followUpAt: new Date(Date.now() + 3600000).toISOString() }, randomUUID());
  const source = { serverId: 'https://class-concern.example.test', accountId: 'source', packageId: randomUUID(),
    packageVersion: 1, manifestSha256: 'a'.repeat(64), path: 'data/concerns.json', rowIndex: 0 };
  async function command(): Promise<HandoverImportItemCommand> {
    const head = await authority.runTransaction('source', sourceChild, b => concerns.head(b, native.id)); assert.ok(head);
    const live = await concerns.get('source', sourceChild, native.id); assert.ok(live);
    return { opId: randomUUID(), batchId: randomUUID(), target: { childId: member.child.id, spaceId: classroom.id }, integrity: 'trusted',
      resolution: { mode: 'preserve' }, row: { section: 'concerns', childId: sourceChild, source, value: head },
      concernEvents: live.events.map((event, index) => ({ ...event, concernId: head.id, childId: sourceChild, sequence: index + 1 })) };
  }
  const first = await command();
  await assert.rejects(items.apply('viewer', { ...first, opId: randomUUID() }), (error: { status?: number }) => error.status === 403);
  const personalChild = (await authority.createChild({ userId: 'teacher', operationId: randomUUID(), displayName: 'Personal child' })).child.id;
  let family = await sharing.create('teacher', { operationId: randomUUID(), kind: 'family', name: 'Family' });
  family = await sharing.share('teacher', { operationId: randomUUID(), spaceId: family.id, expectedVersion: family.version,
    childId: personalChild, modules: ['concerns'] });
  await assert.rejects(items.apply('teacher', { ...first, opId: randomUUID(), target: { childId: personalChild, spaceId: family.id } }),
    (error: { status?: number }) => error.status === 403 || error.status === 409);
  const followupCount = () => [...fixture.records].filter(([path]) => path.includes('_background_work/'))
    .filter(([path, data]) => firestoreBackgroundWorkSchema.parse(codec.decode({ path, data }).value).kind === 'concern').length;
  // Before this import only the original personal source has a real follow-up job.
  const before = await followupCount(); assert.equal(before, 1);
  const copiedRecord = await items.apply('teacher', { ...first, opId: randomUUID(), concernEvents: undefined,
    row: { ...first.row, section: 'care', value: { ...record } } });
  assert.ok(copiedRecord.resource);
  const saved = await items.apply('teacher', first);
  assert.equal(saved.outcome, 'created'); assert.ok(saved.resource);
  assert.deepEqual(await items.apply('teacher', first), saved);
  await assert.rejects(items.apply('teacher', { ...first, concernEvents: [] }), { code: 'operation_conflict' });
  const duplicate = await items.apply('teacher', { ...first, opId: randomUUID() });
  assert.equal(duplicate.outcome, 'skipped'); assert.equal(duplicate.reason, 'already_imported');
  const shared = concerns.forSharedSpace(classroom.id);
  const visible = await shared.get('viewer', member.child.id, saved.resource.id); assert.ok(visible);
  assert.equal(visible.events[0].text, 'First observation');
  assert.equal(visible.events[0].recordId, copiedRecord.resource.id);
  assert.equal(visible.followUp?.state, 'stopped');
  assert.equal(visible.followUp?.at, native.followUp?.at);
  assert.equal(visible.followUp?.runId, null);
  assert.equal((await shared.list('manager', member.child.id)).items.length, 1);
  const conflict = await items.apply('teacher', { ...first, opId: randomUUID(), row: { ...first.row, value: { ...first.row.value, reason: 'Changed same version' } } });
  assert.equal(conflict.outcome, 'conflict'); assert.equal(conflict.reason, 'source_version_conflict');
  await concerns.change('source', sourceChild, native.id, { action: 'append', expectedVersion: native.version,
    authorityVersion: (await concerns.list('source', sourceChild)).authorityVersion, text: 'Second observation',
    observedAt: new Date().toISOString(), links: { recordId: null, taskId: null, attentionId: null } }, randomUUID());
  const newer = await command();
  const stale = await items.apply('teacher', { ...newer, opId: randomUUID(), resolution: { mode: 'replace_current', targetId: saved.resource.id, expectedVersion: 0 } });
  assert.equal(stale.outcome, 'conflict'); assert.equal(stale.reason, 'target_version_conflict');
  const update = { ...newer, resolution: { mode: 'replace_current' as const, targetId: saved.resource.id, expectedVersion: saved.resource.version } };
  const updated = await items.apply('teacher', update);
  assert.equal(updated.outcome, 'updated'); assert.equal(updated.resource?.id, saved.resource.id);
  assert.deepEqual(await items.apply('teacher', update), updated);
  assert.equal((await shared.get('teacher', member.child.id, saved.resource.id))!.events.length, 2);
  assert.equal((await shared.list('manager', member.child.id)).items.length, 1);
  assert.equal(await followupCount(), before);
});
