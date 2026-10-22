const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..'), req = Module.createRequire(path.join(root, 'package.json'));
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for an existing jsdom installation.');
const {JSDOM} = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div><input id="other-control"></body></html>', {pretendToBeVisual: true});
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'getComputedStyle', 'ShadowRoot']) global[key] = dom.window[key];
Object.defineProperty(global, 'navigator', {value: dom.window.navigator, configurable: true});
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = req('react'), {createRoot} = req('react-dom/client'), ts = req('typescript'), e = React.createElement;
let width = 736, focusEvents = [], rejectCard = false;
const realFocus = HTMLElement.prototype.focus;
HTMLElement.prototype.focus = function(...args) { const id = this.dataset.testid; focusEvents.push(id ?? this.tagName); if (rejectCard && id?.startsWith('care-history-card-')) return; return realFocus.apply(this, args); };
Object.defineProperty(HTMLElement.prototype, 'getClientRects', {configurable: true, value() { return this.isConnected && !this.closest('[hidden]') ? [{}] : []; }});
// Actual SavedRecordsView/Detail/Grid, React DOM and installed RN Web; layout/motion,
// write-form appearance and API transport remain synthetic bounded ports.
const View = React.forwardRef(({children, testID, accessibilityLabel, tabIndex}, ref) => e('div', {ref, tabIndex, 'data-testid': testID, 'aria-label': accessibilityLabel}, children));
const Pressable = React.forwardRef(({children, testID, accessibilityLabel, onPress, disabled}, ref) => e('button', {ref, onClick: onPress, disabled, 'data-testid': testID, 'aria-label': accessibilityLabel}, children));
const Button = ({label, onPress, disabled}) => e('button', {onClick: onPress, disabled}, label);
const Text = ({children}) => e('span', null, children), Empty = () => null;
const theme = {colors: {}, radius: {}, readingType: {}, workspaceType: {}, spacing: {xs: 4, sm: 8, md: 12, lg: 16}}, cache = new Map();
function load(relative) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = {exports: {}}; cache.set(filename, module);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {fileName: filename, compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require', 'module', 'exports', output)(name => {
    if (name === 'react-native') return req('react-native-web');
    if (name === 'react-native-paper') return {Text};
    if (name.endsWith('/theme')) return theme;
    if (name.endsWith('/useContainerWidth')) return {useContainerWidth: () => ({width, ref: null, onLayout() {}})};
    if (name.endsWith('/ui')) return {AppButton: Button, AppTextField: Empty, AppSelect: Empty, AppSelectionTrigger: Button, SectionHeader: ({action}) => e('header', null, action)};
    if (name.endsWith('/motion')) return {MotionReveal: ({children, value}) => children(value), MotionDisclosure: ({children, expanded}) => expanded ? children : null};
    if (name.endsWith('/FormDialog')) return {FormDialog: ({visible, children, onClose}) => visible ? e('section', {'data-testid': 'correction-form'}, e(Button, {label: 'Close form', onPress: onClose}), children) : null};
    const ports = {AppStatusBadge: Empty, ReadStateNotice: View, CareWriteNotice: Empty, CareRecordForm: Empty, CareRecordDelete: Empty};
    if (/\/(AppStatusBadge|ReadStateNotice|CareReviewHistoryView|CareRecordForm|CareRecordDelete)$/.test(name)) return ports;
    if (!name.startsWith('.')) return req(name);
    const target = path.resolve(path.dirname(filename), name), found = [target, `${target}.ts`, `${target}.tsx`].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
    return load(path.relative(root, found));
  }, module, module.exports);
  return module.exports;
}
const {CareSavedRecordsView, CareSavedRecordsList} = load('src/components/care/CareSavedRecordsView.tsx');
async function setup(t) {
  width = 736; rejectCard = false; focusEvents = [];
  const current = {version: 2, values: {kind: 'note', text: 'Synthetic current v2', source: 'Synthetic', quantityRaw: '', eventTimeRaw: '', reason: ''}, eventTimePrecision: 'exact', confirmedByLabel: 'Synthetic', confirmedAtLabel: '2026-10-22'};
  const record = {id: 'care-a', childId: 'child-a', title: 'Synthetic care', current, createdAtLabel: '2026-10-20'};
  const model = {scopeKey: 'parent:child-a', child: {id: 'child-a'}, access: 'editable', online: true, operation: {state: 'none'}, draft: null, deletion: null, detail: null,
    list: {records: [record], state: 'ready', activeQuery: '', activeKind: 'all', page: 1, hasSnapshot: true, message: null, hasMore: false, hasPrevious: false}};
  const calls = {open: 0, close: 0, correction: 0, deletion: 0}; let deferClose = false;
  const actions = {openRecord() {calls.open++; model.detail = {record, history: [], historyOpen: false};}, closePanel() {calls.close++; if (!deferClose) model.detail = null;},
    showHistory() {model.detail = {...model.detail, historyOpen: true, historyState: 'ready', history: [{...current, version: 1, values: {...current.values, text: 'Synthetic original v1'}}]};},
    startCorrection(id) {assert.equal(id, record.id); calls.correction++;}, startDeletion(id) {assert.equal(id, record.id); calls.deletion++;}};
  const app = createRoot(document.getElementById('root'));
  const render = (Component = CareSavedRecordsView) => React.act(() => app.render(e(Component, {model, actions})));
  const row = () => document.querySelector('[data-testid="care-history-card-care-a"]'), list = () => document.querySelector('[data-testid="care-history-list"]');
  const button = label => [...document.querySelectorAll('button')].find(node => node.textContent === label);
  const open = async () => {await React.act(() => {row().focus(); row().click();}); await render();};
  const close = async () => {await React.act(() => {button('返回記錄').focus(); button('返回記錄').click();}); await render();};
  t.after(async () => {rejectCard = false; await React.act(() => app.unmount());});
  await render(); return {model, record, actions, calls, render, row, list, button, open, close, defer() {deferClose = true;}};
}


