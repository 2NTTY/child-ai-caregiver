const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
if (!process.env.JSDOM_MODULE) throw new Error('Supply JSDOM_MODULE for an existing jsdom installation.');
const { JSDOM } = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<!doctype html><html><body><main id="root"></main><button id="other">Other action</button></body></html>', { pretendToBeVisual: true, url: 'http://localhost/' });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'ShadowRoot', 'MutationObserver', 'getComputedStyle']) global[key] = dom.window[key];
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.IS_REACT_ACT_ENVIRONMENT = true;
global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
global.ResizeObserver = window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
const root = path.resolve(__dirname, '..'), req = createRequire(path.join(root, 'package.json'));
const React = req('react'), { createRoot } = req('react-dom/client'), ts = req('typescript'), rn = req('react-native-web');
const empty = () => null, passthrough = ({ children }) => children;
const paper = { Text: rn.Text, Portal: passthrough, MD3LightTheme: { colors: {}, fonts: {} }, configureFonts: value => value };
const dialog = Object.assign(empty, { Title: passthrough, Content: passthrough, Actions: passthrough });
function evaluate(file, imports) {
  const output = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(name => name === 'react-native' ? rn : name === 'react-native-paper' ? paper : name.startsWith('.') ? imports(name) : req(name), module, module.exports);
  return module.exports;
}
const theme = evaluate('src/theme.ts', name => { throw new Error(name); });
const presentation = evaluate('src/components/chat/chat-presentation.ts', () => theme);
const inputModule = evaluate('src/components/agent/ChatComposerInput.web.tsx', () => presentation);
const icon = { AppIcon: () => React.createElement('span', { 'aria-hidden': true }, 'icon') };
const toolbar = evaluate('src/components/agent/AgentInputToolbar.tsx', name => name.endsWith('/AppIcon') ? icon : name.endsWith('/chat-presentation') ? presentation : { PhotoFilePicker: ({ renderTrigger, disabled }) => renderTrigger({ disabled, reading: false, onPress() {} }) });
const { AgentComposer } = evaluate('src/components/agent/AgentComposer.tsx', name => {
  if (name.endsWith('/theme')) return theme;
  if (name.endsWith('/chat-presentation')) return presentation;
  if (name.endsWith('/ChatComposerInput')) return inputModule;
  if (name.endsWith('/AgentInputToolbar')) return toolbar;
  if (name.endsWith('/AppIcon')) return icon;
  if (name.endsWith('/AppDialog')) return { AppDialog: dialog };
  if (name.endsWith('/AppScrollView')) return { AppScrollView: rn.ScrollView };
  if (name.endsWith('/useInteractionDensity')) return { useInteractionDensity: () => false };
  if (name.endsWith('/assistant-draft')) return { canPreviewAssistantDraft: ({ text }) => !!text.trim(), photoAttachment: value => value };
  if (name.endsWith('/motion')) return { MotionDisclosure: ({ expanded, children }) => expanded ? children : null };
  return new Proxy({}, { get: () => empty });
});
const renderer = createRoot(document.getElementById('root'));
const focusCalls = [], originalFocus = window.HTMLTextAreaElement.prototype.focus;
window.HTMLTextAreaElement.prototype.focus = function(options) { focusCalls.push(options); return originalFocus.call(this, options); };
let serial = 0, networkCalls = 0;
global.fetch = () => { networkCalls++; throw new Error('Network forbidden'); };
function ComposerOwner({ scenario }) {
  const [enabled, setEnabled] = React.useState(true), [draft, setDraft] = React.useState('合成送出'), [focusRequest, setFocusRequest] = React.useState(0);
  scenario.controls = { setEnabled, setDraft, setFocusRequest };
  return React.createElement(AgentComposer, { enabled, compact: true, draft, focusRequest, attachments: [], suggestionsAvailable: false,
    onChangeDraft: setDraft, onPreview() { scenario.submissions++; setEnabled(false); return scenario.promise; }, onSources() {}, onAddAttachment() { return false; }, onRemoveAttachment() {} });
}
async function scenario() {
  let resolve; const value = { submissions: 0, promise: new Promise(done => { resolve = done; }), resolve: () => resolve(), key: ++serial };
  await React.act(async () => renderer.render(React.createElement(ComposerOwner, { scenario: value, key: value.key })));
  focusCalls.length = 0; return value;
}
const input = () => document.querySelector('textarea');
const send = () => document.querySelector('[aria-label="預覽輸入"]');
async function start(s, source = 'input') {
  const node = source === 'input' ? input() : send();
  await React.act(async () => { node.focus(); }); focusCalls.length = 0;
  await React.act(async () => {
    node.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    node.dispatchEvent(new window.KeyboardEvent('keyup', { key: 'Enter', bubbles: true, cancelable: true }));
    // JSDOM lacks the browser's default keyboard click for native buttons.
    if (source === 'send' && node.tagName === 'BUTTON') node.dispatchEvent(new window.MouseEvent('click', { detail: 0, bubbles: true }));
  });
  assert.equal(s.submissions, 1); assert.equal(input().disabled, true);
  // JSDOM does not implement disabled-element blur; explicitly provide that browser transition.
  await React.act(async () => { document.body.tabIndex = -1; document.body.focus(); document.body.removeAttribute('tabindex'); });
  assert.equal(document.activeElement === document.body, true, 'disabled-element blur port must move focus to BODY');
}
async function finish(s, enabled = true) {
  await React.act(async () => { s.controls.setEnabled(enabled); if (enabled) s.controls.setDraft(''); s.resolve(); await s.promise; });
}

