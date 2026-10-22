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
let width = 1100, workspace, sequence = 0;
const frames = new Map();
global.requestAnimationFrame = callback => { const id = ++sequence; frames.set(id, callback); return id; };
global.cancelAnimationFrame = id => frames.delete(id);
Object.defineProperty(HTMLElement.prototype, 'getClientRects', {configurable: true, value() { return this.isConnected && !this.closest('[hidden]') ? [{}] : []; }});
// Actual React effects and DOM focus with native/layout/child-detail ports.
// This is not browser layout or proof of the CUA compound timing failure.
const View = React.forwardRef(({children, testID, accessibilityLabel, tabIndex}, ref) => e('div', {ref, tabIndex, 'data-testid': testID, 'aria-label': accessibilityLabel}, children));
const Pressable = React.forwardRef(({children, testID, accessibilityLabel, onPress}, ref) => e('button', {ref, onClick: onPress, 'data-testid': testID, 'aria-label': accessibilityLabel}, children));
const Button = ({label, onPress, disabled}) => e('button', {onClick: onPress, disabled}, label);
const Text = ({children}) => e('span', null, children), Empty = () => null;
const theme = {colors: {}, radius: {}, readingType: {}, spacing: {xs: 4, sm: 8, md: 12, lg: 16}};
const cache = new Map();
function load(relative) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = {exports: {}}; cache.set(filename, module);
  const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {fileName: filename, compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require', 'module', 'exports', output)(name => {
    if (name === 'react-native') return {View, Pressable, Platform: {OS: 'web'}, StyleSheet: {create: value => value}};
    if (name === 'react-native-paper') return {Text};
    if (name.endsWith('/theme')) return theme;
    if (name.endsWith('/workspaces/PreparationWorkspace')) return {usePreparationWorkspace: () => workspace};
    if (name.endsWith('/useContainerWidth')) return {useContainerWidth: () => ({width, ref: null, onLayout() {}})};
    if (name.endsWith('/ui')) return {AppButton: Button, AppSelect: Empty};
    const ports = {WriteRecoveryNotice: Empty, AppCheckbox: Empty, AppStatusBadge: Empty, SummaryDisclosure: Empty, EmptyListCard: View, ManualFormDialog: Empty, DocumentCreateForm: Empty};
    if (/\/(WriteRecoveryNotice|AppCheckbox|AppStatusBadge|SummaryDisclosure|EmptyListCard|FormDialog|DocumentCreateForm)$/.test(name)) return ports;
    if (!name.startsWith('.')) return req(name);
    const target = path.resolve(path.dirname(filename), name);
    const found = [target, `${target}.ts`, `${target}.tsx`].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
    return load(path.relative(root, found));
  }, module, module.exports);
  return module.exports;
}
const {PreparationHistoryView} = load('src/components/preparations/PreparationWorkspace.tsx');
const fixture = () => ({id: 'doc-a', childId: 'child-a', version: 3, status: 'archived', archivedAt: '2026-10-20T00:00:00Z', purpose: 'school', readState: 'ready', historical: false, sources: [], revision: {id: 'snapshot-2', number: 2, title: 'Synthetic preparation', summary: 'Original snapshot', eventDate: '2026-10-20', updatedAt: '2026-10-20T00:00:00Z', sourceAsOf: '2026-10-20T00:00:00Z', sections: [], sourceRefs: []}});
const range = {from: null, to: null};
async function setup(t, initialWidth = 1100) {
  width = initialWidth; frames.clear(); const doc = fixture();
  workspace = {scopeKey: 'parent:child-a', model: {scope: {childId: 'child-a', online: true, condition: 'ready', role: 'owner'}, child: {id: 'child-a', displayName: 'Synthetic'}, documents: [doc], selected: null, condition: 'ready', online: true,
    reading: {indexes: [], archiveStarted: true, archiveReady: true, archiveHasMore: false, pageBusy: false, ensureArchived() {}}},
    actions: {selectDocument() {workspace.model.selected = doc;}, closeDocument() {workspace.model.selected = null;}}};
  const app = createRoot(document.getElementById('root')); let mounted = true;
  const render = () => React.act(() => app.render(e(PreparationHistoryView, {searchText: '', dateRange: range})));
  const node = id => document.querySelector(`[data-testid="${id}"]`);
  const row = () => node('preparation-row-doc-a'), list = () => node('preparation-document-list');
  const open = async () => { row().focus(); row().click(); await render(); };
  const close = async () => { const button = [...document.querySelectorAll('button')].find(node => node.textContent === '返回歸檔清單'); button.focus(); button.click(); await render(); };
  const flush = async () => { await React.act(() => { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(); }); };
  const unmount = async () => { if (mounted) { mounted = false; await React.act(() => app.unmount()); } assert.equal(frames.size, 0, 'Unmount cancels pending focus retry'); };
  t.after(unmount);
  await render(); return {doc, render, row, list, open, close, flush, unmount};
}

