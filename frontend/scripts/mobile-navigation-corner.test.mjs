import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const flatten = styles => Object.assign({}, ...[styles].flat(Infinity).filter(Boolean));
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];

// Component/state checks only; actual viewport pixels and browser hit testing
// remain with the separately authorized browser verification owner.
function harness({ pathname = '/', width = 390, enabled = true, platform = 'web' } = {}) {
  let current = [], cursor = 0, pending;
  const frames = new Map(), cache = new Map(), events = [];
  const react = {
    useState(initial) { const index = cursor++, frame = current; frame[index] ??= { value: initial }; return [frame[index].value, value => { frame[index].value = typeof value === 'function' ? value(frame[index].value) : value; }]; },
    useRef: value => ({ current: value }), useEffect() {}, useLayoutEffect() {}, useMemo: callback => callback(),
  };
  const leave = callback => { events.push('guard'); pending = callback; };
  const production = { identityKey: 'parent', scopeKey: enabled ? 'parent:child' : null, notice: null, dismissNotice() {}, model: { caregiverName: 'parent', selectedChildId: enabled ? 'child' : null, children: [{ id: 'child', accessRole: 'owner' }] },
    actions: { openAgentPhoto: () => events.push('photo') }, agentDraftScope: enabled ? 'parent:child' : null,
    agentAttachments: [], chatDraft: '', scenario: 'normal', openAgentDraft: (...args) => events.push(['draft', ...args]), addAgentAttachment: () => true };
  const native = { Platform: { OS: platform, select: values => values[platform] ?? values.default }, View: 'View', Pressable: 'Pressable',
    StyleSheet: { create: value => value, flatten }, useWindowDimensions: () => ({ width }), PanResponder: { create: config => ({ panHandlers: config }) } };
  function load(relative) {
    const filename = path.resolve(root, relative);
    if (cache.has(filename)) return cache.get(filename);
    const code = ts.transpileModule(readFileSync(filename, 'utf8'), { fileName: filename,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const module = { exports: {} };
    new Function('require', 'module', 'exports', code)(name => {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return require(name);
      if (name === 'react-native') return native;
      if (name === 'react-native-paper') return { Text: 'Text', MD3LightTheme: { colors: {}, fonts: {} }, configureFonts: value => value };
      if (name === 'react-native-svg') return { __esModule: true, default: 'Svg', Path: 'Path' };
      if (name === 'expo-router') return { usePathname: () => pathname, useRouter: () => ({ push: target => events.push(['push', target]) }) };
      if (name === 'react-native-safe-area-context') return { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ bottom: 24 }) };
      if (name.endsWith('/useProductionHome')) return { useProductionHome: () => production };
      // PreviewContext is now a compatibility re-export of the same production owner.
      if (name.endsWith('/PreviewContext')) return { usePreview: () => production };
      if (name.endsWith('/PreviewNavigationGuard')) return { usePreviewNavigation: () => leave, PreviewLink: 'PreviewLink' };
      if (name.endsWith('/fixture')) return { scenarioLabels: {} };
      if (name.endsWith('/branding')) return { brand: {} };
      if (/\/(theme|app-navigation|RecordsNavButton|MobileNavSelection|CornerCaptureSurface|quick-input-gesture|pointer-click-gate)$/.test(name)) {
        const target = path.resolve(path.dirname(filename), name);
        return load(existsSync(`${target}.ts`) ? `${target}.ts` : `${target}.tsx`);
      }
      const components = {
        '/AppScrollView': ['AppScrollView'], '/motion': ['MotionDrawerOverlay', 'MotionDrawerRight', 'MotionEntrance', 'MotionScopeBoundary'],
        '/BrandLogo': ['BrandLogo'], '/AppIcon': ['AppIcon'], '/AgentEntryButton': ['AgentEntryButton'],
        '/MobileQuickInputDock': ['MobileQuickInputDock'], '/RightRailContent': ['RightRailContent'],
        '/ChildKeyFacts': ['ChildKeyFacts'], '/ChildPicker': ['ChildPicker'], '/CompactHeaderIdentity': ['CompactHeaderIdentity'],
        '/NotificationBell': ['NotificationBell'], '/ToolbarIconButton': ['ToolbarIconButton'],
        '/PhotoFilePicker': ['PhotoFilePicker'], '/DirectionalPressable': ['DirectionalPressable'],
        '/AssistantInputDialog': ['AssistantInputDialog'],
      };
      const exports = Object.entries(components).find(([suffix]) => name.endsWith(suffix))?.[1];
      assert.ok(exports, `Unmocked navigation dependency: ${name}`);
      return Object.fromEntries(exports.map(component => [component, component]));
    }, module, module.exports);
    cache.set(filename, module.exports); return module.exports;
  }
  function expand(tree, key = 'root') {
    if (!tree || typeof tree !== 'object') return tree;
    if (Array.isArray(tree)) return tree.map((child, index) => expand(child, `${key}.${index}`));
    if (typeof tree.type === 'function') return render(tree.type, tree.props, key);
    return { ...tree, props: { ...tree.props, children: expand(tree.props?.children, `${key}.children`) } };
  }
  function render(component, props = {}, key = 'root') {
    const previous = current, previousCursor = cursor;
    if (!frames.has(key)) frames.set(key, []);
    current = frames.get(key); cursor = 0;
    const tree = component(props); current = previous; cursor = previousCursor;
    return expand(tree, key);
  }
  const shell = () => render(load('src/components/AppShell.tsx').AppShell, { children: 'content' }, 'shell');
  const records = active => render(load('src/components/navigation/RecordsNavButton.tsx').RecordsNavButton, { active, scopeKey: 'parent:child' }, 'records');
  const dock = () => {
    const tree = render(load('src/components/agent/MobileQuickInputDock.tsx').MobileQuickInputDock, {}, 'dock');
    const picker = nodes(tree).find(node => node.type === 'PhotoFilePicker');
    const trigger = expand(picker.props.renderTrigger({ disabled: !enabled, reading: false, onPress: () => events.push('capture') }), 'trigger');
    return { tree, trigger, camera: nodes(trigger).find(node => node.props?.testID === 'mobile-quick-camera') };
  };
  return { load, render, shell, records, dock, events, approve() { const callback = pending; pending = null; callback?.(); } };
}

