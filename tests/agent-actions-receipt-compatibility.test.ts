import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAgentActionsApi, AgentActionsApiError } from '../src/client/agent-actions-api.ts';
import { AgentAuthorizationOwner } from '../frontend/src/production/AgentAuthorizationOwner.ts';
import { firestoreAgentActionReceiptSchema } from '../server/firestore-private-note-receipt.ts';
import { handleAgentActionsRequest } from '../server/agent-actions-api.ts';
import type { AgentActionReceipt } from '../src/shared/agent-actions.ts';

const id = (n: number) => `c0000000-0000-4000-9000-${String(n).padStart(12, '0')}`;
const childId = id(1), runId = id(2), userId = 'receipt-compatibility-synthetic';
const scope = { key: 'receipt-scope-A', childId, userId };
const legacy: AgentActionReceipt = { id: id(3), runId, kind: 'save_record',
  resource: { kind: 'care_record', id: id(4), version: 7 }, state: 'saved',
  notification: 'not_authorized', channels: [], createdAt: '2026-11-05T17:00:00+08:00' };
const voice: AgentActionReceipt = { ...legacy, id: id(5), sourceBasis: 'voice_interpretation',
  quantityGrounding: { status: 'source_supported' } };
const signal = () => new AbortController().signal;
const forbidden = () => assert.fail('No mutation, model, contact, policy, or note operation is allowed');

// Keep the actual schema, route, client and owner. Only persistent storage/session
// lookup and the network transport are synthetic. No Firestore transaction runs.
function routeHarness(receipts: AgentActionReceipt[]) {
  const stats = { gets: 0, storageReads: 0, sessionChecks: 0 };
  const observations: Array<{ status: number; payload: unknown }> = [];
  let stored = structuredClone(receipts);
  const store = { receipts: async (u: string, c: string, r: string) => {
    assert.equal(u, userId); assert.equal(c, childId); assert.equal(r, runId);
    stats.storageReads++;
    return stored.map(item => firestoreAgentActionReceiptSchema.parse(item));
  }, records: forbidden, policy: forbidden, notes: forbidden, savePolicy: forbidden, deleteNote: forbidden, execute: forbidden };
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(init?.method, 'GET'); assert.equal(init?.body, undefined);
    stats.gets++;
    const response = await handleAgentActionsRequest(new Request(new URL(String(url), 'https://synthetic.invalid'), init), userId,
      store, async u => { stats.sessionChecks++; return u === userId; });
    observations.push({ status: response.status, payload: await response.clone().json() });
    return response;
  };
  return { stats, observations, fetcher, setReceipts: (value: AgentActionReceipt[]) => { stored = structuredClone(value); } };
}
function ownerFor(fetcher: typeof fetch) {
  const owner = new AgentAuthorizationOwner('/api', true, forbidden, forbidden, fetcher);
  owner.syncContext(scope, true);
  return owner;
}
const read = (fetcher: typeof fetch) => createAgentActionsApi('/api', fetcher).receipts(childId, runId, signal(), userId);

// Removing the optional literal from the strict client schema must fail this gate.
test('valid voice receipt survives the real persisted schema and route into the real client and owner', async () => {
  const harness = routeHarness([voice]);
  const clientValue = await read(harness.fetcher);
  assert.deepEqual(clientValue, [voice]);
  const owner = ownerFor(harness.fetcher);
  try {
    await owner.readReceipts(runId);
    assert.deepEqual(owner.getSnapshot().receipts[runId], { state: 'ready', items: [voice] });
    assert.equal(owner.getSnapshot().receipts[runId].items[0].sourceBasis, 'voice_interpretation');
    assert.deepEqual(harness.observations, [
      { status: 200, payload: { receipts: [voice] } }, { status: 200, payload: { receipts: [voice] } },
    ]);
    assert.equal(harness.stats.gets, 2);
    assert.equal(harness.stats.storageReads, 2);
  } finally { owner.dispose(); }
});

for (const [name, receipts] of [['legacy', [legacy]], ['mixed legacy and voice', [legacy, voice]]] as const) {
  test(`${name} receipts retain their IDs and resource versions in a ready owner`, async () => {
    const harness = routeHarness([...receipts]);
    assert.deepEqual(await read(harness.fetcher), receipts);
    const owner = ownerFor(harness.fetcher);
    try {
      await owner.readReceipts(runId);
      assert.deepEqual(owner.getSnapshot().receipts[runId], { state: 'ready', items: receipts });
      assert.equal(owner.getSnapshot().pending, null);
      assert.equal(owner.getSnapshot().busy, null);
    } finally { owner.dispose(); }
  });
}

