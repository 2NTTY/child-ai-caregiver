const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..'), req = createRequire(path.join(root, 'frontend/package.json'));
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for an existing jsdom installation.');
const { JSDOM } = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'getComputedStyle', 'ShadowRoot', 'Event']) global[key] = dom.window[key];
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.IS_REACT_ACT_ENVIRONMENT = true;
global.fetch = () => { throw new Error('Real network is forbidden'); };
const React = req('react'), { createRoot } = req('react-dom/client'), ts = req('typescript'), RN = req('react-native-web'), e = React.createElement;
let testPlatform = 'web';
const PlatformRN = { ...RN, Platform: { ...RN.Platform, get OS() { return testPlatform; } } };
const Summary = React.createContext(null), Profile = React.createContext(null), cache = new Map();
const Text = ({ children }) => e('span', null, children), Empty = () => null;
const Surface = React.forwardRef(({ children, testID }, ref) => e('div', { ref, 'data-testid': testID }, children));
const PlainButton = React.forwardRef(({ children, onPress, disabled, accessibilityLabel }, ref) => e(RN.Pressable, { ref, onPress, disabled, accessibilityRole: 'button', accessibilityLabel }, e(Text, null, children)));
// Load the installed Paper focus/blur state owner, not a rewritten handler.
// Only the visual Flat/Outlined rendering and adornment appearance are substituted.
const InputAppearance = ({ parentState, innerRef, right, value, readOnly, editable, disabled, onFocus, onBlur, onChangeText, accessibilityLabel, tabIndex }) => e('div', { 'data-paper-focused': String(parentState.focused), 'data-readonly-prop': readOnly === undefined ? 'unset' : String(readOnly), 'data-paper-editable': String(!disabled && editable) },
  e(RN.TextInput, { ref: innerRef, value, readOnly, editable: !disabled && editable, onFocus, onBlur, onChangeText, accessibilityLabel, tabIndex }), right);
const paperInputFile = req.resolve('react-native-paper/lib/commonjs/components/TextInput/TextInput');
const paperInputModule = { exports: {} };
new Function('require', 'module', 'exports', fs.readFileSync(paperInputFile, 'utf8'))(name => {
  if (name === 'react') return React;
  if (name === 'react-native') return RN;
  if (name === './TextInputFlat' || name === './TextInputOutlined') return InputAppearance;
  if (name === './Adornment/TextInputIcon') return ({ icon, forceTextInputFocus, ...props }) => e(RN.Pressable, { ...props, accessibilityRole: 'button' });
  if (name === './Adornment/TextInputAffix') return Empty;
  if (name === '../../core/theming') return { useInternalTheme: () => ({ animation: { scale: 0 } }) };
  if (name === '../../utils/forwardRef') return { forwardRef: React.forwardRef };
  if (name === '../../utils/roundLayoutSize') return { roundLayoutSize: size => Math.round(size * 1000) / 1000 };
  throw new Error(`Unexpected Paper dependency: ${name}`);
}, paperInputModule, paperInputModule.exports);
const TextInput = paperInputModule.exports.default;
const theme = { colors: {}, radius: {}, readingType: {}, workspaceType: {}, mobileType: {}, mobileIcons: {}, mobileLayout: { breakpoint: 600 }, typeScale: {}, spacing: { xs: 4, sm: 8, md: 12, lg: 16 } };
function load(relative) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = { exports: {} }; cache.set(filename, module);
  const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', js)(name => {
    if (name === 'react-native') return PlatformRN;
    if (name === 'react-native-paper') return { Text, Button: PlainButton, Portal: Surface, TextInput, HelperText: Text, useTheme: () => ({ colors: { elevation: {} } }) };
    if (name === 'react-native-paper-dates') return { DatePickerModalContent: Empty, TimePicker: Empty, registerTranslation() {}, zhTW: {} };
    if (name.endsWith('/date-picker-action')) return {};
    if (name.endsWith('/TaskKnowledgeDomains')) return { useProductionTaskKnowledgeSummary: () => React.useContext(Summary) };
    if (name.endsWith('/ProfileWorkspace')) return { useProfileWorkspace: () => React.useContext(Profile) };
    if (name.endsWith('/PreviewNavigationGuard')) return { usePreviewNavigation: () => action => action() };
    if (name.endsWith('/theme')) return theme;
    if (name.endsWith('/useContainerWidth')) return { useContainerWidth: () => ({ width: 1024, ref: React.useRef(null), onLayout() {} }) };
    if (name.endsWith('/useInteractionDensity')) return { useInteractionDensity: () => false };
    if (name.endsWith('/motion')) return { MotionDisclosure: ({ children, expanded }) => expanded ? children : null, MotionEntrance: Surface, MotionBackdrop: Empty };
    if (name.endsWith('/motion/MotionPaperScope')) return { MotionPaperScope: Surface };
    if (name.endsWith('/motion/useModalBackdrop')) return { useModalBackdrop: () => ({}) };
    if (name.endsWith('/appearance/BackgroundSurface')) return { BackgroundSurface: Surface };
    if (name.endsWith('/AppDialog')) return { AppDialog: Object.assign(({ visible, children }) => visible ? e('section', { role: 'dialog' }, children) : null, { Title: Text, Content: Surface, ScrollArea: Surface, Actions: Surface }) };
    if (name.endsWith('/AppScrollView')) return { AppScrollView: Surface };
    if (name.endsWith('/ReadStateNotice')) return { ReadStateNotice: ({ state, message }) => e('span', { 'data-testid': `read-${state}` }, message) };
    if (name.endsWith('/SummaryRecords')) return { SummaryRecords: ({ page }) => e('section', { 'data-testid': 'summary-records' }, `${page.period.startDay}:${page.period.period}`) };
    if (name.endsWith('/AppRadioItem')) return { AppRadioItem: ({ label, accessibilityLabel, onPress, disabled }) => e(PlainButton, { accessibilityLabel, onPress, disabled }, label) };
    if (/\/(AppIcon|AppStatusBadge|StatusAnnouncement|MotionSelectionMarker|HorizontalOverflowRail|PreparationCard)$/.test(name)) return { [name.split('/').pop()]: Empty };
    if (!name.startsWith('.')) return req(name);
    const target = path.resolve(path.dirname(filename), name), found = [target, target + '.ts', target + '.tsx'].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
    assert.ok(found, name); return load(path.relative(root, found));
  }, module, module.exports);
  return module.exports;
}
const { TaskKnowledgeSummaryContent } = load('frontend/src/production/TaskKnowledgeSummaryContent.tsx');
const { ChildOverviewContent } = load('frontend/src/components/child-overview/ChildOverviewContent.tsx');
const { readChildProfile } = load('frontend/src/child-overview-view-model.ts');
const applied = { startDay: '2026-10-23', period: 'week', timeZone: 'Asia/Hong_Kong' };
const baseSummary = { scopeKey: 'synthetic-a', childName: 'Synthetic child', query: { ...applied, period: 'day' }, page: { period: applied, generatedAt: '2026-10-23T00:00:00Z' },
  online: true, access: 'editable', busy: false, readFailed: false, pending: null, operation: 'none', notice: '', dirty: false };
