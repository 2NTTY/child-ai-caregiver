import { randomUUID } from "node:crypto";
import { createPool } from "../server/database.ts";
import { readServerConfig } from "../server/config.ts";
import { createStorageCipher, readSecretKey } from "../server/storage-crypto.ts";
import { verifyEncryptedStorage } from "../server/storage-upgrade.ts";
import { createTaskWorker } from "../server/task-worker.ts";
import { createWorkerQueue } from "../server/worker-queue.ts";

const modes = ["normal", "stall-before-process", "fail-before-process", "process-then-throw-once"];
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const pendingCalls = new Map(), stalled = new Map();
let pool, queue, stopping, closing = false, thrown = false, stalledOnce = false;
const emit = value => { if (process.connected) process.send(value); };
const stop = () => stopping ??= (async () => {
  closing = true;
  for (const resolve of stalled.values()) resolve(false);
  for (const { reject } of pendingCalls.values()) reject(new Error("fixture_stopping"));
  try { await queue?.stop(); } finally { await pool?.end(); }
  if (process.connected) process.disconnect();
})();

// The parent grants every business call before execution, enforcing one shared cap.
async function business(kind, action) {
  if (closing) throw new Error("fixture_stopping");
  const requestId = randomUUID();
  await new Promise((resolve, reject) => {
    pendingCalls.set(requestId, { resolve, reject });
    emit({ type: "call", requestId, kind });
  });
  pendingCalls.delete(requestId);
  if (closing) throw new Error("fixture_stopping");
  return action();
}

process.on("message", message => {
  if (!message || typeof message !== "object") return;
  if (message.type === "grant-call" || message.type === "deny-call") {
    const call = pendingCalls.get(message.requestId);
    if (call) message.type === "grant-call" ? call.resolve() : call.reject(new Error("fixture_scope_cap"));
  } else if (message.type === "resume" && uuid.test(message.jobId ?? "")) {
    stalled.get(message.jobId)?.(true);
  } else if (message.type === "stop") {
    void stop().catch(() => { emit({ type: "fixture-failed" }); process.exitCode = 1; });
  }
});
process.once("disconnect", () => { void stop().catch(() => { process.exitCode = 1; }); });
process.once("SIGTERM", () => { void stop().catch(() => { process.exitCode = 1; }); });
process.once("SIGINT", () => { void stop().catch(() => { process.exitCode = 1; }); });

try {
  const mode = process.argv[2], target = process.env.WORKER_FIXTURE_TARGET_WORK_ID, targetJob = process.env.WORKER_FIXTURE_TARGET_JOB_ID;
  if (!process.argv.includes("--worker-fixture") || !process.send || !modes.includes(mode)
    || !uuid.test(process.env.WORKER_ACCEPTANCE_RUN_ID ?? "") || mode !== "normal" && (!uuid.test(target ?? "") || !uuid.test(targetJob ?? ""))) {
    throw new Error("fixture_configuration_invalid");
  }
  const url = new URL(process.env.DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || !/^\/yuban_s06_test(?:_worker_restore_[0-9a-f]{12})?$/.test(url.pathname) || url.hash
    || [...url.searchParams.keys()].some(key => key !== "application_name")
    || !/^worker_acceptance_[0-9a-f]{12}$/.test(url.searchParams.get("application_name") ?? "")) {
    throw new Error("fixture_database_invalid");
  }
  const cipher = createStorageCipher(await readSecretKey(process.env.STORAGE_KEY_FILE));
  pool = createPool(readServerConfig(process.env));
  await verifyEncryptedStorage(pool, cipher);
  if (!(await pool.query("SELECT 1 FROM app_migrations WHERE id='013-task-worker'")).rowCount) throw new Error("fixture_migration_required");
  queue = createWorkerQueue(pool, "worker");
  await queue.start();
  const worker = createTaskWorker(pool, cipher, queue.queue);
  await queue.work({
    ...worker,
    async process(workId, jobId, retryCount) {
      emit({ type: "claimed", workId, jobId, retryCount });
      if (workId === target && jobId === targetJob && mode === "stall-before-process" && !stalledOnce) {
        stalledOnce = true;
        const proceed = await new Promise(resolve => { stalled.set(jobId, resolve); });
        stalled.delete(jobId);
        if (!proceed || closing) return;
      }
      if (workId === target && jobId === targetJob && mode === "fail-before-process") throw new Error("fixture_process_failure");
      await business("process", () => worker.process(workId, jobId, retryCount));
      if (workId === target && jobId === targetJob && mode === "process-then-throw-once" && !thrown) {
        thrown = true;
        // The business transaction committed; only framework settlement is lost.
        throw new Error("fixture_settlement_ack_lost");
      }
    },
    failed: (workId, jobId, attempts) => business("failed", () => worker.failed(workId, jobId, attempts)),
    unavailable: (workId, jobId) => business("unavailable", () => worker.unavailable(workId, jobId)),
  });
  emit({ type: "ready", pid: process.pid });
} catch {
  emit({ type: "fixture-failed" });
  process.exitCode = 1;
  await stop().catch(() => {});
}
