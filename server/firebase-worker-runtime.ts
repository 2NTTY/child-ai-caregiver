import { createFirebaseWorkerServices } from './firebase-worker-services.ts';
import { openFirebaseRuntime } from './firebase-runtime.ts';
import { createFirebaseTaskDelivery, createFirebaseTaskDispatchHandler, createFirebaseTaskHandler,
  createFirebaseBackgroundDelivery, createFirebaseBackgroundHandler } from './firebase-task-delivery.ts';

import { readFirebaseWorkerConfig } from './firebase-worker-config.ts';
export { readFirebaseWorkerConfig, type FirebaseWorkerConfig } from './firebase-worker-config.ts';

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
