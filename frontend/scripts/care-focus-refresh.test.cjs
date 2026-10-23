const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const root = path.resolve(__dirname, '../..'), req = createRequire(path.join(root, 'frontend/package.json'));
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for an existing jsdom installation.');
const {JSDOM} = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<!doctype html><html><body><input id="outside"></body></html>', {pretendToBeVisual: true});
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'getComputedStyle', 'ShadowRoot', 'Event']) global[key] = dom.window[key];
Object.defineProperty(global, 'navigator', {value: dom.window.navigator, configurable: true});
global.IS_REACT_ACT_ENVIRONMENT = true;
global.fetch = () => { throw new Error('Real network is forbidden.'); };
const React = req('react'), {createRoot} = req('react-dom/client'), ts = req('typescript'), RN = req('react-native-web'), e = React.createElement;
const {QueryClient} = req('@tanstack/react-query');
const Production = React.createContext(null), Care = React.createContext(null), cache = new Map();
const Text = ({children}) => e('span', null, children), Empty = () => null;
const Surface = React.forwardRef(({children, testID, tabIndex}, ref) => e('div', {ref, tabIndex, 'data-testid': testID}, children));
const PlainButton = React.forwardRef(({children, onPress, disabled, accessibilityLabel}, ref) => e(RN.Pressable, {ref, onPress, disabled, accessibilityRole: 'button', accessibilityLabel}, e(Text, null, children)));
const theme = {colors: {}, radius: {}, readingType: {}, workspaceType: {}, mobileType: {}, mobileIcons: {}, mobileLayout: {breakpoint: 600}, typeScale: {}, spacing: {xs: 4, sm: 8, md: 12, lg: 16}};
function load(relative) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = {exports: {}}; cache.set(filename, module);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {fileName: filename, compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require', 'module', 'exports', output)(name => {
    if (name === 'react-native') return RN;
    if (name === 'react-native-paper') return {Text, Button: PlainButton, ActivityIndicator: Empty, Portal: Surface, TextInput: ({value, label}) => e('input', {value, 'aria-label': label, readOnly: true})};
    if (name === 'expo-router') return {usePathname: () => '/care', useLocalSearchParams: () => ({}), useRouter: () => ({push() {}})};
    if (name.endsWith('/ProductionProvider')) return {useProduction: () => React.useContext(Production)};
    if (name.endsWith('/CareWorkspace')) return {useCareWorkspace: () => React.useContext(Care)};
    if (name.endsWith('/CareProfileDomains')) return {useProductionCareProfile: () => null};
    if (name.endsWith('/useDomainEnvironment')) return {useDomainEnvironment: () => ({canStartWrite: () => true})};
    if (name.endsWith('/PreviewNavigationGuard')) return {usePreviewNavigation: () => action => action(), usePreviewLeaveGuard() {}};
    if (name.endsWith('/theme')) return theme;
    if (name.endsWith('/useContainerWidth')) return {useContainerWidth: () => ({width: 1024, ref: React.useRef(null), onLayout() {}})};
    if (name.endsWith('/useInteractionDensity')) return {useInteractionDensity: () => false};
    if (name.endsWith('/motion/preferences')) return {useMotionPreferences: () => ({enabled: false})};
    if (name.endsWith('/motion')) return {MotionReveal: ({children, value}) => children(value), MotionDisclosure: ({children, expanded}) => expanded ? children : null, MotionEntrance: Surface, MotionFeedback: Surface};
    if (name.endsWith('/appearance/BackgroundSurface')) return {BackgroundSurface: Surface, useCustomBackground: () => false};
    if (name.endsWith('/PageFrame')) return {PageFrame: ({children, scrollTestID}) => e('div', {'data-testid': scrollTestID}, children)};
    if (name.endsWith('/AppDialog')) return {AppDialog: Object.assign(({visible, children}) => visible ? e('section', {role: 'dialog'}, children) : null, {Title: Text, Content: Surface, ScrollArea: Surface, Actions: Surface})};
    if (name.endsWith('/FormDialog')) return {FormDialog: ({visible, children}) => visible ? e('section', {role: 'dialog'}, children) : null};
    if (name.endsWith('/HorizontalOverflowRail')) return {HorizontalOverflowRail: Surface};
    if (name.endsWith('/AppScrollView')) return {AppScrollView: Surface};
    if (name.endsWith('/photosScreen')) return {PhotoWorkspace: Empty};
    if (name.endsWith('/ChatMessage')) return {ChatMessage: Empty};
    if (/\/(AppIcon|AppRadioItem|AppStatusBadge|StatusAnnouncement|MotionSelectionMarker|HorizontalOverflowRail|CareRecordForm|CareRecordDelete|CareCaptureDetail|OperationNotice)$/.test(name)) return {[name.split('/').pop()]: Empty};
    if (!name.startsWith('.')) return req(name);
    const target = path.resolve(path.dirname(filename), name), found = [target, target+'.ts', target+'.tsx'].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
    assert.ok(found, name); return load(path.relative(root, found));
  }, module, module.exports);
  return module.exports;
}
const CarePage = load('frontend/src/screens/careScreen.tsx').default;
const {createCareReadCoordinator} = load('frontend/src/production/CareReadCoordinator.ts');
const {ProductAgentOwner} = load('frontend/src/production/ProductAgentOwner.ts');
const {CareApiError} = load('src/client/care-api.ts');
const {ProductAgentApiError} = load('src/client/product-agent-api.ts');
const {useOnlineUpdates} = load('src/client/use-online-updates.ts');
const {subscribeOnlineRefresh} = load('src/client/online-refresh-events.ts');
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
const at = '2026-10-22T00:00:00Z';
const proposal = {id: 'proposal-a', runId: 'run-a', childId: 'child-a', version: 1, kind: 'memory_fact', status: 'pending', createdAt: at, expiresAt: '2099-01-01T00:00:00Z', result: null,
  value: {kind: 'memory_fact', key: 'Synthetic', content: 'Synthetic pending content', intendedVisibility: 'private', validUntil: null}};
