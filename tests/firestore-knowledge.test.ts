import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFirestoreAuthority } from '../server/firestore-authority.ts';
import { createFirestorePersonalLibrary } from '../server/firestore-personal-library.ts';
import { personalLibraryPageSchema } from '../src/shared/personal-library.ts';
import { handlePersonalLibraryRequest } from '../server/personal-library-api.ts';
import { createStorageCipher } from '../server/storage-crypto.ts';
import { createProductAgentApi } from '../src/client/product-agent-api.ts';
import { SERVICE_POLICY_VERSION } from '../src/shared/account-service.ts';
import { publicMaintenanceWatch, SOURCE_WATCHES } from '../server/knowledge-source-catalog.ts';
import { childHealthSeries, type ManageSeries } from '../src/shared/source-series.ts';
import { childHealthCategories, platformMaterials } from '../server/platform-materials.ts';
import { applyChildHealthSelection, childHealthSelection, createLibrarySelections, librarySelectionRecord } from '../server/knowledge-library-selection.ts';
import { fetchLibraryArchive } from '../src/client/library-archive.ts';
import { createKnowledgeArchiveReceiver } from '../server/admin-knowledge-archive.ts';
import { createKnowledgeTransfers } from '../server/firestore-knowledge-transfers.ts';
import { openKnowledgeArchive, writeKnowledgeArchive } from '../scripts/knowledge-transfer-zip.mjs';
import { readPortableEdition } from '../scripts/knowledge-transfer-operations.mjs';
import { FieldValue, VectorValue, type Firestore, type VectorQueryOptions } from "@google-cloud/firestore";
import { createFirestoreKnowledgeStore, type FirestoreKnowledgeEmbedding } from "../server/firestore-knowledge.ts";
import { embeddingDocument, knowledgeHash, parseKnowledgeSource, sourceVersionHash } from "../server/knowledge-inputs.ts";
import { knowledgeReviewHash, type KnowledgeReviewAssessment } from "../server/knowledge-review-assessment.ts";
import { rankKnowledge } from "../server/knowledge-ranking.ts";
import { KNOWLEDGE_EMBEDDING, type KnowledgeChunkInput, type KnowledgeFilter, type KnowledgeSourceInput } from "../src/shared/knowledge.ts";
import { firestoreDomainFixture } from "./helpers/firestore-domain-memory.ts";
import { createFirestoreKnowledgeRefresh, parseKnowledgeObservation } from "../server/firestore-knowledge-refresh.ts";
import { avatarMemoryBucket } from './helpers/avatar-memory.ts';
import { createKnowledgeSourceFetcher } from '../server/knowledge-source-fetch.ts';
import { verifyPortableMethod } from '../server/knowledge-portable-series.ts';
import { observationHash } from "../server/knowledge-observation.ts";
import type { SourceFetchResult } from "../server/knowledge-refresh-types.ts";
import { KNOWLEDGE_LEXICAL_BATCH, KNOWLEDGE_LEXICAL_BUCKETS, KNOWLEDGE_LEXICAL_PIPELINE } from "../server/knowledge-lexical-index.ts";

// Synthetic vectors only verify mechanical ranking and fencing, never semantic relevance or native index behavior.
const vector = [1, ...Array(1023).fill(0)];
const filter: KnowledgeFilter = { region: "HK", classification: "official_guidance", age: null, ageMatch: "unknown", topics: [] };
function chunk(key: string, patch: Partial<KnowledgeChunkInput> = {}): KnowledgeChunkInput {
  return { key, section: "Synthetic section", sourceExcerpt: "Synthetic source excerpt", originalText: "Synthetic source excerpt and original body",
    text: "Synthetic reviewed needle guidance", keywords: ["synthetic"], applicability: { region: "HK", ageBasis: "any", minAgeMonths: null,
      maxAgeMonths: null, topics: ["care"], conditions: [] }, ...patch };
}
function source(id = "synthetic-guidance", chunks = [chunk("first")]): KnowledgeSourceInput {
  return { sourceId: id, url: `https://www.fhs.gov.hk/${id}`, title: "Synthetic selected guidance", publisher: "Synthetic publisher",
    classification: "official_guidance", sourcePublishedAt: null, sourceUpdatedAt: null, fetchedAt: "2026-01-01T00:00:00Z",
    termsUrl: "https://www.fhs.gov.hk/terms", chunks };
}
function assessment(current: KnowledgeSourceInput, compared: { document: KnowledgeSourceInput; versionId: string; hash: string } | null = null): KnowledgeReviewAssessment {
  const before = new Map(compared?.document.chunks.map(chunk => [chunk.key, chunk]) ?? []), next = new Map(current.chunks.map(chunk => [chunk.key, chunk]));
  const keys = [...new Set([...before.keys(), ...next.keys()])];
  return { comparedVersionId: compared?.versionId ?? null, comparedHash: compared?.hash ?? null, observationHash: null,
    changes: keys.map(key => ({ key, oldQuote: before.get(key)?.sourceExcerpt ?? null, newQuote: next.get(key)?.sourceExcerpt ?? null,
      meaning: !before.has(key) ? "new" : !next.has(key) ? "removed" : knowledgeReviewHash(before.get(key)) === knowledgeReviewHash(next.get(key)) ? "unchanged" : "changed",
      explanation: "Synthetic manual meaning comparison" })),
    checks: { age: "Reviewed", numbersAndUnits: "Reviewed", timing: "Reviewed", conditions: "Reviewed", exceptions: "Reviewed", prohibitions: "Reviewed", withdrawal: "Reviewed" },
    questions: [{ query: "Synthetic expected question", expectedKeys: current.chunks.map(chunk => chunk.key), reason: "Synthetic coverage check" }],
    growthRuleImpact: "none", growthRuleReason: "Synthetic review found no growth rule change", decision: "approve" };
}
function embeddings(document: KnowledgeSourceInput): FirestoreKnowledgeEmbedding[] {
  return document.chunks.map(chunk => ({ chunkKey: chunk.key, inputHash: embeddingDocument(document.title, chunk.section, chunk.text).hash,
    ...KNOWLEDGE_EMBEDDING, values: vector }));
}
function fixture(sourceIds = ["synthetic-guidance"], audience?: "public" | "internal",
  materials?: ReadonlyMap<string, { url: string; mediaLinks: string[] }>) {
  const fake = firestoreDomainFixture(), nearestCalls: { filters: [string, string, unknown][]; options: VectorQueryOptions }[] = [];
  let nearestHook: (() => Promise<void>) | undefined;
  const encode = (value: any): any => value instanceof VectorValue ? { syntheticVector: value.toArray() }
    : Array.isArray(value) ? value.map(encode) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])) : value;
  const decode = (value: any): any => value && typeof value === "object" && Object.keys(value).length === 1 && Array.isArray(value.syntheticVector)
    ? FieldValue.vector(value.syntheticVector) : Array.isArray(value) ? value.map(decode)
      : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)])) : value;
  const snapshot = (snap: any) => ({ ...snap, data: () => decode(snap.data()), get: (key: string) => decode(snap.get(key)) });
  const wrap = (query: any): any => ({ ...query, doc(id: string) {
    const ref = query.doc(id);
    return { ...ref, get: () => fake.database.runTransaction(tx => tx.get(ref)) };
  }, where: (...args: any[]) => wrap(query.where(...args)),
    findNearest: (options: VectorQueryOptions) => ({ async get() {
      nearestCalls.push({ filters: structuredClone(query.filters), options });
      assert.equal(options.distanceMeasure, "COSINE"); assert.equal(options.distanceThreshold, 0.4); assert.equal(options.limit, 60);
      const values = options.queryVector instanceof VectorValue ? options.queryVector.toArray() : options.queryVector;
      const docs = [...fake.records.entries()].filter(([path]) => path.startsWith(query.path + "/")).map(([path, raw]) => ({ path, row: decode(raw) }))
        .filter(({ row }) => query.filters.every(([key, op, value]: [string, string, any]) => op === "==" ? row[key] === value : op === "in" && value.includes(row[key])))
        .map(({ path, row }) => {
          const stored = row.embedding.toArray(), dot = stored.reduce((sum: number, value: number, index: number) => sum + value * values[index]!, 0);
          const norm = (array: number[]) => Math.sqrt(array.reduce((sum, value) => sum + value * value, 0));
          const distance = 1 - Math.max(-1, Math.min(1, dot / (norm(stored) * norm(values))));
          return { id: path.split("/").at(-1), row: { ...row, [options.distanceResultField as string]: distance }, distance };
        }).filter(row => row.distance <= options.distanceThreshold!).sort((a, b) => a.distance - b.distance || a.id!.localeCompare(b.id!))
        .slice(0, options.limit).map(row => ({ id: row.id, data: () => row.row }));
      const hook = nearestHook; nearestHook = undefined; await hook?.(); return { docs };
    } }) });
  const database = { collection: (path: string) => wrap(fake.database.collection(path)),
    runTransaction: (operation: (tx: any) => Promise<any>) => fake.database.runTransaction(tx => operation({
      get: async (target: any) => snapshot(await tx.get(target)), getAll: async (...targets: any[]) => (await tx.getAll(...targets)).map(snapshot),
      create: (ref: any, value: unknown) => tx.create(ref, encode(value)), set: (ref: any, value: unknown) => tx.set(ref, encode(value)),
      update: (ref: any, value: unknown) => tx.update(ref, encode(value)),
      delete: (ref: any) => tx.delete(ref),
    })) } as unknown as Firestore;
  const options = { database, projectId: "synthetic-knowledge-project", namespace: "synthetic_knowledge", sourceIds,
    ...(materials ? { platformMaterials: materials } : {}), ...(audience ? { audience } : {}) }, nativeStore = createFirestoreKnowledgeStore(options);
  const store = { ...nativeStore, async importSource(input: unknown) {
    const result = await nativeStore.importSource(input);
    for (let page = 0; page < 16; page++) if ((await nativeStore.prepareSearch(result.versionId, result.hash)).complete) break;
    return result;
  } };
  async function publish(document = source(), compared: Parameters<typeof assessment>[1] = null) {
    const imported = await store.importSource(document); await store.review(imported.versionId, imported.hash, "synthetic-operator", assessment(document, compared));
    await store.publish(imported.versionId, imported.hash, embeddings(document)); return { ...imported, document };
  }
  return { ...fake, database, options, store, publish, nearestCalls, onNearest: (hook: () => Promise<void>) => { nearestHook = hook; } };
}
test('pending publisher links require a current observation and never become a selectable edition', async () => {
  const id = 'fhs-30012', definition = publicMaintenanceWatch(id)!;
  const f = fixture(['fhs-child-vision'], undefined, new Map([[id, platformMaterials.get(id)!]]));
  const refresh = createFirestoreKnowledgeRefresh({ ...f.options, definitions: [definition],
    async readControl() { return {enabled: true, generation: 'f3457654-6524-4c99-bf56-d26dfb9f4dbd'}; } });
  const store = createFirestoreKnowledgeStore({...f.options, observations: refresh.gate});
  const list = () => store.catalogForUser('reader', null, true);
  await refresh.register(id, 'fixture', true);
  assert.equal((await list()).publisherOriginals, undefined);
  const job = (await refresh.jobs(id))[0]!.data;
  await refresh.process(job, crypto.randomUUID(), async () => ({status: 'ok', items: [{url: definition.url, title: definition.title!,
    text: 'Synthetic cup article for testing the catalogue.', sourcePublishedAt: null, sourceUpdatedAt: null, sourceDateText: null}]}), new AbortController().signal);
  const page = await list();
  assert.deepEqual(page.publisherOriginals, [{sourceId: id, title: definition.title, url: definition.url, categories: childHealthCategories({sourceId:id, url:definition.url})}]);
  assert.equal(page.items.length, 0);
  assert.equal((await store.catalogForUser('reader', null)).publisherOriginals, undefined);
  assert.equal((await store.catalogForUser('reader', id, true)).publisherOriginals, undefined);
  assert.equal(await store.mayReadLivePage('reader', id), false);
  await refresh.disable(id);
  assert.equal((await list()).publisherOriginals, undefined);
});
test('the tenth discovered publisher original moves into the published list on the same family catalogue cursor', async () => {
  const members = [...platformMaterials.values()].filter(row => /^fhs-13\d+$/u.test(row.id))
    .sort((a, b) => a.id.localeCompare(b.id, 'en')).slice(0, 11);
  assert.equal(members.length, 11);
  const definitions = members.map(row => publicMaintenanceWatch(row.id)!);
  const f = fixture([members[0]!.id], undefined, new Map(members.map(row => [row.id, row])));
  const refresh = createFirestoreKnowledgeRefresh({ ...f.options, definitions,
    async readControl() { return { enabled: true, generation: 'f3457654-6524-4c99-bf56-d26dfb9f4dbd' }; } });
  const reads = new Set<string>();
  const store = createFirestoreKnowledgeStore({ ...f.options, observations: { ...refresh.gate,
    read(tx, id) { reads.add(id); return refresh.gate.read(tx, id); } } });
  const entries = members.map((row, index) => ({ url: row.url, title: row.title, text: 'Synthetic observed article ' + index,
    sourcePublishedAt: null, sourceUpdatedAt: null, sourceDateText: null }));
  async function observe(index: number) {
    const id = members[index]!.id;
    await refresh.register(id, 'fixture', true);
    await refresh.process((await refresh.jobs(id))[0]!.data, crypto.randomUUID(), async () =>
      ({ status: 'ok', items: [entries[index]!] }), new AbortController().signal);
  }
  const first = () => store.catalogForUser('reader', null, true);
  for (let i = 0; i < 9; i++) await observe(i);
  assert.equal((await first()).publisherOriginals?.length, 9);
  await observe(9);
  await observe(10);
  reads.clear();
  const ten = await first(), tenth = members[9]!, next = members[10]!;
  assert.deepEqual(ten.publisherOriginals?.map(link => link.sourceId), members.slice(0, 10).map(row => row.id));
  assert.equal(ten.nextSourceId, tenth.id);
  assert.equal(reads.has(next.id), false);
  assert.ok(personalLibraryPageSchema.safeParse({ items: ten.items, publisherOriginals: ten.publisherOriginals, nextCursor: 'cursor', complete: false }).success);
  const last = await store.catalogForUser('reader', ten.nextSourceId, true);
  assert.deepEqual(last.publisherOriginals?.map(link => link.sourceId), [next.id]);
  assert.equal(last.nextSourceId, null);

  const original = entries[9]!, watch = definitions[9]!;
  const document = { ...source(tenth.id, [chunk('article', { sourceExcerpt: original.text, originalText: original.text })]),
    title: original.title, url: original.url, publisher: watch.publisher, termsUrl: watch.termsUrl };
  const imported = await store.importSource(document);
  for (let offset = 0; offset < KNOWLEDGE_LEXICAL_BUCKETS; offset += KNOWLEDGE_LEXICAL_BATCH)
    await store.prepareSearch(imported.versionId, imported.hash);
  await store.review(imported.versionId, imported.hash, 'fixture-reviewer', { ...assessment(document), observationHash: observationHash(original) });
  await store.publish(imported.versionId, imported.hash, embeddings(document));
  const published = await first();
  assert.equal(published.nextSourceId, ten.nextSourceId);
  assert.deepEqual(published.publisherOriginals?.map(link => link.sourceId), members.slice(0, 9).map(row => row.id));
  assert.deepEqual(published.items.map(item => [item.sourceId, item.versionId, item.childHealth?.categories]),
    [[tenth.id, imported.versionId, childHealthCategories({ sourceId: tenth.id, url: tenth.url })]]);
  await store.disable(tenth.id, 'Synthetic publisher withdrawal');
  const withdrawn = await first();
  assert.equal(withdrawn.items.some(row => row.sourceId === tenth.id), false);
  assert.equal(withdrawn.publisherOriginals?.some(row => row.sourceId === tenth.id), false);
});
test('one group command handles more than one archive of editions and fixes a previously moved document explicitly', () => {
  const members = [...platformMaterials.values()].filter(m => childHealthCategories({ sourceId: m.id, url: m.url })).slice(0, 110)
    .map(m => ({ sourceId: m.id, versionId: crypto.randomUUID(), seriesId: 'native-series', scopeHash: '1'.repeat(64) }));
  assert.equal(members.length, 110);
  const make = (operation: ManageSeries['operation'], expectedState: string): ManageSeries => ({ action: 'manage', operation, expectedState, seriesId: childHealthSeries.id });
  const joined = applyChildHealthSelection([], members, make('join', childHealthSelection([], members).stateHash));
  assert.ok(librarySelectionRecord.safeParse({ series: joined }).success);
  assert.equal(childHealthSelection(joined, members).adopted, 110);
  const moved = members.map((m, i) => i ? m : { ...m, seriesId: 'current-series', versionId: crypto.randomUUID() });
  const fixed = applyChildHealthSelection(joined, moved, make('fixed', childHealthSelection(joined, moved).stateHash));
  assert.equal(fixed.find(row => row.seriesId === 'native-series')?.editions.length, 109);
  assert.equal(fixed.find(row => row.seriesId === 'current-series')?.editions[0]?.versionId, moved[0]!.versionId);
  assert.equal(childHealthSelection(fixed, moved).fixed, 110);
});

