import assert from "node:assert/strict";
import test from "node:test";
import type { TestContext } from "node:test";
import { AgentBudget, AgentStopped } from "../server/agent-budget.ts";
import { readAiConfig } from "../server/ai-config.ts";
import { createEmbeddingGateway, EmbeddingFailure } from "../server/embedding-gateway.ts";
import type { EmbeddingActor, EmbeddingProvider, EmbeddingUsage } from "../server/embedding-gateway.ts";
import { parseKnowledgeFilter, parseKnowledgeQuery, parseKnowledgeSource, sourceVersionHash } from "../server/knowledge-inputs.ts";
import { createKnowledgeRetriever } from "../server/knowledge-retriever.ts";
import type { KnowledgeCandidate, KnowledgeFilter, KnowledgeSourceInput } from "../src/shared/knowledge.ts";

const vector = [1, ...Array<number>(1023).fill(0)];
const queryActor: EmbeddingActor = {
  kind: "query_embedding", actorId: "synthetic-user", operationId: "00000000-0000-4000-8000-000000000001",
};
const maintenanceActor: EmbeddingActor = {
  kind: "corpus_maintenance", actorId: "operator", operationId: "00000000-0000-4000-8000-000000000002",
};
const filter: KnowledgeFilter = { region: "HK", classification: "official_guidance", age: null, topics: [] };
const config = readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: "synthetic-project",
  AI_DAILY_USER_ATTEMPTS: "3", AI_DAILY_GLOBAL_ATTEMPTS: "25" });

function budget(t: TestContext, parent?: AbortSignal): AgentBudget {
  const value = new AgentBudget(parent);
  t.after(() => value.close());
  return value;
}
function candidate(chunkId: string, distance: number | null, changes: Partial<KnowledgeCandidate> = {}): KnowledgeCandidate {
  return {
    chunkId, distance, key: chunkId, section: "一般資料", sourceExcerpt: "合成原文", text: "合成內容", keywords: ["發燒"],
    applicability: { region: "HK", ageBasis: "any", minAgeMonths: null, maxAgeMonths: null, topics: ["fever"], conditions: [] },
    sourceId: "source", versionId: "v1", versionHash: "version-hash", contentHash: "content-hash",
    url: "https://www.fhs.gov.hk/health", title: "兒童發燒", publisher: "Example",
    classification: "official_guidance", sourcePublishedAt: null, sourceUpdatedAt: null,
    sourceDateText: "2024年9月", validUntil: null, fetchedAt: "2026-01-01T00:00:00Z",
    checkedAt: "2026-01-01T00:00:00Z", reviewState: "reviewed", ...changes,
  };
}
function fakeUsage() {
  const reservations: Array<{ actor: EmbeddingActor; userLimit: number; globalLimit: number }> = [];
  const records: Array<Parameters<EmbeddingUsage["record"]>[0]> = [];
  let available = true;
  const usage: EmbeddingUsage = {
    reserve: async (actor, userLimit, globalLimit) => {
      reservations.push({ actor, userLimit, globalLimit });
      return available;
    },
    record: async attempt => { records.push(attempt); },
  };
  return { usage, reservations, records, deny: () => { available = false; } };
}
function fakeProvider(embed: EmbeddingProvider["embed"]): EmbeddingProvider { return { embed }; }