const rawRecord = (id = 'saved-a', version = 2) => ({id, childId: 'child-a', version});
const recordView = raw => ({id: raw.id, childId: raw.childId, title: 'Synthetic record', createdAtLabel: at, current: {version: raw.version, values: {kind: 'note', text: 'Synthetic saved content', source: 'Synthetic', quantityRaw: '', eventTimeRaw: ''}, eventTimePrecision: 'exact', confirmedByLabel: 'Synthetic', confirmedAtLabel: at}});
async function setup(t, {pending = [], records = [], cold = false} = {}) {
  let scope = 'scope-a', user = 'user-a', child = 'child-a', forceRender = () => {}, pendingGate = null, careGate = null, active = true;
  const client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: Infinity}}}), calls = {open: 0, writes: 0, search: [], pending: 0};
  const result = {runId: 'run-a', status: 'completed', text: 'Synthetic selected proposal', proposals: [proposal], citations: [], tools: [], retrievalMode: 'not_used', counts: {modelCalls: 0, toolCalls: 0, queryEmbeddings: 0}};
  const agent = new ProductAgentOwner('/api', true, () => {}, () => {}, () => ({getPendingProposals: async (requestedChild, _signal, requestedUser) => {calls.pending++; if (requestedChild !== "child-a" || requestedUser !== "user-a") return {proposals: [], nextCursor: null}; return pendingGate ? pendingGate.promise : {proposals: pending, nextCursor: null};}, getRun: async () => result, decideProposal: async () => {calls.writes++; throw new Error('No synthetic write expected');}}));
  agent.syncContext({key: scope, userId: user, childId: child}, true, {identityKey: user});
  const care = {scopeKey: scope, child: {id: child, name: 'Synthetic child'}, online: true, access: 'editable', operation: {state: 'none', message: ''}, detail: null, draft: null, deletion: null,
    list: {state: 'loading', records: [], activeQuery: '', activeKind: 'all', scanned: 0, hasMore: false, page: 1, hasPrevious: false, message: null}};
  const state = Object.fromEntries(Object.entries({careRef: care, writing: false, attempt: null, careRead: null, careGeneration: 0, recordReadGeneration: 0, recordRemovals: new Map(), historyGeneration: 0, openGeneration: 0, pageCursors: [null], pageIndex: 0, nextCursor: null, careHistoryCursor: null}).map(([key, value]) => [key, {current: value}]));
  const reads = createCareReadCoordinator({queryClient: client, state, careKey: ['production', 'scope-a', 'care'], childId: child, userId: user, scopeKey: scope,
    current: () => active && scope === 'scope-a' && user === 'user-a', online: () => true, controller: () => new AbortController(), released() {},
    onAccessError() {care.access = 'lost'; care.detail = null; care.list = {...care.list, records: [], hasSnapshot: false}; forceRender();},
    setCare: update => {Object.assign(care, update(care)); forceRender();}, careRecordView: recordView, careRevisionView: value => value, savedRecordReview: raw => ({id: raw.id, childId: raw.childId, writeState: "saved", reviewState: "not_required", reviewRequirement: "optional", proposedValues: recordView(raw).current.values, savedRecord: recordView(raw)}), careOperation: () => ({state: 'none'}),
    api: {getSession: async () => user, search: async (_child, filter) => {calls.search.push(filter); return careGate ? careGate.promise : {records, scanned: records.length, nextCursor: null};}, history: async () => ({revisions: [rawRecord()], nextBeforeVersion: null})}});
  const actions = {openRecord(id) {calls.open++; reads.openRecord(id);}, closePanel() {care.detail = null; forceRender();}, search(query, kind) {void reads.loadCare(query, kind, 0);}, loadMore() {},
    startCorrection() {calls.writes++;}, startDeletion() {calls.writes++;}, showHistory() {care.detail = {...care.detail, historyOpen: true, historyState: 'ready', history: [{...recordView(rawRecord()).current, version: 1}]}; forceRender();}};
  if (!cold) {await reads.loadCare(); await agent.readPending();}
  else {pendingGate = deferred(); careGate = deferred();}
  const container = document.body.appendChild(document.createElement('main')), renderer = createRoot(container);
  const fetcher = async () => new Response(JSON.stringify({workspaces: []}), {status: 200});
  function Host() {
    const [, changed] = React.useState(0); forceRender = () => changed(value => value + 1);
    const snapshot = React.useSyncExternalStore(agent.subscribe, agent.getSnapshot, agent.getSnapshot);
    useOnlineUpdates('/api', user, true, async () => {void agent.readPending();}, fetcher);
    React.useEffect(() => subscribeOnlineRefresh(() => {void reads.refreshCare();}), []);
    const currentCare = scope === care.scopeKey ? {...care, review: reads.reviewProjection(care)} : {...care, scopeKey: scope, child: {id: child}, detail: null, list: {...care.list, state: 'loading', records: [], hasSnapshot: false}, review: {state: 'loading', items: [], scopeKey: scope}};
    return e(Production.Provider, {value: {scopeKey: scope, selectedChildId: child, online: true, model: {selectedChildId: child, children: [{id: child}]}, actions: {},
      agentPending: snapshot.pending, agentModel: snapshot.model, agentActions: {refresh: agent.refresh, decide: agent.decide, retryOriginal: agent.retryOriginal, setSharedConfirmation: agent.setSharedConfirmation, openSource() {}}, readAgentPending: agent.readPending, selectAgentRun: id => {calls.open++; agent.selectRun(id);}}},
      e(Care.Provider, {value: {scopeKey: scope, model: currentCare, actions}}, e(CarePage)));
  }
  const flush = async action => React.act(async () => {action?.(); for (let i = 0; i < 5; i++) await new Promise(setImmediate);});
  await flush(() => renderer.render(e(Host)));
  const button = text => [...container.querySelectorAll('[role="button"]')].find(node => node.textContent === text);
  const tab = async text => {const item = [...container.querySelectorAll('[role="tab"]')].find(node => node.textContent.includes(text)); assert.ok(item, text); await flush(() => item.click());};
  t.after(async () => {active = false; await flush(() => renderer.unmount()); agent.dispose(); client.clear(); container.remove();});
  return {care, reads, state, agent, calls, container, button, tab, flush, node: id => container.querySelector(`[data-testid="${id}"]`),
    currentGates: () => ({pending: pendingGate, care: careGate}),
    gates() {pendingGate = deferred(); careGate = deferred(); return {pending: pendingGate, care: careGate};},
    async focus() {await flush(() => {window.dispatchEvent(new window.Event('focus')); document.dispatchEvent(new window.Event('visibilitychange'));});},
    async switchScope(identity = false) {await flush(() => {scope = 'scope-b'; if (identity) user = 'user-b'; else child = 'child-b'; agent.syncContext({key: scope, userId: user, childId: child}, true, {identityKey: user}); forceRender();});}};
}