test('keyboard textarea/send activation returns focus once after the real submit promise settles', async () => {
  for (const source of ['input', 'send']) {
    const s = await scenario(); const original = input(); await start(s, source); await finish(s);
    assert.equal(document.activeElement === original, true); assert.deepEqual(focusCalls, [{ preventScroll: true }]);
    await React.act(async () => s.controls.setDraft('Next draft'));
    await React.act(async () => { s.controls.setEnabled(false); }); await React.act(async () => s.controls.setEnabled(true));
    assert.deepEqual(focusCalls, [{ preventScroll: true }], 'later busy/render transitions cannot replay the ticket');
  }
});

test('reading, blank pointer, keyboard navigation and another control cancel the return', async () => {
  for (const intent of ['wheel', 'touchmove', 'pointerdown', 'Tab', 'other-focus', 'window-blur']) {
    const s = await scenario(); await start(s);
    await React.act(async () => {
      if (intent === 'other-focus') document.getElementById('other').focus();
      else if (intent === 'Tab') document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      else if (intent === 'window-blur') window.dispatchEvent(new window.Event('blur'));
      else document.body.dispatchEvent(new window.Event(intent, { bubbles: true }));
    });
    await finish(s); assert.deepEqual(focusCalls, [], intent);
    if (intent === 'other-focus') assert.equal(document.activeElement === document.getElementById('other'), true);
  }
});

test('unknown, hidden document and old scope cannot restore later', async () => {
  let s = await scenario(); await start(s); await finish(s, false);
  await React.act(async () => s.controls.setEnabled(true)); assert.deepEqual(focusCalls, []);
  s = await scenario(); await start(s);
  Object.defineProperty(document, 'hidden', { configurable: true, value: true });
  document.dispatchEvent(new window.Event('visibilitychange'));
  Object.defineProperty(document, 'hidden', { configurable: true, value: false });
  await finish(s); assert.deepEqual(focusCalls, []);
  s = await scenario(); await start(s); await scenario();
  await React.act(async () => { s.resolve(); await s.promise; }); assert.deepEqual(focusCalls, []);
});

test('pointer send never arms focus and a newer explicit request takes precedence', async () => {
  let s = await scenario(); await React.act(async () => { send().focus(); send().dispatchEvent(new window.MouseEvent('click', { detail: 1, bubbles: true })); });
  assert.equal(s.submissions, 1); await React.act(async () => send().blur()); await finish(s); assert.deepEqual(focusCalls, []);
  s = await scenario(); await start(s); await React.act(async () => s.controls.setFocusRequest(1)); await finish(s);
  await React.act(async () => new Promise(resolve => setTimeout(resolve, 40)));
  assert.deepEqual(focusCalls, [undefined], 'only the newer explicit request focuses, without a submit-ticket call');
  assert.equal(networkCalls, 0);
});
test.after(async () => { await React.act(async () => renderer.unmount()); window.HTMLTextAreaElement.prototype.focus = originalFocus; dom.window.close(); });
