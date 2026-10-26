import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import * as navigation from '../src/components/navigation/app-navigation.ts';

// Synthetic element-tree tests execute the actual presentation functions and
// callbacks. They do not claim DOM geometry, native focus, or browser acceptance.
const require = createRequire(import.meta.url);
const nodes = tree => !tree || typeof tree !== 'object' ? [] : [tree, ...[tree.props?.children].flat(Infinity).flatMap(nodes)];
const flatten = value => Array.isArray(value) ? Object.assign({}, ...value.filter(Boolean).map(flatten)) : value || {};
function load(relative, extras = {}, width = 1440) {
  const native = { Platform: { OS: 'web', select: value => value.web ?? value.default }, View: 'View', Pressable: 'Pressable', StyleSheet: { create: value => value, flatten }, useWindowDimensions: () => ({ width, height: 900 }) };
  const core = {
    react: { useState: value => [typeof value === 'function' ? value() : value, () => {}], useRef: value => ({ current: value }), useEffect() {}, useLayoutEffect() {} },
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': native, 'react-native-paper': { Text: 'Text' },
    ...extras,
  };
  const result = ts.transpileModule(readFileSync(new URL(relative, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }, reportDiagnostics: true });
  assert.deepEqual(result.diagnostics.filter(item => item.category === ts.DiagnosticCategory.Error), []);
  const module = { exports: {} };
  new Function('require', 'module', 'exports', result.outputText)(name => {
    if (core[name]) return core[name];
    if (name.endsWith('/app-navigation')) return navigation;
    if (name.endsWith('/theme')) return { colors: {}, spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 }, radius: {}, mobileLayout: { breakpoint: 650 }, mobileIcons: {}, mobileType: {}, typeScale: {} };
    if (name.endsWith('/useContainerWidth')) return { useContainerWidth: () => ({ width, ref: null, onLayout() {} }) };
    if (name.endsWith('/BackgroundSurface')) return { BackgroundSurface: 'BackgroundSurface', useCustomBackground: () => false };
    if (name.endsWith('/home-overview')) return { selectHomeAgentImportant: model => model.important ?? { state: 'ready', items: [] } };
    return new Proxy({}, { get: (_target, key) => String(key) });
  }, module, module.exports);
  return module.exports;
}

test('feature directory retains every ordinary destination as a guarded link at every requested width', () => {
  const keys = navigation.moreNavigationGroups.flatMap(group => group.items.map(item => item.key));
  assert.deepEqual([...keys].sort(), Object.keys(navigation.navigationItems).filter(key => key !== 'more').sort());
  for (const width of [320, 390, 1024, 1440]) {
    const screen = load('../src/screens/moreScreen.tsx', {}, width).default();
    const links = nodes(screen).filter(node => node.type === 'PreviewLink');
    assert.equal(links.length, keys.length);
    for (const [i, key] of keys.entries()) {
      assert.deepEqual(links[i].props.href, key === 'photos' ? { pathname: '/care', params: { view: 'photos' } } : navigation.navigationItems[key].href);
      assert.equal(links[i].props.children.props.accessibilityLabel, navigation.navigationItems[key].label);
    }
  }
});

test('PageFrame renders a visible primary heading and keeps scroll callbacks owned by the consumer', () => {
  const onScroll = () => {}, onSize = () => {}, scrollRef = { current: null };
  const frame = load('../src/components/PageFrame.tsx').PageFrame({ title: '照顧記錄', description: '核對內容', children: 'content', scrollRef, onScroll, onContentSizeChange: onSize });
  const heading = nodes(frame).find(node => node.type === 'JournalHeading');
  assert.equal(heading.props.title, '照顧記錄');
  const scroll = nodes(frame).find(node => node.type === 'AppScrollView');
  assert.equal(scroll.props.ref, scrollRef); assert.equal(scroll.props.onScroll, onScroll); assert.equal(scroll.props.onContentSizeChange, onSize);
  const rendered = load('../src/components/journal/JournalLayout.tsx').JournalHeading(heading.props);
  assert.ok(nodes(rendered).some(node => node.props?.['aria-level'] === 1 && node.props?.children === '照顧記錄'));
});

test('one home composition retains each domain projection and explicit direct actions without forced introductions', () => {
  for (const width of [320, 390, 1024, 1440]) {
    const calls = [], actions = { open: destination => calls.push(destination) };
    const model = { selectedChildId: 'child-a', scopeKey: 'parent:child-a', children: [{ id: 'child-a', displayName: '晴晴' }], profileLoad: 'ready', guideStatus: 'complete', caregiverName: '阿欣', operation: {state: 'none'} };
    const root = load('../src/components/HomeDashboard.tsx', {}, width).HomeDashboard({ model, actions });
    const all = nodes(root);
    for (const type of ['HomeQuickActions', 'HomeActionSummary', 'HomeAgentImportant', 'HomeOngoing']) {
      const sections = all.filter(node => node.type === type);
      assert.equal(sections.length, 1); assert.equal(sections[0].props.model, model); assert.equal(sections[0].props.actions, actions);
    }
    assert.equal(all.some(node => node.type === 'HomeWelcome'), false);
    all.find(node => node.props?.label === '查看孩子概況').props.onPress();
    all.find(node => node.props?.label === '核對照顧記錄').props.onPress();
    assert.deepEqual(calls, ['summary', 'care']);
    assert.ok(all.some(node => node.props?.['aria-level'] === 1 && node.props?.children === '晴晴的照顧筆記'));
  }
});

test('new navigation is explicit and browser zoom remains a user setting', () => {
  const shell = readFileSync(new URL('../src/components/AppShell.tsx', import.meta.url), 'utf8');
  assert.match(shell, /\["home", "chat", "tasks", "growth", "more"\]/);
  assert.match(shell, /role="main"/); assert.match(shell, /跳到主要內容/);
  const root = readFileSync(new URL('../app\/_layout.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(root, /zoom\s*:/); assert.doesNotMatch(root, /user-scalable=no|maximum-scale=1/);
  const chat = readFileSync(new URL('../src/screens/chatScreen.tsx', import.meta.url), 'utf8');
  assert.equal([...chat.matchAll(/<AgentComposer\b/g)].length, 1);
  assert.match(chat, /<AppScrollView testID="chat-workspace-scroll"/);
  assert.match(chat, /<ChatContents key=\{scopeKey/);
});

test('the journal does not block home behind removed decorative artwork', async () => {
  const {requiredFirstScreenImages} = await import('../src/startup/imageReadiness.ts');
  for (const width of [320, 390, 1024, 1440]) assert.deepEqual(requiredFirstScreenImages('/', width), []);
});