test('old snapshot plus narrow/wide return retains the original row and exact snapshot without mutation', async t => {
  const h = await setup(t, 736); await h.open();
  workspace.model.selected = {...h.doc, historical: true, revision: {...h.doc.revision, id: 'snapshot-1', number: 1}};
  for (const value of [350, 1100]) {width = value; await h.render();}
  assert.equal(workspace.model.selected.revision.number, 1);
  await h.close(); assert.equal(document.activeElement, h.row()); assert.equal(frames.size, 1);
  await h.flush(); assert.equal(document.activeElement, h.row()); assert.equal(frames.size, 0);
  assert.equal(workspace.model.documents[0], h.doc); assert.equal(h.doc.revision.number, 2);
});

test('a rejecting, hidden or disconnected original row falls back to the named focusable list', async t => {
  const h = await setup(t);
  for (const failure of ['reject', 'hidden', 'disconnected']) {
    await h.open(); const row = h.row(), original = row.focus;
    if (failure === 'reject') row.focus = () => {};
    if (failure === 'hidden') row.style.visibility = 'hidden';
    if (failure === 'disconnected') Object.defineProperty(row, 'isConnected', {configurable: true, value: false});
    await h.close(); assert.equal(document.activeElement, h.list(), failure);
    assert.equal(h.list().getAttribute('aria-label'), '已歸檔準備單清單'); assert.equal(h.list().tabIndex, -1);
    await h.flush(); assert.equal(document.activeElement, h.list());
    row.focus = original; row.style.visibility = ''; if (failure === 'disconnected') delete row.isConnected;
  }
});

test('a single guarded frame can recover initially unavailable focus but never loops', async t => {
  const h = await setup(t); await h.open();
  const row = h.row(), list = h.list(), rowFocus = row.focus, listFocus = list.focus;
  row.focus = list.focus = () => {};
  await h.close(); assert.equal(document.activeElement, document.body); assert.equal(frames.size, 1);
  row.focus = rowFocus; list.focus = listFocus;
  await h.flush(); assert.equal(document.activeElement, row); assert.equal(frames.size, 0);
  row.blur(); await h.flush(); assert.equal(document.activeElement, document.body, 'No repeated late focus capture');
});

test('new user focus cancels the pending retry even when the user subsequently blurs it', async t => {
  const h = await setup(t); await h.open();
  const row = h.row(), list = h.list(), rowFocus = row.focus, listFocus = list.focus;
  row.focus = list.focus = () => {}; await h.close();
  const other = document.getElementById('other-control'); other.focus(); other.blur();
  row.focus = rowFocus; list.focus = listFocus;
  await h.flush(); assert.equal(document.activeElement, document.body); assert.equal(frames.size, 0);
});

test('new scope, selection or access loss cancels the pending return', async t => {
  const h = await setup(t);
  for (const next of ['scope', 'selection', 'lost']) {
    workspace.scopeKey = 'parent:child-a'; workspace.model.condition = 'ready'; workspace.model.selected = null; await h.render(); await h.open();
    const row = h.row(), list = h.list(), rowFocus = row.focus, listFocus = list.focus;
    row.focus = list.focus = () => {}; await h.close(); assert.equal(frames.size, 1);
    row.focus = rowFocus; list.focus = listFocus;
    if (next === 'scope') workspace.scopeKey = 'other-parent:child-a';
    if (next === 'selection') workspace.model.selected = h.doc;
    if (next === 'lost') workspace.model.condition = 'lost';
    await h.render(); assert.equal(frames.size, 0, next); await h.flush(); assert.equal(document.activeElement, document.body, next);
  }
});

test('a filter or another control already focused at close is not overridden', async t => {
  const h = await setup(t); await h.open();
  const other = document.getElementById('other-control'); other.focus(); workspace.actions.closeDocument(); await h.render();
  assert.equal(document.activeElement, other); assert.equal(frames.size, 0);
});


test('unmount cancels its one pending frame and does not focus the next page', async t => {
  const h = await setup(t); await h.open();
  h.row().focus = h.list().focus = () => {}; await h.close(); assert.equal(frames.size, 1);
  await h.unmount(); await h.flush(); assert.equal(document.activeElement, document.body);
});
