const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '../..'), req = Module.createRequire(path.join(root, 'frontend/package.json'));
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for an existing jsdom installation.');
const { JSDOM } = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<!doctype html><html><body></body></html>', {pretendToBeVisual: true, url: 'https://synthetic.test/history'});
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event']) global[key] = dom.window[key];
Object.defineProperty(global, 'navigator', {value: dom.window.navigator, configurable: true});
global.IS_REACT_ACT_ENVIRONMENT = true;
global.fetch = () => { throw new Error('Real network is forbidden'); };
const React = req('react'), {createRoot} = req('react-dom/client'), {QueryClient} = req('@tanstack/react-query'), ts = req('typescript'), e = React.createElement;
let width = 736, frameId = 0;
const frames = new Map();
global.requestAnimationFrame = fn => {frames.set(++frameId, fn); return frameId;};
global.cancelAnimationFrame = id => frames.delete(id);
Object.defineProperty(HTMLElement.prototype, 'getClientRects', {configurable: true, value() {return this.isConnected ? [{}] : [];}});
const View = React.forwardRef(({children, testID, accessibilityLabel, tabIndex}, ref) => e('div', {ref, tabIndex, 'data-testid': testID, 'aria-label': accessibilityLabel}, children));
const Pressable = React.forwardRef(({children, testID, accessibilityLabel, onPress}, ref) => e('button', {ref, onClick: onPress, 'data-testid': testID, 'aria-label': accessibilityLabel}, children));
const Empty = () => null, Text = ({children}) => e('span', null, children);
const cache = new Map();
// Real owner, runtime, API parsers, QueryClient, online observer, workspace provider,
// reader, React effects and DOM focus. Native/layout and non-reader controls are ports.
// Synthetic HTTP latency is controlled; this is not live-browser timing evidence.
function load(relative) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = {exports: {}}; cache.set(filename, module);
  const source = filename.endsWith('/useFamilyDocuments.ts') && process.env.OWNER_SOURCE || filename;
  const output = ts.transpileModule(fs.readFileSync(source, 'utf8'), {fileName: filename, compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require', 'module', 'exports', output)(name => {
    if (name === 'react-native') return {View, Pressable, Platform: {OS: 'web'}, StyleSheet: {create: value => value}};
    if (name === 'react-native-paper') return {Text};
    if (name === './useDomainEnvironment') return {useDomainWriteGuard() {}};
    if (name.endsWith('/theme')) return {colors: {}, radius: {}, readingType: {}, spacing: {xs: 4, sm: 8, md: 12, lg: 16}};
    if (name.endsWith('/useContainerWidth')) return {useContainerWidth: () => ({width, ref: null, onLayout() {}})};
    if (name.endsWith('/ui')) return {AppButton: ({label, onPress, disabled}) => e('button', {onClick: onPress, disabled}, label), AppSelect: Empty};
    const ports = {WriteRecoveryNotice: Empty, AppCheckbox: Empty, AppStatusBadge: Empty, SummaryDisclosure: Empty, EmptyListCard: View, ManualFormDialog: Empty, DocumentCreateForm: Empty};
    if (/\/(WriteRecoveryNotice|AppCheckbox|AppStatusBadge|SummaryDisclosure|EmptyListCard|FormDialog|DocumentCreateForm)$/.test(name)) return ports;
    if (!name.startsWith('.')) return req(name);
    const target = path.resolve(path.dirname(filename), name);
    const found = [target, `${target}.ts`, `${target}.tsx`].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
    return load(path.relative(root, found));
  }, module, module.exports);
  return module.exports;
}
const {useFamilyDocuments} = load('frontend/src/production/useFamilyDocuments.ts');
const {PreparationWorkspaceProvider} = load('frontend/src/workspaces/PreparationWorkspace.tsx');
const {PreparationHistoryView} = load('frontend/src/components/preparations/PreparationWorkspace.tsx');
const {useOnlineUpdates} = load('src/client/use-online-updates.ts');
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const childA = id(1), childB = id(2), docA = id(30), docB = id(31), time = '2026-10-22T00:00:00Z';
const snapshot = (doc, version) => ({id: id(Number(doc.slice(-3)) + 100 * version), version, generatedAt: time, sourceBasis: 'synthetic:1',
  title: 'Synthetic preparation ' + doc.slice(-2), summary: 'Original version ' + version, ageLabel: 'Unknown', period: {from: '2026-10-01', to: '2026-10-22'},
  eventDate: null, coverageNote: 'Synthetic only', sections: [], sources: [], changes: []});
