import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreMemoryStore } from '../server/firestore-memory.ts';
import { createFirestoreFamilyDocumentStore } from '../server/firestore-family-documents.ts';
import { createFirestoreProductAgentStore } from '../server/firestore-product-agent-store.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';

test('Firestore documents reuse authoritative data, confirm one patch, resume a complete report and invalidate changed sources', async () => {
  const fake = firestoreDomainFixture(), options = { database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 73)),
    projectId: 'synthetic-documents-core', namespace: 'synthetic_docs_core' };
  const authority = createFirestoreAuthority(options), care = createFirestoreCareStore(options), chat = createFirestoreChatStore(options);
  const memory = createFirestoreMemoryStore({ ...options, care, chat });
  const online = createFirestoreOnlineStore({ ...options, mutations: [care.mutation, chat.mutation, memory.mutation] });
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  await authority.issueInvitation({ email: 'parent@example.test', expiresAt: new Date(Date.now() + 60000).toISOString(), operationId: randomUUID() });
  await authority.admitIdentity({ userId: 'parent', email: 'parent@example.test', emailVerified: true });
  await authority.acknowledge({ userId: 'parent', operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const { child } = await authority.createChild({ userId: 'parent', operationId: randomUUID(), displayName: '合成文件孩子' });
  async function submit(path: string, payload: unknown) {
    return (await online.submit('parent', { path, payload,
      operation: { ...await online.context('parent', { path, payload }), opId: randomUUID(), deviceId: randomUUID() } })).result as any;
  }
  const base = '/api/children/' + child.id;
  const { record } = await submit(base + '/records', { text: '昨晚的原始交代\n尚未確認事件時間。' });
  const documents = createFirestoreFamilyDocumentStore(options), agents = createFirestoreProductAgentStore({ ...options, care, chat, memory, online,
    async validateKnowledge() { throw Error('Not used by this data-only check'); },
    async continuationKnowledge() { throw Error('Not used by this data-only check'); } });
  const { message } = await submit(base + '/messages', { text: '請整理到診準備單，再把標題改成下週到診。' });
  const claim = await agents.store.claim('parent', child.id, { kind: 'interactive', reference: message.id }, 'product-interactive'); assert.ok(claim);
  const opId = randomUUID(), request = { kind: 'preparation' as const, purpose: 'appointment' as const, title: '到診準備', eventDate: null,
    period: { from: '2026-01-01', to: '2026-12-31' } };
  fake.loseReply();
  await assert.rejects(agents.store.writeDocument(claim.scope, claim.runId, opId, '請整理到診準備單', { request }), /lost commit acknowledgement/);
  let item = await agents.store.writeDocument(claim.scope, claim.runId, opId, '請整理到診準備單', { request }); assert.ok(item?.current);
  assert.equal((await documents.list('parent', child.id))!.items.length, 1);
  assert.ok(item.current.sources.some(source => source.resourceId === record.id && source.text.includes(record.text)));
  const originalSections = structuredClone(item.current.sections), authorityVersion = (await documents.describe('parent', child.id, item.id))!.authorityVersion;
  const proposal = await agents.store.propose(claim.scope, claim.runId, 'patch-title', { kind: 'family_document_change', documentId: item.id,
    change: { action: 'patch', expectedVersion: item.version, authorityVersion, edits: [{ op: 'set_metadata', title: '下週到診' }] } }); assert.ok(proposal);
  const decision = { expectedVersion: proposal.version, decision: 'accept' as const, confirmShared: true };
  await agents.store.decide('parent', child.id, claim.runId, proposal.id, decision);
  await agents.store.decide('parent', child.id, claim.runId, proposal.id, decision);
  item = await createFirestoreFamilyDocumentStore(options).get('parent', child.id, item.id); assert.ok(item?.current);
  assert.equal(item.version, 2); assert.equal(item.current.title, '下週到診'); assert.deepEqual(item.current.sections, originalSections);
  assert.equal((await agents.store.documentReceipts!(claim.scope, claim.runId))!.receipts[0].documentId, item.id);
  await assert.rejects(documents.change('parent', child.id, item.id, { action: 'archive', expectedVersion: 1, authorityVersion }, randomUUID()),
    (error: any) => error.code === 'document_changed');
  await assert.rejects(documents.get('outsider', child.id, item.id));
  let report = await documents.create('parent', child.id, { ...request, kind: 'growth_report', purpose: 'family', reportMode: 'fixed' }, randomUUID()); assert.ok(report);
  for (let batch = 0; report.report?.phase === 'building' && batch < 5; batch++) {
    const current: NonNullable<Awaited<ReturnType<typeof documents.describe>>> = (await documents.describe('parent', child.id, report.id))!;
    report = (await documents.change('parent', child.id, report.id, { action: 'refresh', expectedVersion: report.version,
      authorityVersion: current.authorityVersion }, randomUUID()))!;
  }
  assert.equal(report.report?.phase, 'complete'); assert.equal(report.current?.reportCoverage?.counts.recordsUnknownTime, 1);
  assert.equal(report.current?.reportCoverage?.periodKind, 'annual');
  const snapshot = await documents.exportSnapshot('parent', child.id, report.id, { snapshotId: report.current!.id, snapshotVersion: report.current!.version,
    authorityVersion, purpose: 'family', includeSources: true, includeRevision: false });
  assert.deepEqual(snapshot, report.current);
  await submit(base + '/records', { text: '新增一項後應重新整理報告。' });
  const stale = await documents.get('parent', child.id, report.id);
  assert.equal(stale?.report?.phase, 'needs_update'); assert.equal(stale?.current, null);
});
