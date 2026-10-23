const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const test = require('node:test');
const source = path.resolve(process.env.PROFILE_HISTORY_SOURCE || path.join(__dirname, '../..'));
const req = createRequire(path.join(source, 'frontend/package.json'));
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for an existing jsdom installation; it is not a product dependency.');
const { JSDOM } = require(process.env.JSDOM_MODULE);
const React = req('react'), { act } = React, { createRoot } = req('react-dom/client');
const { QueryClient } = req('@tanstack/react-query'), ts = req('typescript');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const revision = (childId, version) => ({ childId, version, data: { age: { kind: 'unknown' }, dueDate: null, gestationalWeeksRaw: null,
  region: 'Synthetic region', language: null, allergies: null, specialNeeds: null, preferences: null, source: 'Synthetic fixture', validUntil: null },
  confirmedBy: 'qa-parent', confirmedAt: '2026-10-10T00:00:00Z', reason: 'Synthetic revision' });
const page = (childId, versions, nextBeforeVersion = null) => json({ revisions: versions.map(version => revision(childId, version)), nextBeforeVersion });

// Real domain bridge, keyed owner, QueryClient, Care API/parser and the moved ProfileHistoryView plus original editor conditions.
// Native layout, motion, and form presentation are bounded doubles, not browser coverage.
function fixture({ version = 4, initialFailure = false, editor = true, focusBridge = false, strict = false, historyVisible = true } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://synthetic.invalid/history?category=profile' });
  Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const previousEvent = global.Event; global.Event = dom.window.Event;
  Object.defineProperty(dom.window.document, "visibilityState", { value: "visible", configurable: true });
  let nativeCalls = 0;
  const previousFetch = global.fetch;
  global.fetch = () => { nativeCalls++; throw new Error('Native network is forbidden'); };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const requests = [], faults = [], currentResponses = [], accessLoss = [], dirtySignals = [], entryCalls = [];
  let profilePatch = {};
  let env, projection, formSerial = 0, ProfileView, ProfileHistoryView;
  const makeEnvironment = (childId, identityKey = 'parent:epoch-1') => {
    const scopeKey = `${identityKey}:${childId}`;
    return { scopeKey, identityKey, childId, userId: 'qa-parent', childName: `Synthetic ${childId}`, role: 'owner', online: true,
      owner: { fetcher: (...args) => transport(...args) }, apiBaseUrl: '/api', queryClient: client, current: () => env.scopeKey === scopeKey, currentIdentity: () => env.identityKey === identityKey,
      canStartWrite: () => true, invalidate() {}, accessError: error => accessLoss.push({ scopeKey, error }) };
  };
  env = makeEnvironment('child-a');
  const transport = async (url, init) => {
    const parsed = new URL(url, 'https://synthetic.invalid');
    requests.push({ path: parsed.pathname, method: init.method, before: parsed.searchParams.get('beforeVersion') });
    if (parsed.pathname === '/api/online/spaces') return json({workspaces: []});
    if (parsed.pathname === '/api/auth/get-session') return json({ user: { id: 'qa-parent' } });
    const childId = parsed.pathname.split('/')[3];
    if (parsed.pathname.endsWith('/care/search')) {
      assert.equal(init.method, 'POST');
      return json({ records: [], scanned: 0, limit: 50, nextCursor: null });
    }
    assert.equal(init.method, 'GET', 'Profile recovery never writes');
    if (parsed.pathname.endsWith('/profile/history')) {
      assert.ok(faults.length, 'Each history read requires an explicitly queued synthetic response');
      return faults.shift()({ childId, before: parsed.searchParams.get('beforeVersion'), signal: init.signal });
    }
    assert.ok(parsed.pathname.endsWith('/profile'), 'Unexpected request ' + parsed.pathname);
    if (currentResponses.length) return currentResponses.shift()({childId, signal: init.signal});
    if (initialFailure) { initialFailure = false; return json({}, 503); }
    return json({ profile: { ...revision(childId, version), ...(version === 0 ? {data: null, confirmedAt: null, confirmedBy: null, reason: null} : {}), ...profilePatch } });
  };
  const Empty = () => null, Wrap = ({ children }) => React.createElement(React.Fragment, null, children);
  const Button = ({ label, onPress, disabled }) => React.createElement('button', { onClick: onPress, disabled }, label);
  function Form({ initialValues, onEdit }) {
    const [region, setRegion] = React.useState(initialValues.region);
    const [instance] = React.useState(() => ++formSerial);
    return React.createElement('button', { 'data-form-instance': instance, 'data-region': region,
      onClick() { setRegion('Unsaved synthetic draft'); onEdit(); } }, 'Edit synthetic draft');
  }
  function ProfileProvider({ value, children }) {
    projection = value;
    return React.createElement(React.Fragment, null, children, editor && value && React.createElement(ProfileView,
      { model: value.model, actions: value.actions, onOpenCare() {}, childPicker: null, writeNotice: null, previewControls: null }),
      historyVisible && value && React.createElement(ProfileHistoryView, { model: value.model, scopeKey: value.scopeKey,
        actions: {...value.actions, showHistory() { entryCalls.push(value.scopeKey); value.actions.showHistory(); }} }));
  }
  const cache = new Map();
  function compile(relative) {
    const file = path.resolve(source, relative);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    new Function('require', 'module', 'exports', js)(name => {
      if (name === 'react-native') return { Platform: { OS: 'web' }, View: Wrap, Pressable: ({children, onPress, testID, accessibilityLabel}) => React.createElement('button', {'data-testid': testID, 'aria-label': accessibilityLabel, onClick: onPress}, children), StyleSheet: { create: value => value } };
      if (name === 'react-native-paper') return { Text: Wrap };
      if (name === 'expo-router') return { usePathname: () => '/history' };
      if (name.endsWith('/useDomainEnvironment')) return { useDomainEnvironment: () => env, useDomainWriteGuard: dirty => dirtySignals.push(dirty) };
      if (name.endsWith('/CareWorkspace')) return { CareWorkspaceProvider: Wrap };
      if (name.endsWith('/ProfileWorkspace')) return { ProfileWorkspaceProvider: ProfileProvider };
      if (name.endsWith('/useContainerWidth')) return { useContainerWidth: () => ({ width: 1000, ref: React.useRef(null), onLayout() {} }) };
      if (name.endsWith('/AppStatusBadge')) return { AppStatusBadge: Empty };
      if (name.endsWith('/EmptyListCard')) return { EmptyListCard: ({title, detail, testID}) => React.createElement('div', {'data-testid': testID}, title, detail) };
      if (name.endsWith('/ReadStateNotice')) return { ReadStateNotice: ({state, title, message, children}) => React.createElement('div', {'data-read-state': state}, title, message, children) };
      if (name.endsWith('/StatusAnnouncement')) return { StatusAnnouncement: Empty };
      if (name.endsWith('/FormDialog')) return { ManualFormDialog: Wrap, FormDialog: ({visible, children, title, onClose}) => visible ? React.createElement('section', {role: 'dialog', 'aria-label': title}, React.createElement('button', {onClick: onClose}, 'Close detail'), children) : null };
      if (name.endsWith('/ProfileForm')) return { ProfileForm: Form };
      if (name.endsWith('/ProfileSummary')) return { ProfileDataSummary: Empty, ProfileKeyFacts: Empty, ProfileReadingSummary: Empty, ProfileRevisionDetails: Empty,
        ProfileRevisionSummary: ({ revision }) => React.createElement('span', { 'data-revision': revision.version }, `Revision ${revision.version}`) };
      if (name.endsWith('/motion')) return { MotionDisclosure: ({ expanded, children }) => expanded ? children : null, MotionReveal: ({ children, value }) => children(value) };
      if (name.endsWith('/ui')) return { AppButton: Button, SectionCard: Wrap, SectionHeader: Empty, TextLink: Button };
      if (name.endsWith('/theme')) return { colors: {}, radius: {}, spacing: {}, typeScale: {}, readingType: {} };
      if (!name.startsWith('.')) return req(name);
      const target = path.resolve(path.dirname(file), name);
      const resolved = fs.existsSync(target) ? target : fs.existsSync(target + '.ts') ? target + '.ts' : target + '.tsx';
      const value = compile(resolved);
      return name.endsWith('/care-api') ? { ...value, createCareApi: base => value.createCareApi(base, transport) } : value;
    }, module, module.exports);
    return module.exports;
  }
  ProfileView = compile('frontend/src/components/profile/ProfileView.tsx').ProfileView;
  ProfileHistoryView = compile('frontend/src/components/profile/ProfileHistoryView.tsx').ProfileHistoryView;
  const { ProductionCareProfileDomains } = compile('frontend/src/production/CareProfileDomains.tsx');
  const { useOnlineUpdates } = compile('src/client/use-online-updates.ts');
  function FocusBridge() { useOnlineUpdates('/api', env.userId, env.online, async () => {}, transport); return null; }
  const root = createRoot(document.getElementById('root'));
  const render = () => act(async () => { root.render(React.createElement(strict ? React.StrictMode : React.Fragment, null, focusBridge && React.createElement(FocusBridge), React.createElement(ProductionCareProfileDomains))); await tick(); });
  const button = label => [...document.querySelectorAll('button')].find(node => node.textContent === label);
  const settle = () => act(async () => { await tick(); });
  return { requests, faults, currentResponses, accessLoss, dirtySignals, entryCalls, button, settle, mount: render,
    async category(visible) { historyVisible = visible; await render(); await settle(); },
    changeCurrent(patch) { if (patch.version !== undefined) version = patch.version; profilePatch = patch; },
    async focus() { await act(async () => { dom.window.dispatchEvent(new dom.window.Event("focus")); await tick(); await tick(); }); },
    async revoke() { env = {...env, scopeKey: "", childId: null}; await render(); await settle(); },
    get: () => projection,
    historyRequests: () => requests.filter(request => request.path.endsWith('/profile/history')),
    form: () => document.querySelector('[data-form-instance]'),
    async start() { await render(); await settle(); assert.ok(projection.model.current); if (editor) await this.click('檔案詳情'); },
    async click(label) { const node = button(label); assert.ok(node, 'Missing button ' + label); assert.equal(node.disabled, false, 'Disabled button ' + label);
      await act(async () => { node.click(); await tick(); }); },
    async switchScope(childId, identityKey) { env = makeEnvironment(childId, identityKey); await render(); await settle(); if (editor) await this.click('檔案詳情'); },
    async close() { await act(async () => root.unmount()); client.clear(); dom.window.close(); global.fetch = previousFetch; global.Event = previousEvent; assert.equal(nativeCalls, 0); },
  };
}

