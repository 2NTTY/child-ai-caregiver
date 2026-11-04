import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Firestore, Transaction } from '@google-cloud/firestore';
import { handleHandoverImport } from '../server/firebase-handover-import-api.ts';
import { createOriginalBackupComparison } from '../server/handover-original-backup.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreConcernStore } from '../server/firestore-concerns.ts';
import { FirestoreDomainData, firestoreDomainHash } from '../server/firestore-domain-data.ts';
import { handoverImportMappingId, handoverImportMappingSchema } from '../server/handover-import-records.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import type { HandoverImportRow } from '../server/handover-import.ts';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createFirestoreHandoverImportItems, type HandoverImportItemCommand } from '../server/firestore-handover-import-items.ts';
import { firestoreDocumentConcernEventSchema } from '../server/firestore-document-sources.ts';
import { datedConcernPages } from '../server/handover-concern-period.ts';
import { firestoreBackgroundWorkSchema } from '../server/firestore-background-work.ts';

test('original backup capabilities require module negotiation and an exact token for each addition', async () => {
  const legacy = ['care', 'profile', 'tasks', 'sources', 'documents', 'attachments'];
  const modules = [...legacy, 'concerns', 'memory'];
  const service = { originalModules: modules } as unknown as Parameters<typeof handleHandoverImport>[2];
  const cases: [Record<string, string>, string[] | undefined][] = [
    [{}, undefined],
    [{ 'x-handover-original-modules': '1' }, legacy],
    [{ 'x-handover-original-features': 'concerns' }, undefined],
    [{ 'x-handover-original-modules': '1', 'x-handover-original-features': 'other, concerns' }, [...legacy, 'concerns']],
    [{ 'x-handover-original-modules': '1', 'x-handover-original-features': 'private-instructions' }, [...legacy, 'memory']],
    [{ 'x-handover-original-modules': '1', 'x-handover-original-features': 'concerns,private-instructions' }, modules],
    [{ 'x-handover-original-modules': '1', 'x-handover-original-features': 'concerns-extra other-concerns' }, legacy],
  ];
  for (const [headers, expected] of cases) {
    const response = await handleHandoverImport(new Request('https://example.test/api/account/package-imports/capabilities', { headers }),
      'owner', service, async () => { throw Error('Unexpected request body'); }, async () => {});
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual((await response.json()).originalModules, expected);
  }
});

