import assert from "node:assert/strict";
import { randomUUID, randomBytes } from "node:crypto";
import { createPool } from "../server/database.ts";
import { readServerConfig } from "../server/config.ts";
import { createKnowledgeStore } from "../server/knowledge-store.ts";
import { createKnowledgeRefreshStore, observationHash } from "../server/knowledge-refresh-store.ts";
import { sourceVersionHash, knowledgeHash, embeddingDocument } from "../server/knowledge-inputs.ts";
import { createKnowledgeRetriever } from "../server/knowledge-retriever.ts";
import { AgentBudget } from "../server/agent-budget.ts";
import { KNOWLEDGE_EMBEDDING } from "../src/shared/knowledge.ts";

// Explicitly approved local synthetic SQL only. No family writes, worker changes, network fetches or real models.
const args = process.argv.slice(2), tag = randomBytes(8).toString("hex"), prefix = `qa-a04-${tag}`;
const sourceIds = [`${prefix}-bounded`, `${prefix}-semantic`], watchId = sourceIds[1], versionIds = [], vectorHashes = new Set(), budgets = [];
let pool, storeCalls = 0, groups = 0, step = "preflight", touched = false, succeeded = false;
const count = () => { if (++storeCalls > 60) throw new Error("Store-call budget exhausted"); };
const tracked = object => new Proxy(object, { get(target, key) { const member = target[key]; return typeof member === "function" ? (...values) => { count(); return member(...values); } : member; } });
const group = async (name, action) => { step = name; await action(); groups++; };
const queryVector = [1, ...Array(1023).fill(0)], farVector = [0, 1, ...Array(1022).fill(0)];
const vectorKey = [KNOWLEDGE_EMBEDDING.model, KNOWLEDGE_EMBEDDING.dimensions, KNOWLEDGE_EMBEDDING.pipeline];
const applicability = topic => ({ region: "HK", ageBasis: "actual", minAgeMonths: 2, maxAgeMonths: 8, topics: [topic], conditions: ["Synthetic condition."] });
const chunk = (key, topic, text) => ({ key, section: `Synthetic section ${key}`, sourceExcerpt: text, originalText: text, text, keywords: ["synthetic"], applicability: applicability(topic) });
const source = (id, chunks) => ({ sourceId: id, url: `https://www.fhs.gov.hk/${id}`, title: "Synthetic QA source", publisher: "Synthetic QA publisher",
  classification: "official_guidance", sourcePublishedAt: null, sourceUpdatedAt: null, fetchedAt: new Date().toISOString(), termsUrl: "https://www.fhs.gov.hk/qa-terms", chunks });
const filter = (topic, ageMatch = "unknown", age = null) => ({ region: "HK", classification: "official_guidance", age, ageMatch, topics: [topic] });
const checks = { age: "Compared synthetic 2-8 month bounds.", numbersAndUnits: "Compared every synthetic unit amount.", timing: "No synthetic schedule.",
  conditions: "Compared synthetic condition.", exceptions: "No exception added or removed.", prohibitions: "No prohibition changed.", withdrawal: "Observation is available; no withdrawal." };
const assessment = (baseline, observedHash, changes, decision = "approve") => ({ comparedVersionId: baseline?.versionId ?? null, comparedHash: baseline?.hash ?? null,
  observationHash: observedHash, changes, checks, questions: [{ query: "Synthetic unit question", expectedKeys: ["amount", "condition"], reason: "Tests selected changed amount and preserved condition." }],
  growthRuleImpact: "none", growthRuleReason: "No real growth-rule changes.", decision });
