const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for an existing jsdom installation.');
const { JSDOM } = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<!doctype html><html><body><main id="root"></main><button id="other">Other action</button></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node']) global[key] = dom.window[key];
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.IS_REACT_ACT_ENVIRONMENT = true;
const observers = [];
global.ResizeObserver = class { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} disconnect() {} };
const root = path.resolve(__dirname, '..'), req = createRequire(path.join(root, 'package.json'));
const React = req('react'), { createRoot } = req('react-dom/client'), ts = req('typescript');
function load(file, imports) {
  const output = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(name => name.startsWith('.') ? imports(name) : name === 'react-native' ? { Platform: { select: value => value.web ?? value.default } } : name === 'react-native-paper' ? { MD3LightTheme: { colors: {}, fonts: {} }, configureFonts: value => value } : req(name), module, module.exports);
  return module.exports;
}
const theme = load('src/theme.ts', () => { throw new Error('Unexpected theme import'); });
const presentation = load('src/components/chat/chat-presentation.ts', () => theme);
const { ChatComposerInput } = load('src/components/agent/ChatComposerInput.web.tsx', () => presentation);
const renderer = createRoot(document.getElementById('root'));
let value = 'Synthetic draft', disabled = false, canSubmit = true, submitted = 0;
const render = async () => { await React.act(async () => renderer.render(React.createElement(ChatComposerInput, { value, disabled, canSubmit, onChangeText: next => { value = next; }, onSubmit: () => submitted++, onFocus() {}, onBlur() {} }))); };
const input = () => document.querySelector('textarea');
async function key(options = {}) {
  const event = new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter', ...options });
  await React.act(async () => input().dispatchEvent(event)); return event;
}

test('Enter sends once; Shift+Enter, composition and disabled states never send', async () => {
  await render(); input().focus();
  assert.equal((await key()).defaultPrevented, true); assert.equal(submitted, 1);
  assert.equal((await key({ shiftKey: true })).defaultPrevented, false); assert.equal(submitted, 1);
  await React.act(async () => input().dispatchEvent(new window.CompositionEvent('compositionstart', { bubbles: true })));
  assert.equal((await key()).defaultPrevented, false); assert.equal(submitted, 1);
  await React.act(async () => input().dispatchEvent(new window.CompositionEvent('compositionend', { bubbles: true })));
  assert.equal((await key({ isComposing: true })).defaultPrevented, false);
  assert.equal((await key({ keyCode: 229 })).defaultPrevented, false); assert.equal(submitted, 1);
  canSubmit = false; await render(); await key(); assert.equal(submitted, 1);
  canSubmit = true; disabled = true; await render(); await key(); assert.equal(submitted, 1);
  disabled = false; await render(); await key(); assert.equal(submitted, 2);
});

test('autosize retains the same textarea, clamps and shrinks synchronously without taking unrelated focus', async () => {
  await render(); const original = input(); let measuredHeight = 48, measuredWidth = 288;
  // JSDOM has no layout engine: these are explicit measurement ports, not pixel QA.
  Object.defineProperty(original, 'scrollHeight', { configurable: true, get: () => measuredHeight });
  Object.defineProperty(original, 'clientWidth', { configurable: true, get: () => measuredWidth });
  original.scrollTop = 12;
  for (const [height, expected, overflow] of [[96, 96, 'hidden'], [240, 168, 'auto'], [36, 48, 'hidden']]) {
    measuredHeight = height; value += '\nSynthetic line'; await render();
    assert.equal(input(), original); assert.equal(original.style.height, `${expected}px`);
    assert.equal(original.style.overflowY, overflow); assert.equal(original.scrollTop, 12);
  }
  document.getElementById('other').focus();
  for (const width of [320, 390, 1024, 1440]) {
    measuredWidth = Math.min(width, presentation.chatLayout.maxWidth) - (width < 600 ? 32 : 48) - 18;
    measuredHeight = 72; observers.at(-1).callback();
    assert.equal(original.style.height, '72px'); assert.equal(input(), original);
    assert.equal(document.activeElement, document.getElementById('other'));
  }
});
test.after(async () => { await React.act(async () => renderer.unmount()); dom.window.close(); });
