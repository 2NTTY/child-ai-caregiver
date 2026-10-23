const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const test = require('node:test');
const source = path.resolve(__dirname, '../..');
const req = createRequire(path.join(source, 'frontend/package.json'));
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for an existing jsdom installation.');
const { JSDOM } = require(process.env.JSDOM_MODULE);
const React = req('react'), { act } = React, { createRoot } = req('react-dom/client');
const { QueryClient } = req('@tanstack/react-query'), ts = req('typescript');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const childId = '11111111-1111-4111-8111-111111111111';
const inputId = '22222222-2222-4222-8222-222222222222';
const at = '2026-10-23T00:00:00Z';
const summaryPage = period => ({ childId, childName: 'Synthetic child', canManage: true, period, endDayExclusive: '2026-10-30',
  profile: { childId, version: 0, data: null, confirmedBy: null, confirmedAt: null, reason: null },
  generatedAt: at, basisVersion: 'synthetic-basis',
  counts: { note: 0, feeding: 0, sleep: 0, diaper: 0, temperature: 0, measurement: 0, appointment: 0 },
  metrics: [], records: [], appointments: [], conflicts: [], missing: { unknownEventTime: 0, invalidQuantities: 0, emptyKinds: [] },
  preparation: { version: 0, appointmentTaskId: null, questions: [], checklist: [], reviewed: false, reviewedBasis: null, period: null, updatedBy: null, updatedAt: null }, reviewCurrent: false });
const sourceInput = () => ({ id: inputId, childId, ownerUserId: 'parent', version: 1, createdAt: at, canManage: true,
  kind: 'personal_source', sourceNotes: '', sourceId: null, sourceLabel: 'Synthetic source', sourceUrl: 'https://synthetic.invalid/source', sourceDateText: null,
  text: 'Synthetic source text', sha256: null, retrievedAt: null, fetchState: 'not_requested',
  extraction: { state: 'not_requested', runId: null, excerpt: null, draft: null, stopReason: null, processedAt: null, model: null },
  recordId: null, confirmationKind: null, management: null });

const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes)
  : [tree, ...nodes(tree.props?.children), ...nodes(tree.props?.action)];
function sourcesTree(model) {
  const jsx = (type, props) => ({ type, props }), elements = new Proxy({}, { get: (_target, key) => String(key) });
  const imports = {
    react: { useState: value => [value, () => {}], useRef: value => ({ current: value }), useEffect() {} },
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'react-native': { View: 'View' }, 'react-native-paper': { Text: 'Text' },
    '../../preview/PreviewNavigationGuard': { usePreviewNavigation: () => action => action() },
    '../useContainerWidth': { useContainerWidth: () => ({ width: 1000 }) },
    './useContentDeletionFocus': { useContentDeletionFocus: () => ({}) },
    './useContentListMotion': { useContentListMotion: () => false },
    '../../source-intake': { sourceIntakeIsUnresolved: () => false }, './source-styles': { sourceStyles: {} },
  };
  const module = { exports: {} };
  const code = fs.readFileSync(path.join(source, 'frontend/src/components/shared-inputs/SourcesView.tsx'), 'utf8');
  new Function('require', 'module', 'exports', ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText)(name => imports[name] ?? elements, module, module.exports);
  return module.exports.SourcesView({ model, actions: {}, onPhotos() {}, onRecord() {}, previewControls: null });
}

test('sources read notice, count and empty card stay stable while controls are busy', () => {
  const model = { scopeKey: 'synthetic', access: 'editable', online: true, load: 'ready', fresh: true, readFresh: true,
    busy: false, canCreate: true, items: [], selected: null, operation: { state: 'none' }, deleteOpen: false };
  for (const busy of [false, true]) {
    const tree = sourcesTree({ ...model, busy, fresh: !busy });
    assert.equal(nodes(tree).find(node => node.type === 'ReadStateNotice').props.state, 'ready');
    assert.equal(nodes(tree).find(node => node.type === 'SectionHeader' && node.props.title === '我的私人來源').props.count, 0);
    assert.equal(nodes(tree).filter(node => node.type === 'EmptyListCard').length, 1);
  }
  for (const [patch, state] of [[{ load: 'loading', readFresh: false }, 'loading'], [{ load: 'error', readFresh: false }, 'error'],
    [{ online: false, readFresh: false }, 'stale'], [{ fresh: false, readFresh: false }, 'stale']]) {
    assert.equal(nodes(sourcesTree({ ...model, ...patch })).find(node => node.type === 'ReadStateNotice').props.state, state);
  }
});