const item = (doc, child = childA) => ({id: doc, childId: child, kind: 'preparation', purpose: 'school', version: 3, status: 'archived', archivedAt: time,
  current: snapshot(doc, 2), history: [snapshot(doc, 1)], readState: 'ready', autoRefresh: false});
const json = (value, status = 200) => new Response(JSON.stringify(value), {status, headers: {'Content-Type': 'application/json'}});
const deferred = () => {let resolve; const promise = new Promise(yes => {resolve = yes;}); return {promise, resolve};};
async function harness({pages = 1, activePages = 1} = {}) {
  width = 736; frames.clear();
  let owner, gate = null, live = true, scope = 'scope-a', child = childA, authority = 'auth:1', documents = [item(docA), item(docB)], observerEnabled = true;
  let cursorEpoch = 'initial';
  if (activePages > 1) documents.push(...[40, 41].map(n => ({...item(id(n)), kind: 'growth_report', purpose: 'family', status: 'active', archivedAt: null})));
  const queryClient = new QueryClient(), container = document.body.appendChild(document.createElement('main')), renderer = createRoot(container), calls = [], accessLoss = [];
  const fixture = url => {
    if (url.pathname.endsWith('/online/spaces')) return {workspaces: []};
    const status = url.searchParams.get('status'), second = url.searchParams.has('cursor');
    if (url.pathname.endsWith('/versions')) {const doc = documents.find(doc => doc.id === url.pathname.split('/').at(-2)); return {page: {documentId: doc.id, authorityVersion: authority, nextCursor: null,
      items: [doc.current, ...doc.history].map(value => ({snapshotId: value.id, snapshotVersion: value.version, generatedAt: time, invalidated: false}))}};}
    if (url.pathname.endsWith('/documents')) {
      const matches = documents.filter(doc => doc.status === status), depth = status === 'active' ? activePages : pages;
      return {page: {authorityVersion: authority, canManage: true, items: depth === 1 ? matches : second ? matches.slice(1) : matches.slice(0, 1),
        hasMore: depth > 1 && !second, nextCursor: depth > 1 && !second ? status + ':2:' + cursorEpoch : null}};
    }
    return {item: documents.find(doc => doc.id === url.pathname.split('/').at(-1))};
  };
  const fetcher = async (input, init = {}) => {
    assert.equal(init.method || 'GET', 'GET', 'No write or real model transport is allowed');
    const url = new URL(input, 'https://synthetic.test'), call = {url, signal: init.signal, user: init.headers['x-expected-user-id']}; calls.push(call);
    const normal = () => json(fixture(url)); return gate?.(call, normal) ?? normal();
  };
  const transport = {fetcher};
  function Host({currentScope, currentChild}) {
    const value = useFamilyDocuments({owner: transport, scopeKey: currentScope, userId: 'synthetic-parent', childId: currentChild, childName: 'Synthetic', role: 'owner', online: true,
      apiBaseUrl: 'https://synthetic.test/api', queryClient, current: () => live && scope === currentScope, canStartWrite: () => true, invalidate() {}, accessError: value => accessLoss.push(value)});
    owner = value; useOnlineUpdates('https://synthetic.test/api', observerEnabled ? 'synthetic-parent' : null, true, async () => {}, fetcher);
    return e(PreparationWorkspaceProvider, {scopeKey: currentScope, value: value.preparation}, e(PreparationHistoryView, {searchText: '', dateRange: {from: null, to: null}}));
  }
  const render = () => renderer.render(e(Host, {key: scope, currentScope: scope, currentChild: child}));
  const flush = async action => React.act(async () => {action?.(); for (let i = 0; i < 5; i++) await new Promise(setImmediate);});
  const row = (doc = docA) => container.querySelector(`[data-testid="preparation-row-${doc}"]`);
  const click = text => {const button = [...container.querySelectorAll('button')].find(node => node.textContent === text); assert.ok(button, text); button.focus(); button.click();};
  await flush(render);
  assert.equal(owner.preparation.model.reading.archiveReady, true);
  return {container, calls, accessLoss, get owner() {return owner;}, row, flush, gate(fn) {gate = fn;},
    async compoundReturn() {
      await flush(() => {row().focus(); row().click();});
      await flush(() => click('來源與版本'));
      await flush(() => owner.preparation.model.reading.readVersion(docA, snapshot(docA, 1).id, 1));
      assert.equal(owner.preparation.model.selected.revision.number, 1);
      for (const next of [350, 1100]) {width = next; await flush(render);}
      await flush(() => click('返回歸檔清單'));
      await flush(() => {const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn());});
      assert.equal(document.activeElement, row()); return row();
    },
    async focus() {await flush(() => window.dispatchEvent(new Event('focus')));},
    async more(status = 'archived') {await flush(() => owner.preparation.model.reading.loadMoreDocuments(status));},
    setCursorEpoch(next) {cursorEpoch = next;},
    async mutate(update) {documents = update(documents);},
    changeAuthority(next) {authority = next;},
    async switchScope() {scope = 'scope-b'; child = childB; documents = [item(docB, childB)]; observerEnabled = false; await flush(render);},
    async close() {live = false; await flush(() => renderer.unmount()); queryClient.clear(); container.remove(); frames.clear();},
  };
}