test('confirmed empty pending and saved panels keep their exact DOM through focus refresh', async t => {
  const h = await setup(t), pendingEmpty = h.node('empty-list-card');
  assert.ok(pendingEmpty); const gates = h.gates(); await h.focus();
  assert.ok(pendingEmpty.isConnected, 'A confirmed empty pending snapshot must not be removed during the read');
  assert.match(h.container.querySelector('[role="tab"]').textContent, /0/);
  await h.flush(() => {gates.pending.resolve({proposals: [], nextCursor: null}); gates.care.resolve({records: [], scanned: 0, nextCursor: null});});
  await h.tab('已保存'); const savedEmpty = h.node('read-state-empty'); assert.ok(savedEmpty); assert.equal(h.container.querySelector('input[aria-label="搜尋已保存記錄"]'), null);
  const next = h.gates(); await h.focus(); assert.equal(h.node('read-state-empty'), savedEmpty); assert.equal(h.container.querySelector('input[aria-label="搜尋已保存記錄"]'), null);
  await h.flush(() => {next.pending.resolve({proposals: [], nextCursor: null}); next.care.resolve({records: [], scanned: 0, nextCursor: null});});
});

test('pending and saved cards retain focus and block every click while a same-scope read is busy', async t => {
  const h = await setup(t, {pending: [proposal], records: [rawRecord()]}); const card = h.node('care-pending-card-run-a-proposal-a'); await h.flush(() => card.focus());
  const gates = h.gates(); await h.focus(); assert.equal(h.node('care-pending-card-run-a-proposal-a'), card); assert.equal(card.disabled, false); assert.equal(card.getAttribute('aria-disabled'), 'true'); assert.equal(card.tabIndex, -1); assert.equal(document.activeElement, card);
  const opened = h.calls.open; await h.flush(() => {card.click(); card.dispatchEvent(new window.MouseEvent('click', {bubbles: true, detail: 0}));}); assert.equal(h.calls.open, opened);
  await h.flush(() => {gates.pending.resolve({proposals: [proposal], nextCursor: null}); gates.care.resolve({records: [rawRecord()], scanned: 1, nextCursor: null});});
  await h.tab('已保存'); const saved = h.node('care-saved-card-saved-a'); await h.flush(() => saved.focus()); const next = h.gates(); await h.focus(); assert.equal(h.node('care-saved-card-saved-a'), saved); assert.equal(saved.disabled, false); assert.equal(saved.getAttribute('aria-disabled'), 'true'); assert.equal(document.activeElement, saved);
  await h.flush(() => saved.click()); assert.equal(h.calls.open, opened); assert.equal(h.calls.writes, 0);
  await h.flush(() => {next.pending.reject(new ProductAgentApiError(503)); next.care.reject(new Error('Synthetic unavailable'));});
  assert.equal(h.node('care-saved-card-saved-a'), saved); assert.equal(h.care.list.state, 'stale'); assert.match(h.container.textContent, /未能更新/); assert.equal(h.node('read-state-empty'), null);
});