// Real hooks, runtime, QueryClient and API parsers with synthetic transport only.
// This does not measure browser paint, scrolling or live Server behavior.
function fixture(kind, { populated = false, confirmedSave = false } = {}) {
  const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://synthetic.invalid/' });
  Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const previousFetch = global.fetch;
  let nativeCalls = 0, value, env, interceptor = () => null;
  global.fetch = () => { nativeCalls++; throw new Error('Real network is forbidden'); };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const data = { inputs: populated ? [sourceInput()] : [] }, requests = [], accessLoss = [], saved = [];
  const sourcePage = () => ({ inputs: data.inputs, sources: [], canCreate: true });
  const transport = async (url, init) => {
    const parsed = new URL(url, 'https://synthetic.invalid');
    assert.equal(init.method, 'GET', 'Only synthetic reads are allowed');
    const entry = { path: parsed.pathname, query: Object.fromEntries(parsed.searchParams), signal: init.signal };
    requests.push(entry);
    const override = interceptor(entry); if (override) return await override;
    if (entry.path.endsWith('/summary')) return json(summaryPage(entry.query));
    if (entry.path.endsWith('/inputs')) return json(sourcePage());
    if (entry.path.endsWith(`/inputs/${inputId}`)) return json({ input: data.inputs[0] });
    throw new Error(`Unexpected request: ${entry.path}`);
  };
  const makeEnv = (scopeKey, apiBaseUrl = '/api') => ({ scopeKey, identityKey: scopeKey, childId, childName: 'Synthetic child', userId: 'parent',
    role: 'owner', online: true, apiBaseUrl, queryClient, owner: { fetcher: transport },
    current: () => env.scopeKey === scopeKey, currentIdentity: () => env.scopeKey === scopeKey, canStartWrite: () => true,
    invalidate() {}, accessError: error => accessLoss.push(error) });
  env = makeEnv('scope-a');
  const cache = new Map();
  function compile(relative) {
    const file = path.resolve(source, relative);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    new Function('require', 'module', 'exports', js)(name => {
      if (name.endsWith('/useDomainEnvironment')) return { useDomainEnvironment: () => env, useDomainWriteGuard() {} };
      if (name === './ProductionProvider') return { useProduction: () => ({}) };
      if (name.endsWith('/PreviewNavigationGuard')) return { usePreviewNavigation: () => action => action() };
      if (name === 'expo-router') return { usePathname: () => '/sources' };
      if (!name.startsWith('.')) return req(name);
      const target = path.resolve(path.dirname(file), name);
      const result = compile(fs.existsSync(target) ? target : fs.existsSync(target + '.ts') ? target + '.ts' : target + '.tsx');
      if (confirmedSave && name.endsWith('/care-summary-api')) return { ...result, createCareSummaryApi: (...args) => ({ ...result.createCareSummaryApi(...args),
        async savePreparation(_child, input) { saved.push(input); throw new result.CareSummaryApiError(0, null, true); } }) };
      return result;
    }, module, module.exports);
    return module.exports;
  }
  const hook = kind === 'summary' ? compile('frontend/src/production/task-knowledge-summary.ts').useTaskKnowledgeSummary
    : compile('frontend/src/production/usePhotoInputSources.ts').usePhotoInputSources;
  function Owner() { value = hook(env); return null; }
  const root = createRoot(document.getElementById('root'));
  const flush = fn => act(async () => { fn?.(); await tick(); });
  const render = () => flush(() => root.render(React.createElement(Owner, { key: env.scopeKey })));
  return { data, requests, accessLoss, saved, sourcePage, get: () => value, intercept: fn => { interceptor = fn; },
    async start() { await render(); await flush(); },
    action: fn => flush(() => fn(value)),
    refresh: () => flush(() => window.dispatchEvent(new window.Event('yuban-online-refresh'))),
    resolve: (wait, response) => flush(() => wait.resolve(response)),
    async environment(patch) { env = { ...env, ...patch }; await render(); },
    async scope(next, apiBaseUrl) { env = makeEnv(next, apiBaseUrl); await render(); await flush(); },
    async close() { await act(async () => root.unmount()); queryClient.clear(); dom.window.close(); global.fetch = previousFetch; assert.equal(nativeCalls, 0); },
  };
}

