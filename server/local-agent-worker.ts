import { createHash } from 'node:crypto';
import { canonicalJson } from './online-routing.ts';
import { createFirebaseWorkerServices } from './firebase-worker-services.ts';
import { firestoreBackgroundDeliverySchema, type FirestoreBackgroundDelivery } from './firestore-background-work.ts';
import { firestoreTaskDeliverySchema, type FirestoreTaskDelivery } from './firestore-task-worker.ts';
import { assertLocalAgentEnvironment } from './local-agent-config.ts';
import type { openFirebaseRuntime } from './firebase-runtime.ts';

/** Replace only the Tasks/Scheduler transport. Business leases, authorization, receipts
 * and unknown-effect recovery remain in the production worker consumers. */
export function createLocalAgentWorker(runtime: Awaited<ReturnType<typeof openFirebaseRuntime>>,
  env: Record<string, string | undefined>) {
  assertLocalAgentEnvironment(env);
  const queue = runtime.database.collection('local_agent_transport'), controller = new AbortController();
  type Job = FirestoreTaskDelivery | FirestoreBackgroundDelivery;
  const key = (kind: string, job: Job) => createHash('sha256').update(canonicalJson({ kind, job })).digest('hex');
  const name = (kind: string, job: Job) => 'local/' + kind + '/' + key(kind, job);
  const enqueue = async (kind: string, job: Job) => {
    const reference = queue.doc(key(kind, job));
    return runtime.database.runTransaction(async tx => {
      const row = await tx.get(reference);
      if (row.exists) return { state: canonicalJson(row.get('job')) === canonicalJson(job) ? 'confirmed' as const : 'conflict' as const, taskName: name(kind, job) };
      tx.create(reference, { kind, job, pending: true, due: job.scheduledAt, attempts: 0 });
      return { state: 'confirmed' as const, taskName: name(kind, job) };
    });
  };
  const probe = async (kind: string, job: Job) => {
    const row = await queue.doc(key(kind, job)).get();
    return { state: !row.exists ? 'unknown' as const : canonicalJson(row.get('job')) === canonicalJson(job) ? 'confirmed' as const : 'conflict' as const,
      taskName: name(kind, job) };
  };
  const services = createFirebaseWorkerServices(runtime, {
    taskName: job => name('reminder', job), enqueue: job => enqueue('reminder', job), probe: job => probe('reminder', job),
  }, { enqueue: job => enqueue('background', job), probe: job => probe('background', job) }, controller);
  let ticking: Promise<unknown> | undefined;
  const tick = () => ticking ??= (async () => {
    await services.maintenance.tick();
    const reminders = await services.dispatcher.dispatchScheduled(), background = await services.background.dispatch();
    const page = await queue.where('pending', '==', true).where('due', '<=', new Date().toISOString()).orderBy('due').limit(8).get();
    for (const row of page.docs) {
      if (controller.signal.aborted) break;
      const body = row.data(), job = body.kind === 'reminder' ? firestoreTaskDeliverySchema.parse(body.job) : firestoreBackgroundDeliverySchema.parse(body.job);
      if (row.id !== key(body.kind, job)) throw Error('Local task binding mismatch');
      // Do not turn an unknown model/external effect into another business operation.
      const result = body.kind === 'reminder' ? await services.worker.process(job as FirestoreTaskDelivery)
        : await services.background.process(job as FirestoreBackgroundDelivery);
      const attempts = body.attempts + 1;
      // A live production lease can outlast a short local retry delay. Wait for
      // that lease before probing the same delivery; never generate a new job ID.
      const retryAt = 'nextAt' in result && typeof result.nextAt === 'string' ? Date.parse(result.nextAt) : NaN;
      await row.ref.update({ pending: result.state === 'busy' && attempts < 3, attempts, result: result.state,
        due: new Date(Math.max(Date.now() + 125_000, Number.isFinite(retryAt) ? retryAt : 0)).toISOString() });
    }
    return { reminders, background, delivered: page.size };
  })().finally(() => { ticking = undefined; });
  let timer: ReturnType<typeof setInterval> | undefined;
  return { tick,
    start() { timer ??= setInterval(() => { void tick().catch(() => console.error('local_worker_tick_failed')); }, 5000); },
    async close() { clearInterval(timer); controller.abort(); await ticking?.catch(() => {}); },
  };
}
