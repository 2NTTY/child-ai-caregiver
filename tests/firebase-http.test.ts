import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { EventEmitter } from 'node:events';
import { createFirebaseNodeHandler } from '../server/firebase-http.ts';

const origin = 'https://synthetic.example.test';
async function invoke(input: { method?: string; path?: string; origin?: string; body?: string; length?: string }) {
  const request = new IncomingMessage(new Socket()); request.url = input.path ?? '/api/auth/session'; request.method = input.method ?? 'POST';
  request.headers = { 'content-type': 'application/json', ...(input.origin ? { origin: input.origin } : {}),
    ...(input.length ? { 'content-length': input.length } : {}) };
  const response = Object.assign(new EventEmitter(), { statusCode: 200, headersSent: false, destroyed: false, writableEnded: false,
    headers: new Map<string, string | string[]>(), body: Buffer.alloc(0),
    setHeader(key: string, value: string | string[]) { this.headers.set(key, value); },
    end(body: Buffer) { this.body = Buffer.from(body); this.writableEnded = true; }, destroy() { this.destroyed = true; } });
  const received: Request[] = [];
  const handler = createFirebaseNodeHandler({ publicOrigin: origin, auth: { fromNodeHeaders(headers) {
    const result = new Headers(); for (const [key, value] of Object.entries(headers)) if (typeof value === 'string') result.set(key, value); return result;
  } }, async handler(value) { received.push(value); return Response.json({ body: await value.text() },
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