test("one run reuses its query vector but rereads publication and filter state; another run embeds anew", async t => {
  const usage = fakeUsage();
  let providerCalls = 0;
  const gateway = createEmbeddingGateway({ config, usage: usage.usage,
    provider: fakeProvider(async () => { providerCalls++; return { values: vector, inputTokens: 4, billableCharacters: 12 }; }) });
  let published = true;
  const calls: Array<{ filter: KnowledgeFilter; vector: readonly number[] | null }> = [];
  const store = { candidates: async (requested: KnowledgeFilter, embedded: readonly number[] | null) => {
    calls.push({ filter: requested, vector: embedded });
    return published ? [candidate("chunk", 0.1)] : [];
  } };
  const retriever = createKnowledgeRetriever(store, gateway);
  const firstBudget = budget(t);
  const first = retriever.createRun({ actor: queryActor, budget: firstBudget, authorize: async () => true });
  const cited = await first.search("發燒", filter);
  assert.equal(cited.mode, "vector_keyword");
  assert.deepEqual(cited.chunks.map(chunk => chunk.chunkId), ["chunk"]);
  assert.equal(await first.revalidateCitations([{ chunkId: "chunk", versionId: "v1", contentHash: "content-hash" }], filter), true);
  assert.equal(await first.revalidateCitations([{ chunkId: "chunk", versionId: "old", contentHash: "content-hash" }], filter), false);
  assert.equal(await first.revalidateCitations([{ chunkId: "chunk", versionId: "v1", contentHash: "old-hash" }], filter), false);
  assert.equal(await first.revalidateCitations([
    { chunkId: "chunk", versionId: "v1", contentHash: "content-hash" },
    { chunkId: "chunk", versionId: "v1", contentHash: "content-hash" },
  ], filter), false);
  published = false;
  assert.deepEqual((await first.search("發燒", { ...filter, topics: ["fever"] })).chunks, []);
  assert.equal(await first.revalidateCitations([{ chunkId: "chunk", versionId: "v1", contentHash: "content-hash" }], filter), false);
  assert.equal(providerCalls, 1);
  assert.equal(firstBudget.counts.queryEmbeddings, 1);
  assert.deepEqual(calls.map(call => call.filter.topics), [[], [], [], [], ["fever"], []]);
  assert.ok(calls.every(call => call.vector === null || call.vector.length === 1024));

  const secondBudget = budget(t);
  const second = retriever.createRun({ actor: queryActor, budget: secondBudget, authorize: async () => true });
  await second.search("發燒", filter);
  assert.equal(providerCalls, 2);
  assert.equal(secondBudget.counts.queryEmbeddings, 1);
});

test("retriever limits embeddings to two per run and respects cancellation", async t => {
  let providerCalls = 0;
  const gateway = createEmbeddingGateway({ config, usage: fakeUsage().usage,
    provider: fakeProvider(async () => { providerCalls++; return { values: vector, inputTokens: null, billableCharacters: null }; }) });
  const retriever = createKnowledgeRetriever({ candidates: async () => [] }, gateway);
  const activeBudget = budget(t);
  const run = retriever.createRun({ actor: queryActor, budget: activeBudget, authorize: async () => true });
  await run.search("發燒", filter);
  await run.search("咳嗽", filter);
  await assert.rejects(run.search("睡眠", filter), (error: unknown) =>
    error instanceof AgentStopped && error.reason === "embedding_limit");
  assert.equal(providerCalls, 2);
  assert.equal(activeBudget.counts.queryEmbeddings, 2);

  const abort = new AbortController();
  abort.abort();
  const cancelled = retriever.createRun({ actor: queryActor, budget: budget(t, abort.signal), authorize: async () => true });
  await assert.rejects(cancelled.search("發燒", filter), (error: unknown) =>
    error instanceof AgentStopped && error.reason === "cancelled");
  assert.equal(providerCalls, 2);
});

