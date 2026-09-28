import { readServerConfig } from "../server/config.ts";
import { createPool } from "../server/database.ts";
import { createStorageCipher, readSecretKey } from "../server/storage-crypto.ts";
import { verifyEncryptedStorage } from "../server/storage-upgrade.ts";
import { createWorkerQueue } from "../server/worker-queue.ts";
import { activateTaskWorker } from "../server/worker-control.ts";

let pool, queue;
try {
  const operation = process.argv[2] ?? "status";
  if (!["status", "pause", "activate"].includes(operation)) throw new Error();
  const cipher = createStorageCipher(await readSecretKey(process.env.STORAGE_KEY_FILE));
  pool = createPool(readServerConfig(process.env));
  await verifyEncryptedStorage(pool, cipher);
  if (operation === "pause") {
    await pool.query("UPDATE worker_control SET enabled=false,generation=gen_random_uuid() WHERE id=1");
    console.info("worker_paused");
  } else if (operation === "activate") {
    if (!process.argv.includes("--reviewed-target-source-stopped")) throw new Error();
    queue = createWorkerQueue(pool, "producer"); await queue.start();
    const enqueued = await activateTaskWorker(pool, cipher, queue.queue);
    console.info(JSON.stringify({ state: "enabled", enqueued }));
  } else {
    const control = (await pool.query("SELECT enabled FROM worker_control WHERE id=1")).rows[0];
    const counts = (await pool.query("SELECT status,count(*)::int AS count FROM task_work GROUP BY status ORDER BY status")).rows;
    console.info(JSON.stringify({ enabled: control?.enabled === true, counts }));
  }
} catch { console.error("worker_control_failed"); process.exitCode = 1; }
finally { try { await queue?.stop(); } finally { await pool?.end(); } }