test('automatic summary refresh uses the applied period and never commits edited or invalid query fields', async () => {
  const h = fixture('summary');
  try {
    await h.start(); const applied = h.get().model.page.period;
    const draft = { startDay: '2026-08-03', period: 'day', timeZone: 'UTC' };
    await h.action(v => v.actions.updateQuery(draft));
    await h.refresh();
    assert.deepEqual(h.requests.at(-1).query, applied);
    assert.deepEqual(h.get().model.query, draft);
    assert.deepEqual(h.get().model.page.period, applied);
    await h.action(v => v.actions.updateQuery({ ...draft, startDay: 'incomplete' }));
    const before = h.requests.length; await h.refresh();
    assert.equal(h.requests.length, before + 1, 'Invalid draft fields must not suppress permission revalidation');
    assert.deepEqual(h.requests.at(-1).query, applied);
    await h.action(v => v.actions.updateQuery(draft));
    await h.action(v => v.actions.refresh());
    assert.deepEqual(h.get().model.page.period, draft, 'Only explicit application commits the edited period');
    await h.refresh(); assert.deepEqual(h.requests.at(-1).query, draft);
  } finally { await h.close(); }
});

test('a failed first summary read retains the original request basis for automatic recovery', async () => {
  const h = fixture('summary');
  try {
    h.intercept(() => json({}, 503)); await h.start();
    const initial = h.requests[0].query;
    await h.action(v => v.actions.updateQuery({ ...initial, startDay: '2026-08-03' }));
    h.intercept(() => null); await h.refresh();
    assert.deepEqual(h.get().model.page.period, initial);
    assert.equal(h.get().model.query.startDay, '2026-08-03');
  } finally { await h.close(); }
});

test('summary pending recovery keeps its original period, input and confirmed-write prohibition', async () => {
  const h = fixture('summary', { confirmedSave: true });
  try {
    await h.start(); const page = h.get().model.page;
    await h.action(v => v.actions.updateQuery({ ...page.period, startDay: '2026-08-03' }));
    const input = { expectedVersion: page.preparation.version, basisVersion: page.basisVersion, period: page.period,
      confirmShared: true, appointmentTaskId: null, questions: ['Synthetic question'], checklist: [], reviewed: false };
    await h.action(v => v.actions.save(input, 'Synthetic appointment'));
    assert.equal(h.get().model.pending.confirmed, true);
    await h.action(v => v.actions.retryOriginal()); assert.equal(h.saved.length, 1);
    await h.refresh();
    assert.deepEqual(h.requests.at(-1).query, input.period);
    assert.deepEqual(h.saved[0], input); assert.equal(h.saved.length, 1);
    assert.equal(h.get().model.pending, null);
  } finally { await h.close(); }
});

test('sources preserve a loaded empty snapshot during GET while new writes remain locked', async () => {
  const h = fixture('sources'), wait = deferred();
  try {
    h.intercept(() => wait.promise); await h.start();
    assert.equal(h.get().model.load, 'loading'); assert.equal(h.get().model.readFresh, false);
    await h.resolve(wait, json(h.sourcePage()));
    assert.equal(h.get().model.readFresh, true);
    const background = deferred(); h.intercept(() => background.promise); await h.refresh();
    assert.equal(h.get().model.busy, true); assert.equal(h.get().model.readFresh, true);
    assert.equal(h.get().model.fresh, false); assert.equal(h.get().model.canChoose, false); assert.equal(h.get().model.formLocked, true);
    const count = h.requests.length;
    await h.action(v => v.actions.create({ kind: 'paste', sourceLabel: 'Synthetic', sourceUrl: null, sourceDateText: null, text: 'Synthetic text' }));
    assert.equal(h.requests.length, count);
    await h.resolve(background, json(h.sourcePage())); assert.equal(h.get().model.fresh, true);
  } finally { wait.resolve(json(h.sourcePage())); await h.close(); }
});

