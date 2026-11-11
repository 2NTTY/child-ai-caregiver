import assert from 'node:assert/strict';
import test from 'node:test';
import type { Transaction } from '@google-cloud/firestore';
import type { KnowledgeCandidate } from '../src/shared/knowledge.ts';
import { createProactivePublicEvents, createFirestoreProactivePublicStore, type ProactiveManagedPublicDay, type ProactivePublicAudience } from '../server/firestore-proactive-public.ts';
import type { SourceWatchDefinition } from '../server/knowledge-refresh-types.ts';
import { firestoreDomainFixture } from './helpers/firestore-domain-memory.ts';
import { createProactiveEventSources, parseProactivePublicSelections } from '../server/proactive-event-sources.ts';
import { createFirestoreAuthority, type FirestoreAuthorityTransaction } from '../server/firestore-authority.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import type { ChildProfile } from '../src/shared/care.ts';
import { SOURCE_WATCHES } from '../server/knowledge-source-catalog.ts';
import { FirestoreDomainData } from '../server/firestore-domain-data.ts';
import { firestoreTopicStorageSchema } from '../server/firestore-memory.ts';

const at = '2026-11-12T03:00:00.000Z';
const institution: SourceWatchDefinition = { id: 'synthetic-institution', url: 'https://www.fhs.gov.hk/tc_chi/synthetic.html',
  kind: 'page', classification: 'official_guidance', publisher: 'Synthetic official institution',
  termsUrl: 'https://www.fhs.gov.hk/terms', audience: 'public_noncommercial' };
const audience: ProactivePublicAudience = { region: 'HK', age: { basis: 'actual', minMonths: 18, maxMonths: 18 },
  topics: ['care'], confirmedConditions: [], householdRevision: 'authority-revision-1' };
const evidence = (patch: Partial<KnowledgeCandidate> = {}): KnowledgeCandidate => ({
  key: 'synthetic-section', section: 'Synthetic section', sourceExcerpt: 'Synthetic original institution excerpt',
  text: 'Synthetic reviewed announcement', originalText: 'Synthetic original institution excerpt and text', keywords: ['care'],
  applicability: { region: 'HK', ageBasis: 'actual', minAgeMonths: 12, maxAgeMonths: 24, topics: ['care'], conditions: [] },
  chunkId: '11111111-1111-4111-8111-111111111111', sourceId: 'synthetic-source', versionId: '22222222-2222-4222-8222-222222222222',
  versionHash: 'a'.repeat(64), contentHash: 'b'.repeat(64), url: institution.url, title: 'Synthetic announcement', publisher: institution.publisher,
  classification: 'official_guidance', sourcePublishedAt: null, sourceUpdatedAt: null, fetchedAt: at, checkedAt: at,
  reviewState: 'reviewed', usageScope: 'public_noncommercial', distance: null, ...patch,
});
const event = (patch: Partial<ProactiveManagedPublicDay['events'][number]> = {}): ProactiveManagedPublicDay['events'][number] => ({
  eventId: 'synthetic-event', issuerId: institution.id, sourceId: 'synthetic-source', key: 'synthetic-section',
  versionHash: 'a'.repeat(64), contentHash: 'b'.repeat(64), kind: 'announcement', state: 'active', validFrom: null, validUntil: null, ...patch,
});
const page = (events = [event()]): ProactiveManagedPublicDay => ({ day: '2026-11-12', preparedAt: at, complete: true, events });
function fixture() {
  let currentPage: ProactiveManagedPublicDay | null = page(), currentRows = [evidence()];
  const tx = {} as Transaction, reads: string[] = [], calls: unknown[] = [];
  const reader = createProactivePublicEvents({ institutions: [institution],
    async readManagedEvents(transaction, day) { assert.equal(transaction, tx); reads.push(day); return currentPage; },
    knowledge: { async ruleCandidates(transaction, rules, filter) {
      assert.equal(transaction, tx); assert.equal(filter.ageMatch, 'contained'); assert.equal(rules.length, 1);
      calls.push(rules); return currentRows;
    } },
  });
  return { reader, tx, reads, calls, setPage(value: ProactiveManagedPublicDay | null) { currentPage = value; },
    setRows(value: KnowledgeCandidate[]) { currentRows = value; }, read: (who = audience, time = at) => reader.candidates(tx, who, time) };
}