test('the FHS child health card groups registered editions and preserves individual choices, scopes and other accounts', async () => {
  const ids = ['fhs-child-vision', 'fhs-30136', 'fhs-solid-food', 'unrelated-guidance'];
  const f = fixture(ids), store = createFirestoreKnowledgeStore({ ...f.options, cipher: createStorageCipher(Buffer.alloc(32, 3)) });
  const official = (id: string) => {
    const watch = publicMaintenanceWatch(id)!;
    return { ...source(id), url: watch.url, termsUrl: watch.termsUrl, publisher: watch.publisher };
  };
  const first = await f.publish(official(ids[0]!));
  const outside = await f.publish({ ...source(ids[3]!), url: 'https://www.dh.gov.hk/unrelated-guidance' });
  const catalog = async (owner = 'reader') => (await store.catalogForUser(owner, null)).items;
  const state = async () => (await catalog()).find(item => item.childHealth)!.childHealth!;
  const change = (operation: ManageSeries['operation'], expectedState: string) => f.database.runTransaction(tx =>
    store.saveLibraryPreference(tx, 'reader', { action: 'manage', seriesId: childHealthSeries.id, operation, expectedState }));
  const hits = async (owner = 'reader') => (await store.candidates(filter, null, { libraryUserId: owner })).map(item => item.sourceId).sort();
  for (const [id, mode, enabled] of [[first.document.sourceId, 'fixed', false], [outside.document.sourceId, 'follow', true]] as const) {
    const doc = (await catalog()).find(item => item.sourceId === id)!;
    await f.database.runTransaction(tx => store.saveLibraryPreference(tx, 'reader', { mode, enabled, seriesId: doc.series!.id,
      expectedRevision: 0, editions: [{ sourceId: id, versionId: doc.versionId }] }));
  }
  const old = await state();
  await f.publish(official(ids[1]!));
  const partial = await state();
  assert.deepEqual([partial.total, partial.adopted, partial.fixed, partial.enabled], [2, 1, 1, 0]);
  assert.ok(childHealthCategories(official(ids[1]!))!.length >= 2);
  assert.equal(childHealthCategories({ sourceId: ids[0]!, url: outside.document.url }), undefined);
  assert.equal(childHealthCategories({ sourceId: 'unregistered', url: official(ids[0]!).url }), undefined);
  assert.deepEqual(await hits(), [outside.document.sourceId]);
  await assert.rejects(change('join', old.stateHash), { code: 'library_selection_changed' });
  const revision = await change('join', partial.stateHash);
  assert.deepEqual(await change('join', partial.stateHash), revision);
  assert.deepEqual(await hits(), [ids[1], ids[3]]);
  const groupedCitation = (await store.candidates(filter, null, { libraryUserId: 'reader' })).find(item => item.sourceId === ids[1]);
  assert.deepEqual(groupedCitation?.series, childHealthSeries);
  assert.deepEqual(await hits('other-reader'), []);
  const chosen = (await catalog()).find(item => item.sourceId === ids[0])!.preference!;
  assert.deepEqual([chosen.mode, chosen.enabled, chosen.selectedVersionId], ['fixed', false, first.versionId]);
  await f.publish(official(ids[2]!));
  assert.deepEqual(await hits(), [ids[1], ids[3]]);
  assert.equal((await state()).adopted, 2);
  await change('enable', (await state()).stateHash);
  await change('follow', (await state()).stateHash);
  assert.deepEqual(await hits(), [ids[1], ids[0], ids[3]]);
  assert.equal((await state()).fixed, 0);
  await change('remove', (await state()).stateHash);
  assert.equal((await state()).adopted, 0);
  assert.deepEqual(await hits(), [ids[3]]);
  assert.equal((await store.publishedEdition(ids[0]!))?.versionId, first.versionId);
  const cards = await f.database.runTransaction(tx => store.platformCards(tx, 'reader'));
  assert.equal(cards.cards.filter(card => card.seriesId === childHealthSeries.id).length, 1);
  assert.equal(cards.cards.find(card => card.seriesId === childHealthSeries.id)?.name, '衛生署 兒童健康');
  assert.equal(cards.cards.find(card => card.sourceId === ids[3])?.childHealth, undefined);
  const current = await state();
  const importOne = (sourceId: string, versionHash: string) => f.database.runTransaction(tx => store.saveLibraryPreference(tx, 'reader', {
    seriesId: childHealthSeries.id, imported: true, mode: 'fixed', enabled: true, expectedRevision: current.revision,
    editions: [{ sourceId, versionHash }],
  }));
  await assert.rejects(importOne(outside.document.sourceId, outside.hash), { code: 'knowledge_reference_unavailable' });
  await importOne(first.document.sourceId, first.hash);
  const imported = await state();
  assert.deepEqual([imported.adopted, imported.fixed, imported.enabled], [1, 1, 1]);
  assert.deepEqual(await hits(), [first.document.sourceId, outside.document.sourceId]);
});
test('the first catalogue page includes later document categories and the platform tool lists the managed card only once', async () => {
  const registered = ['fhs-child-vision', 'fhs-toddler-development'];
  const others = Array.from({ length: 10 }, (_, i) => 'fhs-middle-' + i);
  const materials = new Map(others.map(id => [id, { url: source(id).url, mediaLinks: [] }]));
  const f = fixture(registered, undefined, materials), store = createFirestoreKnowledgeStore({ ...f.options, cipher: createStorageCipher(Buffer.alloc(32, 6)) });
  for (const id of [...registered, ...others]) {
    const watch = publicMaintenanceWatch(id);
    await f.publish(watch ? { ...source(id), url: watch.url, publisher: watch.publisher, termsUrl: watch.termsUrl } : source(id));
  }
  const first = await store.catalogForUser('parent', null);
  assert.ok(first.nextSourceId && first.items.every(item => item.sourceId !== registered[1]));
  assert.deepEqual(first.items[0]!.childHealth?.categoryCounts?.find(row => row.name === '兒童發展'), { name: '兒童發展', count: 1 });
  const cards = [];
  let cursor: string | undefined;
  do {
    const page = await f.database.runTransaction(tx => store.platformCards(tx, 'parent', cursor));
    cards.push(...page.cards); cursor = page.next ?? undefined;
  } while (cursor);
  assert.equal(cards.filter(card => card.seriesId === childHealthSeries.id).length, 1);
  assert.equal(cards.length, 11);
});

test('legacy native series controls preserve mixed pins when the parent changes only the displayed enable setting', async () => {
  const f = fixture(), selections = createLibrarySelections({ ...f.options, cipher: createStorageCipher(Buffer.alloc(32, 9)) });
  const members = ['fhs-solid-food', 'fhs-feeding-booklet-en'].map(sourceId => ({ sourceId, seriesId: 'fhs-infant-feeding',
    versionId: crypto.randomUUID(), scopeHash: 'a'.repeat(64) }));
  const chosen = { seriesId: members[0]!.seriesId, enabled: false, mode: 'fixed' as const, expectedRevision: 0, editions: members.slice(0, 1) };
  await f.database.runTransaction(tx => selections.save(tx, 'parent', chosen, chosen.editions));
  const read = () => f.database.runTransaction(tx => selections.read(tx, 'parent'));
  const before = childHealthSelection(await read(), members);
  await f.database.runTransaction(tx => selections.manage(tx, 'parent', { action: 'manage', seriesId: childHealthSeries.id, operation: 'join',
    expectedState: before.stateHash }, members));
  const [row] = await read();
  await f.database.runTransaction(tx => selections.save(tx, 'parent', { ...chosen, expectedRevision: row!.revision,
    enabled: true, mode: 'follow', editions: [...members].reverse() }, members));
  const result = childHealthSelection(await read(), members);
  assert.deepEqual([result.adopted, result.enabled, result.fixed], [2, 2, 1]);
});

test('the source maintainer can revise treatment without changing the published document until review and publication', async () => {
  const { createAdminKnowledgeTreatments } = await import('../server/admin-knowledge-treatments.ts');
  const { handleAdminRequest } = await import('../server/admin-api.ts');
  const f = fixture();
  const original = source('synthetic-guidance', [chunk('first', {
    originalKind: 'page_transcription', pageStart: 1, pageEnd: 1, treatment: { kind: 'detailed', policyVersion: 1 },
  })]);
  const extraction = { format: 'text_pdf' as const, totalPages: 1, pageStart: 1, pageEnd: 1, contentHash: '3'.repeat(64), complete: true };
  original.extraction = extraction;
  const rule = {
    id: original.sourceId, url: original.url, kind: 'pdf' as const, pdfPages: { startPage: 1, endPage: 1 }, title: original.title,
    classification: original.classification, publisher: original.publisher, termsUrl: original.termsUrl, audience: 'public_noncommercial' as const
  };
  const refresh = createFirestoreKnowledgeRefresh({ ...f.options, definitions: [rule], readControl: async () => ({ enabled: true, generation: 'f3457654-6524-4c99-bf56-d26dfb9f4dbd' }) });
  const store = createFirestoreKnowledgeStore({ ...f.options, observations: refresh.gate });
  const observation = { url: original.url, title: original.title, text: '', sourcePublishedAt: null, sourceUpdatedAt: null,
    sourceDateText: null, nativeWindowMethod: 'native-pdf-window/1' as const, extraction: { ...extraction, complete: false } };
  await refresh.register(rule.id, 'operator');
  await refresh.process((await refresh.jobs())[0]!.data, crypto.randomUUID(), async () => ({ status: 'ok', items: [observation] }), new AbortController().signal);
  const baseline = { ...await store.importSource(original), document: original }, observationId = observationHash(parseKnowledgeObservation(observation));
  const originalAssessment = { ...assessment(original), observationHash: observationId };
  await assert.rejects(store.review(baseline.versionId, baseline.hash, 'operator', originalAssessment), /knowledge_window_review_required/u);
  await store.review(baseline.versionId, baseline.hash, 'operator', originalAssessment, {
    sourceId: original.sourceId, contentHash: observationId, verifyWindowedReview: async (_tx, hash) => hash === baseline.hash,
  });
  while (!(await store.prepareSearch(baseline.versionId, baseline.hash)).complete) { }
  await store.publish(baseline.versionId, baseline.hash, embeddings(original));
  let enabled = true;
  const workflow = createAdminKnowledgeTreatments(store, async () => ({ enabled }));
  const id = baseline.document.sourceId, key = baseline.document.chunks[0]!.key;
  const auth = (user: string) => ({ getSession: async () => ({ user: { id: user } }), assertRecentReauthentication: async () => ({ user: { id: user } }) });
  const call = (user: string, body?: unknown, path = id) => handleAdminRequest(new Request('https://example.test/api/admin/knowledge-treatments/' + path, {
    method: body ? 'POST' : 'GET', headers: { origin: 'https://example.test', 'x-expected-user-id': user }, ...(body ? { body: JSON.stringify(body) } : {})
  }), {
    admin: { treatments: workflow }, adminUid: 'maintainer', publicOrigin: 'https://example.test', auth: auth(user),
    readJson: (request: Request) => request.json()
  } as unknown as Parameters<typeof handleAdminRequest>[1]);
  const expected = { baseId: baseline.versionId, baseHash: baseline.hash };
  const edit = { action: 'draft', ...expected, changes: [{ key, treatment: { kind: 'overview', policyVersion: 1 } }] };
  await assert.rejects(call('parent', edit), { code: 'forbidden' });
  await assert.rejects(call('parent'), { code: 'forbidden' });
  await assert.rejects(call('maintainer', edit, 'unregistered-source'), { code: 'knowledge_source_not_allowed' });
  const prior = await (await call('maintainer')).json();
  assert.equal(prior.versionId, baseline.versionId);
  const draft = await (await call('maintainer', edit)).json();
  assert.equal(draft.state, 'draft'); assert.equal((await store.publishedEdition(id))!.versionId, baseline.versionId);
  const selected = await (await call('maintainer', undefined, id + '?version=' + draft.versionId)).json();
  assert.equal(selected.chunks[0].treatment.kind, 'overview'); assert.equal(selected.chunks[0].sourceExcerpt, prior.chunks[0].sourceExcerpt);
  const target = { ...expected, versionId: draft.versionId, versionHash: draft.versionHash };
  await assert.rejects(call('maintainer', { ...target, action: 'publish' }), { code: 'knowledge_version_unreviewed' });
  const changed = { ...baseline.document, chunks: baseline.document.chunks.map(c => ({ ...c, treatment: { kind: 'overview' as const, policyVersion: 1 as const } })) };
  const review = { ...target, action: 'review', sourceAndTermsChecked: true, assessment: { ...assessment(changed, baseline), observationHash: observationId } };
  await assert.rejects(call('maintainer', { ...review, assessment: { ...review.assessment, changes: [] } }), { code: 'knowledge_review_incomplete_diff' });
  enabled = false;
  await assert.rejects(call('maintainer', review), { code: 'knowledge_treatment_maintenance' });
  enabled = true;
  assert.equal((await (await call('maintainer', review)).json()).state, 'reviewed');
  const reviewedRecords = structuredClone([...f.records.entries()]);
  assert.equal((await (await call('maintainer', review)).json()).state, 'reviewed');
  assert.deepEqual([...f.records.entries()], reviewedRecords);
  assert.equal((await store.catalog(null)).items[0]!.versionId, baseline.versionId);
  enabled = false;
  await assert.rejects(call('maintainer', { ...target, action: 'publish' }), { code: 'knowledge_treatment_maintenance' });
  enabled = true;
  assert.equal((await (await call('maintainer', { ...target, action: 'publish' })).json()).state, 'published');
  assert.equal((await store.publishedEdition(id))!.versionId, draft.versionId);
  assert.equal((await store.catalog(null)).items[0]!.versionId, draft.versionId);
  assert.equal((await (await call('maintainer', { ...target, action: 'publish' })).json()).state, 'published');
  await assert.rejects(call('maintainer', edit), { code: 'knowledge_review_baseline_changed' });
  const old = await (await call('maintainer', undefined, id + '?version=' + baseline.versionId)).json();
  assert.equal(old.state, 'draft');
  const contentChange = await store.importSource({ ...original, title: 'A different document title' });
  await assert.rejects(call('maintainer', undefined, id + '?version=' + contentChange.versionId), { code: 'knowledge_treatment_content_changed' });
});

test('platform card admin sync, download, citation, update, removal and redownload use the same reviewed store', async () => {
  const { createAdminPlatformCards } = await import('../server/admin-platform-cards.ts');
  const { handleAdminRequest } = await import('../server/admin-api.ts');
  const f = fixture(), store = createFirestoreKnowledgeStore({ ...f.options, cipher: createStorageCipher(Buffer.alloc(32, 17)) });
  const admin = { platformCards: createAdminPlatformCards(store, async () => ({ enabled: true })) };
  async function command(uid: string, body: unknown) {
    const headers = { origin: 'https://local.test', 'x-expected-user-id': uid };
    const session = async () => ({ user: { id: uid } });
    const res = await handleAdminRequest(new Request('https://local.test/api/admin/platform-cards', { headers, method: 'POST', body: JSON.stringify(body) }),
      { publicOrigin: headers.origin, adminUid: 'maintainer', admin: admin as never,
        auth: { getSession: session, assertRecentReauthentication: session } as never, readJson: req => req.json() });
    return res.json();
  }
  const hits = () => store.candidates(filter, null, { libraryUserId: 'parent', query: 'needle' });
  const doc = source();
  await assert.rejects(command('parent', { action: 'draft', source: doc }), { code: 'forbidden' });
  const first = await command('maintainer', { action: 'draft', source: doc });
  assert.equal((await admin.platformCards.preview(doc.sourceId, first.versionId)).changes.length, doc.chunks.length);
  await assert.rejects(command('maintainer', { ...first, baseId: null, action: 'sync' }), { code: 'knowledge_version_unreviewed' });
  await command('maintainer', { ...first, baseId: null, action: 'review', termsChecked: true, assessment: assessment(doc) });
  for (const input of await store.missingDocuments(first.versionId)) await store.embedDocument(input, async () => vector);
  await command('maintainer', { ...first, baseId: null, action: 'sync' });
  assert.deepEqual(await hits(), []);
  const change = (mode: 'follow' | 'platform', revision: number, versionId: string) => f.database.runTransaction(tx =>
    store.saveLibraryPreference(tx, 'parent', { seriesId: doc.sourceId, enabled: true, mode, expectedRevision: revision, editions: [{sourceId: doc.sourceId, versionId}] }));
  await change('follow', 0, first.versionId);
  const cited = (await hits())[0]!;
  assert.equal(cited.versionId, first.versionId);
  const edited = { ...doc, title: 'Next reviewed edition' };
  const next = await command('maintainer', { action: 'draft', source: edited });
  await command('maintainer', { ...next, baseId: first.versionId, action: 'review', termsChecked: true,
    assessment: assessment(edited, { document: doc, versionId: first.versionId, hash: first.versionHash }) });
  await assert.rejects(command('maintainer', { ...next, baseId: first.versionId, action: 'sync' }), { code: 'knowledge_vectors_incomplete' });
  assert.equal((await hits())[0]?.versionId, first.versionId);
  for (const input of await store.missingDocuments(next.versionId)) await store.embedDocument(input, async () => vector);
  await command('maintainer', { ...next, baseId: first.versionId, action: 'sync' });
  assert.equal((await hits())[0]?.versionId, next.versionId);
  await change('platform', 1, next.versionId);
  assert.deepEqual(await hits(), []);
  assert.equal(cited.versionId, first.versionId);
  await change('follow', 2, next.versionId);
  assert.equal((await hits())[0]?.versionId, next.versionId);
});

