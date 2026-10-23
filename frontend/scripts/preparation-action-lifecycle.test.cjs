const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const {createRequire} = require('node:module');
const root = path.resolve(__dirname, '..'), req = createRequire(path.join(root, 'package.json'));
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for an existing jsdom installation.');
const {JSDOM} = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<!doctype html><html><body></body></html>', {pretendToBeVisual: true});
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) global[key] = dom.window[key];
Object.defineProperty(global, 'navigator', {value: dom.window.navigator, configurable: true});
global.IS_REACT_ACT_ENVIRONMENT = true;
global.fetch = () => {throw new Error('Real network is forbidden');};
Object.defineProperty(HTMLElement.prototype, 'getClientRects', {configurable: true, value() {return this.isConnected ? [{}] : [];}});
const React = req('react'), {createRoot} = req('react-dom/client'), {createPortal} = req('react-dom'), ts = req('typescript'), e = React.createElement;
let width = 390, workspace, formMounts = 0;
const frames = new Map(), queued = []; let frame = 0;
global.requestAnimationFrame = fn => {frames.set(++frame, fn); return frame;};
global.cancelAnimationFrame = id => frames.delete(id);
// Real workspace/reader and manual dialog lifecycle; DOM/native/modal layout are ports.
// This does not establish live-browser geometry, native modal timing or visual acceptance.
const View = React.forwardRef(({children, testID, accessibilityLabel, tabIndex}, ref) => e('div', {ref, tabIndex, 'data-testid': testID, 'aria-label': accessibilityLabel}, children));
const Pressable = React.forwardRef(({children, testID, accessibilityLabel, accessibilityRole, onPress, onKeyDown, disabled, 'aria-checked': checked, 'aria-disabled': ariaDisabled}, ref) => e('button', {ref, onClick: onPress, onKeyDown, disabled, role: accessibilityRole, 'aria-checked': checked, 'aria-disabled': ariaDisabled, 'data-testid': testID, 'aria-label': accessibilityLabel}, children));
const Button = React.forwardRef(({label, onPress, disabled, variant, accessibilityLabel}, ref) => e('button', {ref, onClick: onPress, disabled, 'aria-label': accessibilityLabel, 'data-variant': variant}, label));
const Select = ({label, value, options, onChange}) => e('select', {'aria-label': label, value, onChange: event => onChange(event.target.value)}, options.map(item => e('option', {key: item.value, value: item.value}, item.label)));
const Empty = () => null, Text = ({children}) => e('span', null, children);
function Dialog({visible, onClosed, children, accessibilityLabel}) {
  const previous = React.useRef(false);
  React.useLayoutEffect(() => {if (previous.current && !visible) onClosed(); previous.current = visible;}, [visible, onClosed]);
  return visible ? createPortal(e('div', {role: 'dialog', 'aria-label': accessibilityLabel}, children), document.body) : null;
}
Dialog.Title = Dialog.Actions = Dialog.ScrollArea = View;
function DraftPort() {
  const [value, setValue] = React.useState('');
  React.useEffect(() => {formMounts++;}, []);
  return e('input', {'aria-label': 'Synthetic draft', value, onInput: event => setValue(event.target.value)});
}
const cache = new Map();
function load(relative) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = {exports: {}}; cache.set(filename, module);
  const input = relative === 'src/components/preparations/PreparationWorkspace.tsx' && process.env.WORKSPACE_SOURCE ? process.env.WORKSPACE_SOURCE : filename;
  const output = ts.transpileModule(fs.readFileSync(input, 'utf8'), {fileName: filename, compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require', 'module', 'exports', output)(name => {
    if (name === 'react-native') return {View, Pressable, useWindowDimensions: () => ({width, height: 900}), Platform: {OS: 'web'}, StyleSheet: {create: value => value}};
    if (name === 'react-native-paper') return {Text};
    if (name.endsWith('/theme')) return {colors: {}, radius: {}, readingType: {}, mobileLayout: {breakpoint: 480, touchTarget: 44}, mobileIcons: {content: 24}, mobileType: {body: {}}, typeScale: {small: 14, caption: 12}, spacing: {xs: 4, sm: 8, md: 12, lg: 16}};
    if (name.endsWith('/workspaces/PreparationWorkspace')) return {usePreparationWorkspace: () => workspace};
    if (name.endsWith('/useContainerWidth')) return {useContainerWidth: () => ({width, ref: null, onLayout() {}})};
    if (name.endsWith('/ui')) return {AppButton: Button, AppSelect: Select};
    if (name.endsWith('/AppDialog')) return {AppDialog: Dialog};
    if (name.endsWith('/AppScrollView')) return {AppScrollView: View};
    if (name.endsWith('/PreviewNavigationGuard')) return {usePreviewNavigation: () => callback => queued.push(callback)};
    const ports = {WriteRecoveryNotice: Empty, AppIcon: Empty, AppStatusBadge: Empty, SummaryDisclosure: Empty, EmptyListCard: View, DocumentCreateForm: DraftPort};
    if (/\/(WriteRecoveryNotice|AppIcon|AppStatusBadge|SummaryDisclosure|EmptyListCard|DocumentCreateForm)$/.test(name)) return ports;
    if (!name.startsWith('.')) return req(name);
    const target = path.resolve(path.dirname(filename), name);
    const found = [target, `${target}.ts`, `${target}.tsx`].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
    return load(path.relative(root, found));
  }, module, module.exports);
  return module.exports;
}
const {PreparationWorkspace} = load('src/components/preparations/PreparationWorkspace.tsx');
test('assistant-first composition preserves reader return, purpose, mounted manual trigger and guarded dialog focus through refresh', async t => {
  const doc = {id: 'doc-a', childId: 'child-a', version: 3, status: 'active', purpose: 'appointment', readState: 'ready', historical: false, sources: [], revision: {id: 'snapshot-a', number: 2, title: 'Synthetic preparation', summary: 'Synthetic summary', eventDate: null, updatedAt: '2026-10-22T00:00:00Z', sourceAsOf: '2026-10-22T00:00:00Z', sections: [], sourceRefs: []}};
  const questions = [], scrolls = []; let writes = 0;
  workspace = {scopeKey: 'parent:child-a', model: {scope: {childId: 'child-a', online: true, condition: 'ready', role: 'owner'}, child: {id: 'child-a', displayName: 'Synthetic'}, documents: [doc], selected: null, condition: 'ready', online: true, capabilities: {archive: true}},
    actions: {selectDocument() {workspace.model.selected = doc;}, closeDocument() {workspace.model.selected = null;}, createDocument() {writes++;}, markDraft() {}, discardDraft() {}, archiveDocument() {writes++;}, refresh() {}}};
  const host = document.body.appendChild(document.createElement('main')), app = createRoot(host);
  const scrollRef = {current: {scrollTo: value => scrolls.push(value.y)}};
  const flush = async action => React.act(async () => {action?.();});
  const render = () => flush(() => app.render(e(PreparationWorkspace, {onPrepareQuestion: value => questions.push(value), onHistory() {}, scrollRef, getScrollPosition: () => 214})));
  const button = label => [...document.querySelectorAll('button')].find(node => node.textContent === label);
  const row = () => host.querySelector('[data-testid="preparation-row-doc-a"]');
  const click = async label => {await flush(() => {const target = button(label); assert.ok(target, label); target.focus(); target.click();}); await render();};
  t.after(async () => {await flush(() => app.unmount()); host.remove(); frames.clear();});
  await render();
  const manual = button('手動建立準備單');
  assert.ok(button('到助手準備下一份').compareDocumentPosition(row()) & Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(row().compareDocumentPosition(manual) & Node.DOCUMENT_POSITION_FOLLOWING);
  await flush(() => {const purpose = host.querySelector('select'); purpose.value = 'school'; purpose.dispatchEvent(new dom.window.Event('change', {bubbles: true}));});
  await flush(() => {row().focus(); row().click();}); await render();
  assert.equal(button('手動建立準備單'), manual, 'The manual trigger never remounts when the list controls disappear');
  assert.equal(host.querySelector('[data-testid="preparation-list-actions"]'), null);
  assert.equal(scrolls.at(-1), 0);
  const assistant = button('到助手補充／更新'), archive = button('使用完畢，歸檔');
  assert.ok(assistant.compareDocumentPosition(archive) & Node.DOCUMENT_POSITION_FOLLOWING);
  assert.equal(archive.dataset.variant, 'quiet');
  await click('到助手補充／更新'); assert.match(questions[0], /Synthetic preparation/); assert.equal(writes, 0);
  await click('使用完畢，歸檔'); assert.ok(host.querySelector('[data-testid="preparation-archive-confirm"]')); assert.equal(writes, 0, 'Opening confirmation does not archive');
  await click('繼續使用'); assert.equal(host.querySelector('[data-testid="preparation-archive-confirm"]'), null);
  await click('返回準備單清單');
  await flush(() => {const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn());});
  assert.equal(document.activeElement, row()); assert.equal(scrolls.at(-1), 214);
  assert.equal(host.querySelector('select').value, 'school'); assert.equal(button('手動建立準備單'), manual);
  await click('手動建立準備單');
  const input = document.querySelector('input'); assert.ok(input);
  await flush(() => {input.focus(); input.value = 'Retained synthetic draft'; input.dispatchEvent(new dom.window.Event('input', {bubbles: true}));});
  workspace.model.busy = true; workspace.model.condition = 'loading'; await render();
  width = 1024; await render(); workspace.model.busy = false; workspace.model.condition = 'ready'; await render();
  assert.equal(document.querySelector('input'), input); assert.equal(input.value, 'Retained synthetic draft'); assert.equal(formMounts, 1);
  assert.equal(document.activeElement, input); assert.equal(input.closest('[aria-hidden="true"], [hidden], [inert]'), null);
  assert.equal(button('手動建立準備單'), manual); assert.equal(writes, 0);
  await click('關閉'); assert.ok(document.querySelector('[role="dialog"]'), 'Close waits for the existing navigation guard');
  assert.equal(queued.length, 1); await flush(() => queued.shift()());
  assert.equal(document.querySelector('[role="dialog"]'), null); assert.equal(document.activeElement, manual);
});

