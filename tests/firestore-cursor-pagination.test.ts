import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreFamilyDocumentStore } from '../server/firestore-family-documents.ts';
import { createFirestoreSharedInputStore, encodeSharedInputCursor } from '../server/firestore-shared-inputs.ts';
import { createFirestoreConcernStore, encodeConcernCursor } from '../server/firestore-concerns.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import type { DocumentRequest } from '../src/shared/family-documents.ts';
import { CONCERN_EVENT_LIMIT } from '../src/shared/concerns.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';

const docRequest: DocumentRequest = {
  kind: 'preparation',
  purpose: 'appointment',
  title: 'Scaled document',
  eventDate: '2026-11-07',
  period: { from: '2026-11-01', to: '2026-11-30' },
};

function setupFixture() {
  const fake = firestoreDomainFixture();
  const options = {
    database: fake.database,
    cipher: createStorageCipher(Buffer.alloc(32, 99)),
    projectId: 'synthetic-pagination-project',
    namespace: 'synthetic_pagination',
  };
  const authority = createFirestoreAuthority(options);
  const online = createFirestoreOnlineStore(options);
  const documents = createFirestoreFamilyDocumentStore(options);
  const sources = createFirestoreSharedInputStore(options);
  const concerns = createFirestoreConcernStore(options);

  async function init() {
    await authority.initializeControl({ enabled: true, generation: randomUUID() });
  }

  async function createTestChild(userId = 'pagination-owner', email = 'owner@example.test') {
    await authority.issueInvitation({ email, expiresAt: new Date(Date.now() + 60_000).toISOString(), operationId: randomUUID() });
    await authority.admitIdentity({ userId, email, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    return (await authority.createChild({ userId, operationId: randomUUID(), displayName: '分頁規模驗證孩子' })).child;
  }

  return { authority, online, documents, sources, concerns, init, createTestChild };
}

test('family documents scale past legacy 50 cap with cursor pagination and duplicate guards', async () => {
  const { documents, init, createTestChild } = setupFixture();
  await init();
  const child = await createTestChild();
  const owner = 'pagination-owner';

  // 1. Create 55 active documents (previously failed at document 50 with document_limit)
  const createdIds: string[] = [];
  for (let i = 0; i < 55; i++) {
    const doc = await documents.create(owner, child.id, {
      ...docRequest,
      title: `Scaled Document ${String(i).padStart(3, '0')}`,
    }, randomUUID());
    assert.ok(doc, `Document ${i} must be created`);
    createdIds.push(doc.id);
  }
  assert.equal(createdIds.length, 55, 'Must have successfully created 55 active documents');

  // 2. Paginate with limit 20
  const page1 = await documents.list(owner, child.id, { limit: 20 });
  assert.ok(page1);
  assert.equal(page1.items.length, 20);
  assert.equal(page1.hasMore, true);
  assert.ok(page1.nextCursor, 'Page 1 must return nextCursor');

  const page2 = await documents.list(owner, child.id, { limit: 20, cursor: page1.nextCursor });
  assert.ok(page2);
  assert.equal(page2.items.length, 20);
  assert.equal(page2.hasMore, true);
  assert.ok(page2.nextCursor, 'Page 2 must return nextCursor');

  const page3 = await documents.list(owner, child.id, { limit: 20, cursor: page2.nextCursor });
  assert.ok(page3);
  assert.equal(page3.items.length, 15);
  assert.equal(page3.hasMore, false);
  assert.equal(page3.nextCursor, null, 'Terminal page must have null nextCursor');

  // 3. Verify all 55 items are unique and recovered without loss
  const allPagedIds = [...page1.items, ...page2.items, ...page3.items].map(item => item.id);
  assert.equal(allPagedIds.length, 55);
  const uniquePagedIds = new Set(allPagedIds);
  assert.equal(uniquePagedIds.size, 55, 'Every document across all 3 pages must be distinct');

  // 4. Verify growth report duplicate check is retained
  const growthRequest: DocumentRequest = {
    kind: 'growth_report',
    purpose: 'handoff',
    title: '生長報告 1',
    eventDate: '2026-06-30',
    period: { from: '2026-01-01', to: '2026-06-30' },
    reportMode: 'fixed',
  };
  await documents.create(owner, child.id, growthRequest, randomUUID());
  await assert.rejects(
    documents.create(owner, child.id, growthRequest, randomUUID()),
    (err: any) => err.code === 'report_exists',
    'Duplicate growth report must still be rejected'
  );

  // 5. Cursor tamper rejection
  await assert.rejects(
    documents.list(owner, child.id, { cursor: 'tampered-invalid-cursor' }),
    (err: any) => err.code === 'invalid_input',
    'Tampered document cursor must be rejected'
  );
});

test('shared inputs scale past legacy 50 wall with cursor pagination and boundary checks', async () => {
  const { sources, init, createTestChild } = setupFixture();
  await init();
  const child = await createTestChild();
  const owner = 'pagination-owner';

  // 1. Create 55 shared inputs (previously threw inputs_capacity at 50)
  for (let i = 0; i < 55; i++) {
    const input = await sources.create(owner, child.id, {
      kind: 'personal_source',
      sourceLabel: `私人資料來源 ${i}`,
      sourceUrl: null,
      sourceDateText: null,
      sourceNotes: '測試容量解除',
      text: `來源正文內容第 ${i} 筆`,
    });
    assert.ok(input, `Input ${i} must be created`);
  }

  // 2. Default list returns bounded first page (up to 50 items)
  const defaultList = await sources.list(owner, child.id, {});
  assert.ok(defaultList);
  assert.equal(defaultList.inputs.length, 50, 'Default page must be bounded to 50 items');
  assert.equal(defaultList.hasMore, true);
  assert.ok(defaultList.nextCursor, 'Default list must return nextCursor when more items remain');

  // 3. Paginate with limit 20 (20 + 20 + 15 = 55)
  const p1 = await sources.list(owner, child.id, { limit: 20 });
  assert.equal(p1.inputs.length, 20);
  assert.equal(p1.hasMore, true);
  assert.ok(p1.nextCursor);

  const p2 = await sources.list(owner, child.id, { limit: 20, cursor: p1.nextCursor });
  assert.equal(p2.inputs.length, 20);
  assert.equal(p2.hasMore, true);
  assert.ok(p2.nextCursor);

  const p3 = await sources.list(owner, child.id, { limit: 20, cursor: p2.nextCursor });
  assert.equal(p3.inputs.length, 15);
  assert.equal(p3.hasMore, false);
  assert.equal(p3.nextCursor, null);

  const allPagedIds = [...p1.inputs, ...p2.inputs, ...p3.inputs].map(item => item.id);
  assert.equal(allPagedIds.length, 55);
  assert.equal(new Set(allPagedIds).size, 55, 'All 55 shared inputs must be distinct');

  // 4. Cursor boundary checks: invalid string and cross-child rejection
  await assert.rejects(
    sources.list(owner, child.id, { cursor: 'invalid-base64url' }),
    (err: any) => err.code === 'invalid_input' && err.status === 400
  );

  const crossChildCursor = encodeSharedInputCursor({
    v: 1,
    kind: 'shared_inputs',
    userId: owner,
    childId: randomUUID(),
    after: { at: new Date().toISOString(), id: randomUUID() },
  });
  await assert.rejects(
    sources.list(owner, child.id, { cursor: crossChildCursor }),
    (err: any) => err.code === 'invalid_input' && err.status === 400
  );
});

test('concerns scale past legacy 200 aggregate wall with cursor pagination and timeline limit enforcement', async () => {
  const { concerns, init, createTestChild } = setupFixture();
  await init();
  const child = await createTestChild();
  const owner = 'pagination-owner';

  // 1. Create 205 concerns across the child (previously rejected at 200 with concern_history_requires_review)
  let firstConcernId = '';
  for (let i = 0; i < 205; i++) {
    const created = await concerns.create(owner, child.id, {
      title: `持續關注事項 ${String(i).padStart(3, '0')}`,
      reason: '規模測試',
      followUpAt: null,
      observedAt: new Date().toISOString(),
      observation: `觀察記錄 ${i}`,
      links: { recordId: null, taskId: null, attentionId: null },
    }, randomUUID());
    assert.ok(created, `Concern ${i} must be created`);
    if (i === 0) firstConcernId = created.id;
  }

  // 2. Cursor paginate concerns with limit 50 (50 + 50 + 50 + 50 + 5 = 205)
  const cp1 = await concerns.list(owner, child.id, { limit: 50 });
  assert.equal(cp1.items.length, 50);
  assert.equal(cp1.hasMore, true);
  assert.ok(cp1.nextCursor);

  const cp2 = await concerns.list(owner, child.id, { limit: 50, cursor: cp1.nextCursor });
  assert.equal(cp2.items.length, 50);
  assert.equal(cp2.hasMore, true);
  assert.ok(cp2.nextCursor);

  const cp3 = await concerns.list(owner, child.id, { limit: 50, cursor: cp2.nextCursor });
  assert.equal(cp3.items.length, 50);
  assert.equal(cp3.hasMore, true);
  assert.ok(cp3.nextCursor);

  const cp4 = await concerns.list(owner, child.id, { limit: 50, cursor: cp3.nextCursor });
  assert.equal(cp4.items.length, 50);
  assert.equal(cp4.hasMore, true);
  assert.ok(cp4.nextCursor);

  const cp5 = await concerns.list(owner, child.id, { limit: 50, cursor: cp4.nextCursor });
  assert.equal(cp5.items.length, 5);
  assert.equal(cp5.hasMore, false);
  assert.equal(cp5.nextCursor, null);

  const allConcernIds = [...cp1.items, ...cp2.items, ...cp3.items, ...cp4.items, ...cp5.items].map(c => c.id);
  assert.equal(allConcernIds.length, 205);
  assert.equal(new Set(allConcernIds).size, 205, 'All 205 concerns across pages must be distinct');

  // 3. Cursor tamper and cross-child rejection
  await assert.rejects(
    concerns.list(owner, child.id, { cursor: 'malformed-concern-cursor' }),
    (err: any) => err.code === 'invalid_input' && err.status === 400
  );

  const crossChildCursor = encodeConcernCursor({
    v: 1,
    kind: 'concerns',
    userId: owner,
    childId: randomUUID(),
    after: { at: new Date().toISOString(), id: randomUUID() },
  });
  await assert.rejects(
    concerns.list(owner, child.id, { cursor: crossChildCursor }),
    (err: any) => err.code === 'invalid_input' && err.status === 400
  );

  // 4. Timeline limit enforcement on single concern:
  // firstConcern starts with 1 event (version 1, eventCount 1).
  // Append 199 events to reach exactly CONCERN_EVENT_LIMIT (200).
  const authVer = cp1.authorityVersion;
  let currentVersion = 1;
  for (let i = 0; i < 199; i++) {
    const updated = await concerns.change(owner, child.id, firstConcernId, {
      action: 'append',
      expectedVersion: currentVersion,
      authorityVersion: authVer,
      text: `Append observation ${i + 1}`,
      observedAt: new Date().toISOString(),
      links: { recordId: null, taskId: null, attentionId: null },
    }, randomUUID());
    currentVersion = updated.version;
  }
  assert.equal(currentVersion, 200, 'Must have reached version 200 after 199 appends');

  const loadedAtLimit = await concerns.get(owner, child.id, firstConcernId);
  assert.ok(loadedAtLimit);
  assert.equal(loadedAtLimit.events.length, CONCERN_EVENT_LIMIT, `Must have exactly ${CONCERN_EVENT_LIMIT} events`);

  // Attempting to append the 201st event MUST reject with concern_history_requires_review (400)
  await assert.rejects(
    concerns.change(owner, child.id, firstConcernId, {
      action: 'append',
      expectedVersion: currentVersion,
      authorityVersion: authVer,
      text: 'Append observation 201 should be rejected',
      observedAt: new Date().toISOString(),
      links: { recordId: null, taskId: null, attentionId: null },
    }, randomUUID()),
    (err: any) => err.code === 'concern_history_requires_review' && err.status === 400,
    '201st event append must reject with concern_history_requires_review'
  );

  // Archive is still permitted at 200 events (safety lifecycle exit)
  const archived = await concerns.change(owner, child.id, firstConcernId, {
    action: 'archive',
    expectedVersion: currentVersion,
    authorityVersion: authVer,
    confirm: true,
  }, randomUUID());
  assert.equal(archived.status, 'closed', 'Concern can still be archived when at event limit');
});
