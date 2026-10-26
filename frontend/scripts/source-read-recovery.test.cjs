const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const test = require('node:test');
const source = path.resolve(process.env.SOURCE_READ_RECOVERY_ROOT || path.join(__dirname, '../..'));
const req = createRequire(path.join(source, 'frontend/package.json'));
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for an existing jsdom installation; it is not a product dependency.');
const { JSDOM } = require(process.env.JSDOM_MODULE);
const React = req('react'), { act } = React, { createRoot } = req('react-dom/client');
const { QueryClient } = req('@tanstack/react-query'), ts = req('typescript');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const childId = '11111111-1111-4111-8111-111111111111', inputId = '22222222-2222-4222-8222-222222222222';
const readFailure = '讀取未能確認，私人原文及草稿保留。請手動重新讀取。';
const input = (patch = {}) => ({ id: inputId, childId, ownerUserId: 'synthetic-parent', version: 1,
  createdAt: '2026-10-10T00:00:00Z', canManage: true, kind: 'personal_source', sourceNotes: '', sourceId: null,
  sourceLabel: 'Synthetic private source', sourceUrl: 'https://synthetic.invalid/source', sourceDateText: null,
  text: 'Synthetic private text', sha256: 'a'.repeat(64), retrievedAt: null, fetchState: 'not_requested',
  extraction: { state: 'not_requested', runId: null, excerpt: null, draft: null, stopReason: null, processedAt: null, model: null },
  recordId: null, confirmationKind: null, management: null, ...patch });
const page = (items = [input()]) => json({ inputs: items, sources: [], canCreate: true });
const createInput = { kind: 'personal_source', sourceLabel: 'Synthetic private source', sourceUrl: null,
  sourceDateText: null, sourceNotes: '', text: 'Synthetic new text' };
const audits = [];