test('sources keep selected content but lock fetch, extract, confirm, delete and draft edits during GET', async () => {
  const h = fixture('sources', { populated: true }), wait = deferred();
  try {
    await h.start(); await h.action(v => v.actions.openInput(v.model.items[0]));
    const selected = h.get().model.selected, draft = h.get().model.managementDraft;
    h.intercept(request => request.path.endsWith('/inputs') ? wait.promise : null); await h.refresh();
    assert.equal(h.get().model.selected.id, selected.id); assert.equal(h.get().model.readFresh, true);
    for (const capability of ['canChoose', 'canFetch', 'canExtract', 'canConfirm', 'canDelete']) assert.equal(h.get().model[capability], false, capability);
    await h.action(v => { v.actions.management.edit({ intention: 'Should not apply' }); v.actions.fetchContent(); v.actions.extract(); v.actions.confirm(); v.actions.remove(); });
    assert.deepEqual(h.get().model.managementDraft, draft);
    await h.resolve(wait, json(h.sourcePage()));
  } finally { wait.resolve(json(h.sourcePage())); await h.close(); }
});

test('sources still expose real read failures, offline status and version conflicts', async () => {
  const h = fixture('sources', { populated: true });
  try {
    await h.start(); await h.action(v => v.actions.openInput(v.model.items[0]));
    h.intercept(() => json({}, 503)); await h.refresh();
    assert.equal(h.get().model.load, 'error'); assert.equal(h.get().model.readFresh, false);
    h.intercept(() => null); await h.refresh(); assert.equal(h.get().model.readFresh, true);
    await h.environment({ online: false }); assert.equal(h.get().model.readFresh, false);
    await h.environment({ online: true });
    h.data.inputs[0] = { ...h.data.inputs[0], version: 2 }; await h.refresh();
    assert.equal(h.get().model.operation.state, 'conflict'); assert.equal(h.get().model.readFresh, false);
  } finally { await h.close(); }
});

test('a sources list success does not hide a failed selected-detail read before recovery settles', async () => {
  const h = fixture('sources', { populated: true }), wait = deferred();
  try {
    await h.start(); await h.action(v => v.actions.openInput(v.model.items[0]));
    h.intercept(request => request.path.endsWith(`/inputs/${inputId}`) ? json({}, 503) : null); await h.refresh();
    assert.equal(h.get().model.load, 'error');
    h.intercept(request => request.path.endsWith(`/inputs/${inputId}`) ? wait.promise : null); await h.refresh();
    assert.equal(h.get().model.busy, true);
    assert.equal(h.get().model.readFresh, false, 'The old failed detail still needs to be checked');
    assert.equal(h.get().model.load, 'error');
    await h.resolve(wait, json({ input: h.data.inputs[0] }));
    assert.equal(h.get().model.readFresh, true); assert.equal(h.get().model.load, 'ready');
  } finally { wait.resolve(json({ input: h.data.inputs[0] })); await h.close(); }
});

test('summary keeps the real API period authority checks on automatic refresh', async () => {
  const h = fixture('summary');
  try {
    await h.start(); const original = h.get().model.page;
    h.intercept(request => json(summaryPage({ ...request.query, startDay: '2026-08-03' }))); await h.refresh();
    assert.equal(h.get().model.readFailed, true); assert.equal(h.get().model.page, original);
  } finally { await h.close(); }
});

for (const kind of ['summary', 'sources']) {
  test(`${kind} automatic permission loss clears prior data instead of preserving it as fresh`, async () => {
    const h = fixture(kind, { populated: true });
    try {
      await h.start(); h.intercept(() => json({}, 403)); await h.refresh();
      assert.equal(h.get().model.access, 'lost'); assert.equal(h.accessLoss.length, 1);
      if (kind === 'summary') assert.equal(h.get().model.page, null);
      else { assert.deepEqual(h.get().model.items, []); assert.equal(h.get().model.readFresh, false); }
    } finally { await h.close(); }
  });
  test(`${kind} scope and API authority replacement reject a late old GET`, async () => {
    const h = fixture(kind, { populated: true }), wait = deferred();
    try {
      await h.start();
      const oldPage = kind === 'summary' ? summaryPage(h.get().model.page.period) : h.sourcePage();
      h.intercept(request => request.path.startsWith('/api/') ? wait.promise : null); await h.refresh();
      await h.scope('scope-b', '/other-api');
      assert.equal(h.get().model.scopeKey, 'scope-b');
      const current = kind === 'summary' ? h.get().model.page : h.get().model.items;
      await h.resolve(wait, json(oldPage));
      assert.equal(kind === 'summary' ? h.get().model.page : h.get().model.items, current);
      assert.ok(h.requests.at(-1).path.startsWith('/other-api/api/'));
    } finally { wait.resolve(json({})); await h.close(); }
  });
}
