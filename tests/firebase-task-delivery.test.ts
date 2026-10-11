import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { TokenPayload } from 'google-auth-library';
import type { protos } from '@google-cloud/tasks';
import { createFirebaseTaskDelivery, createFirebaseTaskDispatchHandler, createFirebaseTaskHandler, FirebaseTaskDeliveryError, type FirebaseTasksTransport } from '../server/firebase-task-delivery.ts';
import type { FirestoreTaskDelivery } from '../server/firestore-task-worker.ts';

type Task = protos.google.cloud.tasks.v2.ITask;
const config = { projectId: 'synthetic-task-project', region: 'asia-east2', queue: 'f02-reminders', workerUrl: 'https://worker.example.invalid/internal/task-reminders',
  audience: 'https://worker.example.invalid', serviceAccountEmail: 'f02-tasks@synthetic-task-project.iam.gserviceaccount.com' };
const job = (): FirestoreTaskDelivery => ({ kind: 'task-reminder', scope: { ownerUserId: 'synthetic-owner', workspaceId: randomUUID(), childId: randomUUID(), storageEpoch: randomUUID() },
  taskId: randomUUID(), occurrenceId: randomUUID(), taskVersion: 1, authorizationVersion: '1', generation: randomUUID(), scheduledAt: '2026-10-11T04:00:00.000Z' });

test('Cloud Tasks names, target, OIDC identity and minimal payload are fixed and lost replies recover only the original task', async () => {
  const input = job(); let creates = 0, gets = 0, original: Task | undefined, storedName = '';
  const transport: FirebaseTasksTransport = {
    async create(request) {
      creates++; assert.equal(request.parent, 'projects/synthetic-task-project/locations/asia-east2/queues/f02-reminders'); assert.equal(request.responseView, 'FULL');
      original = request.task!; storedName = original.name!;
      assert.equal(original.httpRequest?.url, config.workerUrl); assert.equal(original.httpRequest?.httpMethod, 'POST');
      assert.deepEqual(original.httpRequest?.oidcToken, { serviceAccountEmail: config.serviceAccountEmail, audience: config.audience });
      assert.equal(original.dispatchDeadline?.seconds, 60);
      assert.deepEqual(JSON.parse(Buffer.from(original.httpRequest!.body as Uint8Array).toString('utf8')), input);
      throw { code: 4, message: 'Private lost reply detail' };
    },
    async get(request) { gets++; assert.equal(request.name, storedName); assert.equal(request.responseView, 'FULL'); return original!; },
  };
  const delivery = createFirebaseTaskDelivery({ ...config, transport }), first = await delivery.enqueue(input);
  assert.equal(first.state, 'confirmed'); assert.equal(first.taskName, delivery.taskName(input)); assert.equal(creates, 1); assert.equal(gets, 1);
  transport.create = async () => { creates++; throw { code: 6 }; };
  assert.deepEqual(await delivery.enqueue(input), first); assert.equal(creates, 2); assert.equal(gets, 2);
  assert.deepEqual(await delivery.probe(input), first); assert.equal(creates, 2); assert.equal(gets, 3);
  assert.notEqual(delivery.taskName({ ...input, scheduledAt: '2026-10-12T04:00:00.000Z' }), first.taskName);
  await delivery.close();
});

test('dispatch requires the same strict OIDC identity and only empty bounded JSON without a browser Origin', async () => {
  const dispatchUrl = 'https://worker.example.invalid/internal/task-dispatch'; let calls = 0, verified = true;
  const handler = createFirebaseTaskDispatchHandler({ ...config, workerUrl: dispatchUrl,
    verifier: { async verifyIdToken(options) { assert.equal(options.audience, config.audience); return { getPayload: () => ({
      aud: config.audience, iss: 'https://accounts.google.com', email: config.serviceAccountEmail, email_verified: verified } as TokenPayload) }; } },
    async dispatch() { calls++; return { state: 'dispatched', scanned: 1, confirmed: 0, unknown: 0, needsAttention: 1, busy: 0, rejected: 0, skipped: 0, hasMore: false, nextCursor: null }; } });
  const headers = { 'content-type': 'application/json', authorization: 'Bearer synthetic.jwt.signature' };
  const request = (body = '{}', options: RequestInit = {}) => new Request(dispatchUrl, { method: 'POST', headers, body, ...options });
  assert.equal((await handler(request('{}', { headers: { 'content-type': 'application/json', 'X-CloudTasks-TaskName': 'forged' } }))).status, 403);
  verified = false; assert.equal((await handler(request())).status, 403); verified = true;
  for (const body of ['[]', '{"scope":"caller"}', 'x'.repeat(4097)]) assert.equal((await handler(request(body))).status, 400);
  assert.equal((await handler(new Request(dispatchUrl, { method: 'GET', headers }))).status, 405); assert.equal(calls, 0);
  const accepted = await handler(request()); assert.equal(accepted.status, 200); assert.equal((await accepted.json()).state, 'needs_attention'); assert.equal(calls, 1);
});