async function setup(t) {
  let model = baseSummary; const calls = { update: 0, refresh: 0 };
  const actions = { updateQuery() { calls.update++; }, refresh() { calls.refresh++; } };
  const container = document.body.appendChild(document.createElement('main')), renderer = createRoot(container);
  const flush = callback => React.act(async () => { callback?.(); });
  const render = patch => { model = { ...baseSummary, ...patch }; return flush(() => renderer.render(e(Summary.Provider, { value: { model, actions } }, e(TaskKnowledgeSummaryContent, { onRecord() {}, onTask() {} })))); };
  t.after(async () => { await flush(() => renderer.unmount()); container.remove(); });
  await render();
  const button = label => [...container.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === label);
  await flush(() => button('選擇摘要期間').click());
  return { container, flush, render, button, calls };
}
// jsdom dispatches these events but does not emulate native Enter/Space default clicks.
// The explicit click tests the guarded callback; browser keyboard behavior remains QA.
async function activate(h, node) {
  await h.flush(() => { node.click(); node.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); node.dispatchEvent(new window.KeyboardEvent('keyup', { key: 'Enter', bubbles: true })); node.dispatchEvent(new window.KeyboardEvent('keydown', { key: ' ', bubbles: true })); node.dispatchEvent(new window.KeyboardEvent('keyup', { key: ' ', bubbles: true })); });
}
for (const [name, label] of [['period selector', '摘要期間：一日'], ['timezone selector', '時區：香港時間'], ['apply action', '套用期間'], ['date picker trigger', '選擇摘要開始日']]) test(`${name} retains focus but blocks explicit clicks throughout a loaded summary GET`, async t => {
  const h = await setup(t), node = h.button(label); assert.ok(node, label);
  await h.flush(() => node.focus());
  const report = h.container.querySelector('[data-testid="summary-records"]');
  await h.render({ busy: true });
  assert.equal(h.button(label), node); assert.equal(node.disabled, false, 'Quiet same-scope reads must not use native disabled');
  assert.equal(document.activeElement, node); assert.equal(node.getAttribute('aria-disabled'), 'true'); assert.equal(node.tabIndex, -1);
  await activate(h, node); assert.deepEqual(h.calls, { update: 0, refresh: 0 }); assert.equal(h.container.querySelector('[role="dialog"]'), null);
  assert.equal(h.container.querySelector('[data-testid="summary-records"]'), report); assert.equal(report.textContent, '2026-10-23:week');
  await h.render(); assert.equal(document.activeElement, node); assert.equal(node.getAttribute('aria-disabled'), null); assert.equal(node.tabIndex, 0);
});
test('summary date remains mounted and read-only during GET, then restores editability', async t => {
  const h = await setup(t), node = h.container.querySelector('input'); await h.flush(() => node.focus());
  await h.render({ busy: true });
  assert.equal(h.container.querySelector('input'), node); assert.equal(node.disabled, false); assert.equal(node.readOnly, true); assert.equal(document.activeElement, node); assert.equal(node.value, applied.startDay);
  await h.render(); assert.equal(node.readOnly, false); assert.equal(node.disabled, false);
});
test('installed Paper clears focused state and forwards blur when focus leaves during a quiet read', async t => {
  const { AppDateField } = load('frontend/src/components/DateTimeFields.tsx');
  const container = document.body.appendChild(document.createElement('main')), renderer = createRoot(container);
  const outside = document.body.appendChild(document.createElement('input')); let blurs = 0;
  const flush = callback => React.act(async () => { callback?.(); });
  const render = busy => flush(() => renderer.render(e(AppDateField, { label: 'Synthetic date', value: applied.startDay, disabled: busy, preserveFocusWhenDisabled: busy, onChange() {}, onBlur() { blurs++; } })));
  t.after(async () => { await flush(() => renderer.unmount()); container.remove(); outside.remove(); });
  await render(false); const node = container.querySelector('input'), appearance = container.querySelector('[data-paper-focused]');
  await flush(() => node.focus()); assert.equal(appearance.dataset.paperFocused, 'true');
  await render(true); assert.equal(document.activeElement, node); assert.equal(node.readOnly, true);
  // Moving DOM focus invokes the installed Paper blur path, but is not a browser Tab test.
  await flush(() => outside.focus()); assert.equal(document.activeElement, outside);
  assert.equal(appearance.dataset.paperFocused, 'false'); assert.equal(blurs, 1);
  await render(false); assert.equal(appearance.dataset.paperFocused, 'false'); assert.equal(node.readOnly, false); assert.equal(document.activeElement, outside);
});
test('native and ordinary disabled date fields never receive a readOnly override', async t => {
  const { AppDateField } = load('frontend/src/components/DateTimeFields.tsx');
  const container = document.body.appendChild(document.createElement('main')), renderer = createRoot(container);
  t.after(async () => { testPlatform = 'web'; await React.act(() => renderer.unmount()); container.remove(); });
  for (const [platform, optIn] of [['web', false], ['android', false], ['android', true]]) {
    testPlatform = platform;
    await React.act(() => renderer.render(e(AppDateField, { label: 'Synthetic date', value: applied.startDay, disabled: true, preserveFocusWhenDisabled: optIn, onChange() {} })));
    const appearance = container.querySelector('[data-readonly-prop]');
    assert.equal(appearance.dataset.readonlyProp, 'unset', `${platform} must not override native editable with readOnly=false`);
    assert.equal(appearance.dataset.paperEditable, 'false');
  }
  testPlatform = 'web';
});
test('initial loading, read error, pending and lost access do not gain the quiet-read exception', async t => {
  const h = await setup(t);
  for (const patch of [{ page: null, busy: true }, { busy: true, readFailed: true, notice: 'Synthetic read error' }, { busy: true, operation: 'saving', pending: { confirmed: true, input: { questions: [], checklist: [], period: applied } } }, { busy: true, access: 'lost', page: null }]) {
    await h.render(patch); assert.equal(h.button('摘要期間：一日').disabled, true); assert.equal(h.button('選擇摘要開始日').disabled, true); assert.equal(h.container.querySelector('input').readOnly, true);
    if (patch.page === null && !patch.access) assert.ok(h.container.querySelector('[data-testid="read-loading"]'));
    if (patch.readFailed) assert.match(h.container.textContent, /Synthetic read error/);
    if (patch.access) assert.match(h.container.textContent, /已無權讀取/);
  }
});
const profileModel = { child: { id: 'child-a', name: 'Synthetic child' }, access: 'editable', reading: false, online: true, needsRefresh: false, operation: { state: 'none' },
  current: { version: 4, confirmedAtLabel: 'Synthetic time', data: { age: { kind: 'unknown' }, preferences: 'Synthetic confirmed preference', source: 'Synthetic source', validUntil: null, language: '廣東話' } } };