test('cold category entry loads existing history through the real owner without a read button', async () => {
  const h = fixture({editor: false});
  try {
    h.faults.push(({childId}) => page(childId, [3, 2], 2)); await h.start();
    assert.deepEqual(h.historyRequests().map(request => request.before), ['4']);
    assert.equal(h.get().model.historyOpen, true);
    assert.deepEqual(h.get().model.history.map(value => value.version), [3, 2]);
    assert.ok(document.querySelector('[data-testid="profile-history-version-3"]'));
    assert.ok(document.querySelector('[data-testid="profile-history-version-2"]'));
    assert.equal(h.button('讀取修改歷史'), undefined); assert.equal(h.button('重新讀取修改歷史'), undefined);
    assert.equal(h.button('重試讀取修改歷史'), undefined); assert.equal(h.button('載入更早版本').disabled, false);
    assert.doesNotMatch(document.body.textContent, /按版本查閱|最新資料可到檔案頁/);
    h.faults.push(({childId}) => page(childId, [1])); await h.click('載入更早版本');
    assert.deepEqual(h.historyRequests().map(request => request.before), ['4', '2']);
    assert.deepEqual(h.get().model.history.map(value => value.version), [3, 2, 1]);
  } finally { await h.close(); }
});

test('StrictMode entry reads once and loaded history survives rerenders and category remounts', async () => {
  const h = fixture({editor: false, strict: true, historyVisible: false});
  try {
    await h.start(); assert.equal(h.historyRequests().length, 0, 'Other categories do not request profile history');
    h.faults.push(({childId}) => page(childId, [3, 2], 2)); await h.category(true);
    const history = h.get().model.history;
    assert.equal(h.historyRequests().length, 1); assert.equal(h.entryCalls.length, 1, 'Effect replay delegates to the real owner once');
    await h.mount(); await h.settle(); await h.category(false); await h.category(true);
    assert.equal(h.historyRequests().length, 1); assert.equal(h.entryCalls.length, 1); assert.equal(h.get().model.history, history);
    assert.equal(h.get().model.hasMoreHistory, true);
  } finally { await h.close(); }
});

