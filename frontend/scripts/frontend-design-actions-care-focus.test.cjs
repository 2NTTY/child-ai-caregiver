// Frontend-design reconstruction: the existing focus contract with the page-heading presentation port.
// Uses the actual CarePage and controls. It intentionally does not cover legacy capture-only fixtures.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');
const sourceRoot = path.resolve(process.env.CARE_FOCUS_SOURCE || path.join(__dirname, '../..'));
const frontend = path.join(sourceRoot, 'frontend');
const source = path.join(frontend, 'src');
const req = Module.createRequire(path.join(frontend, 'package.json'));
// Reuse an explicit existing DOM runtime without adding a product dependency.
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for an existing jsdom installation.');
const { JSDOM } = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost/care' });
// Supply viewport metrics for RN Web Dimensions; jsdom has no layout engine.
Object.defineProperty(dom.window.document.documentElement, 'clientWidth', { value: 1180 });
Object.defineProperty(dom.window.document.documentElement, 'clientHeight', { value: 757 });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'ShadowRoot', 'MutationObserver', 'getComputedStyle']) global[key] = dom.window[key];
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
global.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
const React = req('react'), { createRoot } = req('react-dom/client'), ts = req('typescript'), rn = req('react-native-web');
const originalLoad = Module._load;
Module._load = function(name, parent, isMain) {
  if (name === 'react-native') return rn;
  return originalLoad.call(this, name, parent, isMain);
};
const paper = {
  MD3LightTheme: req('react-native-paper/lib/commonjs/styles/themes/v3/LightTheme').MD3LightTheme,
  configureFonts: req('react-native-paper/lib/commonjs/styles/fonts').default,
  Text: req('react-native-paper/lib/commonjs/components/Typography/Text').default,
  Button: req('react-native-paper/lib/commonjs/components/Button/Button').default,
  TextInput: req('react-native-paper/lib/commonjs/components/TextInput/TextInput').default,
  HelperText: req('react-native-paper/lib/commonjs/components/HelperText/HelperText').default,
  Portal: ({ children }) => children,
};
const empty = () => null;
const view = React.forwardRef(({ children, preset, triggerKey, scopeKey, enabled, ...props }, ref) => React.createElement(rn.View, { ...props, ref }, children));
// Preserve the actual RN Web modal/focus trap; only the dialog appearance is a host port.
const modal = Object.assign(function Dialog({ visible, onDismiss, onClosed, children, accessibilityLabel, testID }) {
  return React.createElement(rn.Modal, { visible, transparent: true, animationType: 'none', onRequestClose: onDismiss, onDismiss: onClosed, 'aria-label': accessibilityLabel },
    React.createElement('section', { 'data-testid': testID }, children));
}, Object.fromEntries(['Title', 'Content', 'Actions', 'ScrollArea'].map(key => [key, ({ children }) => React.createElement('div', null, children)])));
// JSDOM has no layout; connected/visible geometry is a bounded host measurement port.
Object.defineProperty(HTMLElement.prototype, 'getClientRects', { configurable: true, value() { return this.isConnected && !this.closest('[aria-hidden="true"]') ? [{}] : []; } });
const Workspace = React.createContext(null);
const cache = new Map(), loaded = [], observations = [];
let networkCalls = 0, writes = 0, ownerCalls = [];
const originalFetch = global.fetch;
global.fetch = () => { networkCalls++; throw new Error('Network forbidden in this diagnostic'); };
const globalModel = { selectedChildId: 'child-focus', children: [{ id: 'child-focus', name: 'Synthetic child' }] };
const globalProduction = {
  scopeKey: 'synthetic:child-focus', selectedChildId: 'child-focus', online: true,
  model: globalModel, actions: { open: empty },
  agentPending: { state: 'ready', entries: [], hasSnapshot: true, nextCursor: null },
  agentModel: {}, agentActions: {}, readAgentPending: empty, selectAgentRun: empty,
};
function load(file) {
  const filename = path.resolve(source, file);
  if (cache.has(filename)) return cache.get(filename).exports;
  const raw = fs.readFileSync(filename);
  loaded.push({ path: path.relative(source, filename), sha256: crypto.createHash('sha256').update(raw).digest('hex') });
  const module = { exports: {} }; cache.set(filename, module);
  const code = ts.transpileModule(raw.toString('utf8'), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'react-native') return rn;
    if (name === 'react-native-paper') return paper;
    if (name === 'expo-router') return { usePathname: () => '/care', useLocalSearchParams: () => ({}), useRouter: () => ({ push: empty }) };
    if (name.endsWith('/production/ProductionProvider')) return { useProduction: () => globalProduction };
    if (name.endsWith('/production/CareProfileDomains')) return { useProductionCareProfile: () => ({ pending: false }) };
    if (name.endsWith('/production/useDomainEnvironment')) return { useDomainEnvironment: () => ({ canStartWrite: () => true }) };
    if (name.endsWith('/workspaces/CareWorkspace')) return { useCareWorkspace: () => React.useContext(Workspace) };
    if (name.endsWith('/PreviewNavigationGuard')) return { usePreviewNavigation: () => callback => callback(), usePreviewLeaveGuard: empty };
    if (name.endsWith('/PageFrame')) return { PageFrame: ({ children, headerActions }) => React.createElement(rn.View, { testID: 'synthetic-page-frame' }, React.createElement(rn.View, { testID: 'synthetic-page-heading' }, headerActions), children) };
    if (name.endsWith('/AppIcon')) return { AppIcon: empty };
    if (name.endsWith('/StatusAnnouncement')) return { StatusAnnouncement: empty };
    if (name.endsWith('/AppScrollView')) return { AppScrollView: rn.ScrollView };
    if (name.endsWith('/AppDialog')) return { AppDialog: modal };
    if (name.endsWith('/AppRadioItem')) return { AppRadioItem: empty };
    if (name.endsWith('/HorizontalOverflowRail')) return { HorizontalOverflowRail: view };
    if (name.endsWith('/useInteractionDensity')) return { useInteractionDensity: () => false };
    if (name.endsWith('/motion/preferences')) return { useMotionPreferences: () => ({ enabled: false, epoch: 0 }) };
    if (name.endsWith('/MotionSelectionMarker')) return { MotionSelectionMarker: empty };
    if (name.endsWith('/motion')) return { MotionEntrance: view, MotionReveal: ({ value, children }) => children(value), MotionDisclosure: ({ expanded, children }) => expanded ? children : null };
    if (name.endsWith('/photosScreen')) return { PhotoWorkspace: empty };
    if (name.endsWith('/agent/AgentRunView')) return { AgentRunView: empty };
    if (!name.startsWith('.')) return req(name);
    const target = path.resolve(path.dirname(filename), name);
    const resolved = fs.existsSync(target + '.tsx') ? target + '.tsx' : fs.existsSync(target + '.ts') ? target + '.ts' : target;
    return load(path.relative(source, resolved));
  }, module, module.exports);
  return module.exports;
}
const CarePage = load('screens/careScreen.tsx').default;
const formValues = () => ({ kind: 'note', text: '', source: '', quantityRaw: '', quantityUnit: '', quantityPrecision: 'approximate', eventTimeRaw: '', reason: '' });
const record = { id: 'record-focus', childId: 'child-focus', title: 'Synthetic saved record', createdAtLabel: 'Synthetic date', history: [], current: { version: 1, values: { ...formValues(), text: 'Synthetic care content', source: 'Synthetic observation' }, eventTimePrecision: 'unknown', timeZoneLabel: 'UTC', confirmedByLabel: 'Synthetic caregiver', confirmedAtLabel: 'Synthetic date' } };
const initialModel = () => ({
  scopeKey: 'synthetic:child-focus', child: { id: 'child-focus', name: 'Synthetic child' }, access: 'editable', online: true,
  operation: { state: 'none', message: '' }, draft: null, detail: null, deletion: null,
  list: { state: 'ready', hasSnapshot: true, records: [record], activeQuery: '', activeKind: 'all', hasMore: false, hasPrevious: false, message: null, page: 1 },
  review: { state: 'ready', scopeKey: 'synthetic:child-focus', items: [], hasMore: false, label: '' }, submitLabel: '確認共享', checkLabel: '查核原操作',
});
let publishModel, refuseClose = false;
const LayoutPublishingOwner = React.memo(function LayoutPublishingOwner({ publish }) {
  const [model, setModel] = React.useState(initialModel); publishModel = setModel;
  const forbidden = () => { writes++; throw new Error('Submission is outside this diagnostic'); };
  const actions = {
    closePanel() { ownerCalls.push(refuseClose ? 'closePanel-refused' : 'closePanel'); if (refuseClose) return; setModel(previous => ({ ...previous, detail: null, draft: null, deletion: null, operation: { state: 'none', message: '' } })); },
    openRecord(id) { assert.equal(id, record.id); ownerCalls.push('openRecord'); setModel(previous => ({ ...previous, detail: { record, historyOpen: false, history: [], historyLoading: false, historyState: 'unread', hasMoreHistory: false } })); },
    startCreate() { ownerCalls.push('startCreate'); setModel(previous => ({ ...previous, detail: null, draft: { key: 'synthetic-draft', mode: 'create', basis: null, initialValues: formValues(), reviewedValues: null } })); },
    reviewCapture(id) { ownerCalls.push('reviewCapture'); setModel(previous => { const capture = previous.review.items.find(item => item.id === id); assert.ok(capture); return { ...previous, draft: { key: 'synthetic-capture-draft', mode: 'create', basis: null, initialValues: capture.proposedValues, reviewedValues: null, captureId: id, captureSnapshot: capture } }; }); },
    search: empty, loadMore: empty, showHistory: empty, loadOlderHistory: empty, editDraft: empty,
    reviewDraft: forbidden, submitReviewed: forbidden, startCorrection: forbidden, startDeletion: forbidden,
  };
  // Match the nonvisual owner-to-provider publication boundary in production.
  React.useLayoutEffect(() => { publish({ scopeKey: model.scopeKey, model, actions }); });
  return null;
});
function Host() {
  const [projection, publish] = React.useState(null);
  return React.createElement(React.Fragment, null,
    React.createElement(LayoutPublishingOwner, { publish }),
    React.createElement(Workspace.Provider, { value: projection }, React.createElement(CarePage)));
}
const root = createRoot(document.getElementById('root'));
const byLabel = label => document.querySelector(`[aria-label="${label}"]`);
async function click(label) {
  const target = byLabel(label); assert.ok(target, `Control exists: ${label}`);
  await React.act(async () => { target.focus(); assert.equal(document.activeElement, target); target.click(); });
}
async function start() { await React.act(async () => root.render(null)); await React.act(async () => root.render(React.createElement(Host))); }
function inspect(stage) {
  const active = document.activeElement;
  const observation = { stage, activeTag: active?.tagName, activeTestId: active?.getAttribute('data-testid'), activeLabel: active?.getAttribute('aria-label'), connected: active?.isConnected, logicalTarget: !!active && active !== document.body && active !== document.documentElement && document.getElementById('root').contains(active), detailMounted: !!byLabel('返回記錄'), draftMounted: !!byLabel('關閉記錄資料'), savedRecordAvailable: !!byLabel('查看Synthetic care content'), networkCalls, writes };
  observations.push(observation); console.log(JSON.stringify(observation)); return observation;
}
const sentinel = document.createElement('button'); sentinel.textContent = 'Synthetic unrelated control'; sentinel.id = 'focus-sentinel'; document.body.appendChild(sentinel);
const originalFocus = window.HTMLElement.prototype.focus;
let captureFocus = false, programmaticFocus = [];
window.HTMLElement.prototype.focus = function(options) { if (captureFocus) programmaticFocus.push({ tag: this.tagName, testId: this.getAttribute('data-testid'), label: this.getAttribute('aria-label'), options }); return originalFocus.call(this, options); };
async function activateWithoutTestFocus(label) {
  const target = byLabel(label); assert.ok(target); await React.act(async () => target.focus());
  programmaticFocus = []; captureFocus = true; await React.act(async () => target.click());
}
async function moveToDraftAnchor() { captureFocus = false; await React.act(async () => byLabel('資料來源草稿').focus()); programmaticFocus = []; captureFocus = true; }
const productFocus = () => programmaticFocus.filter(item => item.options?.preventScroll === true);
async function update(transform) { await React.act(async () => publishModel(transform)); }
let stopped = false;
function register(name, body) {
  test(name, async context => {
    if (stopped) { context.skip('Stopped after the first failing case.'); return; }
    refuseClose = false; captureFocus = false; programmaticFocus = [];
    try { await body(); } catch (error) { stopped = true; throw error; }
  });
}
register('the route separates its primary create action from the counted review chapters', async () => {
  await start();
  const bar = document.querySelector('[data-testid="care-review-tabs-bar"]');
  assert.ok(bar);
  const tabs = [...bar.querySelectorAll('[role="tab"]')];
  assert.deepEqual(tabs.map(tab => tab.getAttribute('aria-label')), ['待確認 0', '已保存']);
  assert.equal(tabs[0].textContent, '待確認0');
  assert.equal(tabs[0].querySelector('[aria-hidden="true"]').textContent, '0');
  const trigger = byLabel('手動新增共享記錄');
  assert.equal(trigger.textContent, '新增記錄');
  assert.ok(document.querySelector('[data-testid="synthetic-page-heading"]').contains(trigger));
  assert.equal(bar.contains(trigger), false);
  assert.equal([...document.querySelectorAll('[aria-label="手動新增共享記錄"]')].length, 1);
  assert.equal(byLabel('查看Synthetic care content'), null);
  const panelId = tabs[1].getAttribute('aria-controls');
  await click('已保存');
  assert.equal(byLabel('已保存').getAttribute('aria-selected'), 'true');
  assert.ok(document.getElementById(panelId));
  assert.equal([...document.querySelectorAll('[aria-label="查看Synthetic care content"]')].length, 1);
  assert.equal([...document.querySelectorAll('[aria-label="搜尋已保存記錄"]')].length, 1);
  assert.equal(document.body.textContent.includes('查找已保存記錄'), false);
  assert.equal(networkCalls, 0); assert.equal(writes, 0);
});
for (const scenario of ['detail', 'draft']) register(`layout-published owner: outer control and inner ${scenario} return focus`, async () => {
  await start(); await click('已保存'); await click('查看Synthetic care content');
  assert.ok(byLabel('返回記錄')); assert.ok(byLabel('查看Synthetic care content'), 'The single saved list stays mounted beside desktop detail');
  await click('收起內容');
  const control = inspect('outer-control'); assert.equal(control.logicalTarget, true, 'The outer control demonstrates actual RN Web focus support');
  assert.equal(control.activeTestId, 'care-review-list'); assert.equal(control.savedRecordAvailable, true);
  await start();
  if (scenario === 'draft') { await click('手動新增共享記錄'); assert.equal(byLabel('記錄原文草稿').value, ''); await click('關閉記錄資料'); }
  else { await click('已保存'); await click('查看Synthetic care content'); await click('返回記錄'); }
  const observed = inspect(`inner-${scenario}`);
  assert.equal(observed.detailMounted, false); assert.equal(observed.draftMounted, false); assert.equal(observed.savedRecordAvailable, scenario === 'detail');
  assert.equal(networkCalls, 0); assert.equal(writes, 0);
  assert.equal(observed.logicalTarget, true, 'An explicit inline close should restore connected, non-BODY active UI focus; no exact list/trigger target or Tab sequence is prescribed');
  if (scenario === 'draft') { assert.equal(document.activeElement, byLabel('手動新增共享記錄')); await click('已保存'); assert.ok(byLabel('查看Synthetic care content')); }
});

