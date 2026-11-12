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
