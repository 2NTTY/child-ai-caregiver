const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const root = path.resolve(__dirname, '..');
const requireFrontend = Module.createRequire(path.join(root, 'package.json'));
// Use an explicitly provided existing DOM runtime; no product dependency or browser claim.
const { JSDOM } = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const name of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'ShadowRoot', 'MutationObserver', 'getComputedStyle']) global[name] = dom.window[name];
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
global.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia ??= () => ({ matches: false, addListener() {}, removeListener() {} });
const React = requireFrontend('react'), { createRoot } = requireFrontend('react-dom/client');
const rn = requireFrontend('react-native-web'), ts = requireFrontend('typescript');
const originalLoad = Module._load;
Module._load = function(name, parent, isMain) {
  if (name === 'react-native') return rn;
  if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }), SafeAreaInsetsContext: React.createContext({ top: 0, right: 0, bottom: 0, left: 0 }) };
  return originalLoad.call(this, name, parent, isMain);
};
const paper = {
  MD3LightTheme: requireFrontend('react-native-paper/lib/commonjs/styles/themes/v3/LightTheme').MD3LightTheme,
  configureFonts: requireFrontend('react-native-paper/lib/commonjs/styles/fonts').default,
  Text: requireFrontend('react-native-paper/lib/commonjs/components/Typography/Text').default,
  Button: requireFrontend('react-native-paper/lib/commonjs/components/Button/Button').default,
  Dialog: requireFrontend('react-native-paper/lib/commonjs/components/Dialog/Dialog').default,
};
const transparent = ({ children }) => React.createElement(React.Fragment, null, children);
const empty = () => null;
const cache = new Map();
function load(relative) {
  const filename = path.join(root, 'src', relative);
  if (cache.has(filename)) return cache.get(filename);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'react-native') return rn;
    if (name === 'react-native-paper') return paper;
    if (name.endsWith('/AppIcon')) return { AppIcon: empty };
    if (name.endsWith('/AppStatusBadge')) return { AppStatusBadge: empty };
    if (name.endsWith('/AppScrollView')) return { AppScrollView: rn.ScrollView };
    if (name.endsWith('/useInteractionDensity')) return { useInteractionDensity: () => false };
    if (name.endsWith('/motion')) return { MotionBackdrop: empty, MotionEntrance: transparent, motionTokens: { dialog: { distance: 12, duration: 0 } }, useMotionPreferences: () => ({ enabled: false, epoch: 0 }) };
    if (name.endsWith('/MotionPaperScope')) return { MotionPaperScope: transparent };
    if (name.endsWith('/useModalBackdrop')) return { useModalBackdrop: () => ({}) };
    if (name.endsWith('/ui')) return { AppButton: load('components/ui.tsx').AppButton,
      AppSelect: ({ label, value, options, onChange }) => React.createElement('select', { 'aria-label': label, value, onChange: event => onChange(event.target.value) }, options.map(option => React.createElement('option', { key: option.value, value: option.value }, option.label))) };
    if (['./AppRadioItem', './HorizontalOverflowRail', '../motion/MotionSelectionMarker'].includes(name)) return new Proxy({}, { get: () => empty });
    if (!name.startsWith('.')) return requireFrontend(name);
    const target = path.resolve(path.dirname(filename), name);
    const resolved = fs.existsSync(target) ? target : fs.existsSync(target + '.ts') ? target + '.ts' : target + '.tsx';
    return load(path.relative(path.join(root, 'src'), resolved));
  }, module, module.exports);
  cache.set(filename, module.exports); return module.exports;
}
const GrowthArchive = load('components/growth/GrowthArchive.tsx').GrowthArchive;
const reactRoot = createRoot(document.getElementById('root'));
const failure = 'PDF 未能取得，沒有改用其他版本。請重新讀取並核對來源後再試。';
const model = () => {
  const snapshot = { id: 'report-a', version: 1, title: 'Synthetic report', ageLabel: '3 歲', periodLabel: '2026 年', generatedAt: '2026-10-09T00:00:00Z', sourceBasisVersion: 'synthetic', coverageNote: 'Synthetic', revisionChanges: [], sections: [], sources: [] };
  const older = { ...snapshot, id: 'report-b', version: 2 };
  return { scopeKey: 'synthetic:child-a', childId: 'child-a', childName: 'Synthetic', access: 'editable', online: true, load: 'ready', page: { authorityVersion: 'auth:1', items: [], archive: { scopeKey: 'synthetic:child-a', childId: 'child-a', authorityVersion: 'auth:1', state: 'ready', label: 'Synthetic', snapshot, history: [older], periods: [snapshot, older].map((value, i) => ({ id: value.id + ':' + value.version, kind: 'year', year: 2026 - i, label: 'Synthetic ' + i, snapshotId: value.id, snapshotVersion: value.version, currentAnnual: i === 0, coverage: 'complete' })) } } };
};
let value, active, busy, calls, setBusy;
function Host() {
  const [pending, updateBusy] = React.useState(false); setBusy = updateBusy;
  return React.createElement(GrowthArchive, { model: value, active, wide: true, scrollRef: { current: null }, exportBusy: pending,
    onExportReport(request, isCurrent) { updateBusy(true); return new Promise((resolve, reject) => calls.push({ request, isCurrent, resolve(result) { updateBusy(false); resolve(result); }, reject(error) { updateBusy(false); reject(error); } })); } });
}
const render = () => reactRoot.render(React.createElement(Host));
const byLabel = label => document.querySelector(`[aria-label="${label}"]`);
const dialog = () => document.querySelector('[data-testid="growth-report-export"]');
const status = () => dialog()?.querySelector('[data-testid="growth-export-feedback"]');
async function click(node) { assert.ok(node, 'Control exists'); await React.act(async () => { node.focus(); node.click(); }); }
async function start() {
  await React.act(async () => reactRoot.render(null)); value = model(); active = true; calls = [];
  await React.act(async () => render()); await click(byLabel('導出報告'));
}
async function submit() { await click(byLabel('下載這個版本的 PDF')); assert.equal(calls.length, 1); return calls[0]; }
async function key(node, value, repeat = false) {
  assert.ok(node, 'Keyboard target exists');
  const down = new window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, repeat });
  await React.act(async () => { node.focus(); node.dispatchEvent(down); });
  await React.act(async () => node.dispatchEvent(new window.KeyboardEvent('keyup', { key: value, bubbles: true, cancelable: true })));
  return down;
}
function checkedPurpose(label) {
  const group = dialog().querySelector('[role="radiogroup"][aria-label="報告用途"]');
  const checked = [...group.querySelectorAll('[role="radio"][aria-checked="true"]')];
  assert.equal(checked.length, 1, 'Exactly one purpose is checked');
  assert.equal(checked[0].getAttribute('aria-label'), label);
  return [...group.querySelectorAll('[role="radio"]')];
}
test.after(async () => { await React.act(async () => reactRoot.unmount()); Module._load = originalLoad; dom.window.close(); });

