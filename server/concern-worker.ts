import { z } from "zod";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import type { ProductAgent } from "./product-agent.ts";
import type { ConcernEnqueue, ConcernJob, ConcernStore } from "./concern-store.ts";
import { databaseAdapter } from "./worker-queue.ts";
import { CONCERN_AGENT_QUEUE, CONCERN_CHECK_QUEUE, CONCERN_JOB_OPTIONS } from "./concern-events.ts";
import { concernAgentContext } from "./concern-context.ts";
const checkSchema = z.object({ generation: z.uuid() }).strict();
export const concernJobSchema = z.object({ childId: z.uuid(), id: z.uuid(), followUpId: z.uuid(),
  version: z.number().int().positive(), jobId: z.uuid(), workerGeneration: z.uuid(), storageEpoch: z.uuid() }).strict();

/** A persisted follow-up is one station-only Agent claim, with no model call in a transaction. */
export function createConcernWorker(pool: Pool, boss: PgBoss, store: ConcernStore, agent: Pick<ProductAgent, "background">) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setInterval> | undefined, pending: Promise<void> | undefined, stopping = false;
  const enqueue: ConcernEnqueue = async (client, job) => {
    const data = concernJobSchema.parse(job);
    if (await boss.send(CONCERN_AGENT_QUEUE, data, { ...CONCERN_JOB_OPTIONS, id: job.jobId, db: databaseAdapter(client) }) !== job.jobId)
      throw new Error("concern_enqueue_unconfirmed");
  };
  async function reconcile() {
    const control = (await pool.query<{ enabled: boolean; generation: string }>("SELECT enabled,generation FROM worker_control WHERE id=1")).rows[0];
    if (stopping) return;
    if (!control?.enabled) { await boss.unschedule(CONCERN_CHECK_QUEUE, "due"); return; }
    const schedule = (await boss.getSchedules(CONCERN_CHECK_QUEUE)).find(value => value.key === "due");
    const parsed = checkSchema.safeParse(schedule?.data);
    if (!parsed.success || parsed.data.generation !== control.generation)
      await boss.schedule(CONCERN_CHECK_QUEUE, "* * * * *", { generation: control.generation },
        { ...CONCERN_JOB_OPTIONS, key: "due", tz: "Asia/Hong_Kong", missed: "once", singletonKey: "due" });
  }
  const sync = () => pending ??= reconcile().finally(() => { pending = undefined; });
  async function process(raw: ConcernJob, frameworkJobId: string) {
    const job = concernJobSchema.parse(raw);
    if (frameworkJobId !== job.jobId) throw new Error("concern_job_invalid");
    if (stopping) return;
    const current = () => store.backgroundInput(job);
    const input = await current();
    if (!input || stopping) return;
    try {
      const receipt = await agent.background({ userId: input.userId, childId: job.childId, reference: job.followUpId,
        context: { eventType: "concern_followup", concern: concernAgentContext(input.concern) },
        authorize: async () => !stopping && Boolean(await current()), signal: controller.signal });
      if (await store.finishBackground(job, receipt) === "running") throw new Error("concern_run_pending");
    } catch {
      // The same reference reads a prior claim on retry; an unknown run is never generated again.
      if (await store.finishBackground(job, null) === "running") throw new Error("concern_agent_unconfirmed");
    }
  }
  return {
    process,
    async start() {
      if (!await boss.getQueue(CONCERN_CHECK_QUEUE) || !await boss.getQueue(CONCERN_AGENT_QUEUE)) throw new Error("concern_queue_missing");
      await sync();
      await boss.work<z.infer<typeof checkSchema>>(CONCERN_CHECK_QUEUE, { batchSize: 1, localConcurrency: 1, pollingIntervalSeconds: 2 }, async jobs => {
        for (const job of jobs) {
          const data = checkSchema.parse(job.data);
          try { if (!stopping) await store.checkDue(data.generation, enqueue); }
          catch { throw new Error("concern_check_failed"); }
        }
      });
      await boss.work<ConcernJob>(CONCERN_AGENT_QUEUE, { batchSize: 1, localConcurrency: 1, pollingIntervalSeconds: 2 }, async jobs => {
        for (const job of jobs) await process(job.data, job.id);
      });
      timer = setInterval(() => { void sync().catch(() => console.error("concern_schedule_sync_failed")); }, 60000).unref();
    },
    async stop() { stopping = true; clearInterval(timer); controller.abort(); await pending; },
  };
}
