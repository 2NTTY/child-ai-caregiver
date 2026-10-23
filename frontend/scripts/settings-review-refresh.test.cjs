const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const sourceRoot = path.resolve(__dirname, '../..'), req = createRequire(path.join(sourceRoot, 'frontend/package.json'));
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for an existing installation; no product dependency is added.');
const { JSDOM } = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://synthetic.invalid/settings' });
Object.assign(global, { window: dom.window, document: dom.window.document, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true });
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.fetch = () => { throw new Error('Real network forbidden'); };
const React = req('react'), { act } = React, { createRoot } = req('react-dom/client'), ts = req('typescript');
const { QueryClient } = req('@tanstack/react-query'), cache = new Map();
// Real hooks, refresh/request lifetimes, query client and API schemas; only the
// application owner port and fetch responses are synthetic. No server is called.
function compile(relative) {
  const filename = path.resolve(sourceRoot, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} }; cache.set(filename, module);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    if (name === './useDomainEnvironment') return { useDomainWriteGuard() {} };
    if (!name.startsWith('.')) return req(name);
    const target = path.resolve(path.dirname(filename), name);
    return compile(path.relative(sourceRoot, fs.existsSync(target) ? target : target + '.ts'));
  }, module, module.exports);
  return module.exports;
}
const { useProductionNotificationPreferences } = compile('frontend/src/production/useProductionNotificationPreferences.ts');
const { useProductionModelSettings } = compile('frontend/src/production/useProductionModelSettings.ts');
const { publishOnlineRefresh } = compile('src/client/online-refresh-events.ts');
const { removeModelKeyCommand } = compile('frontend/src/components/model-settings/model-settings-form.ts');
const preferences = { version: 7, timeZone: 'Asia/Hong_Kong', quietStart: '22:00', quietEnd: '08:00', allowAppointmentDuringQuiet: false };
const settings = { version: 7, mode: 'personal', provider: 'gemini', model: 'gemini-3.1-flash-lite', keyConfigured: true,
  backgroundEnabled: false, dailyLimit: 100, maxModelCalls: 4, maxQueryEmbeddings: 2, updatedAt: null };
const usage = { day: '2026-10-23', attempts: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, unknownUsageAttempts: 0 };
const clone = value => structuredClone(value), response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
async function setup(t, kind) {
  const calls = [], pending = new Map(), access = [];
  const remote = { preferences: clone(preferences), settings: clone(settings), readStatus: 200, saveStatus: 500, readGate: null, userId: 'synthetic-user-a' };
  const snapshot = { identityKey: 'synthetic-user-a', scopeKey: 'synthetic-child-a', sessionGeneration: 1, records: { user: { name: 'Synthetic parent' } } };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const fetcher = async (url, options) => {
    calls.push({ url, method: options.method, body: options.body ? JSON.parse(options.body) : null });
    if (url === '/api/notification-preferences') {
      if (remote.readGate) await remote.readGate;
      return response({ preferences: remote.preferences }, remote.readStatus);
    }
    if (url === '/api/auth/get-session') return response({ user: { id: remote.userId } });
    if (url === '/api/ai/settings' && options.method === 'GET') {
      if (remote.readGate) await remote.readGate;
      return response({ settings: remote.settings, enabled: true, platformAvailable: true, personalAvailable: true,
        personalGlobalLimit: 500, usage: { platform: usage, personal: usage } }, remote.readStatus);
    }
    if (url === '/api/ai/settings/models') return response({ version: remote.settings.version, provider: 'gemini', scope: 'model_metadata_only', status: 'not_checked',
      truncated: false, embedding: { model: 'gemini-embedding-001', dimensions: 1024, status: 'not_checked' }, models: [] });
    if (url.startsWith('/api/ai/settings/operations/')) return response(null);
    if (url === '/api/ai/settings' && options.method === 'POST') return response({ error: { code: remote.saveStatus === 409 ? 'version_conflict' : 'unavailable' } }, remote.saveStatus);
    if (url === '/api/online/context') return response({ workspaceId: '11111111-1111-4111-8111-111111111111', storageEpoch: '22222222-2222-4222-8222-222222222222' });
    if (url === '/api/online/submit') return response({ error: { code: 'unavailable' } }, 500);
    if (url.startsWith('/api/online/operations/')) return response({ state: 'unconfirmed' });
    throw new Error('Unexpected synthetic port: ' + url);
  };
  const env = { identityKey: snapshot.identityKey, scopeKey: snapshot.scopeKey, userId: remote.userId, childId: 'synthetic-child-a', online: true, apiBaseUrl: '/api', queryClient,
    owner: { fetcher, getSnapshot: () => snapshot, setDomainPending: (id, value) => pending.set(id, value) },
    currentIdentity: () => env.identityKey === snapshot.identityKey, current: () => env.scopeKey === snapshot.scopeKey,
    canStartWrite: () => ![...pending.values()].some(Boolean), invalidate() {}, accessError: error => access.push(error) };
  let domain;
  function Host() { domain = kind === 'preferences' ? useProductionNotificationPreferences(env) : useProductionModelSettings(env); return null; }
  const container = document.body.appendChild(document.createElement('div')), root = createRoot(container);
  const flush = async action => act(async () => { action?.(); for (let i = 0; i < 4; i++) await new Promise(setImmediate); });
  const render = () => flush(() => root.render(React.createElement(Host, { key: JSON.stringify([env.identityKey, snapshot.sessionGeneration]) })));
  await render();
  t.after(async () => { await flush(() => root.unmount()); queryClient.clear(); container.remove(); });
  return { get domain() { return domain; }, env, remote, snapshot, calls, access, render, flush,
    reads: () => calls.filter(call => call.method === 'GET' && call.url === (kind === 'preferences' ? '/api/notification-preferences' : '/api/ai/settings')).length,
    writes: () => calls.filter(call => call.method === 'POST'),
    editing: value => flush(() => (kind === 'preferences' ? domain : domain.actions).setDraftEditing(value)),
    refresh: () => flush(() => (kind === 'preferences' ? domain : domain.actions).refresh()), signal: () => flush(publishOnlineRefresh) };
}