test('failed first history read retains a manual retry, dirty draft and form identity across profile refresh', async () => {
  const h = fixture({historyVisible: false});
  try {
    await h.start(); await h.click('Edit synthetic draft');
    const form = h.form(), formKey = h.get().model.formKey;
    h.faults.push(() => json({}, 503)); await h.category(true);
    assert.equal(h.get().model.historyOpen, false); assert.match(h.get().model.notice, /未能讀取檔案歷史/);
    assert.equal(h.button('重試讀取修改歷史').disabled, false);
    await h.mount(); await h.category(false); await h.category(true);
    assert.equal(h.historyRequests().length, 1, 'Errors never cause automatic retries, including on re-entry');
    await h.click('重新讀取檔案');
    assert.equal(h.historyRequests().length, 1, 'Current profile refresh is not a history retry');
    assert.equal(h.form(), form); assert.equal(h.get().model.formKey, formKey);
    assert.equal(h.form().dataset.region, 'Unsaved synthetic draft'); assert.equal(h.dirtySignals.at(-1), true);
    h.faults.push(({childId}) => page(childId, [3, 2])); await h.click('重試讀取修改歷史');
    assert.equal(h.historyRequests().length, 2); assert.equal(h.get().model.historyOpen, true);
    assert.deepEqual(h.get().model.history.map(value => value.version), [3, 2]);
    assert.equal(h.get().model.notice, null); assert.equal(h.button('重試讀取修改歷史'), undefined);
    assert.equal(h.form(), form); assert.equal(h.form().dataset.region, 'Unsaved synthetic draft');
  } finally { await h.close(); }
});

