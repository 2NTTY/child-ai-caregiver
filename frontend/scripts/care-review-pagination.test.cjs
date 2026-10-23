const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const root = path.resolve(__dirname, '..'), req = Module.createRequire(path.join(root, 'package.json'));
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for an existing jsdom installation.');
const {JSDOM} = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<!doctype html><html><body><main id="root"></main></body></html>', {pretendToBeVisual: true});
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'ShadowRoot']) global[key] = dom.window[key];
Object.defineProperty(global, 'navigator', {value: dom.window.navigator, configurable: true});
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = req('react'), {createRoot} = req('react-dom/client'), native = req('react-native-web'), ts = req('typescript'), e = React.createElement;
const originalLoad = Module._load;
Module._load = function(name, ...args) {
  if (name === 'react-native') return native;
  if (name === 'react-native-safe-area-context') return {useSafeAreaInsets: () => ({top: 0, right: 0, bottom: 0, left: 0}), SafeAreaView: native.View};
  if (name.endsWith('/SafeAreaProviderCompat')) return {__esModule: true, default: p => p.children};
  if (name.endsWith('/MaterialCommunityIcon')) return {__esModule: true, default: () => null};
  return originalLoad.call(this, name, ...args);
};
let width = 320, setPage, setLoaded, setDisabled, calls = [], networkCalls = 0;
const oldFetch = global.fetch;
global.fetch = () => {networkCalls++; throw new Error('Real transport is forbidden');};
const cache = new Map();
function load(relative) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const module = {exports: {}}; cache.set(filename, module);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {fileName: filename, compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'react-native') return native;
    if (name.endsWith('/useContainerWidth')) return {useContainerWidth: () => ({width, ref: null, onLayout() {}})};
    // Decorative glyph is a fixed-size host port; all pager controls and RN Web semantics are real.
    if (name.endsWith('/AppIcon')) return {AppIcon: ({name, size, color}) => e(native.Text, {accessibilityElementsHidden: true, 'aria-hidden': true, style: {width: size, height: size, fontSize: size, lineHeight: size, color}}, name === 'chevron-left' ? '‹' : '›')};
    if (!name.startsWith('.')) return req(name);
    const base = path.resolve(path.dirname(filename), name), file = [base, `${base}.ts`, `${base}.tsx`].find(file => fs.existsSync(file) && fs.statSync(file).isFile());
    return load(path.relative(root, file));
  }, module, module.exports);
  return module.exports;
}
const {CareReviewPagination, careReviewPageSlots} = load('src/components/care/CareReviewPagination.tsx');
const app = createRoot(document.getElementById('root'));
function Host({initialCount = 23, initialPage = 0}) {
  const [page, pageUpdate] = React.useState(initialPage), [count, countUpdate] = React.useState(initialCount), [disabled, disabledUpdate] = React.useState(false);
  setPage = pageUpdate; setLoaded = countUpdate; setDisabled = disabledUpdate;
  const current = Math.min(page, Math.max(0, Math.ceil(count / 10) - 1));
  return e(CareReviewPagination, {page: current, pageSize: 10, loadedCount: count, disabled, onPageChange(next) {calls.push(next); pageUpdate(next);}});
}
async function setup(count = 23, page = 0) {await React.act(async () => app.render(null)); calls = []; await React.act(async () => app.render(e(Host, {initialCount: count, initialPage: page})));}
const label = value => document.querySelector(`[aria-label="${value}"]`);
async function click(value) {await React.act(async () => label(value).click());}
const current = () => document.querySelector('[aria-current="page"]');

test('every local page window is ordered, bounded, uniquely numbered, and exposes first/current/last loaded page', () => {
  for (const compact of [false, true]) for (let count = 2; count <= 50; count++) for (let page = 0; page < count; page++) {
    const slots = careReviewPageSlots(page, count, compact), numbers = slots.filter(value => typeof value === 'number');
    assert.ok(slots.length <= (compact ? 5 : 7)); assert.equal(numbers[0], 0); assert.equal(numbers.at(-1), count - 1); assert.ok(numbers.includes(page));
    assert.deepEqual(numbers, [...new Set(numbers)].sort((a, b) => a - b)); assert.ok(numbers.every(value => value >= 0 && value < count));
    slots.forEach((value, index) => {if (typeof value !== 'number') assert.ok(slots[index + 1] - slots[index - 1] > 1, 'Only real omitted pages use ellipses');});
  }
});

