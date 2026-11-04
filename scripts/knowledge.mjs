import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { readAiConfig } from "../server/ai-config.ts";
import { createEmbeddingGateway } from "../server/embedding-gateway.ts";
import { createVertexEmbeddingProvider } from "../server/vertex-embedding.ts";
import { createKnowledgeRetriever } from "../server/knowledge-retriever.ts";
import { AgentBudget } from "../server/agent-budget.ts";
import { serverStorageBackend } from "../server/firebase-config.ts";

const args = process.argv.slice(2);
const operation = args[0];
const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
let budget, persistence;
try {
  if (!["list", "import", "review", "prepare-search", "embed", "publish", "disable", "search", "archive-export", "archive-import", "archive-status", "archive-stop", "archive-resume", "archive-publish"].includes(operation)) throw new Error("Invalid operation");
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
    throw new Error("knowledge_firestore_required");
  }
  const readJson = async file => {
    if (!file || (await stat(file)).size > 2 * 1024 * 1024) throw new Error("Invalid knowledge input file");
    return JSON.parse(await readFile(file, "utf8"));
  };
  if (operation.startsWith("archive-")) {
    if (audience !== "public") throw new Error("knowledge_transfer_public_only");
    const { writeKnowledgeArchive, openKnowledgeArchive } = await import("./knowledge-transfer-zip.mjs");
    const { readPortableEdition, importKnowledgePage } = await import("./knowledge-transfer-operations.mjs");
    const { createKnowledgeTransfers } = await import("../server/firestore-knowledge-transfers.ts");
    const { database, cipher, config, authority } = persistence;
    const ledger = createKnowledgeTransfers({ database, cipher, projectId: config.projectId, namespace: config.namespace },
      tx => authority.readControl(tx));
    const digest = option("--archive-sha256");
    const whole = (name, fallback, min, max) => {
      const value = option(name) ?? fallback;
      if (value === undefined || !/^(0|[1-9][0-9]*)$/u.test(String(value)) || !Number.isSafeInteger(Number(value))
        || Number(value) < min || Number(value) > max) throw new Error("knowledge_transfer_argument_invalid");
      return Number(value);
    };
    if (operation === "archive-export") {
      if (!args.includes("--redistribution-checked")) throw new Error("knowledge_transfer_redistribution_check_required");
      const selected = await readJson(option("--selection"));
      const result = await writeKnowledgeArchive(args[1], selected, row => store.exportPublishedEdition(row.sourceId, row.versionHash));
      console.log(JSON.stringify(result));
    } else if (operation === "archive-status") {
      const job = await ledger.get(digest);
      if (!job) throw new Error("knowledge_transfer_unknown");
      const from = whole("--from", 0, 0, 4096), limit = whole("--limit", 25, 1, 50);
      const items = await ledger.results(digest, from, limit);
      console.log(JSON.stringify({ job, items, next: from + items.length < job.next ? from + items.length : null }));
    } else if (operation === "archive-stop" || operation === "archive-resume") {
      console.log(JSON.stringify(await ledger.control(digest, operation === "archive-stop" ? "stop" : "resume",
        whole("--revision", undefined, 1, 2147483647), reviewer)));
    } else {
      const archive = await openKnowledgeArchive(args[1], digest);
      try {
        if (operation === "archive-import") {
          console.log(JSON.stringify(await importKnowledgePage({ ledger, store, archive, digest, operator: reviewer,
            limit: whole("--limit", 8, 1, 4096) })));
        } else if (operation === "archive-publish") {
          if (!args.includes("--trusted-vector-origin")) throw new Error("knowledge_transfer_vector_origin_required");
          const sourceId = option("--source"), expectedHash = option("--hash"), id = option("--version");
          const index = archive.entries.findIndex(row => row.sourceId === sourceId && row.versionHash === expectedHash);
          if (index < 0 || !id) throw new Error("knowledge_transfer_binding_invalid");
          const row = readPortableEdition(await archive.readEdition(index), archive.entries[index]);
          const result = await store.publish(id, expectedHash, row.embeddings);
          console.log(JSON.stringify({ sourceId, versionId: id, suppliedCompatibleVectors: row.embeddings.length, ...result }));
        }
      } finally { await archive.close(); }
    }
  }
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
    const usage = (await import("../server/firestore-embedding-usage.ts")).createFirestoreOperatorEmbeddingUsage({
      database: persistence.database, cipher: persistence.cipher, projectId: persistence.config.projectId, namespace: persistence.config.namespace }, deadline);
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
} catch (error) {
  const known = [error?.code, error?.message].find(value => typeof value === "string" && /^knowledge_[a-z_]+$/u.test(value));
  const invalidArchive = operation?.startsWith("archive-") && (error?.code === "invalid_knowledge_archive"
    || error?.name === "ZodError" || error instanceof SyntaxError);
  console.error(JSON.stringify({ event: "knowledge_operation_failed_check_scope_version_quota_and_source_review",
    reason: known ?? (invalidArchive ? "knowledge_archive_invalid" : "operation_failed") }));
  process.exitCode = 1;
}
finally { budget?.close(); await persistence?.close(); }