test('Space checks the focused export purpose without exporting or losing focus', async () => {
  await start(); checkedPurpose('家庭成長版');
  for (const label of ['就診溝通版', '照護交接版', '入園認識版']) {
    const target = byLabel(label), down = await key(target, ' ');
    checkedPurpose(label);
    assert.equal(document.activeElement, target);
    assert.equal(down.defaultPrevented, true, 'Space cannot scroll the export dialog');
    assert.equal(calls.length, 0, 'Purpose selection alone cannot request a PDF');
  }
  await key(byLabel('家庭成長版'), 'Spacebar'); checkedPurpose('家庭成長版');
});

test('Space on the checked purpose and repeated Space preserve the current export feedback and intent', async () => {
  await start(); const first = await submit();
  const pending = status().textContent;
  await key(byLabel('家庭成長版'), ' ');
  assert.equal(first.isCurrent(), true); assert.equal(status().textContent, pending);
  await key(byLabel('就診溝通版'), ' ', true);
  checkedPurpose('家庭成長版'); assert.equal(first.isCurrent(), true);
  await React.act(async () => first.resolve({ state: 'error', message: failure }));
  await key(byLabel('家庭成長版'), ' ');
  assert.equal(status().textContent, failure); assert.equal(calls.length, 1);
});

test('export purpose arrows wrap selection and focus with one Tab entry while Enter and pointer still work', async () => {
  await start();
  for (const [from, value, to] of [
    ['家庭成長版', 'ArrowLeft', '入園認識版'],
    ['入園認識版', 'ArrowRight', '家庭成長版'],
    ['家庭成長版', 'ArrowDown', '就診溝通版'],
    ['就診溝通版', 'ArrowUp', '家庭成長版'],
  ]) {
    const down = await key(byLabel(from), value), radios = checkedPurpose(to);
    assert.equal(down.defaultPrevented, true);
    assert.equal(document.activeElement, byLabel(to));
    assert.deepEqual(radios.filter(radio => radio.tabIndex === 0).map(radio => radio.getAttribute('aria-label')), [to]);
    assert.ok(radios.filter(radio => radio.getAttribute('aria-label') !== to).every(radio => radio.tabIndex === -1));
  }
  await key(byLabel('照護交接版'), 'Enter'); checkedPurpose('照護交接版');
  await click(byLabel('就診溝通版')); checkedPurpose('就診溝通版');
  const tab = await key(byLabel('就診溝通版'), 'Tab');
  assert.equal(tab.defaultPrevented, false, 'Tab remains browser-owned');
  assert.equal(calls.length, 0);
});

