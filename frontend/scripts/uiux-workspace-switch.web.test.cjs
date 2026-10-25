const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..'), req = createRequire(path.join(root, 'package.json'));
if (!process.env.JSDOM_MODULE) throw new Error('Supply an existing test-only JSDOM_MODULE.');
const { JSDOM } = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true, url: 'https://synthetic.invalid/' });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'ShadowRoot', 'MutationObserver', 'getComputedStyle']) global[key] = dom.window[key];
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.IS_REACT_ACT_ENVIRONMENT = true;
global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window); global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
let fetchCount = 0; global.fetch = () => { fetchCount++; throw new Error('Network forbidden'); };
const React = req('react'), { createRoot } = req('react-dom/client'), rn = req('react-native-web'), ts = req('typescript');
const moduleUnderTest = { exports: {} };
const source = fs.readFileSync(path.join(root, 'src/components/workspace/WorkspaceSwitch.tsx'), 'utf8');
const out = ts.transpileModule(source, { fileName: 'WorkspaceSwitch.tsx', compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
// The actual RN Web 0.21.2 Pressable/PressResponder must participate. Paper text
// uses RN Web Text only; no domain owner or keyboard behavior is substituted.
new Function('require', 'module', 'exports', out)(name => name === 'react-native' ? rn : name === 'react-native-paper' ? { Text: rn.Text } : name.endsWith('/theme') ? { colors: {}, spacing: { sm: 8, lg: 16 }, radius: { small: 8 } } : req(name), moduleUnderTest, moduleUnderTest.exports);
const { WorkspaceSwitch } = moduleUnderTest.exports, app = createRoot(document.getElementById('root'));
const key = async (node, type, value, repeat = false) => {
  const event = new dom.window.KeyboardEvent(type, { key: value, code: value === ' ' ? 'Space' : value, repeat, bubbles: true, cancelable: true });
  await React.act(async () => node.dispatchEvent(event)); return event;
};
test('real RN Web tabs activate Space once on keyup, cancel on blur, and preserve caller authority', async () => {
  const requests = []; let accept = false;
  function Harness() { const [value, setValue] = React.useState('a'); return React.createElement(WorkspaceSwitch, { id: 'switch', label: 'Synthetic tasks', value, items: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }], onChange: next => { requests.push(next); if (accept) setValue(next); } }); }
  await React.act(async () => app.render(React.createElement(Harness)));
  const [a, b] = document.querySelectorAll('[role=tab]'); assert.equal(b.tagName, 'DIV');
  await React.act(async () => a.focus()); await key(a, 'keydown', 'ArrowRight'); assert.equal(document.activeElement, b);
  assert.equal((await key(b, 'keydown', ' ')).defaultPrevented, true); await key(b, 'keydown', ' ', true); assert.deepEqual(requests, []);
  await key(b, 'keyup', ' '); assert.deepEqual(requests, ['b']); assert.equal(a.getAttribute('aria-selected'), 'true', 'Rejected guard cannot select');
  await key(b, 'keyup', ' '); assert.deepEqual(requests, ['b'], 'No second activation without keydown');
  await key(b, 'keydown', ' '); await React.act(async () => a.focus()); await key(b, 'keyup', ' '); assert.deepEqual(requests, ['b'], 'Blur cancels the armed key');
  accept = true; await React.act(async () => b.focus()); await key(b, 'keydown', ' '); await key(b, 'keyup', ' ');
  assert.deepEqual(requests, ['b', 'b']); assert.equal(b.getAttribute('aria-selected'), 'true');
  await key(b, 'keydown', 'Home'); assert.equal(document.activeElement, a); await key(a, 'keydown', 'Enter'); await key(a, 'keyup', 'Enter');
  assert.deepEqual(requests, ['b', 'b', 'a'], 'RN Web Enter remains exactly once'); assert.equal(a.getAttribute('aria-selected'), 'true');
  await React.act(async () => b.click()); assert.deepEqual(requests, ['b', 'b', 'a', 'b'], 'Pointer still uses original onPress');
  assert.equal(fetchCount, 0); await React.act(async () => app.unmount());
});