test('successful empty history and current version zero are authoritative without a retry loop or invalid cursor', async () => {
  for (const version of [4, 0]) {
    const h = fixture({version, editor: false});
    try {
      if (version > 0) h.faults.push(({childId}) => page(childId, [])); await h.start();
      assert.deepEqual(h.get().model.history, []); assert.equal(h.get().model.historyOpen, version > 0);
      assert.ok(document.querySelector('[data-testid="profile-history-empty"]'));
      assert.equal(h.get().model.notice, null); assert.equal(h.button('重試讀取修改歷史'), undefined);
      assert.equal(h.button('載入更早版本'), undefined); await h.settle();
      assert.equal(h.historyRequests().length, version > 0 ? 1 : 0);
    } finally { await h.close(); }
  }
});

test('failed next page retains accumulated history and cursor; manual retry clears the error and appends once', async () => {
  const h = fixture({editor: false});
  try {
    h.faults.push(({childId}) => page(childId, [3, 2], 2)); await h.start();
    h.faults.push(() => json({}, 503)); await h.click('載入更早版本');
    assert.equal(h.get().model.historyOpen, true); assert.deepEqual(h.get().model.history.map(value => value.version), [3, 2]);
    assert.equal(h.get().model.hasMoreHistory, true); assert.equal(h.button('載入更早版本').disabled, false);
    assert.match(h.get().model.notice, /未能讀取檔案歷史/); assert.equal(h.button('重試讀取修改歷史'), undefined);
    await h.mount(); assert.equal(h.historyRequests().length, 2, 'The original next-page retry remains manual');
    h.faults.push(({childId}) => page(childId, [1])); await h.click('載入更早版本');
    assert.deepEqual(h.historyRequests().map(request => request.before), ['4', '2', '2']);
    assert.deepEqual(h.get().model.history.map(value => value.version), [3, 2, 1]);
    assert.equal(h.get().model.notice, null); assert.equal(h.get().model.hasMoreHistory, false);
  } finally { await h.close(); }
});

test('repeated owner actions during the entry read remain single-flight and expose no first-read button', async () => {
  const h = fixture({editor: false, strict: true}), wait = deferred();
  try {
    h.faults.push(() => wait.promise); await h.start();
    await act(async () => { h.get().actions.showHistory(); h.get().actions.showHistory(); await tick(); });
    assert.equal(h.historyRequests().length, 1); assert.equal(h.get().model.reading, true);
    assert.equal(h.get().model.historyOpen, false); assert.equal(h.button('讀取修改歷史'), undefined);
    assert.equal(h.button('重試讀取修改歷史'), undefined);
    assert.ok(document.querySelector('[data-read-state="loading"]'));
    await act(async () => { wait.resolve(page('child-a', [3])); await tick(); });
    assert.deepEqual(h.get().model.history.map(value => value.version), [3]); assert.equal(h.get().model.historyOpen, true);
  } finally { wait.resolve(page('child-a', [])); await h.close(); }
});