test('concern comparison loads only its ordered page events once before transaction retries and binds restored mappings to the full snapshot', async () => {
  const memory = serialFirestoreFixture();
  let inTransaction = false, retry = false;
  const database = { ...memory.database, async runTransaction(operation: (tx: Transaction) => Promise<unknown>) {
    const run = () => memory.database.runTransaction(async tx => {
      inTransaction = true;
      try { return await operation(tx); } finally { inTransaction = false; }
    });
    if (retry) { retry = false; await run(); }
    return run();
  } } as unknown as Firestore;
  const options = { database, cipher: createStorageCipher(Buffer.alloc(32, 191)), projectId: 'synthetic-concern-compare', namespace: 'concern_compare' };
  const authority = createFirestoreAuthority(options), concerns = createFirestoreConcernStore(options), data = new FirestoreDomainData(options);
  const owner = 'original-owner', email = owner + '@example.test';
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  await authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(Date.now() + 3600000).toISOString() });
  await authority.admitIdentity({ userId: owner, email, emailVerified: true });
  await authority.acknowledge({ userId: owner, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const childId = (await authority.createChild({ userId: owner, operationId: randomUUID(), displayName: 'Comparison child' })).child.id;
  const at = new Date().toISOString();
  const native = await concerns.create(owner, childId, { title: 'Concern', reason: 'PRIVATE_REASON', observation: 'PRIVATE_OBSERVATION',
    observedAt: new Date(Date.parse(at) - 14 * 86400000).toISOString(),
    links: { recordId: null, taskId: null, attentionId: null }, followUpAt: null }, randomUUID());
  const head = await authority.runTransaction(owner, childId, b => concerns.head(b, native.id));
  assert.ok(head);
  const events = native.events.map((event, index) => ({ ...event, concernId: head.id, childId, sequence: index + 1 }));
  const locallyRevised = await concerns.change(owner, childId, native.id, { action: 'append', expectedVersion: native.version,
    authorityVersion: (await concerns.list(owner, childId)).authorityVersion, text: 'PRIVATE_LATER_OBSERVATION',
    observedAt: at, links: { recordId: null, taskId: null, attentionId: null } }, randomUUID());
  const serverId = 'https://concern-compare.example.test', manifestSha256 = 'a'.repeat(64), uploadId = randomUUID();
  const row: HandoverImportRow = { section: 'concerns', childId, value: head, source: { serverId, accountId: owner,
    packageId: randomUUID(), packageVersion: 1, manifestSha256, path: 'data/concerns/first.json', rowIndex: 0 } };
  let selectedRow = row;
  let selectedEvents: unknown[] = events;
  let reads = 0, pages = 0;
  const uploads = { async open() { return { job: { version: 1, request: { sha256: 'b'.repeat(64) } }, async dispose() {}, reader: {
    manifestSha256, integrity: 'trusted', manifest: { purpose: 'backup', source: { serverId, accountId: owner },
      selection: { childIds: [childId], modules: ['concerns'] } },
    async readPage(input: { limit: number; sections: string[] }) {
      pages++; assert.equal(input.limit, 2); assert.deepEqual(input.sections, ['concerns']);
      return { rows: [selectedRow], nextCursor: null };
    },
    async readConcernEvents(selected: HandoverImportRow, acknowledged: string) {
      assert.equal(inTransaction, false); assert.equal(selected, selectedRow); assert.equal(acknowledged, manifestSha256); reads++; return selectedEvents;
    },
  } }; }, async assertImportableIn() { return () => {}; } } as unknown as Parameters<typeof createOriginalBackupComparison>[0]['uploads'];
  const compare = createOriginalBackupComparison({ ...options, uploads, originalBackup: { serverId, async matchesIssuedBackup() { return false; } } });
  const request = { uploadId, expectedUploadVersion: 1, childId, module: 'concerns', includeRestoreTarget: true };
  retry = true;
  const first = await compare(owner, request, new AbortController().signal);
  assert.equal(reads, 1); assert.equal(pages, 1);
  assert.equal(first.items[0].id, head.id); assert.equal(first.items[0].targetId, head.id);
  assert.equal(first.items[0].state, 'local_newer'); assert.equal(first.items[0].localVersion, 2);
  assert.doesNotMatch(JSON.stringify(first), /PRIVATE_/u);
  const source = { serverId, accountId: owner, childId, section: 'concerns' as const, resourceId: head.id };
  const mapping = { source, restoreOriginal: true as const, sourceVersion: head.version,
    sourceHash: firestoreDomainHash({ value: row.value, events }), target: { id: head.id, version: 2 },
    revision: 1, operationId: randomUUID(), importedAt: at };
  for (const [change, expected] of [
    [{}, 'unchanged'], [{ sourceHash: firestoreDomainHash(row.value) }, 'local_newer'],
    [{ sourceVersion: 2 }, 'local_newer'], [{ target: { id: head.id, version: 3 } }, 'local_newer'],
    [{ target: { id: randomUUID(), version: 2 } }, 'local_newer'],
  ] as const) {
    await authority.runTransaction(owner, childId, async b => {
      const id = handoverImportMappingId(b.scope, source, true), value = handoverImportMappingSchema.parse({ ...mapping, ...change });
      b.transaction.set(data.ref('handover_import_mappings', 'handover-import-mapping', id),
        data.seal('handover-import-mapping', id, b.scope, handoverImportMappingSchema, value, value.revision));
    });
    const result = await compare(owner, request, new AbortController().signal);
    assert.equal(result.items[0].state, expected);
  }
  const hiddenTarget = await compare(owner, { ...request, includeRestoreTarget: undefined }, new AbortController().signal);
  assert.equal(Object.hasOwn(hiddenTarget.items[0], 'targetId'), false);

  // Use the actual date projector and import item store, without another archive/storage fixture.
  const newerHead = await authority.runTransaction(owner, childId, b => concerns.head(b, head.id)); assert.ok(newerHead);
  const newerEvents = locallyRevised.events.map((event, index) => ({ ...event, concernId: head.id, childId, sequence: index + 1 }));
  let weekHead: Record<string, unknown> | undefined;
  const weekEvents: unknown[] = [];
  for await (const page of datedConcernPages(childId,
    { from: new Date(Date.parse(at) - 86400000).toISOString(), to: new Date(Date.parse(at) + 86400000).toISOString() },
    async function* (section) { yield { section, childId, items: section === 'concerns' ? [newerHead] : newerEvents,
      nextCursor: null, complete: true, scopeVersion: 'c'.repeat(64), notices: [] }; })) {
    if (page.section === 'concerns') weekHead = page.items[0] as Record<string, unknown>;
    if (page.section === 'concern_events') weekEvents.push(...page.items);
  }
  assert.ok(weekHead); assert.equal(weekEvents.length, 1);
  await authority.runTransaction(owner, childId, async b => {
    const id = handoverImportMappingId(b.scope, source, true);
    b.transaction.delete(data.ref('handover_import_mappings', 'handover-import-mapping', id));
  });
  const items = createFirestoreHandoverImportItems(options);
  const full: HandoverImportItemCommand = { opId: randomUUID(), batchId: randomUUID(), target: { childId, spaceId: null },
    row, restoreOriginal: true, integrity: 'trusted', concernEvents: events,
    resolution: { mode: 'replace_current', targetId: head.id, expectedVersion: 2 } };
  const stale = await items.apply(owner, { ...full, opId: randomUUID(), resolution: { ...full.resolution, mode: 'replace_current', targetId: head.id, expectedVersion: 1 } });
  assert.equal(stale.outcome, 'conflict'); assert.equal(stale.reason, 'target_version_conflict');
  const restored = await items.apply(owner, full);
  assert.equal(restored.outcome, 'updated'); assert.equal(restored.resource?.id, head.id);
  assert.deepEqual(await items.apply(owner, full), restored);
  const older = await concerns.get(owner, childId, head.id); assert.ok(older);
  assert.deepEqual(older.events.map(event => event.text), ['PRIVATE_OBSERVATION']);
  await authority.runTransaction(owner, childId, async b => {
    const revision = await concerns.head(b, head.id, 2); assert.equal(revision?.eventCount, 2);
    const oldEvent = await b.transaction.get(data.ref('concern_events', 'concern-event', locallyRevised.events[1].id));
    const retained = data.open('concern-event', locallyRevised.events[1].id, b.scope, firestoreDocumentConcernEventSchema, oldEvent);
    assert.equal(retained.text, 'PRIVATE_LATER_OBSERVATION'); assert.equal(retained.timelineId, revision?.timelineId);
  });
  const outside = await concerns.change(owner, childId, head.id, { action: 'append', expectedVersion: older.version,
    authorityVersion: (await concerns.list(owner, childId)).authorityVersion, text: 'PRIVATE_OUTSIDE_CURRENT',
    observedAt: new Date(Date.parse(at) + 3 * 86400000).toISOString(), links: { recordId: null, taskId: null, attentionId: null } }, randomUUID());
  const current = await concerns.change(owner, childId, head.id, { action: 'schedule_followup', expectedVersion: outside.version,
    authorityVersion: (await concerns.list(owner, childId)).authorityVersion, followUpAt: new Date(Date.now() + 3600000).toISOString() }, randomUUID());
  const followupWork = () => authority.runTransaction(owner, childId, async b => {
    const rows = await b.transaction.get(data.collection('background_work').where('childTag', '==', data.tags(b.scope).childTag));
    return rows.docs.map(row => data.open('background-work', row.get('id'), b.scope, firestoreBackgroundWorkSchema, row))
      .filter(work => work.kind === 'concern');
  });
  const workBefore = await followupWork(); assert.equal(workBefore.length, 1);
  const originalNow = Date.now;
  try {
  Date.now = () => Date.parse(at) + 2 * 3600000;
  const queued = await concerns.beginBackground(workBefore[0]); assert.ok(queued);
  assert.equal(queued.followUp?.state, 'queued');
  assert.equal(await authority.runTransaction(owner, childId, b => concerns.authorizeBackground(b, workBefore[0])), true);
  const claimsBefore = [...memory.records.keys()].filter(path => path.includes('_concern_followups/'));
  const week: HandoverImportItemCommand = { ...full, opId: randomUUID(), batchId: randomUUID(),
    row: { ...row, value: weekHead, source: { ...row.source, packageId: randomUUID() } }, concernEvents: weekEvents,
    resolution: { mode: 'replace_current', targetId: head.id, expectedVersion: queued.version } };
  const supplemented = await items.apply(owner, week);
  assert.equal(supplemented.outcome, 'updated'); assert.equal(supplemented.resource?.id, head.id);
  assert.deepEqual(await items.apply(owner, week), supplemented);
  const merged = await concerns.get(owner, childId, head.id); assert.ok(merged);
  assert.deepEqual(merged.events.filter(event => event.kind === 'observation').map(event => event.text).sort(),
    ['PRIVATE_OBSERVATION', 'PRIVATE_LATER_OBSERVATION', 'PRIVATE_OUTSIDE_CURRENT'].sort());
  for (const field of ['title', 'reason', 'status', 'archivedAt', 'followUp'] as const) assert.deepEqual(merged[field], queued[field]);
  assert.deepEqual(await followupWork(), workBefore, 'Supplementing observations must not replace or requeue the existing follow-up');
  assert.deepEqual([...memory.records.keys()].filter(path => path.includes('_concern_followups/')), claimsBefore);
  assert.equal(await authority.runTransaction(owner, childId, b => concerns.authorizeBackground(b, workBefore[0])), true);
  await assert.rejects(items.apply(owner, { ...week, concernEvents: [] }), { code: 'operation_conflict' });
  const missingId = randomUUID();
  const missing = await authority.runTransaction(owner, childId, b => concerns.compareOriginal(b,
    { ...row, value: { ...row.value, id: missingId } }, events.map(event => ({ ...event, concernId: missingId }))));
  assert.equal(missing.state, 'unavailable'); assert.equal(missing.localVersion, null);
  selectedRow = week.row; selectedEvents = weekEvents;
  const projectedComparison = await compare(owner, request, new AbortController().signal);
  assert.equal(projectedComparison.items[0].id, weekHead.id);
  assert.equal(projectedComparison.items[0].targetId, head.id);
  assert.notEqual(projectedComparison.items[0].id, projectedComparison.items[0].targetId);
  } finally { Date.now = originalNow; }
});
