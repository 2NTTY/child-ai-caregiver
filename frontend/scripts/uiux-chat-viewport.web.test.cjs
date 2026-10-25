const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..'), req = createRequire(path.join(root, 'package.json'));
if (!process.env.JSDOM_MODULE) throw new Error('Supply an existing test-only JSDOM_MODULE.');
const { JSDOM } = require(process.env.JSDOM_MODULE);
const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true, url: 'https://synthetic.invalid/chat' });
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'ShadowRoot', 'MutationObserver', 'getComputedStyle']) global[key] = dom.window[key];
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
global.IS_REACT_ACT_ENVIRONMENT = true;
global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window); global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
let fetches = 0; global.fetch = () => { fetches++; throw new Error('Network forbidden'); };
const React = req('react'), { createRoot } = req('react-dom/client'), rn = req('react-native-web'), ts = req('typescript');
const cache = new Map();
function load(file) {
  const absolute = path.resolve(root, file); if (cache.has(absolute)) return cache.get(absolute).exports;
  const source = fs.readFileSync(absolute, 'utf8'), mod = { exports: {} }; cache.set(absolute, mod);
  const out = ts.transpileModule(source, { fileName: absolute, compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function('require', 'module', 'exports', out)(name => {
    if (name === 'react-native') return rn;
    if (name === 'react-native-paper') return { Text: rn.Text, MD3LightTheme: { colors: {}, fonts: {} }, configureFonts: x => x };
    if (name.endsWith('/AppScrollView')) return { AppScrollView: rn.ScrollView };
    if (name.endsWith('/AppIcon')) return { AppIcon: () => null };
    if (name.endsWith('/ui')) return { AppButton: ({ label, onPress }) => React.createElement(rn.Pressable, { onPress }, React.createElement(rn.Text, null, label)) };
    if (name.endsWith('/motion')) return { MotionEntrance: ({ children }) => React.createElement(rn.View, null, children) };
    if (name.endsWith('/ChatMessage')) return { ChatProgressIndicator: () => null };
    if (name.endsWith('/useInteractionDensity')) return { useInteractionDensity: () => false };
    if (!name.startsWith('.')) return req(name);
    const target = path.resolve(path.dirname(absolute), name);
    const resolved = ['.web.tsx', '.web.ts', '.tsx', '.ts'].map(suffix => target + suffix).find(fs.existsSync);
    return load(resolved ?? target);
  }, mod, mod.exports); return mod.exports;
}
const { ChatViewport, ChatTimelineFrame, chatViewportLayout } = load('src/components/chat/ChatViewport.tsx');
const { ChatTimeline } = load('src/components/chat/ChatTimeline.tsx');
const { ChatComposerInput } = load('src/components/agent/ChatComposerInput.web.tsx');
const app = createRoot(document.getElementById('root'));
const messages = Array.from({ length: 6 }, (_, i) => ({ id: `synthetic-${i}`, text: `Synthetic message ${i}` }));
const controls = React.createRef();
let mounts = 0, unmounts = 0, olderReads = 0, sends = 0;
function Workspace({ layout }) {
  const [draft, setDraft] = React.useState('A preserved synthetic draft');
  React.useEffect(() => { mounts++; return () => unmounts++; }, []);
  return React.createElement(ChatViewport, { layout },
    React.createElement(rn.Text, null, 'Same activity controls'),
    React.createElement(ChatTimelineFrame, { layout }, React.createElement(ChatTimeline, {
      items: messages, recentLimit: 6, presentation: 'conversation', controlsRef: controls, renderItem: m => React.createElement(rn.Text, null, m.text),
      history: { cursor: 'older-page', loading: false, enabled: true, load: async () => { olderReads++; } },
    })),
    React.createElement(ChatComposerInput, { value: draft, onChangeText: setDraft, onSubmit: () => sends++, onFocus() {}, onBlur() {}, disabled: false }),
    React.createElement(rn.Text, { accessibilityRole: 'alert' }, 'Original recovery remains after input'));
}
const render = async height => React.act(async () => app.render(React.createElement(Workspace, { layout: chatViewportLayout('web', height) })));
test('short-height reflow uses a stable real timeline and textarea, without replacing reading state or taking focus', async () => {
  await render(757);
  const outer = document.querySelector('[data-testid="chat-page-layout"]'), frame = document.querySelector('[data-testid="chat-timeline-frame"]');
  const timeline = document.querySelector('[data-testid="chat-timeline-scroll"]'), input = document.querySelector('textarea');
  const entries = [...document.querySelectorAll('[data-testid="chat-timeline-entry"]')];
  // jsdom has no layout engine: this offset is an explicit state port, not a
  // claim that any actual pixels/scroll chaining/prepend geometry were tested.
  // The public reading-intent operation is the real timeline's, not a fake
  // follow flag. Native wheel/scrollbar chaining is reserved for browser QA.
  controls.current.holdReadingPosition(); timeline.scrollTop = 123; await React.act(async () => input.focus());
  for (const height of [378, 599, 600, 757, 378]) {
    await render(height); const short = height < 600;
    assert.equal(document.querySelector('[data-testid="chat-page-layout"]'), outer);
    assert.equal(document.querySelector('[data-testid="chat-timeline-scroll"]'), timeline);
    assert.deepEqual([...document.querySelectorAll('[data-testid="chat-timeline-entry"]')], entries);
    assert.equal(document.querySelector('textarea'), input); assert.equal(input.value, 'A preserved synthetic draft'); assert.equal(document.activeElement, input);
    assert.equal(timeline.scrollTop, 123); assert.equal(outer.getAttribute('tabindex'), short ? '0' : null);
    assert.equal(outer.getAttribute('aria-label'), '對話工作區');
    if (short) { assert.equal(getComputedStyle(outer).overflowY, 'scroll'); assert.equal(getComputedStyle(frame).height, '260px'); assert.equal(getComputedStyle(frame).flexShrink, '0'); }
    assert.ok(document.querySelector('[role="alert"]')); assert.equal(olderReads, 0); assert.equal(sends, 0);
  }
  assert.equal(mounts, 1); assert.equal(unmounts, 0); assert.equal(fetches, 0);
});
test('height mode is web-only and production keeps the same scoped owner plus explicit composer flow placement', () => {
  for (const platform of ['ios', 'android']) for (const height of [320, 378, 757]) assert.equal(chatViewportLayout(platform, height), 'bounded');
  const screen = fs.readFileSync(path.join(root, 'src/screens/chatScreen.tsx'), 'utf8');
  assert.match(screen, /<ChatContents key=\{scopeKey \?\? "no-authorized-child"\}/);
  assert.match(screen, /<ChatTimelineFrame layout=\{viewportLayout\}>/);
  assert.match(screen, /placement=\{viewportLayout === "reflow" \? "flow" : "overlap"\}/);
  assert.match(screen, /footer=\{feedback\} scrollRef=\{scrollRef\} controlsRef=\{timelineRef\}/);
  const composer = fs.readFileSync(path.join(root, 'src/components/agent/AgentComposer.tsx'), 'utf8');
  assert.match(composer, /flowComposer: \{ marginTop: 0 \}/);
  assert.match(composer, /placement === "flow" && styles.flowComposer/);
});
test.after(async () => { await React.act(async () => app.unmount()); dom.window.close(); });
