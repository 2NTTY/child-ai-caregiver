import { CloudTasksClient, protos } from '@google-cloud/tasks';
import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import { canonicalJson } from './online-routing.ts';
import { firestoreDomainHash, domainParse } from './firestore-domain-data.ts';
import { firestoreTaskDeliverySchema, type FirestoreTaskDelivery, type FirestoreTaskResult } from './firestore-task-worker.ts';

type Task = protos.google.cloud.tasks.v2.ITask;
export interface FirebaseTasksTransport {
  create(request: protos.google.cloud.tasks.v2.ICreateTaskRequest): Promise<Task>;
  get(request: protos.google.cloud.tasks.v2.IGetTaskRequest): Promise<Task>;
}
export interface FirebaseTaskDeliveryOptions {
  projectId: string; region: string; queue: string; workerUrl: string; serviceAccountEmail: string; audience: string;
  transport?: FirebaseTasksTransport;
}
export interface FirebaseTaskDeliveryResult { state: 'confirmed' | 'unknown' | 'conflict'; taskName: string }
export interface FirebaseTaskOidcVerifier {
  verifyIdToken(options: { idToken: string; audience: string }): Promise<{ getPayload(): TokenPayload | undefined }>;
}
export interface FirebaseTaskHandlerOptions {
  workerUrl: string; audience: string; serviceAccountEmail: string; issuer?: 'https://accounts.google.com' | 'accounts.google.com';
  verifier?: FirebaseTaskOidcVerifier;
  process(job: FirestoreTaskDelivery): Promise<FirestoreTaskResult>;
}
export interface FirebaseTaskDispatchHandlerOptions extends Omit<FirebaseTaskHandlerOptions, 'process'> {
  dispatch(): Promise<{ state: 'dispatched' | 'disabled'; confirmed: number; unknown: number; needsAttention: number; busy: number;
    rejected: number; skipped: number; scanned: number; hasMore: boolean; nextCursor: string | null }>;
}
const BODY_LIMIT = 4096, DISPATCH_SECONDS = 60;
export class FirebaseTaskDeliveryError extends Error {
  constructor() { super('Firebase task delivery configuration or input rejected'); this.name = 'FirebaseTaskDeliveryError'; }
}
function secureUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new FirebaseTaskDeliveryError(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.href !== value && url.origin !== value) throw new FirebaseTaskDeliveryError();
  return url;
}
function accountEmail(value: string) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/u.test(value)) throw new FirebaseTaskDeliveryError();
}
function taskBody(body: unknown): Buffer | null {
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === 'string') {
    const bytes = Buffer.from(body, 'base64'); if (bytes.toString('base64') === body) return bytes;
  }
  return null;
}