function checkboxFixture() {
  return {id: 'doc-check', childId: 'child-a', version: 3, status: 'active', purpose: 'appointment', readState: 'ready', historical: false, sources: [],
    revision: {id: 'snapshot-check', number: 2, title: 'Synthetic checklist', summary: 'Same authorized snapshot', eventDate: null, updatedAt: '2026-10-22T00:00:00Z', sourceAsOf: '2026-10-22T00:00:00Z', sourceRefs: [],
      sections: [{id: 'list', kind: 'checklist', title: 'Two checks', items: [{id: 'a', text: 'First retained check', checked: false}, {id: 'b', text: 'Second retained check', checked: true}]}]}};
}
async function checkboxHarness(t, initialCondition = 'ready') {
  const doc = checkboxFixture(), calls = [];
  workspace = {scopeKey: 'parent:child-a', model: {scope: {childId: 'child-a', online: true, condition: 'ready', role: 'owner'}, child: {id: 'child-a', displayName: 'Synthetic'}, documents: [doc], selected: doc, condition: 'ready', online: true, busy: false,
    reading: {indexes: []}, capabilities: {archive: true, checkItem: true}}, actions: {checkItem(...args) {calls.push(args);}, closeDocument() {}, refresh() {}}};
  workspace.model.condition = workspace.model.scope.condition = initialCondition;
  workspace.model.capabilities = {archive: initialCondition === 'ready', checkItem: initialCondition === 'ready'};
  const host = document.body.appendChild(document.createElement('main')), app = createRoot(host);
  const flush = async action => React.act(async () => {action?.();});
  const render = () => flush(() => app.render(e(PreparationWorkspace)));
  const checks = () => [...host.querySelectorAll('[role="checkbox"]')];
  t.after(async () => {await flush(() => app.unmount()); host.remove(); frames.clear();});
  await render(); return {doc, host, calls, checks, render, flush};
}

