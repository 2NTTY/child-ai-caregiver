import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatApi } from '../../src/client/chat-api.ts';
import { harness } from './scope-transition-harness.mjs';

const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const childId = id(1), at = '2026-10-30T00:00:00Z';
function item(number) {
  return { id: id(number), childId, version: 1, message: { id: id(number + 20), childId: id(2), authorUserId: 'source-user',
    role: 'user', text: `SOURCE_${number}`, inReplyTo: null, createdAt: at }, attachment: null,
    importedFrom: { current: { source: { serverId: 'source-server', accountId: 'source-account', childId: id(2), section: 'chat',
      resourceId: id(number + 20), resourceVersion: 1, authorUserId: 'source-user', createdAt: at, confirmedBy: null, confirmedAt: null,
      confirmationBasis: null, assigneeUserId: null }, sourceHash: 'a'.repeat(64), packageId: id(3), packageVersion: 1,
      manifestSha256: 'b'.repeat(64), integrity: 'missing_proof', importedBy: 'actor', importedAt: at }, previous: [] } };
}
const settle = async h => { await new Promise(setImmediate); h.render(); await new Promise(setImmediate); h.render(); };

test('imported chat client and read projection bind pages and details to private scope and clear revoked or late data', async () => {
  const calls = [], accessErrors = []; let mode = 'normal', finish, value, currentScope = 'actor:child', env;
  const first = item(10), second = item(11);
  const api = createChatApi('https://example.test', async () => null, async (input, init) => {
    const url = new URL(input), user = new Headers(init.headers).get('x-expected-user-id');
    calls.push({ url, user, signal: init.signal });
    assert.equal(init.method, 'GET'); assert.equal(init.credentials, 'include'); assert.equal(init.cache, 'no-store');
    if (mode === 'hold') return new Promise(resolve => { finish = resolve; });
    if (mode === 'denied') return Response.json({ error: { code: 'access_denied' } }, { status: 403 });
    const detail = !url.pathname.endsWith('/imported');
    if (detail) return Response.json(mode === 'wrong-id' ? second : first);
    return Response.json({ items: user === 'other' ? [] : [mode === 'wrong-child' ? { ...first, childId: id(99) } : url.searchParams.has('cursor') ? second : first],
      nextCursor: user === 'other' || url.searchParams.has('cursor') ? null : id(12) });
  });
  assert.equal(typeof api.listImportedMessages, 'function'); assert.equal(typeof api.getImportedMessage, 'function');
  const environment = (scope, user = 'actor', sharedMode = false) => ({ owner: { chatApi: api }, scopeKey: scope, identityKey: user,
    userId: user, childId, online: true, sharedMode, allows: module => !sharedMode || module !== 'private',
    current: () => currentScope === scope, accessError: error => accessErrors.push(error) });
  env = environment(currentScope);
  const h = harness({ './useDomainEnvironment': { useDomainEnvironment: () => env,
    forSharedModule: (value, module) => value.allows(module) ? value : { ...value, childId: null, current: () => false } } });
  const { useImportedChatHistory } = h.load('src/production/useImportedChatHistory.ts');
  function Host() { value = useImportedChatHistory(); return h.jsx('Host', {}); }
  h.render(h.jsx(Host, {})); await settle(h);
  assert.deepEqual(value.items, [first]); assert.equal(value.hasMore, true); assert.equal(calls[0].user, 'actor');
  value.loadMore(); await settle(h); assert.deepEqual(value.items, [first, second]); assert.equal(value.hasMore, false);
  assert.equal(calls[1].url.searchParams.get('cursor'), id(12));
  value.open(first); await settle(h); assert.deepEqual(value.detail, first);
  value.close(); h.render(); assert.equal(value.detail, null);
  mode = 'hold'; value.open(first); await settle(h); assert.ok(finish); const pending = calls.at(-1);
  currentScope = 'other:child'; env = environment(currentScope, 'other'); mode = 'normal'; h.render();
  assert.equal(pending.signal.aborted, true); assert.equal(value.detail, null); assert.deepEqual(value.items, []);
  finish(Response.json(first)); await settle(h); assert.equal(value.detail, null); assert.deepEqual(value.items, []);
  currentScope = 'shared'; env = environment(currentScope, 'actor', true); const beforeShared = calls.length; h.render(); await settle(h);
  assert.equal(calls.length, beforeShared); assert.deepEqual(value.items, []);
  currentScope = 'actor:child:again'; env = environment(currentScope); h.render(); await settle(h);
  value.open(first); await settle(h); assert.ok(value.detail);
  mode = 'denied'; value.refresh(); await settle(h);
  assert.deepEqual(value.items, []); assert.equal(value.detail, null); assert.equal(accessErrors.length, 1);
  mode = 'wrong-child'; await assert.rejects(api.listImportedMessages(childId, new AbortController().signal, 'actor'));
  mode = 'wrong-id'; await assert.rejects(api.getImportedMessage(childId, first.id, new AbortController().signal, 'actor'));
  h.unmount();
});
