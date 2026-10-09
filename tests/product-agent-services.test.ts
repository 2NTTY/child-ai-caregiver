import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { AgentBudget, AgentStopped } from "../server/agent-budget.ts";
import { readAiConfig } from "../server/ai-config.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";
import type { EmbeddingGateway } from "../server/embedding-gateway.ts";
import type { createProductAgent } from "../server/product-agent.ts";
import type { PublishedKnowledgeReader, ProductAgentServicePorts } from "../server/product-agent-services.ts";
import type { KnowledgeCandidate, KnowledgeFilter } from "../src/shared/knowledge.ts";

const filter: KnowledgeFilter = { region: "HK", classification: "official_guidance", age: null, topics: [] };
const actor = { kind: "query_embedding" as const, actorId: "synthetic-user", operationId: "00000000-0000-4000-8000-000000000001" };
const vector = [1, ...Array<number>(1023).fill(0)];
const chunk: KnowledgeCandidate = {
  key: "synthetic-section", section: "Synthetic section", sourceExcerpt: "Synthetic original.", originalText: "Synthetic original.",
  text: "Synthetic reviewed text.", keywords: ["synthetic"],
  applicability: { region: "HK", ageBasis: "any", minAgeMonths: null, maxAgeMonths: null, topics: [], conditions: [] },
  chunkId: "00000000-0000-4000-8000-000000000002", sourceId: "synthetic-public-source",
  versionId: "00000000-0000-4000-8000-000000000003", versionHash: "a".repeat(64), contentHash: "b".repeat(64),
  url: "https://www.fhs.gov.hk/synthetic", title: "Synthetic source", publisher: "Synthetic publisher",
  classification: "official_guidance", sourcePublishedAt: null, sourceUpdatedAt: null,
  fetchedAt: "2026-10-08T00:00:00Z", checkedAt: "2026-10-08T00:00:00Z", reviewState: "reviewed", distance: 0.1,
};
const citation = { chunkId: chunk.chunkId, versionId: chunk.versionId, contentHash: chunk.contentHash };

