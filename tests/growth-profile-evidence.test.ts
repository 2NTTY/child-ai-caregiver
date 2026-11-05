import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { serialFirestoreFixture } from './helpers/firestore-session-memory.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestoreSharingStore } from '../server/firestore-sharing.ts';
import { createFirestoreCareStore } from '../server/firestore-care.ts';
import { createFirestoreChatStore } from '../server/firestore-chat.ts';
import { createFirestoreMemoryStore } from '../server/firestore-memory.ts';
import { createFirestoreOnlineStore } from '../server/firestore-online.ts';
import { createFirestoreGrowthStore, firestoreGrowthSchema } from '../server/firestore-growth.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { handleGrowthRequest } from '../server/growth-api.ts';
import { createGrowthApi, GrowthApiError } from '../src/client/growth-api.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import type { GrowthAttention, GrowthPage, GrowthTopicAction } from '../src/shared/growth.ts';

const signal = () => new AbortController().signal;
const profile = { age: { kind: 'unknown' as const }, dueDate: null, gestationalWeeksRaw: null,
  region: 'HK', language: null, allergies: null, specialNeeds: null, preferences: null, source: 'Synthetic profile', validUntil: null };
function attention(childId: string): GrowthAttention {
  const at = '2026-11-05T00:00:00Z';
  return { id: randomUUID(), childId, topicId: 'solid_food', version: 1, state: 'proposed',
    title: 'Synthetic saved attention', kind: 'observe', whyNow: 'Saved reason', advice: 'Saved advice', limits: 'Saved limit',
    basis: { stage: 'synthetic', ruleRevision: 'synthetic', sourceHash: 'a'.repeat(64), values: { private: 'unshared-value' } },
    evidence: { profileVersion: 1, facts: [{ id: randomUUID(), version: 1 }] },
    source: { sourceId: 'synthetic', versionId: randomUUID(), chunkId: randomUUID(), contentHash: 'b'.repeat(64),
      url: 'https://example.test/source', title: 'Saved source', section: '1', checkedAt: at, excerpt: 'Saved excerpt' },
    sourceAvailable: true, createdAt: at, updatedAt: at, snoozeUntil: null, previousId: null,
    newReason: '', taskId: randomUUID(), taskState: 'scheduled', lastAction: 'proposed', actorUserId: null, note: '' };
}
async function fixture() {
  const fake = serialFirestoreFixture(), options = { database: fake.database, cipher: createStorageCipher(Buffer.alloc(32, 85)),
    projectId: 'synthetic-growth-evidence', namespace: 'growth_evidence' };
  const authority = createFirestoreAuthority(options), sharing = createFirestoreSharingStore(options);
  const care = createFirestoreCareStore(options), chat = createFirestoreChatStore(options);
  const memory = createFirestoreMemoryStore({ ...options, care, chat });
  const growth = createFirestoreGrowthStore({ ...options, care, memory, online: createFirestoreOnlineStore(options) });
  const data = new FirestoreDomainData(options);
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  for (const userId of ['parent', 'viewer']) {
    const email = userId + '@example.test';
    await authority.issueInvitation({ email, operationId: randomUUID(), expiresAt: new Date(Date.now() + 86400000).toISOString() });
    await authority.admitIdentity({ userId, email, emailVerified: true });
    await authority.acknowledge({ userId, operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  }
  const child = await authority.createChild({ userId: 'parent', operationId: randomUUID(), displayName: 'Synthetic child' });
  const childId = child.child.id;
  async function seed(item = attention(childId)) {
    await authority.runTransaction('parent', childId, async b => {
      const saved = firestoreGrowthSchema.parse({ item, lastRequest: null });
      b.transaction.create(data.ref('growth_attention', 'growth-attention', item.id), {
        ...data.tags(b.scope), attentionId: item.id, createdAt: item.createdAt,
        ...data.seal('growth-attention', item.id, b.scope, firestoreGrowthSchema, saved, item.version),
      });
    });
    return item;
  }
  async function share(modules: ('growth' | 'profile')[]) {
    let space = await sharing.create('parent', { operationId: randomUUID(), kind: 'family', name: 'Synthetic family' });
    const invitation = await sharing.invite('parent', { operationId: randomUUID(), spaceId: space.id, expectedVersion: space.version,
      email: 'viewer@example.test', role: 'viewer', expiresAt: new Date(Date.now() + 86400000).toISOString() });
    space = await sharing.acceptInvitation('viewer', { operationId: randomUUID(), token: invitation.token });
    return sharing.share('parent', { operationId: randomUUID(), spaceId: space.id, expectedVersion: space.version, childId, modules });
  }
  function client(spaceId?: string, intercept?: (response: Response, init?: RequestInit) => Promise<Response>) {
    const calls: { method: string; body?: BodyInit | null }[] = [];
    const fetcher: typeof fetch = async (url, init) => {
      const request = new Request(url, init), selected = new URL(request.url).searchParams.get('spaceId');
      assert.equal(new URL(request.url).origin, 'https://synthetic.invalid');
      assert.equal(selected, spaceId ?? null);
      assert.equal(request.headers.get('x-expected-user-id'), spaceId ? 'viewer' : 'parent');
      calls.push({ method: request.method, body: init?.body });
      const response = await handleGrowthRequest(request, spaceId ? 'viewer' : 'parent',
        spaceId ? growth.forSharedSpace(spaceId) : growth, async () => true);
      return intercept ? intercept(response, init) : response;
    };
    return { api: createGrowthApi('https://synthetic.invalid', fetcher, spaceId ? { spaceId } : undefined), calls };
  }
  return { fake, authority, sharing, care, growth, childId, seed, share, client };
}

for (const scenario of ['omitted', 'mismatched', 'missing', 'deleted'] as const) {
  test(`shared ${scenario} profile evidence stays readable without restoring withheld references`, async () => {
    const f = await fixture(), saved = await f.seed();
    if (scenario !== 'missing') await f.care.saveProfile('parent', f.childId, profile, 0, 'Synthetic setup');
    if (scenario === 'mismatched') await f.care.saveProfile('parent', f.childId, profile, 1, 'Synthetic revision');
    if (scenario === 'deleted') await f.care.deleteProfile('parent', f.childId, 1);
    const space = await f.share(scenario === 'omitted' ? ['growth'] : ['growth', 'profile']);
    const before = structuredClone([...f.fake.records]);
    const { api } = f.client(space.id), page = await api.getPage(f.childId, signal(), 'viewer');
    assert.equal(page.items.length, 1);
    assert.equal(page.items[0].id, saved.id);
    assert.deepEqual(page.items[0].evidence, { profileVersion: 0, facts: [] });
    assert.deepEqual(page.items[0].basis.values, {});
    assert.equal(page.items[0].taskId, null);
    assert.equal(page.items[0].taskState, null);
    assert.deepEqual(page.items[0].source, saved.source);
    assert.equal(page.canManage, false);
    assert.deepEqual([...f.fake.records], before, 'GET must not rewrite stored evidence');
    await assert.rejects(api.updateTopic(f.childId, 'solid_food', { action: 'set_enabled', enabled: false,
      authorityVersion: page.authorityVersion, expectedVersion: 1, confirm: true }, signal(), 'viewer'),
    (error: unknown) => error instanceof GrowthApiError && error.code === 'shared_domain_read_only');
  });
}

test('disclosed matching evidence and private historical evidence retain positive versions', async () => {
  const f = await fixture(); await f.seed();
  await f.care.saveProfile('parent', f.childId, profile, 0, 'Synthetic setup');
  const space = await f.share(['growth', 'profile']);
  assert.equal((await f.client(space.id).api.getPage(f.childId, signal(), 'viewer')).items[0].evidence.profileVersion, 1);
  await f.care.saveProfile('parent', f.childId, profile, 1, 'Synthetic revision');
  assert.equal((await f.client().api.getPage(f.childId, signal(), 'parent')).items[0].evidence.profileVersion, 1);
});

test('empty shared window remains empty and read-only without a profile', async () => {
  const f = await fixture(), space = await f.share(['growth']);
  const page = await f.client(space.id).api.getPage(f.childId, signal(), 'viewer');
  assert.deepEqual(page.items, []); assert.equal(page.canManage, false);
});

async function importUnsupported(f: Awaited<ReturnType<typeof fixture>>) {
  const source = attention(randomUUID());
  return f.authority.runTransaction('parent', f.childId, async b => {
    const prepared = await f.growth.prepareImportedAttention(b, randomUUID(), { section: 'growth_attention', childId: source.childId,
      value: { item: source, lastRequest: null }, source: { serverId: 'https://source.test', accountId: 'source',
        packageId: randomUUID(), packageVersion: 1, manifestSha256: 'c'.repeat(64), path: 'data/growth.json', rowIndex: 0 } }, 'trusted');
    prepared.commit(); return prepared.value.item;
  });
}
test('real private import sentinel is readable through GET and successful topic receipts', async () => {
  const f = await fixture(), imported = await importUnsupported(f);
  assert.deepEqual(imported.evidence, { profileVersion: 0, facts: [] });
  assert.equal(imported.state, 'inapplicable');
  const { api, calls } = f.client();
  const page = await f.growth.list('parent', f.childId);
  assert.equal(page.items[0].sourceAvailable, false);
  assert.equal(page.items[0].evidence.profileVersion, 0);
  const change: GrowthTopicAction = { action: 'set_enabled', enabled: false, authorityVersion: page.authorityVersion, expectedVersion: 1, confirm: true };
  const first = await api.updateTopic(f.childId, 'solid_food', change, signal(), 'parent');
  assert.equal(first.topics.find(topic => topic.id === 'solid_food')?.version, 2);
  assert.equal((await api.getPage(f.childId, signal(), 'parent')).items[0].evidence.profileVersion, 0);
  const second = await api.updateTopic(f.childId, 'solid_food', { ...change, enabled: true, expectedVersion: 2,
    authorityVersion: first.authorityVersion }, signal(), 'parent');
  assert.equal(second.topics.find(topic => topic.id === 'solid_food')?.version, 3);
  assert.equal(second.items[0].evidence.profileVersion, 0);
  assert.deepEqual(calls.map(call => call.method), ['POST', 'GET', 'POST']);
});

test('lost topic reply still requires exact original review and replay with an imported zero row', async () => {
  const f = await fixture(); await importUnsupported(f);
  let loseNext = true;
  const { api, calls } = f.client(undefined, async (response, init) => {
    if (init?.method === 'POST' && loseNext) { loseNext = false; assert.equal(response.status, 200); throw Error('Synthetic lost response'); }
    return response;
  });
  const page = await api.getPage(f.childId, signal(), 'parent');
  const change: GrowthTopicAction = { action: 'set_enabled', enabled: false, authorityVersion: page.authorityVersion, expectedVersion: 1, confirm: true };
  await assert.rejects(api.updateTopic(f.childId, 'solid_food', change, signal(), 'parent'), GrowthApiError);
  await assert.rejects(api.updateTopic(f.childId, 'solid_food', { ...change, enabled: true }, signal(), 'parent'),
    (error: unknown) => error instanceof GrowthApiError && error.code === 'check_original_growth');
  const read = await api.getPage(f.childId, signal(), 'parent');
  assert.equal(read.topics.find(topic => topic.id === 'solid_food')?.version, 2);
  const replay = await api.updateTopic(f.childId, 'solid_food', change, signal(), 'parent');
  assert.equal(replay.topics.find(topic => topic.id === 'solid_food')?.version, 2);
  assert.equal(calls.filter(call => call.method === 'POST').length, 2);
  assert.equal(calls[1].body, calls[3].body);
});

function wirePage(): GrowthPage {
  return { authorityVersion: 'synthetic:1', items: [attention('00000000-0000-4000-8000-000000000001')], historyHasMore: false,
    topics: [{ id: 'solid_food', title: 'Synthetic topic', version: 1, disabled: false, inputs: [] }],
    notices: [], eligibleAssignees: [], canManage: true };
}
const readWire = (page: unknown) => createGrowthApi('https://synthetic.invalid', async () => Response.json({ page }))
  .getPage('00000000-0000-4000-8000-000000000001', signal(), 'parent');
test('only profile evidence admits zero; malformed evidence and ordinary versions remain rejected', async () => {
  for (const value of [null, -1, 0.5, '0', 2147483648]) {
    const page = wirePage(); Object.assign(page.items[0].evidence, { profileVersion: value });
    await assert.rejects(readWire(page), (error: unknown) => error instanceof GrowthApiError && error.readFailure?.category === 'schema');
  }
  for (const field of ['item', 'fact', 'topic', 'inputFact'] as const) {
    const page = wirePage();
    if (field === 'item') page.items[0].version = 0;
    if (field === 'fact') page.items[0].evidence.facts[0].version = 0;
    if (field === 'topic') page.topics[0].version = 0;
    if (field === 'inputFact') page.topics[0].inputs = [{ key: 'synthetic', label: 'Synthetic', choices: [], value: null,
      conflict: false, factRefs: [{ id: randomUUID(), version: 0 }] }];
    await assert.rejects(readWire(page), (error: unknown) => error instanceof GrowthApiError && error.readFailure?.category === 'schema');
  }
});

test('zero does not weaken item scope, duplicate identities or topic receipt matching', async () => {
  const page = wirePage(); page.items[0].evidence.profileVersion = 0;
  const wrongChild = structuredClone(page); wrongChild.items[0].childId = randomUUID();
  await assert.rejects(readWire(wrongChild), (error: unknown) => error instanceof GrowthApiError && error.readFailure?.category === 'scope');
  const duplicate = structuredClone(page); duplicate.items.push(duplicate.items[0]);
  await assert.rejects(readWire(duplicate), (error: unknown) => error instanceof GrowthApiError && error.readFailure?.category === 'duplicates');
  let count = 0;
  const api = createGrowthApi('https://synthetic.invalid', async () => { count++; return Response.json({ page }); });
  const change: GrowthTopicAction = { action: 'set_enabled', enabled: false, authorityVersion: 'synthetic:1', expectedVersion: 1, confirm: true };
  await assert.rejects(api.updateTopic(page.items[0].childId, 'solid_food', change, signal(), 'parent'), GrowthApiError);
  await assert.rejects(api.updateTopic(page.items[0].childId, 'solid_food', change, signal(), 'parent'),
    (error: unknown) => error instanceof GrowthApiError && error.code === 'check_original_growth');
  assert.equal(count, 1);
});