test('first reads and changed scope never reuse a confirmed empty or nonempty snapshot', async t => {
  const h = await setup(t, {cold: true}); assert.doesNotMatch(h.container.textContent, /暫無可確認事項|暫無已保存記錄/);
  await h.tab('已保存'); assert.equal(h.node('read-state-empty'), null); await h.switchScope(); assert.equal(h.node('care-saved-card-saved-a'), null); assert.equal(h.node('care-pending-card-run-a-proposal-a'), null);
});

test('opened saved details keep correction controls and expanded history across a quiet read', async t => {
  const h = await setup(t, {records: [rawRecord()]}); await h.tab('已保存'); await h.flush(() => h.node('care-saved-card-saved-a').click());
  const edit = h.button('更正這筆記錄'); assert.ok(edit); await h.flush(() => edit.focus());
  await h.flush(() => h.button('更正歷史').click()); const oldHistory = h.care.detail.history;
  const gates = h.gates(); await h.focus(); assert.equal(h.button('更正這筆記錄'), edit, 'The correction controls must not unmount while the list refreshes'); assert.equal(document.activeElement, edit); assert.equal(edit.getAttribute('aria-disabled'), 'true');
  await h.flush(() => edit.click()); assert.equal(h.calls.writes, 0);
  await h.flush(() => {gates.pending.resolve({proposals: [], nextCursor: null}); gates.care.resolve({records: [rawRecord()], scanned: 1, nextCursor: null});});
  assert.equal(h.button('更正這筆記錄'), edit); assert.equal(document.activeElement, edit); assert.equal(h.care.detail.history, oldHistory); assert.equal(h.care.detail.historyOpen, true);
});