const source = { scopeKey: 'synthetic-a', childId: 'child-a', state: 'available' };
test('loaded overview content and structure do not collapse during a same-scope profile read', async t => {
  const container = document.body.appendChild(document.createElement('main')), renderer = createRoot(container);
  const render = reading => React.act(() => renderer.render(e(Profile.Provider, { value: { scopeKey: source.scopeKey, model: { ...profileModel, reading }, profileSource: source } }, e(ChildOverviewContent, { onOpenProfile() {}, onOpenProfileHistory() {} }))));
  t.after(async () => { await React.act(() => renderer.unmount()); container.remove(); });
  await render(false); const before = container.textContent, elements = [...container.querySelectorAll('*')].map(node => node.tagName);
  await render(true); assert.equal(container.textContent, before); assert.deepEqual([...container.querySelectorAll('*')].map(node => node.tagName), elements);
  await render(false); assert.equal(container.textContent, before);
});
test('overview still clears inaccessible, unavailable, invalidated and confirmed-unread sources during reads', () => {
  const read = (patch, projection = source) => readChildProfile({ ...profileModel, reading: true, ...patch }, source.scopeKey, '2026-10-23', projection);
  for (const [patch, projection] of [[{ access: 'lost' }, source], [{}, { ...source, scopeKey: 'other' }], [{}, { ...source, childId: 'other' }], [{}, { ...source, state: 'invalidated' }], [{}, { ...source, state: 'unavailable' }], [{ operation: { state: 'saved', resultUnavailable: true } }, source], [{ online: false }, source], [{ needsRefresh: true }, source]]) assert.equal(read(patch, projection).data, null);
  assert.equal(readChildProfile({ ...profileModel, reading: true }, source.scopeKey, '2026-10-23').data, null);
  assert.equal(read({ current: null }).state, 'loading');
});

