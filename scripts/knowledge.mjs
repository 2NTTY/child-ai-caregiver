import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { readServerConfig } from "../server/config.ts";
import { readAiConfig } from "../server/ai-config.ts";
import { createPool } from "../server/database.ts";
import { createKnowledgeStore } from "../server/knowledge-store.ts";
import { createEmbeddingGateway, createEmbeddingUsage } from "../server/embedding-gateway.ts";
import { createVertexEmbeddingProvider } from "../server/vertex-embedding.ts";
import { createKnowledgeRetriever } from "../server/knowledge-retriever.ts";
import { AgentBudget } from "../server/agent-budget.ts";
import { serverStorageBackend } from "../server/firebase-config.ts";

const args = process.argv.slice(2);
const operation = args[0];
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
let pool, budget, persistence;
try {
  if (!["list", "import", "review", "prepare-search", "embed", "publish", "disable", "search"].includes(operation)) throw new Error("Invalid operation");
  // These are authenticated host-operator commands, never model-callable tools or a browser admin endpoint.
  if (operation !== "list" && !args.includes("--operator-confirmed")) throw new Error("Operator confirmation required");
  const reviewer = option("--operator");
  if (operation !== "list" && (!reviewer || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/.test(reviewer))) throw new Error("Operator alias required");
  const audience = args.includes("--internal-source-review") ? "internal" : "public";
  let store;
  if (serverStorageBackend(process.env) === "firestore") {
    const [{ openFirebasePersistence }, { createFirestoreKnowledgeStore }, { createFirestoreKnowledgeRefresh }, { SOURCE_WATCHES }] = await Promise.all([
      import("../server/firebase-persistence.ts"), import("../server/firestore-knowledge.ts"), import("../server/firestore-knowledge-refresh.ts"), import("../server/knowledge-source-catalog.ts")]);
    persistence = await openFirebasePersistence(process.env);
    const { database, cipher, config, authority } = persistence;
    if (!config.knowledgeSourceIds) throw new Error("knowledge_source_not_configured");
    const domain = { database, cipher, projectId: config.projectId, namespace: config.namespace };
    const refresh = createFirestoreKnowledgeRefresh({ ...domain, definitions: SOURCE_WATCHES, readControl: tx => authority.readControl(tx) });
    store = createFirestoreKnowledgeStore({ ...domain, sourceIds: config.knowledgeSourceIds, observations: refresh.gate, audience });
  } else {
    pool = createPool(readServerConfig(process.env)); store = createKnowledgeStore(pool, { audience });
  }
  const readJson = async file => {
    if (!file || (await stat(file)).size > 2 * 1024 * 1024) throw new Error("Invalid knowledge input file");
    return JSON.parse(await readFile(file, "utf8"));
  };
  if (operation === "list") console.log(JSON.stringify(await store.listVersions(option("--after-version"))));
  if (operation === "prepare-search") {
    if (!persistence) throw new Error("knowledge_search_requires_firestore");
    // One bounded maintenance page per invocation. Reuse version/hash until complete; no model calls.
    console.log(JSON.stringify({ event: "knowledge_search_prepared", ...await store.prepareSearch(args[1], option("--hash")) }));
  }
  if (operation === "import") {
    const input = await readJson(args[1]);
    const sources = Array.isArray(input) ? input : [input];
    if (!sources.length || sources.length > 8) throw new Error("Import at most eight sources");
    for (const source of sources) console.log(JSON.stringify({ sourceId: source.sourceId, ...await store.importSource(source) }));
  }
  if (operation === "review") {
    if (!args.includes("--source-and-terms-checked")) throw new Error("Source and terms review required");
    const assessment = await readJson(option("--assessment"));
    console.log(JSON.stringify({ event: "knowledge_version_review", ...await store.review(args[1], option("--hash"), reviewer, assessment) }));
  }
  if (operation === "publish") { console.log(JSON.stringify({ event: "knowledge_publication", ...await store.publish(args[1], option("--hash")) })); }
  if (operation === "disable") { await store.disable(args[1], option("--reason") ?? ""); console.log("knowledge_source_disabled"); }
  if (operation === "embed" || operation === "search") {
    if (!args.includes("--approved-cost")) throw new Error("Model cost approval required");
    const config = readAiConfig(process.env);
    if (!config.enabled) throw new Error("Embedding disabled");
    const deadline = Date.now() + 900000;
    const usage = persistence ? (await import("../server/firestore-embedding-usage.ts")).createFirestoreOperatorEmbeddingUsage({
      database: persistence.database, cipher: persistence.cipher, projectId: persistence.config.projectId, namespace: persistence.config.namespace }, deadline) : createEmbeddingUsage(pool);
    const gateway = createEmbeddingGateway({ config, provider: createVertexEmbeddingProvider(config), usage });
    if (operation === "embed") {
      const max = Number(option("--max-calls"));
      if (!Number.isInteger(max) || max < 1 || max > 16) throw new Error("Specify a finite maintenance call limit (1-16)");
      const pending = await store.missingDocuments(args[1]);
      if (!persistence && pending.length > max) throw new Error("Pending corpus exceeds the approved call limit");
      const actor = { kind: "corpus_maintenance", actorId: `operator:${reviewer}`, operationId: randomUUID() };
      const signal = AbortSignal.timeout(Math.min(900000, max * config.timeoutMs));
      let generated = 0;
      for (const document of pending.slice(0, max)) {
        const result = await store.embedDocument(document, () => gateway.embed({ text: document.text, title: document.title, task: "RETRIEVAL_DOCUMENT" }, actor, signal, async () => true));
        if (!result.reused) generated++;
      }
      const remaining = (await store.missingDocuments(args[1])).length;
      // Firestore publication remains explicit: staged lexical index, current source and review must all agree.
      const publication = persistence ? { status: "pending", reason: "explicit_publication_required" } : await store.tryPublish(args[1]);
      console.log(JSON.stringify({ event: "knowledge_embedding_finished", generated, remaining, publication }));
    } else {
      const input = await readJson(args[1]);
      budget = new AgentBudget();
      const run = createKnowledgeRetriever(store, gateway).createRun({ actor: { kind: "query_embedding", actorId: `operator:${reviewer}`, operationId: randomUUID() }, budget, authorize: async () => true });
      const result = await run.search(input.query, input.filter);
      // Operator results contain public evidence only; never echo the potentially private query into logs.
      console.log(JSON.stringify({ mode: result.mode, degradationReason: result.degradationReason,
        chunks: result.chunks.map(chunk => ({ chunkId: chunk.chunkId, sourceId: chunk.sourceId, versionId: chunk.versionId, key: chunk.key, url: chunk.url })) }));
    }
  }
} catch (error) { console.error(JSON.stringify({ event: "knowledge_operation_failed_check_scope_version_quota_and_source_review", reason: error instanceof Error && /^knowledge_[a-z_]+$/.test(error.message) ? error.message : "operation_failed" })); process.exitCode = 1; }
finally { budget?.close(); await pool?.end(); await persistence?.close(); }