for (const scenario of ['refusal-pending', 'refusal-unknown', 'refusal-saved', 'scope']) register(`close-focus guard: ${scenario}`, async () => {
  await start();
  await click('手動新增共享記錄'); refuseClose = true;
  await activateWithoutTestFocus('關閉記錄資料');
  assert.equal(programmaticFocus.length, 0, 'An owner refusal cannot add a programmatic focus');
  await moveToDraftAnchor();
  if (scenario === 'scope') {
    await update(previous => ({ ...previous, scopeKey: 'synthetic:other-child', child: { id: 'other-child', name: 'Other synthetic child' }, detail: null, draft: null, deletion: null, review: { ...previous.review, scopeKey: 'synthetic:other-child', items: [] }, operation: { state: 'none', message: '' } }));
  } else if (scenario === 'refusal-saved') {
    await update(previous => ({ ...previous, detail: null, draft: null, deletion: null, operation: { state: 'saved', message: 'Synthetic operation completed' } }));
  } else {
    await update(previous => ({ ...previous, operation: { state: scenario === 'refusal-unknown' ? 'unknown' : 'saving', message: 'Synthetic operation pending' } }));
    assert.ok(byLabel('關閉記錄資料'), 'The first new projection remains occupied');
  }
  assert.equal(productFocus().length, 0, 'The first ineligible or changed-scope projection drops the explicit close-focus intent');
  if (scenario === 'refusal-pending' || scenario === 'refusal-unknown') assert.ok(byLabel('關閉記錄資料'), 'Unknown/in-flight owner state keeps the draft modal open');
  else { captureFocus = false; await React.act(async () => sentinel.focus()); programmaticFocus = []; captureFocus = true; }
  await update(previous => ({ ...previous, detail: null, draft: null, deletion: null, operation: { state: 'none', message: '' } }));
  assert.equal(productFocus().length, 0, 'A later empty/none projection cannot revive the explicit close focus request');
  if (scenario !== 'refusal-pending' && scenario !== 'refusal-unknown') assert.equal(document.activeElement, sentinel);
  observations.push({ scenario, activeTag: document.activeElement.tagName, activeTestId: document.activeElement.getAttribute('data-testid'), activeId: document.activeElement.id, programmaticFocus, networkCalls, writes });
  console.log(JSON.stringify(observations[observations.length - 1]));
  assert.equal(networkCalls, 0); assert.equal(writes, 0);
});

test.after(async () => {
  captureFocus = false;
  await React.act(async () => root.unmount());
  if (process.env.OUTPUT_DIR) {
    const output = path.resolve(process.env.OUTPUT_DIR);
    if (output === sourceRoot || output.startsWith(sourceRoot + path.sep)) throw new Error('OUTPUT_DIR must be outside CARE_FOCUS_SOURCE.');
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'frontend-design-actions-care-focus-observations.json'), JSON.stringify({ sourceRoot, observations, ownerCalls, networkCalls, writes, loaded, boundary: 'Actual CarePage route composition, CareRecordsView, CareReviewWorkspace, SavedRecords, Detail, Form, UI and installed Paper/RN Web controls. Synthetic memoized in-memory owner publishes through useLayoutEffect; route/context ports, page shell, animation, decorative icons and live announcements are bounded doubles. No real services, layout/visibility, screen-reader, WCAG-conformance or browser-native Tab traversal claim. The harness does not modify product source.' }, null, 2) + '\n');
  }
  window.HTMLElement.prototype.focus = originalFocus; Module._load = originalLoad; global.fetch = originalFetch; dom.window.close();
});
