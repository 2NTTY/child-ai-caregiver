import { randomUUID } from "node:crypto";
import { createPool } from "../../server/database.ts";
import { readServerConfig } from "../../server/config.ts";
import { createKnowledgeRefreshStore } from "../../server/knowledge-refresh-store.ts";
import { KNOWLEDGE_REFRESH_QUEUE, refreshJobSchema } from "../../server/knowledge-refresh-types.ts";
import { createWorkerQueue } from "../../server/worker-queue.ts";

// This fixture starts no task handler, production network fetcher, model, or schedule reconciler.
const pending = new Map(), controller = new AbortController();
let pool, queue, closing = false, stopping, target, lifetime;
const emit = value => {
  try { if (process.connected) process.send(value, error => { if (error) process.exitCode = 1; }); }
  catch { process.exitCode = 1; }
};
async function request(type, watchId) {
  if (closing) throw new Error("knowledge_refresh_fixture_stopping");
  const requestId = randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error("knowledge_refresh_fixture_parent_timeout")); }, 10000);
    pending.set(requestId, { type, resolve, reject, timer }); emit({ type, requestId, watchId });
  });
}
const stop = () => stopping ??= (async () => {
  closing = true; controller.abort(); clearTimeout(lifetime);
  for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error("knowledge_refresh_fixture_stopping")); }
  pending.clear();
  try { await queue?.stop(); } finally { await pool?.end(); }
  if (process.connected) process.disconnect();
})();
process.on("message", message => {
  if (!message || typeof message !== "object") return;
  if (message.type === "stop") { void stop().catch(() => { emit({ type: "fixture-failed" }); process.exitCode = 1; }); return; }
  const entry = pending.get(message.requestId);
  if (!entry) return;
  if (entry.type === "call" && ["grant", "deny"].includes(message.type)) {
    clearTimeout(entry.timer); pending.delete(message.requestId);
    message.type === "grant" ? entry.resolve() : entry.reject(new Error("knowledge_refresh_fixture_scope_denied"));
  } else if (entry.type === "fetch" && message.type === "fetched") {
    clearTimeout(entry.timer); pending.delete(message.requestId);
    if (message.result?.status !== "ok" || !Array.isArray(message.result.items) || message.result.items.length !== 1) entry.reject(new Error("knowledge_refresh_fixture_fetch_invalid"));
    else entry.resolve(message.result);
  }
});
for (const event of ["disconnect", "SIGTERM", "SIGINT"]) process.once(event, () => { void stop().catch(() => { process.exitCode = 1; }); });

try {
  const prefix = process.env.KNOWLEDGE_REFRESH_PREFIX, source = new URL(process.env.TEST_DATABASE_URL), database = new URL(process.env.DATABASE_URL);
  target = process.env.KNOWLEDGE_REFRESH_TARGET;
  const definitions = JSON.parse(process.env.KNOWLEDGE_REFRESH_DEFINITIONS ?? "null");
  if (process.argv.length !== 4 || process.argv[2] !== "--knowledge-refresh-fixture" || process.argv[3] !== "--approved-knowledge-refresh" || !process.send
    || !/^kr-[0-9a-f]{12}$/.test(prefix ?? "") || target !== `${prefix}-guard`
    || !["postgres:", "postgresql:"].includes(source.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(source.hostname)
    || source.pathname !== "/yuban_s06_test" || source.port === "5433" || source.search || source.hash
    || database.protocol !== source.protocol || database.hostname !== source.hostname || database.port !== source.port
    || database.pathname !== source.pathname || database.username !== source.username || database.password !== source.password || database.hash
    || [...database.searchParams.keys()].some(name => name !== "application_name") || database.searchParams.get("application_name") !== prefix
    || !Array.isArray(definitions) || definitions.length !== 3 || new Set(definitions.map(definition => definition.id)).size !== 3
    || definitions.some(definition => ![`${prefix}-guidance`, `${prefix}-recent`, `${prefix}-guard`].includes(definition.id))
    || process.env.AI_ENABLED !== "false" || process.env.NODE_ENV !== "test") throw new Error("knowledge_refresh_fixture_configuration_invalid");
  lifetime = setTimeout(() => { emit({ type: "fixture-failed" }); process.exitCode = 1; void stop().catch(() => {}); }, 180000).unref();
  pool = createPool(readServerConfig(process.env));
  if (!(await pool.query("SELECT 1 FROM app_migrations WHERE id='014-knowledge-refresh'")).rowCount) throw new Error("knowledge_refresh_fixture_migration_required");
  if ((await pool.query("SELECT 1 FROM knowledge_watches WHERE enabled AND NOT (id=ANY($1::text[])) LIMIT 1", [definitions.map(definition => definition.id)])).rowCount) throw new Error("knowledge_refresh_fixture_foreign_watch");
  const store = createKnowledgeRefreshStore(pool, definitions);
  queue = createWorkerQueue(pool, "worker"); await queue.start();
  await queue.boss.work(KNOWLEDGE_REFRESH_QUEUE, { batchSize: 1, localConcurrency: 1, pollingIntervalSeconds: 2, includeMetadata: true }, async jobs => {
    for (const job of jobs) {
      const data = refreshJobSchema.parse(job.data);
      if (data.watchId !== target) { emit({ type: "fixture-failed" }); throw new Error("knowledge_refresh_fixture_foreign_job"); }
      await request("call", data.watchId);
      const result = await store.process(data, job.id, definition => request("fetch", definition.id), controller.signal);
      emit({ type: "handled", jobId: job.id, status: result.status });
    }
  });
  emit({ type: "ready" });
} catch {
  emit({ type: "fixture-failed" }); process.exitCode = 1; await stop().catch(() => {});
}
