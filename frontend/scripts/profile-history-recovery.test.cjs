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

// Real domain bridge, keyed owner, QueryClient, Care API/parser and ProfileView conditions.
// Native layout, motion, and form presentation are bounded doubles, not browser coverage.
function fixture() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://synthetic.invalid/profile' });
  Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  let nativeCalls = 0;
  const previousFetch = global.fetch;
  global.fetch = () => { nativeCalls++; throw new Error('Native network is forbidden'); };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const requests = [], faults = [], accessLoss = [], dirtySignals = [];
  let env, projection, formSerial = 0, ProfileView;
  const makeEnvironment = (childId, identityKey = 'parent:epoch-1') => {
    const scopeKey = `${identityKey}:${childId}`;
    return { scopeKey, identityKey, childId, userId: 'qa-parent', childName: `Synthetic ${childId}`, role: 'owner', online: true,
      apiBaseUrl: '/api', queryClient: client, current: () => env.scopeKey === scopeKey, currentIdentity: () => env.identityKey === identityKey,
      canStartWrite: () => true, invalidate() {}, accessError: error => accessLoss.push({ scopeKey, error }) };
  };
  env = makeEnvironment('child-a');
  const transport = async (url, init) => {
    const parsed = new URL(url, 'https://synthetic.invalid');
    requests.push({ path: parsed.pathname, method: init.method, before: parsed.searchParams.get('beforeVersion') });
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
    return json({ profile: revision(childId, 4) });
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
    return React.createElement(React.Fragment, null, children, value && React.createElement(ProfileView,
      { model: value.model, actions: value.actions, onOpenCare() {}, childPicker: null, writeNotice: null, previewControls: null }));
  }
  const cache = new Map();
  function compile(relative) {
    const file = path.resolve(source, relative);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    new Function('require', 'module', 'exports', js)(name => {
      if (name === 'react-native') return { Platform: { OS: 'web' }, View: Wrap, StyleSheet: { create: value => value } };
      if (name === 'react-native-paper') return { Text: Wrap };
      if (name === 'expo-router') return { usePathname: () => '/profile' };
      if (name.endsWith('/useDomainEnvironment')) return { useDomainEnvironment: () => env, useDomainWriteGuard: dirty => dirtySignals.push(dirty) };
      if (name.endsWith('/use-online-updates')) return { ONLINE_REFRESH_EVENT: 'yuban-online-refresh' };
      if (name.endsWith('/CareWorkspace')) return { CareWorkspaceProvider: Wrap };
      if (name.endsWith('/ProfileWorkspace')) return { ProfileWorkspaceProvider: ProfileProvider };
      if (name.endsWith('/useContainerWidth')) return { useContainerWidth: () => ({ width: 1000, ref: React.useRef(null), onLayout() {} }) };
      if (name.endsWith('/AppStatusBadge')) return { AppStatusBadge: Empty };
      if (name.endsWith('/StatusAnnouncement')) return { StatusAnnouncement: Empty };
      if (name.endsWith('/ProfileForm')) return { ProfileForm: Form };
      if (name.endsWith('/ProfileSummary')) return { ProfileDataSummary: Empty, ProfileKeyFacts: Empty,
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
  const { ProductionCareProfileDomains } = compile('frontend/src/production/CareProfileDomains.tsx');
  const root = createRoot(document.getElementById('root'));
  const render = () => act(async () => { root.render(React.createElement(ProductionCareProfileDomains)); await tick(); });
  const button = label => [...document.querySelectorAll('button')].find(node => node.textContent === label);
  const settle = () => act(async () => { await tick(); });
  return { requests, faults, accessLoss, dirtySignals, button, settle, get: () => projection,
    historyRequests: () => requests.filter(request => request.path.endsWith('/profile/history')),
    form: () => document.querySelector('[data-form-instance]'),
    async start() { await render(); await settle(); assert.ok(projection.model.current); },
    async click(label) { const node = button(label); assert.ok(node, 'Missing button ' + label); assert.equal(node.disabled, false, 'Disabled button ' + label);
      await act(async () => { node.click(); await tick(); }); },
    async switchScope(childId, identityKey) { env = makeEnvironment(childId, identityKey); await render(); await settle(); },
    async close() { await act(async () => root.unmount()); client.clear(); dom.window.close(); global.fetch = previousFetch; assert.equal(nativeCalls, 0); },
  };
}

test('failed first history read retains a manual retry, dirty draft and form identity across profile refresh', async () => {
  const h = fixture();
  try {
    await h.start(); await h.click('Edit synthetic draft');
    const form = h.form(), formKey = h.get().model.formKey;
    h.faults.push(() => json({}, 503)); await h.click('查看較早版本');
    assert.equal(h.get().model.historyOpen, false);
    assert.match(h.get().model.notice, /未能讀取檔案歷史/);
    assert.equal(h.button('查看較早版本').disabled, false);
    await h.settle(); assert.equal(h.historyRequests().length, 1, 'No automatic retry');
    await h.click('重新讀取檔案');
    assert.equal(h.historyRequests().length, 1, 'Current profile refresh is not a history retry');
    assert.equal(h.form(), form); assert.equal(h.get().model.formKey, formKey);
    assert.equal(h.form().dataset.region, 'Unsaved synthetic draft'); assert.equal(h.dirtySignals.at(-1), true);
    h.faults.push(({ childId }) => page(childId, [3, 2])); await h.click('查看較早版本');
    assert.equal(h.historyRequests().length, 2); assert.equal(h.get().model.historyOpen, true);
    assert.deepEqual(h.get().model.history.map(value => value.version), [3, 2]);
    assert.equal(h.get().model.notice, null); assert.equal(h.button('已顯示歷史').disabled, true);
    assert.equal(h.form(), form); assert.equal(h.form().dataset.region, 'Unsaved synthetic draft');
  } finally { await h.close(); }
});

test('successful empty history is shown without a false error or retry loop', async () => {
  const h = fixture();
  try {
    await h.start(); h.faults.push(({ childId }) => page(childId, [])); await h.click('查看較早版本');
    assert.equal(h.get().model.historyOpen, true); assert.deepEqual(h.get().model.history, []);
    assert.equal(h.get().model.notice, null); assert.equal(h.button('已顯示歷史').disabled, true);
    assert.equal(h.button('載入更早版本'), undefined); await h.settle(); assert.equal(h.historyRequests().length, 1);
  } finally { await h.close(); }
});

test('failed next page retains accumulated history and cursor; manual retry clears the error and appends once', async () => {
  const h = fixture();
  try {
    await h.start(); h.faults.push(({ childId }) => page(childId, [3, 2], 2)); await h.click('查看較早版本');
    h.faults.push(() => json({}, 503)); await h.click('載入更早版本');
    assert.equal(h.get().model.historyOpen, true); assert.deepEqual(h.get().model.history.map(value => value.version), [3, 2]);
    assert.equal(h.get().model.hasMoreHistory, true); assert.equal(h.button('載入更早版本').disabled, false);
    assert.match(h.get().model.notice, /未能讀取檔案歷史/);
    h.faults.push(({ childId }) => page(childId, [1])); await h.click('載入更早版本');
    assert.deepEqual(h.historyRequests().map(request => request.before), ['4', '2', '2']);
    assert.deepEqual(h.get().model.history.map(value => value.version), [3, 2, 1]);
    assert.equal(h.get().model.notice, null); assert.equal(h.get().model.hasMoreHistory, false);
  } finally { await h.close(); }
});

test('rapid repeated history actions remain single-flight and reveal only the accepted success', async () => {
  const h = fixture(), wait = deferred();
  try {
    await h.start(); h.faults.push(() => wait.promise);
    await act(async () => { h.get().actions.showHistory(); h.get().actions.showHistory(); await tick(); });
    assert.equal(h.historyRequests().length, 1); assert.equal(h.get().model.reading, true);
    assert.equal(h.get().model.historyOpen, false); assert.equal(h.button('查看較早版本').disabled, true);
    await act(async () => { wait.resolve(page('child-a', [3])); await tick(); });
    assert.deepEqual(h.get().model.history.map(value => value.version), [3]); assert.equal(h.get().model.historyOpen, true);
  } finally { wait.resolve(page('child-a', [])); await h.close(); }
});

for (const [name, childId, identityKey, status] of [
  ['child change rejects late success', 'child-b', 'parent:epoch-1', 200],
  ['identity epoch rejects late 403', 'child-a', 'parent:epoch-2', 403],
]) test(name, async () => {
  const h = fixture(), wait = deferred();
  try {
    await h.start(); h.faults.push(() => wait.promise); await h.click('查看較早版本');
    const oldAction = h.get().actions.showHistory;
    await h.switchScope(childId, identityKey); const count = h.historyRequests().length;
    await act(async () => { oldAction(); wait.resolve(status === 200 ? page('child-a', [3]) : json({}, status)); await tick(); });
    assert.equal(h.historyRequests().length, count, 'Old callback cannot start a history request');
    assert.equal(h.get().model.child.id, childId); assert.deepEqual(h.get().model.history, []);
    assert.equal(h.get().model.historyOpen, false); assert.equal(h.get().model.notice, null); assert.deepEqual(h.accessLoss, []);
    h.faults.push(({ childId }) => page(childId, [2])); await h.click('查看較早版本');
    assert.deepEqual(h.get().model.history.map(value => value.version), [2]);
  } finally { wait.resolve(page('child-a', [])); await h.close(); }
});

test('a delayed 403 in the current scope still reaches the access-loss owner instead of becoming a retry error', async () => {
  const h = fixture(), wait = deferred();
  try {
    await h.start(); h.faults.push(() => wait.promise); await h.click('查看較早版本');
    await act(async () => { wait.resolve(json({}, 403)); await tick(); });
    assert.deepEqual(h.accessLoss, [{ scopeKey: 'parent:epoch-1:child-a', error: { status: 403, code: null } }]);
    assert.equal(h.get().model.notice, null); assert.deepEqual(h.get().model.history, []);
  } finally { wait.resolve(page('child-a', [])); await h.close(); }
});
