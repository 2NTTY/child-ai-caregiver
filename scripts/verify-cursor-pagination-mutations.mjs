import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreFamilyDocumentStore } from '../server/firestore-family-documents.ts';
import { createFirestoreSharedInputStore } from '../server/firestore-shared-inputs.ts';
import { createFirestoreConcernStore } from '../server/firestore-concerns.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { CONCERN_EVENT_LIMIT } from '../src/shared/concerns.ts';
import { firestoreDomainFixture } from '../tests/helpers/firestore-domain-memory.ts';

console.log('--- REQ-005 Cursor Pagination & Data Scale Mutation Verification ---');

function setupTestEnvironment() {
  const fake = firestoreDomainFixture();
  const options = {
    database: fake.database,
    cipher: createStorageCipher(Buffer.alloc(32, 107)),
    projectId: 'test-cursor-pagination-project',
    namespace: 'test_cursor_pagination',
  };
  const authority = createFirestoreAuthority(options);
  const online = createFirestoreOnlineStore(options);
  const documents = createFirestoreFamilyDocumentStore(options);
  const sources = createFirestoreSharedInputStore(options);
  const concerns = createFirestoreConcernStore(options);

  async function bootstrap(userId = 'scale-owner') {
    await authority.initializeControl({ enabled: true, generation: randomUUID() });
    const email = `${userId}@example.test`;
    await authority.issueInvitation({ email, expiresAt: new Date(Date.now() + 60_000).toISOString(), operationId: randomUUID() });
    await authority.admitIdentity({ userId, email, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    const { child } = await authority.createChild({ userId, operationId: randomUUID(), displayName: '規模驗證童' });
    return { child, userId };
  }

  return { authority, online, documents, sources, concerns, bootstrap };
}

// 1. Invariant Check 1: Family Documents > 50 Active Documents Creation
console.log('[1/5] Invariant Check 1: Verifying active family documents scale past legacy 50 wall...');
{
  const { documents, bootstrap } = setupTestEnvironment();
  const { child, userId } = await bootstrap('doc-scale-owner');

  const docIds = [];
  for (let i = 0; i < 55; i++) {
    const doc = await documents.create(userId, child.id, {
      kind: 'preparation',
      purpose: 'appointment',
      title: `Doc ${i}`,
      eventDate: '2026-11-07',
      period: { from: '2026-11-01', to: '2026-11-30' },
    }, randomUUID());
    assert.ok(doc, `Document ${i} should be created`);
    docIds.push(doc.id);
  }
  assert.equal(docIds.length, 55, 'All 55 documents must be created without document_limit rejection');
  console.log('✓ Invariant Check 1 passed: 55 active documents created without legacy 50 cap.');
}

// 2. Invariant Check 2: Family Documents Cursor Pagination & Deterministic Navigation
console.log('[2/5] Invariant Check 2: Verifying cursor pagination across 55 documents...');
{
  const { documents, bootstrap } = setupTestEnvironment();
  const { child, userId } = await bootstrap('doc-paged-owner');

  for (let i = 0; i < 55; i++) {
    await documents.create(userId, child.id, {
      kind: 'preparation',
      purpose: 'school',
      title: `Paged Doc ${String(i).padStart(3, '0')}`,
      eventDate: '2026-11-07',
      period: { from: '2026-11-01', to: '2026-11-30' },
    }, randomUUID());
  }

  const p1 = await documents.list(userId, child.id, { limit: 20 });
  assert.equal(p1.items.length, 20);
  assert.equal(p1.hasMore, true);
  assert.ok(p1.nextCursor);

  const p2 = await documents.list(userId, child.id, { limit: 20, cursor: p1.nextCursor });
  assert.equal(p2.items.length, 20);
  assert.equal(p2.hasMore, true);
  assert.ok(p2.nextCursor);

  const p3 = await documents.list(userId, child.id, { limit: 20, cursor: p2.nextCursor });
  assert.equal(p3.items.length, 15);
  assert.equal(p3.hasMore, false);
  assert.equal(p3.nextCursor, null);

  const allIds = [...p1.items, ...p2.items, ...p3.items].map(d => d.id);
  assert.equal(new Set(allIds).size, 55, 'Cursor pagination must cover exactly 55 unique items');
  console.log('✓ Invariant Check 2 passed: 3-page cursor pagination traversed 55 items with zero drop or duplication.');
}

// 3. Invariant Check 3: Shared Inputs scale past 50 live items
console.log('[3/5] Invariant Check 3: Verifying shared inputs scale past legacy 50 wall...');
{
  const { sources, bootstrap } = setupTestEnvironment();
  const { child, userId } = await bootstrap('sources-scale-owner');

  for (let i = 0; i < 55; i++) {
    const input = await sources.create(userId, child.id, {
      kind: 'personal_source',
      sourceLabel: `Source ${i}`,
      sourceUrl: null,
      sourceDateText: null,
      sourceNotes: '',
      text: `Body text for source ${i}`,
    });
    assert.ok(input);
  }

  const list = await sources.list(userId, child.id);
  assert.equal(list.inputs.length, 55, 'Shared inputs list must return all 55 items without 50 truncation');
  console.log('✓ Invariant Check 3 passed: 55 shared inputs created and returned without inputs_capacity limit.');
}

// 4. Invariant Check 4: Concerns scale past 200 items across child
console.log('[4/5] Invariant Check 4: Verifying child concerns scale past legacy 200 aggregate wall...');
{
  const { concerns, bootstrap } = setupTestEnvironment();
  const { child, userId } = await bootstrap('concern-scale-owner');

  for (let i = 0; i < 205; i++) {
    const item = await concerns.create(userId, child.id, {
      title: `Concern ${i}`,
      reason: 'Scale verification',
      followUpAt: null,
      observedAt: new Date().toISOString(),
      observation: `Obs ${i}`,
      links: { recordId: null, taskId: null, attentionId: null },
    }, randomUUID());
    assert.ok(item);
  }

  const list = await concerns.list(userId, child.id);
  assert.equal(list.items.length, 205, 'Concerns list must return all 205 concerns without concern_history_requires_review error');
  console.log('✓ Invariant Check 4 passed: 205 child concerns created and listed without 200 aggregate wall.');
}

// 5. Invariant Check 5: Domain Invariant Guards (Duplicate Growth Reports & Timeline Event Bounds)
console.log('[5/5] Invariant Check 5: Verifying safety invariants remain intact...');
{
  const { documents, bootstrap } = setupTestEnvironment();
  const { child, userId } = await bootstrap('safety-guard-owner');

  const reportReq = {
    kind: 'growth_report',
    purpose: 'handoff',
    title: '生長定期報告',
    eventDate: '2026-06-30',
    period: { from: '2026-01-01', to: '2026-06-30' },
    reportMode: 'fixed',
  };

  await documents.create(userId, child.id, reportReq, randomUUID());
  await assert.rejects(
    documents.create(userId, child.id, reportReq, randomUUID()),
    (err) => err.code === 'report_exists',
    'Duplicate growth report in same period must still be rejected'
  );

  assert.equal(CONCERN_EVENT_LIMIT, 200, 'Individual concern timeline limit must stay at 200');
  console.log('✓ Invariant Check 5 passed: growth report duplication check and timeline limits verified.');
}

console.log('================================================================');
console.log('All Cursor Pagination & Data Scale Invariant Checks PASSED!');
console.log('================================================================');
