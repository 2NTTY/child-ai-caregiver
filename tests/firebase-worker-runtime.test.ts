import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFirebaseWorkerConfig } from '../server/firebase-worker-runtime.ts';
import { createFirebaseWorkerNodeHandler } from '../server/firebase-worker-main.ts';

const env = { GCP_PROJECT_ID: 'synthetic-task-project', FIREBASE_TASKS_REGION: 'asia-east2', FIREBASE_TASKS_QUEUE: 'f02-reminders',
  FIREBASE_TASK_WORKER_ORIGIN: 'https://worker.example.invalid', FIREBASE_TASK_OIDC_AUDIENCE: 'https://worker.example.invalid',
  FIREBASE_TASK_DISPATCH_SERVICE_ACCOUNT_EMAIL: 'f02-tasks@synthetic-task-project.iam.gserviceaccount.com' };
test('worker enablement defaults false and fixed deployment identities reject missing or malformed configuration', () => {
  const config = readFirebaseWorkerConfig(env); assert.equal(config.enabled, false); assert.equal(config.processUrl, env.FIREBASE_TASK_WORKER_ORIGIN + '/internal/task-reminders');
  assert.equal(config.dispatchUrl, env.FIREBASE_TASK_WORKER_ORIGIN + '/internal/task-dispatch'); assert.equal(readFirebaseWorkerConfig({ ...env, FIREBASE_TASK_WORKER_ENABLED: 'true' }).enabled, true);
  for (const changed of [{ FIREBASE_TASK_WORKER_ENABLED: '1' }, { FIREBASE_TASK_WORKER_ORIGIN: 'http://worker.example.invalid' },
    { FIREBASE_TASKS_QUEUE: 'escape/path' }, { FIREBASE_TASK_OIDC_AUDIENCE: env.FIREBASE_TASK_OIDC_AUDIENCE + '?caller=1' },
    { FIREBASE_TASK_DISPATCH_SERVICE_ACCOUNT_EMAIL: 'f02-tasks@foreign-project.iam.gserviceaccount.com' }, { FIREBASE_TASKS_REGION: undefined }]) {
    assert.throws(() => readFirebaseWorkerConfig({ ...env, ...changed }), /Invalid Firebase worker configuration/u);
  }
});

test('the Node adapter caps a request at 4 KiB and allows only fixed OIDC POST paths without requiring Origin', async () => {
  let calls = 0;
  const handler = createFirebaseWorkerNodeHandler({ workerOrigin: env.FIREBASE_TASK_WORKER_ORIGIN, async handler(request) {
    calls++; assert.equal(request.headers.get('origin'), null); assert.equal(await request.text(), '{}'); return Response.json({ state: 'dispatched' });
  } });
  async function invoke(body = '{}', method = 'POST', url = '/internal/task-dispatch') {
    const request = Readable.from([Buffer.from(body)]) as unknown as IncomingMessage; request.method = method; request.url = url;
    request.headers = { 'content-type': 'application/json', authorization: 'Bearer synthetic.jwt.signature' };
    const result = { status: 0, body: '' };
    const response = { statusCode: 200, headersSent: false, destroyed: false, setHeader() {}, end(this: Pick<ServerResponse, 'statusCode'>, value: Buffer) { result.status = this.statusCode; result.body = value.toString('utf8'); }, destroy() {} } as unknown as ServerResponse;
    await handler(request, response); return result;
  }
  const health = await invoke("", "GET", "/healthz");
  assert.equal(health.status, 200); assert.equal(calls, 0);
  assert.deepEqual(JSON.parse(health.body), { status: "ok", service: "firebase-worker" });
  assert.equal((await invoke()).status, 200); assert.equal(calls, 1);
  assert.equal((await invoke('x'.repeat(4097))).status, 413); assert.equal((await invoke('{}', 'GET')).status, 405);
  assert.equal((await invoke('{}', 'POST', '/internal/task-dispatch?caller=1')).status, 404); assert.equal(calls, 1);
});