test("only provider unavailability becomes an explicit keyword degradation", async t => {
  const source = candidate("keyword", null);
  const store = { candidates: async () => [source] };
  const unavailable = createEmbeddingGateway({ config, usage: fakeUsage().usage,
    provider: fakeProvider(async () => { throw new Error("synthetic provider failure"); }) });
  const degraded = createKnowledgeRetriever(store, unavailable)
    .createRun({ actor: queryActor, budget: budget(t), authorize: async () => true });
  const result = await degraded.search("發燒", filter);
  assert.equal(result.mode, "keyword_degraded");
  assert.equal(result.degradationReason, "embedding_unavailable");
  assert.deepEqual(result.chunks.map(chunk => chunk.chunkId), ["keyword"]);

  const deniedUsage = fakeUsage();
  deniedUsage.deny();
  const quota = createKnowledgeRetriever(store, createEmbeddingGateway({ config, usage: deniedUsage.usage,
    provider: fakeProvider(async () => { throw new Error("must not run"); }) }))
    .createRun({ actor: queryActor, budget: budget(t), authorize: async () => true });
  await assert.rejects(quota.search("發燒", filter), (error: unknown) =>
    error instanceof EmbeddingFailure && error.code === "quota_exceeded");
  const disabled = createKnowledgeRetriever(store, createEmbeddingGateway({ config: { ...config, enabled: false },
    usage: fakeUsage().usage }))
    .createRun({ actor: queryActor, budget: budget(t), authorize: async () => true });
  await assert.rejects(disabled.search("發燒", filter), (error: unknown) =>
    error instanceof EmbeddingFailure && error.code === "disabled");
  const unauthorized = createKnowledgeRetriever(store, unavailable)
    .createRun({ actor: queryActor, budget: budget(t), authorize: async () => false });
  await assert.rejects(unauthorized.search("發燒", filter), (error: unknown) =>
    error instanceof EmbeddingFailure && error.code === "unauthorized");
  const malformed = createKnowledgeRetriever(store, createEmbeddingGateway({ config, usage: fakeUsage().usage,
    provider: fakeProvider(async () => ({ values: [1], inputTokens: null, billableCharacters: null })) }))
    .createRun({ actor: queryActor, budget: budget(t), authorize: async () => true });
  await assert.rejects(malformed.search("發燒", filter), (error: unknown) =>
    error instanceof EmbeddingFailure && error.code === "invalid_response");
  await assert.rejects(degraded.search(" ", filter));
  await assert.rejects(degraded.search("發燒", { ...filter, age: { basis: "actual", minMonths: 12, maxMonths: 4 } }));
});

test("citations preserve version metadata, deduplicate and cap at six", async t => {
  const usage = fakeUsage();
  const gateway = createEmbeddingGateway({ config, usage: usage.usage,
    provider: fakeProvider(async () => ({ values: vector, inputTokens: null, billableCharacters: null })) });
  const many = Array.from({ length: 8 }, (_, index) => candidate("chunk-" + index, index / 100));
  many.push(candidate("chunk-0", 0.2));
  const run = createKnowledgeRetriever({ candidates: async () => many }, gateway)
    .createRun({ actor: queryActor, budget: budget(t), authorize: async () => true });
  const result = await run.search("發燒", filter);
  assert.equal(result.chunks.length, 6);
  assert.equal(new Set(result.chunks.map(chunk => chunk.chunkId)).size, 6);
  assert.equal(result.chunks[0]?.versionHash, "version-hash");
  assert.equal(result.chunks[0]?.contentHash, "content-hash");
  assert.equal(result.chunks[0]?.sourceDateText, "2024年9月");
  assert.ok(result.chunks.every(chunk => !Object.hasOwn(chunk, "distance")));
  assert.equal(await run.revalidateCitations(result.chunks.map(chunk =>
    ({ chunkId: chunk.chunkId, versionId: chunk.versionId, contentHash: chunk.contentHash })), filter), true);
  assert.equal(await run.revalidateCitations(many.slice(0, 7).map(chunk =>
    ({ chunkId: chunk.chunkId, versionId: chunk.versionId, contentHash: chunk.contentHash })), filter), false);
});

