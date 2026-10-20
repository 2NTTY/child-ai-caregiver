import { createFirebaseWorkerServices } from './firebase-worker-services.ts';
import { openFirebaseRuntime } from './firebase-runtime.ts';
import { createFirebaseTaskDelivery, createFirebaseTaskDispatchHandler, createFirebaseTaskHandler,
  createFirebaseBackgroundDelivery, createFirebaseBackgroundHandler } from './firebase-task-delivery.ts';

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
    const { config } = runtime;
    if (config.projectId !== workerConfig.projectId) throw new Error('Invalid Firebase worker configuration');
    delivery = createFirebaseTaskDelivery({ ...workerConfig, workerUrl: workerConfig.processUrl });
    backgroundDelivery = createFirebaseBackgroundDelivery({ ...workerConfig, workerUrl: workerConfig.workerOrigin + '/internal/product-work' });
    const { worker, dispatcher, maintenance, background } = createFirebaseWorkerServices(runtime, delivery, backgroundDelivery, controller);
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