test('quiet preparation GET keeps every actual checkbox node and focus while activation stays disabled', async t => {
  const h = await checkboxHarness(t), original = h.checks(); assert.equal(original.length, 2);
  original[1].focus(); h.host.scrollTop = 631;
  workspace.model.busy = true; workspace.model.capabilities = {archive: false, checkItem: false};
  await h.render();
  assert.deepEqual(h.checks(), original, 'A quiet GET must not replace any checkbox with static text');
  assert.equal(document.activeElement, original[1]); assert.equal(h.host.scrollTop, 631);
  for (const checkbox of original) {
    assert.equal(checkbox.disabled, true); assert.equal(checkbox.getAttribute('aria-disabled'), 'true');
    checkbox.click(); checkbox.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key: ' ', bubbles: true}));
  }
  assert.equal(h.calls.length, 0);
  workspace.model.busy = false; workspace.model.capabilities = {archive: true, checkItem: true};
  await h.render();
  assert.deepEqual(h.checks(), original); assert.equal(document.activeElement, original[1]);
  assert.equal(original[0].getAttribute('aria-checked'), 'false'); assert.equal(original[1].getAttribute('aria-checked'), 'true');
  assert.equal(original[0].disabled, false); assert.equal(h.calls.length, 0);
});

test('quiet preparation retention does not expand unknown, offline, viewer, historical or foreign-scope controls', async t => {
  const h = await checkboxHarness(t);
  const initialScope = {...workspace.model.scope};
  for (const condition of ['unknown', 'offline', 'viewer', 'historical', 'foreign', 'invalidated']) {
    workspace.model.scope = {...initialScope}; workspace.model.selected = {...h.doc};
    workspace.model.busy = true; workspace.model.capabilities = {checkItem: false}; workspace.model.operation = undefined;
    if (condition === 'unknown') {workspace.model.scope.condition = 'unknown'; workspace.model.operation = {state: 'unknown', recovery: 'check'};}
    if (condition === 'offline') workspace.model.scope.online = false;
    if (condition === 'viewer') workspace.model.scope.role = 'viewer';
    if (condition === 'historical') workspace.model.selected.historical = true;
    if (condition === 'foreign') workspace.model.scope.childId = 'child-b';
    if (condition === 'invalidated') {workspace.model.selected.readState = 'invalidated'; workspace.model.selected.revision = null;}
    await h.render(); assert.equal(h.checks().length, 0, condition); assert.equal(h.calls.length, 0);
  }
});

