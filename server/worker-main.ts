import { createPool } from "./database.ts";
import { readServerConfig } from "./config.ts";
import { createStorageCipher, readSecretKey } from "./storage-crypto.ts";
import { verifyEncryptedStorage } from "./storage-upgrade.ts";
import { createWorkerQueue } from "./worker-queue.ts";
import { createTaskWorker } from "./task-worker.ts";
import { createKnowledgeRefreshStore } from "./knowledge-refresh-store.ts";
import { createKnowledgeRefreshWorker } from "./knowledge-refresh-worker.ts";
import { SOURCE_WATCHES } from "./knowledge-source-catalog.ts";
import { fetchKnowledgeSource } from "./knowledge-source-fetch.ts";

let pool: ReturnType<typeof createPool> | undefined;
let queue: ReturnType<typeof createWorkerQueue> | undefined;
let knowledgeWorker: ReturnType<typeof createKnowledgeRefreshWorker> | undefined;
let stopping: Promise<void> | undefined;
const stop = () => stopping ??= (async () => {
  const deadline = setTimeout(() => { console.error("worker_stop_deadline"); process.exit(1); }, 20000).unref();
  try { await knowledgeWorker?.stop(); } finally {
    try { await queue?.stop(); } finally { try { await pool?.end(); } finally { clearTimeout(deadline); } }
  }
})();
try {
  const cipher = createStorageCipher(await readSecretKey(process.env.STORAGE_KEY_FILE));
  pool = createPool(readServerConfig(process.env));
  await verifyEncryptedStorage(pool, cipher);
  const ready = (await pool.query("SELECT 1 FROM app_migrations WHERE id='014-knowledge-refresh'")).rowCount;
  if (!ready) throw new Error("worker_migration_required");
  queue = createWorkerQueue(pool, "worker");
  await queue.start();
  await queue.work(createTaskWorker(pool, cipher, queue.queue));
  if (!await queue.boss.getQueue("knowledge-source-check-v1")) throw new Error("knowledge_queue_missing");
  knowledgeWorker = createKnowledgeRefreshWorker(queue.boss, createKnowledgeRefreshStore(pool, SOURCE_WATCHES), fetchKnowledgeSource);
  await knowledgeWorker.start();
  const shutdown = () => { void stop().catch(() => { console.error("worker_stop_failed"); process.exitCode = 1; }); };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  console.info("worker_started");
} catch {
  console.error("worker_start_failed");
  await stop().catch(() => {});
  process.exitCode = 1;
}