async function activate(h, node) {
  await h.flush(() => {node.click(); for (const key of ['Enter', ' ']) {node.dispatchEvent(new window.KeyboardEvent('keydown', {key, bubbles: true, cancelable: true})); node.dispatchEvent(new window.KeyboardEvent('keyup', {key, bubbles: true, cancelable: true})); node.dispatchEvent(new window.MouseEvent('click', {detail: 0, bubbles: true, cancelable: true}));}});
}
test('current-page background refresh preserves page two while an explicit search resets to page one', async t => {
  const h = await setup(t, {records: [rawRecord()]});
  h.state.pageCursors.current[1] = 'synthetic-page-two';
  await h.flush(() => h.reads.publishPage({records: [rawRecord('saved-b')], scanned: 1, nextCursor: 'synthetic-page-three'}, '', 'all', 1, 100));
  await h.tab('已保存'); const card = h.node('care-saved-card-saved-b'); await h.flush(() => card.focus()); h.container.scrollTop = 287;
  const gates = h.gates(); await h.focus(); assert.equal(h.care.list.page, 2); assert.equal(h.care.list.hasSnapshot, true); assert.equal(h.node('care-saved-card-saved-b'), card); assert.equal(h.calls.search.at(-1).cursor, 'synthetic-page-two');
  await h.flush(() => {gates.pending.resolve({proposals: [], nextCursor: null}); gates.care.resolve({records: [rawRecord('saved-b')], scanned: 1, nextCursor: null});});
  assert.equal(h.care.list.page, 2); assert.equal(h.container.scrollTop, 287); assert.equal(document.activeElement, card); assert.equal(card.tabIndex, 0); assert.equal(card.hasAttribute('aria-disabled'), false);
  let work; await h.flush(() => {work = h.reads.loadCare('new query', 'all');}); await work;
  assert.equal(h.care.list.page, 1); assert.equal(h.care.list.activeQuery, 'new query'); assert.equal(h.calls.search.at(-1).cursor, undefined);
});

test('unchanged off-page detail retains history, and new versions still invalidate that history', async t => {
  const h = await setup(t, {records: [rawRecord()]}); await h.flush(() => h.reads.openRecord('saved-a'));
  const history = [{...recordView(rawRecord()).current, version: 1}]; h.care.detail = {...h.care.detail, historyOpen: true, historyState: 'ready', history};
  const gates = h.gates(); let work; await h.flush(() => {work = h.reads.refreshCare();});
  await h.flush(() => gates.care.resolve({records: [], scanned: 0, nextCursor: null})); await work;
  assert.equal(h.care.detail.historyOpen, true); assert.equal(h.care.detail.history, history);
  await h.flush(() => h.reads.publishPage({records: [rawRecord('saved-a', 3)], scanned: 1, nextCursor: null}, '', 'all', 0, 100));
  assert.equal(h.care.detail.record.current.version, 3); assert.equal(h.care.detail.historyOpen, false); assert.deepEqual(h.care.detail.history, []);
});

test('quiet refresh never reclaims moved focus, and mutation locks keep native disabled behavior', async t => {
  const h = await setup(t, {records: [rawRecord()]}); await h.tab('已保存'); const card = h.node('care-saved-card-saved-a'); await h.flush(() => card.focus());
  const gates = h.gates(); await h.focus(); const outside = document.getElementById('outside'); await h.flush(() => outside.focus());
  await activate(h, card); assert.equal(h.calls.open, 0);
  await h.flush(() => {h.care.operation = {state: 'unknown', reference: 'original-op'};}); await h.focus();
  assert.equal(card.disabled, true); await activate(h, card); assert.equal(h.calls.open, 0); assert.equal(h.care.operation.reference, 'original-op');
  await h.flush(() => {gates.pending.resolve({proposals: [], nextCursor: null}); gates.care.resolve({records: [rawRecord()], scanned: 1, nextCursor: null});});
  assert.equal(document.activeElement, outside); assert.equal(h.calls.writes, 0);
});

