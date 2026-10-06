import { z } from "zod";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import type { FamilyDocumentStore } from "./family-document-store.ts";

export const DOCUMENT_REFRESH_QUEUE = "family-document-refresh-v1";
export const DOCUMENT_REFRESH_OPTIONS = { heartbeatSeconds: 60, expireInSeconds: 180, retryLimit: 1, retryDelay: 10,
  retryBackoff: false, retentionSeconds: 86400, deleteAfterSeconds: 86400 };
const checkSchema = z.object({ generation: z.uuid() }).strict();

/** Cron drains durable coalesced dirty rows. Schedule reconciliation never claims document work. */
export function createFamilyDocumentWorker(pool: Pool, boss: PgBoss, store: FamilyDocumentStore) {
  let timer: ReturnType<typeof setInterval> | undefined, pending: Promise<void> | undefined, stopping = false;
  async function reconcile() {
    const control = (await pool.query<{ enabled: boolean; generation: string }>("SELECT enabled,generation FROM worker_control WHERE id=1")).rows[0];
    if (stopping) return;
    if (!control?.enabled) { await boss.unschedule(DOCUMENT_REFRESH_QUEUE, "dirty"); return; }
    const schedule = (await boss.getSchedules(DOCUMENT_REFRESH_QUEUE)).find(value => value.key === "dirty");
    const data = checkSchema.safeParse(schedule?.data);
    if (!data.success || data.data.generation !== control.generation) await boss.schedule(DOCUMENT_REFRESH_QUEUE, "* * * * *", { generation: control.generation },
      { ...DOCUMENT_REFRESH_OPTIONS, key: "dirty", tz: "Asia/Hong_Kong", missed: "once", singletonKey: "dirty" });
  }
  const sync = () => pending ??= reconcile().finally(() => { pending = undefined; });
  return {
    async start() {
      if (!await boss.getQueue(DOCUMENT_REFRESH_QUEUE)) throw new Error("document_queue_missing");
      await sync();
      await boss.work<z.infer<typeof checkSchema>>(DOCUMENT_REFRESH_QUEUE, { batchSize: 1, localConcurrency: 1, pollingIntervalSeconds: 2 }, async jobs => {
        for (const job of jobs) {
          const data = checkSchema.parse(job.data);
          try { if (!stopping) await store.refreshPending(data.generation); }
          catch { throw new Error("document_refresh_failed"); }
        }
      });
      timer = setInterval(() => { void sync().catch(() => console.error("document_schedule_sync_failed")); }, 60000).unref();
    },
    async stop() { stopping = true; clearInterval(timer); await pending; },
  };
}
