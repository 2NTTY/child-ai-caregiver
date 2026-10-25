const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..'), req = createRequire(path.join(root, 'package.json'));
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for an existing test-only jsdom installation.');
const { JSDOM } = require(process.env.JSDOM_MODULE), React = req('react'), { createRoot } = req('react-dom/client'), ts = req('typescript');
const dom = new JSDOM('<div id="root"></div>', { url: 'https://synthetic.invalid/' });
Object.assign(global, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
let fetchCount = 0;
global.fetch = () => { fetchCount++; throw new Error('External network is forbidden'); };
function View({ children, testID, dataSet, accessibilityRole, accessibilityLabel, accessibilityState, nativeID, ref, ...props }) {
  const p = { ref, id: nativeID, role: accessibilityRole, 'aria-label': accessibilityLabel, 'data-testid': testID };
  for (const key of ['inert', 'tabIndex', 'onKeyDown', 'aria-busy', 'aria-hidden', 'aria-selected', 'aria-controls', 'aria-orientation']) if (props[key] !== undefined) p[key] = props[key];
  for (const [key, value] of Object.entries(dataSet ?? {})) p['data-' + key.replace(/[A-Z]/g, x => '-' + x.toLowerCase())] = value;
  return React.createElement('div', p, children);
}
function Pressable({ onPress, ...props }) {
  const element = View(props);
  return React.createElement('button', { ...element.props, type: 'button', onClick: onPress }, props.children);
}
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const module = { exports: {} }, source = fs.readFileSync(path.join(root, file), 'utf8');
  const out = ts.transpileModule(source, { fileName: file, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', out)(name => {
    if (name === 'react-native') return { View, Pressable, Platform: { OS: 'web' }, StyleSheet: { create: x => x } };
    if (name === 'react-native-paper') return { Text: ({ children }) => React.createElement('span', {}, children) };
    if (name.endsWith('/theme')) return { colors: {}, spacing: { sm: 8, lg: 24 }, radius: {} };
    if (name === './imageReadiness') return load('src/startup/imageReadiness.ts');
    return req(name);
  }, module, module.exports);
  cache.set(file, module.exports); return module.exports;
}
const { FirstScreenGate, useFirstScreenImage } = load('src/startup/FirstScreenGate.tsx');
const { WorkspaceSwitch } = load('src/components/workspace/WorkspaceSwitch.tsx');
const app = createRoot(document.getElementById('root'));
const render = async element => { await React.act(async () => app.render(null)); await React.act(async () => app.render(element)); };
const state = () => document.querySelector('[data-startup-state]')?.dataset.startupState;
const gate = (props = {}, child = 'Synthetic workspace') => React.createElement(FirstScreenGate, { pathname: '/', width: 1440, launch: 'Loading', dataState: 'ready', ...props }, child);

test('ready home renders without waiting for removed decorative artwork', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try { await render(gate()); assert.equal(state(), 'ready'); assert.equal(document.querySelector('[inert]'), null); assert.equal(document.querySelector('[data-testid="frontend-startup-loading"]'), null); }
  finally { await render(null); t.mock.timers.reset(); }
});
test('home data loading still blocks after the former artwork fallback budget', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try { await render(gate({ dataState: 'loading' })); await React.act(async () => t.mock.timers.tick(15000)); assert.equal(state(), 'loading'); assert.ok(document.querySelector('[inert]')); }
  finally { await render(null); t.mock.timers.reset(); }
});
test('desktop login still awaits its actual image; narrow login has no invisible-image dependency', async () => {
  function LoginArtwork() { const image = useFirstScreenImage('login-hero'); return React.createElement('button', { onClick: image.onLoad }, 'Settle synthetic login image'); }
  await render(gate({ pathname: '/login' }, React.createElement(LoginArtwork)));
  assert.equal(state(), 'loading');
  await React.act(async () => document.querySelector('button').click()); assert.equal(state(), 'ready');
  await render(gate({ pathname: '/login', width: 390 })); assert.equal(state(), 'ready');
});
test('task switch supports manual keyboard activation without bypassing caller guards', async () => {
  let accept = false; const requests = [];
  function Harness() { const [value, setValue] = React.useState('current'); return React.createElement(WorkspaceSwitch, {
    id: 'workspace-test', label: 'Synthetic choices', items: [{ key: 'current', label: 'Current', description: 'Read current data' }, { key: 'history', label: 'History', description: 'Read older data', count: '2+' }], value,
    onChange: next => { requests.push(next); if (accept) setValue(next); },
  }); }
  await render(React.createElement(Harness));
  const [current, history] = document.querySelectorAll('[role="tab"]');
  assert.equal(current.tabIndex, 0); assert.equal(history.tabIndex, -1); current.focus();
  await React.act(async () => current.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
  assert.equal(document.activeElement, history); assert.equal(current.getAttribute('aria-selected'), 'true'); assert.deepEqual(requests, []);
  await React.act(async () => history.click()); assert.deepEqual(requests, ['history']); assert.equal(current.getAttribute('aria-selected'), 'true');
  accept = true; await React.act(async () => history.click()); assert.equal(history.getAttribute('aria-selected'), 'true'); assert.equal(history.tabIndex, 0);
  assert.equal(history.getAttribute('aria-controls'), 'workspace-test-panel-history'); assert.equal(history.getAttribute('aria-label'), 'History 2+');
  await React.act(async () => history.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
  assert.equal(document.activeElement, current); assert.equal(history.getAttribute('aria-selected'), 'true'); assert.equal(fetchCount, 0);
  await render(null);
});
