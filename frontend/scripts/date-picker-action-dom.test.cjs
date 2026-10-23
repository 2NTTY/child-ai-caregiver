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
// True installed Paper/Dates controls and RN Web Modal/focus trap. Only native
// safe-area geometry, icon glyphs and decorative motion are host ports.
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
    if (name.endsWith('/AppScrollView')) return { AppScrollView: native.ScrollView };
    if (name.endsWith('/AppDialog')) return { AppDialog: paper.Dialog };
    if (name.endsWith('/ui')) return { AppTextField: paper.TextInput, AppButton: p => e(paper.Button, { onPress: p.onPress, disabled: p.disabled }, p.label) };
    if (name.endsWith('/motion')) return { MotionBackdrop: () => null, MotionEntrance: ({ children, style, testID }) => e(native.View, { style, testID }, children) };
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
const { AppDateField } = load('src/components/DateTimeFields.tsx'), { paperTheme } = load('src/theme.ts');
const css = document.createElement('style'); css.textContent = fs.readFileSync(path.join(root, 'src/components/datePickerAction.css'), 'utf8'); document.head.appendChild(css);
const enabledSelector = '[data-testid="app-date-picker"] [data-testid="react-native-paper-dates-save"]:not([aria-disabled="true"]):not(:disabled)';
const byId = id => document.querySelector(`[data-testid="${id}"]`);
const renderer = createRoot(document.getElementById('root'));
const provider = child => e(paper.PaperProvider, { theme: paperTheme, settings: { rippleEffectEnabled: false } }, child);
async function render(child) { await React.act(async () => renderer.render(provider(child))); }
async function click(node) { assert.ok(node); await React.act(async () => { node.focus(); node.click(); }); }
const input = () => document.querySelector('input[aria-label="合成日期"]');
const trigger = () => document.querySelector('[aria-label="選擇合成日期"]');
let changes = [];
function Field() { const [value, setValue] = React.useState('2026-10-23'); return e(AppDateField, { label: '合成日期', value, onChange: next => { changes.push(next); setValue(next); } }); }

test('installed date picker action is scoped, enabled, focusable, and preserves confirm/cancel/Escape callbacks', async () => {
  await render(e(Field)); await click(trigger());
  const save = byId('react-native-paper-dates-save');
  assert.equal(save.textContent, '確認日期'); assert.equal(save.getAttribute('role'), 'button');
  assert.equal(save.matches(enabledSelector), true); assert.equal(save.tabIndex, 0);
  assert.equal(window.getComputedStyle(save).backgroundColor, 'rgb(39, 35, 67)');
  assert.equal(window.getComputedStyle(save).minHeight, '44px');
  assert.equal(window.getComputedStyle(save).minWidth, '108px');
  assert.equal(window.getComputedStyle(save).justifyContent, 'center');
  assert.equal(byId('react-native-paper-dates-close').matches(enabledSelector), false);
  // Native browser keyboard activation is a browser gate: jsdom does not emit
  // the default button click when dispatching synthetic Enter/Space events.
  assert.equal(save.tagName, 'BUTTON');
  await click(save); assert.deepEqual(changes, ['2026-10-23']); assert.equal(input().value, '2026-10-23');
  assert.equal(document.activeElement, input()); assert.equal(byId('app-date-picker'), null);
  await click(trigger()); await click(byId('react-native-paper-dates-day-2026-9-24'));
  assert.deepEqual(changes, ['2026-10-23'], 'calendar selection stays local until confirmation');
  await click(byId('react-native-paper-dates-close')); assert.equal(input().value, '2026-10-23'); assert.equal(document.activeElement, input());
  await click(trigger()); await click(byId('react-native-paper-dates-day-2026-9-24')); await click(byId('react-native-paper-dates-save'));
  assert.deepEqual(changes, ['2026-10-23', '2026-10-24']); assert.equal(input().value, '2026-10-24');
  await click(trigger());
  await React.act(async () => document.dispatchEvent(new window.KeyboardEvent('keyup', { key: 'Escape', bubbles: true })));
  assert.equal(byId('app-date-picker'), null); assert.equal(document.activeElement, input()); assert.equal(input().value, '2026-10-24');
  await render(null);
});

test('installed disabled save retains disabled semantics and never receives enabled action styling', async () => {
  let saves = 0;
  await render(e(native.View, { testID: 'app-date-picker' }, e(dates.DatePickerModalContent, { locale: 'zh-HK', mode: 'single', date: new Date(2026, 9, 23, 12), saveLabelDisabled: true, onConfirm() { saves++; }, onDismiss() {} })));
  const save = byId('react-native-paper-dates-save');
  assert.equal(save.getAttribute('aria-disabled'), 'true'); assert.equal(save.matches(enabledSelector), false); assert.equal(save.tabIndex, -1);
  await click(save); assert.equal(saves, 0);
  assert.notEqual(window.getComputedStyle(save).backgroundColor, 'rgb(39, 35, 67)');
  await render(e(dates.DatePickerModalContent, { locale: 'zh-HK', mode: 'single', onConfirm() {}, onDismiss() {} }));
  assert.equal(byId('react-native-paper-dates-save').matches(enabledSelector), false, 'unowned date modal must not inherit this style');
  await render(null);
});

test.after(async () => { await React.act(async () => renderer.unmount()); Module._load = originalLoad; dom.window.close(); });