for (const [name, childId, identityKey, status] of [
  ['child change rejects late success', 'child-b', 'parent:epoch-1', 200],
  ['identity epoch rejects late 403', 'child-a', 'parent:epoch-2', 403],
]) test(name, async () => {
  const h = fixture({editor: false}), wait = deferred();
  try {
    h.faults.push(() => wait.promise); await h.start(); const oldAction = h.get().actions.showHistory;
    h.faults.push(({childId}) => page(childId, [2])); await h.switchScope(childId, identityKey);
    const count = h.historyRequests().length;
    await act(async () => { oldAction(); wait.resolve(status === 200 ? page('child-a', [3]) : json({}, status)); await tick(); });
    assert.equal(h.historyRequests().length, count, 'Old callback cannot start a history request');
    assert.equal(count, 2, 'The new identity loads its own first page once');
    assert.equal(h.get().model.child.id, childId); assert.deepEqual(h.get().model.history.map(value => value.version), [2]);
    assert.equal(h.get().model.historyOpen, true); assert.equal(h.get().model.notice, null); assert.deepEqual(h.accessLoss, []);
  } finally { wait.resolve(page('child-a', [])); await h.close(); }
});

test('a delayed 403 in the current scope still reaches the access-loss owner instead of becoming a retry error', async () => {
  const h = fixture({editor: false}), wait = deferred();
  try {
    h.faults.push(() => wait.promise); await h.start();
    await act(async () => { wait.resolve(json({}, 403)); await tick(); });
    assert.deepEqual(h.accessLoss, [{scopeKey: 'parent:epoch-1:child-a', error: {status: 403, code: null}}]);
    assert.equal(h.get().model.notice, null); assert.deepEqual(h.get().model.history, []);
    assert.equal(h.button('重試讀取修改歷史'), undefined);
    const stale = h.get().actions.showHistory, count = h.historyRequests().length;
    await h.revoke(); await act(async () => { stale(); await tick(); });
    assert.equal(h.get(), null); assert.equal(h.historyRequests().length, count);
  } finally { wait.resolve(page('child-a', [])); await h.close(); }
});

test('approved profile modal discard clears the UI draft only and rejects a stale scope callback', async () => {
  const h = fixture();
  try {
    h.faults.push(({childId}) => page(childId, [3])); await h.start();
    const saved = structuredClone(h.get().model.current), oldKey = h.get().model.formKey;
    await h.click('Edit synthetic draft'); assert.equal(h.dirtySignals.at(-1), true);
    await act(async () => { h.get().actions.discardDraft(); await tick(); });
    assert.equal(h.dirtySignals.at(-1), false); assert.deepEqual(h.get().model.current, saved);
    assert.equal(h.get().model.initialValues.region, saved.data.region); assert.equal(h.get().model.formKey, oldKey + 1);
    assert.equal(h.get().model.reviewedValues, null); assert.equal(h.requests.some(request => request.method !== 'GET' && !request.path.endsWith('/care/search')), false);
    const stale = h.get().actions.discardDraft;
    h.faults.push(({childId}) => page(childId, [3])); await h.switchScope('child-b', 'parent:epoch-1');
    await h.click('Edit synthetic draft'); const key = h.get().model.formKey;
    await act(async () => { stale(); await tick(); }); assert.equal(h.get().model.formKey, key);
    assert.equal(h.dirtySignals.at(-1), true); assert.equal(h.form().dataset.region, 'Unsaved synthetic draft');
  } finally { await h.close(); }
});

test('failed current-profile cold read exposes recovery and only then admits the first history page', async () => {
  const h = fixture({initialFailure: true, editor: false});
  try {
    await h.mount(); await h.settle();
    assert.equal(h.get().model.needsRefresh, true); assert.equal(h.get().model.reading, false);
    assert.equal(document.querySelector('[data-testid="profile-history-empty"]'), null);
    assert.equal(h.button('重新讀取檔案').disabled, false); assert.equal(h.historyRequests().length, 0);
    h.faults.push(({childId}) => page(childId, [3])); await h.click('重新讀取檔案'); await h.settle();
    assert.equal(h.get().model.needsRefresh, false); assert.equal(h.button('重新讀取檔案'), undefined);
    assert.equal(h.historyRequests().length, 1); assert.deepEqual(h.get().model.history.map(value => value.version), [3]);
  } finally { await h.close(); }
});