// The real coordinator controls ready -> same-scope loading -> ready. No second
// read owner or hand-written loading projection is used in this regression.
async function refreshOwner(h, t) {
  const {QueryClient} = req('@tanstack/react-query');
  const {createCareReadCoordinator} = req(path.join(root, 'src/production/CareReadCoordinator.ts'));
  const client = new QueryClient({defaultOptions: {queries: {retry: false, gcTime: Infinity}}});
  t.after(() => client.clear());
  const state = {careRef: {current: h.model}, writing: {current: false}, attempt: {current: null}, careRead: {current: null}, careGeneration: {current: 0}, recordReadGeneration: {current: 0}, recordRemovals: {current: new Map()}, historyGeneration: {current: 0}, openGeneration: {current: 0}, pageCursors: {current: [null]}, pageIndex: {current: 0}, nextCursor: {current: null}, careHistoryCursor: {current: null}};
  const page = {records: [{id: h.record.id, childId: h.record.childId, version: 2}], nextCursor: null, scanned: 1};
  let release;
  const response = new Promise(resolve => { release = resolve; });
  const reads = createCareReadCoordinator({queryClient: client, state, careKey: ['synthetic-care-refresh'], childId: h.record.childId, userId: 'synthetic-user', scopeKey: h.model.scopeKey,
    current: () => h.model.access !== 'lost', online: () => true, controller: () => new AbortController(), released() {}, onAccessError() {},
    setCare: change => Object.assign(h.model, change(h.model)),
    api: {getSession: async () => 'synthetic-user', search: () => response},
    careRecordView: raw => ({...h.record, current: {...h.record.current, version: raw.version}}), careRevisionView: value => value, savedRecordReview: () => null,
    careOperation: () => ({state: 'none'})});
  reads.publishPage(page, '', 'all', 0, 0);
  h.actions.openRecord = id => {h.calls.open++; reads.openRecord(id);};
  await h.render();
  return {async begin() {const work = reads.loadCare(); await h.render(); return async () => {release(page); await work; await h.render();};}};
}
async function tryActivations(row) {
  await React.act(() => {
    row.click();
    for (const key of ['Enter', ' ']) {
      row.dispatchEvent(new window.KeyboardEvent('keydown', {key, bubbles: true, cancelable: true}));
      row.dispatchEvent(new window.KeyboardEvent('keyup', {key, bubbles: true, cancelable: true}));
      // JSDOM does not perform browser default keyboard clicks; exercise that
      // exact DOM click route too. Real browser keyboard QA remains separate.
      row.dispatchEvent(new window.MouseEvent('click', {detail: 0, bubbles: true, cancelable: true}));
    }
  });
}