test("gateway uses shared quotas, a bounded maintenance counter, one provider call and metadata-only records", async () => {
  const usage = fakeUsage();
  let calls = 0;
  let permitted = true;
  const gateway = createEmbeddingGateway({ config, usage: usage.usage, provider: fakeProvider(async input => {
    calls++;
    if (input.text === "private failure") throw new Error("provider secret");
    if (input.text === "private revoke") permitted = false;
    return { values: vector, inputTokens: 7, billableCharacters: 21 };
  }) });
  const signal = new AbortController().signal;
  const authorize = async () => permitted;
  await gateway.embed({ task: "RETRIEVAL_QUERY", text: "private query" }, queryActor, signal, authorize);
  await gateway.embed({ task: "RETRIEVAL_DOCUMENT", title: "synthetic title", text: "private document" },
    maintenanceActor, signal, authorize);
  await assert.rejects(gateway.embed({ task: "RETRIEVAL_QUERY", text: "private failure" },
    queryActor, signal, authorize), (error: unknown) =>
    error instanceof EmbeddingFailure && error.code === "unavailable");
  await assert.rejects(gateway.embed({ task: "RETRIEVAL_QUERY", text: "private revoke" },
    queryActor, signal, authorize), (error: unknown) =>
    error instanceof EmbeddingFailure && error.code === "unauthorized");
  assert.equal(calls, 4);
  assert.deepEqual(usage.reservations.map(item => [item.userLimit, item.globalLimit]), [[3, 25], [16, 25], [3, 25], [3, 25]]);
  assert.deepEqual(usage.records.map(item => item.outcome), ["succeeded", "succeeded", "unavailable", "unauthorized"]);
  assert.equal(usage.records[0]?.documentHash, null);
  assert.match(usage.records[1]?.documentHash ?? "", /^[0-9a-f]{64}$/u);
  assert.doesNotMatch(JSON.stringify(usage.records), /private|provider secret|synthetic title/u);
  assert.ok(usage.records.every(item => item.durationMs >= 0));
  usage.deny();
  await assert.rejects(gateway.embed({ task: "RETRIEVAL_QUERY", text: "private quota" },
    queryActor, signal, async () => true), (error: unknown) =>
    error instanceof EmbeddingFailure && error.code === "quota_exceeded");
  assert.equal(calls, 4);
  assert.equal(usage.records.length, 4);
});

test("input parsing keeps unknown age and date precision while unchanged fetch time keeps version hash", () => {
  assert.equal(parseKnowledgeFilter(filter).age, null);
  assert.throws(() => parseKnowledgeFilter({ ...filter, age: { basis: "actual", minMonths: 20, maxMonths: 10 } }));
  assert.throws(() => parseKnowledgeFilter({ ...filter, age: { basis: "actual", minMonths: -1, maxMonths: 10 } }));
  assert.throws(() => parseKnowledgeQuery(" "));
  const source: KnowledgeSourceInput = {
    sourceId: "official-source", url: "https://www.fhs.gov.hk/health", title: "兒童健康",
    publisher: "衞生署", classification: "official_guidance", sourcePublishedAt: null,
    sourceUpdatedAt: null, sourceDateText: "2024年9月", validUntil: null,
    fetchedAt: "2026-01-01T00:00:00Z", termsUrl: "https://www.fhs.gov.hk/terms",
    chunks: [{ key: "fever", section: "發燒", sourceExcerpt: "合成原文", text: "合成內容", keywords: ["發燒"],
      applicability: { region: "HK", ageBasis: "any", minAgeMonths: null, maxAgeMonths: null,
        topics: ["fever"], conditions: [] } }],
  };
  const parsed = parseKnowledgeSource(source);
  assert.equal(parsed.sourcePublishedAt, null);
  assert.equal(parsed.sourceDateText, "2024年9月");
  assert.equal(sourceVersionHash(parsed), sourceVersionHash(parseKnowledgeSource({
    ...source, fetchedAt: "2026-01-02T00:00:00Z",
  })));
  assert.notEqual(sourceVersionHash(parsed), sourceVersionHash(parseKnowledgeSource({
    ...source, chunks: [{ ...source.chunks[0]!, text: "另一段合成內容" }],
  })));
  assert.equal(parseKnowledgeSource({ ...source, classification: "recent_information" }).sourcePublishedAt, null);
});