test('changing purpose with Space invalidates pending export and rejects late feedback without another download', async () => {
  await start(); const first = await submit();
  await key(byLabel('照護交接版'), ' '); checkedPurpose('照護交接版');
  assert.equal(first.isCurrent(), false); assert.equal(status().textContent, '');
  await React.act(async () => first.resolve({ state: 'error', message: failure }));
  assert.equal(status().textContent, ''); assert.equal(calls.length, 1);
  await click(byLabel('下載這個版本的 PDF'));
  assert.equal(calls.length, 2); assert.equal(calls[1].request.purpose, 'care_handoff');
  await React.act(async () => calls[1].resolve({ state: 'error', message: failure }));
});

test('failed export announces inside the real modal, preserves modal focus and permits an explicit retry', async () => {
  await start(); const first = await submit();
  await React.act(async () => first.resolve({ state: 'error', message: failure }));
  assert.ok(status(), 'The still-open export modal must own its failure feedback');
  assert.equal(status().textContent, failure);
  assert.equal(status().getAttribute('aria-live'), 'assertive');
  assert.ok(dialog().contains(document.activeElement), 'Failure focus remains inside the modal');
  await click(byLabel('下載這個版本的 PDF'));
  assert.equal(calls.length, 2); assert.ok(!status().textContent.includes(failure));
  await React.act(async () => calls[1].resolve({ state: 'ready', message: '已交給瀏覽器下載。' }));
  assert.equal(status().textContent, '已交給瀏覽器下載。');
  assert.equal(status().getAttribute('aria-live'), 'polite');
});

test('pending export stays single-flight and settling does not steal focus from the close button', async () => {
  await start(); const first = await submit();
  assert.ok(dialog().contains(document.activeElement));
  await click(byLabel('正在準備 PDF…')); assert.equal(calls.length, 1);
  await React.act(async () => byLabel('關閉').focus()); const focused = document.activeElement;
  await React.act(async () => first.resolve({ state: 'error', message: failure }));
  assert.equal(document.activeElement, focused);
});

test('close and reopen reject the previous request and its late failure', async () => {
  await start(); const first = await submit(); await click(byLabel('關閉'));
  assert.equal(first.isCurrent(), false); await click(byLabel('導出報告'));
  await React.act(async () => first.resolve({ state: 'error', message: failure }));
  assert.equal(status().textContent, '');
});

test('changing export version or purpose clears errors and permanently invalidates the old attempt', async () => {
  await start(); const first = await submit();
  await React.act(async () => { const select = byLabel('報告期間'); select.value = 'report-b:2'; select.dispatchEvent(new window.Event('change', { bubbles: true })); });
  assert.equal(first.isCurrent(), false);
  await React.act(async () => first.resolve({ state: 'error', message: failure }));
  assert.equal(status().textContent, '');
  await click(byLabel('下載這個版本的 PDF')); assert.equal(calls[1].request.snapshotId, 'report-b');
  await React.act(async () => calls[1].resolve({ state: 'error', message: failure }));
  await click(byLabel('就診溝通版')); assert.equal(status().textContent, '');
});

test('newer navigation, child, authority and snapshot replacement reject pending feedback', async () => {
  for (const change of ['navigation', 'child', 'authority', 'snapshot']) {
    await start(); const first = await submit();
    await React.act(async () => {
      if (change === 'navigation') active = false;
      if (change === 'child') { value = { ...value, scopeKey: 'synthetic:child-b', childId: 'child-b' }; }
      if (change === 'authority') { value = { ...value, page: { ...value.page, authorityVersion: 'auth:2' } }; }
      if (change === 'snapshot') { const archive = value.page.archive; value = { ...value, page: { ...value.page, archive: { ...archive, snapshot: { ...archive.snapshot, version: 3 } } } }; }
      render();
    });
    assert.equal(first.isCurrent(), false, change);
    await React.act(async () => first.resolve({ state: 'error', message: failure }));
    assert.ok(!dialog(), change + ' closes the stale modal');
  }
});

test('unmount invalidates the attempt and rejected adapters never manufacture success', async () => {
  await start(); const first = await submit();
  await React.act(async () => reactRoot.render(null)); assert.equal(first.isCurrent(), false);
  await React.act(async () => first.resolve({ state: 'ready', message: 'Old handoff' }));
  await start(); const second = await submit();
  await React.act(async () => second.reject(new Error('Synthetic rejected adapter')));
  assert.equal(status().textContent, failure); assert.equal(status().getAttribute('aria-live'), 'assertive');
});
