import { CONTACT_QUEUE,CONTACT_OPTIONS } from "./contact-events.ts";
import { PgBoss, type Db, type JobWithMetadata } from "pg-boss";
import { TELEGRAM_QUEUE,TELEGRAM_JOB_OPTIONS } from "./telegram-events.ts";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import type { TaskQueue } from "./task-worker.ts";
import { AGENT_DUE_QUEUE, AGENT_DUE_OPTIONS } from "./agent-event-types.ts";
import { KNOWLEDGE_REFRESH_QUEUE, REFRESH_JOB_OPTIONS } from "./knowledge-refresh-types.ts";
import { WEB_PUSH_QUEUE, WEB_PUSH_JOB_OPTIONS } from "./web-push-types.ts";

import { GROWTH_CHECK_QUEUE,GROWTH_AGENT_QUEUE,GROWTH_JOB_OPTIONS } from "./growth-events.ts";
import { CONCERN_CHECK_QUEUE,CONCERN_AGENT_QUEUE,CONCERN_JOB_OPTIONS } from "./concern-events.ts";
import { DOCUMENT_REFRESH_QUEUE,DOCUMENT_REFRESH_OPTIONS } from "./family-document-worker.ts";

export const TASK_QUEUE = "task-due-v1", FAILED_QUEUE = "task-failed-v1";
export const JOB_OPTIONS = { heartbeatSeconds: 60, expireInSeconds: 90, retryLimit: 2, retryDelay: 5,
  retryBackoff: false, retentionSeconds: 14 * 86400, deleteAfterSeconds: 7 * 86400 };
export const jobDataSchema = z.object({ workId: z.uuid(), jobId: z.uuid() }).strict();
export type TaskJobData = z.infer<typeof jobDataSchema>;
export function databaseAdapter(connection: Pool | PoolClient): Db {
  return { async executeSql(text, values) {
    const result = await connection.query(text, values);
    // pg returns one result per statement for the supervisor's transaction batches.
    // Preserve their rows just as pg-boss's native unwrapSQLResult does.
    return { rows: Array.isArray(result) ? result.flatMap(part => part.rows) : result.rows };
  } };
}

