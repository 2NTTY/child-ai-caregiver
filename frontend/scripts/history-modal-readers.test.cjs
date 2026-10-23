const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for an existing jsdom installation.');
const {JSDOM} = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>', {pretendToBeVisual: true, url: 'http://localhost/'});
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'ShadowRoot', 'Document']) global[key] = dom.window[key];
Object.defineProperty(global, 'navigator', {value: dom.window.navigator, configurable: true});
global.requestAnimationFrame = window.requestAnimationFrame.bind(window);
global.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
global.IS_REACT_ACT_ENVIRONMENT = true;
global.fetch = () => {throw new Error('Real network is forbidden');};
Object.defineProperty(HTMLElement.prototype, 'getClientRects', {configurable: true, value() {return this.isConnected && !this.closest('[hidden],[aria-hidden="true"]') ? [{}] : [];}});
const root = path.resolve(__dirname, '..'), req = createRequire(path.join(root, 'package.json'));
const React = req('react'), {createRoot} = req('react-dom/client'), native = req('react-native-web'), ts = req('typescript'), e = React.createElement;
const Module = require('node:module'), originalLoad = Module._load;
Module._load = function(name, ...args) {
  if (name === 'react-native') return native;
  if (name === 'react-native-safe-area-context') return {useSafeAreaInsets: () => ({top: 0, right: 0, bottom: 0, left: 0}), SafeAreaView: native.View};
  if (name.endsWith('/SafeAreaProviderCompat')) return {__esModule: true, default: p => p.children};
  if (name.endsWith('/MaterialCommunityIcon')) return {__esModule: true, default: () => null};
  return originalLoad.call(this, name, ...args);
};
const paper = req('react-native-paper');
let width = 1100, tasks, preparations, renderCurrent, navigationCalls = 0, ownerCloseCalls = 0, writes = 0;
const cache = new Map(), Empty = () => null;
const Button = React.forwardRef((p, ref) => e(native.Pressable, {ref, onPress: p.onPress, disabled: p.disabled, accessibilityRole: 'button', accessibilityLabel: p.accessibilityLabel ?? p.label}, e(native.Text, null, p.label)));
// Actual reader components, FormDialog, AppDialog and installed RN Web Modal/focus trap.
// Data owners, decorative children and width are ports. jsdom scrollTop/DOM identity
// are not browser layout, visible focus, viewport geometry or visual acceptance.
function load(relative) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = {exports: {}}; cache.set(filename, module);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {fileName: filename, compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'react-native') return native;
    if (name.endsWith('/workspaces/TasksWorkspace')) return {useTasksWorkspace: () => tasks};
    if (name.endsWith('/workspaces/PreparationWorkspace')) return {usePreparationWorkspace: () => preparations};
    if (name.endsWith('/PreviewNavigationGuard')) return {usePreviewNavigation: () => callback => {navigationCalls++; callback();}};
    if (name.endsWith('/useContainerWidth')) return {useContainerWidth: () => ({width, ref: null, onLayout() {}})};
    if (name.endsWith('/AppScrollView')) return {AppScrollView: React.forwardRef((p, ref) => e(native.ScrollView, {...p, ref, tabIndex: 0, testID: 'reader-scroll'}))};
    if (name.endsWith('/ui')) return {AppButton: Button, AppSelect: Empty, SectionCard: native.View, SectionHeader: p => e(native.View, null, e(native.Text, null, p.title), p.action)};
    if (name.endsWith('/motion')) return {motionTokens: {dialog: {distance: 12, duration: 0}}, useMotionPreferences: () => ({enabled: false, epoch: 0}), MotionBackdrop: Empty,
      MotionDisclosure: p => p.expanded ? p.children : null, MotionFeedback: p => p.children, MotionReveal: p => typeof p.children === 'function' ? p.children(p.value) : p.children};
    if (name.endsWith('/MotionPaperScope')) return {MotionPaperScope: p => p.children};
    if (name.endsWith('/useModalBackdrop')) return {useModalBackdrop: () => ({})};
    const ports = {AppIcon: Empty, AppStatusBadge: p => e(native.Text, null, p.label), StatusAnnouncement: Empty, WriteRecoveryNotice: Empty, ReadStateNotice: p => p.children,
      AppCheckbox: p => e(native.View, {testID: 'editable-checkbox'}, e(native.Text, null, p.label)), SummaryDisclosure: Empty, EmptyListCard: native.View, DocumentCreateForm: Empty};
    if (/\/(AppIcon|AppStatusBadge|StatusAnnouncement|WriteRecoveryNotice|ReadStateNotice|AppCheckbox|SummaryDisclosure|EmptyListCard|DocumentCreateForm)$/.test(name)) return ports;
    if (name.startsWith('.')) {
      const base = path.resolve(path.dirname(filename), name), found = [base, base + '.tsx', base + '.ts'].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
      if (found) return load(path.relative(root, found));
    }
    return req(name);
  }, module, module.exports);
  return module.exports;
}
const {TaskHistoryView} = load('src/components/tasks/TaskHistoryView.tsx');
const {PreparationHistoryView} = load('src/components/preparations/PreparationWorkspace.tsx');
const {createTaskFixture, taskPreviewClock} = load('src/preview/task-fixture.ts');
const {paperTheme} = load('src/theme.ts');
const byId = id => document.querySelector(`[data-testid="${id}"]`);
const labelled = label => document.querySelector(`[aria-label="${label}"]`);
const range = {from: null, to: null};
const scrollCalls = [], outerRef = {current: {scrollTo: value => scrollCalls.push(value)}};
const renderer = createRoot(document.getElementById('root'));
function prepDoc(id) {return {id, childId: 'synthetic-child', version: 3, status: 'archived', archivedAt: '2026-10-20T00:00:00Z', purpose: 'school', readState: 'ready', historical: false, sources: [], revision: {id: `snapshot-${id}`, number: 2, title: `Synthetic ${id}`, summary: 'Synthetic long original', updatedAt: '2026-10-20T00:00:00Z', sections: [{id: 'checklist', kind: 'checklist', title: 'Synthetic checklist', items: [{id: 'one', text: 'Synthetic item', checked: true}]}], sourceRefs: []}};}
async function setup(kind, initialWidth = 1100) {
  await React.act(async () => renderer.render(null));
  width = initialWidth; navigationCalls = 0; ownerCloseCalls = 0; writes = 0; scrollCalls.length = 0;
  const fixture = createTaskFixture('synthetic-child', 'normal');
  tasks = {scopeKey: 'parent:synthetic-child', model: {...fixture, child: {id: 'synthetic-child'}, access: 'editable', online: true, readState: 'ready', reading: false,
    selected: null, draft: null, operation: {state: 'none'}, history: [], historyOpen: false, scheduleContext: taskPreviewClock}, actions: {
    selectTask(id) {tasks.model = {...tasks.model, selected: tasks.model.items.find(item => item.id === id)};},
    closePanel() {ownerCloseCalls++; tasks.model = {...tasks.model, selected: null, operation: {state: 'none'}};}, showHistory() {tasks.model = {...tasks.model, historyOpen: true};},
  }};
  preparations = {scopeKey: 'parent:synthetic-child', model: {scope: {childId: 'synthetic-child', online: true, condition: 'ready', role: 'owner'}, child: {id: 'synthetic-child', displayName: 'Synthetic'},
    documents: [prepDoc('doc-a'), prepDoc('doc-b'), prepDoc('doc-c')], selected: null, condition: 'ready', online: true, capabilities: {checkItem: true, restore: true},
    reading: {indexes: [], archiveStarted: true, archiveReady: true, archiveHasMore: false, pageBusy: false, ensureArchived() {}}}, actions: {
    selectDocument(id) {preparations.model = {...preparations.model, selected: preparations.model.documents.find(item => item.id === id)};},
    closeDocument() {ownerCloseCalls++; preparations.model = {...preparations.model, selected: null};}, restoreDocument() {writes++;}, checkItem() {writes++;},
  }};
  const Component = kind === 'tasks' ? TaskHistoryView : PreparationHistoryView;
  renderCurrent = () => React.act(async () => renderer.render(e(paper.PaperProvider, {theme: paperTheme, settings: {rippleEffectEnabled: false}},
    e(native.View, {testID: 'outer-scroll', style: {height: 400, overflow: 'scroll'}}, e(Component, {searchText: '', dateRange: range, scrollRef: outerRef, getScrollPosition: () => 420})))));
  await renderCurrent();
  const owner = () => kind === 'tasks' ? tasks : preparations;
  const rows = () => [...document.querySelectorAll(kind === 'tasks' ? '[data-testid^="task-row-"]' : '[data-testid^="preparation-row-"]')];
  const list = () => byId(kind === 'tasks' ? 'task-history-list' : 'preparation-document-list');
  const close = () => labelled(kind === 'tasks' ? '關閉事項詳情' : '關閉準備單詳情');
  const click = async node => {assert.ok(node); await React.act(async () => {node.focus(); node.click();}); await renderCurrent();};
  return {owner, rows, list, close, click};
}
for (const kind of ['tasks', 'preparations']) test(`${kind}: modal keeps the list identity/scroll and returns to the original card across widths`, async () => {
  for (const initialWidth of [1100, 390]) {
    const h = await setup(kind, initialWidth), list = h.list(), rows = h.rows(), original = rows[0];
    const outer = byId('outer-scroll'); outer.scrollTop = 420;
    const listStyle = list.getAttribute('style'), parentStyle = list.parentElement.getAttribute('style'), rowBorder = window.getComputedStyle(original).borderWidth;
    await h.click(original);
    assert.ok(byId('manual-form-dialog')); assert.equal(h.list(), list); assert.deepEqual(h.rows(), rows);
    assert.equal(list.getAttribute('style'), listStyle); assert.equal(list.parentElement.getAttribute('style'), parentStyle); assert.equal(window.getComputedStyle(original).borderWidth, rowBorder);
    assert.equal(list.getAttribute('aria-hidden'), null); assert.equal(outer.scrollTop, 420); assert.deepEqual(scrollCalls, []);
    assert.equal([...document.querySelectorAll('[role="button"]')].filter(node => ['關閉詳情', '返回歸檔清單'].includes(node.textContent)).length, 0);
    let reader = byId('reader-scroll'); assert.equal(reader.scrollTop, 0); reader.scrollTop = 160;
    const readBefore = h.owner().model.reading;
    h.owner().model = {...h.owner().model, selected: {...h.owner().model.selected}, ...(kind === 'tasks' ? {reading: true} : {busy: true, reading: {...readBefore, pageBusy: true}})}; await renderCurrent();
    assert.equal(byId('reader-scroll'), reader); assert.equal(reader.scrollTop, 160, 'Quiet same-record reading preserves the reader position');
    h.owner().model = {...h.owner().model, ...(kind === 'tasks' ? {reading: false} : {busy: false, reading: readBefore})}; await renderCurrent();
    assert.equal(byId('reader-scroll'), reader); assert.equal(reader.scrollTop, 160, 'Completing the quiet read does not reset the viewport');
    width = initialWidth === 1100 ? 390 : 1100; await renderCurrent();
    assert.equal(h.list(), list); assert.equal(byId('reader-scroll'), reader); assert.equal(reader.scrollTop, 160);
    await h.click(h.close()); assert.equal(byId('manual-form-dialog'), null); assert.equal(document.activeElement, original); assert.equal(outer.scrollTop, 420);
    await h.click(rows[1]); reader = byId('reader-scroll'); assert.equal(reader.scrollTop, 0); reader.scrollTop = 90;
    const next = kind === 'tasks' ? tasks.model.items.find(item => item.id !== tasks.model.selected.id && ['completed', 'cancelled'].includes(item.occurrence.state)) : preparations.model.documents[2];
    h.owner().model = {...h.owner().model, selected: next}; await renderCurrent();
    assert.notEqual(byId('reader-scroll'), reader); assert.equal(byId('reader-scroll').scrollTop, 0, 'An explicit new record gets a fresh scroll viewport');
    assert.equal(h.list(), list); assert.equal(outer.scrollTop, 420); assert.equal(navigationCalls, 0);
    await h.click(h.close());
  }
});
test('preparation local reader close preserves saving/unknown restoration and archived checklist is never editable', async () => {
  for (const state of ['saving', 'unknown']) {
    const h = await setup('preparations'); await h.click(h.rows()[0]);
    const operation = {state, reference: 'synthetic-original-op', recovery: 'check'};
    preparations.model = {...preparations.model, busy: true, operation}; await renderCurrent();
    assert.equal(byId('editable-checkbox'), null); await h.click(h.close());
    assert.equal(byId('manual-form-dialog'), null); assert.equal(preparations.model.operation, operation); assert.equal(navigationCalls, 0); assert.equal(writes, 0);
  }
});
test('task local dismissal never clears its own retained draft or saving/unknown/conflict operation', async () => {
  for (const state of ['saving', 'unknown', 'conflict', 'draft']) {
    const h = await setup('tasks'); await h.click(h.rows()[0]);
    const operation = {state: state === 'draft' ? 'none' : state, reference: 'synthetic-original-op'}, draft = state === 'draft' ? {key: 'synthetic-draft'} : null;
    tasks.model = {...tasks.model, operation, draft}; await renderCurrent(); await h.click(h.close());
    await React.act(async () => document.dispatchEvent(new window.KeyboardEvent('keyup', {key: 'Escape', bubbles: true}))); await renderCurrent();
    assert.ok(byId('manual-form-dialog')); assert.equal(tasks.model.operation, operation); assert.equal(tasks.model.draft, draft); assert.equal(ownerCloseCalls, 0); assert.equal(navigationCalls, 0); assert.equal(writes, 0);
    tasks.model = {...tasks.model, operation: {state: 'none'}, draft: null}; await renderCurrent(); await h.click(h.close());
  }
});
for (const kind of ['tasks', 'preparations']) test(`${kind}: an unavailable return card falls back to the persistent named list`, async () => {
  const h = await setup(kind), original = h.rows()[0]; await h.click(original); original.hidden = true;
  await h.click(h.close()); assert.equal(document.activeElement, h.list()); assert.equal(navigationCalls, 0);
});
for (const kind of ['tasks', 'preparations']) test(`${kind}: native modal Escape closes only the local reader and restores its trigger`, async () => {
  const h = await setup(kind), original = h.rows()[0]; await h.click(original);
  await React.act(async () => document.dispatchEvent(new window.KeyboardEvent('keyup', {key: 'Escape', bubbles: true}))); await renderCurrent();
  assert.equal(byId('manual-form-dialog'), null); assert.equal(document.activeElement, original); assert.equal(navigationCalls, 0); assert.equal(writes, 0);
});
test.after(async () => {await React.act(async () => renderer.unmount()); Module._load = originalLoad; dom.window.close();});
