import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const source = file => readFileSync(path.join(root, file), 'utf8');
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  const children = Array.isArray(tree) ? tree : tree.props?.children;
  return [tree, ...(Array.isArray(children) ? children.flatMap(nodes) : nodes(children))];
}
const find = (tree, type) => nodes(tree).find(node => node.type === type);
function compile(file, resolve) {
  const output = ts.transpileModule(source(file), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(resolve, module, module.exports);
  return module.exports;
}

// Deterministic route and guard harness. It checks composition, not browser layout or real navigation.
function harness() {
  let cursor = 0, route = '/summary', params = {}, pending = null, measurements, profileSource;
  const slots = [], events = [], effects = [];
  let model = { caregiverName: 'Parent', selectedChildId: 'child-a', connection: 'online', children: [{ id: 'child-a', displayName: 'Child A', accessRole: 'owner' }, { id: 'child-b', displayName: 'Child B', accessRole: 'viewer' }] };
  const react = {
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useEffect(fn, deps) {
      const index = cursor++, old = slots[index];
      if (!old || deps.some((value, key) => !Object.is(value, old.deps[key]))) {
        slots[index] = { deps, cleanup: old?.cleanup };
        effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = fn(); });
      }
    },
  };
  react.useLayoutEffect = react.useEffect;
  const dependencies = {
    'react': react,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'expo-router': { usePathname: () => route, useLocalSearchParams: () => params,
      useRouter: () => ({ push: value => events.push(['push', value]), setParams: value => { events.push(['params', value]); params = { ...params, ...value }; } }) },
    'react-native': { View: 'View', StyleSheet: { create: value => value } },
    'react-native-paper': { Text: 'Text' },
    '../preview/PreviewContext': { usePreview: () => ({ model, actions: { prepareQuestion: question => events.push(['prepare-question', question]) } }) },
    '../preview/PreviewNavigationGuard': { usePreviewNavigation: () => action => { events.push(['guard']); pending = action; } },
    '../workspaces/ProfileWorkspace': { useProfileWorkspace: () => ({ scopeKey: JSON.stringify(['preview-server', model.caregiverName, model.selectedChildId, model.children.find(child => child.id === model.selectedChildId)?.accessRole]), measurements, profileSource, actions: { showHistory: () => events.push(['profile-history']) } }) },
    '../workspaces/PreparationWorkspace': { usePreparationWorkspace: () => ({ actions: { closeDocument: () => events.push(['close-preparation']) } }) },
    '../theme': { colors: {}, readingType: {}, spacing: {} },
  };
  const exports = compile('src/screens/SummaryScreen.tsx', name => dependencies[name] ?? new Proxy({}, { get: (_target, key) => String(key) }));
  return {
    normalize: exports.normalizeSummaryTab, events,
    render() { cursor = 0; const tree = exports.SummaryScreen(); while (effects.length) effects.shift()(); return tree; },
    query(value) { params = value; }, route(value) { route = value; },
    child(value) { model = { ...model, selectedChildId: value }; },
    identity(value) { model = { ...model, caregiverName: value }; },
    profile(value) { ({ measurements, profileSource } = value); },
    approve() { const action = pending; pending = null; action?.(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

test('the route defaults to current-child overview and recognizes only explicit preparation destinations', () => {
  const h = harness();
  for (const value of [undefined, '', 'report', 'unknown', [], ['overview', 'preparation']]) assert.equal(h.normalize(value), 'overview');
  assert.equal(h.normalize('preparation'), 'preparation');
  assert.equal(h.normalize(['preparation', 'overview']), 'preparation');
  assert.equal(h.normalize('legacy-preparation'), 'legacy-preparation');
  const tree = h.render();
  assert.equal(tree.props.title, '孩子概況與準備');
  const tabs = find(tree, 'UnderlineTabs');
  assert.deepEqual(tabs.props.items.map(item => item.label), ['孩子概況', '準備單']);
  assert.equal(tabs.props.value, 'overview');
  const overview = find(tree, 'ChildOverviewContent');
  // Missing adapters stay absent; the shared child reader renders unavailable states.
  assert.equal(overview.props.measurements, undefined);
  assert.equal(overview.props.profileSource, undefined);
  assert.equal(typeof overview.props.onOpenMeasurement, 'function');
  assert.deepEqual(h.events, []);
  assert.equal(find(tree, 'PreparationWorkspace'), undefined);
});

test('injected measurement projections stay canonical and source navigation waits for the current-scope guard', () => {
  const h = harness();
  const scopeKey = JSON.stringify(['preview-server', 'Parent', 'child-a', 'owner']);
  const measurements = { scopeKey, childId: 'child-a', state: 'ready', height: { recordId: 'canonical-record', recordVersion: 3, valueLabel: '99 cm', state: 'current' }, weight: null };
  const profileSource = { scopeKey, childId: 'child-a', state: 'available' };
  h.profile({ measurements, profileSource });
  const overview = find(h.render(), 'ChildOverviewContent');
  assert.equal(overview.props.measurements, measurements);
  assert.equal(overview.props.profileSource, profileSource);
  overview.props.onOpenMeasurement('canonical-record');
  assert.deepEqual(h.events, [['guard']]); h.approve();
  assert.deepEqual(h.events.at(-1), ['push', { pathname: '/care', params: { record: 'canonical-record' } }]);
  const stale = harness();
  find(stale.render(), 'ChildOverviewContent').props.onOpenMeasurement('old-child-record');
  stale.child('child-b'); stale.render(); stale.approve();
  assert.deepEqual(stale.events, [['guard']]);
});

test('tab changes wait for the guard and reset reading scroll only after approved route selection', () => {
  const h = harness(); h.query({ tab: 'preparation' }); let tree = h.render();
  const scrolls = []; tree.props.scrollRef.current = { scrollTo: value => scrolls.push(value) };
  tree.props.onScroll({ nativeEvent: { contentOffset: { y: 426 } } });
  const preparation = find(tree, 'PreparationWorkspace');
  assert.equal(preparation.props.scrollRef, tree.props.scrollRef);
  assert.equal(preparation.props.getScrollPosition(), 426);
  find(tree, 'UnderlineTabs').props.onChange('overview');
  assert.deepEqual(h.events, [['guard']]);
  assert.equal(preparation.props.getScrollPosition(), 426); assert.equal(scrolls.length, 0);
  h.approve(); tree = h.render();
  assert.deepEqual(h.events.slice(1), [['close-preparation'], ['params', { tab: 'overview' }]]);
  assert.deepEqual(scrolls, [{ y: 0, animated: false }]);
  assert.equal(find(tree, 'UnderlineTabs').props.value, 'overview');
});

test('profile history opens through the same shared owner only after guarded navigation approval', () => {
  const h = harness(), tree = h.render();
  find(tree, 'ChildOverviewContent').props.onOpenProfileHistory();
  assert.deepEqual(h.events, [['guard']]); h.approve();
  assert.deepEqual(h.events, [['guard'], ['profile-history'], ['push', '/profile']]);
});

test('late tab or profile requests cannot act on another child, identity, route or unmounted screen', () => {
  for (const change of [h => h.child('child-b'), h => h.identity('Other parent'), h => h.route('/history'), h => h.query({ tab: 'preparation' })]) {
    const h = harness(); find(h.render(), 'ChildOverviewContent').props.onOpenProfileHistory();
    change(h); h.render(); h.approve(); assert.deepEqual(h.events, [['guard']]);
  }
  const h = harness(); find(h.render(), 'UnderlineTabs').props.onChange('preparation'); h.unmount(); h.approve();
  assert.deepEqual(h.events, [['guard']]);
});

test('preparation history and legacy recovery preserve explicit return destinations without a third main tab', () => {
  const h = harness(); h.query({ tab: 'preparation' }); let tree = h.render();
  find(tree, 'PreparationWorkspace').props.onHistory(); h.approve();
  assert.deepEqual(h.events.at(-1), ['push', { pathname: '/history', params: { category: 'preparations' } }]);
  nodes(tree).find(node => node.props?.label === '舊共享準備／原操作查核').props.onPress(); h.approve(); tree = h.render();
  assert.equal(tree.type, 'LegacySummaryRecovery'); assert.equal(find(tree, 'UnderlineTabs'), undefined);
  tree.props.onReturn(); assert.equal(h.events.at(-1)[0], 'guard'); h.approve(); tree = h.render();
  assert.equal(find(tree, 'UnderlineTabs').props.value, 'preparation');
  assert.match(source('src/screens/historyScreen.tsx'), /pathname: "\/summary", params: \{ tab: "preparation" \}/);
});

test('scope changes reset presentation while a hidden native route renders no second reader', () => {
  const h = harness(); h.query({ tab: 'preparation' }); let tree = h.render();
  const oldKey = tree.props.children.key, scrolls = [];
  tree.props.scrollRef.current = { scrollTo: value => scrolls.push(value) };
  h.child('child-b'); tree = h.render();
  assert.notEqual(tree.props.children.key, oldKey); assert.deepEqual(scrolls, [{ y: 0, animated: false }]);
  h.route('/history'); assert.equal(h.render(), null);
  h.route('/summary'); h.child(null); tree = h.render();
  assert.equal(find(tree, 'PreparationWorkspace'), undefined); assert.equal(find(tree, 'ChildOverviewContent'), undefined);
});

test('shared owners mount once beneath Preview without altering five native tabs or navigation groups', () => {
  const layout = source('app/(dashboard)/_layout.tsx');
  for (const provider of ['PreviewProvider', 'BackgroundProvider', 'PhotosWorkspaceProvider', 'TasksWorkspaceProvider', 'ProfileWorkspaceProvider', 'PreparationWorkspaceProvider']) {
    assert.equal((layout.match(new RegExp(`<${provider}(?:>|\\s)`, 'g')) ?? []).length, 1, provider);
  }
  assert.match(layout, /<TasksWorkspaceProvider>\s*<ProfileWorkspaceProvider>\s*<PreparationWorkspaceProvider>/);
  assert.equal((layout.match(/<Tabs\.Screen name=/g) ?? []).length, 5);
  assert.match(layout, /\["more", "history", "memory", "photos", "sources", "summary"/);
  const navigation = compile('src/components/navigation/app-navigation.ts', name => { throw new Error(`Unexpected import ${name}`); });
  assert.equal(navigation.navigationItems.summary.label, '孩子概況與準備');
  assert.deepEqual(navigation.desktopNavigationGroups.map(group => group.keys), [['home'], ['tasks', 'growth'], ['care', 'summary', 'history'], ['profile', 'memory', 'more']]);
  assert.equal(navigation.moreNavigationGroups[0].items.find(item => item.key === 'summary').label, '孩子概況與準備');
});

test('legacy composition retains the original controller and its guarded identity changes', () => {
  const legacy = source('src/screens/LegacySummaryRecovery.tsx'), view = source('src/components/summary/SummaryView.tsx');
  assert.match(legacy, /useSummaryPreview\(child, online, identity, server\)/);
  assert.match(legacy, /recoveryMode onReturn=\{onReturn\}/);
  assert.match(legacy, /onIdentity=\{\(\) => navigate\(/);
  assert.match(legacy, /onServer=\{\(\) => navigate\(/);
  assert.ok(!legacy.includes('usePreparationWorkspace'));
  assert.match(view, /mode: recoveryMode \? 'preparation' : 'report'/);
  assert.ok(view.includes('summary-pending')); assert.ok(view.includes('onPress={actions.retryOriginal}'));
  assert.ok(source('src/preview/useSummaryPreview.ts').includes('usePreviewLeaveGuard(dirty, busy || !!pending)'));
});