test('public daily absence, staleness and incomplete coverage remain explicit without catalog reads', async () => {
  const f = fixture(); f.setPage(null);
  assert.equal((await f.read()).reason, 'public_events_not_prepared'); assert.equal(f.calls.length, 0);
  f.setPage({ ...page(), day: '2026-11-11' }); assert.equal((await f.read()).reason, 'public_events_stale');
  f.setPage({ ...page(), preparedAt: '2026-11-12T03:00:01.000Z' }); assert.equal((await f.read()).state, 'unavailable');
  f.setPage({ ...page(), complete: false });
  const partial = await f.read(); assert.equal(partial.state, 'ready'); assert.equal(partial.complete, false);
  assert.deepEqual(f.reads, ['2026-11-12', '2026-11-12', '2026-11-12', '2026-11-12']);
  f.setPage(page(Array.from({ length: 9 }, (_, index) => event({ eventId: 'event-' + index }))));
  await assert.rejects(f.read()); assert.equal(f.calls.length, 1, 'Invalid oversize projections never reach exact-source reads');
});

test('assessment identity binds semantic edition and monotonic household applicability revision', async () => {
  const f = fixture(), first = (await f.read()).candidates[0]!;
  assert.equal(first.evidence.sourceId, 'synthetic-source'); assert.equal(first.evidence.reviewState, 'reviewed');
  assert.deepEqual(f.calls[0], [{ sourceId: 'synthetic-source', key: 'synthetic-section' }]);
  assert.equal('distance' in first.evidence, false);
  f.setRows([evidence({ fetchedAt: '2026-11-12T02:59:00.000Z', checkedAt: '2026-11-12T02:59:00.000Z' })]);
  assert.equal((await f.read()).candidates[0]!.assessmentId, first.assessmentId, 'Retrieval timestamps do not create a new event');
  const changed = (await f.read({ ...audience, householdRevision: 'authority-revision-2' })).candidates[0]!;
  assert.notEqual(changed.assessmentId, first.assessmentId); assert.equal(changed.semanticId, first.semanticId);
  assert.notEqual((await f.read({ ...audience, householdRevision: 'authority-revision-3' })).candidates[0]!.assessmentId, first.assessmentId,
    'A household that changes away and becomes applicable again is assessed under its new authority revision');
  f.setRows([evidence({ versionHash: 'c'.repeat(64), contentHash: 'd'.repeat(64), text: 'Synthetic revised meaningful announcement' })]);
  assert.deepEqual((await f.read()).excluded, [{ eventId: 'synthetic-event', reason: 'source_changed' }]);
  f.setPage(page([event({ versionHash: 'c'.repeat(64), contentHash: 'd'.repeat(64) })]));
  assert.notEqual((await f.read()).candidates[0]!.semanticId, first.semanticId);
});

test('original institution binding, public usage, confirmed ages and conditions gate family evidence', async () => {
  const f = fixture();
  for (const [patch, reason] of [
    [{ url: 'https://news.rthk.hk/synthetic-report', publisher: institution.publisher }, 'issuer_unbound'],
    [{ publisher: 'Synthetic unrelated publisher' }, 'issuer_unbound'],
    [{ usageScope: 'internal_noncommercial' }, 'usage_restricted'],
    [{ validUntil: at }, 'inactive'],
    [{ sourcePublishedAt: '2026-11-12T04:00:00.000Z' }, 'inactive'],
    [{ applicability: { ...evidence().applicability, region: 'GB' } }, 'not_applicable'],
    [{ applicability: { ...evidence().applicability, minAgeMonths: 19 } }, 'not_applicable'],
    [{ applicability: { ...evidence().applicability, conditions: ['Synthetic confirmed condition'] } }, 'not_applicable'],
  ] as const) {
    f.setRows([evidence(patch as Partial<KnowledgeCandidate>)]);
    const result = await f.read(); assert.equal(result.candidates.length, 0); assert.equal(result.excluded[0]!.reason, reason);
  }
  f.setRows([evidence()]); assert.equal((await f.read({ ...audience, age: null })).candidates.length, 0);
  assert.equal((await f.read({ ...audience, age: { basis: 'actual', minMonths: 23, maxMonths: 25 } })).candidates.length, 0);
  f.setRows([evidence({ applicability: { ...evidence().applicability, maxAgeMonthsExclusive: true } })]);
  assert.equal((await f.read({ ...audience, age: { basis: 'actual', minMonths: 24, maxMonths: 24 } })).candidates.length, 0);
  f.setRows([evidence({ applicability: { ...evidence().applicability, conditions: ['Synthetic confirmed condition'] } })]);
  assert.equal((await f.read({ ...audience, confirmedConditions: ['Synthetic confirmed condition'] })).candidates.length, 1);
  assert.throws(() => createProactivePublicEvents({ institutions: [{ ...institution, url: 'https://news.rthk.hk/synthetic' }],
    readManagedEvents: async () => null, knowledge: { ruleCandidates: async () => [] } }), /original_institution_required/u);
});

