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
import { createSharedInputApi } from '../src/client/shared-input-api.ts';
import { createConcernsApi } from '../src/client/concerns-api.ts';
import { handleSharedInputRequest } from '../server/shared-input-api.ts';
import { createAgentSourceTools } from '../server/agent-source-tools.ts';
import { handleConcernRequest } from '../server/concern-api.ts';
import { createAgentConcernTools } from '../server/agent-concern-tools.ts';

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

  return { authority, online, documents, sources, concerns, init, createTestChild, fake };
}

test('family documents scale past legacy 50 cap with cursor pagination and duplicate guards', async () => {
  const { documents, init, createTestChild, fake } = setupFixture();
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

  // 5. Verify growth report duplicate check catches legacy unindexed documents lacking envelope kind (Round 2 audit probe)
  const legacyRequest: DocumentRequest = {
    kind: 'growth_report',
    purpose: 'handoff',
    title: '歷史既有生長報告',
    eventDate: '2026-03-31',
    period: { from: '2026-01-01', to: '2026-03-31' },
    reportMode: 'fixed',
  };
  const legacyDoc = await documents.create(owner, child.id, legacyRequest, randomUUID());
  assert.ok(legacyDoc);

  // Simulate pre-R1 legacy record: remove the 'kind' metadata from the Firestore envelope
  for (const [key, record] of fake.records.entries()) {
    if (key.includes(legacyDoc.id)) {
      delete record.kind;
    }
  }

  // Create another indexed report with a different period
  const indexedRequest: DocumentRequest = {
    kind: 'growth_report',
    purpose: 'handoff',
    title: '新版生長報告',
    eventDate: '2026-09-30',
    period: { from: '2026-07-01', to: '2026-09-30' },
    reportMode: 'fixed',
  };
  const indexedDoc = await documents.create(owner, child.id, indexedRequest, randomUUID());
  assert.ok(indexedDoc);

  // Attempt to create duplicate of the legacy report (same period & reportMode)
  await assert.rejects(
    documents.create(owner, child.id, {
      ...legacyRequest,
      title: '嘗試建立重複歷史報告',
    }, randomUUID()),
    (err: any) => err.code === 'report_exists',
    'Duplicate of legacy growth report lacking envelope kind must be rejected with report_exists'
  );

  // 6. Cursor tamper rejection
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

  // 5. Default 2-argument list call discloses nextCursor and hasMore (P1-A fix)
  const noArgList = await sources.list(owner, child.id);
  assert.equal(noArgList.inputs.length, 50);
  assert.equal(noArgList.hasMore, true);
  assert.ok(noArgList.nextCursor, '2-arg store.list call must disclose nextCursor');

  // 6. End-to-end HTTP Client API pagination (navigates past item 50 to items 51-55)
  const fetcher: typeof fetch = async (url, init) => {
    const req = new Request(url, init);
    return handleSharedInputRequest(req, owner, sources);
  };
  const api = createSharedInputApi('http://localhost', fetcher);
  const signal = new AbortController().signal;

  const apiPage1 = await api.inputs(child.id, signal, owner);
  assert.equal(apiPage1.inputs.length, 50);
  assert.equal(apiPage1.hasMore, true);
  assert.ok(apiPage1.nextCursor, 'Client API must return nextCursor for page 1');

  const apiPage2 = await api.inputs(child.id, signal, owner, { cursor: apiPage1.nextCursor });
  assert.equal(apiPage2.inputs.length, 5);
  assert.equal(apiPage2.hasMore, false);
  assert.equal(apiPage2.nextCursor, null);
  const apiRetrievedIds = [...apiPage1.inputs, ...apiPage2.inputs].map(i => i.id);
  assert.equal(new Set(apiRetrievedIds).size, 55, 'Client API must retrieve all 55 unique inputs');

  // 7. End-to-end Agent tool list_private_sources pagination
  const agentRunContext = {
    scope: { userId: owner, workspaceId: child.id, childId: child.id, authorizationVersion: '1.0', dataVersion: '1:0' },
    runId: randomUUID(),
    budget: {} as any,
  };
  const agentTools = createAgentSourceTools(sources, {} as any, agentRunContext, async () => true);
  const listSourcesTool = agentTools.tools.find(t => t.name === 'list_private_sources')!;

  const toolPage1 = await listSourcesTool.execute({}, { callId: 'c1', signal } as any);
  assert.equal(toolPage1.status, 'succeeded');
  const page1Data = (toolPage1.data as any).result;
  assert.equal(page1Data.sources.length, 50);
  assert.equal(page1Data.hasMore, true);
  assert.ok(page1Data.nextCursor, 'Agent tool page 1 must return nextCursor');

  const toolPage2 = await listSourcesTool.execute({ cursor: page1Data.nextCursor }, { callId: 'c2', signal } as any);
  assert.equal(toolPage2.status, 'succeeded');
  const page2Data = (toolPage2.data as any).result;
  assert.equal(page2Data.sources.length, 5);
  assert.equal(page2Data.hasMore, false);
  assert.equal(page2Data.nextCursor, null);
  const toolRetrievedIds = [...page1Data.sources, ...page2Data.sources].map((s: any) => s.id);
  assert.equal(new Set(toolRetrievedIds).size, 55, 'Agent tool must retrieve all 55 unique sources across cursor pages');
});

