import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const source = readFileSync(new URL('../src/screens/chatScreen.tsx', import.meta.url), 'utf8');
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
const flatten = value => Array.isArray(value) ? Object.assign({}, ...value.filter(Boolean).map(flatten)) : value || {};
// Execute the actual ChatPage state/layout callbacks, without pretending that a
// synthetic JSX tree computes CSS or exercises a browser's scroll/zoom behavior.
function pageHarness(width = 320, height = 600) {
  const slots = []; let cursor = 0;
  const state = {
    scopeKey: 'parent:child-a', model: { children: [], selectedChildId: null }, actions: {},
    chatState: { messages: [], drafts: {}, busy: null }, chatController: {}, chatDraft: '',
    agentAttachments: [], agentModel: { readState: 'idle' }, agentPending: { state: 'idle' },
    voiceUpload: {}, fileUpload: {}, photoUpload: {}, authorization: {},
  };
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial;
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
    useRef: value => ({ current: value }), useEffect() {}, useLayoutEffect() {},
  };
  const imports = {
    react, 'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { View: 'View', Pressable: 'Pressable', Platform: { OS: 'web' }, StyleSheet: { create: value => value, flatten }, useWindowDimensions: () => ({ width, height }) },
    'react-native-paper': { Text: 'Text' },
    'expo-router': { usePathname: () => '/chat', useRouter: () => ({}) },
    '../production/ProductionProvider': { useProduction: () => state },
    '../components/appearance/BackgroundSurface': { BackgroundSurface: 'BackgroundSurface', useCustomBackground: () => false },
    '../preview/PreviewNavigationGuard': { usePreviewNavigation: () => () => {}, usePreviewLeaveGuard() {} },
    '../theme': { colors: {}, mobileLayout: { breakpoint: 650 } },
    '../components/chat/chat-presentation': { chatColors: {}, chatLayout: {}, chatType: {} },
  };
  const module = { exports: {} };
  const code = ts.transpileModule(source + '\nexport { styles, ChatContents };', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('require', 'module', 'exports', code)(name => imports[name] ?? new Proxy({}, { get: (_target, key) => String(key) }), module, module.exports);
  let tree;
  const render = () => { cursor = 0; tree = module.exports.default(); return tree; };
  const byId = id => nodes(tree).find(node => node.props.testID === id);
  const contents = () => nodes(tree).find(node => node.type === module.exports.ChatContents);
  return { render, byId, contents, state, styles: module.exports.styles,
    measure(available, toolbar, composer) {
      render(); byId('chat-workspace-scroll').props.onLayout({ nativeEvent: { layout: { height: available } } });
      contents().props.onToolbarLayout({ nativeEvent: { layout: { height: toolbar } } });
      contents().props.onComposerLayout({ nativeEvent: { layout: { height: composer } } }); return render();
    },
    resize(nextWidth, nextHeight) { width = nextWidth; height = nextHeight; return render(); },
    renderContents(props) { cursor = 20; return module.exports.ChatContents(props); },
  };
}

test('the actual page has a finite measured height at desktop, narrow, short and zoom-equivalent layout sizes', () => {
  for (const [width, height, available, toolbar, composer] of [
    [320, 600, 468, 142, 103], [390, 600, 468, 142, 103],
    [1024, 768, 610, 92, 90], [1440, 900, 742, 92, 90],
    [320, 360, 228, 142, 103], [160, 300, 168, 230, 250],
  ]) {
    const h = pageHarness(width, height); h.measure(available, toolbar, composer);
    const page = flatten(h.byId('chat-page-layout').props.style), s = h.styles;
    assert.equal(page.flexShrink, 0); assert.equal(page.flex, undefined);
    assert.equal(page.minHeight, undefined); assert.ok(Number.isFinite(page.height));
    assert.equal(s.readingPanel.minHeight, 0); assert.equal(s.readingPanel.flex, 1);
    const fixed = toolbar + composer + page.padding * 2 + s.readingPanel.borderWidth * 2;
    assert.equal(page.height, Math.max(available, fixed + s.timelineFrame.minHeight));
    assert.ok(page.height - fixed >= 120);
    if (available >= fixed + 120) assert.equal(page.height, available, 'normal viewport needs no extra workspace scroll');
    else assert.equal(page.height, fixed + 120, 'short height grows only enough to reach controls and retain reading');
    assert.equal(s.composerFrame.flexShrink, 0);
  }
});

test('long history cannot enlarge the page; composer expansion and viewport changes preserve the keyed subtree', () => {
  const h = pageHarness(); h.measure(468, 142, 103);
  const before = h.contents(), initial = flatten(h.byId('chat-page-layout').props.style).height;
  for (const count of [6, 12, 18, 200]) {
    h.state.chatState.messages = Array.from({ length: count }, (_, index) => ({ id: String(index), text: '照顧記錄'.repeat(200) })); h.render();
    assert.equal(flatten(h.byId('chat-page-layout').props.style).height, initial);
    assert.equal(h.contents().type, before.type); assert.equal(h.contents().key, before.key);
  }
  h.resize(1440, 900); h.measure(742, 92, 320);
  assert.equal(flatten(h.byId('chat-page-layout').props.style).height, 742);
  h.resize(320, 360); h.measure(228, 142, 320);
  assert.equal(flatten(h.byId('chat-page-layout').props.style).height, 616);
  assert.equal(h.contents().type, before.type); assert.equal(h.contents().key, before.key);
  h.state.scopeKey = 'parent:child-b'; h.render(); assert.notEqual(h.contents().key, before.key);
});

test('actual toolbar and composer frames supply layout measurements while timeline and business bindings remain original', () => {
  const h = pageHarness(); h.render(); const props = h.contents().props;
  const all = nodes(h.renderContents(props));
  assert.equal(all.find(node => node.props.testID === 'chat-top-toolbar').props.onLayout, props.onToolbarLayout);
  assert.equal(all.find(node => node.props.testID === 'chat-composer-frame').props.onLayout, props.onComposerLayout);
  const timeline = all.find(node => node.type === 'ChatTimeline');
  assert.equal(timeline.props.recentLimit, 6); assert.equal(timeline.props.presentation, 'conversation');
  assert.equal(all.filter(node => node.type === 'AgentComposer').length, 1);
  assert.equal(all.find(node => node.props.testID === 'chat-reading-panel').props.onLayout, props.onPaneLayout);
  assert.doesNotMatch(source, /getBoundingClientRect|scrollToEnd\(|scrollTo\(/, 'layout does not replace the original scroll/anchor owner');
});