const snapshot = async () => ({
  family: (await pool.query("SELECT count(*)::text AS n,COALESCE(sum(change_seq),0)::text AS seq FROM workspaces")).rows[0],
  attempts: (await pool.query("SELECT count(*)::text AS n,COALESCE(sum(attempts),0)::text AS attempts FROM ai_daily_usage")).rows[0],
});
async function insertVectors(documents) {
  for (const item of documents) vectorHashes.add(item.hash);
  if (!documents.length) return;
  await pool.query(`INSERT INTO knowledge_vectors(model,dimensions,pipeline,input_hash,embedding)
    SELECT $1,$2,$3,item.hash,item.vector::vector FROM jsonb_to_recordset($4::jsonb) AS item(hash text,vector text)
    ON CONFLICT DO NOTHING`, [...vectorKey, JSON.stringify(documents.map(item => ({ hash: item.hash, vector: `[${(item.vector ?? queryVector).join(",")}]` })))]);
}
async function cleanup() {
  if (!pool || !touched) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN"); await client.query("SET LOCAL statement_timeout='10s'; SET LOCAL lock_timeout='5s'");
    await client.query("DELETE FROM knowledge_source_checks WHERE watch_id=$1", [watchId]);
    await client.query("DELETE FROM knowledge_observations WHERE source_id=ANY($1::text[])", [sourceIds]);
    await client.query("DELETE FROM knowledge_watches WHERE id=$1", [watchId]);
    await client.query("UPDATE knowledge_sources SET active_version_id=NULL WHERE id=ANY($1::text[])", [sourceIds]);
    await client.query("DELETE FROM knowledge_version_reviews WHERE version_id IN (SELECT id FROM knowledge_versions WHERE source_id=ANY($1::text[]))", [sourceIds]);
    await client.query("DELETE FROM knowledge_chunks WHERE version_id IN (SELECT id FROM knowledge_versions WHERE source_id=ANY($1::text[]))", [sourceIds]);
    await client.query("DELETE FROM knowledge_versions WHERE source_id=ANY($1::text[])", [sourceIds]);
    await client.query("DELETE FROM knowledge_sources WHERE id=ANY($1::text[])", [sourceIds]);
    await client.query(`DELETE FROM knowledge_vectors e WHERE e.input_hash=ANY($1::text[]) AND e.model=$2 AND e.dimensions=$3 AND e.pipeline=$4
      AND NOT EXISTS(SELECT 1 FROM knowledge_chunks c WHERE c.embedding_hash=e.input_hash)`, [[...vectorHashes], ...vectorKey]);
    await client.query("COMMIT");
  } catch (error) { try { await client.query("ROLLBACK"); } catch {} throw error; }
  finally { client.release(); }
}
try {
  if (args.length !== 1 || args[0] !== "--approved-a04-local-sql") throw new Error("Explicit local SQL approval required");
  const url = new URL(process.env.TEST_DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || !/^yuban_s06_test[A-Za-z0-9_]*$/.test(url.pathname.slice(1)) || url.search || url.hash) throw new Error("Synthetic local DB required");
  pool = createPool(readServerConfig({ ...process.env, DATABASE_URL: url.toString(), NODE_ENV: "test", BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
    SERVER_ORIGIN: "http://127.0.0.1:3099", WEB_ORIGIN: "http://127.0.0.1:3099" }));
  assert.equal((await pool.query("SELECT extversion FROM pg_extension WHERE extname='vector'")).rows[0]?.extversion, "0.8.6");
  assert.equal((await pool.query("SELECT id FROM app_migrations WHERE id='031-knowledge-semantic-review'")).rowCount, 1);
  assert.equal((await pool.query("SELECT enabled FROM worker_control WHERE id=1")).rows[0]?.enabled, false, "Keep worker paused");
  const before = await snapshot(), store = tracked(createKnowledgeStore(pool));
  const boundedTopic = `${prefix}-rank`, semanticTopic = `${prefix}-meaning`;
  const chunks = Array.from({ length: 1105 }, (_, index) => {
    const current = chunk(`section-${String(index).padStart(4, "0")}`, boundedTopic, `Synthetic original section ${index}.`);
    if (index >= 1100) { current.text = `Late target synthetic original ${index}.`; current.originalText = current.text; current.sourceExcerpt = current.text; current.keywords = ["late", "target"]; }
    return current;
  });
  const bounded = source(sourceIds[0], chunks), boundedId = randomUUID(), ids = chunks.map(() => randomUUID()), boundedHash = sourceVersionHash(bounded);
  const records = chunks.map((item, index) => { const embed = embeddingDocument(bounded.title, item.section, item.text); vectorHashes.add(embed.hash);
    return { id: ids[index], key: item.key, document: item, content_hash: knowledgeHash(item), embedding_hash: embed.hash }; });
  touched = true;
  await pool.query("INSERT INTO knowledge_sources(id,url) VALUES($1,$2)", [bounded.sourceId, bounded.url]);
  await pool.query(`INSERT INTO knowledge_versions(id,source_id,version_hash,document,review_state,reviewed_by,checked_at,published_at)
    VALUES($1,$2,$3,$4,'reviewed','synthetic-legacy-fixture',now(),now())`, [boundedId, bounded.sourceId, boundedHash, bounded]);
  versionIds.push(boundedId);
  await pool.query(`INSERT INTO knowledge_chunks(id,version_id,section_key,document,content_hash,embedding_hash)
    SELECT item.id,$1,item.key,item.document,item.content_hash,item.embedding_hash FROM jsonb_to_recordset($2::jsonb)
      AS item(id uuid,key text,document jsonb,content_hash text,embedding_hash text)`, [boundedId, JSON.stringify(records)]);
  await insertVectors(records.map((item, index) => ({ hash: item.embedding_hash, vector: index >= 1100 ? queryVector : farVector })));
  await pool.query("UPDATE knowledge_sources SET enabled=true,active_version_id=$2 WHERE id=$1", [bounded.sourceId, boundedId]);

  await group("bounded_rank_exact_reference_and_context", async () => {
    const ranked = await store.candidates(filter(boundedTopic), queryVector, { query: "Late target" });
    assert.ok(ranked.length > 0 && ranked.length <= 6); assert.ok(ranked.every(item => Number(item.key.slice(-4)) >= 1100));
    assert.equal(ranked[0].applicabilityStatus, "requires_clarification");
    assert.deepEqual(await store.candidates(filter(boundedTopic, "contained"), null, { query: "Late target" }), []);
    const overlap = await store.candidates(filter(boundedTopic, "overlap", { basis: "actual", minMonths: 7, maxMonths: 9 }), null, { query: "Late target" });
    assert.ok(overlap.length); assert.equal(overlap[0].applicabilityStatus, "conditional");
    const exact = (await store.candidates(filter(boundedTopic), null, { chunkIds: [ids[100]], limit: 1 }))[0]; assert.equal(exact.chunkId, ids[100]);
    const budget = new AgentBudget(); budgets.push(budget);
    const gateway = { embed: async () => queryVector };
    const run = createKnowledgeRetriever(store, gateway).createRun({ actor: { kind: "query_embedding", actorId: "synthetic-local-sql", operationId: randomUUID() }, budget, authorize: async () => true });
    const found = await run.search("Late target", filter(boundedTopic));
    assert.equal(await run.revalidateCitations([exact], filter(boundedTopic)), true);
    const context = await run.readContext(found.chunks[0], filter(boundedTopic));
    assert.ok(context.chunks.length >= 1 && context.chunks.length <= 3); assert.equal(context.versionId, boundedId);
    assert.equal(context.chunks[0].original.coverage, "chunk_original");
  });

  const original = source(sourceIds[1], [chunk("amount", semanticTopic, "Synthetic original 1 unit."), chunk("condition", semanticTopic, "Synthetic original condition.")]);
  const definition = { id: watchId, url: original.url, kind: "page", classification: original.classification, publisher: original.publisher,
    termsUrl: original.termsUrl, audience: "public_noncommercial", selector: "#synthetic-only" };
  const refresh = tracked(createKnowledgeRefreshStore(pool, [definition]));
  const observed = text => ({ url: original.url, title: original.title, text, sourcePublishedAt: null, sourceUpdatedAt: null, sourceDateText: null });
  const writeObservation = async item => pool.query(`INSERT INTO knowledge_observations(source_id,watch_id,url,content_hash,document,fetched_at,last_successful_check_at)
    VALUES($1,$2,$3,$4,$5,now(),now()) ON CONFLICT(source_id) DO UPDATE SET content_hash=$4,document=$5,last_successful_check_at=now(),fetched_at=now()`,
    [watchId, watchId, original.url, observationHash(item), item]);
  let first, next;
  await group("initial_review_vectors_and_automatic_publication", async () => {
    await refresh.register(watchId, "synthetic-operator"); first = await store.importSource(original); versionIds.push(first.versionId);
    const item = observed(original.chunks.map(item => item.originalText).join("\n")); await writeObservation(item);
    const initial = assessment(null, observationHash(item), original.chunks.map(item => ({ key: item.key, oldQuote: null, newQuote: item.sourceExcerpt, meaning: "new", explanation: "Initial synthetic import." })));
    assert.equal((await refresh.approve(watchId, observationHash(item), first.versionId, first.hash, "synthetic-operator", initial)).status, "pending");
    const documents = await store.missingDocuments(first.versionId); await insertVectors(documents);
    assert.equal((await store.tryPublish(first.versionId)).status, "published");
    assert.equal((await refresh.approve(watchId, observationHash(item), first.versionId, first.hash, "synthetic-operator", initial)).status, "published");
  });
  await group("changed_observation_stops_old_hold_and_semantic_approval", async () => {
    const revised = { ...original, chunks: [{ ...original.chunks[0], text: "Synthetic original 2 units.", originalText: "Synthetic original 2 units.", sourceExcerpt: "Synthetic original 2 units." }, original.chunks[1]] };
    const item = observed(revised.chunks.map(item => item.originalText).join("\n")); await writeObservation(item);
    assert.deepEqual(await store.candidates(filter(semanticTopic), queryVector, { query: "Synthetic units" }), []);
    next = await store.importSource(revised); versionIds.push(next.versionId);
    const changed = [{ key: "amount", oldQuote: "1 unit", newQuote: "2 units", meaning: "changed", explanation: "Synthetic amount changed; all conditions preserved." }];
    const held = assessment(first, observationHash(item), changed, "hold");
    assert.equal((await refresh.approve(watchId, observationHash(item), next.versionId, next.hash, "synthetic-operator", held)).status, "held");
    const good = { ...held, decision: "approve" };
    await assert.rejects(refresh.approve(watchId, observationHash(item), next.versionId, next.hash, "synthetic-operator", { ...good, changes: [] }), /knowledge_review_incomplete_diff/);
    assert.equal((await refresh.approve(watchId, observationHash(item), next.versionId, next.hash, "synthetic-operator", good)).status, "pending");
    await insertVectors(await store.missingDocuments(next.versionId)); assert.equal((await store.tryPublish(next.versionId)).status, "published");
    const ranked = await store.candidates(filter(semanticTopic), queryVector, { query: "Synthetic units" }); assert.ok(ranked.some(item => item.versionId === next.versionId));
    await writeObservation(observed("Synthetic original 3 units.\nSynthetic original condition."));
    assert.equal((await store.tryPublish(next.versionId)).status, "pending");
    assert.deepEqual(await store.candidates(filter(semanticTopic), queryVector, { query: "Synthetic units" }), []);
  });
  await group("preserve_existing_database_and_paused_worker", async () => {
    assert.deepEqual(await snapshot(), before);
    assert.equal((await pool.query("SELECT enabled FROM worker_control WHERE id=1")).rows[0]?.enabled, false);
    assert.ok(storeCalls <= 60);
  });
  succeeded = true;
} catch (error) {
  const code = error && typeof error.code === "string" && /^[A-Z0-9_]{1,40}$/.test(error.code) ? error.code
    : error instanceof Error && /^knowledge_[a-z_]+$/.test(error.message) ? error.message : "fixture_scope_or_precondition_failed";
  const diagnostic = error instanceof Error ? { name: error.name, reason: /^(?:knowledge_[a-z_]+|Query read timeout|Connection terminated unexpectedly|deadline|cancelled)$/.test(error.message) ? error.message : "unclassified", location: error.stack?.split("\n").slice(1, 3).map(line => line.replace(/.*[\\/](?=[^\\/]+:\d+:\d+\)?$)/, "at ")) } : null;
  const assertionOperator = error && typeof error.operator === "string" && /^[A-Za-z]{1,40}$/.test(error.operator) ? error.operator : null;
  console.error(JSON.stringify({ event: "knowledge_a04_acceptance_failed", step, groups, storeCalls, code, assertionOperator, diagnostic,
    retainedForDiagnosis: touched, sourceIds: touched ? sourceIds : [], versionIds })); process.exitCode = 1;
}
finally {
  for (const budget of budgets) budget.close();
  try { if (succeeded) await cleanup(); } catch { succeeded = false; console.error(JSON.stringify({ event: "knowledge_a04_cleanup_failed", sourceIds, versionIds })); process.exitCode = 1; }
  await pool?.end();
}
if (succeeded) console.log(JSON.stringify({ event: "knowledge_a04_acceptance_passed", groups, storeCalls, syntheticSources: 2, chunks: 1105,
  familyWrites: 0, externalFetches: 0, realModelCalls: 0, cleanup: "exact_fixture_ids" }));