test('RN Web exposes one named navigation, current page and bounded previous/next; clicks never load remote data', async () => {
  await setup();
  assert.equal(document.querySelectorAll('nav[aria-label="核對記錄已載入頁面"]').length, 1);
  assert.equal(document.querySelectorAll('[role="list"]').length, 1);
  assert.equal(current().textContent, '1'); assert.equal(label('上一頁').getAttribute('aria-disabled'), 'true');
  assert.equal(document.querySelectorAll('[aria-current]').length, 1); assert.match(document.body.textContent, /第 1–10 項 · 已載入 23 項/);
  await click('上一頁'); assert.deepEqual(calls, []);
  await click('下一頁'); assert.equal(current().textContent, '2'); assert.deepEqual(calls, [1]);
  await click('第 3 頁，已載入'); assert.equal(current().textContent, '3'); assert.match(document.body.textContent, /第 21–23 項/);
  assert.equal(label('下一頁').getAttribute('aria-disabled'), 'true'); await click('下一頁'); assert.deepEqual(calls, [1, 2]);
  await click('上一頁'); assert.equal(current().textContent, '2');
  await React.act(async () => setDisabled(true)); const before = [...calls];
  for (const control of document.querySelectorAll('[role="button"]')) {assert.equal(control.getAttribute('aria-disabled'), 'true'); await React.act(async () => control.click());}
  assert.deepEqual(calls, before); assert.equal(networkCalls, 0);
  assert.doesNotMatch(document.body.textContent, /共.*頁|尾頁|最後一頁/);
});

test('current local page remains accessible after fewer matches, and one-page windows have no pagination', async () => {
  await setup(101, 5); assert.equal(current().textContent, '6');
  assert.equal(document.querySelectorAll('[aria-label^="第 "]').length, 3);
  await React.act(async () => setLoaded(21)); assert.equal(current().textContent, '3'); assert.match(document.body.textContent, /已載入 21 項/);
  await React.act(async () => setLoaded(10)); assert.equal(document.querySelector('[data-testid="care-review-pagination"]'), null);
  await React.act(async () => setLoaded(0)); assert.equal(document.querySelector('nav'), null);
});

test('save four-size RN Web pagination markup for bounded browser geometry inspection when requested', async () => {
  if (!process.env.PAGER_MARKUP_DIR) return;
  fs.mkdirSync(process.env.PAGER_MARKUP_DIR, {recursive: true});
  for (const viewport of [1440, 1024, 390, 320]) {
    width = viewport >= 1024 ? 760 : viewport - 64;
    await setup(101, 5);
    const sheet = native.StyleSheet.getSheet();
    const html = `<!doctype html><html lang="zh-HK"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${sheet.textContent}</style><style>html,body{margin:0;background:#f7fcfc}main{box-sizing:border-box;max-width:824px;padding:32px;margin:auto}h1{font:600 22px sans-serif;color:#272343}article{padding:20px;margin:16px 0;background:white;border:1px solid #cac9d4;border-radius:16px;font:16px sans-serif;color:#272343}</style><main><h1>核對記錄</h1><article>合成示例 · 已載入的核對內容</article>${document.getElementById('root').innerHTML}<p style="font:12px sans-serif;color:#5e4f0c">仍有核對記錄未載入。</p></main></html>`;
    fs.writeFileSync(path.join(process.env.PAGER_MARKUP_DIR, `pager-${viewport}.html`), html);
  }
});

test.after(async () => {await React.act(async () => app.unmount()); Module._load = originalLoad; global.fetch = oldFetch; dom.window.close(); assert.equal(networkCalls, 0);});