test('real focus refresh never detaches the returned archive card while its verified replacement is loading', async () => {
  const h = await harness(), pending = deferred();
  try {
    const original = await h.compoundReturn(), before = h.calls.length;
    h.gate((call, normal) => call.url.searchParams.get('status') === 'archived' ? pending.promise.then(normal) : undefined);
    await h.focus();
    assert.ok(h.calls.slice(before).some(call => call.url.pathname.endsWith('/online/spaces')));
    assert.ok(h.calls.slice(before).some(call => call.url.searchParams.get('status') === 'active'));
    assert.ok(h.calls.slice(before).some(call => call.url.searchParams.get('status') === 'archived'));
    assert.equal(original.isConnected, true, 'An active-only intermediate commit must not remove the returned archived row');
    assert.equal(document.activeElement, original);
    await h.flush(() => pending.resolve());
    assert.equal(h.row(), original); assert.equal(document.activeElement, original);
    assert.equal(h.owner.preparation.model.documents[0].revision.number, 2);
  } finally {pending.resolve(); await h.close();}
});

test('automatic refresh follows only previously loaded archive depth and commits all fresh pages together', async () => {
  const h = await harness({pages: 2}), pending = deferred();
  try {
    await h.more(); const first = h.row(), second = h.row(docB); assert.ok(second);
    h.setCursorEpoch('fresh'); second.focus(); const before = h.calls.length;
    h.gate((call, normal) => call.url.searchParams.get('cursor') === 'archived:2:fresh' ? pending.promise.then(normal) : undefined);
    await h.focus();
    assert.equal(h.row(), first); assert.equal(h.row(docB), second); assert.equal(document.activeElement, second);
    await h.flush(() => pending.resolve());
    assert.equal(h.row(), first); assert.equal(h.row(docB), second); assert.equal(document.activeElement, second);
    assert.deepEqual(h.calls.slice(before).filter(call => call.url.searchParams.get('status') === 'archived').map(call => call.url.searchParams.get('cursor')), [null, 'archived:2:fresh']);
  } finally {pending.resolve(); await h.close();}
});

test('a later-page failure retains the prior snapshot with a refresh error, and recovery does not write', async () => {
  const h = await harness({pages: 2});
  try {
    await h.more(); const first = h.row(), second = h.row(docB); second.focus();
    h.gate(call => call.url.searchParams.get('cursor') ? json({}, 503) : undefined);
    await h.focus();
    assert.equal(h.owner.preparation.model.condition, 'refresh_failed');
    assert.equal(h.row(), first); assert.equal(h.row(docB), second); assert.equal(document.activeElement, second);
    h.gate(null); await h.focus();
    assert.equal(h.owner.preparation.model.condition, 'ready'); assert.equal(h.row(docB), second);
  } finally {await h.close();}
});

test('authoritatively removed or changed archive entries are not merged back from the old snapshot', async () => {
  const h = await harness();
  try {
    await h.mutate(docs => docs.filter(doc => doc.id !== docA).map(doc => ({...doc, version: 4, readState: 'invalidated', current: null, history: []})));
    await h.focus();
    assert.equal(h.row(), null); assert.equal(h.owner.preparation.model.documents.length, 1);
    assert.equal(h.owner.preparation.model.documents[0].revision, null);
  } finally {await h.close();}
});