test('existing task fingerprint conflicts and unavailable metadata do not invent another task identity', async () => {
  const input = job(); let original: Task, creates = 0;
  const transport: FirebaseTasksTransport = {
    async create(request) { creates++; original = request.task!; throw { code: 6 }; },
    async get() { return { ...original, httpRequest: { ...original.httpRequest, body: Buffer.from('{}') } }; },
  };
  const delivery = createFirebaseTaskDelivery({ ...config, transport });
  assert.equal((await delivery.enqueue(input)).state, 'conflict'); assert.equal(creates, 1);
  transport.get = async () => { throw { code: 5, message: 'Private missing task metadata' }; };
  const unknown = await delivery.enqueue(input); assert.equal(unknown.state, 'unknown'); assert.equal(unknown.taskName, delivery.taskName(input)); assert.equal(creates, 2);
  for (const changed of [{ workerUrl: 'http://worker.example.invalid/internal/task-reminders' }, { projectId: 'other-project' }, { queue: 'queue/escape' },
    { serviceAccountEmail: 'caller@example.invalid' }, { audience: config.audience + '?caller=1' }]) assert.throws(() => createFirebaseTaskDelivery({ ...config, transport, ...changed }), FirebaseTaskDeliveryError);
});

test('the HTTP handler requires verified fixed OIDC claims and never trusts Cloud Tasks headers', async () => {
  const input = job(), claims = { aud: config.audience, iss: 'https://accounts.google.com', email: config.serviceAccountEmail, email_verified: true } as TokenPayload;
  let payload: TokenPayload | undefined = claims, verifies = 0, processes = 0;
  const handler = createFirebaseTaskHandler({ ...config, verifier: { async verifyIdToken(options) {
    verifies++; assert.equal(options.idToken, 'synthetic.jwt.signature'); assert.equal(options.audience, config.audience); return { getPayload: () => payload };
  } }, async process(value) { processes++; assert.deepEqual(value, input); return { state: 'processed', receipt: null, nextAt: null }; } });
  const request = (overrides: RequestInit = {}) => new Request(config.workerUrl, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer synthetic.jwt.signature' }, body: JSON.stringify(input), ...overrides });
  const forged = await handler(request({ headers: { 'content-type': 'application/json', 'X-CloudTasks-TaskName': 'forged', 'X-CloudTasks-QueueName': config.queue } }));
  assert.equal(forged.status, 403); assert.equal(verifies, 0); assert.equal(processes, 0);
  for (const changed of [{ email: 'other@synthetic-task-project.iam.gserviceaccount.com' }, { aud: 'https://foreign.invalid' },
    { iss: 'https://foreign.invalid' }, { email_verified: false }]) {
    payload = { ...claims, ...changed }; assert.equal((await handler(request())).status, 403);
  }
  payload = undefined; assert.equal((await handler(request())).status, 403); assert.equal(processes, 0);
  payload = claims; const accepted = await handler(request()); assert.equal(accepted.status, 200); assert.deepEqual(await accepted.json(), { state: 'processed' }); assert.equal(processes, 1);
});

test('method, fixed path, body cap and sanitized worker failures preserve the original retry semantics', async () => {
  const input = job(); let processes = 0, next: 'busy' | 'failed' | 'error' | 'denied' = 'busy';
  const handler = createFirebaseTaskHandler({ ...config, verifier: { async verifyIdToken() { return { getPayload: () => ({
    aud: config.audience, iss: 'https://accounts.google.com', email: config.serviceAccountEmail, email_verified: true } as TokenPayload) }; } },
    async process() { processes++; if (next === 'error') throw Error('Private payload or credential'); if (next === 'denied') throw { status: 403, message: 'Private account' };
      return { state: next, receipt: null, nextAt: null }; } });
  const headers = { 'content-type': 'application/json', authorization: 'Bearer synthetic.jwt.signature' };
  const request = (body = JSON.stringify(input)) => new Request(config.workerUrl, { method: 'POST', headers, body });
  assert.equal((await handler(new Request(config.workerUrl, { method: 'GET', headers }))).status, 405);
  assert.equal((await handler(new Request('https://worker.example.invalid/other', { method: 'POST', headers, body: '{}' }))).status, 404);
  assert.equal((await handler(request('x'.repeat(4097)))).status, 400); assert.equal((await handler(request(JSON.stringify({ ...input, privateBody: 'not allowed' })))).status, 400); assert.equal(processes, 0);
  assert.equal((await handler(request())).status, 503); next = 'failed'; assert.equal((await handler(request())).status, 200);
  next = 'error'; const failed = await handler(request()); assert.equal(failed.status, 503); assert.deepEqual(await failed.json(), { state: 'unavailable' });
  next = 'denied'; const denied = await handler(request()); assert.equal(denied.status, 200); assert.deepEqual(await denied.json(), { state: 'stopped' });
});