test('true RN Web and Care coordinator preserve the exact return card through a quiet refresh without permitting activation', async t => {
  const h = await setup(t), owner = await refreshOwner(h, t);
  await h.open(); await h.close(); const row = h.row(); assert.equal(document.activeElement, row);
  const finish = await owner.begin();
  assert.equal(h.model.list.state, 'loading'); assert.equal(h.model.list.hasSnapshot, true);
  assert.equal(h.row(), row); assert.equal(row.disabled, false, 'A native disabled transition must not blur the returned card');
  assert.equal(row.getAttribute('aria-disabled'), 'true'); assert.equal(row.tabIndex, -1);
  const opened = h.calls.open; await tryActivations(row); assert.equal(h.calls.open, opened, 'Mouse and keyboard-generated clicks remain blocked'); assert.equal(h.model.detail, null);
  await h.render(); assert.equal(h.row(), row); assert.equal(row.getAttribute('aria-disabled'), 'true', 'Ref callback replacement must not erase the ARIA guard');
  await finish(); assert.equal(h.row(), row); assert.equal(row.disabled, false); assert.equal(row.hasAttribute('aria-disabled'), false); assert.equal(row.tabIndex, 0); assert.equal(document.activeElement, row);
});

test('busy operation, lost authority and first read never receive the quiet-refresh exception', async t => {
  const h = await setup(t), owner = await refreshOwner(h, t); await h.open(); await h.close();
  const finish = await owner.begin(); h.model.operation = {state: 'unknown', reference: 'same-original-operation'}; await h.render();
  const row = h.row(); assert.equal(row.disabled, true); assert.equal(row.getAttribute('aria-disabled'), 'true');
  const opened = h.calls.open; await tryActivations(row); assert.equal(h.calls.open, opened); assert.equal(h.model.operation.reference, 'same-original-operation');
  h.model.access = 'lost'; await h.render(); assert.equal(h.row(), null); await finish(); assert.equal(h.row(), null);
  h.model.access = 'editable'; h.model.operation = {state: 'none'}; h.model.list.state = 'loading'; h.model.list.hasSnapshot = false; await h.render(); assert.equal(h.row(), null);
});

test('quiet refresh never reclaims focus that the user moved elsewhere', async t => {
  const h = await setup(t), owner = await refreshOwner(h, t); await h.open(); await h.close();
  const other = document.getElementById('other-control'); await React.act(() => other.focus());
  const finish = await owner.begin(); assert.equal(document.activeElement, other); await finish(); assert.equal(document.activeElement, other);
});

test('other HistoryEntryCard callers keep native disabled semantics by default', async t => {
  const {HistoryEntryCard} = load('src/components/history/HistoryCards.tsx');
  const app = createRoot(document.getElementById('root')); t.after(async () => {await React.act(() => app.unmount());});
  let calls = 0; await React.act(() => app.render(e(HistoryEntryCard, {disabled: true, accessibilityLabel: 'Default disabled history entry', onPress() {calls++;}}, e(Text, null, 'Synthetic'))));
  const row = document.querySelector('[aria-label="Default disabled history entry"]'); assert.equal(row.disabled, true); assert.equal(row.getAttribute('aria-disabled'), 'true'); await tryActivations(row); assert.equal(calls, 0);
});
