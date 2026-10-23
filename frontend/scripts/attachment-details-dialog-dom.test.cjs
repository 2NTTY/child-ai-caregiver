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
let navigationCalls = 0;
const cache = new Map(), Empty = () => null;
const Button = React.forwardRef((p, ref) => e(native.Pressable, {ref, onPress: p.onPress, disabled: p.disabled, accessibilityRole: 'button', accessibilityLabel: p.accessibilityLabel ?? p.label}, e(native.Text, null, p.label)));
// Actual attachment library, HistoryEntryCard, FormDialog, AppDialog and installed RN Web Modal/focus trap.
// Synthetic media controls and layout ports; this is not viewport or browser-layout acceptance.
function load(relative) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = {exports: {}}; cache.set(filename, module);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {fileName: filename, compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'react-native') return native;
    if (name.endsWith('/PreviewNavigationGuard')) return {usePreviewNavigation: () => callback => {navigationCalls++; callback();}};
    if (name.endsWith('/useContainerWidth')) return {useContainerWidth: () => ({width: 390, ref: null, onLayout() {}})};
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
const {OriginalMediaLibrary} = load('src/components/photos/AttachmentLibrary.tsx');
const {paperTheme} = load('src/theme.ts');
const renderer = createRoot(document.getElementById('root'));
const byId = id => document.querySelector(`[data-testid="${id}"]`);
const dialog = () => document.querySelector('[role="dialog"]');
const close = () => document.querySelector('[aria-label="關閉附件詳情"]');
let mediaActions = 0, scope = 'scope-a', version = 1;
function view() {
  const item = {id: 'synthetic-file', kind: 'file', title: 'Synthetic original.pdf', sizeLabel: '4 KB',
    sourceLabel: 'Synthetic private chat', createdAtLabel: '2026-10-23 12:00', version,
    content: e(native.Pressable, {testID: 'media-control', accessibilityRole: 'button', onPress: () => mediaActions++}, e(native.Text, null, '下載原檔'))};
  return e(paper.PaperProvider, {theme: paperTheme, settings: {rippleEffectEnabled: false}},
    e(native.View, {testID: 'outer-scroll'}, e(OriginalMediaLibrary, {key: scope, kind: 'file', page: {
      items: [item], state: 'ready', online: true, hasMore: false, busy: false, refresh() {}, loadMore() {},
    }})));
}
async function render() { await React.act(async () => renderer.render(view())); }
async function click(node) { assert.ok(node); await React.act(async () => {node.focus(); node.click();}); }
async function key(node, value, type = 'keydown') {
  await React.act(async () => node.dispatchEvent(new window.KeyboardEvent(type, {key: value, bubbles: true})));
}

test('native button header opens a named modal; Escape and close restore the exact trigger without moving the list or media controls', async () => {
  await render();
  const card = byId('attachment-file-synthetic-file'), trigger = byId('attachment-details-synthetic-file');
  const media = byId('media-control'), outer = byId('outer-scroll'); outer.scrollTop = 220;
  assert.ok(card.textContent.includes('本人')); assert.doesNotMatch(card.textContent, /版本|只有本人|已保存並連結|Synthetic private chat/);
  assert.equal(trigger.contains(media), false); assert.equal(dialog(), null);
  await click(media); assert.equal(mediaActions, 1); assert.equal(dialog(), null);
  assert.equal(trigger.tagName, 'BUTTON'); assert.equal(trigger.tabIndex, 0);
  // jsdom does not perform native-button Enter/Space default activation; browser verification remains pending.
  await click(trigger);
  assert.ok(dialog()); assert.equal(dialog().getAttribute('aria-label'), '附件詳情');
  assert.ok(dialog().contains(document.activeElement), 'Installed RN Web modal owns focus');
  assert.match(dialog().textContent, /Synthetic private chat/); assert.match(dialog().textContent, /2026-10-23 12:00/);
  assert.doesNotMatch(dialog().textContent, /版本|只有本人|已保存並連結/);
  assert.equal(byId('attachment-file-synthetic-file'), card); assert.equal(byId('media-control'), media);
  assert.equal(outer.scrollTop, 220); assert.equal(card.textContent.includes('Synthetic private chat'), false);
  await key(document, 'Escape', 'keyup');
  assert.equal(dialog(), null); assert.equal(document.activeElement, trigger); assert.equal(navigationCalls, 0);
  await click(trigger); assert.ok(dialog()); await click(close());
  assert.equal(dialog(), null); assert.equal(document.activeElement, trigger); assert.equal(outer.scrollTop, 220);
  assert.equal(mediaActions, 1);
});

test('version and scope changes dismiss stale details without invoking media or navigation actions', async () => {
  const trigger = byId('attachment-details-synthetic-file');
  await click(trigger); assert.ok(dialog());
  version++; await render(); assert.equal(dialog(), null);
  await click(byId('attachment-details-synthetic-file')); assert.ok(dialog());
  scope = 'scope-b'; await render(); assert.equal(dialog(), null);
  assert.equal(navigationCalls, 0); assert.equal(mediaActions, 1);
});

test.after(async () => {await React.act(async () => renderer.unmount()); Module._load = originalLoad; dom.window.close();});