for (const identity of [false, true]) test(`late reads after ${identity ? 'identity' : 'child scope'} changes cannot reintroduce prior cards or focus`, async t => {
  const h = await setup(t, {pending: [proposal], records: [rawRecord()]}); const card = h.node('care-pending-card-run-a-proposal-a'); await h.flush(() => card.focus());
  const gates = h.gates(); await h.focus(); await h.switchScope(identity); assert.equal(card.isConnected, false);
  await h.flush(() => {gates.pending.resolve({proposals: [proposal], nextCursor: null}); gates.care.resolve({records: [rawRecord()], scanned: 1, nextCursor: null});});
  assert.equal(h.node('care-saved-card-saved-a'), null); assert.equal(h.node('care-pending-card-run-a-proposal-a'), null); assert.notEqual(document.activeElement, card);
});

test('a first failed read cannot become an empty result and revoked care access clears snapshots', async t => {
  const h = await setup(t, {cold: true}); const gates = h.currentGates(); await h.focus();
  await h.flush(() => {gates.pending.reject(new ProductAgentApiError(503)); gates.care.reject(new CareApiError(503));});
  assert.doesNotMatch(h.container.textContent, /暫無可確認事項|暫無已保存記錄/); assert.equal(h.care.list.state, 'error'); assert.equal(h.care.list.hasSnapshot, false);
  const denied = h.gates(); await h.focus(); await h.flush(() => {denied.pending.reject(new ProductAgentApiError(403)); denied.care.reject(new CareApiError(403));});
  assert.equal(h.care.access, 'lost'); assert.deepEqual(h.care.list.records, []); assert.equal(h.node('care-pending-card-run-a-proposal-a'), null);
});

test('default AppButton stays natively disabled and quiet AppButton blocks pointer and keyboard activation', async t => {
  const {AppButton} = load('frontend/src/components/ui.tsx'); let calls = 0;
  const container = document.body.appendChild(document.createElement('section')), renderer = createRoot(container);
  const flush = async action => React.act(async () => {action(); await new Promise(setImmediate);});
  const render = props => flush(() => renderer.render(e(AppButton, {label: 'Synthetic action', onPress: () => calls++, ...props})));
  t.after(async () => {await flush(() => renderer.unmount()); container.remove();});
  await render({disabled: false}); const node = container.querySelector('button'); await flush(() => node.focus());
  await render({disabled: true, preserveFocusWhenDisabled: true}); assert.equal(node.disabled, false); assert.equal(node.getAttribute('aria-disabled'), 'true'); assert.equal(node.tabIndex, -1); assert.equal(document.activeElement, node);
  await activate({flush}, node); assert.equal(calls, 0); await render({disabled: false}); assert.equal(node.tabIndex, 0); assert.equal(node.hasAttribute('aria-disabled'), false);
  await render({disabled: true}); assert.equal(node.disabled, true); await activate({flush}, node); assert.equal(calls, 0);
});

test('a stale background page cursor retains the snapshot and requires an explicit first-page search', async t => {
  const h = await setup(t, {records: [rawRecord()]}); h.state.pageCursors.current[1] = 'stale-page-two';
  await h.flush(() => h.reads.publishPage({records: [rawRecord('saved-b')], scanned: 1, nextCursor: null}, '', 'all', 1, 100));
  const gates = h.gates(); await h.focus(); await h.flush(() => {gates.pending.resolve({proposals: [], nextCursor: null}); gates.care.reject(new CareApiError(409, 'cursor_stale'));});
  assert.equal(h.care.list.page, 2); assert.equal(h.care.list.state, 'stale'); assert.equal(h.care.list.records[0].id, 'saved-b'); assert.match(h.care.list.message, /重新搜尋/);
  const retry = h.gates(); let work; await h.flush(() => {work = h.reads.loadCare('', 'all');}); assert.equal(h.calls.search.at(-1).cursor, undefined); assert.equal(h.care.list.hasSnapshot, false);
  await h.flush(() => retry.care.resolve({records: [rawRecord()], scanned: 1, nextCursor: null})); await work; assert.equal(h.care.list.page, 1);
});

