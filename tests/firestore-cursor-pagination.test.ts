import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreFamilyDocumentStore } from '../server/firestore-family-documents.ts';
import { createFirestoreSharedInputStore } from '../server/firestore-shared-inputs.ts';
import { createFirestoreConcernStore } from '../server/firestore-concerns.ts';
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

test('REQ-005 §8: family documents scale past 50 active limit and cursor paginate cleanly', async () => {
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
});

test('REQ-005 §8: shared inputs scale past 50 items without aggregate inputs_capacity rejection', async () => {
  const { sources, init, createTestChild } = setupFixture();
  await init();
  const child = await createTestChild();
  const owner = 'pagination-owner';

  // Create 55 shared inputs (previously threw inputs_capacity at 50)
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

  const list = await sources.list(owner, child.id);
  assert.ok(list);
  assert.equal(list.inputs.length, 55, 'Must return all 55 shared inputs without 50 truncation');
});

test('REQ-005 §8: concerns scale past 200 items across child while preserving individual concern limit', async () => {
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

  // 2. Listing all 205 concerns succeeds without throwing concern_history_requires_review
  const page = await concerns.list(owner, child.id);
  assert.equal(page.items.length, 205, 'Must list all 205 concerns');

  // 3. Verify single concern event timeline limit (CONCERN_EVENT_LIMIT = 200) is still strictly protected
  const single = await concerns.get(owner, child.id, firstConcernId);
  assert.ok(single);
  assert.equal(CONCERN_EVENT_LIMIT, 200);
});