test('recall notices remain assessable while withdrawn or expired events and unavailable publications are excluded', async () => {
  const f = fixture(); f.setPage(page([event({ kind: 'recall' })]));
  assert.equal((await f.read()).candidates[0]!.kind, 'recall');
  for (const patch of [{ state: 'withdrawn' as const }, { validUntil: at }, { validFrom: '2026-11-12T04:00:00.000Z' }]) {
    const calls = f.calls.length; f.setPage(page([event(patch)]));
    assert.equal((await f.read()).excluded[0]!.reason, 'inactive'); assert.equal(f.calls.length, calls);
  }
  f.setPage(page()); f.setRows([]);
  assert.deepEqual((await f.read()).excluded, [{ eventId: 'synthetic-event', reason: 'source_unavailable' }],
    'The existing knowledge publication port returns no evidence after source/watch disable or withdrawal');
});

test('shared Firestore producer replaces one daily projection from current published bindings and withdraws unavailable sources', async () => {
  const f = firestoreDomainFixture(); let current = [evidence()];
  const store = createFirestoreProactivePublicStore({ database: f.database, projectId: 'synthetic-public-project', namespace: 'synthetic_public',
    institutions: [institution], knowledge: { async ruleCandidates(_transaction, rules) {
      assert.deepEqual(rules, [{ sourceId: 'synthetic-source', key: 'synthetic-section' }]); return current;
    } },
  });
  const { versionHash: _versionHash, contentHash: _contentHash, ...selection } = event();
  const prepare = () => f.database.runTransaction(tx => store.prepare(tx, { selections: [selection], complete: true }, at));
  const read = (who = audience) => f.database.runTransaction(tx => store.candidates(tx, who, at));
  assert.equal((await read()).reason, 'public_events_not_prepared');
  await prepare(); assert.equal(f.records.size, 1);
  const projectionPath = 'synthetic_public_proactive_public_days/2026-11-12';
  assert.ok(f.records.has(projectionPath));
  const beforeFamilyReads = structuredClone([...f.records]);
  const original = (await read()).candidates[0]!;
  assert.equal((await read({ ...audience, householdRevision: 'another-family-revision' })).candidates.length, 1);
  assert.deepEqual([...f.records], beforeFamilyReads, 'All families reuse the same global page without family writes or fresh ingestion');
  current = [evidence({ versionHash: 'c'.repeat(64), contentHash: 'd'.repeat(64), text: 'Synthetic revised meaningful announcement' })];
  assert.equal((await read()).excluded[0]!.reason, 'source_changed', 'A stale shared page cannot serve a changed edition before global replacement');
  const changed = await prepare(); assert.equal(changed.events[0]!.versionHash, 'c'.repeat(64));
  assert.notEqual((await read()).candidates[0]!.semanticId, original.semanticId);
  current = []; const withdrawn = await prepare(); assert.equal(withdrawn.events[0]!.state, 'withdrawn');
  assert.equal(withdrawn.events[0]!.versionHash, null); assert.equal((await read()).candidates.length, 0);
  assert.equal(f.records.size, 1, 'A daily refresh replaces the shared page rather than creating per-family or per-attempt copies');
  const raw = f.records.get(projectionPath); raw.page.events[0].state = 'active';
  await assert.rejects(read(), /Active public events require/u);
});

test('formatting-only publication bumps refresh live evidence without repeating the same family assessment', async () => {
  const f = fixture(), first = (await f.read()).candidates[0]!;
  f.setRows([evidence({ versionHash: 'c'.repeat(64), contentHash: 'd'.repeat(64), text: ' Synthetic  reviewed\nannouncement ' })]);
  f.setPage(page([event({ versionHash: 'c'.repeat(64), contentHash: 'd'.repeat(64) })]));
  const next = (await f.read({ ...audience, age: { basis: 'actual', minMonths: 18.1, maxMonths: 18.1 } })).candidates[0]!;
  assert.equal(next.assessmentId, first.assessmentId); assert.equal(next.evidence.versionHash, 'c'.repeat(64));
});