test('native quiet-read callers never inspect DOM hosts and retain native disabled semantics', async t => {
  const filename = path.join(root, 'frontend/src/components/useQuietReadFocus.ts');
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const module = {exports: {}}; new Function('require', 'module', 'exports', code)(name => name === 'react-native' ? {Platform: {OS: 'android'}} : req(name), module, module.exports);
  const container = document.body.appendChild(document.createElement('section')), renderer = createRoot(container); let state;
  function Probe() {state = module.exports.useQuietReadFocus(true, true); state.host.current = {get matches() {throw new Error('A native host must never be inspected as DOM');}}; return null;}
  await React.act(() => renderer.render(e(Probe))); assert.equal(state.nativeDisabled, true); assert.equal(state.preserveWebFocus, false);
  t.after(async () => {await React.act(() => renderer.unmount()); container.remove();});
});

for (const label of ['確認資料', '略過']) test(`selected pending ${label} retains focus during discovery without permitting a decision`, async t => {
  const h = await setup(t, {pending: [proposal]}); await h.flush(() => h.node('care-pending-card-run-a-proposal-a').click());
  const action = h.button(label); assert.ok(action); await h.flush(() => action.focus()); const gates = h.gates(); await h.focus();
  assert.equal(h.button(label), action); assert.equal(document.activeElement, action); assert.equal(action.disabled, false); assert.equal(action.getAttribute('aria-disabled'), 'true'); assert.equal(action.tabIndex, -1);
  await activate(h, action); assert.equal(h.calls.writes, 0); assert.equal(h.agent.getSnapshot().model.pendingDecision, null);
  await h.flush(() => {gates.pending.resolve({proposals: [proposal], nextCursor: null}); gates.care.resolve({records: [], scanned: 0, nextCursor: null});});
  assert.equal(h.button(label), action); assert.equal(document.activeElement, action); assert.equal(action.tabIndex, 0); assert.equal(action.hasAttribute('aria-disabled'), false);
});

test('AgentRunView defaults and actual write-busy states never gain the discovery-focus exception', async t => {
  const h = await setup(t, {pending: [proposal]}); await h.flush(() => h.agent.selectRun('run-a'));
  const {AgentRunView} = load('frontend/src/components/agent/AgentRunView.tsx'), container = document.body.appendChild(document.createElement('section')), renderer = createRoot(container); let decisions = 0;
  const actions = {refresh() {}, decide() {decisions++;}, retryOriginal() {}, setSharedConfirmation() {}, openSource() {}};
  const render = (busy, optIn) => h.flush(() => renderer.render(e(AgentRunView, {model: {...h.agent.getSnapshot().model, busy}, actions, proposalOnly: true, preserveDecisionFocusOnRead: optIn, proposalTarget: {runId: 'run-a', id: proposal.id, version: 1, kind: proposal.kind, scope: 'private'}})));
  t.after(async () => {await h.flush(() => renderer.unmount()); container.remove();});
  await render('read', false); let button = [...container.querySelectorAll('button')].find(node => node.textContent === '確認資料'); assert.equal(button.disabled, true); await activate(h, button); assert.equal(decisions, 0);
  await render('write', true); button = [...container.querySelectorAll('button')].find(node => node.textContent === '確認資料'); assert.equal(button.disabled, true); await activate(h, button); assert.equal(decisions, 0);
  await render(null, true); await activate(h, button); assert.ok(decisions > 0, 'The explicit ready decision callback remains reachable');
});

test('review-history confirmed empty snapshots survive refresh while first reads still wait', async t => {
  const h = await setup(t), {CareReviewHistoryView} = load('frontend/src/components/care/CareReviewHistoryView.tsx');
  const container = document.body.appendChild(document.createElement('section')), renderer = createRoot(container);
  const render = () => h.flush(() => renderer.render(e(CareReviewHistoryView, {model: {...h.care, review: h.reads.reviewProjection(h.care)}, actions: {}})));
  t.after(async () => {await h.flush(() => renderer.unmount()); container.remove();});
  await render(); const empty = container.querySelector('[data-testid="read-state-empty"]'); assert.ok(empty);
  const gates = h.gates(); await h.focus(); await render(); assert.equal(h.care.list.state, 'loading'); assert.equal(h.care.list.hasSnapshot, true);
  assert.equal(container.querySelector('[data-testid="read-state-empty"]'), empty, 'The review-history empty card must not unmount during a confirmed same-scope refresh');
  await h.flush(() => {gates.pending.resolve({proposals: [], nextCursor: null}); gates.care.resolve({records: [], scanned: 0, nextCursor: null});});
  h.care.list = {...h.care.list, state: 'loading', hasSnapshot: false}; await render(); assert.equal(container.querySelector('[data-testid="read-state-empty"]'), null);
  h.care.list = {...h.care.list, state: 'error', message: 'Synthetic failed first read'}; await render(); assert.equal(container.querySelector('[data-testid="read-state-empty"]'), null);
});

