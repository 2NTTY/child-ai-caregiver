import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { z } from "zod";
import { databaseAdapter } from "./worker-queue.ts";
import { WEB_PUSH_QUEUE, WEB_PUSH_JOB_OPTIONS, type WebPushQueue } from "./web-push-types.ts";
import type { createWebPushWorker } from "./web-push-store.ts";

const payload = z.object({ deliveryId: z.uuid() }).strict();
export function createWebPushQueue(pool: Pool, boss: PgBoss) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let checking: Promise<void> | undefined;
  let stopping = false;
  const queue: WebPushQueue = {
    async enqueue(client, deliveryId) {
      const data = payload.parse({ deliveryId });
      const id = await boss.send(WEB_PUSH_QUEUE, data, { ...WEB_PUSH_JOB_OPTIONS, id: deliveryId, db: databaseAdapter(client) });
      if (id !== deliveryId) throw new Error("push_enqueue_unconfirmed");
    },
  };
  return {
    queue,
    async work(handler: ReturnType<typeof createWebPushWorker>) {
      if (!await boss.getQueue(WEB_PUSH_QUEUE)) throw new Error("push_queue_missing");
      const options = { batchSize: 1, localConcurrency: 1, pollingIntervalSeconds: 2 } as const;
      await boss.work<{ deliveryId: string }>(WEB_PUSH_QUEUE, options, async jobs => {
        for (const job of jobs) {
          try {
            const data = payload.parse(job.data);
            if (data.deliveryId !== job.id) throw new Error();
            await handler.process(data.deliveryId, job.signal);
          } catch { throw new Error("push_processing_failed"); }
        }
      });
      const reconcile = async () => {
        const rows = (await pool.query<{ id: string }>(QUERY, [WEB_PUSH_QUEUE])).rows;
        for (const row of rows) { if (stopping) break; await handler.unavailable(row.id); }
      };
      const check = () => { checking ??= reconcile().catch(() => { console.error("push_reconcile_failed"); }).finally(() => { checking = undefined; }); };
      check(); timer = setInterval(check, 60000).unref();
    },
    async stop() { stopping = true; clearInterval(timer); await checking; },
  };
}
const QUERY = "SELECT d.id FROM web_push_deliveries d LEFT JOIN pgboss.job j ON j.name=$1 AND j.id=d.id "
  + "WHERE d.status IN ('queued','sending') AND (j.state IN ('failed','cancelled','completed') OR j.id IS NULL) ORDER BY d.id LIMIT 100";