/** Only the migration command may install/upgrade framework tables. */
export function createWorkerQueue(pool: Pool, mode: "producer" | "worker" | "migrate") {
  const boss = new PgBoss({ db: databaseAdapter(pool), schema: "pgboss", migrate: mode === "migrate",
    supervise: mode === "worker", schedule: mode === "worker", monitorIntervalSeconds: 60, superviseIntervalSeconds: 60,
    persistWarnings: false, persistQueueStats: false });
  // Never log arbitrary SDK errors, stacks, payloads, SQL or connection strings.
  boss.on("error", () => console.error("worker_queue_error"));
  boss.on("warning", () => console.warn("worker_queue_warning"));
  let monitor: ReturnType<typeof setInterval> | undefined;
  let checking: Promise<void> | undefined;
  let stopping = false;
  const queue: TaskQueue = {
    async enqueue(client, jobId, workId, at, failures = 0) {
      const data = jobDataSchema.parse({ workId, jobId });
      if (!Number.isInteger(failures) || failures < 0 || failures > 2) throw new Error("worker_retry_budget_invalid");
      const startAfter = new Date(Math.max(Date.now(), Date.parse(at))).toISOString();
      const id = await boss.send(TASK_QUEUE, data, { ...JOB_OPTIONS, id: jobId, startAfter, retryLimit: 2 - failures,
        deadLetter: FAILED_QUEUE, db: databaseAdapter(client) });
      if (id !== jobId) throw new Error("worker_enqueue_unconfirmed");
    },
  };
  return {
    boss, queue,
    async start() {
      if (mode === "migrate") {
        const version = await boss.isInstalled() ? await boss.schemaVersion() : null;
        if (version !== null && version !== 42) throw new Error("worker_schema_upgrade_requires_review");
      }
      await boss.start();
      if (mode === "migrate") {
        await boss.createQueue(WEB_PUSH_QUEUE, WEB_PUSH_JOB_OPTIONS);
        await boss.createQueue(TELEGRAM_QUEUE, TELEGRAM_JOB_OPTIONS);
        await boss.createQueue(CONTACT_QUEUE, CONTACT_OPTIONS);
        await boss.createQueue(FAILED_QUEUE, JOB_OPTIONS);
        await boss.createQueue(TASK_QUEUE, { ...JOB_OPTIONS, deadLetter: FAILED_QUEUE });
        await boss.createQueue(KNOWLEDGE_REFRESH_QUEUE, { ...REFRESH_JOB_OPTIONS, policy: "exclusive" });
        await boss.createQueue(AGENT_DUE_QUEUE, AGENT_DUE_OPTIONS);
        await boss.createQueue(GROWTH_CHECK_QUEUE, {...GROWTH_JOB_OPTIONS,policy:"exclusive"});
        await boss.createQueue(GROWTH_AGENT_QUEUE, GROWTH_JOB_OPTIONS);
        await boss.createQueue(CONCERN_CHECK_QUEUE, {...CONCERN_JOB_OPTIONS,policy:"exclusive"});
        await boss.createQueue(CONCERN_AGENT_QUEUE, CONCERN_JOB_OPTIONS);
        await boss.createQueue(DOCUMENT_REFRESH_QUEUE, { ...DOCUMENT_REFRESH_OPTIONS, policy: "exclusive" });
        if ((await boss.getBamEntries()).some(entry => entry.status !== "completed")) throw new Error("worker_schema_maintenance_pending");
      } else if (!await boss.getQueue(TASK_QUEUE) || !await boss.getQueue(FAILED_QUEUE)) throw new Error("worker_queues_missing");
    },
    async work(handler: { process(workId: string, jobId: string, retryCount: number): Promise<unknown>; failed(workId: string, jobId: string, attempts: number): Promise<void>; unavailable?(workId: string, jobId: string): Promise<void> }) {
      const options = { batchSize: 1, localConcurrency: 1, pollingIntervalSeconds: 2, includeMetadata: true } as const;
      await boss.work<TaskJobData, void, typeof options>(TASK_QUEUE, options, async jobs => {
        for (const job of jobs) {
          const parsed = jobDataSchema.safeParse(job.data);
          if (!parsed.success || parsed.data.jobId !== job.id) throw new Error("worker_job_invalid");
          try { await handler.process(parsed.data.workId, job.id, job.retryCount); }
          catch {
            try { await handler.failed(parsed.data.workId, job.id, job.retryCount + 1); } catch { /* Framework retries/dead letter preserve the failure. */ }
            throw new Error("worker_processing_failed");
          }
        }
      });
      await boss.work<TaskJobData, void, typeof options>(FAILED_QUEUE, options, async (jobs: JobWithMetadata<TaskJobData>[]) => {
        for (const job of jobs) {
          const parsed = jobDataSchema.safeParse(job.data);
          if (!parsed.success) throw new Error("worker_job_invalid");
          try { await handler.failed(parsed.data.workId, parsed.data.jobId, 3); }
          catch { throw new Error("worker_failure_record_failed"); }
        }
      });
      // Read-only reconciliation of framework terminal/retained state, not another job claimer.
      // Covers dead-letter recording failures and retained jobs removed during a long outage.
      const reconcile = async () => {
        const rows = (await pool.query<{ id: string; job_id: string; state: string | null }>(`SELECT w.id,w.job_id,j.state
          FROM task_work w JOIN worker_control c ON c.id=1 AND c.enabled AND c.generation=w.worker_generation
          LEFT JOIN pgboss.job j ON j.name=$1 AND j.id=w.job_id
          WHERE w.status='pending' AND (j.state IN ('failed','cancelled') OR j.id IS NULL)
          ORDER BY w.id LIMIT 100`, [TASK_QUEUE])).rows;
        for (const row of rows) {
          if (stopping) break;
          if (row.state === "failed") await handler.failed(row.id, row.job_id, 3);
          else await handler.unavailable?.(row.id, row.job_id);
        }
      };
      const check = () => { checking ??= reconcile().catch(() => { console.error("worker_reconcile_failed"); }).finally(() => { checking = undefined; }); };
      check(); monitor = setInterval(check, 60000).unref();
    },
    async stop() { stopping = true; clearInterval(monitor); await checking; await boss.stop({ graceful: true, timeout: 15000 }); },
  };
}
