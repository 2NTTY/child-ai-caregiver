import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { EventEmitter } from 'node:events';
import { createFirebaseNodeHandler } from '../server/firebase-http.ts';

const origin = 'https://synthetic.example.test';
async function invoke(input: { method?: string; path?: string; origin?: string; body?: string; length?: string; userId?: string; expectedUserId?: string }) {
  const request = new IncomingMessage(new Socket()); request.url = input.path ?? '/api/auth/session'; request.method = input.method ?? 'POST';
  request.headers = { 'content-type': 'application/json', ...(input.origin ? { origin: input.origin } : {}),
    ...(input.length ? { 'content-length': input.length } : {}),
    ...(input.expectedUserId ? { 'x-expected-user-id': input.expectedUserId } : {}) };
  const response = Object.assign(new EventEmitter(), { statusCode: 200, headersSent: false, destroyed: false, writableEnded: false,
    headers: new Map<string, string | string[]>(), body: Buffer.alloc(0),
    setHeader(key: string, value: string | string[]) { this.headers.set(key, value); },
    end(body: Buffer) { this.body = Buffer.from(body); this.writableEnded = true; }, destroy() { this.destroyed = true; } });
  const received: Request[] = [];
  const handler = createFirebaseNodeHandler({ publicOrigin: origin, auth: { fromNodeHeaders(headers) {
    const result = new Headers(); for (const [key, value] of Object.entries(headers)) if (typeof value === 'string') result.set(key, value); return result;
  }, async getSession() { return input.userId ? { user: { id: input.userId } } : null; } }, async handler(value) { received.push(value); return Response.json({ body: await value.text() },
    { headers: { 'set-cookie': '__session=synthetic; HttpOnly; Secure; SameSite=Lax' } }); } });
  const done = handler(request, response as unknown as ServerResponse);
  request.push(input.body ?? '{}'); request.push(null); await done;
  return { response, received, result: JSON.parse(response.body.toString()) };
}
test('Node transport rejects cross-origin changes and absolute request targets before identity or business handlers', async () => {
  for (const input of [{}, { origin: 'https://other.example.test' }, { origin, path: '//other.example.test/api/account' }]) {
    const r = await invoke(input); assert.equal(r.received.length, 0); assert.ok([400, 403].includes(r.response.statusCode));
  }
});
test('Node transport bounds declared and streamed bodies and rejects unsupported methods', async () => {
  for (const input of [{ origin, length: '65537' }, { origin, body: 'x'.repeat(65537) }]) {
    const r = await invoke(input); assert.equal(r.response.statusCode, 413); assert.equal(r.received.length, 0);
  }
  const r = await invoke({ origin, method: 'PUT' }); assert.equal(r.response.statusCode, 405); assert.equal(r.received.length, 0);
});
test('Node transport preserves cookie and JSON payload without enabling shared caching', async () => {
  const r = await invoke({ origin, body: JSON.stringify({ idToken: 'synthetic-token' }) });
  assert.equal(r.response.statusCode, 200); assert.equal(r.result.body, '{"idToken":"synthetic-token"}');
  assert.deepEqual(r.response.headers.get('set-cookie'), ['__session=synthetic; HttpOnly; Secure; SameSite=Lax']);
  assert.equal(r.response.headers.get('cache-control'), 'private, no-store');
});

test('large photo and document bodies require identity before buffering and keep unrelated routes bounded', async () => {
  const photo = '/api/children/11111111-1111-4111-8111-111111111111/photos/22222222-2222-4222-8222-222222222222/content';
  const document = '/api/children/11111111-1111-4111-8111-111111111111/documents/33333333-3333-4333-8333-333333333333/actions';
  for (const path of [photo, document]) {
    const denied = await invoke({ origin, path, body: 'x'.repeat(80000) });
    assert.equal(denied.response.statusCode, 401); assert.equal(denied.received.length, 0);
    const changed = await invoke({ origin, path, userId: 'owner', expectedUserId: 'other' });
    assert.equal(changed.response.statusCode, 409); assert.equal(changed.received.length, 0);
    const allowed = await invoke({ origin, path, userId: 'owner', expectedUserId: 'owner', body: 'x'.repeat(80000) });
    assert.equal(allowed.response.statusCode, 200); assert.equal(allowed.result.body.length, 80000);
  }
  const oversized = await invoke({ origin, path: photo, userId: 'owner', expectedUserId: 'owner', length: String(6 * 1024 * 1024 + 1) });
  assert.equal(oversized.response.statusCode, 413); assert.equal(oversized.received.length, 0);
  const unrelated = await invoke({ origin, path: '/api/online/submit', userId: 'owner', expectedUserId: 'owner', body: 'x'.repeat(80000) });
  assert.equal(unrelated.response.statusCode, 413);
});


test('disconnect during identity preflight releases both large-body slots', async () => {
  const gates: Array<() => void> = []; let businessCalls = 0;
  const handler = createFirebaseNodeHandler({ publicOrigin: origin, auth: {
    fromNodeHeaders() { return new Headers({ origin, 'x-expected-user-id': 'owner' }); },
    async getSession() { await new Promise<void>(resolve => gates.push(resolve)); return { user: { id: 'owner' } }; }
  }, async handler() { businessCalls++; return Response.json({ ok: true }); } });
  function start() {
    const request = new IncomingMessage(new Socket()); request.method = 'POST';
    request.url = '/api/children/11111111-1111-4111-8111-111111111111/photos/22222222-2222-4222-8222-222222222222/content';
    const response = Object.assign(new EventEmitter(), { statusCode: 200, headersSent: false, destroyed: false, writableEnded: false,
      setHeader() {}, end() { this.writableEnded = true; }, destroy() { this.destroyed = true; } });
    const done = handler(request, response as unknown as ServerResponse);
    return { request, response, done };
  }
  const first = start(), second = start(); assert.equal(gates.length, 2);
  for (const value of [first, second]) {
    value.request.destroy(); value.response.destroyed = true; value.response.emit('close');
  }
  const disconnectedGates = gates.splice(0);
  const completed = await Promise.race([Promise.all([first.done, second.done]).then(() => true),
    new Promise<boolean>(resolve => setTimeout(() => resolve(false), 200))]);
  disconnectedGates.forEach(resolve => resolve());
  assert.equal(completed, true, 'aborted requests must release capacity without waiting for identity lookup');
  assert.equal(businessCalls, 0);
  const next = start(); assert.equal(gates.length, 1, 'capacity is available for the next authenticated upload');
  gates.shift()!(); next.request.push('{}'); next.request.push(null); await next.done;
  assert.equal(next.response.statusCode, 200); assert.equal(businessCalls, 1);
});
