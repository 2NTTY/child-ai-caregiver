import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './scope-transition-harness.mjs';
import { parseWebPushOpen } from '../../src/client/push-browser.ts';
import { WebPushApiError } from '../../src/client/web-push-api.ts';

const bindingId = '11111111-1111-4111-8111-111111111111', childId = '22222222-2222-4222-8222-222222222222', messageId = '33333333-3333-4333-8333-333333333333';
function browser(t, href) {
  const priorWindow = Object.getOwnPropertyDescriptor(globalThis, 'window'), priorDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const windowListeners = new Map(), documentListeners = new Map(), saved = new Map();
  const listeners = map => ({ addEventListener: (name, listener) => { if (!map.has(name)) map.set(name, new Set()); map.get(name).add(listener); }, removeEventListener: (name, listener) => map.get(name)?.delete(listener) });
  const win = { ...listeners(windowListeners), location: { href }, sessionStorage: { getItem: key => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) },
    history: { state: {}, replaceState(_state, _unused, url) { win.location.href = new URL(url, win.location.href).href; } } };
  let focused = true;
  const doc = { ...listeners(documentListeners), visibilityState: 'visible', hasFocus: () => focused };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: win }); Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  t.after(() => { if (priorWindow) Object.defineProperty(globalThis, 'window', priorWindow); else delete globalThis.window; if (priorDocument) Object.defineProperty(globalThis, 'document', priorDocument); else delete globalThis.document; });
  return { win, doc, saved, focus: value => { focused = value; for (const listener of windowListeners.get(value ? 'focus' : 'blur') ?? []) listener(); },
    visibility(value) { doc.visibilityState = value; for (const listener of documentListeners.get('visibilitychange') ?? []) listener(); } };
}

test('Web click survives expired login and cold auth reload, proves installation once and rejects stale warm responses', async t => {
  const query = delivery => `?pushBinding=${bindingId}&pushVersion=2&pushDelivery=${delivery}`;
  const b = browser(t, 'https://synthetic.invalid/' + query(messageId)), calls = [], navigation = [], notices = [], pending = [];
  let identity = 'parent', generation = 1, mode = 'expired';
  const owner = { apiBaseUrl: 'https://synthetic.invalid', fetcher() {}, getSnapshot: () => ({ identityKey: identity, sessionGeneration: generation }),
    handleDomainAccessError() { identity = null; calls.push('restore-session'); } };
  const subscription = { endpoint: 'https://web.push.apple.com/synthetic' };
  const mocks = {
    '../../../src/client/push-browser.ts': { parseWebPushOpen, browserPushSubscription: async () => subscription },
    '../../../src/client/web-push-api.ts': { WebPushApiError, createWebPushApi: () => ({ resetOnline() {},
      async open(reference, _signal, userId, proof) {
        calls.push({ reference, userId, proof });
        if (mode === 'expired') throw new WebPushApiError(401);
        if (mode === 'delayed') return new Promise(resolve => pending.push(resolve));
        if (!proof) throw new WebPushApiError(409, 'installation_proof_required');
        return { kind: 'chat', childId, messageId };
      } }) },
  };
  const mount = () => {
    const h = harness(mocks), { useWebPushNavigation } = h.load('src/production/useWebPushNavigation.ts');
    function Subject() { useWebPushNavigation(owner, identity, identity, true, value => navigation.push(value), value => notices.push(value)); return null; }
    const render = () => h.render(h.jsx(Subject));
    return { h, render, settle: async () => { await new Promise(setImmediate); render(); } };
  };
  let app = mount(); app.render(); await app.settle();
  assert.equal(identity, null); assert.equal(b.saved.size, 1); assert.equal(navigation.length, 0);
  app.h.unmount(); b.win.location.href = 'https://synthetic.invalid/auth/callback';
  app = mount(); app.render(); await app.settle(); assert.equal(navigation.length, 0);
  identity = 'parent'; generation++; mode = 'proof'; app.render(); await app.settle();
  assert.deepEqual(navigation, [{ kind: 'chat', childId, messageId }]);
  assert.equal(calls.filter(value => value?.proof).length, 1); assert.equal(b.saved.size, 0);
  const nextDelivery = '44444444-4444-4444-8444-444444444444';
  b.win.location.href = 'https://synthetic.invalid/' + query(nextDelivery);
  app.h.route('/', { pushBinding: bindingId, pushVersion: '2', pushDelivery: nextDelivery }); mode = 'delayed'; app.render();
  generation++; app.render();
  assert.equal(pending.length, 2);
  pending[0]({ kind: 'chat', childId, messageId }); await app.settle(); assert.equal(navigation.length, 1);
  pending[1]({ kind: 'chat', childId, messageId: nextDelivery }); await app.settle(); assert.equal(navigation.length, 2);
  assert.equal(b.win.location.href, 'https://synthetic.invalid/');
  app.h.unmount();
});

test('only the visible personal chat in an installed Web App sends installation heartbeats and blur clears it', async t => {
  const b = browser(t, 'https://synthetic.invalid/chat'), heartbeats = [], reads = [];
  let homeScreen = false, child = childId, generation = 1;
  const timers = new Map(); let timerId = 0;
  t.mock.method(globalThis, 'setInterval', callback => { const id = ++timerId; timers.set(id, callback); return id; });
  t.mock.method(globalThis, 'clearInterval', id => timers.delete(id));
  const owner = { apiBaseUrl: 'https://synthetic.invalid', fetcher() {}, getSnapshot: () => ({ identityKey: 'parent', sessionGeneration: generation, records: { user: { id: 'parent' } } }) };
  const h = harness({
    '../../../src/client/push-browser.ts': { pushHomeScreen: () => homeScreen, checkPushBrowserUser: async () => {}, suspendPushBrowser: async () => { throw new Error('Routine lifecycle must not suspend'); }, ownedBrowserBinding: async () => ({ id: bindingId, version: 2 }) },
    '../../../src/client/web-push-api.ts': { createWebPushApi: () => ({ status: async () => { reads.push('status'); return {}; }, resetOnline() {} }) },
    './WebChatPresenceController': { webChatPresenceFor: () => ({ bind() {}, foreground: async value => { heartbeats.push(value); } }) },
  });
  const { useWebChatPresence } = h.load('src/production/useWebChatPresence.ts');
  function Subject() { useWebChatPresence(owner, 'parent', 'parent', child, true); return null; }
  const render = () => h.render(h.jsx(Subject));
  const settle = async () => { await new Promise(setImmediate); render(); };
  render(); await settle(); assert.deepEqual(reads, []); assert.deepEqual(heartbeats, [], 'A desktop tab does not suppress phone notifications');
  homeScreen = true; child = null; render(); await settle(); assert.deepEqual(heartbeats, [null]);
  child = childId; render(); await settle(); assert.equal(heartbeats.at(-1), childId);
  b.focus(false); await settle(); assert.equal(heartbeats.at(-1), null);
  b.focus(true); await settle(); assert.equal(heartbeats.at(-1), childId);
  b.visibility('hidden'); await settle(); assert.equal(heartbeats.at(-1), null);
  for (const callback of timers.values()) callback(); await settle(); assert.equal(heartbeats.at(-1), null);
  h.unmount(); await new Promise(setImmediate); assert.equal(heartbeats.at(-1), null); assert.equal(timers.size, 0);
});
