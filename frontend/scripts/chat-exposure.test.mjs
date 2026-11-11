import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

// Execute the production exposure hook with measured row IDs; no mounted UI or device is claimed.
function exposureHarness({ active = true, ids = ['proactive', 'regular', 'user'], shared = false } = {}) {
  const effects = [], timers = new Map(), calls = [];
  const snapshot = { identityKey: 'parent', scopeKey: 'parent-child-session', sessionGeneration: 1 };
  const context = { owner: { apiBaseUrl: 'https://synthetic.invalid', getSnapshot: () => snapshot,
    async fetcher(url, init) { calls.push({ url, init }); return Response.json({ seen: true }); } },
  ...snapshot, userId: 'parent', selectedChildId: 'child', sharedChild: { target: shared ? {} : null }, online: true,
  chatState: { messages: [{ id: 'proactive', role: 'model', proactive: true }, { id: 'regular', role: 'model' }, { id: 'user', role: 'user', proactive: true }] } };
  const source = readFileSync(new URL('../src/production/useChatExposure.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', code)(name => {
    if (name === 'react') return { useRef: value => ({ current: value }), useEffect: callback => effects.push(callback) };
    if (name === 'react-native') return {};
    assert.equal(name, './ProductionProvider'); return { useProduction: () => context };
  }, module, module.exports, (callback, ms) => { assert.equal(ms, 250); const id = timers.size + 1; timers.set(id, callback); return id; }, id => timers.delete(id));
  module.exports.useChatExposure(active, ids);
  const cleanups = effects.map(effect => effect()).filter(Boolean);
  return { calls, snapshot, flush: () => { for (const callback of timers.values()) callback(); timers.clear(); }, cleanup: () => cleanups.forEach(fn => fn()) };
}

test('seen requires measured foreground exposure and only acknowledges proactive model messages', () => {
  const visible = exposureHarness(); assert.deepEqual(visible.calls, []); visible.flush();
  assert.equal(visible.calls.length, 1); assert.ok(visible.calls[0].url.endsWith('/children/child/chat/messages/proactive/seen'));
  assert.equal(new Headers(visible.calls[0].init.headers).get('x-expected-user-id'), 'parent');
  for (const options of [{ active: false }, { ids: [] }, { shared: true }]) {
    const hidden = exposureHarness(options); hidden.flush(); assert.equal(hidden.calls.length, 0);
  }
  const blurred = exposureHarness(); blurred.cleanup(); blurred.flush(); assert.equal(blurred.calls.length, 0);
  const renewed = exposureHarness(); renewed.snapshot.sessionGeneration++; renewed.flush(); assert.equal(renewed.calls.length, 0);
});