test('overview review dialog keeps mounted filter focus and disclosure through quiet refresh, then preserves draft on reopen', async t => {
  const container = document.body.appendChild(document.createElement('main')), renderer = createRoot(container);
  let model = { ...baseSummary, page: { ...baseSummary.page, childId: 'child-a', endDayExclusive: '2026-10-30', records: [], missing: { unknownEventTime: 0 } } };
  const actions = { updateQuery(query) { model = { ...model, query }; }, refresh() {}, discard() { assert.fail('Closing read-only review must not discard owner state'); } };
  const flush = callback => React.act(async () => { callback?.(); });
  const render = patch => { model = { ...model, ...patch }; return flush(() => renderer.render(e(Summary.Provider, { value: { model, actions } }, e(TaskKnowledgeSummaryContent, { presentation: 'overview', scopeKey: 'synthetic-a', childId: 'child-a', onRecord() {}, onTask() {} })))); };
  const button = label => [...container.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === label);
  t.after(async () => { await flush(() => renderer.unmount()); container.remove(); });
  await render(); assert.equal(container.querySelector('[data-testid="summary-records"]'), null);
  await flush(() => button('查看完整回顧').click()); assert.ok(container.querySelector('[role="dialog"]'));
  await flush(() => button('選擇摘要期間').click()); const input = container.querySelector('input'), report = container.querySelector('[data-testid="summary-records"]');
  await flush(() => input.focus()); await render({ busy: true });
  assert.equal(container.querySelector('input'), input); assert.equal(document.activeElement, input); assert.equal(input.readOnly, true);
  assert.equal(container.querySelector('[data-testid="summary-records"]'), report);
  await render({ busy: false, query: { ...model.query, startDay: '2026-09-01' } });
  await flush(() => button('關閉完整回顧').click()); assert.equal(container.querySelector('[role="dialog"]'), null);
  await flush(() => button('查看完整回顧').click()); await flush(() => button('選擇摘要期間').click());
  assert.equal(container.querySelector('input').value, '2026-09-01'); assert.equal(model.page.period.startDay, applied.startDay);
  await render({ access: 'lost' }); assert.equal(container.querySelector('[role="dialog"]'), null); assert.equal(container.querySelector('[data-testid="summary-records"]'), null);
});

test('profile source details stay open and retain original text through same-scope quiet refresh', async t => {
  const container = document.body.appendChild(document.createElement('main')), renderer = createRoot(container);
  const flush = callback => React.act(async () => { callback?.(); });
  const render = patch => flush(() => renderer.render(e(Profile.Provider, { value: { scopeKey: source.scopeKey, model: { ...profileModel, ...patch }, profileSource: source } }, e(ChildOverviewContent, { onOpenProfile() {}, onOpenProfileHistory() {} }))));
  const button = label => [...container.querySelectorAll('button')].find(node => node.getAttribute('aria-label') === label);
  t.after(async () => { await flush(() => renderer.unmount()); container.remove(); });
  await render({}); await flush(() => button('查看照顧資料與來源').click()); const dialog = container.querySelector('[role="dialog"]');
  assert.match(dialog.textContent, /Synthetic source/); await render({ reading: true }); assert.equal(container.querySelector('[role="dialog"]'), dialog);
  assert.match(dialog.textContent, /Synthetic confirmed preference/);
  await render({ access: 'lost' }); assert.equal(container.querySelector('[role="dialog"]'), null);
});
