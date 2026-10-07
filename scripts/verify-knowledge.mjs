import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createPool } from "../server/database.ts";
import { readServerConfig } from "../server/config.ts";
import { readAiConfig } from "../server/ai-config.ts";
import { createKnowledgeStore } from "../server/knowledge-store.ts";
import { createEmbeddingGateway, createEmbeddingUsage, EmbeddingFailure } from "../server/embedding-gateway.ts";
import { createVertexEmbeddingProvider } from "../server/vertex-embedding.ts";
import { createKnowledgeRetriever } from "../server/knowledge-retriever.ts";
import { AgentBudget } from "../server/agent-budget.ts";

// Historical harness: the required semantic assessment contract supersedes these old approval calls.
console.error("knowledge_historical_harness_retired_use_verify_knowledge_a04_with_approved_a04_local_sql");
process.exit(1);

let pool, step = "preflight", groups = 0, calls = 0, storeCalls = 0;
let accepted = false;
const countStoreCall = () => { if (storeCalls >= 120) throw new Error("Store scope exhausted"); storeCalls++; };
const budgets = [], originals = [];
const check = async (name, action) => { step = name; await action(); groups++; };
const filter = (months, topics = []) => ({ region: "HK", classification: "official_guidance", age: { basis: "actual", minMonths: months, maxMonths: months }, topics });
const privateTables = ["children", "text_records", "chat_messages"];
async function snapshot(connection) {
  const result = {};
  for (const table of privateTables) result[table] = (await connection.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
  return result;
}
try {
  if (!process.argv.includes("--approved-knowledge")) throw new Error("Approval required");
  const url = new URL(process.env.TEST_DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || !/^yuban_s06_test[A-Za-z0-9_]*$/.test(url.pathname.slice(1)) || url.search || url.hash) throw new Error("Synthetic local DB required");
  const config = readServerConfig({ ...process.env, DATABASE_URL: url.toString(), NODE_ENV: "test", BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    SERVER_ORIGIN: "http://127.0.0.1:3099", WEB_ORIGIN: "http://127.0.0.1:3099" });
  const ai = readAiConfig(process.env);
  assert.equal(ai.enabled, true); assert.equal(ai.project, "ai-caregivers-for-children");
  // Approval does not authorize raising either the production-sized daily counters or the retry cap.
  assert.ok(ai.dailyUserAttempts <= 5 && ai.dailyGlobalAttempts <= 20);
  pool = createPool(config);
  assert.equal((await pool.query("SELECT extversion FROM pg_extension WHERE extname='vector'")).rows[0]?.extversion, "0.8.6");
  assert.equal((await pool.query("SELECT count(*)::integer AS n FROM knowledge_sources")).rows[0].n, 0);
  assert.equal((await pool.query("SELECT id FROM app_migrations WHERE id='009-public-knowledge'")).rowCount, 1);
  const users = (await pool.query('SELECT DISTINCT owner_user_id AS id FROM workspaces ORDER BY owner_user_id LIMIT 2')).rows.map(row => row.id);
  assert.equal(users.length, 2);
  const counters = new Map((await pool.query("SELECT scope_key,attempts FROM ai_daily_usage WHERE day=(now() AT TIME ZONE 'UTC')::date")).rows.map(row => [row.scope_key, row.attempts]));
  assert.ok((counters.get("global") ?? 0) + 15 <= ai.dailyGlobalAttempts, "Insufficient approved daily quota");
  assert.ok((counters.get(`user:${users[0]}`) ?? 0) + 5 <= ai.dailyUserAttempts);
  assert.ok((counters.get(`user:${users[1]}`) ?? 0) + 4 <= ai.dailyUserAttempts);
  assert.ok((counters.get("user:system:knowledge-maintenance") ?? 0) + 6 <= 16);
  const before = await snapshot(pool);
  const seed = JSON.parse(await readFile(new URL("../knowledge/hk-official-seed.json", import.meta.url), "utf8"));
  const cases = JSON.parse(await readFile(new URL("../knowledge/acceptance-cases.json", import.meta.url), "utf8"));
  assert.equal(seed.reduce((n, item) => n + item.chunks.length, 0), 5); assert.equal(cases.length, 9);
  const tracked = connection => {
    const raw = createKnowledgeStore(connection);
    return new Proxy(raw, { get(target, name) {
      const method = target[name];
      return typeof method === "function" ? (...args) => { countStoreCall(); return method(...args); } : method;
    } });
  };
  let store = tracked(pool);
  const provider = createVertexEmbeddingProvider(ai);
  let lastVector;
  const gateway = createEmbeddingGateway({ config: ai, usage: createEmbeddingUsage(pool), provider: {
    async embed(input, signal) {
      if (++calls > 16 || input.text.length + (input.title?.length ?? 0) > 4000) throw new Error("Approved service scope exhausted");
      const reply = await provider.embed(input, signal); lastVector = reply.values; return reply;
    },
  } });
  const operationIds = [];
  const maintenance = { kind: "corpus_maintenance", actorId: "operator:s10-acceptance", operationId: randomUUID() };
  operationIds.push(maintenance.operationId);
  const embedVersion = async versionId => {
    for (const document of await store.missingDocuments(versionId)) {
      await store.embedDocument(document, () => gateway.embed({ task: "RETRIEVAL_DOCUMENT", title: document.title, text: document.text },
        maintenance, AbortSignal.timeout(ai.timeoutMs), async () => true));
    }
  };
  await check("draft_review_vectors_publication_and_unchanged_reuse", async () => {
    for (const source of seed) {
      const entry = await store.importSource(source);
      await assert.rejects(store.publish(entry.versionId, entry.hash));
      assert.equal((await store.candidates(filter(6), null)).some(item => item.sourceId === source.sourceId), false);
      await store.review(entry.versionId, entry.hash, "primary-source-review");
      await embedVersion(entry.versionId);
      await store.publish(entry.versionId, entry.hash);
      originals.push(entry);
      assert.equal((await store.importSource(source)).unchanged, true);
      assert.equal((await store.missingDocuments(entry.versionId)).length, 0);
    }
    assert.equal(calls, 5);
  });
  await check("four_age_groups_rephrased_vector_recall_and_no_relevant_evidence", async () => {
    for (const [index, sample] of cases.entries()) {
      const budget = new AgentBudget(); budgets.push(budget);
      const actor = { kind: "query_embedding", actorId: users[index < 5 ? 0 : 1], operationId: randomUUID() }; operationIds.push(actor.operationId);
      const run = createKnowledgeRetriever(store, gateway).createRun({ actor, budget, authorize: async () => true });
      const result = await run.search(sample.query, filter(sample.ageMonths, sample.topics));
      assert.equal(result.mode, "vector_keyword"); assert.equal(result.degradationReason, null); assert.ok(result.chunks.length <= 6);
      if (sample.sourceId === null) assert.equal(result.chunks.length, 0);
      else {
        const expected = result.chunks.find(chunk => chunk.sourceId === sample.sourceId && chunk.key === sample.key);
        assert.ok(expected); assert.equal(expected.reviewState, "reviewed"); assert.ok(expected.versionHash && expected.contentHash);
        assert.ok(expected.url.startsWith("https://www.fhs.gov.hk/")); assert.ok(expected.applicability.conditions.length);
      }
      if (index === 0) {
        await check("withdrawal_invalidates_cached_query_and_citations", async () => {
          await store.disable(seed[0].sourceId, "Synthetic acceptance withdrawal");
          assert.equal((await run.search(sample.query, filter(6, sample.topics))).chunks.length, 0);
          assert.equal(await run.revalidateCitations(result.chunks, filter(6)), false);
          await assert.rejects(store.publish(originals[0].versionId, originals[0].hash));
          await store.review(originals[0].versionId, originals[0].hash, "primary-source-review");
          await store.publish(originals[0].versionId, originals[0].hash);
          assert.equal(calls, 6);
        });
      }
      budget.close();
      step = "four_age_groups_rephrased_vector_recall_and_no_relevant_evidence";
    }
    assert.equal(calls, 14);
  });
  await check("hard_filters_unknown_age_and_approximate_range", async () => {
    for (const altered of [{ ...filter(6), region: "US" }, { ...filter(6), age: null }, filter(30),
      filter(6, ["vision"]), { ...filter(6), classification: "recent_information" },
      { ...filter(6), age: { basis: "corrected", minMonths: 6, maxMonths: 6 } },
      { ...filter(6), age: { basis: "actual", minMonths: 10, maxMonths: 14 } }]) assert.equal((await store.candidates(altered, lastVector)).length, 0);
    assert.equal((await store.candidates(filter(72, ["vision"]), lastVector)).some(chunk => chunk.key === "preschool-screening"), false);
  });
  await check("one_changed_chunk_new_version_and_historical_evidence", async () => {
    const changed = structuredClone(seed[3]);
    // Formatting-only revision tests incremental embedding without inventing a new care recommendation.
    changed.chunks[0].text = changed.chunks[0].text.replace("；", "；\n");
    const edition = await store.importSource(changed);
    assert.equal(edition.unchanged, false);
    assert.equal((await store.candidates(filter(50, ["vision"]), lastVector))[0].versionId, originals[3].versionId);
    await store.review(edition.versionId, edition.hash, "primary-source-review");
    assert.equal((await store.missingDocuments(edition.versionId)).length, 1);
    await embedVersion(edition.versionId); await store.publish(edition.versionId, edition.hash);
    assert.equal((await store.candidates(filter(50, ["vision"]), lastVector))[0].versionId, edition.versionId);
    const previous = (await pool.query("SELECT document FROM knowledge_versions WHERE id=$1", [originals[3].versionId])).rows[0];
    assert.deepEqual(previous.document.chunks, seed[3].chunks);
    assert.equal(calls, 15);
    await store.publish(originals[3].versionId, originals[3].hash);
  });
  await check("explicit_mock_embedding_failure_keyword_fallback", async () => {
    const budget = new AgentBudget(); budgets.push(budget);
    const fallback = createKnowledgeRetriever(store, { embed: async () => { throw new EmbeddingFailure("unavailable"); } }).createRun({
      actor: { kind: "query_embedding", actorId: users[0], operationId: randomUUID() }, budget, authorize: async () => true });
    const result = await fallback.search(cases[0].query, filter(6));
    assert.equal(result.mode, "keyword_degraded"); assert.equal(result.degradationReason, "embedding_unavailable");
    assert.ok(result.chunks.some(chunk => chunk.key === "starting-solids")); budget.close();
  });
  await check("reconnect_and_existing_private_rows_preserved", async () => {
    budgets.forEach(budget => budget.close());
    await pool.end(); pool = createPool(config); store = tracked(pool);
    assert.deepEqual(await snapshot(pool), before);
    assert.equal((await store.candidates(filter(96, ["vision"]), lastVector)).length, 1);
    const usage = (await pool.query("SELECT count(*)::integer AS attempts, sum(input_tokens)::text AS tokens, sum(billable_characters)::text AS characters, count(*) FILTER (WHERE input_tokens IS NULL OR billable_characters IS NULL)::integer AS unknown FROM embedding_attempts WHERE operation_id = ANY($1::uuid[])", [operationIds])).rows[0];
    assert.equal(usage.attempts, calls);
    console.log(JSON.stringify({ event: "knowledge_acceptance_usage", ...usage }));
  });
  accepted = true;
} catch (error) { console.error(JSON.stringify({ event: "knowledge_acceptance_failed", step, groups, calls, storeCalls,
  errorName: error instanceof Error ? error.name : "unknown", failureCode: error instanceof EmbeddingFailure ? error.code : null,
  recovery: "Keep existing private data; inspect partial public draft state before another approved run" })); process.exitCode = 1; }
finally {
  budgets.forEach(budget => budget.close());
  if (pool && originals.length) {
    // Restore only seed versions that this run fully published. No private data or historical edition is deleted.
    const recovery = createKnowledgeStore(pool);
    for (const entry of originals) {
      try { countStoreCall(); await recovery.review(entry.versionId, entry.hash, "primary-source-review"); countStoreCall(); await recovery.publish(entry.versionId, entry.hash); }
      catch { console.error("knowledge_seed_recovery_incomplete_keep_acceptance_pending"); process.exitCode = 1; }
    }
  }
  await pool?.end();
}
if (accepted && !process.exitCode) console.log(JSON.stringify({ event: "knowledge_acceptance_passed", groups, calls, storeCalls, restoredDatabase: false, deployed: false }));