test("product services retain the default published reader and consume a trusted injected reader through the existing retriever", async t => {
  type AgentOptions = Parameters<typeof createProductAgent>[0];
  const assembled: AgentOptions[] = [];
  const agent = { synthetic: true };
  t.mock.module("../server/product-agent.ts", { cache: false, namedExports: {
    createProductAgent: (options: AgentOptions) => { assembled.push(options); return agent; },
  } });
  const { createProductAgentServices } = await import("../server/product-agent-services.ts");
  const config = readAiConfig({ AI_ENABLED: "false" });
  const cipher = createStorageCipher(Buffer.alloc(32, 7));

  await t.test("the unchanged ten-argument caller uses the original SQL reader and publication eligibility", async context => {
    let published = true, embeddings = 0;
    const statements: string[] = [];
    const row = { id: chunk.chunkId, source_id: chunk.sourceId, version_id: chunk.versionId,
      version_hash: chunk.versionHash, content_hash: chunk.contentHash, document: chunk,
      source_document: { ...chunk, chunks: [chunk] }, checked_at: new Date(chunk.checkedAt),
      last_successful_check_at: null, usage_scope: "public_noncommercial", distance: 0.1, rank_score: null };
    const client = { release() {}, query: async (sql: string) => {
      statements.push(sql); return { rows: sql.includes("WITH eligible") && published ? [row] : [], rowCount: 0 };
    } };
    const pool = { connect: async () => client } as unknown as Pool;
    const services = createProductAgentServices(pool, cipher, config, undefined, false, undefined, undefined, undefined, undefined, undefined);
    assert.equal(services.agent as unknown, agent);
    assert.equal(statements.length, 0, "assembly does not query or start knowledge maintenance");
    const knowledge = assembled.at(-1)!.knowledge;
    const budget = new AgentBudget(); context.after(() => budget.close());
    const gateway: EmbeddingGateway = { embed: async () => { embeddings++; return vector; } };
    const run = knowledge.createRun({ actor, budget, authorize: async () => true, embeddings: gateway });
    assert.equal((await run.search("synthetic", filter)).chunks[0]?.chunkId, chunk.chunkId);
    const selection = statements.find(sql => sql.includes("WITH eligible"))!;
    assert.match(selection, /s\.active_version_id/);
    assert.match(selection, /v\.review_state = 'reviewed'/);
    assert.match(selection, /v\.published_at IS NOT NULL/);
    assert.match(selection, /s\.enabled/);
    assert.match(selection, /validUntil/);
    assert.equal(await run.revalidateCitations([citation], filter), true);
    published = false;
    assert.equal(await run.revalidateCitations([citation], filter), false);
    assert.deepEqual((await run.search("synthetic", filter)).chunks, []);
    assert.equal(embeddings, 1, "only the query vector is cached within this run");
  });

  await t.test("an injected candidates-only reader retains per-run caches, live citation checks and cancellation", async context => {
    let published = true, embeddings = 0;
    const calls: { requested: KnowledgeFilter; embedded: readonly number[] | null; selection: unknown }[] = [];
    const reader: PublishedKnowledgeReader = { candidates: async (requested, embedded, selection) => {
      calls.push({ requested, embedded, selection }); return published ? [chunk] : [];
    } };
    const ports: ProductAgentServicePorts = { publishedKnowledgeReader: reader };
    const pool = { connect: async () => { throw new Error("The injected reader must not use SQL"); },
      query: async () => { throw new Error("No SQL operation is expected"); } } as unknown as Pool;
    createProductAgentServices(pool, cipher, config, undefined, false, undefined, undefined, undefined, undefined, undefined, ports);
    assert.equal(calls.length, 0, "registration alone does not invoke the reader");
    const knowledge = assembled.at(-1)!.knowledge;
    const budget = new AgentBudget(); context.after(() => budget.close());
    const gateway: EmbeddingGateway = { embed: async (_input, actualActor, signal, authorize) => {
      assert.deepEqual(actualActor, actor); assert.equal(signal.aborted, false); assert.equal(await authorize(), true);
      embeddings++; return vector;
    } };
    const run = knowledge.createRun({ actor, budget, authorize: async () => true, embeddings: gateway });
    await run.search("synthetic", filter); await run.search("synthetic", filter);
    assert.equal(embeddings, 1); assert.equal(budget.counts.queryEmbeddings, 1);
    assert.equal(calls.length, 2, "publication is read again despite a cached query vector");
    assert.deepEqual(calls[0], { requested: { ...filter, ageMatch: "contained" }, embedded: vector, selection: { query: "synthetic" } });
    assert.equal(await run.revalidateCitations([citation], filter), true);
    assert.deepEqual(calls.at(-1)?.selection, { chunkIds: [chunk.chunkId], limit: 6 });
    assert.equal(calls.at(-1)?.embedded, null);
    assert.equal(await run.revalidateCitations([{ ...citation, versionId: "00000000-0000-4000-8000-000000000004" }], filter), false);
    published = false;
    assert.equal(await run.revalidateCitations([citation], filter), false);
    assert.deepEqual((await run.search("synthetic", filter)).chunks, []);
    assert.equal(embeddings, 1);
    const secondBudget = new AgentBudget(); context.after(() => secondBudget.close());
    await knowledge.createRun({ actor, budget: secondBudget, authorize: async () => true, embeddings: gateway }).search("synthetic", filter);
    assert.equal(embeddings, 2, "a new run cannot reuse another run's query vector");
    const cancellation = new AbortController(); cancellation.abort();
    const cancelledBudget = new AgentBudget(cancellation.signal); context.after(() => cancelledBudget.close());
    const beforeCancellation = calls.length;
    await assert.rejects(knowledge.createRun({ actor, budget: cancelledBudget, authorize: async () => true, embeddings: gateway })
      .search("synthetic", filter), (error: unknown) => error instanceof AgentStopped && error.reason === "cancelled");
    assert.equal(calls.length, beforeCancellation); assert.equal(embeddings, 2);
  });

  await t.test("the public reader type exposes candidates and no maintenance API", () => {
    const readerKeys: Record<keyof PublishedKnowledgeReader, true> = { candidates: true };
    assert.deepEqual(Object.keys(readerKeys), ["candidates"]);
    const portKeys: Record<keyof ProductAgentServicePorts, true> = { publishedKnowledgeReader: true, claimedRunPersistence: true };
    assert.deepEqual(Object.keys(portKeys), ["publishedKnowledgeReader", "claimedRunPersistence"]);
  });
});