test('each existing mobile page retains exactly one obvious selected surface after release', () => {
  for (const width of [320, 390]) for (const pathname of ['/', '/chat', '/tasks', '/growth', '/care', '/photos', '/more', '/history']) {
    const h = harness({ pathname, width });
    let nav = nodes(h.shell()).find(node => node.props?.testID === 'mobile-bottom-navigation');
    const all = nodes(nav), indicators = all.filter(node => node.props?.testID === 'mobile-current-page');
    assert.equal(indicators.length, 1, `${width} ${pathname}`);
    assert.equal(flatten(indicators[0].props.style).backgroundColor, '#BAE8E8');
    const marker = nodes(indicators[0]).find(node => flatten(node.props?.style).width === 24);
    assert.equal(flatten(marker.props.style).height, 3);
    assert.equal(indicators[0].props.pointerEvents, 'none');
    const selected = all.find(node => node.props?.['aria-current'] === 'page' || node.props?.current === true);
    assert.ok(selected);
    if (selected.props.onPressIn) {
      selected.props.onPressIn();
      nav = nodes(h.shell()).find(node => node.props?.testID === 'mobile-bottom-navigation');
      const held = nodes(nav).find(node => node.props?.['aria-current'] === 'page');
      assert.equal(nodes(held).filter(node => node.props?.testID === 'mobile-current-page').length, 1);
      held.props.onPressOut();
      nav = nodes(h.shell()).find(node => node.props?.testID === 'mobile-bottom-navigation');
      assert.equal(nodes(nav).filter(node => node.props?.testID === 'mobile-current-page').length, 1);
    }
  }
});

