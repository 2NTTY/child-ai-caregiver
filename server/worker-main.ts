import { createPool } from "./database.ts";
import { readServerConfig } from "./config.ts";
import { createStorageCipher, readSecretKey } from "./storage-crypto.ts";
import { verifyEncryptedStorage } from "./storage-upgrade.ts";
import { createWorkerQueue } from "./worker-queue.ts";
import { createTaskWorker } from "./task-worker.ts";

let pool: ReturnType<typeof createPool> | undefined;
let queue: ReturnType<typeof createWorkerQueue> | undefined;
let stopping: Promise<void> | undefined;
const stop = () => stopping ??= (async () => {
  const deadline = setTimeout(() => { console.error("worker_stop_deadline"); process.exit(1); }, 20000).unref();
  try { await queue?.stop(); } finally { try { await pool?.end(); } finally { clearTimeout(deadline); } }
})();
try {
  const cipher = createStorageCipher(await readSecretKey(process.env.STORAGE_KEY_FILE));
  pool = createPool(readServerConfig(process.env));
  await verifyEncryptedStorage(pool, cipher);
  const ready = (await pool.query("SELECT 1 FROM app_migrations WHERE id='013-task-worker'")).rowCount;
  if (!ready) throw new Error("worker_migration_required");
  queue = createWorkerQueue(pool, "worker");
  await queue.start();
  await queue.work(createTaskWorker(pool, cipher, queue.queue));
  const shutdown = () => { void stop().catch(() => { console.error("worker_stop_failed"); process.exitCode = 1; }); };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  console.info("worker_started");
} catch {
  console.error("worker_start_failed");
  await stop().catch(() => {});
  process.exitCode = 1;
}