/** Native Cloud Tasks transport only wakes the database consumer; deduplication remains in its Firestore transaction. */
export function createFirebaseTaskDelivery(options: FirebaseTaskDeliveryOptions) {
  const target = secureUrl(options.workerUrl); secureUrl(options.audience); accountEmail(options.serviceAccountEmail);
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u.test(options.projectId) || !/^[a-z]+-[a-z0-9]+[0-9]$/u.test(options.region)
    || !/^[A-Za-z0-9_-]{1,100}$/u.test(options.queue) || !options.serviceAccountEmail.endsWith('@' + options.projectId + '.iam.gserviceaccount.com')) throw new FirebaseTaskDeliveryError();
  const parent = `projects/${options.projectId}/locations/${options.region}/queues/${options.queue}`;
  const client = options.transport ? null : new CloudTasksClient({ projectId: options.projectId });
  const transport: FirebaseTasksTransport = options.transport ?? {
    create: async request => (await client!.createTask(request, { timeout: 10_000, retry: null }))[0],
    get: async request => (await client!.getTask(request, { timeout: 10_000, retry: null }))[0],
  };
  function definition(raw: FirestoreTaskDelivery) {
    const job = domainParse(firestoreTaskDeliverySchema, raw), body = Buffer.from(canonicalJson(job));
    if (body.length > BODY_LIMIT) throw new FirebaseTaskDeliveryError();
    const fingerprint = firestoreDomainHash({ job, target: target.href, audience: options.audience, serviceAccountEmail: options.serviceAccountEmail });
    const taskName = parent + '/tasks/reminder-' + fingerprint;
    const milliseconds = Date.parse(job.scheduledAt);
    const task: Task = { name: taskName, scheduleTime: { seconds: Math.floor(milliseconds / 1000), nanos: milliseconds % 1000 * 1_000_000 },
      dispatchDeadline: { seconds: DISPATCH_SECONDS }, httpRequest: { httpMethod: 'POST', url: target.href,
        headers: { 'Content-Type': 'application/json', 'X-Yuban-Work-Fingerprint': fingerprint }, body,
        oidcToken: { serviceAccountEmail: options.serviceAccountEmail, audience: options.audience } } };
    return { task, taskName, body, fingerprint };
  }
  function matches(actual: Task, expected: ReturnType<typeof definition>) {
    const request = actual?.httpRequest, body = taskBody(request?.body);
    return actual?.name === expected.taskName && request?.url === target.href
      && (request.httpMethod === 'POST' || request.httpMethod === protos.google.cloud.tasks.v2.HttpMethod.POST)
      && request.oidcToken?.serviceAccountEmail === options.serviceAccountEmail && request.oidcToken.audience === options.audience
      && !request.oauthToken && !actual.appEngineHttpRequest && Number(actual.dispatchDeadline?.seconds) === DISPATCH_SECONDS
      && new Headers(request.headers as Record<string, string>).get('x-yuban-work-fingerprint') === expected.fingerprint
      && body !== null && body.length <= BODY_LIMIT && body.equals(expected.body);
  }
  return {
    taskName: (job: FirestoreTaskDelivery) => definition(job).taskName,
    async enqueue(job: FirestoreTaskDelivery): Promise<FirebaseTaskDeliveryResult> {
      const expected = definition(job);
      try {
        const created = await transport.create({ parent, task: expected.task, responseView: 'FULL' });
        return { state: matches(created, expected) ? 'confirmed' : 'conflict', taskName: expected.taskName };
      } catch {
        // ALREADY_EXISTS and uncertain create replies use the original name; a missing task is not evidence to create a new one.
        try {
          const original = await transport.get({ name: expected.taskName, responseView: 'FULL' });
          return { state: matches(original, expected) ? 'confirmed' : 'conflict', taskName: expected.taskName };
        } catch { return { state: 'unknown', taskName: expected.taskName }; }
      }
    },
    async probe(job: FirestoreTaskDelivery): Promise<FirebaseTaskDeliveryResult> {
      const expected = definition(job);
      try {
        const original = await transport.get({ name: expected.taskName, responseView: 'FULL' });
        return { state: matches(original, expected) ? 'confirmed' : 'conflict', taskName: expected.taskName };
      } catch { return { state: 'unknown', taskName: expected.taskName }; }
    },
    close: async () => { await client?.close(); },
  };
}

async function boundedJson(request: Request): Promise<unknown> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(request.headers.get('content-type') ?? '')) throw new FirebaseTaskDeliveryError();
  const length = request.headers.get('content-length');
  if (length !== null && (!/^[0-9]+$/u.test(length) || Number(length) > BODY_LIMIT)) throw new FirebaseTaskDeliveryError();
  const reader = request.body?.getReader(); if (!reader) throw new FirebaseTaskDeliveryError();
  const parts: Uint8Array[] = []; let bytes = 0;
  try {
    while (true) {
      const read = await reader.read(); if (read.done) break;
      bytes += read.value.length; if (bytes > BODY_LIMIT) { await reader.cancel(); throw new FirebaseTaskDeliveryError(); }
      parts.push(read.value);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts)));
  } catch { throw new FirebaseTaskDeliveryError(); }
  finally { reader.releaseLock(); }
}
const response = (status: number, state: string) => Response.json({ state }, { status, headers: { 'Cache-Control': 'no-store' } });
async function authenticateTaskRequest(request: Request, target: URL, options: Pick<FirebaseTaskHandlerOptions, 'audience' | 'serviceAccountEmail'>,
  issuer: string, verifier: FirebaseTaskOidcVerifier): Promise<Response | null> {
  let url: URL; try { url = new URL(request.url); } catch { return response(404, 'rejected'); }
  if (url.pathname !== target.pathname || url.search || request.method !== 'POST') return response(request.method !== 'POST' ? 405 : 404, 'rejected');
  const authorization = request.headers.get('authorization');
  if (!authorization || !/^Bearer [A-Za-z0-9._~-]{1,8192}$/u.test(authorization)) return response(403, 'rejected');
  try {
    const ticket = await verifier.verifyIdToken({ idToken: authorization.slice(7), audience: options.audience }), claims = ticket.getPayload();
    if (!claims || claims.aud !== options.audience || claims.iss !== issuer || claims.email !== options.serviceAccountEmail || claims.email_verified !== true) return response(403, 'rejected');
  } catch { return response(403, 'rejected'); }
  return null;
}

