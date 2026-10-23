const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for an existing jsdom installation.');
const { JSDOM } = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'ShadowRoot', 'Document']) global[key] = dom.window[key];
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.requestAnimationFrame = window.requestAnimationFrame.bind(window);
global.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
global.IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no layout; this port only distinguishes connected/hidden nodes.
Object.defineProperty(HTMLElement.prototype, 'getClientRects', { configurable: true, value() { return this.isConnected && !this.closest('[hidden],[aria-hidden="true"]') ? [{}] : []; } });
const root = path.resolve(__dirname, '..'), req = createRequire(path.join(root, 'package.json'));
const React = req('react'), { createRoot } = req('react-dom/client'), native = req('react-native-web'), ts = req('typescript');
const e = React.createElement, Module = require('node:module'), originalLoad = Module._load;
// Actual HistoryScreen, FormDialog, AppDialog, navigation guard and installed RN Web modal/focus trap.
// Unrelated data owners/readers, router, control wrappers and decorative/layout ports are synthetic.
Module._load = function(name, ...args) {
  if (name === 'react-native') return native;
  if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }), SafeAreaView: native.View };
  if (name.endsWith('/SafeAreaProviderCompat')) return { __esModule: true, default: p => p.children };
  if (name.endsWith('/MaterialCommunityIcon')) return { __esModule: true, default: () => null };
  return originalLoad.call(this, name, ...args);
};
const paper = req('react-native-paper'), dates = req('react-native-paper-dates');
const cache = new Map();
function load(relative) {
  if (cache.has(relative)) return cache.get(relative).exports;
  const filename = path.join(root, relative), module = { exports: {} }; cache.set(relative, module);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    if (name === './date-picker-action') return {};
    if (name === 'expo-router') return {usePathname: () => '/history', useLocalSearchParams: () => ({category: 'notifications'}), useRouter: () => ({push() {}, setParams() {}}), Link: native.View};
    if (name === 'expo-router/react-navigation') return {useNavigation: () => ({dispatch() {}}), usePreventRemove() {}};
    if (name === './browser-history-guard') return {guardBrowserHistory: () => () => {}};
    if (name.endsWith('/ProductionProvider')) return {useProduction: () => ({scopeKey: 'parent:child-a', model: {selectedChildId: 'child-a', children: [{id: 'child-a'}]}, actions: {}})};
    if (name.endsWith('/usePersonalHistory')) return {usePersonalHistoryWorkspace: () => ({scopeKey: 'parent:child-a'})};
    if (name.endsWith('/useContainerWidth')) return {useContainerWidth: () => ({width: 390, ref: null, onLayout() {}})};
    if (name.endsWith('/appearance/BackgroundSurface')) return {BackgroundSurface: native.View};
    if (name.endsWith('/PageFrame')) return {PageFrame: p => e(native.View, {}, p.children)};
    if (name === '../preparation-view-model') return {searchPreparationHistory: () => []};
    for (const owner of ['Tasks', 'Care', 'Preparation', 'Growth', 'Profile']) if (name === `../workspaces/${owner}Workspace`) return {[`use${owner}Workspace`]: () => null};
    for (const [path, symbol] of [['tasks/TaskHistoryView', 'TaskHistoryView'], ['care/CareReviewHistoryView', 'CareReviewHistoryView'], ['care/CareSavedRecordsView', 'CareSavedRecordsView'], ['preparations/PreparationWorkspace', 'PreparationHistoryView'], ['profile/ProfileHistoryView', 'ProfileHistoryView'], ['growth/GrowthHistoryView', 'GrowthHistoryView']]) if (name === `../components/${path}`) return {[symbol]: () => null};
    if (name === '../components/history/PersonalHistoryViews') return {PersonalConversationHistoryView: () => null, PersonalNotificationHistoryView: ({dateRange}) => e(native.Text, {testID: 'synthetic-history-result'}, JSON.stringify(dateRange))};
    if (name.endsWith('/AppScrollView')) return { AppScrollView: native.ScrollView };
    if (name.endsWith('/ui')) return { AppTextField: paper.TextInput, AppButton: p => e(paper.Button, { ref: p.ref, onPress: p.onPress, disabled: p.disabled, accessibilityLabel: p.accessibilityLabel ?? p.label }, p.label), AppSelect: p => e(native.Text, {}, p.label), AppTabPanel: native.View, UnderlineTabs: native.View };
    if (name.endsWith('/motion')) return { motionTokens: {dialog: {distance: 12, duration: 0}}, useMotionPreferences: () => ({enabled: false, epoch: 0}), MotionBackdrop: () => null, MotionEntrance: ({ children, style, testID }) => e(native.View, { style, testID }, children) };
    if (name.endsWith('/MotionPaperScope')) return { MotionPaperScope: p => p.children };
    if (name.endsWith('/useModalBackdrop')) return { useModalBackdrop: () => ({}) };
    if (name.startsWith('.')) {
      const base = path.resolve(path.dirname(filename), name), found = [base, base + '.tsx', base + '.ts'].find(value => fs.existsSync(value) && fs.statSync(value).isFile());
      if (found) return load(path.relative(root, found));
    }
    return req(name);
  }, module, module.exports);
  return module.exports;
}
const {default: HistoryScreen} = load('src/screens/historyScreen.tsx');
const {PreviewNavigationGuard, usePreviewLeaveGuard} = load('src/preview/PreviewNavigationGuard.tsx');
const {paperTheme} = load('src/theme.ts');
const byId = id => document.querySelector(`[data-testid="${id}"]`);
const button = label => document.querySelector(`[aria-label="${label}"]`);
const renderer = createRoot(document.getElementById('root'));
async function render(child) { await React.act(async () => renderer.render(e(paper.PaperProvider, {theme: paperTheme, settings: {rippleEffectEnabled: false}}, child))); }
async function click(node) { assert.ok(node); await React.act(async () => { node.focus(); node.click(); }); }
async function fill(node, value) {
  assert.ok(node);
  await React.act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(node, value);
    node.dispatchEvent(new window.Event('input', {bubbles: true}));
  });
}
function RetainedOwner({state}) { usePreviewLeaveGuard(state === 'dirty', state === 'pending' || state === 'unknown', 'child', undefined, true); return null; }
const screen = state => e(PreviewNavigationGuard, {}, [e(RetainedOwner, {key: 'retained', state}), e(HistoryScreen, {key: 'history'})]);

