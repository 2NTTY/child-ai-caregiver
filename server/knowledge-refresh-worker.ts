import type { PgBoss } from "pg-boss";
import type { KnowledgeRefreshStore } from "./knowledge-refresh-store.ts";
import { KNOWLEDGE_REFRESH_QUEUE, REFRESH_JOB_OPTIONS, refreshCron, refreshJobSchema } from "./knowledge-refresh-types.ts";
import type { RefreshJob, SourceFetcher } from "./knowledge-refresh-types.ts";

/** Native cron owns due times. Reconciliation only applies the reviewed registration/control state. */
export function createKnowledgeRefreshWorker(boss: PgBoss, store: KnowledgeRefreshStore, fetcher: SourceFetcher) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setInterval> | undefined, pending: Promise<void> | undefined;
  let stopping = false;
  const reconcile = async () => {
    const desired = await store.jobs(), existing = await boss.getSchedules(KNOWLEDGE_REFRESH_QUEUE);
    if (stopping) return;
    for (const schedule of existing) {
      if (!desired.some(job => job.definition.id === schedule.key)) await boss.unschedule(KNOWLEDGE_REFRESH_QUEUE, schedule.key);
    }
    for (const { definition, data } of desired) {
      if (stopping) return;
      const options = { ...REFRESH_JOB_OPTIONS, tz: "Asia/Hong_Kong", key: definition.id, missed: "once" as const, singletonKey: definition.id };
      const previous = existing.find(schedule => schedule.key === definition.id);
      const parsed = refreshJobSchema.safeParse(previous?.data);
      if (!previous || previous.cron !== refreshCron(definition) || previous.timezone !== options.tz || !parsed.success
        || parsed.data.revision !== data.revision || parsed.data.workerGeneration !== data.workerGeneration
        || previous.options?.missed !== "once") await boss.schedule(KNOWLEDGE_REFRESH_QUEUE, refreshCron(definition), data, options);
    }
  };
  const sync = () => pending ??= reconcile().finally(() => { pending = undefined; });
  return {
    async start() {
      await sync();
      await boss.work<RefreshJob>(KNOWLEDGE_REFRESH_QUEUE, { batchSize: 1, localConcurrency: 1, pollingIntervalSeconds: 2 }, async jobs => {
        for (const job of jobs) {
          const parsed = refreshJobSchema.safeParse(job.data);
          if (!parsed.success) throw new Error("knowledge_refresh_job_invalid");
          try { await store.process(parsed.data, job.id, fetcher, controller.signal); }
          catch { throw new Error("knowledge_refresh_processing_failed"); }
        }
      });
      timer = setInterval(() => { void sync().catch(() => console.error("knowledge_schedule_sync_failed")); }, 60000).unref();
    },
    async stop() { stopping = true; clearInterval(timer); controller.abort(); await pending; },
  };
}