test('concerns scale past legacy 200 aggregate wall with cursor pagination and timeline limit enforcement', async () => {
  const { concerns, init, createTestChild, authority } = setupFixture();
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

  // 5. End-to-end HTTP API concern pagination (handleConcernRequest)
  const req1 = new Request(`http://localhost/api/children/${child.id}/concerns?limit=50`, {
    headers: { 'x-expected-user-id': owner },
  });
  const res1 = await handleConcernRequest(req1, owner, concerns, async () => true);
  assert.equal(res1.status, 200);
  const body1 = await res1.json();
  assert.equal(body1.page.items.length, 50);
  assert.equal(body1.page.hasMore, true);
  assert.ok(body1.page.nextCursor, 'HTTP concerns page 1 must have nextCursor');

  const req2 = new Request(`http://localhost/api/children/${child.id}/concerns?limit=50&cursor=${encodeURIComponent(body1.page.nextCursor)}`, {
    headers: { 'x-expected-user-id': owner },
  });
  const res2 = await handleConcernRequest(req2, owner, concerns, async () => true);
  assert.equal(res2.status, 200);
  const body2 = await res2.json();
  assert.equal(body2.page.items.length, 50);

  // 6. End-to-end Agent tool read_concerns: direct ID lookup and empty-page search pagination (P1-A fix)
  const concernAgentContext = {
    scope: { userId: owner, workspaceId: child.id, childId: child.id, authorizationVersion: '1.0', dataVersion: '1:0' },
    runId: randomUUID(),
    budget: {} as any,
  };
  const concernTools = createAgentConcernTools(concerns, {} as any, concernAgentContext, async () => true);
  const readConcernsTool = concernTools.find(t => t.name === 'read_concerns')!;
  const signal = new AbortController().signal;

  // Direct read of concern #150 by concernId (far past the first 50 items)
  const concern150Id = allConcernIds[150];
  const directRead = await readConcernsTool.execute({ concernId: concern150Id }, { callId: 'cr-1', signal } as any);
  assert.equal(directRead.status, 'succeeded', 'Direct concern read must succeed for items past page 1');
  assert.equal((directRead.data as any).result.concern.id, concern150Id);

  // Search query on page 1 matching item 150 yields 0 items on page 1, but discloses hasMore: true and nextCursor!
  const searchPage1 = await readConcernsTool.execute({
    searchText: '持續關注事項 150',
    cursor: null,
  }, { callId: 'cr-2', signal } as any);
  assert.equal(searchPage1.status, 'succeeded');
  const sData1 = (searchPage1.data as any).result;
  assert.equal(sData1.items.length, 0, 'Page 1 has no matches for concern 150');
  assert.equal(sData1.hasMore, true, 'hasMore must be true when next page exists');
  assert.ok(sData1.nextCursor, 'nextCursor must be returned when empty match has more pages');

  // Continue reading with nextCursor to locate concern #150 across pages
  let cursor = sData1.nextCursor;
  let found = false;
  while (cursor && !found) {
    const nextSearch = await readConcernsTool.execute({
      searchText: '持續關注事項 150',
      cursor,
    }, { callId: 'cr-next', signal } as any);
    assert.equal(nextSearch.status, 'succeeded');
    const nextData = (nextSearch.data as any).result;
    if (nextData.items.length > 0) {
      assert.ok(nextData.items.some((item: any) => item.id === concern150Id));
      found = true;
    }
    cursor = nextData.nextCursor;
  }
  assert.equal(found, true, 'Concern #150 must be found by continuing search via nextCursor');

  // 7. End-to-end Concerns Client API pagination (src/client/concerns-api.ts via handleConcernRequest)
  const concernFetcher: typeof fetch = async (url, init) => {
    const req = new Request(url, init);
    return handleConcernRequest(req, owner, concerns, async () => true);
  };
  const concernsClient = createConcernsApi('http://localhost', concernFetcher);

  // 7a. Empty concerns list does not throw ConcernApiError (schema regression guard)
  const emptyChild = (await authority.createChild({ userId: owner, operationId: randomUUID(), displayName: 'Empty Concerns Child' })).child;
  const emptyPage = await concernsClient.getPage(emptyChild.id, signal, owner);
  assert.equal(emptyPage.items.length, 0);
  assert.equal(emptyPage.hasMore, false);
  assert.equal(emptyPage.nextCursor, null);

  // 7b. Client getPage pagination with limit and cursor across 205 items
  const cClientPage1 = await concernsClient.getPage(child.id, signal, owner, { limit: 50 });
  assert.equal(cClientPage1.items.length, 50);
  assert.equal(cClientPage1.hasMore, true);
  assert.ok(cClientPage1.nextCursor);

  const cClientPage2 = await concernsClient.getPage(child.id, signal, owner, { limit: 50, cursor: cClientPage1.nextCursor });
  assert.equal(cClientPage2.items.length, 50);
  assert.equal(cClientPage2.hasMore, true);
  assert.ok(cClientPage2.nextCursor);

  // 8. Agent read_concerns boundary traversal: 21, 40, and 55 items (P1-B regression guards)
  // 8a. 40 items traversal: Call 1 yields 20 items and non-null nextCursor; Call 2 yields remaining 20 and null cursor
  const child40 = (await authority.createChild({ userId: owner, operationId: randomUUID(), displayName: 'Child 40 Concerns' })).child;
  const child40Ids: string[] = [];
  for (let i = 1; i <= 40; i++) {
    const created = await concerns.create(owner, child40.id, {
      title: `關注 40-${i}`,
      reason: `第 ${i} 項記錄`,
      observation: `觀察 ${i}`,
      observedAt: '2026-11-07T00:00:00.000Z',
      links: { recordId: null, taskId: null, attentionId: null },
      followUpAt: null,
    }, randomUUID());
    child40Ids.push(created.id);
  }
  const ctx40 = {
    scope: { userId: owner, workspaceId: child40.id, childId: child40.id, authorizationVersion: '1.0', dataVersion: '1:0' },
    runId: randomUUID(),
    budget: {} as any,
  };
  const tools40 = createAgentConcernTools(concerns, {} as any, ctx40, async () => true);
  const readTool40 = tools40.find(t => t.name === 'read_concerns')!;

  const read40Page1 = await readTool40.execute({}, { callId: 'r40-1', signal } as any);
  assert.equal(read40Page1.status, 'succeeded');
  const r40Data1 = (read40Page1.data as any).result;
  assert.equal(r40Data1.items.length, 20);
  assert.equal(r40Data1.hasMore, true, '40-item list on page 1 must report hasMore: true');
  assert.ok(r40Data1.nextCursor, '40-item list on page 1 must return non-null nextCursor to reach items 21-40');

  const read40Page2 = await readTool40.execute({ cursor: r40Data1.nextCursor }, { callId: 'r40-2', signal } as any);
  assert.equal(read40Page2.status, 'succeeded');
  const r40Data2 = (read40Page2.data as any).result;
  assert.equal(r40Data2.items.length, 20);
  assert.equal(r40Data2.hasMore, false, '40-item list on page 2 must report hasMore: false');
  assert.equal(r40Data2.nextCursor, null);

  const all40Delivered = [...r40Data1.items, ...r40Data2.items].map((it: any) => it.id);
  assert.equal(all40Delivered.length, 40);
  assert.equal(new Set(all40Delivered).size, 40, 'All 40 items must be traversed without skip or duplication');

  // 8b. 21 items traversal: Call 1 yields 20, Call 2 yields 1
  const child21 = (await authority.createChild({ userId: owner, operationId: randomUUID(), displayName: 'Child 21 Concerns' })).child;
  for (let i = 1; i <= 21; i++) {
    await concerns.create(owner, child21.id, {
      title: `關注 21-${i}`,
      reason: `第 ${i} 項記錄`,
      observation: `觀察 ${i}`,
      observedAt: '2026-11-07T00:00:00.000Z',
      links: { recordId: null, taskId: null, attentionId: null },
      followUpAt: null,
    }, randomUUID());
  }
  const ctx21 = {
    scope: { userId: owner, workspaceId: child21.id, childId: child21.id, authorizationVersion: '1.0', dataVersion: '1:0' },
    runId: randomUUID(),
    budget: {} as any,
  };
  const tools21 = createAgentConcernTools(concerns, {} as any, ctx21, async () => true);
  const readTool21 = tools21.find(t => t.name === 'read_concerns')!;

  const read21Page1 = await readTool21.execute({}, { callId: 'r21-1', signal } as any);
  const r21Data1 = (read21Page1.data as any).result;
  assert.equal(r21Data1.items.length, 20);
  assert.equal(r21Data1.hasMore, true);
  assert.ok(r21Data1.nextCursor);

  const read21Page2 = await readTool21.execute({ cursor: r21Data1.nextCursor }, { callId: 'r21-2', signal } as any);
  const r21Data2 = (read21Page2.data as any).result;
  assert.equal(r21Data2.items.length, 1);
  assert.equal(r21Data2.hasMore, false);
  assert.equal(r21Data2.nextCursor, null);

  // 8c. 55 items multi-match search traversal: zero matches skipped
  const child55 = (await authority.createChild({ userId: owner, operationId: randomUUID(), displayName: 'Child 55 Concerns' })).child;
  const targetKeyword = '過敏複查焦點';
  const matchingIndices = new Set([5, 22, 38, 45, 53]);
  for (let i = 1; i <= 55; i++) {
    const isMatch = matchingIndices.has(i);
    await concerns.create(owner, child55.id, {
      title: isMatch ? `關注 55-${i} [${targetKeyword}]` : `關注 55-${i}`,
      reason: `第 ${i} 項描述`,
      observation: `觀察 ${i}`,
      observedAt: '2026-11-07T00:00:00.000Z',
      links: { recordId: null, taskId: null, attentionId: null },
      followUpAt: null,
    }, randomUUID());
  }
  const ctx55 = {
    scope: { userId: owner, workspaceId: child55.id, childId: child55.id, authorizationVersion: '1.0', dataVersion: '1:0' },
    runId: randomUUID(),
    budget: {} as any,
  };
  const tools55 = createAgentConcernTools(concerns, {} as any, ctx55, async () => true);
  const readTool55 = tools55.find(t => t.name === 'read_concerns')!;

  const found55Matches: string[] = [];
  let cur55: string | null = null;
  do {
    const pageRes = await readTool55.execute({
      searchText: targetKeyword,
      cursor: cur55,
    }, { callId: 'r55-search', signal } as any);
    assert.equal(pageRes.status, 'succeeded');
    const pData = (pageRes.data as any).result;
    for (const item of pData.items) {
      found55Matches.push(item.id);
    }
    cur55 = pData.nextCursor;
  } while (cur55);

  assert.equal(found55Matches.length, 5, 'All 5 matching concerns across 55 items must be found in traversal');
  assert.equal(new Set(found55Matches).size, 5, 'No duplicates in search traversal');
});