test('window focus keeps same-canonical paged history and its cursor without another history request', async () => {
  const h = fixture({focusBridge: true, editor: false});
  try {
    h.faults.push(({childId}) => page(childId, [3, 2], 2)); await h.start();
    const savedHistory = h.get().model.history, count = h.historyRequests().length;
    const currentReads = h.requests.filter(request => request.path.endsWith('/profile')).length;
    await h.focus();
    assert.ok(h.requests.filter(request => request.path.endsWith('/profile')).length > currentReads, 'The real focus pipeline refreshed current canonical data');
    assert.equal(h.get().model.historyOpen, true); assert.equal(h.get().model.history, savedHistory);
    assert.equal(h.get().model.hasMoreHistory, true); assert.equal(h.historyRequests().length, count);
    h.currentResponses.push(({childId}) => { const raw = revision(childId, 4); return json({profile: Object.fromEntries(Object.entries(raw).reverse())}); });
    await h.focus(); assert.equal(h.get().model.history, savedHistory);
    h.faults.push(({childId}) => page(childId, [1])); await h.click('載入更早版本');
    assert.deepEqual(h.historyRequests().map(request => request.before), ['4', '2']);
    assert.deepEqual(h.get().model.history.map(item => item.version), [3, 2, 1]);
    const fullyLoaded = h.get().model.history; await h.focus();
    assert.equal(h.get().model.history, fullyLoaded); assert.equal(h.get().model.hasMoreHistory, false);
    assert.equal(h.get().model.historyOpen, true); assert.equal(h.historyRequests().length, 2);
  } finally { await h.close(); }
});

test('same-canonical focus preserves a failed page and original retry cursor, including across a failed current refresh', async () => {
  const h = fixture({focusBridge: true, editor: false});
  try {
    h.faults.push(({childId}) => page(childId, [3, 2], 2)); await h.start();
    h.faults.push(() => json({}, 503)); await h.click('載入更早版本');
    const notice = h.get().model.notice, history = h.get().model.history;
    await h.focus(); assert.equal(h.get().model.notice, notice); assert.equal(h.get().model.history, history);
    h.currentResponses.push(() => json({}, 503)); await h.focus(); assert.equal(h.get().model.needsRefresh, true);
    assert.match(h.get().model.notice, /未能核對目前檔案/); assert.notEqual(h.get().model.notice, notice, 'A new current-read failure is never hidden by a saved history error');
    await h.focus(); assert.equal(h.get().model.needsRefresh, false); assert.equal(h.get().model.notice, notice);
    assert.equal(h.get().model.history, history); assert.equal(h.historyRequests().length, 2);
    h.faults.push(({childId}) => page(childId, [1])); await h.click('載入更早版本');
    assert.deepEqual(h.historyRequests().map(request => request.before), ['4', '2', '2']); assert.equal(h.get().model.notice, null);
  } finally { await h.close(); }
});

test('canonical version, data and raw confirmation metadata invalidation loads a new first page, not stale history', async () => {
  for (const patch of [{version: 5}, {data: {...revision('child-a', 4).data, region: 'Changed canonical region'}}, {confirmedAt: '2026-10-10T00:00:30Z'}]) {
    const h = fixture({focusBridge: true, editor: false});
    try {
      h.faults.push(({childId}) => page(childId, [3, 2], 2)); await h.start();
      h.faults.push(() => json({}, 503)); await h.click('載入更早版本');
      h.changeCurrent(patch); h.faults.push(({childId}) => page(childId, [1])); await h.focus();
      assert.equal(h.get().model.historyOpen, true); assert.deepEqual(h.get().model.history.map(value => value.version), [1]);
      assert.equal(h.get().model.hasMoreHistory, false); assert.equal(h.get().model.notice, null);
      assert.equal(h.historyRequests().length, 3); assert.equal(h.historyRequests().at(-1).before, String(patch.version ?? 4));
    } finally { await h.close(); }
  }
});

