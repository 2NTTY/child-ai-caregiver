const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..'), req = Module.createRequire(path.join(root, 'package.json'));
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for an existing jsdom installation.');
const {JSDOM} = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div><input id="other-control"></body></html>', {pretendToBeVisual: true});
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'getComputedStyle']) global[key] = dom.window[key];
Object.defineProperty(global, 'navigator', {value: dom.window.navigator, configurable: true});
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = req('react'), {createRoot} = req('react-dom/client'), ts = req('typescript'), e = React.createElement;
let width = 736, focusEvents = [], rejectCard = false;
const realFocus = HTMLElement.prototype.focus;
HTMLElement.prototype.focus = function(...args) { const id = this.dataset.testid; focusEvents.push(id ?? this.tagName); if (rejectCard && id?.startsWith('care-history-card-')) return; return realFocus.apply(this, args); };
Object.defineProperty(HTMLElement.prototype, 'getClientRects', {configurable: true, value() { return this.isConnected && !this.closest('[hidden]') ? [{}] : []; }});
// Actual SavedRecordsView/Detail/Grid and React effects; native/layout/motion,
// write-form appearance and source transport are synthetic bounded ports.
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
    if (name === 'react-native') return {View, Pressable, Platform: {OS: 'web'}, StyleSheet: {create: value => value}};
    if (name === 'react-native-paper') return {Text};
    if (name.endsWith('/AppIcon')) return {AppIcon: ({name: iconName}) => e('span', {'aria-hidden': true, 'data-testid': `svg-icon-${iconName}`})};
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
  const calls = {close: 0, correction: 0, deletion: 0}; let deferClose = false;
  const actions = {openRecord() {model.detail = {record, history: [], historyOpen: false};}, closePanel() {calls.close++; if (!deferClose) model.detail = null;},
    showHistory() {model.detail = {...model.detail, historyOpen: true, historyState: 'ready', history: [{...current, version: 1, values: {...current.values, text: 'Synthetic original v1'}}]};},
    startCorrection(id) {assert.equal(id, record.id); calls.correction++;}, startDeletion(id) {assert.equal(id, record.id); calls.deletion++;}};
  const app = createRoot(document.getElementById('root'));
  const render = (Component = CareSavedRecordsView) => React.act(() => app.render(e(Component, {model, actions})));
  const row = () => document.querySelector('[data-testid="care-history-card-care-a"]'), list = () => document.querySelector('[data-testid="care-history-list"]');
  const button = label => [...document.querySelectorAll('button')].find(node => node.textContent === label);
  const open = async () => {row().focus(); row().click(); await render();};
  const close = async () => {button('返回記錄').focus(); button('返回記錄').click(); await render();};
  t.after(async () => {rejectCard = false; await React.act(() => app.unmount());});
  await render(); return {model, record, actions, calls, render, row, list, button, open, close, defer() {deferClose = true;}};
}

test('explicit return after original history plus resize waits for the owner and restores the exact clicked card', async t => {
  const h = await setup(t); await h.open(); await React.act(() => h.button('更正歷史').click()); await h.render();
  assert.match(document.body.textContent, /Synthetic original v1/);
  for (const value of [350, 1100]) {width = value; await h.render();}
  h.defer(); await h.close(); assert.equal(h.row(), null, 'A click does not fabricate owner closure');
  h.model.detail = null; await h.render(); assert.equal(document.activeElement, h.row());
  assert.equal(h.record.current.version, 2); assert.equal(h.calls.close, 1);
});

test('a rejecting card falls back to the named focusable list', async t => {
  const h = await setup(t); await h.open(); rejectCard = true; await h.close();
  assert.equal(document.activeElement, h.list()); assert.equal(h.list().getAttribute('aria-label'), '已保存照顧記錄清單'); assert.equal(h.list().tabIndex, -1);
});

for (const context of ['scope', 'child', 'query', 'kind', 'page', 'lost']) test(`${context} change invalidates the pending return ticket`, async t => {
  const h = await setup(t); await h.open(); h.defer(); await h.close();
  if (context === 'scope') h.model.scopeKey = 'other-parent:child-a';
  if (context === 'child') h.model.child = {id: 'child-b'};
  if (context === 'query') h.model.list.activeQuery = 'different';
  if (context === 'kind') h.model.list.activeKind = 'meal';
  if (context === 'page') h.model.list.page = 2;
  if (context === 'lost') h.model.access = 'lost';
  await h.render(); focusEvents = []; h.model.detail = null; await h.render();
  assert.ok(!focusEvents.some(id => id === 'care-history-list' || id?.startsWith('care-history-card-')));
});

test('a newer user focus cancels a deferred return even after that control is blurred', async t => {
  const h = await setup(t); await h.open(); h.defer(); await h.close();
  const other = document.getElementById('other-control'); other.focus(); other.blur();
  h.model.detail = null; await h.render(); assert.equal(document.activeElement, document.body);
});

test('global closure, correction, delete and unknown recovery do not acquire history return tickets', async t => {
  const h = await setup(t); await h.open(); h.button('更正這筆記錄').click(); h.button('永久刪除此記錄及歷史').click();
  assert.deepEqual(h.calls, {close: 0, correction: 1, deletion: 1});
  h.actions.closePanel(); await h.render(); assert.equal(document.activeElement, document.body, 'Unrelated owner closure is not intercepted');
  await h.open(); h.model.operation = {state: 'unknown', reference: 'original-op'}; h.defer(); await h.render(); await h.close();
  assert.equal(h.model.operation.reference, 'original-op'); assert.ok(h.model.detail);
  h.model.operation = {state: 'none'}; h.model.detail = null; await h.render(); assert.equal(document.activeElement, document.body);
  await h.render(CareSavedRecordsList); assert.equal(h.list(), null, 'The original active list has no added history focus surface');
});