// Real React owner, QueryClient, SharedInputApi, online transport and response parsers.
// Only environment/navigation ports and native platform are doubled. No browser or live backend coverage.
function fixture() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://synthetic.invalid/sources' });
  Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  let nativeCalls = 0, projection, env, selectedInput = input();
  const previousFetch = global.fetch;
  global.fetch = () => { nativeCalls++; throw new Error('Native network is forbidden'); };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const requests = [], listResponses = [], detailResponses = [], receiptResponses = [], submitResponses = [], accessLoss = [], dirtySignals = [];
  const makeEnvironment = identityKey => {
    const scopeKey = `${identityKey}:${childId}`;
    return { scopeKey, identityKey, childId, userId: 'synthetic-parent', childName: 'Synthetic child', role: 'owner', online: true,
      apiBaseUrl: '/api', queryClient: client, current: () => env.scopeKey === scopeKey,
      currentIdentity: () => env.identityKey === identityKey, canStartWrite: () => true, invalidate() {},
      accessError: error => accessLoss.push({ scopeKey, error }) };
  };
  env = makeEnvironment('identity-1');
  const respond = (queue, fallback, context) => queue.length ? queue.shift()(context) : fallback();
  const transport = async (url, init) => {
    const pathname = new URL(url, 'https://synthetic.invalid').pathname;
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ path: pathname, method: init.method, body });
    assert.equal(init.headers['x-expected-user-id'], 'synthetic-parent');
    if (pathname === '/api/online/context') {
      assert.equal(init.method, 'POST');
      return json({ workspaceId: '33333333-3333-4333-8333-333333333333', storageEpoch: '44444444-4444-4444-8444-444444444444' });
    }
    if (pathname === '/api/online/submit') {
      assert.equal(init.method, 'POST'); assert.ok(submitResponses.length, 'Every synthetic submit must be explicitly queued');
      return respond(submitResponses, () => { throw new Error('Unexpected submit'); }, { body, signal: init.signal });
    }
    assert.equal(init.method, 'GET', 'No direct fetch/extract/model or other write is permitted');
    if (pathname.startsWith('/api/online/operations/')) {
      assert.ok(receiptResponses.length, 'Every receipt lookup must be explicitly queued');
      return respond(receiptResponses, () => { throw new Error('Unexpected receipt lookup'); }, { path: pathname, signal: init.signal });
    }
    if (pathname === `/api/children/${childId}/inputs`) return respond(listResponses, () => page([selectedInput]), { signal: init.signal });
    assert.equal(pathname, `/api/children/${childId}/inputs/${inputId}`);
    return respond(detailResponses, () => json({ input: selectedInput }), { signal: init.signal });
  };
  const cache = new Map();
  function compile(relative) {
    const file = path.resolve(source, relative);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    new Function('require', 'module', 'exports', js)(name => {
      if (name === 'react-native') return { Platform: { OS: 'web' } };
      if (name === 'expo-router') return { usePathname: () => '/sources' };
      if (name.endsWith('/useDomainEnvironment')) return { forSharedModule:env=>env,useDomainEnvironment: () => env,
        useDomainWriteGuard: (dirty, pending) => dirtySignals.push({ dirty, pending }) };
      if (name.endsWith('/ProductionProvider')) return { useProduction: () => ({ chatDraft: '', setChatDraft() {}, openAgentDraft() {} }) };
      if (name.endsWith('/PreviewNavigationGuard')) return { usePreviewNavigation: () => action => action() };
      if (name.endsWith('/use-online-updates')) return { ONLINE_REFRESH_EVENT: 'yuban-online-refresh' };
      if (!name.startsWith('.')) return req(name);
      const target = path.resolve(path.dirname(file), name);
      const resolved = fs.existsSync(target) ? target : fs.existsSync(target + '.ts') ? target + '.ts' : target + '.tsx';
      const value = compile(resolved);
      return name.endsWith('/shared-input-api') ? { ...value, createSharedInputApi: base => value.createSharedInputApi(base, transport) } : value;
    }, module, module.exports);
    return module.exports;
  }
  const { usePhotoInputSources } = compile('frontend/src/production/usePhotoInputSources.ts');
  function Owner() { projection = usePhotoInputSources(); return null; }
  const root = createRoot(document.getElementById('root'));
  const settle = () => act(async () => { await tick(); });
  const render = () => act(async () => { root.render(React.createElement(Owner, { key: env.scopeKey })); await tick(); });
  return { requests, listResponses, detailResponses, receiptResponses, submitResponses, accessLoss, dirtySignals, settle,
    get: () => projection, setInput: value => { selectedInput = value; },
    async start() { await render(); await settle(); },
    async action(fn) { await act(async () => { fn(projection.actions); await tick(); }); },
    async autoRefresh() { await act(async () => { window.dispatchEvent(new window.Event('yuban-online-refresh')); await tick(); }); },
    async switchIdentity() { env = makeEnvironment('identity-2'); await render(); await settle(); },
    async resolve(wait, response) { await act(async () => { wait.resolve(response); await tick(); }); },
    async close() {
      await act(async () => root.unmount()); client.clear(); dom.window.close(); global.fetch = previousFetch;
      audits.push({ requests, nativeCalls }); assert.equal(nativeCalls, 0);
    },
  };
}
const assertReadOnly = h => assert.ok(h.requests.every(request => request.method === 'GET'));

test('initial 503 and failed manual retry keep the notice; successful automatic read clears it', async () => {
  const h = fixture();
  try {
    h.listResponses.push(() => json({}, 503)); await h.start();
    assert.equal(h.get().model.load, 'error'); assert.equal(h.get().model.notice, readFailure);
    h.listResponses.push(() => json({}, 503)); await h.action(a => a.refresh());
    assert.equal(h.get().model.load, 'error'); assert.equal(h.get().model.notice, readFailure);
    const before = h.requests.length; await h.settle(); assert.equal(h.requests.length, before, 'No implicit error retry');
    await h.autoRefresh();
    assert.equal(h.get().model.load, 'ready'); assert.equal(h.get().model.notice, '');
    assert.equal(h.get().model.canChoose, true); assert.equal(h.get().model.items.length, 1); assertReadOnly(h);
  } finally { await h.close(); }
});