test('focus refresh and history invalidation preserve the dirty draft, form identity and original basis', async () => {
  const h = fixture({focusBridge: true});
  try {
    h.faults.push(({childId}) => page(childId, [3, 2], 2)); await h.start();
    await h.click('Edit synthetic draft'); const form = h.form(), formKey = h.get().model.formKey, basis = h.get().model.basis;
    await h.focus(); assert.equal(h.get().model.historyOpen, true);
    h.changeCurrent({version: 5}); h.faults.push(({childId}) => page(childId, [4])); await h.focus();
    assert.equal(h.get().model.current.version, 5); assert.equal(h.get().model.basis, basis);
    assert.equal(h.get().model.formKey, formKey); assert.equal(h.form(), form);
    assert.equal(h.form().dataset.region, 'Unsaved synthetic draft'); assert.equal(h.dirtySignals.at(-1), true);
    assert.equal(h.get().model.historyOpen, true); assert.deepEqual(h.get().model.history.map(value => value.version), [4]);
  } finally { await h.close(); }
});

test('focus invalidation rejects a late history response and a superseded current response', async () => {
  const h = fixture({focusBridge: true, editor: false}), historyWait = deferred(), currentWait = deferred();
  try {
    h.faults.push(({childId}) => page(childId, [3, 2], 2)); await h.start();
    h.faults.push(() => historyWait.promise); await h.click('載入更早版本');
    h.changeCurrent({version: 5}); h.faults.push(({childId}) => page(childId, [4])); await h.focus();
    await act(async () => { historyWait.resolve(page('child-a', [1])); await tick(); });
    assert.equal(h.get().model.current.version, 5); assert.deepEqual(h.get().model.history.map(value => value.version), [4]);
    h.currentResponses.push(() => currentWait.promise); await h.focus();
    h.changeCurrent({version: 6}); h.faults.push(({childId}) => page(childId, [5])); await h.focus();
    await act(async () => { currentWait.resolve(json({profile: revision('child-a', 4)})); await tick(); });
    assert.equal(h.get().model.current.version, 6); assert.equal(h.get().model.historyOpen, true); assert.equal(h.get().model.notice, null);
    assert.deepEqual(h.get().model.history.map(value => value.version), [5]);
  } finally { historyWait.resolve(page('child-a', [])); currentWait.resolve(json({profile: revision('child-a', 4)})); await h.close(); }
});

test('focus refresh cannot retain history through child, identity or revoked-scope transitions', async () => {
  const h = fixture({focusBridge: true, editor: false}), wait = deferred();
  try {
    h.faults.push(({childId}) => page(childId, [3, 2], 2)); await h.start();
    h.currentResponses.push(() => wait.promise); await h.focus();
    h.faults.push(({childId}) => page(childId, [2])); await h.switchScope('child-b', 'parent:epoch-1');
    await act(async () => { wait.resolve(json({profile: revision('child-a', 4)})); await tick(); });
    assert.equal(h.get().model.child.id, 'child-b'); assert.deepEqual(h.get().model.history.map(value => value.version), [2]);
    h.faults.push(({childId}) => page(childId, [1])); await h.switchScope('child-b', 'parent:epoch-2');
    assert.deepEqual(h.get().model.history.map(value => value.version), [1]);
    const stale = h.get().actions.showHistory, count = h.historyRequests().length;
    await h.revoke(); await act(async () => { stale(); await tick(); });
    assert.equal(h.get(), null); assert.equal(h.historyRequests().length, count);
  } finally { wait.resolve(json({profile: revision('child-a', 4)})); await h.close(); }
});

test('a focus current-read permission denial reaches the access owner even with a retained history error', async () => {
  const h = fixture({focusBridge: true, editor: false});
  try {
    h.faults.push(({childId}) => page(childId, [3, 2], 2)); await h.start();
    h.faults.push(() => json({}, 503)); await h.click('載入更早版本');
    h.currentResponses.push(() => json({}, 403)); await h.focus();
    assert.equal(h.accessLoss.length, 1); assert.equal(h.accessLoss[0].error.status, 403);
    assert.equal(h.historyRequests().length, 2);
    await h.revoke(); assert.equal(h.get(), null);
  } finally { await h.close(); }
});