/** Cloud Run IAM is an additional deployment gate. No X-CloudTasks header is authentication evidence. */
export function createFirebaseTaskHandler(options: FirebaseTaskHandlerOptions): (request: Request) => Promise<Response> {
  const target = secureUrl(options.workerUrl); secureUrl(options.audience); accountEmail(options.serviceAccountEmail);
  const issuer = options.issuer ?? 'https://accounts.google.com';
  if (!['https://accounts.google.com', 'accounts.google.com'].includes(issuer) || typeof options.process !== 'function') throw new FirebaseTaskDeliveryError();
  const verifier = options.verifier ?? new OAuth2Client();
  return async request => {
    const denied = await authenticateTaskRequest(request, target, options, issuer, verifier); if (denied) return denied;
    let job: FirestoreTaskDelivery;
    try { job = domainParse(firestoreTaskDeliverySchema, await boundedJson(request)); }
    catch { return response(400, 'rejected'); }
    try {
      const result = await options.process(job);
      return response(result.state === 'busy' ? 503 : 200, result.state);
    } catch (error) {
      // Revoked identities/scope cannot be retried into an effect. Infrastructure failures keep the original Cloud Task retryable.
      const status = error !== null && typeof error === 'object' && 'status' in error ? error.status : null;
      return status === 403 || status === 409 || status === 404 ? response(200, 'stopped') : response(503, 'unavailable');
    }
  };
}

/** A scheduler invokes one bounded page. Empty JSON grants no caller-supplied routing or identity. */
export function createFirebaseTaskDispatchHandler(options: FirebaseTaskDispatchHandlerOptions): (request: Request) => Promise<Response> {
  const target = secureUrl(options.workerUrl); secureUrl(options.audience); accountEmail(options.serviceAccountEmail);
  const issuer = options.issuer ?? 'https://accounts.google.com';
  if (!['https://accounts.google.com', 'accounts.google.com'].includes(issuer) || typeof options.dispatch !== 'function') throw new FirebaseTaskDeliveryError();
  const verifier = options.verifier ?? new OAuth2Client();
  return async request => {
    const denied = await authenticateTaskRequest(request, target, options, issuer, verifier); if (denied) return denied;
    try {
      const body = await boundedJson(request);
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 0) return response(400, 'rejected');
    } catch { return response(400, 'rejected'); }
    try {
      const page = await options.dispatch();
      const state = page.state === 'disabled' ? 'disabled' : page.needsAttention > 0 ? 'needs_attention' : page.unknown > 0 || page.busy > 0 ? 'unresolved' : 'dispatched';
      return Response.json({ state, scanned: page.scanned, confirmed: page.confirmed, unknown: page.unknown, needsAttention: page.needsAttention,
        rejected: page.rejected, skipped: page.skipped, hasMore: page.hasMore, nextCursor: page.nextCursor },
        { status: page.unknown > 0 || page.busy > 0 ? 503 : 200, headers: { 'Cache-Control': 'no-store' } });
    } catch { return response(503, 'unavailable'); }
  };
}