test('successful recovery preserves manual and management drafts, formKey, source and dirty guard', async () => {
  const h = fixture();
  try {
    await h.start(); await h.action(a => a.openInput(h.get().model.items[0]));
    await h.action(a => { a.editDraft({ ...h.get().model.draft, text: 'Unsaved synthetic manual draft' }); a.management.setReason('Unsaved synthetic reason'); });
    const before = h.get().model, draft = before.draft, managementDraft = before.managementDraft, key = before.formKey;
    h.listResponses.push(() => json({}, 503)); await h.autoRefresh();
    h.listResponses.push(() => json({}, 503)); await h.action(a => a.refresh());
    assert.equal(h.get().model.notice, readFailure);
    await h.autoRefresh();
    const after = h.get().model;
    assert.equal(after.load, 'ready'); assert.equal(after.notice, ''); assert.equal(after.formKey, key);
    assert.equal(after.draft, draft); assert.equal(after.managementDraft, managementDraft);
    assert.equal(after.selected.id, inputId); assert.equal(after.selected.text, 'Synthetic private text');
    assert.equal(after.formLocked, false); assert.deepEqual(h.dirtySignals.at(-1), { dirty: true, pending: false }); assertReadOnly(h);
  } finally { await h.close(); }
});

test('list success alone cannot clear a selected-detail read failure before that detail succeeds', async () => {
  const h = fixture(), wait = deferred();
  try {
    await h.start(); await h.action(a => a.openInput(h.get().model.items[0]));
    h.detailResponses.push(() => json({}, 503)); await h.autoRefresh();
    assert.equal(h.get().model.notice, readFailure);
    h.detailResponses.push(() => wait.promise); await h.autoRefresh();
    assert.equal(h.get().model.busy, true); assert.equal(h.get().model.notice, readFailure);
    await h.resolve(wait, json({}, 503)); assert.equal(h.get().model.notice, readFailure);
    await h.autoRefresh(); assert.equal(h.get().model.notice, ''); assert.equal(h.get().model.load, 'ready'); assertReadOnly(h);
  } finally { wait.resolve(json({}, 503)); await h.close(); }
});

test('missing-resource notice survives successful refresh and current late 403 still clears private state', async () => {
  const h = fixture(), wait = deferred();
  try {
    await h.start(); await h.action(a => a.openInput(h.get().model.items[0]));
    h.detailResponses.push(() => json({}, 404)); await h.autoRefresh();
    const missing = h.get().model.notice;
    assert.match(missing, /所選來源已刪除或目前不可讀/); assert.equal(h.get().model.selected, null);
    await h.autoRefresh(); assert.equal(h.get().model.notice, missing);
    await h.action(a => a.openInput(h.get().model.items[0]));
    await h.action(a => a.editDraft({ ...h.get().model.draft, text: 'Private synthetic draft' }));
    h.detailResponses.push(() => wait.promise); await h.autoRefresh();
    await h.resolve(wait, json({}, 403));
    assert.equal(h.get().model.access, 'lost'); assert.equal(h.get().model.draft.text, ''); assert.equal(h.get().model.selected, null);
    assert.match(h.get().model.notice, /登入或孩子權限已改變/); assert.equal(h.accessLoss.length, 1);
    const before = h.requests.length; await h.autoRefresh(); assert.equal(h.requests.length, before); assertReadOnly(h);
  } finally { wait.resolve(json({}, 403)); await h.close(); }
});

