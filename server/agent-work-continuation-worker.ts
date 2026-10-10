import { z } from "zod";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import type { ProductAgent } from "./product-agent.ts";
import { databaseAdapter } from "./worker-queue.ts";
import { WORK_CONTINUATION_CHECK_QUEUE, WORK_CONTINUATION_QUEUE, WORK_CONTINUATION_OPTIONS,
  type AgentWorkContinuationStore, type WorkContinuationEnqueue, type WorkContinuationJob } from "./agent-work-continuation.ts";
const checkSchema = z.object({ generation: z.uuid() }).strict();
export const workContinuationJobSchema = z.object({ eventId: z.uuid(), jobId: z.uuid(), workerGeneration: z.uuid(), storageEpoch: z.uuid() }).strict();

export interface WorkContinuationRecovery {
  recoverBackground(job: WorkContinuationJob): Promise<{ state: "pending" | "settled" | "already_terminal"; runId: string | null }>;
}
import type { FirestoreWorkContinuationStore } from "./firestore-work-continuation-store.ts";

type ProcessorOptions = { mode: "execute"; store: Pick<AgentWorkContinuationStore, "backgroundInput" | "finishBackground">;
  agent: Pick<ProductAgent, "background"> } | { mode: "recover"; store: WorkContinuationRecovery }
  | { mode: "durable"; store: FirestoreWorkContinuationStore; agent: Pick<ProductAgent, "backgroundClaimed"> };

/** One consumer with mutually exclusive execution and original-result recovery paths. */
export function createAgentWorkContinuationProcessor(options: ProcessorOptions) {
  const controller = new AbortController(); let stopping = false;
  async function process(raw: WorkContinuationJob, frameworkJobId: string) {
    const job = workContinuationJobSchema.parse(raw);
    if (frameworkJobId !== job.jobId) throw new Error("work_continuation_job_invalid");
    if (stopping) return;
    if (options.mode === "recover") {
      const recovered = await options.store.recoverBackground(job);
      if (recovered.state === "pending") throw new Error("work_continuation_run_pending");
      return;
    }
    if (options.mode === "durable") {
      const admission = await options.store.beginBackground(job);
      if (admission.decision === "lookup" && admission.runId === null) return;
      if (admission.decision === "execute" && !stopping) {
        const result = await options.agent.backgroundClaimed(admission, () => !stopping, controller.signal);
        if (result && !stopping) await options.store.finishBackground(job, admission.claim, result);
      }
      const recovered = await options.store.recoverBackground(job);
      if (recovered.state === "pending") throw new Error("work_continuation_run_pending");
      return;
    }
    const { store, agent } = options;
    const current = () => store.backgroundInput(job);
    const input = await current();
    if (!input || stopping) return;
    try {
      const receipt = await agent.background({ userId: input.userId, childId: input.childId, reference: job.eventId,
        context: input.context, authorize: async () => !stopping && Boolean(await current()), signal: controller.signal });
      if (await store.finishBackground(job, receipt) === "running") throw new Error("work_continuation_run_pending");
    } catch {
      // Retry the original reference only. The persisted Agent claim prevents a second generation.
      if (await store.finishBackground(job, null) === "running") throw new Error("work_continuation_run_unconfirmed");
    }
  }
  return { process, stop() { stopping = true; controller.abort(); } };
}

/** Native cron and retries carry references only; private model context is rebuilt by the store. */
export function createAgentWorkContinuationWorker(pool: Pool, boss: PgBoss, store: AgentWorkContinuationStore, agent: Pick<ProductAgent, "background">) {
  const processor = createAgentWorkContinuationProcessor({ mode: "execute", store, agent });
  let timer: ReturnType<typeof setInterval> | undefined, pending: Promise<void> | undefined, stopping = false;
  const enqueue: WorkContinuationEnqueue = async (client, job) => {
    const data = workContinuationJobSchema.parse(job);
    if (await boss.send(WORK_CONTINUATION_QUEUE, data, { ...WORK_CONTINUATION_OPTIONS, id: job.jobId, db: databaseAdapter(client) }) !== job.jobId)
      throw new Error("work_continuation_enqueue_unconfirmed");
  };
  async function reconcile() {
    const control = (await pool.query<{ enabled: boolean; generation: string }>("SELECT enabled,generation FROM worker_control WHERE id=1")).rows[0];
    if (stopping) return;
    if (!control?.enabled) { await boss.unschedule(WORK_CONTINUATION_CHECK_QUEUE, "due"); return; }
    const schedule = (await boss.getSchedules(WORK_CONTINUATION_CHECK_QUEUE)).find(value => value.key === "due");
    const parsed = checkSchema.safeParse(schedule?.data);
    if (!parsed.success || parsed.data.generation !== control.generation)
      await boss.schedule(WORK_CONTINUATION_CHECK_QUEUE, "* * * * *", { generation: control.generation },
        { ...WORK_CONTINUATION_OPTIONS, key: "due", tz: "Asia/Hong_Kong", missed: "once", singletonKey: "due" });
    if (!stopping) await store.reconcile(control.generation);
  }
  const sync = () => pending ??= reconcile().finally(() => { pending = undefined; });

  return {
    process: processor.process,
    async start() {
      if (!await boss.getQueue(WORK_CONTINUATION_CHECK_QUEUE) || !await boss.getQueue(WORK_CONTINUATION_QUEUE)) throw new Error("work_continuation_queue_missing");
      await sync();
      await boss.work<z.infer<typeof checkSchema>>(WORK_CONTINUATION_CHECK_QUEUE, { batchSize: 1, localConcurrency: 1, pollingIntervalSeconds: 2 }, async jobs => {
        for (const job of jobs) {
          const data = checkSchema.parse(job.data);
          try { if (!stopping) await store.checkDue(data.generation, enqueue); }
          catch { throw new Error("work_continuation_check_failed"); }
        }
      });
      await boss.work<WorkContinuationJob>(WORK_CONTINUATION_QUEUE, { batchSize: 1, localConcurrency: 1, pollingIntervalSeconds: 2 }, async jobs => {
        for (const job of jobs) await processor.process(job.data, job.id);
      });
      timer = setInterval(() => { void sync().catch(() => console.error("work_continuation_schedule_sync_failed")); }, 60000).unref();
    },
    async stop() { stopping = true; clearInterval(timer); processor.stop(); await pending; },
  };
}