function failedPreparationRead() {
  workspace.model.busy = false;
  workspace.model.condition = workspace.model.scope.condition = 'refresh_failed';
  workspace.model.capabilities = {archive: false, checkItem: false};
}

test('failed preparation refresh retains previously actionable checkbox nodes focus and disabled guards through retry', async t => {
  const h = await checkboxHarness(t), original = h.checks(); assert.equal(original.length, 2);
  original[1].focus(); h.host.scrollTop = 213;
  workspace.model.busy = true; workspace.model.capabilities = {archive: false, checkItem: false}; await h.render();
  failedPreparationRead(); await h.render();
  assert.deepEqual(h.checks(), original, 'Settled same-snapshot read failure must not replace prior checkboxes');
  assert.equal(document.activeElement, original[1]); assert.equal(h.host.scrollTop, 213);
  for (const checkbox of original) {
    assert.equal(checkbox.disabled, true); assert.equal(checkbox.getAttribute('aria-disabled'), 'true');
    checkbox.click(); checkbox.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key: ' ', bubbles: true}));
  }
  assert.equal(h.calls.length, 0);
  workspace.model.busy = true; await h.render();
  assert.deepEqual(h.checks(), original); assert.equal(document.activeElement, original[1]);
  workspace.model.busy = false; workspace.model.condition = workspace.model.scope.condition = 'ready';
  workspace.model.capabilities = {archive: true, checkItem: true}; await h.render();
  assert.deepEqual(h.checks(), original); assert.equal(original[0].disabled, false); assert.equal(h.calls.length, 0);
});

test('failed preparation refresh never introduces checkbox controls into an initially read-only document', async t => {
  const h = await checkboxHarness(t, 'read_only'); assert.equal(h.checks().length, 0);
  failedPreparationRead(); await h.render();
  assert.equal(h.checks().length, 0); assert.equal(h.calls.length, 0);
  workspace.model.busy = true; await h.render(); assert.equal(h.checks().length, 0);
});

for (const boundary of ['unknown', 'saving', 'recovery', 'offline', 'viewer', 'historical', 'scope', 'authority', 'role', 'child', 'version', 'revision', 'invalidated', 'read_only', 'lost']) {
  test(`failed preparation refresh discards retained checkbox presentation on ${boundary}`, async t => {
    const h = await checkboxHarness(t); assert.equal(h.checks().length, 2);
    failedPreparationRead(); await h.render(); assert.equal(h.checks().length, 2);
    if (boundary === 'unknown') workspace.model.operation = {state: 'unknown', recovery: 'check'};
    if (boundary === 'saving') workspace.model.operation = {state: 'saving'};
    if (boundary === 'recovery') workspace.model.operation = {state: 'saved', recovery: 'reload'};
    if (boundary === 'offline') workspace.model.online = workspace.model.scope.online = false;
    if (boundary === 'viewer') workspace.model.scope.role = 'viewer';
    if (boundary === 'historical') workspace.model.selected = {...h.doc, historical: true};
    if (boundary === 'scope') workspace.scopeKey = 'other-parent:child-a';
    if (boundary === 'authority') workspace.model.scope.authorityKey = 'other-authority';
    if (boundary === 'role') workspace.model.scope.role = 'caregiver';
    if (boundary === 'child') workspace.model.scope.childId = 'child-b';
    if (boundary === 'version') workspace.model.selected = {...h.doc, version: h.doc.version + 1};
    if (boundary === 'revision') workspace.model.selected = {...h.doc, revision: {...h.doc.revision, number: 3}};
    if (boundary === 'invalidated') workspace.model.selected = {...h.doc, readState: 'invalidated', revision: null};
    if (boundary === 'read_only' || boundary === 'lost') workspace.model.condition = workspace.model.scope.condition = boundary;
    await h.render(); assert.equal(h.checks().length, 0, boundary); assert.equal(h.calls.length, 0);
    // Returning only to a failed projection cannot resurrect the prior presentation marker.
    workspace.scopeKey = 'parent:child-a'; workspace.model.scope = {childId: 'child-a', online: true, condition: 'refresh_failed', role: 'owner'};
    workspace.model.online = true; workspace.model.condition = 'refresh_failed'; workspace.model.operation = undefined;
    workspace.model.selected = h.doc;
    await h.render(); assert.equal(h.checks().length, 0, boundary + ' marker cleared'); assert.equal(h.calls.length, 0);
  });
}