test('notification owner defers dirty/review signals, drains once, and still rechecks reconnect and identity', async t => {
  const f = await setup(t, 'preferences'); assert.equal(f.domain.fresh, true); assert.equal(f.reads(), 1);
  await f.editing(true); await f.signal(); await f.signal(); assert.equal(f.reads(), 1);
  await f.editing(false); assert.equal(f.reads(), 2); assert.equal(f.domain.preferences.version, 7);
  await f.editing(true); f.env.online = false; await f.render(); assert.equal(f.domain.fresh, false);
  f.env.online = true; await f.render(); assert.equal(f.reads(), 3); assert.equal(f.domain.fresh, true);
  const oldScope = f.domain.scopeKey; f.snapshot.sessionGeneration++; await f.render();
  assert.notEqual(f.domain.scopeKey, oldScope); assert.equal(f.reads(), 4);
  await f.editing(true); f.remote.userId = 'synthetic-user-b'; await f.refresh();
  assert.equal(f.domain.preferences, null); assert.equal(f.domain.fresh, false); assert.equal(f.access.at(-1).status, 401); assert.equal(f.writes().length, 0);
});

test('notification busy and original-unknown guards reject new writes and never auto-retry', async t => {
  const f = await setup(t, 'preferences'); let release;
  f.remote.readGate = new Promise(resolve => { release = resolve; }); await f.signal(); assert.equal(f.domain.busy, true);
  await f.flush(() => f.domain.save(preferences, 7)); assert.equal(f.writes().length, 0);
  await f.flush(() => { release(); f.remote.readGate = null; }); assert.equal(f.domain.busy, false);
  await f.flush(() => f.domain.save(preferences, 6)); assert.equal(f.writes().length, 0); assert.match(f.domain.notice, /版本已改變/);
  await f.flush(() => f.domain.save(preferences, 7)); assert.equal(f.writes().length, 2); assert.ok(f.domain.original); assert.equal(f.domain.fresh, false);
  const count = f.reads(); await f.signal(); await f.flush(() => f.domain.save(preferences, 7)); assert.equal(f.reads(), count); assert.equal(f.writes().length, 2);
  await f.refresh(); assert.equal(f.domain.original.reviewed, true); assert.equal(f.domain.original.consent, false);
  await f.flush(() => f.domain.retryOriginal()); assert.equal(f.writes().length, 2);
});

test('model owner preserves equal-read form basis, defers editing/review and clears access on an explicit recheck', async t => {
  const f = await setup(t, 'model'); assert.ok(f.domain.model.snapshot); const revision = f.domain.model.formRevision;
  await f.signal(); assert.equal(f.reads(), 2); assert.equal(f.domain.model.formRevision, revision);
  await f.editing(true); await f.signal(); await f.signal(); assert.equal(f.reads(), 2);
  await f.editing(false); assert.equal(f.reads(), 3); assert.equal(f.domain.model.formRevision, revision);
  f.remote.settings = { ...f.remote.settings, version: 8 }; await f.signal(); assert.equal(f.domain.model.formRevision, revision + 1);
  await f.editing(true); f.env.online = false; await f.render(); f.env.online = true; await f.render(); assert.equal(f.reads(), 5);
  const oldScope = f.domain.model.scopeKey; f.snapshot.sessionGeneration++; await f.render(); assert.notEqual(f.domain.model.scopeKey, oldScope);
  f.remote.readStatus = 403; await f.refresh(); assert.equal(f.domain.model.snapshot, null); assert.match(f.domain.model.notice, /不可讀取或修改/); assert.equal(f.writes().length, 0);
});

test('model unknown and version-conflict recovery preserve write guards and the original operation ID', async t => {
  const f = await setup(t, 'model'); const command = removeModelKeyCommand(f.domain.model.snapshot.settings);
  await f.flush(() => f.domain.actions.save({ ...command, expectedVersion: 6 })); assert.equal(f.writes().length, 0);
  await f.flush(() => f.domain.actions.save(command)); assert.equal(f.domain.model.operation, 'unknown'); assert.equal(f.domain.model.needsRead, true);
  const opId = f.domain.model.originalOperationId; assert.equal(f.writes().length, 1); assert.equal(f.writes()[0].body.opId, opId);
  const count = f.reads(); await f.signal(); await f.flush(() => f.domain.actions.save(command)); assert.equal(f.reads(), count); assert.equal(f.writes().length, 1);
  await f.refresh(); assert.equal(f.domain.model.originalOperationId, opId); assert.equal(f.domain.model.operation, 'unknown'); assert.equal(f.writes().length, 1);
  f.remote.settings = { ...f.remote.settings, version: 8 }; await f.refresh(); assert.equal(f.domain.model.originalOperationId, null); assert.equal(f.domain.model.needsRead, false);
  f.remote.saveStatus = 409; await f.flush(() => f.domain.actions.save(removeModelKeyCommand(f.domain.model.snapshot.settings)));
  assert.equal(f.domain.model.operation, 'failed'); assert.equal(f.domain.model.needsRead, true); assert.equal(f.domain.model.originalOperationId, null);
  await f.signal(); await f.flush(() => f.domain.actions.save(command)); assert.equal(f.writes().length, 2);
});

test.after(() => dom.window.close());