for (const action of ['close', 'escape', 'apply']) test(`actual history date ${action} preserves local semantics and restores focus after the RN Web modal closes`, async () => {
  for (const state of ['clean', 'dirty', 'pending', 'unknown']) {
    await render(screen(state));
    const original = button('日期篩選'); await click(original);
    assert.ok(byId('manual-form-dialog'));
    const input = document.querySelector('input[aria-label="開始日期（可不填）"]');
    await fill(input, '2026-10-01');
    assert.equal(byId('synthetic-history-result').textContent, '{"from":null,"to":null}');
    if (action === 'close') await click(button('關閉日期篩選'));
    else if (action === 'escape') await React.act(async () => document.dispatchEvent(new window.KeyboardEvent('keyup', {key: 'Escape', bubbles: true})));
    else await click(button('套用日期'));
    assert.equal(byId('manual-form-dialog'), null, `${state}/${action}`);
    assert.equal(byId('leave-preview-dialog'), null);
    assert.equal(document.activeElement, original, 'Focus returns to the same date trigger only after the modal releases its trap');
    assert.equal(byId('synthetic-history-result').textContent, action === 'apply' ? '{"from":"2026-10-01","to":null}' : '{"from":null,"to":null}');
    assert.equal(!!byId('history-applied-dates'), action === 'apply');
    await click(button(action === 'apply' ? '日期已篩選' : '日期篩選'));
    assert.equal(document.querySelector('input[aria-label="開始日期（可不填）"]').value, action === 'apply' ? '2026-10-01' : '');
    await click(button('關閉日期篩選'));
    await render(null);
  }
});

test.after(async () => { await React.act(async () => renderer.unmount()); Module._load = originalLoad; dom.window.close(); });
