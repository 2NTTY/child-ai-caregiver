import { applicationDefault, deleteApp, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { randomUUID } from 'node:crypto';
import { openFirebasePersistence } from './firebase-persistence.ts';
import { createFirestoreTaskWorker } from './firestore-task-worker.ts';
import { createFirestoreTaskDispatcher } from './firestore-task-dispatcher.ts';
import { createFirebaseTaskDelivery, createFirebaseTaskDispatchHandler, createFirebaseTaskHandler } from './firebase-task-delivery.ts';

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
  const workerConfig = readFirebaseWorkerConfig(env), persistence = await openFirebasePersistence(env);
  let app: ReturnType<typeof initializeApp> | undefined, delivery: ReturnType<typeof createFirebaseTaskDelivery> | undefined;
  try {
    const { config, database, cipher } = persistence;
    if (config.projectId !== workerConfig.projectId) throw new Error('Invalid Firebase worker configuration');
    app = initializeApp({ projectId: config.projectId, credential: applicationDefault() }, 'yuban-worker-' + randomUUID());
    const auth = getAuth(app), options = { database, cipher, projectId: config.projectId, namespace: config.namespace, enabled: workerConfig.enabled,
      async currentAuth(userId: string) {
        try {
          const user = await auth.getUser(userId);
          return { userId: user.uid, disabled: user.disabled, emailVerified: user.emailVerified, email: user.email ?? null };
        } catch (error) {
          const code = error !== null && typeof error === 'object' && 'code' in error ? error.code : null;
          if (code === 'auth/user-not-found' || code === 'auth/user-disabled') return { userId, disabled: true, emailVerified: false, email: null };
          throw new Error('Firebase worker identity unavailable');
        }
      } };
    const worker = createFirestoreTaskWorker(options);
    delivery = createFirebaseTaskDelivery({ ...workerConfig, workerUrl: workerConfig.processUrl });
    const dispatcher = createFirestoreTaskDispatcher({ ...options, delivery });
    const identity = { audience: workerConfig.audience, serviceAccountEmail: workerConfig.serviceAccountEmail };
    const process = createFirebaseTaskHandler({ ...identity, workerUrl: workerConfig.processUrl, process: job => worker.process(job) });
    const dispatch = createFirebaseTaskDispatchHandler({ ...identity, workerUrl: workerConfig.dispatchUrl, dispatch: () => dispatcher.dispatchScheduled() });
    const handler = (request: Request) => {
      const path = new URL(request.url).pathname;
      return path === '/internal/task-reminders' ? process(request) : path === '/internal/task-dispatch' ? dispatch(request)
        : Promise.resolve(Response.json({ state: 'rejected' }, { status: 404, headers: { 'Cache-Control': 'no-store' } }));
    };
    const ownedApp = app, ownedDelivery = delivery;
    let closing: Promise<void> | undefined;
    return { ...persistence, workerConfig, worker, dispatcher, handler, read: { view: worker.view },
      close() { return closing ??= (async () => {
        const closed = await Promise.allSettled([ownedDelivery.close(), deleteApp(ownedApp), persistence.close()]);
        if (closed.some(result => result.status === 'rejected')) throw new Error('Firebase worker shutdown unavailable');
      })(); } };
  } catch (error) {
    await Promise.allSettled([delivery?.close(), app ? deleteApp(app) : undefined, persistence.close()]);
    throw error;
  }
}