// Negative HTTP payloads intentionally bypass persisted parsing: its quantity
// object currently strips unknown fields, whereas the HTTP client must reject them.
function payloadTransport(payload: unknown) {
  let gets = 0;
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(init?.method, 'GET'); assert.equal(init?.body, undefined);
    const actual = new URL(String(url), 'https://synthetic.invalid');
    assert.equal(actual.pathname, `/api/children/${childId}/agent/actions`);
    assert.equal(actual.searchParams.get('runId'), runId);
    assert.equal(new Headers(init?.headers).get('x-expected-user-id'), userId);
    gets++;
    return Response.json(payload);
  };
  return { fetcher, get gets() { return gets; } };
}
const invalidPayloads: Array<[string, unknown]> = [
  ['wrong sourceBasis', { receipts: [{ ...voice, sourceBasis: 'typed_statement' }] }],
  ['null sourceBasis', { receipts: [{ ...voice, sourceBasis: null }] }],
  ['unknown response field', { receipts: [voice], privateText: 'synthetic-only' }],
  ['unknown receipt field', { receipts: [{ ...voice, privateText: 'synthetic-only' }] }],
  ['unknown resource field', { receipts: [{ ...voice, resource: { ...voice.resource, privateText: 'synthetic-only' } }] }],
  ['quantity private source field', { receipts: [{ ...voice, quantityGrounding: { status: 'source_supported', interpretedQuote: 'synthetic-only' } }] }],
  ['wrong run', { receipts: [{ ...voice, runId: id(6) }] }],
  ['duplicate receipt ID', { receipts: [voice, voice] }],
  ['over eight receipts', { receipts: Array.from({ length: 9 }, (_, n) => ({ ...voice, id: id(100 + n) })) }],
  ['invalid receipt UUID', { receipts: [{ ...voice, id: 'invalid' }] }],
  ['invalid resource UUID', { receipts: [{ ...voice, resource: { ...voice.resource, id: 'invalid' } }] }],
  ['zero resource version', { receipts: [{ ...voice, resource: { ...voice.resource, version: 0 } }] }],
  ['fractional resource version', { receipts: [{ ...voice, resource: { ...voice.resource, version: 1.5 } }] }],
  ['over maximum resource version', { receipts: [{ ...voice, resource: { ...voice.resource, version: 2147483648 } }] }],
  ['unknown memory outcome', { receipts: [{ ...voice, memoryOutcome: 'guessed' }] }],
  ['unknown quantity status', { receipts: [{ ...voice, quantityGrounding: { status: 'guessed' } }] }],
  ['unknown receipt kind', { receipts: [{ ...voice, kind: 'send_message' }] }],
  ['unknown resource kind', { receipts: [{ ...voice, resource: { ...voice.resource, kind: 'message' } }] }],
  ['unknown receipt state', { receipts: [{ ...voice, state: 'approved' }] }],
  ['unknown notification', { receipts: [{ ...voice, notification: 'delivered' }] }],
  ['unknown channel', { receipts: [{ ...voice, channels: ['email'] }] }],
  ['duplicate channels', { receipts: [{ ...voice, channels: ['native_push', 'native_push'] }] }],
  ['three channels remain out of scope', { receipts: [{ ...voice, channels: ['telegram', 'web_push', 'native_push'] }] }],
  ['timestamp without offset', { receipts: [{ ...voice, createdAt: '2026-11-05T17:00:00' }] }],
];
for (const [name, payload] of invalidPayloads) {
  test(`strict receipt contract still rejects ${name}`, async () => {
    const transport = payloadTransport(payload);
    await assert.rejects(read(transport.fetcher), error => error instanceof AgentActionsApiError && error.status === 0 && error.code === null);
    const owner = ownerFor(transport.fetcher);
    try {
      await owner.readReceipts(runId);
      assert.deepEqual(owner.getSnapshot().receipts[runId], { state: 'failed', items: [] });
      assert.equal(owner.getSnapshot().pending, null);
      assert.equal(transport.gets, 2);
    } finally { owner.dispose(); }
  });
}