test('desktop keeps its existing selection and mobile overlays are absent', () => {
  for (const width of [1024, 1440]) {
    const tree = harness({ pathname: '/growth', width }).shell(), all = nodes(tree);
    assert.equal(all.some(node => node.props?.testID === 'mobile-bottom-navigation'), false);
    assert.equal(all.some(node => node.props?.testID === 'mobile-current-page'), false);
    const active = all.find(node => node.props?.['aria-current'] === 'page');
    assert.equal(flatten(active.props.style).backgroundColor, '#BAE8E8');
  }
});

test('Records retains guarded tap, upward-drag and keyboard-expand routes with selected semantics', () => {
  const h = harness({ pathname: '/history' });
  const record = h.records(true);
  assert.equal(record.props.selected, true); assert.equal(record.props.current, true);
  record.props.onPress(); assert.deepEqual(h.events, ['guard']);
  h.approve(); assert.deepEqual(h.events, ['guard', ['push', '/care']]);
  record.props.onGestureEnd(0, -80, true); assert.equal(h.events.at(-1), 'guard');
  h.approve(); assert.deepEqual(h.events.at(-1), ['push', '/more']);
  record.props.onExpand(); h.approve(); assert.deepEqual(h.events.at(-1), ['push', '/more']);
  assert.equal(h.records(false).props.current, false);
  const props = { ...record.props, children: 'record' };
  const web = h.render(h.load('src/components/navigation/DirectionalPressable.web.tsx').DirectionalPressable, props, 'web-control');
  assert.equal(web.props['aria-current'], 'page'); assert.equal(web.props.accessibilityState.selected, true);
  const native = h.render(h.load('src/components/navigation/DirectionalPressable.tsx').DirectionalPressable, props, 'native-control');
  assert.equal(native.props.accessibilityState.selected, true);
});

test('corner surface has two tangent menisci and remains decorative outside the original hit area', () => {
  const h = harness(), { tree, camera } = h.dock();
  const dockStyle = flatten(tree.props.style), hit = flatten(camera.props.style);
  assert.equal(tree.props.pointerEvents, 'box-none');
  assert.deepEqual([dockStyle.left, dockStyle.bottom, dockStyle.width, dockStyle.height], [0, 0, 56, 56]);
  assert.deepEqual([hit.left, hit.bottom, hit.width, hit.height], [0, 0, 56, 56]);
  assert.equal(hit.backgroundColor, 'transparent');
  const all = nodes(camera), surface = all.find(node => node.props?.testID === 'mobile-quick-camera-surface');
  assert.equal(surface.props.pointerEvents, 'none');
  assert.deepEqual([flatten(surface.props.style).left, flatten(surface.props.style).bottom], [0, 0]);
  const svg = all.find(node => node.type === 'Svg'), outline = all.find(node => node.type === 'Path');
  assert.deepEqual([svg.props.width, svg.props.height, svg.props.pointerEvents], [72, 72, 'none']);
  assert.equal(outline.props.d, 'M 0 0 C 0 12 8 16 28 16 A 28 28 0 0 1 56 44 C 56 64 60 72 72 72 H 0 Z');
  const withinHit = (x, y) => x >= hit.left && x < hit.left + hit.width && y >= -hit.bottom - hit.height && y < -hit.bottom;
  assert.equal(withinHit(28, -28), true);
  for (const point of [[68, -4], [4, -68], [28, 0], [28, 32], [100, -28]]) assert.equal(withinHit(...point), false);
});

test('camera long hold and directional choices preserve draft-only input behavior', () => {
  const h = harness();
  h.dock().camera.props.onLongPress();
  assert.equal(h.dock().camera.props.expanded, true);
  assert.equal(nodes(h.dock().tree).filter(node => ['quick-input-file', 'quick-input-voice', 'quick-input-text'].includes(node.props?.testID)).length, 3);
  h.dock().camera.props.onGestureEnd(70, 0, true);
  assert.deepEqual(h.events, [['draft', true]]);
  assert.equal(h.dock().camera.props.expanded, false);
  h.dock().camera.props.onPress();
  assert.deepEqual(h.events, [['draft', true], 'capture']);
  const disabled = harness({ enabled: false }).dock().camera;
  assert.equal(disabled.props.disabled, true);
  assert.equal(flatten(disabled.props.style).opacity, 0.4);
});
