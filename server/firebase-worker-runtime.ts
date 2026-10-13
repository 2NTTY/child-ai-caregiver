import { openFirebaseRuntime } from './firebase-runtime.ts';
import { createFirestoreTaskDispatcher } from './firestore-task-dispatcher.ts';
import { createFirebaseTaskDelivery, createFirebaseTaskDispatchHandler, createFirebaseTaskHandler,
  createFirebaseBackgroundDelivery, createFirebaseBackgroundHandler } from './firebase-task-delivery.ts';
import { createFirestoreBackgroundQueue, firestoreBackgroundReference } from './firestore-background-work.ts';
import { concernAgentContext } from './concern-context.ts';
import { createFirestoreBackgroundMaintenance } from './firestore-background-maintenance.ts';

export interface FirebaseWorkerConfig {
  enabled: boolean; projectId: string; region: string; queue: string; workerOrigin: string; audience: string; serviceAccountEmail: string;
  processUrl: string; dispatchUrl: string;
}
/** Worker identity is fixed by deployment configuration, never by a request body. */
export function readFirebaseWorkerConfig(env: Record<string, string | undefined>): FirebaseWorkerConfig {
  if (env.FIREBASE_TASK_WORKER_ENABLED !== undefined && !['true', 'false'].includes(env.FIREBASE_TASK_WORKER_ENABLED)) throw new Error('Invalid Firebase worker configuration');
  const projectId = env.GCP_PROJECT_ID ?? '', region = env.FIREBASE_TASKS_REGION ?? '', queue = env.FIREBASE_TASKS_QUEUE ?? '';
  const workerOrigin = env.FIREBASE_TASK_WORKER_ORIGIN ?? '', audience = env.FIREBASE_TASK_OIDC_AUDIENCE ?? '', serviceAccountEmail = env.FIREBASE_TASK_DISPATCH_SERVICE_ACCOUNT_EMAIL ?? '';
  let origin: URL, aud: URL;
  try { origin = new URL(workerOrigin); aud = new URL(audience); } catch { throw new Error('Invalid Firebase worker configuration'); }
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(projectId) || !/^[a-z]+-[a-z0-9]+[0-9]$/u.test(region) || !/^[A-Za-z0-9_-]{1,100}$/u.test(queue)
    || origin.protocol !== 'https:' || origin.origin !== workerOrigin || origin.username || origin.password
    || aud.protocol !== 'https:' || aud.username || aud.password || aud.search || aud.hash || aud.href !== audience && aud.origin !== audience
    || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/u.test(serviceAccountEmail)
    || !serviceAccountEmail.endsWith('@' + projectId + '.iam.gserviceaccount.com')) throw new Error('Invalid Firebase worker configuration');
  return { enabled: env.FIREBASE_TASK_WORKER_ENABLED === 'true', projectId, region, queue, workerOrigin, audience, serviceAccountEmail,
    processUrl: workerOrigin + '/internal/task-reminders', dispatchUrl: workerOrigin + '/internal/task-dispatch' };
}