test('existing legal optional enums, native channel, version maximum and eight-item window remain readable', async () => {
  const receipts = Array.from({ length: 8 }, (_, n) => ({ ...voice, id: id(200 + n),
    resource: { ...voice.resource, version: n === 7 ? 2147483647 : 1 },
    channels: ['native_push'], memoryOutcome: ['created', 'updated', 'duplicate'][n % 3],
    quantityGrounding: { status: ['source_supported', 'removed', 'absent', 'unchanged'][n % 4] },
  }));
  const transport = payloadTransport({ receipts });
  assert.deepEqual(await read(transport.fetcher), receipts);
  const owner = ownerFor(transport.fetcher);
  try { await owner.readReceipts(runId); assert.deepEqual(owner.getSnapshot().receipts[runId], { state: 'ready', items: receipts }); }
  finally { owner.dispose(); }
});

test('ready deduplication and explicit force refresh preserve complete receipt batches', async () => {
  const harness = routeHarness([legacy]), owner = ownerFor(harness.fetcher);
  try {
    await owner.readReceipts(runId);
    harness.setReceipts([legacy, voice]);
    await owner.readReceipts(runId);
    assert.equal(harness.stats.gets, 1);
    assert.deepEqual(owner.getSnapshot().receipts[runId], { state: 'ready', items: [legacy] });
    await owner.readReceipts(runId, true);
    assert.equal(harness.stats.gets, 2);
    assert.deepEqual(owner.getSnapshot().receipts[runId], { state: 'ready', items: [legacy, voice] });
  } finally { owner.dispose(); }
});

function deferredTransport() {
  const requests: Array<{ signal: AbortSignal; resolve: (response: Response) => void; user: string | null; child: string }> = [];
  const fetcher: typeof fetch = async (url, init) => {
    assert.equal(init?.method, 'GET'); assert.equal(init?.body, undefined);
    return new Promise<Response>(resolve => requests.push({ signal: init!.signal!, resolve,
      user: new Headers(init?.headers).get('x-expected-user-id'), child: new URL(String(url), 'https://synthetic.invalid').pathname }));
  };
  return { requests, fetcher };
}
for (const [name, replacementScope] of [
  ['child scope change', { ...scope, key: 'receipt-child-B', childId: id(300) }],
  ['identity change', { ...scope, key: 'receipt-user-B', userId: 'receipt-other-user' }],
  ['logout', null],
] as const) {
  test(`${name} discards a late receipt response even when transport ignores abort`, async () => {
    const transport = deferredTransport(), owner = ownerFor(transport.fetcher);
    try {
      const pending = owner.readReceipts(runId);
      owner.syncContext(replacementScope, true);
      assert.equal(transport.requests[0].signal.aborted, true);
      transport.requests[0].resolve(Response.json({ receipts: [voice] }));
      await pending;
      assert.deepEqual(owner.getSnapshot().receipts, {});
      if (replacementScope) {
        const current = owner.readReceipts(runId);
        assert.equal(transport.requests[1].user, replacementScope.userId);
        assert.equal(transport.requests[1].child, `/api/children/${replacementScope.childId}/agent/actions`);
        transport.requests[1].resolve(Response.json({ receipts: [voice] }));
        await current;
        assert.deepEqual(owner.getSnapshot().receipts[runId], { state: 'ready', items: [voice] });
      }
    } finally { owner.dispose(); }
  });
}

test('invalidation fences the old response and preserves a replacement request and its deduplication', async () => {
  const transport = deferredTransport(), owner = ownerFor(transport.fetcher);
  try {
    const old = owner.readReceipts(runId);
    await owner.readReceipts(runId, true);
    assert.equal(transport.requests.length, 1, 'An in-flight request is deduplicated even with force');
    owner.invalidateReceipts();
    assert.equal(transport.requests[0].signal.aborted, true);
    assert.deepEqual(owner.getSnapshot().receipts, {});
    const replacement = owner.readReceipts(runId);
    transport.requests[0].resolve(Response.json({ receipts: [legacy] }));
    await old;
    assert.deepEqual(owner.getSnapshot().receipts[runId], { state: 'loading', items: [] });
    await owner.readReceipts(runId, true);
    assert.equal(transport.requests.length, 2, 'The old finally must not erase the replacement request');
    transport.requests[1].resolve(Response.json({ receipts: [voice] }));
    await replacement;
    assert.deepEqual(owner.getSnapshot().receipts[runId], { state: 'ready', items: [voice] });
  } finally { owner.dispose(); }
});

test('dispose prevents late receipt results from restoring private state', async () => {
  const transport = deferredTransport(), owner = ownerFor(transport.fetcher);
  const pending = owner.readReceipts(runId);
  owner.dispose();
  assert.equal(transport.requests[0].signal.aborted, true);
  transport.requests[0].resolve(Response.json({ receipts: [voice] }));
  await pending;
  assert.deepEqual(owner.getSnapshot().receipts, {});
});