for (const condition of ['authority', 'permission', '403', 'scope']) test(`archive refresh clears or rejects obsolete scope data on ${condition}`, async () => {
  const h = await harness(), pending = deferred();
  try {
    if (condition === 'authority') h.gate((call, normal) => call.url.searchParams.get('status') === 'archived' ? Promise.resolve(normal()).then(async response => {const body = await response.json(); body.page.authorityVersion = 'auth:changed'; return json(body);}) : undefined);
    if (condition === 'permission') h.gate((call, normal) => call.url.searchParams.get('status') === 'active' ? Promise.resolve(normal()).then(async response => {const body = await response.json(); body.page.canManage = false; return json(body);}) : undefined);
    if (condition === '403') h.gate(call => call.url.searchParams.get('status') === 'archived' ? json({}, 403) : undefined);
    if (condition === 'scope') h.gate((call, normal) => call.url.pathname.includes(childA) && call.url.searchParams.get('status') === 'archived' ? pending.promise.then(normal) : undefined);
    await h.focus();
    if (condition === 'scope') {await h.switchScope(); await h.flush(() => pending.resolve()); assert.equal(h.owner.preparation.scopeKey, 'scope-b'); assert.ok(h.owner.preparation.model.documents.every(doc => doc.childId === childB));}
    else {assert.equal(h.owner.preparation.model.documents.length, 0); assert.equal(h.owner.preparation.model.selected, null);}
    if (condition === '403') assert.equal(h.owner.preparation.model.condition, 'lost');
    if (condition === 'permission' || condition === 'authority') {
      assert.equal(h.owner.preparation.model.condition, 'unavailable'); assert.equal(h.owner.locked, true);
      h.gate(null); await h.focus(); assert.equal(h.owner.preparation.model.documents.length, 0, 'Automatic refresh cannot undo the required recheck');
      await h.flush(() => h.owner.refresh()); assert.equal(h.owner.preparation.model.condition, 'ready'); assert.equal(h.owner.preparation.model.documents.length, 2);
    }
  } finally {pending.resolve(); await h.close();}
});


test('loaded active growth-report pages refresh atomically with archives using fresh cursors', async () => {
  const h = await harness({pages: 2, activePages: 2}), pending = deferred();
  try {
    await h.more('active'); await h.more();
    assert.equal(h.owner.archive.periods.length, 4);
    const before = h.calls.length, original = h.row(); original.focus(); h.setCursorEpoch('new');
    h.gate((call, normal) => call.url.searchParams.get('cursor') === 'active:2:new' ? pending.promise.then(normal) : undefined);
    await h.focus();
    assert.equal(h.owner.archive.periods.length, 4); assert.equal(h.row(), original); assert.equal(document.activeElement, original);
    assert.equal(h.calls.slice(before).filter(call => call.url.searchParams.get('status') === 'archived').length, 0);
    await h.flush(() => pending.resolve());
    assert.equal(h.owner.archive.periods.length, 4); assert.equal(h.row(), original); assert.equal(document.activeElement, original);
    assert.deepEqual(h.calls.slice(before).filter(call => call.url.pathname.endsWith('/documents')).map(call => [call.url.searchParams.get('status'), call.url.searchParams.get('cursor')]),
      [['active', null], ['active', 'active:2:new'], ['archived', null], ['archived', 'archived:2:new']]);
  } finally {pending.resolve(); await h.close();}
});

test('same-version historical reading survives refresh and a changed document drops obsolete content', async () => {
  const h = await harness();
  try {
    await h.flush(() => h.owner.preparation.actions.selectDocument(docA));
    await h.flush(() => h.owner.preparation.model.reading.readVersion(docA, snapshot(docA, 1).id, 1));
    assert.equal(h.owner.preparation.model.selected.revision.number, 1);
    await h.focus(); assert.equal(h.owner.preparation.model.selected.revision.number, 1);
    await h.mutate(docs => docs.map(doc => doc.id === docA ? {...doc, version: 4, current: snapshot(docA, 3)} : doc));
    await h.focus(); assert.equal(h.owner.preparation.model.selected.revision.number, 3);
    assert.equal(h.owner.preparation.model.reading.content, null);
  } finally {await h.close();}
});