/** Separate production worker assembly; opening it never starts a daemon or initializes authority. */
export async function openFirebaseWorkerRuntime(env: Record<string, string | undefined>) {
  const workerConfig = readFirebaseWorkerConfig(env), runtime = await openFirebaseRuntime(env, { worker: true });
  let delivery: ReturnType<typeof createFirebaseTaskDelivery> | undefined, backgroundDelivery: ReturnType<typeof createFirebaseBackgroundDelivery> | undefined;
  const controller = new AbortController();
  try {
    const { config, database, cipher, authority } = runtime;
    if (config.projectId !== workerConfig.projectId) throw new Error('Invalid Firebase worker configuration');
    const options = { database, cipher, projectId: config.projectId, namespace: config.namespace,
      enabled: workerConfig.enabled, currentAuth: runtime.currentAuth };
    const worker = runtime.reminders;
    delivery = createFirebaseTaskDelivery({ ...workerConfig, workerUrl: workerConfig.processUrl });
    backgroundDelivery = createFirebaseBackgroundDelivery({ ...workerConfig, workerUrl: workerConfig.workerOrigin + '/internal/product-work' });
    const dispatcher = createFirestoreTaskDispatcher({ ...options, delivery });
    const maintenance = createFirestoreBackgroundMaintenance({ ...options, knowledge: runtime.knowledgeRefresh,
      journal: runtime.journal, photos: runtime.photos, erasures: runtime.erasures, cleanup: runtime.erasureCleanup });
    const background = createFirestoreBackgroundQueue({ ...options, readControl: tx => authority.readControl(tx),
      transport: backgroundDelivery, signal: controller.signal,
      async execute(job, signal) {
        if (['knowledge-check', 'photo-cleanup', 'scope-erasure'].includes(job.kind)) return maintenance.process(job, signal);
        const validIdentity = async () => {
          if (signal.aborted) return false;
          const current = await runtime.currentAuth(job.scope.ownerUserId);
          return !current.disabled && current.emailVerified && !!current.email;
        };
        if (!await validIdentity()) return { state: 'stopped' };
        if (job.kind === 'push') return runtime.push.process(job, signal);
        if (job.kind === 'telegram') return runtime.telegram.process(job, signal);
        if (job.kind === 'contact') return runtime.contact.process(job, signal);
        if (job.kind === 'child-change') { await runtime.growth.evaluate(job); return maintenance.childChange(job); }
        if (job.kind === 'document-refresh') return runtime.documents.processRefresh(job);
        if (job.kind === 'work-check') return runtime.product.continuation.check(job);
        const continuation = job.kind === 'work-continuation' ? await authority.runTransaction(job.scope.ownerUserId, job.scope.childId,
          b => runtime.product.continuation.input(b, job)) : null;
        const concern = job.kind === 'concern' ? await runtime.concerns.beginBackground(job) : null;
        const attention = job.kind === 'growth' ? await runtime.growth.backgroundInput(job) : null;
        const task = job.kind === 'task-agent' ? await authority.runTransaction(job.scope.ownerUserId, job.scope.childId,
          b => runtime.taskEvents.input(b, job)) : null;
        if (!['concern', 'growth', 'task-agent', 'work-continuation'].includes(job.kind)) throw new Error('Product background consumer not connected');
        if (!concern && !attention && !task && !continuation) {
          if (job.kind === 'work-continuation') return runtime.product.continuation.finish(job);
          return { state: 'stopped' };
        }
        const reference = firestoreBackgroundReference(job);
        const authorize = async () => await validIdentity() && await authority.runTransaction(job.scope.ownerUserId, job.scope.childId,
          async b => continuation ? !!await runtime.product.continuation.input(b, job) : concern ? runtime.concerns.authorizeBackground(b, job) : task
            ? !!await runtime.taskEvents.input(b, job) && await runtime.growth.taskAllowedIn(b, job.resourceId) : runtime.growth.authorizeBackground(b, job));
        try {
          const result = await runtime.product.agent.background({ userId: job.scope.ownerUserId, childId: job.scope.childId, reference,
            context: continuation ?? (concern ? { eventType: 'concern_followup', concern: concernAgentContext(concern) }
              : task ?? { eventType: 'growth_attention', attention, policy: 'Server-reviewed applicability; no medical rule generation, task execution or external notification' }),
            authorize, signal });
          if (concern) return runtime.concerns.finishBackground(job);
          if (continuation) return runtime.product.continuation.finish(job);
          return { state: result?.status === 'completed' ? 'completed' : result?.status === 'stopped' ? 'stopped' : 'unknown' };
        } catch {
          // Canonical run receipts determine recovery. Never create another run after a lost final response.
          if (concern) return runtime.concerns.finishBackground(job);
          if (continuation) return runtime.product.continuation.finish(job);
          return { state: 'unknown' };
        }
      } });
    const identity = { audience: workerConfig.audience, serviceAccountEmail: workerConfig.serviceAccountEmail };
    const process = createFirebaseTaskHandler({ ...identity, workerUrl: workerConfig.processUrl, process: job => worker.process(job) });
    const productProcess = createFirebaseBackgroundHandler({ ...identity, workerUrl: workerConfig.workerOrigin + '/internal/product-work', process: job => background.process(job) });
    const dispatch = createFirebaseTaskDispatchHandler({ ...identity, workerUrl: workerConfig.dispatchUrl, async dispatch() {
      await maintenance.tick();
      const page = await dispatcher.dispatchScheduled(), products = await background.dispatch();
      return { ...page, scanned: page.scanned + products.scanned, confirmed: page.confirmed + products.confirmed,
        unknown: page.unknown + products.unresolved };
    } });
    const handler = (request: Request) => {
      const path = new URL(request.url).pathname;
      return path === '/internal/task-reminders' ? process(request) : path === '/internal/task-dispatch' ? dispatch(request)
        : path === '/internal/product-work' ? productProcess(request)
        : Promise.resolve(Response.json({ state: 'rejected' }, { status: 404, headers: { 'Cache-Control': 'no-store' } }));
    };
    const ownedDelivery = delivery, ownedBackground = backgroundDelivery;
    let closing: Promise<void> | undefined;
    return { ...runtime, workerConfig, worker, dispatcher, background, maintenance, handler, read: { view: worker.view },
      abort: () => controller.abort(),
      close() { controller.abort(); return closing ??= (async () => {
        const closed = await Promise.allSettled([ownedDelivery.close(), ownedBackground.close(), runtime.close()]);
        if (closed.some(result => result.status === 'rejected')) throw new Error('Firebase worker shutdown unavailable');
      })(); } };
  } catch (error) {
    controller.abort(); await Promise.allSettled([delivery?.close(), backgroundDelivery?.close(), runtime.close()]); throw error;
  }
}