test('unknown write keeps its same receipt through unconfirmed and confirmed-unavailable reads without resubmission', async () => {
  const h = fixture();
  try {
    await h.start(); h.submitResponses.push(() => json({}, 503)); await h.action(a => a.create(createInput));
    assert.equal(h.get().model.operation.state, 'unknown'); assert.equal(h.get().pending, true);
    const submit = h.requests.find(request => request.path === '/api/online/submit'); assert.ok(submit);
    h.receiptResponses.push(() => json({ state: 'unconfirmed' })); await h.autoRefresh();
    assert.equal(h.get().model.load, 'ready'); assert.equal(h.get().model.operation.state, 'unconfirmed');
    assert.equal(h.get().model.operation.checked, true); assert.equal(h.get().model.canChoose, false); assert.equal(h.get().pending, true);
    h.receiptResponses.push(() => json({ state: 'confirmed', operation: submit.body.operation, changeSeq: '1', statusCode: 200, result: { invalid: true } }));
    await h.autoRefresh(); assert.equal(h.get().model.operation.state, 'confirmed_unavailable');
    await h.autoRefresh();
    assert.equal(h.get().model.operation.state, 'confirmed_unavailable'); assert.equal(h.get().model.operation.checked, true);
    assert.equal(h.get().pending, true); assert.equal(h.get().model.canChoose, false);
    const lookups = h.requests.filter(request => request.path.startsWith('/api/online/operations/'));
    assert.equal(lookups.length, 2); assert.ok(lookups.every(request => request.path.endsWith(submit.body.operation.opId)));
    assert.equal(h.requests.filter(request => request.path === '/api/online/submit').length, 1);
    assert.equal(h.requests.filter(request => request.method === 'POST').length, 2, 'Only synthetic context and original submit');
  } finally { await h.close(); }
});

test('direct unknown processing and version conflict retain their original recovery gates', async () => {
  const h = fixture();
  try {
    h.setInput(input({ fetchState: 'unknown' })); await h.start(); await h.action(a => a.openInput(h.get().model.items[0]));
    assert.equal(h.get().model.operation.state, 'unknown'); const originalDirect = h.get().model.direct;
    await h.autoRefresh();
    assert.equal(h.get().model.operation.state, 'unconfirmed'); assert.equal(h.get().model.direct.basisVersion, originalDirect.basisVersion);
    assert.equal(h.get().pending, true); assert.equal(h.get().model.canChoose, false);
    await h.action(a => a.endDirect()); const ended = h.get().model.notice;
    await h.autoRefresh(); assert.equal(h.get().model.notice, ended, 'Non-read recovery notices are not erased');
    await h.action(a => a.editDraft({ ...h.get().model.draft, text: 'Unsaved conflict draft' }));
    h.setInput(input({ version: 2 })); await h.autoRefresh();
    assert.equal(h.get().model.operation.state, 'conflict'); assert.equal(h.get().model.latest.version, 2);
    const operation = h.get().model.operation; await h.autoRefresh();
    assert.deepEqual(h.get().model.operation, operation); assert.equal(h.get().model.draft.text, 'Unsaved conflict draft');
    assert.equal(h.get().model.formLocked, true); assertReadOnly(h);
  } finally { await h.close(); }
});

for (const status of [200, 403]) test(`old identity late ${status} cannot clear a new identity read failure`, async () => {
  const h = fixture(), wait = deferred();
  try {
    await h.start(); h.listResponses.push(() => wait.promise); await h.autoRefresh();
    const oldRefresh = h.get().actions.refresh;
    h.listResponses.push(() => json({}, 503)); await h.switchIdentity();
    assert.equal(h.get().model.notice, readFailure);
    const before = h.requests.length; await h.action(() => oldRefresh()); assert.equal(h.requests.length, before);
    await h.resolve(wait, status === 200 ? page() : json({}, status));
    assert.equal(h.get().model.load, 'error'); assert.equal(h.get().model.notice, readFailure); assert.deepEqual(h.accessLoss, []);
    await h.autoRefresh(); assert.equal(h.get().model.notice, ''); assertReadOnly(h);
  } finally { wait.resolve(page()); await h.close(); }
});

test.after(() => {
  if (process.env.SOURCE_READ_AUDIT) fs.writeFileSync(process.env.SOURCE_READ_AUDIT, JSON.stringify(audits, null, 2) + '\n');
});