test('REQ-006 two authenticated library owners independently pin, follow, adopt and withdraw the same public edition', async () => {
  const f = fixture(), cipher = createStorageCipher(Buffer.alloc(32, 19));
  const store = createFirestoreKnowledgeStore({ ...f.options, cipher });
  const authority = createFirestoreAuthority({ ...f.options, cipher });
  const library = createFirestorePersonalLibrary({ ...f.options, cipher, knowledge: store, authority });
  await authority.initializeControl({ generation: crypto.randomUUID(), enabled: true });
  const signal = new AbortController().signal;
  async function account(user: string) {
    const email = user + '@example.test';
    await authority.issueInvitation({ email, expiresAt: new Date(Date.now() + 600000).toISOString(), operationId: crypto.randomUUID() });
    await authority.admitIdentity({ userId: user, email, emailVerified: true });
    await authority.acknowledge({ userId: user, operationId: crypto.randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
    const child = await authority.createChild({ userId: user, operationId: crypto.randomUUID(), displayName: 'Synthetic' });
    const client = createProductAgentApi('https://local.test', (url, init) => handlePersonalLibraryRequest(new Request(url, init), user,
      { library, isCurrentUser: async id => id === user, readJson: request => request.json() }));
    return { catalog: async () => (await client.getLibrary(child.scope.childId, signal, user)).items[0]!,
      change: (value: import('../src/shared/source-series.ts').LibraryPreferenceChange) => client.setLibraryPreference!(child.scope.childId, signal, user, value),
      join: (value: import('../src/shared/source-series.ts').LibraryJoin) => client.setLibraryPreference!(child.scope.childId, signal, user, value),
      search: async () => (await store.candidates(filter, null, { query: 'needle', libraryUserId: user })).map(hit => hit.versionId) };
  }
  const a = await account('synthetic-alice'), b = await account('synthetic-bob');
  const one = await f.publish(), old = await a.catalog(), original = (await store.candidates(filter, null))[0]!;
  const canReopen = (citation = original) => f.database.runTransaction(tx => store.historicalCitationsReadable(tx, [citation]));
  const canDeliver = (user: string) => f.database.runTransaction(tx => store.citationsCurrent(tx, user, [original]));
  const change = { seriesId: old.series!.id, expectedRevision: old.preference!.revision, enabled: true,
    editions: [{ sourceId: old.sourceId, versionId: one.versionId }] };
  assert.deepEqual(old.preference, { revision: 0, enabled: true, mode: 'platform', selectedVersionId: null, eligible: false });
  assert.deepEqual(await a.search(), []);
  const join = { action: 'join' as const, seriesId: change.seriesId, expectedRevision: 0, editions: change.editions };
  await assert.rejects(b.join({ ...join, editions: [{ sourceId: old.sourceId, versionId: crypto.randomUUID() }] }), { status: 409 });
  const priorKeys = new Set(f.records.keys());
  await b.join(join);
  assert.equal((await b.catalog()).preference!.selectedVersionId, one.versionId);
  assert.equal((await b.catalog()).preference!.mode, 'follow');
  assert.equal((await a.catalog()).preference!.revision, 0);
  const addedKeys = [...f.records.keys()].filter(key => !priorKeys.has(key));
  assert.equal(addedKeys.length, 1);
  assert.match(addedKeys[0]!, /library_preferences/);
  const afterJoin = structuredClone([...f.records.entries()]);
  await b.join(join);
  assert.deepEqual([...f.records.entries()], afterJoin);
  await a.change({ ...change, mode: 'fixed', imported: true, editions: [{ sourceId: old.sourceId, versionHash: one.hash }] });
  const two = await f.publish({ ...one.document, title: 'Renamed selected guidance' }, one);
  assert.deepEqual(await a.search(), [one.versionId]); assert.deepEqual(await b.search(), [two.versionId]);
  assert.equal(await canReopen(), true, 'A reviewed historical citation remains readable after a new publication');
  assert.equal(await canDeliver('synthetic-alice'), true, 'A new delivery can still use a selected fixed edition');
  assert.equal(await canDeliver('synthetic-bob'), false, 'A new delivery must follow the selected successor');
  assert.equal(await canReopen({ ...original, versionHash: two.hash }), false);
  assert.equal(await canReopen({ ...original, contentHash: '0'.repeat(64) }), false);
  assert.equal(await canReopen({ ...original, url: 'https://example.org/other' }), false);
  assert.equal(await canReopen({ ...original, chunkId: crypto.randomUUID() }), false);
  const latest = await a.catalog();
  assert.equal(latest.series!.id, old.series!.id); assert.equal(latest.preference!.selectedVersionHash, one.hash);
  assert.equal(original.title, old.title); assert.equal(original.series!.name, old.series!.name);
  const next = { ...change, expectedRevision: latest.preference!.revision, editions: [{ sourceId: old.sourceId, versionId: two.versionId }] };
  await a.change({ ...next, enabled: false, mode: 'fixed' });
  const afterPin = structuredClone([...f.records.entries()]);
  await a.join(join);
  assert.deepEqual([...f.records.entries()], afterPin);
  assert.deepEqual(await a.search(), []); assert.deepEqual(await b.search(), [two.versionId]);
  assert.equal(await canReopen(), true, 'Removing a personal card leaves the bound historical version readable');
  assert.equal(await canDeliver('synthetic-alice'), false, 'Removing a personal card prevents new delivery with that citation');
  await assert.rejects(a.change({ ...next, enabled: true, mode: 'fixed' }), { status: 409 });
  const disabled = await a.catalog();
  assert.equal(disabled.preference!.selectedVersionId, one.versionId);
  await a.change({ ...next, enabled: true, mode: 'fixed', expectedRevision: disabled.preference!.revision });
  assert.deepEqual(await a.search(), [one.versionId], 'Toggling the card retains the selected older snapshot');
  const revision = (await a.catalog()).preference!.revision;
  const imported = { ...change, expectedRevision: revision, imported: true as const, mode: 'fixed' as const,
    editions: [{ sourceId: old.sourceId, versionHash: one.hash }] };
  await assert.rejects(a.change({ ...imported, editions: [{ sourceId: old.sourceId, versionHash: 'f'.repeat(64) }] }), { status: 409 });
  await a.change(imported);
  const widened = { ...two.document, chunks: [chunk('first', { applicability: { ...chunk('first').applicability, topics: ['care', 'new-scope'] } })] };
  const wide = await f.publish(widened, two);
  assert.deepEqual(await b.search(), [], 'Following requires acceptance of a scope change');
  assert.deepEqual(await a.search(), [one.versionId]);
  const pinned = await a.catalog();
  await a.change({ ...next, mode: 'follow', adopt: true, expectedRevision: pinned.preference!.revision,
    editions: [{ sourceId: old.sourceId, versionId: wide.versionId }] });
  assert.deepEqual(await a.search(), [], 'Changing an imported snapshot to follow cannot accept expanded scope');
  await a.change({ ...imported, expectedRevision: (await a.catalog()).preference!.revision });
  await store.review(one.versionId, one.hash, 'synthetic-operator', { ...assessment(one.document, wide), decision: 'hold' });
  assert.equal((await a.catalog()).preference!.eligible, false);
  assert.deepEqual(await a.search(), [], 'A withdrawn snapshot cannot be served even with a valid successor');
  assert.equal(await canReopen(), false, 'An explicitly withdrawn original edition cannot be disclosed');
  await assert.rejects(a.change({ ...imported, expectedRevision: (await a.catalog()).preference!.revision }), { status: 409 });
  const afterWithdrawal = await a.catalog();
  await a.change({ ...next, mode: 'platform', expectedRevision: afterWithdrawal.preference!.revision,
    editions: [{ sourceId: old.sourceId, versionId: wide.versionId }] });
  assert.deepEqual(await a.search(), [], 'Removing a downloaded card immediately excludes it from new searches');
  await a.join({ ...join, expectedRevision: (await a.catalog()).preference!.revision,
    editions: [{ sourceId: old.sourceId, versionId: wide.versionId }] });
  assert.deepEqual(await a.search(), [wide.versionId]);
  const currentCitation = (await store.candidates(filter, null))[0]!;
  assert.equal(await canReopen(currentCitation), true);
  await store.disable(old.sourceId, 'Synthetic withdrawal');
  assert.equal(await canReopen(currentCitation), false, 'Platform withdrawal also blocks historical disclosure');
  await assert.rejects(b.join(join), { status: 409 });
  assert.deepEqual(await a.search(), []); assert.deepEqual(await b.search(), []);
});

test('chat pages bound publication reads, match a later URL directly and bind only the selected series across pages', async () => {
  const ids = Array.from({ length: 8 }, (_, i) => 'guide-' + i), f = fixture(ids);
  const series = { id: 'shared-guides', name: 'Shared guides', institutionId: 'www.fhs.gov.hk' };
  const versions: Awaited<ReturnType<typeof f.publish>>[] = [];
  for (const id of ids) versions.push(await f.publish({ ...source(id), ...(id === ids[0] || id === ids[7] ? { series } : {}) }));
  const store = createFirestoreKnowledgeStore({ ...f.options, cipher: createStorageCipher(Buffer.alloc(32, 19)) });
  type Tx = import('@google-cloud/firestore').Transaction;
  const reads: string[] = [];
  const run = <T>(fn: (tx: Tx) => Promise<T>) => f.database.runTransaction(tx => {
    const measured = { ...tx, get: async (ref: any) => { reads.push(ref.path); return tx.get(ref); },
      getAll: (...args: any[]) => {
        const mask = args.at(-1)?.fieldMask;
        const refs = mask ? args.slice(0, -1) : args;
        reads.push(...refs.map(ref => (mask ? 'projected:' : '') + ref.path));
        return tx.getAll(...refs);
      } } as Tx;
    return fn(measured);
  });
  const fullVersions = () => reads.filter(path => path.startsWith('synthetic_knowledge_knowledge_versions/')).map(path => path.split('/').at(-1));
  const first = await run(tx => store.platformCards(tx, 'parent'));
  assert.equal(first.next, ids[4]); assert.equal(first.cards.length, 5); assert.equal(fullVersions().length, 5);
  reads.length = 0;
  const next = await run(tx => store.platformCards(tx, 'parent', first.next!));
  assert.equal(next.next, null); assert.equal(fullVersions().length, 3);
  reads.length = 0;
  assert.deepEqual(await run(tx => store.platformCards(tx, 'parent', undefined, 'https://school.example/private')), { cards: [], next: null });
  assert.equal(reads.length, 0);
  const match = await run(tx => store.platformCards(tx, 'parent', undefined, versions[6]!.document.url + '#example'));
  assert.equal(match.cards[0]!.sourceId, ids[6]); assert.deepEqual(fullVersions(), [versions[6]!.versionId]);
  reads.length = 0;
  const selected = next.cards.find(card => card.seriesId === series.id)!;
  assert.equal(selected.sourceId, ids[7]);
  await run(tx => store.joinListedPlatformCard(tx, 'parent', selected));
  assert.deepEqual(fullVersions().sort(), [versions[0]!.versionId, versions[7]!.versionId].sort());
  const followed = (await store.catalogForUser('parent', null)).items.filter(item => item.preference?.mode === 'follow');
  assert.deepEqual(followed.map(item => item.preference!.selectedVersionId), [versions[0]!.versionId, versions[7]!.versionId]);
});

test('browsing does not download platform editions and only explicitly followed series enter new answers', async () => {
  const f = fixture(['one', 'two', 'new-source']), store = createFirestoreKnowledgeStore({ ...f.options, cipher: createStorageCipher(Buffer.alloc(32, 19)) });
  const read = async () => (await store.candidates(filter, null, { query: 'needle', libraryUserId: 'parent' })).map(hit => hit.versionId).sort();
  const catalog = async () => (await store.catalogForUser('parent', null)).items;
  const save = (change: import('../src/shared/source-series.ts').LibraryPreferenceChange) =>
    f.database.runTransaction(tx => store.saveLibraryPreference(tx, 'parent', change));
  const one = await f.publish(source('one')), two = await f.publish(source('two'));
  const before = [...f.records.entries()];
  assert.deepEqual(await read(), []);
  const first = (await catalog())[0]!;
  assert.deepEqual([...f.records.entries()], before, 'Reading the catalogue or an ordinary chat must not create a personal record');
  const change = { seriesId: first.series!.id, expectedRevision: 0, mode: first.preference!.mode,
    editions: [{ sourceId: first.sourceId, versionId: one.versionId }] };
  await save({ ...change, enabled: false });
  await f.publish({ ...two.document, title: 'Revised guidance' }, two);
  await f.publish(source('new-source'));
  assert.deepEqual(await read(), []);
  const off = (await catalog()).find(item => item.sourceId === first.sourceId)!.preference!;
  assert.equal(off.revision, 1); assert.equal(off.enabled, false);
  await assert.rejects(save({ ...change, enabled: true }), { code: 'library_selection_changed' });
  await save({ ...change, expectedRevision: off.revision, enabled: true, mode: 'follow' });
  const changed = await f.publish({ ...one.document, title: 'Updated reviewed edition' }, one);
  assert.deepEqual(await read(), [changed.versionId]);
});

test('reviewed source versions rename an institution and split and merge a series without rebinding historical citations', async () => {
  const series = { id: 'shared-series', name: 'Original series', institutionId: 'www.fhs.gov.hk' };
  const f = fixture(['one', 'two', 'other-institution']), clientStore = createFirestoreKnowledgeStore({ ...f.options, cipher: createStorageCipher(Buffer.alloc(32, 17)) });
  const first = await f.publish({ ...source('one'), series }), second = await f.publish({ ...source('two'), series });
  const original = (await clientStore.candidates(filter, null)).find(row => row.sourceId === 'two')!;
  assert.equal(original.series?.name, series.name);
  const initial = (await clientStore.catalogForUser('reader', null)).items;
  await f.database.runTransaction(tx => clientStore.saveLibraryPreference(tx, 'reader', {
    seriesId: series.id, expectedRevision: initial[0]!.preference!.revision, mode: 'fixed', imported: true, enabled: true,
    editions: initial.map(item => ({ sourceId: item.sourceId, versionHash: item.versionHash! })),
  }));
  const saveChoice = (change: import('../src/shared/source-series.ts').LibraryPreferenceChange) =>
    f.database.runTransaction(tx => clientStore.saveLibraryPreference(tx, 'follower', change));
  await saveChoice({ seriesId: series.id, expectedRevision: 0, mode: 'follow', enabled: true,
    editions: initial.map(({ sourceId, versionId }) => ({ sourceId, versionId })) });
  const renamed = { ...series, name: 'Renamed series' }, publisher = 'Renamed institution';
  const one = await f.publish({ ...first.document, publisher, series: renamed }, first);
  const split = await f.publish({ ...second.document, publisher, series: { ...renamed, id: 'split-series', name: 'Split series' } }, second);
  const catalog = (await clientStore.catalogForUser('reader', null)).items;
  assert.deepEqual(catalog.map(row => [row.sourceId, row.series?.id, row.publisher]), [['one', series.id, publisher], ['two', 'split-series', publisher]]);
  assert.equal(catalog[1]!.preference?.eligible, false);
  assert.equal(catalog[1]!.preference?.revision, 0, 'Controls use the destination series revision');
  const ordinary = await clientStore.candidates(filter, null, { libraryUserId: 'ordinary' });
  assert.deepEqual(ordinary, []);
  const followed = await clientStore.candidates(filter, null, { libraryUserId: 'follower' });
  assert.deepEqual(followed.map(item => item.versionId), [one.versionId], 'Same-series rename follows but a move requires acceptance');
  const splitCard = (await clientStore.catalogForUser('follower', null)).items[1]!;
  const adoptSplit = { seriesId: splitCard.series!.id, expectedRevision: splitCard.preference!.revision,
    enabled: true, mode: 'fixed' as const, adopt: true, editions: [{ sourceId: 'two', versionId: split.versionId }] };
  await saveChoice(adoptSplit);
  const originalCard = (await clientStore.catalogForUser('follower', null)).items[0]!;
  const toggle = { seriesId: series.id, expectedRevision: originalCard.preference!.revision, enabled: false,
    mode: 'follow' as const, editions: [{ sourceId: 'one', versionId: one.versionId }] };
  await assert.rejects(saveChoice({ ...toggle, expectedRevision: 1 }), { code: 'library_selection_changed' });
  await saveChoice(toggle);
  assert.deepEqual((await clientStore.candidates(filter, null, { libraryUserId: 'follower' })).map(item => item.versionId), [split.versionId]);
  const restored = await f.publish({ ...split.document, series: renamed }, split);
  const joined = (await clientStore.catalogForUser('reader', null)).items;
  assert.deepEqual(joined.map(row => row.series?.id), [series.id, series.id]);
  assert.deepEqual(joined.map(row => row.versionId), [one.versionId, restored.versionId]);
  const destination = (await clientStore.catalogForUser('follower', null)).items.map(row => row.preference!);
  assert.ok(destination.every(row => !row.enabled && row.revision === toggle.expectedRevision + 1 && row.mode === 'follow'));
  assert.deepEqual(await clientStore.candidates(filter, null, { libraryUserId: 'follower' }), []);
  const pinned = (await clientStore.candidates(filter, null, { libraryUserId: 'reader' })).find(row => row.sourceId === 'two')!;
  assert.equal(pinned.versionId, original.versionId); assert.equal(pinned.series?.name, 'Original series'); assert.equal(pinned.publisher, original.publisher);
  assert.throws(() => parseKnowledgeSource({ ...second.document, series: { ...series, institutionId: 'unrelated.example' } }));
  await assert.rejects(f.publish({ ...source('other-institution'), url: 'https://www.dh.gov.hk/other', series: { ...series, institutionId: 'www.dh.gov.hk' } }),
    { code: 'knowledge_series_institution_conflict' });
});

test('a registered series follows a reviewed publisher rename but requires acceptance of a different page selector', async () => {
  const f = fixture(), cipher = createStorageCipher(Buffer.alloc(32, 9));
  async function publishWatch(document: KnowledgeSourceInput, selector: string, prior: Parameters<typeof assessment>[1] = null) {
    const definition = { id: document.sourceId, url: document.url, kind: 'page' as const, selector, title: document.title,
      classification: document.classification, publisher: document.publisher, termsUrl: document.termsUrl, audience: 'public_noncommercial' as const };
    const refresh = createFirestoreKnowledgeRefresh({ ...f.options, definitions: [definition],
      async readControl() { return { enabled: true, generation: 'f3457654-6524-4c99-bf56-d26dfb9f4dbd' }; } });
    const store = createFirestoreKnowledgeStore({ ...f.options, observations: refresh.gate, cipher });
    await refresh.register(definition.id, 'operator');
    const observed = { url: document.url, title: document.title, text: document.chunks[0]!.originalText!, sourcePublishedAt: null, sourceUpdatedAt: null, sourceDateText: null };
    await refresh.process((await refresh.jobs())[0]!.data, crypto.randomUUID(), async () => ({ status: 'ok', items: [observed] }), new AbortController().signal);
    const version = await store.importSource(document);
    for (let i = 0; i < 4; i++) if ((await store.prepareSearch(version.versionId, version.hash)).complete) break;
    await store.review(version.versionId, version.hash, 'operator', { ...assessment(document, prior), observationHash: observationHash(observed) });
    await store.publish(version.versionId, version.hash, embeddings(document));
    return { ...version, document, store };
  }
  const first = await publishWatch(source(), 'main');
  await f.database.runTransaction(tx => first.store.saveLibraryPreference(tx, 'parent', { seriesId: first.document.sourceId, mode: 'follow',
    enabled: true, expectedRevision: 0, editions: [{ sourceId: first.document.sourceId, versionId: first.versionId }] }));
  const renamed = await publishWatch({ ...first.document, publisher: 'Renamed publisher', title: 'Renamed series' }, 'main', first);
  assert.deepEqual((await renamed.store.candidates(filter, null, { libraryUserId: 'parent' })).map(hit => hit.versionId), [renamed.versionId]);
  const widened = await publishWatch({ ...renamed.document, title: 'Broader page' }, 'body', renamed);
  assert.deepEqual(await widened.store.candidates(filter, null, { libraryUserId: 'parent' }), []);
});

test('a live platform page requires a downloaded reviewed edition and cannot bypass a saved snapshot', async () => {
  const html = SOURCE_WATCHES.find(item => item.id === 'fhs-solid-food')!;
  const pdf = parseKnowledgeSource(JSON.parse(await readFile(new URL('../knowledge/hk-official-seed.json', import.meta.url), 'utf8'))
    .find((item: KnowledgeSourceInput) => item.sourceId === 'fhs-feeding-booklet-en'));
  const f = fixture([pdf.sourceId, html.id, 'chp-recent']);
  const refresh = createFirestoreKnowledgeRefresh({ ...f.options, definitions: [html],
    async readControl() { return { enabled: true, generation: 'f3457654-6524-4c99-bf56-d26dfb9f4dbd' }; } });
  const store = createFirestoreKnowledgeStore({ ...f.options, cipher: createStorageCipher(Buffer.alloc(32, 13)), observations: refresh.gate });
  assert.equal(await store.mayReadLivePage('alice', html.id), false);
  assert.equal(await store.mayReadLivePage('alice', 'chp-recent'), false);
  assert.equal(await store.mayReadLivePage('alice', 'other-page'), false);
  assert.equal(await store.publishedLiveSeries(html.id, html.url), null); assert.equal(f.records.size, 0);
  await f.publish(pdf);
  const first = (await store.catalogForUser('alice', null)).items[0]!;
  assert.equal((await store.publishedLiveSeries(html.id, html.url))?.id, first.series?.id);
  await f.database.runTransaction(tx => store.saveLibraryPreference(tx, 'alice', { mode: 'fixed', enabled: false, expectedRevision: first.preference!.revision,
    seriesId: first.series!.id, editions: [{ sourceId: pdf.sourceId, versionId: first.versionId }] }));
  assert.equal(await store.mayReadLivePage('alice', html.id), false);
  assert.equal(await store.mayReadLivePage('bob', html.id), false);
  await refresh.register(html.id, 'synthetic-operator'); await refresh.disable(html.id);
  assert.equal(await store.mayReadLivePage('bob', html.id), false);
});

test('the archived page-three FHS seed and its parser evidence round-trip through the ZIP into a separately reviewed index', async t => {
  const seed: unknown[] = JSON.parse(await readFile(new URL('../knowledge/hk-official-seed.json', import.meta.url), 'utf8'));
  const pdf = seed.map(parseKnowledgeSource).find(source => source.sourceId === 'fhs-feeding-booklet-en')!;
  // This existing edition was read before full-booklet capture. Reproduce its historical watch.
  const { leafletPage: _laterDiscoveryPage, ...catalogue } = SOURCE_WATCHES.find(source => source.id === pdf.sourceId)!;
  const definition = { ...catalogue, pdfPages: { startPage: 3, endPage: 3 } };
  const observed = { url: pdf.url, title: 'Original PDF publication title', text: pdf.chunks[0]!.originalText!, extraction: pdf.extraction,
    pages: [{ page: 3, text: pdf.chunks[0]!.originalText!, status: 'text' as const }], sourcePublishedAt: null, sourceUpdatedAt: null, sourceDateText: null };
  async function environment() {
    const f = fixture([pdf.sourceId]), refresh = createFirestoreKnowledgeRefresh({ ...f.options, definitions: [definition],
      async readControl() { return { enabled: true, generation: 'f3457654-6524-4c99-bf56-d26dfb9f4dbd' }; } });
    return { ...f, knowledge: createFirestoreKnowledgeStore({ ...f.options, observations: refresh.gate }), async observe() {
      await refresh.register(definition.id, 'synthetic-operator');
      await refresh.process((await refresh.jobs())[0]!.data, crypto.randomUUID(), async () => ({ status: 'ok', items: [observed] }), new AbortController().signal);
    } };
  }
  const src = await environment(), dest = await environment();
  const cipher = createStorageCipher(Buffer.alloc(32, 31));
  await src.observe();
  const first = await src.knowledge.importSource(pdf), review = { ...assessment(pdf), observationHash: observationHash(observed) };
  for (let n = 0; n < 4; n++) await src.knowledge.prepareSearch(first.versionId, first.hash);
  await src.knowledge.review(first.versionId, first.hash, 'synthetic-operator', review);
  await src.knowledge.publish(first.versionId, first.hash, embeddings(pdf));
  const dir = await mkdtemp(join(tmpdir(), 'req006-pdf-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'feeding.zip'), selected = [{ sourceId: pdf.sourceId, versionHash: first.hash }];
  const user = 'family-user', childId = '22222222-2222-4222-8222-222222222222', scope = {
    ownerUserId: user, workspaceId: crypto.randomUUID(), childId, storageEpoch: crypto.randomUUID() };
  const library = createFirestorePersonalLibrary({ ...src.options, cipher, knowledge: src.knowledge, authority: { async readScope(owner, child) {
    assert.equal(owner, user); assert.equal(child, childId); return { scope, authorizationVersion: '1' };
  } } });
  const selection = { seriesId: 'fhs-infant-feeding', editions: selected };
  const download = (request: typeof selection) => fetchLibraryArchive('https://local.test', (url, init) =>
    handlePersonalLibraryRequest(new Request(url, init), user, { library, isCurrentUser: async () => true, readJson: input => input.json() }),
    childId, user, request, new AbortController().signal);
  await assert.rejects(download({ ...selection, editions: [{ ...selected[0]!, versionHash: 'f'.repeat(64) }] }));
  const exported = await download(selection), bytes = new Uint8Array(await exported.response.arrayBuffer());
  assert.equal(bytes.length, exported.bytes); assert.equal(createHash('sha256').update(bytes).digest('hex'), exported.sha256);
  await writeFile(path, bytes);
  const archive = await openKnowledgeArchive(path, exported.sha256); t.after(() => archive.close());
  const raw = await archive.readEdition(0) as Awaited<ReturnType<typeof src.knowledge.exportPublishedEdition>>;
  const portable = readPortableEdition(raw, archive.entries[0]!);
  assert.deepEqual(portable.source, pdf);
  const reader = portable.library!.method!.reader;
  assert.equal(reader.kind, 'pdf'); assert.deepEqual([reader.startPage, reader.endPage], [3, 3]);
  assert.equal(portable.library!.method!.sample.excerptHash, knowledgeHash(pdf.chunks[0]!.sourceExcerpt));
  assert.equal(portable.library!.method!.sample.titleHash, knowledgeHash(observed.title));
  assert.deepEqual(portable.embeddings, embeddings(pdf));
  const mismatch = readPortableEdition({ ...raw, library: { ...raw.library, vectorSpace: 'unrelated-space' } }, archive.entries[0]!);
  assert.deepEqual(mismatch.embeddings, []); assert.deepEqual(mismatch.source, pdf);
  assert.throws(() => readPortableEdition({ ...raw, library: { ...raw.library, method: { ...raw.library!.method, execute: 'untrusted' } } }, archive.entries[0]!));
  assert.equal(await dest.knowledge.publishedEdition(pdf.sourceId), null);
  const ledger = createKnowledgeTransfers({ ...dest.options, cipher }, async () => ({ enabled: true, generation: scope.storageEpoch }));
  const receive = createKnowledgeArchiveReceiver(ledger, dest.knowledge, dir);
  const batch = await receive(new Request('https://local.test/api/admin/knowledge-transfers/' + exported.sha256 + '/content', {
    method: 'POST', headers: { 'content-type': 'application/zip', 'x-archive-bytes': String(bytes.length) }, body: bytes,
  }), exported.sha256, 'isolated-admin', async () => {});
  assert.equal(batch.state, 'completed');
  const imported = (await ledger.results(exported.sha256, 0, 1))[0]!;
  assert.equal(imported.editionState, 'draft');
  const local = { versionId: imported.versionId, hash: first.hash };
  const state = () => dest.records.get(dest.options.namespace + '_knowledge_versions/' + local.versionId)!.imported.methodState;
  assert.equal(state(), 'pending_local_check');
  await dest.observe();
  const wrongReader = structuredClone(portable.library!); wrongReader.method!.reader.version = '0.0.1';
  await dest.knowledge.importSource(portable.source, undefined, wrongReader); assert.equal(state(), 'pending_local_check');
  await dest.knowledge.importSource(portable.source, undefined, portable.library); assert.equal(state(), 'verified_locally');
  assert.deepEqual((await dest.knowledge.catalog()).items, []);
  for (let n = 0; n < 4; n++) await dest.knowledge.prepareSearch(local.versionId, local.hash);
  await dest.knowledge.review(local.versionId, local.hash, 'destination-operator', review);
  await dest.knowledge.publish(local.versionId, local.hash, portable.embeddings);
  const hit = (await dest.knowledge.candidates(filter, null, { query: 'iron' }))[0]!;
  assert.equal(hit.versionHash, first.hash); assert.equal(hit.series?.id, 'fhs-infant-feeding');
  assert.equal(hit.pageStart, 3); assert.equal(hit.extraction?.complete, false); assert.equal(hit.sourceExcerpt, pdf.chunks[0]!.sourceExcerpt);
});

test('a registered whole PDF carries its measured page range and independently verifiable sample in the ZIP', async t => {
  const [{ createElement }, { Document, Page, Text, renderToBuffer }] = await Promise.all([import('react'), import('@react-pdf/renderer')]);
  const quote = 'Fruit on the last physical page.';
  const bytes = await renderToBuffer(createElement(Document, {}, createElement(Page, {}, createElement(Text, {}, 'First page of the test booklet.')),
    createElement(Page, {}, createElement(Text, {}, quote))));
  const id = 'fhs-feeding-booklet-en', watch = SOURCE_WATCHES.find(row => row.id === id)!;
  assert.ok(watch.leafletPage && !watch.pdfPages);
  const fetcher = createKnowledgeSourceFetcher({ async transport(url) {
    if (url === watch.url) return { status: 'response', response: { status: 200, contentType: 'application/pdf', body: bytes } };
    assert.equal(url, watch.leafletPage);
    return { status: 'response', response: { status: 200, contentType: 'text/html',
      body: Buffer.from('<main><h1>Whole booklet</h1><a href="14727.pdf">Read PDF</a></main>') } };
  } });
  function environment() {
    const f = fixture([id]), bucketName = 'demo-portable-private';
    const refresh = createFirestoreKnowledgeRefresh({ ...f.options, definitions: [watch], originalBucket: { bucketName, bucket: avatarMemoryBucket(bucketName).port },
      async readControl() { return { enabled: true, generation: 'f3457654-6524-4c99-bf56-d26dfb9f4dbd' }; } });
    return { f, store: createFirestoreKnowledgeStore({ ...f.options, observations: refresh.gate }), async observe() {
      await refresh.register(id, 'fixture-operator');
      const job = (await refresh.jobs())[0]!.data;
      assert.equal((await refresh.process(job, crypto.randomUUID(), fetcher, new AbortController().signal)).status, 'changed');
      return refresh.inspect(id);
    } };
  }
  const producer = environment(), observed = await producer.observe(), doc = observed.document;
  const sourceInput = { ...source(id), url: watch.url, termsUrl: watch.termsUrl, title: doc.title, publisher: watch.publisher, extraction: doc.extraction!,
    chunks: [chunk('fruit', { sourceExcerpt: quote, originalText: quote, pageStart: 2, pageEnd: 2 })] };
  const version = await producer.store.importSource(sourceInput);
  for (let n = 0; n < 4; n++) if ((await producer.store.prepareSearch(version.versionId, version.hash)).complete) break;
  await producer.store.review(version.versionId, version.hash, 'fixture-operator', { ...assessment(sourceInput), observationHash: observationHash(doc) });
  await producer.store.publish(version.versionId, version.hash, embeddings(sourceInput));
  const catalogItem = (await producer.store.catalog()).items.find(item => item.sourceId === id);
  assert.ok(catalogItem?.methods?.includes('已登記 PDF 原件讀取'));
  assert.equal(catalogItem?.coverage, '第 1–2 頁 / 共 2 頁');
  const dir = await mkdtemp(join(tmpdir(), 'whole-booklet-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'booklet.zip');
  const bundle = await writeKnowledgeArchive(path, [{ sourceId: id, versionHash: version.hash }], row => producer.store.exportPublishedEdition(row.sourceId, row.versionHash));
  const zip = await openKnowledgeArchive(path, bundle.sha256); t.after(() => zip.close());
  const edition = readPortableEdition(await zip.readEdition(0), zip.entries[0]!);
  const library = edition.library!;
  assert.ok(library.method, 'The whole-booklet watch has no configured page window and still needs its verified PDF reader');
  const reader = library.method.reader;
  assert.equal(reader.kind, 'pdf'); assert.deepEqual([reader.startPage, reader.endPage], [1, 2]);
  assert.equal(library.method.sample.excerptHash, knowledgeHash(quote));
  const dest = environment();
  const imported = await dest.store.importSource(edition.source, undefined, library);
  const state = () => dest.f.records.get(dest.f.options.namespace + '_knowledge_versions/' + imported.versionId)!.imported.methodState;
  assert.equal(state(), 'pending_local_check');
  const local = await dest.observe();
  await dest.store.importSource(edition.source, undefined, library);
  assert.equal(state(), 'verified_locally');
  assert.equal(verifyPortableMethod(library, edition.source, local, { ...local.document, pages: local.document.pages!.slice(1) }), 'pending_local_check');
  assert.equal(verifyPortableMethod(library, edition.source, local, { ...local.document, extraction: { ...doc.extraction!, contentHash: '0'.repeat(64) } }), 'pending_local_check');
});

test('a verified PDF range remains readable while a full edition of the same original awaits publication', async () => {
  const [{ createElement }, { Document, Page, Text, renderToBuffer }] = await Promise.all([import('react'), import('@react-pdf/renderer')]);
  const id = 'fhs-feeding-booklet-en', full = SOURCE_WATCHES.find(watch => watch.id === id)!;
  const { leafletPage: _landing, ...base } = full, selected = { ...base, pdfPages: { startPage: 3, endPage: 3 } };
  const quote = 'Original third page text.';
  const bytes = await renderToBuffer(createElement(Document, {}, ...['First physical page of the original booklet.', 'Second physical page of the original booklet.', quote, 'Fourth physical page of the original booklet.'].map((text, i) =>
    createElement(Page, { key: i }, createElement(Text, {}, text)))));
  const f = fixture([id]), bucketName = 'demo-originals', bucket = avatarMemoryBucket(bucketName);
  const options = { ...f.options, originalBucket: { bucketName, bucket: bucket.port },
    async readControl() { return { enabled: true, generation: 'f3457654-6524-4c99-bf56-d26dfb9f4dbd' }; } };
  const older = createFirestoreKnowledgeRefresh({ ...options, definitions: [selected] });
  const expanded = createFirestoreKnowledgeRefresh({ ...options, definitions: [full] });
  const cipher = createStorageCipher(Buffer.alloc(32, 42));
  const oldStore = createFirestoreKnowledgeStore({ ...f.options, cipher, observations: older.gate });
  const store = createFirestoreKnowledgeStore({ ...f.options, cipher, observations: expanded.gate });
  function readOriginal(pdf: Buffer) {
    return createKnowledgeSourceFetcher({ async transport(url) {
      if (url === full.url) return { status: 'response', response: { status: 200, contentType: 'application/pdf', body: pdf } };
      assert.equal(url, full.leafletPage);
      return { status: 'response', response: { status: 200, contentType: 'text/html', body: Buffer.from('<main><h1>Booklet</h1><a href="14727.pdf">Read</a></main>') } };
    } });
  }
  const fetcher = readOriginal(bytes);
  async function observe(refresh: typeof expanded, read = fetcher) {
    const job = (await refresh.jobs())[0]!.data, checkId = crypto.randomUUID();
    await refresh.process(job, checkId, read, new AbortController().signal);
    return { checkId, ...await refresh.inspect(id) };
  }
  await older.register(id, 'operator');
  const original = await observe(older);
  assert.ok(original.observation);
  const sourceInput = { ...source(id), url: full.url, termsUrl: full.termsUrl, publisher: full.publisher,
    extraction: original.document.extraction!, chunks: [chunk('old-page', { pageStart: 3, pageEnd: 3, originalText: quote, sourceExcerpt: quote })] };
  const version = await oldStore.importSource(sourceInput);
  for (let batch = 0; batch < 4; batch++) if ((await oldStore.prepareSearch(version.versionId, version.hash)).complete) break;
  await oldStore.review(version.versionId, version.hash, 'reviewer', { ...assessment(sourceInput), observationHash: original.observation.contentHash });
  await oldStore.publish(version.versionId, version.hash, embeddings(sourceInput));
  const seriesId = (await oldStore.catalog()).items[0]!.series!.id;
  for (const [owner, mode, enabled] of [['fixed-reader', 'fixed', true], ['subscriber', 'follow', true], ['opted-out', 'fixed', false]] as const) {
    await f.database.runTransaction(tx => oldStore.saveLibraryPreference(tx, owner, {
      seriesId, expectedRevision: 0, enabled, mode, editions: [{ sourceId: id, versionId: version.versionId }],
    }));
  }
  const personalHits = async (user: string) => (await store.candidates(filter, null, { query: 'needle', libraryUserId: user })).map(hit => hit.versionId);

  const oldVersion = structuredClone(f.records.get(f.options.namespace + '_knowledge_versions/' + version.versionId));
  await expanded.register(id, 'operator');
  const latest = await observe(expanded);
  assert.ok(latest.observation && latest.document.extraction?.complete);
  assert.deepEqual((await store.catalog()).items, []);
  const request = { sourceId: id, versionId: version.versionId, versionHash: version.hash, pdfHash: sourceInput.extraction.contentHash,
    observationHash: latest.observation.contentHash, checkId: latest.checkId, operator:'operator' } as const;
  // Fork only the in-memory database to exercise independent operator transitions against the same immutable object.
  function copyState() {
    const copy = fixture([id]);
    for (const [path, value] of f.records) copy.records.set(path, structuredClone(value));
    const refresh = createFirestoreKnowledgeRefresh({ ...options, ...copy.options, definitions: [full] });
    return { ...copy, refresh, knowledge: createFirestoreKnowledgeStore({ ...copy.options, observations: refresh.gate }) };
  }
  const ambiguous = copyState(), receiptPrefix = f.options.namespace + '_knowledge_checks/', otherJobId = crypto.randomUUID();
  ambiguous.records.set(receiptPrefix + otherJobId, { ...ambiguous.records.get(receiptPrefix + latest.checkId), jobId: otherJobId, readMethod: 'different-parser' });
  await assert.rejects(ambiguous.knowledge.recheckPdfRange(request, ambiguous.refresh.originals.readPdf), /knowledge_pdf_range_check_mismatch/);

  const concurrent = copyState();
  function otherReceipt(watchId: string) {
    const jobId = crypto.randomUUID();
    concurrent.records.set(receiptPrefix + jobId, { ...concurrent.records.get(receiptPrefix + latest.checkId), jobId, watchId,
      itemHashes: [{ sourceId: watchId, contentHash: request.observationHash }] });
  }
  otherReceipt('unrelated-watch');
  await concurrent.knowledge.recheckPdfRange(request, concurrent.refresh.originals.readPdf);
  assert.equal((await concurrent.knowledge.catalog()).items[0]?.versionId, version.versionId);
  for (let i = 0; i < 7; i++) otherReceipt('unrelated-watch-' + i);
  await assert.rejects(concurrent.knowledge.recheckPdfRange(request, concurrent.refresh.originals.readPdf), /knowledge_pdf_range_check_mismatch/);

  const legacy = copyState(), watchPath = f.options.namespace + '_knowledge_watches/' + id;
  delete legacy.records.get(watchPath)!.priorPdfRevision; // Registration created by the previous release.
  await assert.rejects(legacy.knowledge.recheckPdfRange(request, legacy.refresh.originals.readPdf), /knowledge_pdf_range_check_mismatch/);
  const legacyRequest = { ...request, confirmedLegacyExpansion: true };
  await legacy.knowledge.recheckPdfRange(legacyRequest, legacy.refresh.originals.readPdf);
  assert.equal((await legacy.knowledge.catalog()).items[0]?.versionId, version.versionId);
  await legacy.refresh.disable(id);
  await legacy.refresh.register(id,'operator');
  const reenabled = await observe(legacy.refresh);
  assert.deepEqual((await legacy.knowledge.catalog()).items, []);
  await assert.rejects(legacy.knowledge.recheckPdfRange({ ...legacyRequest, checkId: reenabled.checkId }, legacy.refresh.originals.readPdf), /knowledge_pdf_range_check_mismatch/);
  await assert.rejects(store.recheckPdfRange({ ...request, checkId: original.checkId }, expanded.originals.readPdf), /knowledge_pdf_range_check_mismatch/);
  await store.recheckPdfRange(request, expanded.originals.readPdf);

  const corrected = copyState();
  const correction = await observe(corrected.refresh, async (definition, signal) => {
    const result = await fetcher(definition, signal);
    assert.equal(result.status, 'ok');
    const items = result.items.map(item => {
      const pages = item.pages!.map(page => page.page === 4 ? { ...page, text: 'Corrected fourth physical page text.' } : page);
      return { ...item, pages, text: pages.map(page => page.text).join('\n\n') };
    });
    return { ...result, items };
  });
  assert.equal(correction.document.extraction?.contentHash, request.pdfHash);
  assert.notEqual(correction.observation?.contentHash, request.observationHash);
  assert.deepEqual((await corrected.knowledge.catalog()).items, []);
  await assert.rejects(corrected.knowledge.recheckPdfRange(request, corrected.refresh.originals.readPdf), /knowledge_pdf_range_unavailable/);
  await corrected.knowledge.recheckPdfRange({
    ...request, checkId: correction.checkId, observationHash: correction.observation!.contentHash,
  }, corrected.refresh.originals.readPdf);
  assert.deepEqual((await corrected.knowledge.catalog()).items.map(item => item.versionId), [version.versionId]);
  assert.deepEqual((await corrected.knowledge.candidates(filter, null, { query: 'needle' })).map(hit => hit.pageStart), [3]);

  const changed = copyState();
  const edited = readOriginal(Buffer.concat([bytes, Buffer.from('\n% different original')]));
  const different = await observe(changed.refresh, edited);
  assert.deepEqual((await changed.knowledge.catalog()).items, []);
  await assert.rejects(changed.knowledge.recheckPdfRange({ ...request, checkId: different.checkId, observationHash: different.observation!.contentHash,
    pdfHash: different.document.extraction!.contentHash }, changed.refresh.originals.readPdf), /knowledge_pdf_range_unavailable/);

  const wrongMethod = copyState();
  const unexpected = await observe(wrongMethod.refresh, async (definition, signal) => {
    const result = await fetcher(definition, signal);
    return result.status === 'ok' ? { ...result, readMethod:'different-parser' } : result;
  });
  assert.deepEqual((await wrongMethod.knowledge.catalog()).items, []);
  await assert.rejects(wrongMethod.knowledge.recheckPdfRange({ ...request, checkId: unexpected.checkId }, wrongMethod.refresh.originals.readPdf), /knowledge_pdf_range_check_mismatch/);
  const failed = copyState(), failedJob = (await failed.refresh.jobs())[0]!.data;
  await failed.refresh.process(failedJob, crypto.randomUUID(), async () => ({ status: 'failed', reason: 'network' }), new AbortController().signal);
  assert.equal((await failed.knowledge.catalog()).items[0]?.versionId, version.versionId);
  await failed.refresh.process(failedJob, crypto.randomUUID(), async () => ({ status: 'failed', reason: 'parse' }), new AbortController().signal);
  assert.deepEqual((await failed.knowledge.catalog()).items, []);
  await assert.rejects(failed.knowledge.recheckPdfRange(request, failed.refresh.originals.readPdf), /knowledge_pdf_range_check_mismatch/);
  const withdrawn = copyState(), job = (await withdrawn.refresh.jobs())[0]!.data;
  await withdrawn.refresh.process(job, crypto.randomUUID(), async () => ({status:'unavailable', httpStatus: 410 }), new AbortController().signal);
  assert.deepEqual((await withdrawn.knowledge.catalog()).items, []);
  const restored = await observe(withdrawn.refresh);
  await assert.rejects(withdrawn.knowledge.recheckPdfRange({ ...legacyRequest, checkId: restored.checkId }, withdrawn.refresh.originals.readPdf), /knowledge_pdf_range_check_mismatch/);
  const rights = createFirestoreKnowledgeRefresh({ ...options, definitions: [{ ...full, termsUrl:'https://www.fhs.gov.hk/changed-terms'}] });
  const changedRights = createFirestoreKnowledgeStore({ ...f.options, observations: rights.gate });
  assert.deepEqual((await changedRights.catalog()).items, []);
  await assert.rejects(changedRights.recheckPdfRange(request, expanded.originals.readPdf), /knowledge_pdf_range_unavailable/);
  const race = copyState();
  await assert.rejects(race.knowledge.recheckPdfRange(request, async (sourceId, sha) => {
    const original = await race.refresh.originals.readPdf(sourceId, sha);
    await race.knowledge.disable(id,'Operator withdrawal during readback');
    return original;
  }), /knowledge_pdf_range_unavailable/);
  assert.deepEqual((await race.knowledge.catalog()).items, []);
  assert.deepEqual((await store.catalog()).items.map(row => row.versionHash), [version.hash]);
  const hit = (await store.candidates(filter, null, { query:'needle' }))[0]!;
  assert.equal(hit.versionId, version.versionId); assert.equal(hit.pageStart, 3); assert.equal(hit.pageEnd, 3);
  assert.deepEqual(f.records.get(f.options.namespace + '_knowledge_versions/' + version.versionId), oldVersion);
  await assert.rejects(store.publish(version.versionId, version.hash), /knowledge_observation_review_required/);

  const repeated = await observe(expanded);
  assert.deepEqual(await personalHits('fixed-reader'), [version.versionId]);
  assert.deepEqual(await personalHits('subscriber'), [version.versionId]);
  assert.deepEqual(await personalHits('opted-out'), []);
  const newQuote = latest.document.pages![3]!.text;
  const newInput = { ...sourceInput, extraction: latest.document.extraction!, title: latest.document.title,
    chunks: [...sourceInput.chunks, chunk('full-only', { pageStart: 4, pageEnd: 4, originalText: newQuote, sourceExcerpt: newQuote })] };
  const next = await store.importSource(newInput);
  assert.deepEqual((await store.catalog()).items.map(row => row.versionId), [version.versionId]);
  await assert.rejects(store.recheckPdfRange({ ...request, versionId: next.versionId, versionHash: next.hash }, expanded.originals.readPdf));
  await store.review(next.versionId, next.hash,'reviewer', { ...assessment(newInput, { ...version, document: sourceInput }), observationHash: latest.observation.contentHash });
  assert.deepEqual((await store.catalog()).items.map(row => row.versionId), [version.versionId]);
  const late = copyState(), lateObservation = late.records.get(f.options.namespace + '_knowledge_observations/' + id)!;
  delete lateObservation.pdfReadback;
  await late.knowledge.recheckPdfRange({ ...request, checkId: repeated.checkId }, late.refresh.originals.readPdf);
  assert.deepEqual((await late.knowledge.catalog()).items.map(row => row.versionId), [version.versionId]);
  for (let batch = 0; batch < 4; batch++) if ((await store.prepareSearch(next.versionId, next.hash)).complete) break;
  await store.publish(next.versionId, next.hash, embeddings(newInput));
  assert.deepEqual((await store.catalog()).items.map(row => row.versionId), [next.versionId]);
  assert.deepEqual((await store.candidates(filter, null, { query: 'needle' })).map(hit => hit.pageStart).sort(), [3, 4]);
  assert.deepEqual(await personalHits('fixed-reader'), [version.versionId]);
  assert.deepEqual(await personalHits('subscriber'), []);
  assert.deepEqual(await personalHits('opted-out'), []);
  assert.equal((await store.citedPdf(hit))?.sha256, request.pdfHash);
});

test('REQ-006 structural identifiers match exactly, excluded rows stay archived and detailed exceptions remain retrievable', async () => {
  const detailed = chunk('safety', { treatment: { kind: 'detailed', policyVersion: 1 } });
  const structured = chunk('batch', { text: 'Exact batch listing', originalText: 'Confirmed batch HK-640 on 2026-01-14.', treatment: {
    kind: 'structured', policyVersion: 1, fields: [{ label: 'Batch', value: 'HK-640' }, { label: 'Date', value: '2026-01-14' }] } });
  const overview = chunk('overview', { text: 'Background programme introduction', treatment: { kind: 'overview', policyVersion: 1 } });
  const noise = chunk('navigation', { treatment: { kind: 'excluded', policyVersion: 1, reason: 'Navigation' } });
  const f = fixture(), doc = source('synthetic-guidance', [detailed, overview, structured, noise]);
  const input = await f.store.importSource(doc); await f.store.review(input.versionId, input.hash, 'operator', assessment(doc));
  assert.deepEqual((await f.store.missingDocuments(input.versionId)).map(row => row.text).sort(), [detailed.text, overview.text].sort());
  await f.store.publish(input.versionId, input.hash, embeddings(doc).filter(item => ['safety', 'overview'].includes(item.chunkKey)));
  assert.equal((await f.store.candidates(filter, null, { query: 'programme' }))[0]?.treatment?.kind, 'overview');
  assert.equal((await f.store.candidates(filter, null, { query: 'HK-640' }))[0]?.key, 'batch');
  assert.ok(!(await f.store.candidates(filter, vector, { query: 'HK-641' })).some(row => row.key === 'batch'));
  assert.ok(!(await f.store.candidates(filter, null, { query: 'Batch 13' })).some(row => row.key === 'batch'));
  assert.deepEqual((await f.store.candidates(filter, null)).map(hit => hit.key).sort(), ['batch', 'overview', 'safety']);
  const methods = (await f.store.catalog()).items[0]!.methods!;
  assert.deepEqual(methods, ['精細保留 · 1 段', '概括整理 · 1 段', '結構化保存 · 1 段', '不進問答索引 · 1 段']);
  const packet = await f.store.exportPublishedEdition(doc.sourceId, input.hash);
  assert.ok(packet.source.chunks.some(row => row.key === 'navigation')); assert.deepEqual(packet.embeddings.map(row => row.chunkKey).sort(), ['overview', 'safety']);
});

const rejects = (code: string) => (error: any) => error?.code === code || error?.message === code;

test("main chat keeps the delivered answer and original PDF after pausing or removing a card, and denies the PDF after platform withdrawal", async () => {
  const { createHash, randomUUID } = await import('node:crypto');
  const { createFirestoreChatStore } = await import('../server/firestore-chat.ts');
  const { createFirestoreCareStore } = await import('../server/firestore-care.ts');
  const { createFirestoreMemoryStore } = await import('../server/firestore-memory.ts');
  const { createFirestoreOnlineStore } = await import('../server/firestore-online.ts');
  const { createFirestoreProductAgentStore } = await import('../server/firestore-product-agent-store.ts');
  const { openCitedPdf } = await import('../server/knowledge-cited-pdf.ts');
  const id = "fhs-feeding-booklet-en", f = fixture([id]);
  const domain = { ...f.options, cipher: createStorageCipher(Buffer.alloc(32, 19)) };
  const authority = createFirestoreAuthority(domain), knowledge = createFirestoreKnowledgeStore(domain);
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  const email = 'parent@example.test', userId = 'parent';
  await authority.issueInvitation({ email, expiresAt: new Date(Date.now() + 60000).toISOString(), operationId: randomUUID() });
  await authority.admitIdentity({ userId, email, emailVerified: true });
  await authority.acknowledge({ userId, policyVersion: SERVICE_POLICY_VERSION, operationId: randomUUID() });
  const { scope: { childId } } = await authority.createChild({ userId, displayName: 'Synthetic', operationId: randomUUID() });
  const chat = createFirestoreChatStore(domain), care = createFirestoreCareStore(domain);
  const memory = createFirestoreMemoryStore({ ...domain, chat, care }), online = createFirestoreOnlineStore(domain);
  const {store: agents, runs} = createFirestoreProductAgentStore({ ...domain, chat, care, memory, online,
    validateKnowledge: async () => {}, continuationKnowledge: async () => [] });
  const library = createFirestorePersonalLibrary({ ...domain, knowledge, authority });
  const client = createProductAgentApi('https://local.test', (target, init) => handlePersonalLibraryRequest(new Request(target, init), userId,
    { library, isCurrentUser: async actual => actual === userId, readJson: req => req.json() }));
  const signal = new AbortController().signal, bytes = Buffer.from('%PDF-1.7\nSynthetic edition');
  const originalHash = createHash('sha256').update(bytes).digest('hex');
  const url = "https://www.fhs.gov.hk/english/health_info/child/14727.pdf";
  const document: KnowledgeSourceInput = { ...source(id, [chunk("first", { pageStart: 1, pageEnd: 1 })]), url,
    extraction: { format: "text_pdf", contentHash: originalHash, pageStart: 1, pageEnd: 1, totalPages: 1, complete: true } };
  const first = await f.publish(document);
  const card = (await client.getLibrary(childId, signal, userId)).items[0]!;
  await client.setLibraryPreference!(childId, signal, userId, { action: 'join', seriesId: card.series!.id, expectedRevision: 0,
    editions: [{ sourceId: id, versionId: first.versionId }] });
  const hits = () => knowledge.candidates(filter, null, { query: 'needle', libraryUserId: userId });
  const [cited] = await hits();
  assert.ok(cited);
  const message = await chat.createUserMessageForUser(userId, childId, 'Synthetic source question');
  const claim = await runs.claim(userId, childId, { kind: 'interactive', reference: message!.id }, 'product-interactive');
  const answer = 'Synthetic answer with a saved public source';
  assert.equal(await runs.finish(claim.scope, { runId: claim.runId, status:'completed', provenance: null, stopReason:null,
    text: answer, citations: [cited], retrievalMode:'keyword_degraded', tools:[], proposals:[], counts:{ modelCalls:0, toolCalls:1, queryEmbeddings:0 },
    deliveryReview: { draftHash: knowledgeHash(answer), sourceVersions: [{ citationId: cited.chunkId, version: cited.versionId, contentHash: cited.contentHash }],
      scope: {userId,childId,workspaceId:claim.scope.workspaceId,dataVersion:claim.scope.dataVersion,authorizationVersion:claim.scope.authorizationVersion},
      decision:'pass',visibility:'private',model:'synthetic',promptVersion:'1',policyVersion:'synthetic/1' } }), true);
  const delivered = await chat.createModelMessageForUser(userId, childId, message!.id, answer);
  const newer = await f.publish({ ...document, extraction: { ...document.extraction!, contentHash: "b".repeat(64) },
    chunks: [{ ...document.chunks[0]!, sourceExcerpt: "Revised excerpt", originalText: "Revised excerpt and body" }] }, first);
  const readRun = () => agents.get(userId, childId, claim.runId);
  const reopen = () => openCitedPdf(new Request('https://local.test/original'), cited.chunkId, readRun, { resolve: knowledge.citedPdf, read: async () => bytes });
  for (const [revision, mode] of (['follow', 'platform'] as const).entries()) {
    await client.setLibraryPreference!(childId, signal, userId, { seriesId: card.series!.id, mode, expectedRevision: revision + 1,
      wholeSeries: true, enabled: false, editions: [{ sourceId: id, versionId: newer.versionId }] });
    assert.deepEqual(await hits(), []);
    assert.ok((await chat.listForUser(userId, childId))?.messages.some(item => item.id === delivered?.id && item.text === answer));
    const archived = await readRun();
    assert.equal(archived?.text, answer); assert.equal(archived?.citations[0]?.versionHash, first.hash);
    const reopened = await reopen();
    assert.equal(reopened.status, 200); assert.deepEqual(Buffer.from(await reopened.arrayBuffer()), bytes);
  }
  assert.deepEqual(await f.store.citedPdf(cited), { sourceId: id, url, sha256: originalHash });
  assert.equal(await f.store.citedPdf({ ...cited, contentHash: "f".repeat(64) }), null);
  assert.equal(await f.store.citedPdf({ ...cited, versionId: "88888888-8888-4888-8888-888888888888" }), null);
  await f.store.disable(id, "Synthetic withdrawal");
  assert.equal(await f.store.citedPdf(cited), null);
  assert.equal((await reopen()).status,404);
});

test("operator edition export returns portable source and compatible vectors in one read-only transaction and fences stale or unavailable editions", async t => {
  const f = fixture(), validUntil = new Date(Date.now() + 3600000).toISOString();
  const published = await f.publish({ ...source("synthetic-guidance", [chunk("first"), chunk("second", { text: "Second portable body" })]), validUntil });
  assert.equal(typeof f.store.exportPublishedEdition, "function");
  const before = structuredClone([...f.records]), transactions = t.mock.method(f.database, "runTransaction");
  const exported = await f.store.exportPublishedEdition(published.document.sourceId, published.hash);
  assert.equal(transactions.mock.callCount(), 1);
  assert.deepEqual(transactions.mock.calls[0]!.arguments[1], { readOnly: true });
  t.mock.restoreAll();
  assert.deepEqual([...f.records], before);
  assert.deepEqual(exported.library?.series, { id: published.document.sourceId, institutionId: 'www.fhs.gov.hk', name: published.document.title });
  assert.deepEqual({ ...exported, library: undefined }, { library: undefined, source: parseKnowledgeSource(published.document), versionHash: published.hash, embeddings: embeddings(published.document) });
  assert.doesNotMatch(JSON.stringify(exported), /synthetic-operator|reviewer|projectId|namespace|chunkId|vectorHash/u);
  // The destination still performs its own review and publication; only the compatible vector payload travels.
  const destination = fixture(), imported = await destination.store.importSource(exported.source);
  assert.equal(imported.hash, exported.versionHash);
  await destination.store.review(imported.versionId, imported.hash, "destination-operator", assessment(exported.source));
  await destination.store.publish(imported.versionId, imported.hash, exported.embeddings);
  assert.equal((await destination.store.candidates(filter, null, { query: "needle" }))[0]!.originalText, published.document.chunks[0]!.originalText);
  await assert.rejects(f.store.exportPublishedEdition(published.document.sourceId, "0".repeat(64)), rejects("knowledge_review_version_mismatch"));
  const denied = createFirestoreKnowledgeStore({ ...f.options, sourceIds: ["another-guidance"] });
  await assert.rejects(denied.exportPublishedEdition(published.document.sourceId, published.hash), rejects("knowledge_source_not_allowed"));
  t.mock.method(Date, "now", () => Date.parse(validUntil) + 1);
  await assert.rejects(f.store.exportPublishedEdition(published.document.sourceId, published.hash), rejects("knowledge_source_unavailable"));
  assert.equal((await f.store.publishedEdition(published.document.sourceId))?.versionHash, published.hash, "Existing metadata callers keep their prior semantics");
  t.mock.restoreAll();
  await f.store.disable(published.document.sourceId, "Synthetic withdrawal");
  await assert.rejects(f.store.exportPublishedEdition(published.document.sourceId, published.hash), rejects("knowledge_source_unavailable"));
});

test("operator edition export refuses internal URLs and registered internal watch usage even from an internal store", async () => {
  for (const internal of ["url", "watch"] as const) {
    const f = fixture(["synthetic-guidance"], "internal"), document = { ...source(),
      ...(internal === "url" ? { url: "https://www.chp.gov.hk/synthetic-guidance" } : {}) };
    const definition = { id: document.sourceId, url: document.url, kind: "page" as const, selector: "main", classification: document.classification,
      publisher: document.publisher, termsUrl: document.termsUrl, audience: internal === "watch" ? "internal_noncommercial" as const : "public_noncommercial" as const };
    const refresh = createFirestoreKnowledgeRefresh({ ...f.options, definitions: [definition], async readControl() { return { enabled: true, generation: "f3457654-6524-4c99-bf56-d26dfb9f4dbd" }; } });
    await refresh.register(definition.id, "synthetic-operator");
    const observed = { url: document.url, title: document.title, text: document.chunks[0]!.originalText!, sourcePublishedAt: null, sourceUpdatedAt: null, sourceDateText: null };
    await refresh.process((await refresh.jobs())[0]!.data, crypto.randomUUID(), async () => ({ status: "ok", items: [observed] }), new AbortController().signal);
    const store = createFirestoreKnowledgeStore({ ...f.options, observations: refresh.gate });
    const imported = await store.importSource(document);
    for (let page = 0; page < 4; page++) await store.prepareSearch(imported.versionId, imported.hash);
    await store.review(imported.versionId, imported.hash, "synthetic-operator", { ...assessment(document), observationHash: observationHash(observed) });
    await store.publish(imported.versionId, imported.hash, embeddings(document));
    const before = structuredClone([...f.records]);
    await assert.rejects(store.exportPublishedEdition(document.sourceId, imported.hash), rejects("knowledge_source_internal_export_forbidden"));
    assert.deepEqual([...f.records], before);
  }
});

test("Firestore knowledge rebuild pages repair missing, corrupt and stale postings without changing publication or lowering completeness", async () => {
  const f = fixture(), published = await f.publish();
  assert.equal(typeof f.store.rebuildSearchPageIn, "function");
  const citation = (await f.store.candidates(filter, null, { query: "needle" }))[0]!;
  const versionPath = `synthetic_knowledge_knowledge_versions/${published.versionId}`;
  const versionBefore = structuredClone(f.records.get(versionPath));
  const businessBefore = [...f.records].filter(([path]) => !path.includes("_knowledge_lexical/"));
  const postings = [...f.records].filter(([path]) => path.includes("_knowledge_lexical/"));
  assert.ok(postings.length >= 2);
  f.records.delete(postings[0]![0]);
  f.records.set(postings[1]![0], { ...postings[1]![1], terms: { corrupt: [] } });
  const occupied = new Set(postings.map(([, row]) => row.bucket));
  const emptyBucket = Array.from({ length: KNOWLEDGE_LEXICAL_BUCKETS }, (_, index) => index).find(index => !occupied.has(index))!;
  // Seed a stale derived bucket at its actual deterministic document key.
  const bytes = createHash("sha256").update(JSON.stringify([f.options.projectId, f.options.namespace, "lexical", KNOWLEDGE_LEXICAL_PIPELINE,
    published.versionId, emptyBucket])).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 15) | 80; bytes[8] = (bytes[8]! & 63) | 128;
  const hex = bytes.toString("hex"), id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  const stalePath = `${f.options.namespace}_knowledge_lexical/${id}`;
  f.records.set(stalePath, { ...postings[0]![1], bucket: emptyBucket });
  const damaged = structuredClone([...f.records]);
  const rebuild = (start: number, hash = published.hash) => f.database.runTransaction(tx => f.store.rebuildSearchPageIn(tx, published.versionId, hash, start));
  await assert.rejects(rebuild(0, "0".repeat(64)), rejects("knowledge_review_version_mismatch"));
  for (const start of [-64, 1, 256, Number.NaN]) await assert.rejects(rebuild(start), rejects("knowledge_search_page_invalid"));
  const denied = createFirestoreKnowledgeStore({ ...f.options, sourceIds: ["another-guidance"] });
  await assert.rejects(f.database.runTransaction(tx => denied.rebuildSearchPageIn(tx, published.versionId, published.hash, 0)), rejects("knowledge_binding_invalid"));
  assert.deepEqual([...f.records], damaged, "Rejected pages must not stage any writes");
  for (let start = 0; start < KNOWLEDGE_LEXICAL_BUCKETS; start += KNOWLEDGE_LEXICAL_BATCH) {
    const progress = await rebuild(start);
    assert.deepEqual(progress, { complete: start + KNOWLEDGE_LEXICAL_BATCH === KNOWLEDGE_LEXICAL_BUCKETS,
      bucketsCompleted: start + KNOWLEDGE_LEXICAL_BATCH, bucketsTotal: KNOWLEDGE_LEXICAL_BUCKETS, termCount: versionBefore.search.termCount });
    assert.equal(f.records.get(versionPath)!.search.completed, KNOWLEDGE_LEXICAL_BUCKETS);
  }
  assert.equal(f.records.has(stalePath), false);
  assert.deepEqual([...f.records].filter(([path]) => !path.includes("_knowledge_lexical/")), businessBefore);
  assert.deepEqual((await f.store.candidates(filter, null, { query: "needle" }))[0], citation, "The same reviewed citation is searchable again");
  assert.deepEqual([...f.records].filter(([path]) => path.includes("_knowledge_lexical/")).sort(), postings.sort());

  const fresh = fixture(), native = createFirestoreKnowledgeStore(fresh.options), imported = await native.importSource(source());
  const page = (start: number) => fresh.database.runTransaction(tx => native.rebuildSearchPageIn(tx, imported.versionId, imported.hash, start));
  await assert.rejects(page(0), rejects("knowledge_version_unreviewed"));
  await native.review(imported.versionId, imported.hash, "synthetic-operator", assessment(source()));
  const beforeSkip = structuredClone([...fresh.records]);
  await assert.rejects(page(64), rejects("knowledge_search_prefix_incomplete"));
  assert.deepEqual([...fresh.records], beforeSkip);
  assert.equal((await page(0)).bucketsCompleted, 64);
  assert.equal((await page(64)).bucketsCompleted, 128);
});

test("Firestore knowledge publication requires real assessment and complete vectors; disable withdraws catalog and old citations", async () => {
  const f = fixture(), document = source(), imported = await f.store.importSource(document);
  assert.deepEqual(await f.store.catalog(), { items: [], nextSourceId: null }); assert.deepEqual(await f.store.candidates(filter, null), []);
  await assert.rejects(f.store.publish(imported.versionId, imported.hash, embeddings(document)), rejects("knowledge_version_unreviewed"));
  assert.deepEqual(await f.store.review(imported.versionId, imported.hash, "synthetic-operator", assessment(document)), { status: "reviewed" });
  const before = [...f.records]; await assert.rejects(f.store.publish(imported.versionId, imported.hash), rejects("knowledge_vectors_incomplete"));
  assert.deepEqual([...f.records], before);
  await f.store.publish(imported.versionId, imported.hash, embeddings(document));
  const candidates = await f.store.candidates(filter, null), catalog = await f.store.catalog();
  assert.equal(candidates.length, 1); assert.equal(candidates[0]!.originalText, document.chunks[0]!.originalText);
  assert.equal(candidates[0]!.reviewState, "reviewed"); assert.equal(candidates[0]!.usageScope, "public_noncommercial");
  assert.equal(catalog.items[0]!.versionId, imported.versionId);
  await f.store.disable(document.sourceId, "Synthetic withdrawal"); assert.deepEqual(await f.store.catalog(), { items: [], nextSourceId: null });
  assert.deepEqual(await f.store.candidates(filter, null, { chunkIds: [candidates[0]!.chunkId], versionId: imported.versionId }), []);
  await assert.rejects(f.store.publish(imported.versionId, imported.hash), rejects("knowledge_version_unreviewed"));
  await assert.rejects(f.store.review(imported.versionId, imported.hash, "synthetic-operator", assessment(document)), rejects("knowledge_review_baseline_changed"));
});

test("Firestore knowledge import IDs and hashes replay without fetched-date churn, enforce bindings and preserve a legal source larger than one document", async () => {
  const f = fixture(), document = source("synthetic-guidance", Array.from({ length: 32 }, (_, index) => chunk(`section-${index}`,
    { text: "合成正文".repeat(1000), originalText: "合成原文".repeat(1000), sourceExcerpt: "合成原文",
      applicability: { ...chunk("unused").applicability, conditions: Array.from({ length: 8 }, () => "合成條件".repeat(150)) } })));
  assert.ok(Buffer.byteLength(JSON.stringify(document)) > 1024 * 1024);
  const first = await f.store.importSource(document), original = [...f.records];
  const replay = await f.store.importSource({ ...document, fetchedAt: "2026-02-01T00:00:00Z" });
  assert.equal(first.hash, sourceVersionHash(parseKnowledgeSource(document))); assert.deepEqual(replay, { ...first, unchanged: true }); assert.deepEqual([...f.records], original);
  const versions = [...f.records.entries()].filter(([path]) => path.includes("_knowledge_versions/"));
  assert.equal(versions.length, 1); assert.equal("chunks" in versions[0]![1].header, false);
  assert.equal([...f.records.keys()].filter(path => path.includes("_knowledge_chunks/")).length, 32);
  const good = assessment(document);
  await assert.rejects(f.store.review(first.versionId, first.hash, "synthetic-operator", { ...good, changes: [] }), rejects("knowledge_review_incomplete_diff"));
  await assert.rejects(f.store.review(first.versionId, first.hash, "synthetic-operator", { ...good, changes: [{ ...good.changes[0]!, newQuote: "Fabricated quote" }, ...good.changes.slice(1)] }), rejects("knowledge_review_new_quote_mismatch"));
  await f.store.review(first.versionId, first.hash, "synthetic-operator", good);
  const bad = embeddings(document); bad[0] = { ...bad[0]!, inputHash: knowledgeHash("wrong input") };
  const before = [...f.records]; await assert.rejects(f.store.publish(first.versionId, first.hash, bad), rejects("knowledge_vector_binding_invalid"));
  await assert.rejects(f.store.publish(first.versionId, first.hash, embeddings(document).slice(1)), rejects("knowledge_vectors_incomplete"));
  assert.deepEqual([...f.records], before);
  await f.store.publish(first.versionId, first.hash, embeddings(document));
  const all = await f.store.candidates(filter, null, { versionId: first.versionId, limit: 60 }); assert.equal(all.length, 32);
  assert.equal(all[31]!.originalText!.length, 4000); assert.equal(all[31]!.text.length, 4000);
  await assert.rejects(f.store.importSource({ ...source(), url: "https://www.dh.gov.hk/changed" }), rejects("knowledge_source_url_changed"));
  const recent = await f.store.importSource({ ...source(), classification: "recent_information", sourcePublishedAt: "2026-01-01T00:00:00Z" });
  assert.equal(recent.state, "draft", "recent content still needs observation-bound review before publication");
  await assert.rejects(f.store.importSource({ ...source(), watchId: "synthetic-watch" }), rejects("domain_not_ready"));
  assert.throws(() => createFirestoreKnowledgeStore({ ...f.options, sourceIds: [] }), rejects("knowledge_configuration_invalid"));
});

test("Firestore knowledge age boundaries, basis, topics and region filter eligible IDs before native vector querying", async () => {
  const f = fixture(), ranged = (key: string, min: number, max: number, extra: Record<string, unknown> = {}) => chunk(key, {
    applicability: { ...chunk(key).applicability, ageBasis: "actual", minAgeMonths: min, maxAgeMonths: max, ...extra } });
  const document = source("synthetic-guidance", [chunk("any"), ranged("early", 2, 8, { maxAgeMonthsExclusive: true }), ranged("later", 8, 12),
    ranged("corrected", 2, 8, { ageBasis: "corrected" }), ranged("other-topic", 0, 120, { topics: ["other"] }), ranged("other-region", 0, 120, { region: "CN" })]);
  const published = await f.publish(document), all = await f.store.candidates(filter, null), byKey = new Map(all.map(row => [row.key, row.chunkId]));
  const run = async (age: KnowledgeFilter["age"], ageMatch: KnowledgeFilter["ageMatch"], expected: string[]) => {
    const start = f.nearestCalls.length, result = await f.store.candidates({ ...filter, age, ageMatch, topics: ["care"] }, vector, { query: "needle" });
    assert.deepEqual(result.map(row => row.key).sort(), expected.sort());
    const calls = f.nearestCalls.slice(start); assert.equal(calls.length, 1);
    assert.deepEqual(calls[0]!.filters, [["versionId", "==", published.versionId], ["chunkId", "in", document.chunks
      .filter(chunk => expected.includes(chunk.key)).map(chunk => byKey.get(chunk.key))]]);
  };
  await run({ basis: "actual", minMonths: 8, maxMonths: 8 }, "contained", ["any", "later"]);
  await run({ basis: "actual", minMonths: 6, maxMonths: 9 }, "overlap", ["any", "early", "later"]);
  await run({ basis: "actual", minMonths: 6, maxMonths: 9 }, "contained", ["any"]);
  await run(null, "unknown", ["any", "early", "later", "corrected"]);
});

test("Firestore knowledge scores all normalized body text, Latin boundaries and same-version context retains original chunk order", async () => {
  const f = fixture(), document = source("synthetic-guidance", [chunk("z-first", { text: Array.from({ length: 90 }, (_, i) => `prefix${i}`).join(" ") + " ＮＥＥＤＬＥ" }),
    chunk("a-next", { text: "Only pineapple content" }), chunk("m-last", { text: "Only apple content" })]);
  const published = await f.publish(document);
  const long = await f.store.candidates(filter, null, { query: "needle" }); assert.deepEqual(long.map(item => item.key), ["z-first"]);
  assert.ok(long[0]!.rankScore! > 0); assert.equal(long[0]!.distance, null); assert.equal(rankKnowledge("needle", long)[0]!.key, "z-first");
  assert.deepEqual((await f.store.candidates(filter, null, { query: "apple" })).map(item => item.key), ["m-last"]);
  const context = await f.store.candidates(filter, null, { versionId: published.versionId, afterKey: "z-first", limit: 4 });
  assert.deepEqual(context.map(item => item.key), ["a-next", "m-last"]); assert.ok(context.every(item => item.originalText === document.chunks[0]!.originalText));
  assert.deepEqual(await f.store.candidates(filter, null, { versionId: published.versionId, afterKey: "missing" }), []);
});

test("Firestore knowledge atomic publication and bounded reread return the current edition after a publication race", async () => {
  const f = fixture(), first = await f.publish(), nextDocument = { ...first.document, chunks: [chunk("first", { text: "New reviewed needle guidance" }), chunk("second")] };
  const oldCitation = (await f.store.candidates(filter, null))[0]!;
  const next = await f.store.importSource(nextDocument);
  const compared = { document: first.document, versionId: first.versionId, hash: first.hash };
  await assert.rejects(f.store.review(next.versionId, next.hash, "synthetic-operator", assessment(nextDocument)), rejects("knowledge_review_baseline_changed"));
  await f.store.review(next.versionId, next.hash, "synthetic-operator", assessment(nextDocument, compared));
  const before = [...f.records]; f.failCommit();
  await assert.rejects(f.store.publish(next.versionId, next.hash, embeddings(nextDocument)), /Synthetic transaction commit failed/u); assert.deepEqual([...f.records], before);
  f.onNearest(() => f.store.publish(next.versionId, next.hash, embeddings(nextDocument)).then(() => {}));
  const result = await f.store.candidates(filter, vector, { query: "needle" });
  assert.equal(result.length, 2); assert.ok(result.every(item => item.versionId === next.versionId));
  assert.equal(f.nearestCalls.length, 2); assert.equal(f.nearestCalls[0]!.filters[0]![2], first.versionId); assert.equal(f.nearestCalls[1]!.filters[0]![2], next.versionId);
  assert.deepEqual(await f.store.candidates(filter, null, { chunkIds: [oldCitation.chunkId], versionId: first.versionId }), []);
});

test('external material admission binds each reviewed PDF to its exact publisher, terms and bytes', async () => {
  const { readFileSync } = await import('node:fs');
  const { externalMaterialWatches, campaignMaterialWatches, platformMaterials, reviewedExternalOriginal } = await import('../server/platform-materials.ts');
  const { createKnowledgeSourceFetcher, sourceFetchUrl } = await import('../server/knowledge-source-fetch.ts');
  const { familySharingAllowed } = await import('../server/knowledge-portable-series.ts');
  const rights = JSON.parse(readFileSync(new URL('../knowledge/fhs-external-rights.json', import.meta.url), 'utf8')).materials as {
    sourceId: string; url: string; reason: string; sha256?: string; disposition: string }[];
  const originals = JSON.parse(readFileSync(new URL('../knowledge/fhs-child-inventory.json', import.meta.url), 'utf8')).pdfOriginals as {url: string; sha256: string}[];
  assert.deepEqual(rights.filter(row => row.sha256).map(row => row.sha256).sort(),
    originals.filter(row => new URL(row.url).hostname !== 'www.fhs.gov.hk').map(row => row.sha256).sort());
  assert.deepEqual(externalMaterialWatches.map(w => new URL(w.url).hostname).sort(), ['www.dh.gov.hk', 'www.swd.gov.hk']);
  const selected = externalMaterialWatches.find(w => new URL(w.url).hostname === 'www.swd.gov.hk')!;
  const f = fixture(), store = createFirestoreKnowledgeStore({ ...f.options, platformMaterials });
  for (const row of rights) {
    assert.ok(row.url && row.reason);
    assert.equal(campaignMaterialWatches.some(w => w.id === row.sourceId), row.disposition === 'public_noncommercial');
    assert.equal(platformMaterials.has(row.sourceId), row.disposition === 'public_noncommercial');
  }
  const doc: KnowledgeSourceInput = { ...source(selected.id, [chunk('one', { pageStart: 1, pageEnd: 1 })]),
    url: selected.url, termsUrl: selected.termsUrl, publisher: selected.publisher,
    extraction: { format: 'text_pdf', contentHash: reviewedExternalOriginal(selected.url)!, totalPages: 2, pageStart: 1, pageEnd: 2, complete: true } };
  assert.equal((await store.importSource(doc)).state, 'draft');
  assert.equal(familySharingAllowed(doc), true);
  const changed = { ...doc, extraction: { ...doc.extraction!, contentHash: 'c'.repeat(64) } };
  assert.equal(familySharingAllowed(changed), false);
  for (const invalid of [changed, { ...doc, publisher: 'Another department' }, { ...doc, termsUrl: new URL('/other', doc.url).href },
    { ...doc, sourceId: 'synthetic-guidance' }, { ...doc, sourceId: 'synthetic-guidance', url: rights.find(row => row.url.includes('www.cfs.gov.hk'))!.url },
    { ...doc, sourceId: 'synthetic-guidance', url: new URL('/unreviewed.pdf', selected.url).href }])
    await assert.rejects(store.importSource(invalid), rejects('knowledge_transfer_source_binding_invalid'));
  assert.equal(sourceFetchUrl(selected.url, selected).href, selected.url);
  assert.throws(() => sourceFetchUrl(new URL('/other.pdf', selected.url).href, selected), /source_url_rejected/);
  const fetch = createKnowledgeSourceFetcher({ transport: async (value, validate) => {
    validate(value);
    return { status: 'response', response: { status: 200, url: value, contentType: 'application/pdf', body: Buffer.from('%PDF-updated') } };
  }, pdfReader: async () => { throw Error('Unapproved replacement reached the reader'); } });
  assert.deepEqual(await fetch(selected, new AbortController().signal), { status: 'failed', reason: 'response' });
});

test('the March 2026 SWD leaflet uses the existing card and binds each edition to its own bytes', async () => {
  const { campaignMaterialWatches, platformMaterials, reviewedExternalOriginal, externalMaterialAllowed } = await import('../server/platform-materials.ts');
  const { sourceFetchUrl } = await import('../server/knowledge-source-fetch.ts');
  const id = 'resource-6c18c8d7a17495';
  const current = 'https://www.swd.gov.hk/storage/asset/section/652/tc/Bilingual%20Leaflet_We%20All%20Have%20a%20Duty%20(March%202026).pdf';
  const historical = 'https://www.swd.gov.hk/vs/doc/vs/20200330/Leaflet_CP.pdf';
  const currentHash = '0bf08a72f09cbda1ad5a848d7d2ce49adb6c1b7de58409b710f45cda7a9a3dc0';
  const historicalHash = 'afa57bcfc265dcec5c49d89958bc7ae4e0d3dd3dea251d1e33563cb2e6cea63c';
  const watches = campaignMaterialWatches.filter(watch => watch.id === id);
  assert.deepEqual(watches.map(watch => watch.url), [current]);
  assert.deepEqual([...platformMaterials.values()].filter(item => [historical,current].includes(item.url)).map(item => item.id), [id]);
  assert.equal(platformMaterials.get(id)?.url, current);
  assert.equal(reviewedExternalOriginal(current), currentHash);
  assert.equal(reviewedExternalOriginal(historical), historicalHash);
  assert.equal(sourceFetchUrl(current, watches[0]!).href, current);
  assert.throws(() => sourceFetchUrl(historical, watches[0]!), /source_url_rejected/);
  const allowed = (url:string, contentHash:string) => externalMaterialAllowed({sourceId:id, url,
    publisher:watches[0]!.publisher, termsUrl:watches[0]!.termsUrl, classification:'official_guidance',
    extraction:{format:'text_pdf', contentHash, totalPages:2, pageStart:1, pageEnd:2, complete:true}});
  assert.ok(allowed(current,currentHash) && allowed(historical,historicalHash));
  assert.ok(!allowed(current,historicalHash) && !allowed(historical,currentHash));
});

test('a held external observation moves to its registered successor while preserving the old check and original text', async t => {
  const { reviewedExternalOriginal, isReviewedExternalSuccessor } = await import('../server/platform-materials.ts');
  const id = 'resource-6c18c8d7a17495', current = publicMaintenanceWatch(id)!;
  const oldUrl = 'https://www.swd.gov.hk/vs/doc/vs/20200330/Leaflet_CP.pdf';
  const previous = { ...current, url: oldUrl, leafletPage: oldUrl };
  const f = fixture([id]), generation = crypto.randomUUID();
  const settings = { ...f.options, readControl: async () => ({enabled:true,generation}) };
  async function capture(definition: typeof current, contentHash: string) {
    const refresh = createFirestoreKnowledgeRefresh({...settings, definitions:[definition]});
    // The archive port supplies the verified digest; PDF download and storage have independent byte-level tests.
    t.mock.method(refresh.originals, 'save', async () => contentHash);
    await refresh.register(id, 'fixture-operator', true);
    const [job] = await refresh.jobs(id), check = crypto.randomUUID();
    const fetched: SourceFetchResult = {status:'ok', original:{mimeType:'application/pdf',bytes:Buffer.from('%PDF-fixture')},
      items:[{url:definition.url, title:'Child protection',text:'Printed guidance.', pages:[{page:1,text:'Printed guidance.',status:'text'}],
        sourcePublishedAt:null,sourceUpdatedAt:null,sourceDateText:null,
        extraction:{format:'text_pdf',contentHash,totalPages:1,pageStart:1,pageEnd:1,complete:true,extractionQuality:'requires_review'}}]};
    return {refresh,check,job:job!.data, run:()=>refresh.process(job!.data,check,async()=>fetched,new AbortController().signal)};
  }
  const old = await capture(previous, reviewedExternalOriginal(oldUrl)!);
  assert.equal((await old.run()).status, 'changed');
  const retained = (await old.refresh.inspect(id))!.observation!;
  const now = await capture(current, reviewedExternalOriginal(current.url)!);
  assert.equal((await now.run()).status, 'changed');
  assert.equal((await now.run()).status, 'already_recorded');
  const active = await now.refresh.inspect(id);
  assert.equal(active?.document?.url, current.url);
  assert.equal(active?.observation?.approved,null);
  const original = await f.database.runTransaction(tx=>old.refresh.gate.content(tx,retained));
  assert.equal(original.url, oldUrl);
  assert.equal(original.extraction?.contentHash, reviewedExternalOriginal(oldUrl));
  const updated = active!.document!;
  assert.equal(isReviewedExternalSuccessor(id,original,updated),true);
  assert.equal(isReviewedExternalSuccessor('different-card',original,updated),false);
  assert.equal(isReviewedExternalSuccessor(id,{...original,extraction:updated.extraction},updated),false);
  assert.equal(isReviewedExternalSuccessor(id,original,{...updated,extraction:original.extraction}),false);
  assert.equal((await now.refresh.list()).checks.filter(entry=>entry.state==='recorded').length,2);
  const rollback = await capture(previous, reviewedExternalOriginal(oldUrl)!);
  await assert.rejects(rollback.run(), /knowledge_binding_invalid/);
});

test('published campaign cards get observation-only weekly checks and retain a changed original for review', async t => {
  const { campaignMaterialWatches, platformMaterials } = await import('../server/platform-materials.ts');
  const { createFirestoreBackgroundMaintenance } = await import('../server/firestore-background-maintenance.ts');
  const { createFirestoreBackgroundQueue } = await import('../server/firestore-background-work.ts');
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-04-05T01:00:00Z') });
  const definition = campaignMaterialWatches.find(row => row.id === 'fhs-14799')!;
  const pending = campaignMaterialWatches.find(row => row.id === 'fhs-14840')!;
  const f = fixture([definition.id, pending.id]), generation = crypto.randomUUID();
  const domain = { ...f.options, cipher: createStorageCipher(Buffer.alloc(32, 21)) };
  const authority = createFirestoreAuthority(domain);
  await authority.initializeControl({ enabled: true, generation });
  const refresh = createFirestoreKnowledgeRefresh({ ...domain, definitions: [definition, pending], readControl: tx => authority.readControl(tx) });
  const store = createFirestoreKnowledgeStore({ ...domain, platformMaterials, observations: refresh.gate });
  for (const id of [definition.id, pending.id]) await refresh.register(id, 'fixture-maintainer', true);
  const [job] = await refresh.jobs(definition.id);
  const original = { url: definition.url, title: 'Synthetic', text: 'Synthetic source excerpt and original body',
    sourcePublishedAt: null, sourceUpdatedAt: null, sourceDateText: null };
  const signal = new AbortController().signal;
  await refresh.process(job!.data, crypto.randomUUID(), async () => ({ status: 'ok', items: [original] }), signal);
  const document = { ...source(definition.id), url: definition.url, publisher: definition.publisher, termsUrl: definition.termsUrl };
  const first = await store.importSource(document);
  await store.review(first.versionId, first.hash, 'fixture-maintainer', { ...assessment(document), observationHash: observationHash(original) });
  while (!(await store.prepareSearch(first.versionId, first.hash)).complete) {}
  await store.publish(first.versionId, first.hash, embeddings(document));
  let fetches = 0, response: SourceFetchResult = { status: 'ok', items: [original] };
  const maintenance = createFirestoreBackgroundMaintenance({ ...domain, enabled: true, photos: {} as never, erasures: {} as never, cleanup: {} as never,
    knowledge: { ...refresh, process: (data, id, _fetch, sig, slot) => refresh.process(data, id, async () => { fetches++; return response; }, sig, slot) },
    knowledgeAgent: { binding: 'standing-policy', accepts: () => true, run: async () => assert.fail('Observation dispatched a paid stage') } });
  const queue = createFirestoreBackgroundQueue({ ...domain, enabled: true, readControl: tx => authority.readControl(tx),
    transport: { enqueue: () => assert.fail(), probe: () => assert.fail() }, execute(work, signal) {
      assert.equal(work.resourceId, definition.id);
      assert.equal(work.authorizationVersion, '0');
      return maintenance.process(work, signal);
    } });
  const jobs = () => [...f.records].filter(([path]) => path.startsWith(domain.namespace + '_background_work/')).map(([,row]) => row);
  async function deliver() {
    await maintenance.tick();
    const work = jobs().at(-1)!;
    assert.ok(work, 'The published card must have an observation job');
    const delivery = { kind: 'product-work' as const, id: work.id, generation, dispatchRevision: 1, scheduledAt: new Date().toISOString() };
    assert.equal((await queue.process(delivery)).state, 'completed');
    await queue.process(delivery);
  }
  const day = 86_400_000;
  t.mock.timers.tick(day);
  await deliver();
  assert.equal(fetches, 1);
  assert.equal((await refresh.inspect(definition.id)).watch.lastStatus, 'unchanged');
  const changed = { ...original, text: original.text + ' Revised synthetic text.' };
  response = { status: 'ok', items: [changed] };
  t.mock.timers.tick(7 * day);
  await deliver();
  const state = await refresh.inspect(definition.id);
  assert.equal(fetches, 2);
  assert.equal(state.observation!.contentHash, observationHash(changed));
  assert.equal(state.observation!.approved?.contentHash, observationHash(original));
  assert.equal(state.document.text, changed.text);
  assert.equal((await store.catalog()).items[0]?.versionId, first.versionId);
  const download = await store.exportPublishedEdition(definition.id, first.hash, definition.id);
  assert.equal(download.versionHash, first.hash);
  assert.equal(download.source.chunks[0]?.originalText, original.text);
  response = { status: 'failed', reason: 'network' };
  t.mock.timers.tick(7 * day);
  await deliver();
  assert.equal(fetches, 3);
  assert.equal((await refresh.inspect(definition.id)).observation!.contentHash, observationHash(changed));
  assert.equal((await store.catalog()).items[0]?.versionId, first.versionId);
  assert.equal(jobs().length, 3);
  assert.deepEqual((await refresh.jobs(definition.id))[0]?.data, job!.data);
});

test('a weekly check flags a replacement large FHS edition and the saved citation opens its reviewed physical page', async () => {
  const { campaignMaterialWatches, largeFhsPdf, platformMaterials } = await import('../server/platform-materials.ts');
  const { openCitedPdf } = await import('../server/knowledge-cited-pdf.ts');
  const { extractKnowledgePdf } = await import('../server/knowledge-pdf.ts');
  const [{ createElement }, { Document, Page, Text, renderToBuffer }] = await Promise.all([import('react'), import('@react-pdf/renderer')]);
  const quote = 'The reviewed text on physical page two.';
  const bytes = await renderToBuffer(createElement(Document, {}, ...['First physical page of the booklet.', quote].map((line, i) =>
    createElement(Page, { key: i }, createElement(Text, {}, line)))));
  const id = 'pdf-836e9d989e83046a43059df7', pin = largeFhsPdf(id)!;
  const definition = campaignMaterialWatches.find(row => row.id === id)!;
  const f = fixture([id]), bucket = avatarMemoryBucket('private-pdf-fixture'), generation = crypto.randomUUID();
  const refresh = createFirestoreKnowledgeRefresh({ ...f.options, definitions: [definition],
    originalBucket: { bucketName: 'private-pdf-fixture', bucket: bucket.port }, readControl: async () => ({ enabled: true, generation }) });
  const store = createFirestoreKnowledgeStore({ ...f.options, observations: refresh.gate, platformMaterials });
  await refresh.register(id, 'fixture-maintainer', true);
  const job = (await refresh.jobs(id))[0]!.data, signal = new AbortController().signal;
  let body = bytes, exceedsLimit = false;
  const fetch = createKnowledgeSourceFetcher({ async transport(url, validate, _signal, _accept, options) {
    validate(url);
    if (url !== definition.url) return { status: 'response', response: { status: 404, contentType: '', body: Buffer.alloc(0) } };
    assert.equal(options?.maxBytes, pin.bytes);
    if (exceedsLimit) {
      options?.onBodyLimit?.(200, 'application/pdf');
      return { status: 'failed', reason: 'network' };
    }
    return { status: 'response', response: { status: 200, contentType: 'application/pdf', body } };
  } });
  await refresh.process(job, crypto.randomUUID(), fetch, signal);
  const observed = (await refresh.inspect(id)).document;
  const document = { ...source(id, [chunk('original', { sourceExcerpt: quote, originalText: quote, pageStart: 2, pageEnd: 2 })]),
    title: observed.title, url: pin.url, termsUrl: definition.termsUrl, publisher: definition.publisher, extraction: observed.extraction! };
  const first = await store.importSource(document);
  await store.review(first.versionId, first.hash, 'fixture-maintainer', { ...assessment(document), observationHash: observationHash(observed) });
  while (!(await store.prepareSearch(first.versionId, first.hash)).complete) {}
  await store.publish(first.versionId, first.hash, embeddings(document));
  const [citation] = await store.candidates(filter, null, { query: 'needle' });
  assert.ok(citation);
  const slot = new Date().toISOString();
  assert.deepEqual((await refresh.publishedCardChecks(null, slot)).entries.map(row => row.definition.id), [id]);
  body = Buffer.alloc(pin.bytes, 32);
  bytes.copy(body);
  const checkId = crypto.randomUUID();
  assert.equal((await refresh.process(job, checkId, fetch, signal, slot)).status, 'needs_review');
  const fingerprint = { reason: 'new_fingerprint', bytes: body.length, sha256: createHash('sha256').update(body).digest('hex') };
  const admin = await refresh.adminStatus();
  assert.deepEqual(admin.watches[0]?.pdfEditionReview, fingerprint);
  assert.deepEqual(admin.checks.find(check => check.jobId === checkId)?.pdfEditionReview, fingerprint);
  assert.deepEqual(await refresh.resumeCheck(job, checkId), { status: 'failed', reason: 'response', pdfEditionReview: fingerprint });
  assert.equal((await refresh.process(job, checkId, async () => assert.fail('Duplicate weekly fetch'), signal, slot)).status, 'already_recorded');
  exceedsLimit = true;
  const later = crypto.randomUUID();
  assert.equal((await refresh.process(job, later, fetch, signal, slot)).status, 'needs_review');
  assert.deepEqual((await refresh.adminStatus()).watches[0]?.pdfEditionReview, { reason: 'download_limit', limitBytes: pin.bytes });
  assert.equal(bucket.writes(), 1);
  assert.equal((await store.catalog()).items[0]?.versionId, first.versionId);
  const opened = await openCitedPdf(new Request('https://fixture.test/original'), citation.chunkId,
    async () => ({ status: 'completed', citations: [citation] }), { resolve: store.citedPdf, read: target => refresh.originals.readPdf(id, target.sha256) });
  assert.equal(opened.status, 200);
  const page = await extractKnowledgePdf(new Uint8Array(await opened.arrayBuffer()), { expectedHash: document.extraction.contentHash,
    startPage: citation.pageStart!, pageLimit: 1 });
  assert.equal(page.pages[0]?.text, quote);
  await refresh.process(job, crypto.randomUUID(), async () => ({ status: 'failed', reason: 'network' }), signal, slot);
  assert.equal((await refresh.adminStatus()).watches[0]?.pdfEditionReview?.reason, 'download_limit');
  body = bytes; exceedsLimit = false;
  assert.equal((await refresh.process(job, crypto.randomUUID(), fetch, signal, slot)).status, 'unchanged');
  assert.equal((await refresh.adminStatus()).watches[0]?.pdfEditionReview, undefined);
});

test('a downloaded card cites reviewed official captions outside the page text and excludes a removed clip from new retrieval', async () => {
  const { fhsMaterialWatches, platformMaterials } = await import('../server/platform-materials.ts');
  const { createPlatformMediaProcessor } = await import('../server/platform-media-processing.ts');
  const definition = fhsMaterialWatches.find(w => w.id === 'fhs-14799')!, f = fixture([definition.id]);
  const generation = crypto.randomUUID(), signal = new AbortController().signal;
  const refresh = createFirestoreKnowledgeRefresh({ ...f.options, definitions: [definition], readControl: async () => ({ enabled: true, generation }) });
  const store = createFirestoreKnowledgeStore({ ...f.options, observations: refresh.gate, media: refresh.media, platformMaterials,
    cipher: createStorageCipher(Buffer.alloc(32, 21)) });
  await refresh.register(definition.id, 'synthetic-operator');
  const job = (await refresh.jobs())[0]!.data, url = 'https://www.youtube.com/watch?v=zKcYlmle4gI';
  const observed = { url: definition.url, title: 'Synthetic', text: 'The printed source only.', sourcePublishedAt: null, sourceUpdatedAt: null, sourceDateText: null };
  const check = (links: string[], text = observed.text) => refresh.process(job, crypto.randomUUID(),
    async () => ({ status: 'ok', items: [{ ...observed, text }], mediaLinks: links }), signal);
  await check([url]);
  await f.database.runTransaction(async tx => { const state = await refresh.media.read(tx, definition.id); await refresh.media.toggle(tx, definition.id, true, state.revision); });
  const cue = { start: 2.5, end: 5.25, text: 'needle in the official captions' };
  await createPlatformMediaProcessor(refresh.media, f.options.namespace, async () => assert.fail('Timed captions are sufficient'),
    async () => [{ url, hash: knowledgeHash([url, cue]), transcript: '', captions: [cue] }])(definition.id, signal);
  const clip = (await f.database.runTransaction(tx => refresh.media.read(tx, definition.id))).clips![0]!;
  const document = { ...source(definition.id, [chunk('caption', { mediaClip: clip, sourceExcerpt: cue.text, originalText: cue.text })]),
    url: definition.url, termsUrl: definition.termsUrl, publisher: definition.publisher };
  const imported = await store.importSource(document);
  await store.review(imported.versionId, imported.hash, 'synthetic-operator', { ...assessment(document), observationHash: observationHash(observed) });
  while (!(await store.prepareSearch(imported.versionId, imported.hash)).complete) {}
  await store.publish(imported.versionId, imported.hash, embeddings(document));
  const hits = () => store.candidates(filter, null, { query: 'needle', libraryUserId: 'parent' });
  assert.deepEqual(await hits(), []);
  await f.database.runTransaction(tx => store.saveLibraryPreference(tx, 'parent', { action: 'join', seriesId: definition.id,
    expectedRevision: 0, editions: [{ sourceId: definition.id, versionId: imported.versionId }] }));
  const delivered = (await hits())[0]!;
  const { agentCitationSchema } = await import('../src/shared/product-agent-result.ts');
  const savedCitation = JSON.stringify(agentCitationSchema.parse(delivered));
  assert.deepEqual(JSON.parse(savedCitation).mediaClip, clip);
  const changedText = 'A changed printed page awaiting independent review.';
  await check([url], changedText);
  assert.equal((await hits())[0]?.versionId, imported.versionId);
  await check([], changedText);
  assert.deepEqual(await hits(), []);
  assert.deepEqual(agentCitationSchema.parse(JSON.parse(savedCitation)).mediaClip, { ...clip, start: 2.5, end: 5.25 });
  await refresh.process(job, crypto.randomUUID(), async () => ({ status: 'unavailable', httpStatus: 410 }), signal);
  assert.equal((await store.catalog()).items.length, 0);
});

test("F05 source observation fences changed or unavailable evidence and reuses unchanged vectors", async () => {
  const f = fixture(), document = source(), generation = "f3457654-6524-4c99-bf56-d26dfb9f4dbd";
  const definition = { id: document.sourceId, url: document.url, kind: "page" as const, selector: "main",
    classification: document.classification, publisher: document.publisher, termsUrl: document.termsUrl, audience: "public_noncommercial" as const };
  const refresh = createFirestoreKnowledgeRefresh({ ...f.options, definitions: [definition], async readControl() { return { enabled: true, generation }; } });
  const store = createFirestoreKnowledgeStore({ ...f.options, observations: refresh.gate });
  const observed = { url: document.url, title: document.title, text: document.chunks[0]!.originalText!, sourcePublishedAt: null, sourceUpdatedAt: null, sourceDateText: null };
  const check = async (result: SourceFetchResult) => {
    const job = (await refresh.jobs())[0]!.data;
    return refresh.process(job, crypto.randomUUID(), async () => result, new AbortController().signal);
  };
  const prepare = async (id: string, hash: string) => { for (let page = 0; page < 4; page++) if ((await store.prepareSearch(id, hash)).complete) return; assert.fail("Index must finish in four bounded pages"); };
  await refresh.register(definition.id, "synthetic-operator");
  assert.equal((await check({ status: "ok", items: [observed] })).status, "changed");
  const first = await store.importSource(document); await prepare(first.versionId, first.hash);
  await store.review(first.versionId, first.hash, "synthetic-operator", { ...assessment(document), observationHash: observationHash(observed) });
  await store.publish(first.versionId, first.hash, embeddings(document));
  assert.equal((await store.exportPublishedEdition(document.sourceId, first.hash)).versionHash, first.hash);
  assert.equal((await store.candidates(filter, null, { query: "needle" })).length, 1);
  await check({ status: "failed", reason: "network" });
  assert.equal((await store.catalog()).items.length, 1, "A temporary fetch failure is not withdrawal");
  const changed = { ...observed, text: observed.text + " A new unrelated section." };
  await check({ status: "ok", items: [changed] });
  assert.equal((await store.catalog()).items.length, 0, "Old approval cannot bless changed source content");
  await assert.rejects(store.exportPublishedEdition(document.sourceId, first.hash), rejects("knowledge_source_unavailable"));
  const nextDocument = { ...document, chunks: [...document.chunks, chunk("additional", { sourceExcerpt: "A new unrelated section.", text: "New public content", originalText: "A new unrelated section." })] };
  const next = await store.importSource(nextDocument); await prepare(next.versionId, next.hash);
  await store.review(next.versionId, next.hash, "synthetic-operator", { ...assessment(nextDocument, { document, versionId: first.versionId, hash: first.hash }), observationHash: observationHash(changed) });
  assert.equal((await store.missingDocuments(next.versionId)).length, 1, "The unchanged chunk retains its original vector");
  let generated = 0;
  const missing = (await store.missingDocuments(next.versionId))[0]!;
  await store.embedDocument(missing, async () => { generated++; return vector; });
  await store.embedDocument(missing, async () => { assert.fail("Cached embedding must not dispatch again"); });
  assert.equal(generated, 1); await store.publish(next.versionId, next.hash);
  assert.equal((await store.catalog()).items[0]!.versionId, next.versionId);
  await check({ status: "unavailable", httpStatus: 410 });
  assert.equal((await store.catalog()).items.length, 0);
  await assert.rejects(store.review(next.versionId, next.hash, "synthetic-operator", { ...assessment(nextDocument), observationHash: observationHash(changed) }), rejects("knowledge_observation_review_mismatch"));
});


test("Firestore lexical ranking applies topic-gated age specificity before rankScore short circuit", async () => {
  const f = fixture();
  await f.publish(source("synthetic-guidance", [
    chunk("general", { section: "發展", text: "發展", keywords: ["發展"] }),
    chunk("age-specific", { section: "六個月發展", text: "發展", keywords: ["synthetic"] }),
    chunk("unrelated", { section: "六個月加固", text: "六個月米糊", keywords: ["六個月"] }),
  ]));
  for (const query of ["六個月發展", "半歲發展"]) {
    const result = await f.store.candidates(filter, null, { query });
    assert.deepEqual(result.map(item => item.key), ["age-specific", "general"]);
    assert.deepEqual(rankKnowledge(query, result).map(item => item.key), ["age-specific", "general"]);
  }
  assert.deepEqual(await f.store.candidates(filter, null, { query: "六個月" }), []);
  assert.deepEqual(await f.store.candidates(filter, null, { query: "六個月發燒" }), []);
});

