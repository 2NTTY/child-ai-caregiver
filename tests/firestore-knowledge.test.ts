import assert from "node:assert/strict";
import test from "node:test";
import { FieldValue, VectorValue, type Firestore, type VectorQueryOptions } from "@google-cloud/firestore";
import { createFirestoreKnowledgeStore, type FirestoreKnowledgeEmbedding } from "../server/firestore-knowledge.ts";
import { embeddingDocument, knowledgeHash, parseKnowledgeSource, sourceVersionHash } from "../server/knowledge-inputs.ts";
import { knowledgeReviewHash, type KnowledgeReviewAssessment } from "../server/knowledge-review-assessment.ts";
import { rankKnowledge } from "../server/knowledge-ranking.ts";
import { KNOWLEDGE_EMBEDDING, type KnowledgeChunkInput, type KnowledgeFilter, type KnowledgeSourceInput } from "../src/shared/knowledge.ts";
import { firestoreDomainFixture } from "./helpers/firestore-domain-memory.ts";

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
function fixture(sourceIds = ["synthetic-guidance"]) {
  const fake = firestoreDomainFixture(), nearestCalls: { filters: [string, string, unknown][]; options: VectorQueryOptions }[] = [];
  let nearestHook: (() => Promise<void>) | undefined;
  const encode = (value: any): any => value instanceof VectorValue ? { syntheticVector: value.toArray() }
    : Array.isArray(value) ? value.map(encode) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encode(item)])) : value;
  const decode = (value: any): any => value && typeof value === "object" && Object.keys(value).length === 1 && Array.isArray(value.syntheticVector)
    ? FieldValue.vector(value.syntheticVector) : Array.isArray(value) ? value.map(decode)
      : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)])) : value;
  const snapshot = (snap: any) => ({ ...snap, data: () => decode(snap.data()), get: (key: string) => decode(snap.get(key)) });
  const wrap = (query: any): any => ({ ...query, where: (...args: any[]) => wrap(query.where(...args)),
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
    })) } as unknown as Firestore;
  const options = { database, projectId: "synthetic-knowledge-project", namespace: "synthetic_knowledge", sourceIds }, store = createFirestoreKnowledgeStore(options);
  async function publish(document = source(), compared: Parameters<typeof assessment>[1] = null) {
    const imported = await store.importSource(document); await store.review(imported.versionId, imported.hash, "synthetic-operator", assessment(document, compared));
    await store.publish(imported.versionId, imported.hash, embeddings(document)); return { ...imported, document };
  }
  return { ...fake, database, options, store, publish, nearestCalls, onNearest: (hook: () => Promise<void>) => { nearestHook = hook; } };
}
const rejects = (code: string) => (error: any) => error?.code === code || error?.message === code;

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
  await assert.rejects(f.store.importSource({ ...source(), classification: "recent_information" }), rejects("domain_not_ready"));
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