test('age-independent announcements remain eligible without a confirmed age but require existing topic relevance when supplied', async () => {
  const f = fixture(); f.setPage(page([event({ kind: 'announcement' })]));
  f.setRows([evidence({ title: '幼兒餵食公告', applicability: { ...evidence().applicability, ageBasis: 'any', minAgeMonths: null, maxAgeMonths: null } })]);
  assert.equal((await f.read({ ...audience, age: null })).candidates[0]!.kind, 'announcement');
  assert.equal((await f.read({ ...audience, age: null, topicTexts: ['幼兒餵食'] })).candidates.length, 1);
  assert.equal((await f.read({ ...audience, age: null, topicTexts: ['視力檢查'] })).candidates.length, 0);
});

test('global discovery uses actual published chunk keys and profile resolution never assumes HK or exact ages', async () => {
  const f = firestoreDomainFixture(), definition = SOURCE_WATCHES[0]!;
  const options = { database: f.database, cipher: createStorageCipher(Buffer.alloc(32, 81)), projectId: 'synthetic-public-project',
    namespace: 'synthetic_public', serverClock: () => Date.parse(at) };
  await createFirestoreAuthority(options).initializeControl({ generation: '33333333-3333-4333-8333-333333333333', enabled: true });
  let current = evidence({ url: definition.url, publisher: definition.publisher }); let editions = 0;
  let profile: ChildProfile = { childId: '44444444-4444-4444-8444-444444444444', version: 1, confirmedBy: 'synthetic-parent', confirmedAt: at, reason: 'Synthetic confirmation',
    data: { age: { kind: 'birth_date', date: '2025-05-12' }, region: '香港', dueDate: null, gestationalWeeksRaw: null,
      language: null, allergies: null, specialNeeds: null, preferences: null, source: 'Synthetic confirmed profile', validUntil: null } };
  const pointer = options.namespace + '_knowledge_sources/synthetic-source';
  f.records.set(pointer, { schemaVersion: 1, projectId: options.projectId, namespace: options.namespace, sourceId: 'synthetic-source',
    activeVersionId: current.versionId, enabled: true, revision: '1' });
  const sources = createProactiveEventSources({ ...options, sourceIds: ['synthetic-source'], care: { async readProfile() { return profile; } },
    knowledge: { async publishedEdition() {
      editions++; return { versionId: current.versionId, versionHash: current.versionHash, observationHash: null, enabled: true,
        source: { sourceId: current.sourceId, url: current.url, title: current.title, publisher: current.publisher, classification: current.classification,
          sourcePublishedAt: current.sourcePublishedAt, validUntil: current.validUntil, sourceUpdatedAt: null, fetchedAt: at, termsUrl: definition.termsUrl,
          chunks: [{ key: current.key, section: current.section, sourceExcerpt: current.sourceExcerpt, text: current.text,
            applicability: current.applicability, keywords: current.keywords }] } };
    }, async ruleCandidates(_tx, rules) { assert.equal(rules[0]!.key, 'synthetic-section'); return [current]; } },
  });
  const first = await sources.prepareGlobal(); assert.equal(first.state, 'ready'); assert.equal(first.complete, false);
  assert.ok(first.coverage.includes('managed_recent_events_not_configured'));
  const transactions = f.database.runTransaction;
  let transactionCalls = 0;
  f.database.runTransaction = ((...args: Parameters<typeof transactions>) => { transactionCalls++; return transactions.apply(f.database, args); }) as typeof transactions;
  await sources.prepareGlobal(); assert.equal(editions, 1, 'Unchanged global source pointers reuse the prepared day without reloading editions');
  assert.equal(transactionCalls, 0, 'Idle same-instance maintenance does no Firestore reads before its next scheduled probe');
  const binding = (transaction: Transaction) => ({ transaction, actorUserId: 'synthetic-parent', childAccessVersion: '1',
    scope: { ownerUserId: 'synthetic-parent', childId: profile.childId, workspaceId: '55555555-5555-4555-8555-555555555555', storageEpoch: '66666666-6666-4666-8666-666666666666' },
    async readChild() { return { id: profile.childId }; } }) as unknown as FirestoreAuthorityTransaction;
  const read = () => f.database.runTransaction(tx => sources.readCandidates(binding(tx)));
  const candidate = (await read()).candidates[0]!; assert.equal(candidate.kind, 'guidance');
  assert.equal(candidate.evidence.key, 'synthetic-section'); assert.equal(editions, 1, 'Family reads never trigger global discovery');
  profile = { ...profile, version: 2, data: { ...profile.data!, language: 'Synthetic language change', preferences: 'Synthetic unrelated preference' } };
  assert.equal((await read()).candidates[0]!.assessmentId, candidate.assessmentId, 'Unrelated profile revisions do not create new public assessments');
  current = { ...current, versionHash: 'e'.repeat(64), contentHash: 'f'.repeat(64), text: 'Synthetic changed event meaning' };
  f.records.get(pointer).revision = '2'; f.records.get(pointer).activeVersionId = '77777777-7777-4777-8777-777777777777';
  await sources.prepareGlobal({ force: true }); assert.equal(editions, 2); assert.notEqual((await read()).candidates[0]!.semanticId, candidate.semanticId);
  profile = { ...profile, data: { ...profile.data!, region: null } }; assert.equal((await read()).reason, 'region_unconfirmed');
  profile = { ...profile, data: { ...profile.data!, region: 'HK', age: { kind: 'approximate', rawValue: '18', unit: 'months', asOf: '2026-11-12' } } };
  assert.equal((await read()).candidates.length, 0); assert.ok((await read()).coverage.includes('age_specific_events_excluded'));
  current = { ...current, title: '幼兒餵食', applicability: { ...current.applicability, ageBasis: 'any', minAgeMonths: null, maxAgeMonths: null } };
  await sources.prepareGlobal({ force: true });
  assert.equal((await read()).candidates.length, 1, 'Approximate ages do not block age-independent evidence');
  profile = { ...profile, data: { ...profile.data!, age: { kind: 'unknown' } } };
  assert.equal((await read()).candidates.length, 1, 'Unknown ages do not block age-independent evidence');
  const data = new FirestoreDomainData(options), scope = binding({} as Transaction).scope;
  const addTopic = (id: string, title: string, visibility: 'family' | 'private' = 'family') => {
    const value = { id, childId: profile.childId, visibility, title, note: '', status: 'pending' as const, version: 1,
      updatedBy: 'synthetic-parent', updatedAt: at, resumeAfter: null, reopenReason: null, reopenedFrom: null, mayAsk: true };
    f.records.set(data.ref('memory_topics', 'memory-topic', id).path, { ...data.tags(scope), live: true, visibility, entityId: id,
      ...data.seal('memory-topic', id, scope, firestoreTopicStorageSchema, value) });
  };
  addTopic('88888888-8888-4888-8888-888888888888', '幼兒餵食');
  const topical = (await read()).candidates[0]!; assert.ok(topical);
  addTopic('99999999-9999-4999-8999-999999999999', '視力檢查');
  assert.equal((await read()).candidates[0]!.assessmentId, topical.assessmentId, 'An unrelated existing family topic does not re-identify the matching event');
  f.records.delete(data.ref('memory_topics', 'memory-topic', '88888888-8888-4888-8888-888888888888').path);
  addTopic('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '幼兒餵食', 'private');
  assert.equal((await read()).candidates.length, 0, 'Unrelated family topics and matching private topics do not establish shared topical relevance');
  current = { ...current, classification: 'recent_information', sourcePublishedAt: at,
    validUntil: new Date(Date.parse(at) + 86400_000).toISOString() };
  addTopic('88888888-8888-4888-8888-888888888888', '幼兒餵食');
  await sources.prepareGlobal({ force: true });
  assert.equal((await read()).candidates[0]?.kind, 'announcement', 'An eligible current original notice needs no manual entry per edition');
  current = { ...current, usageScope: 'internal_noncommercial' };
  await sources.prepareGlobal({ force: true });
  assert.equal((await read()).candidates.length, 0, 'An internal edition remains unavailable to families');
  assert.deepEqual(parseProactivePublicSelections(undefined), []); assert.throws(() => parseProactivePublicSelections('[{"sourceId":"unbound"}]'));
});