test('the real Care bridge preserves page two for invalidation but returns to page one after a confirmed write', async t => {
  let projection = null, writes = 0; const calls = [];
  const queryClient = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: Infinity}}});
  const {publishOnlineRefresh} = load('src/client/online-refresh-events.ts');
  const env = {scopeKey: 'write-scope', userId: 'user-a', childId: 'child-a', childName: 'Synthetic child', role: 'owner', online: true, apiBaseUrl: '/api', owner: {fetcher() {throw new Error('No network');}}, queryClient,
    current: () => true, currentIdentity: () => true, canStartWrite: () => true, accessError(error) {throw error;}, invalidate: publishOnlineRefresh};
  const api = {getSession: async () => 'user-a', getProfile: async () => ({childId: 'child-a', version: 0, data: null}),
    search: async (_child, filter) => {calls.push({...filter}); if (writes && filter.cursor) throw new CareApiError(409, 'cursor_stale'); return {records: [rawRecord(filter.cursor ? 'saved-b' : writes ? 'new-record' : 'saved-a')], scanned: 1, nextCursor: filter.cursor ? null : 'synthetic-page-two'};},
    create: async () => {writes++; return rawRecord('new-record');}, history: async () => ({revisions: [rawRecord()], nextBeforeVersion: null})};
  const mocks = {
    react: React, 'react/jsx-runtime': req('react/jsx-runtime'), '@tanstack/react-query': req('@tanstack/react-query'), 'expo-router': {usePathname: () => '/care'},
    '../../../src/client/care-api': {CareApiError, createCareApi: () => api}, '../../../src/client/online-refresh-events': {subscribeOnlineRefresh},
    '../care-view-model': {emptyCareForm: () => ({kind: 'note', text: '', reason: ''})},
    '../profile-view-model': {emptyProfileForm: () => ({}), profileFormFromData: () => ({}), profileDataFromForm: value => value},
    '../components/care/care-form': {careFormSchema: () => ({safeParse: () => ({success: true})})}, '../components/profile/profile-form': {},
    '../workspaces/CareWorkspace': {CareWorkspaceProvider: ({value, children}) => {projection = value; return children;}},
    '../workspaces/ProfileWorkspace': {ProfileWorkspaceProvider: ({children}) => children},
    './useDomainEnvironment': {useDomainEnvironment: () => env, useDomainWriteGuard() {}},
    './CareReadCoordinator': {createCareReadCoordinator},
    './CareProfileProjections': {careRecordView: recordView, careRevisionView: value => value, savedRecordReview: value => value, careValuesFromForm: value => value, profileRevisionView: value => value},
  };
  const filename = path.join(root, 'frontend/src/production/CareProfileDomains.tsx'), module = {exports: {}};
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {fileName: filename, compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require', 'module', 'exports', code)(name => {assert.ok(mocks[name], name); return mocks[name];}, module, module.exports);
  const container = document.body.appendChild(document.createElement('section')), renderer = createRoot(container);
  const flush = async action => React.act(async () => {action?.(); for (let i = 0; i < 8; i++) await new Promise(setImmediate);});
  t.after(async () => {await flush(() => renderer.unmount()); queryClient.clear(); container.remove();});
  await flush(() => renderer.render(e(module.exports.ProductionCareProfileDomains)));
  assert.equal(projection.model.list.page, 1); await flush(() => projection.actions.loadMore()); assert.equal(projection.model.list.page, 2);
  await flush(publishOnlineRefresh); assert.equal(projection.model.list.page, 2); assert.equal(calls.at(-1).cursor, 'synthetic-page-two');
  await flush(() => projection.actions.startCreate()); await flush(() => projection.actions.reviewDraft({kind: 'note', text: 'Synthetic create', reason: ''}));
  await flush(() => projection.actions.submitReviewed()); assert.equal(writes, 1);
  assert.equal(calls.at(-1).cursor, undefined, 'A successful write changes the cursor basis: reload the first page, not the old second-page cursor');
  assert.equal(projection.model.list.page, 1); assert.equal(projection.model.list.state, 'ready'); assert.equal(projection.model.operation.state, 'saved');
});
