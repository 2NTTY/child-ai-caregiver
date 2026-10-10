import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './scope-transition-harness.mjs';

function scope(h, child, options = {}) {
  return h.jsx(h.load('src/motion/MotionScopeBoundary.tsx').MotionScopeBoundary, {
    scopeKey: `parent:${child}`, childKey: child, eligible: true, resetKey: 'parent', readiness: 'ready',
    ...options, children: h.jsx('PrivateContent', { child }),
  });
}
const measure = h => h.node('motion-child-scope').props.onLayout({ nativeEvent: { layout: { width: 900 } } });
const phase = h => h.node('motion-child-scope').props.dataSet.motionPhase;
const content = h => h.hosts().find(x => x.props.children?.type === 'PrivateContent');

test('a slow selected child stays concealed after all cover animation callbacks complete', () => {
  const h = harness(); h.render(scope(h, 'A')); measure(h);
  h.render(scope(h, 'B', { readiness: 'loading' })); h.finish();
  assert.ok(h.node('motion-child-curtain'), 'animation completion must not substitute for data readiness');
  assert.equal(content(h).props['aria-hidden'], true);
  h.render(scope(h, 'B', { readiness: 'ready' })); h.finish();
  assert.equal(phase(h), 'settled'); assert.equal(content(h).props['aria-hidden'], false);
});

test('new switches conceal in render and reject previous cover/reveal completions', () => {
  const h = harness(); h.render(scope(h, 'A')); measure(h); h.render(scope(h, 'B'));
  h.animations.shift().callback(true); h.render(); assert.equal(phase(h), 'revealing');
  const oldReveal = h.animations.shift();
  h.render(scope(h, 'C', { readiness: 'loading' }), false);
  assert.equal(content(h).props['aria-hidden'], true, 'no frame may expose the intermediate child');
  h.render(); oldReveal.callback(true); h.render(); h.finish();
  assert.equal(phase(h), 'swapping'); assert.equal(content(h).props['aria-hidden'], true);
  h.render(scope(h, 'C')); h.finish(); assert.equal(phase(h), 'settled');
});

test('reduced motion changes presentation, never the current data barrier', () => {
  const h = harness(); h.reduce(); h.render(scope(h, 'A')); measure(h);
  h.render(scope(h, 'B', { readiness: 'loading' }));
  assert.equal(h.animations.length, 0); assert.equal(content(h).props['aria-hidden'], true);
  assert.equal(content(h).props.ref.current.inert, true);
  assert.ok(h.node('motion-child-loading')); assert.equal(h.hosts().some(x => x.type === 'ActivityIndicator'), false);
  h.render(scope(h, 'B')); assert.equal(phase(h), 'settled'); assert.equal(content(h).props.ref.current.inert, false);
});

test('enabling reduced motion in flight keeps pending content concealed', () => {
  const h = harness(); h.render(scope(h, 'A')); measure(h); h.render(scope(h, 'B', { readiness: 'loading' }));
  const late = [...h.animations]; h.reduce(); h.render();
  late.forEach(a => a.callback?.(true)); h.render();
  assert.equal(phase(h), 'swapping'); assert.equal(content(h).props['aria-hidden'], true);
  h.render(scope(h, 'B')); assert.equal(phase(h), 'settled');
});

test('failure and timeout expose guarded recovery without treating them as ready', () => {
  for (const readiness of ['error', 'loading']) {
    const h = harness(); let retries = 0, returned = null;
    const options = { readiness, onRetry: () => retries++, onReturn: id => returned = id };
    h.render(scope(h, 'A')); measure(h); h.render(scope(h, 'B', options)); h.finish();
    if (readiness === 'loading') { assert.equal(h.node('motion-child-recovery'), undefined); h.tick(); }
    assert.ok(h.node('motion-child-recovery')); assert.equal(content(h).props['aria-hidden'], true);
    const buttons = h.hosts().filter(x => x.type === 'Button');
    buttons.find(x => x.props.label === '重新載入').props.onPress();
    buttons.find(x => x.props.label === '返回上一位孩子').props.onPress();
    assert.equal(retries, 1); assert.equal(returned, 'A');
    h.render(scope(h, 'C', { readiness: 'loading' }));
    buttons.forEach(x => x.props.onPress()); assert.equal(retries, 1, 'old recovery controls cannot affect the new switch');
    h.unmount(); assert.equal(h.timers.size, 0);
  }
});

test('a newly required route read during reveal restores concealment immediately', () => {
  const h = harness(); h.render(scope(h, 'A')); measure(h); h.render(scope(h, 'B', { readinessKey: '/tasks' }));
  h.animations.shift().callback(true); h.render(); assert.equal(phase(h), 'revealing');
  const late = h.animations.shift();
  h.render(scope(h, 'B', { readiness: 'loading', readinessKey: '/growth?tab=archive' }), false);
  assert.equal(content(h).props['aria-hidden'], true);
  h.render(); late.callback(true); h.render(); assert.equal(phase(h), 'swapping');
});

test('first selection, same-child refresh, identity reset and revocation do not strand a curtain', () => {
  const h = harness(); h.render(scope(h, null, { eligible: false })); measure(h); h.render(scope(h, 'A', { readiness: 'loading' }));
  assert.equal(phase(h), 'settled'); h.render(scope(h, 'A', { readiness: 'loading' })); assert.equal(phase(h), 'settled');
  h.render(scope(h, 'B', { readiness: 'loading' })); const late = [...h.animations];
  h.render(scope(h, 'C', { resetKey: 'new-parent', readiness: 'loading' }));
  late.forEach(a => a.callback?.(true)); h.render(); assert.equal(phase(h), 'settled');
  h.render(scope(h, null, { eligible: false, resetKey: 'signed-out' })); assert.equal(h.node('motion-child-curtain'), undefined);
});

function integration(h) {
  const { ProductionFirstScreenGate, useProductionStartupReadiness, useProductionSwitchReadiness } = h.load('src/production/ProductionFirstScreenGate.tsx');
  const { MotionScopeBoundary } = h.load('src/motion/MotionScopeBoundary.tsx');
  let retries = 0, childReloads = 0, returned = null;
  function Report({ state }) { useProductionStartupReadiness(state, () => retries++); return null; }
  function Consumer({ child }) {
    const readiness = useProductionSwitchReadiness();
    return h.jsx(MotionScopeBoundary, { scopeKey: `parent:${child}`, childKey: child, resetKey: 'parent',
      readiness: readiness.state, readinessKey: readiness.key, onRetry: readiness.retry, onReturn: id => returned = id,
      children: h.jsx('PrivateContent', { child }) });
  }
  return { retries: () => retries, childReloads: () => childReloads, returned: () => returned,
    tree(child, state = 'ready', includeReport = true, query = {}, recordsPatch = {}) {
      h.production({ identityKey: 'parent', scopeKey: `parent:${child}`, controller: { reloadChildren: () => { childReloads++; } }, recordsState: {
        auth: 'signedIn', online: true, children: [{ id: 'A' }, { id: 'B' }], childrenLoading: false,
        childrenError: null, childrenLoadedAt: '2026-10-10', selectedChildId: child, ...recordsPatch,
      } });
      h.route('/growth', query);
      return h.jsx(ProductionFirstScreenGate, { width: 1000, launch: h.jsx('Launch', {}), children: [
        includeReport ? h.jsx(Report, { state }, 'report') : null, h.jsx(Consumer, { child }, 'consumer'),
      ] });
    },
  };
}

test('the production gate shares only the exact child/route/query report and its retry', () => {
  const h = harness(), app = integration(h); h.render(app.tree('A')); h.tick(); measure(h);
  h.render(app.tree('B', 'loading')); h.finish(); assert.equal(content(h).props['aria-hidden'], true);
  h.render(app.tree('B')); assert.equal(phase(h), 'revealing');
  h.render(app.tree('B', 'ready', false, { tab: 'archive' }));
  assert.equal(content(h).props['aria-hidden'], true, 'old ready report cannot release the new query');
  h.tick(); assert.ok(h.node('motion-child-recovery'));
  h.hosts().find(x => x.type === 'Button' && x.props.label === '返回上一位孩子').props.onPress(); assert.equal(app.returned(), 'A');
  h.render(app.tree('B', 'error', true, { tab: 'archive' }));
  h.hosts().find(x => x.type === 'Button' && x.props.label === '重新載入').props.onPress(); assert.equal(app.retries(), 1);
  h.render(app.tree('B', 'ready', true, { tab: 'archive' })); h.finish(); assert.equal(phase(h), 'settled');
});

test('shell profile and current route are required, unrelated pages are not', () => {
  const h = harness(), { routeStartupReadiness, routeStartupRequirements } = h.load('src/startup/dataReadiness.ts');
  assert.deepEqual(routeStartupRequirements('/chat', {}, true, true), ['profile', 'chat', 'agentPending']);
  assert.equal(routeStartupReadiness('/chat', {}, { profile: 'loading', chat: 'ready', agentPending: 'ready' }, true, true), 'loading');
  assert.equal(routeStartupReadiness('/chat', {}, { profile: 'ready', chat: 'ready', agentPending: 'ready', photos: 'loading' }, true, true), 'ready');
  assert.equal(routeStartupReadiness('/growth', { tab: 'archive' }, { profile: 'ready', growth: 'ready', documents: 'loading' }, true, true), 'loading');
  assert.deepEqual(routeStartupRequirements('/settings', { section: 'notifications' }, false, true), ['push', 'telegram']);
});

test('late prior-key readiness reports cannot replace the current ready report', () => {
  const h = harness(), app = integration(h); h.render(app.tree('A')); h.tick(); measure(h);
  const old = h.contextValues.find(value => value?.report && value.key.includes('parent:A'));
  h.render(app.tree('B', 'loading')); h.finish();
  old.report({ key: old.key, state: 'ready' }); h.render(); assert.equal(content(h).props['aria-hidden'], true);
  h.render(app.tree('B')); h.finish();
  old.report({ key: old.key, state: 'loading' }); h.render();
  assert.equal(h.node('motion-child-scope').props.dataSet.motionData, 'ready');
});

test('missing registration has a bounded recovery path and never defaults to ready', () => {
  const h = harness(), { useProductionSwitchReadiness } = h.load('src/production/ProductionFirstScreenGate.tsx');
  let returned = null;
  function Unregistered({ child }) {
    const readiness = useProductionSwitchReadiness();
    return scope(h, child, { readiness: readiness.state, readinessKey: readiness.key, onRetry: readiness.retry, onReturn: id => returned = id });
  }
  h.render(h.jsx(Unregistered, { child: 'A' })); measure(h); h.render(h.jsx(Unregistered, { child: 'B' })); h.finish(); h.tick();
  assert.ok(h.node('motion-child-recovery')); assert.equal(content(h).props['aria-hidden'], true);
  const buttons = h.hosts().filter(x => x.type === 'Button'); assert.equal(buttons.length, 1);
  buttons[0].props.onPress(); assert.equal(returned, 'A');
});

test('a lost animation callback can settle only when the data is already ready', () => {
  const h = harness(); h.render(scope(h, 'A')); measure(h); h.render(scope(h, 'B'));
  assert.equal(phase(h), 'covering'); h.tick(); assert.equal(phase(h), 'settled');
  h.render(scope(h, 'C', { readiness: 'loading' })); h.tick();
  assert.ok(h.node('motion-child-recovery')); assert.equal(content(h).props['aria-hidden'], true);
});


test('shared child-list failure retries its guarded owner before the switch can settle', () => {
  const h = harness(), app = integration(h); h.render(app.tree('A')); h.tick(); measure(h);
  h.render(app.tree('B', 'ready', true, {}, { childrenError: 'Synthetic list failure' })); h.finish();
  assert.ok(h.node('motion-child-recovery')); assert.equal(content(h).props['aria-hidden'], true);
  const retryButton = h.hosts().find(x => x.type === 'Button' && x.props.label === '重新載入');
  retryButton.props.onPress(); assert.equal(app.childReloads(), 1); assert.equal(app.retries(), 1);
  h.render(app.tree('B', 'ready', true, {}, { childrenLoading: true }));
  assert.equal(content(h).props['aria-hidden'], true);
  h.render(app.tree('B')); h.finish(); assert.equal(phase(h), 'settled');
  retryButton.props.onPress(); assert.equal(app.childReloads(), 1, 'settled/old recovery callbacks have no authority');
});

test('old query recovery events cannot trigger the current route retry', () => {
  const h = harness(), app = integration(h); h.render(app.tree('A')); h.tick(); measure(h);
  h.render(app.tree('B', 'error')); h.finish();
  const oldRetry = h.hosts().find(x => x.type === 'Button' && x.props.label === '重新載入');
  h.render(app.tree('B', 'error', true, { tab: 'archive' }));
  oldRetry.props.onPress(); assert.equal(app.retries(), 0);
  h.hosts().find(x => x.type === 'Button' && x.props.label === '重新載入').props.onPress(); assert.equal(app.retries(), 1);
});

test('conversation and notification history wait for their own initial page, not just the header', () => {
  const h = harness(), { routeStartupReadiness } = h.load('src/startup/dataReadiness.ts');
  for (const category of ['conversations', 'notifications']) {
    assert.equal(routeStartupReadiness('/history', { category }, { profile: 'ready', [category]: 'loading' }, true, true), 'loading');
    assert.equal(routeStartupReadiness('/history', { category }, { profile: 'ready', [category]: 'error' }, true, true), 'error');
    assert.equal(routeStartupReadiness('/history', { category }, { profile: 'ready', [category]: 'ready', photos: 'loading' }, true, true), 'ready');
  }
});

test('the real readiness reporter follows scoped personal-history state and owner-backed recovery', () => {
  let personal, historyRetries = 0, notificationRetries = 0, profileRetries = 0;
  const noop = () => {}, profile = { scopeKey: 'parent:B', model: { needsRefresh: false, reading: false, current: {} }, actions: { refresh: () => profileRetries++ } };
  const h = harness({
    '../workspaces/CareWorkspace': { useCareWorkspace: () => null },
    '../workspaces/ProfileWorkspace': { useProfileWorkspace: () => profile },
    '../workspaces/TasksWorkspace': { useTasksWorkspace: () => null },
    '../workspaces/GrowthWorkspace': { useGrowthWorkspace: () => null },
    '../workspaces/MemoryReferenceWorkspace': { useMemoryReferenceWorkspace: () => null },
    './TaskKnowledgeDomains': { useProductionFamilyDocuments: () => null, useProductionTaskKnowledgeSummary: () => null, useProductionTaskKnowledgeMemory: () => null },
    './PhotoInputDomains': { useProductionPhotoInputDomains: () => null },
    './usePersonalHistory': { usePersonalHistoryWorkspace: () => personal },
    './SettingsDomains': { useProductionContactDomain: () => ({ model: { load: 'ready' }, actions: { refresh: noop } }), useProductionSettingsDomains: () => ({
      family: { readState: 'ready', actions: { refresh: noop } }, modelSettings: { model: { snapshot: {} }, actions: { refresh: noop } },
      push: { model: { readState: 'ready' }, actions: { refresh: noop } }, telegram: { model: { readState: 'ready' }, actions: { refresh: noop } },
      preferences: { preferences: {}, refresh: noop },
    }) },
  });
  const { ProductionFirstScreenGate, useProductionSwitchReadiness } = h.load('src/production/ProductionFirstScreenGate.tsx');
  const { ProductionStartupReadiness } = h.load('src/production/ProductionStartupReadiness.tsx');
  function Consumer() { const value = useProductionSwitchReadiness(); return h.jsx('Readiness', { testID: 'readiness', ...value }); }
  function render(category, state, scope = 'parent:B') {
    personal = { scopeKey: scope, access: 'active', online: true, history: { state, data: null }, notifications: { state, data: null },
      actions: { searchHistory: query => { assert.equal(query, ''); historyRetries++; }, loadNotifications: () => notificationRetries++ } };
    h.production({ identityKey: 'parent', scopeKey: 'parent:B', controller: { reloadChildren: noop }, chatState: {}, chatController: { reloadMessages: noop }, recordsState: {
      auth: 'signedIn', online: true, children: [{ id: 'B' }], childrenLoading: false, childrenError: null, childrenLoadedAt: '2026-10-10', selectedChildId: 'B',
    } }); h.route('/history', { category });
    h.render(h.jsx(ProductionFirstScreenGate, { width: 1000, launch: null, children: [h.jsx(ProductionStartupReadiness, {}, 'report'), h.jsx(Consumer, {}, 'consumer')] }));
    return h.node('readiness').props;
  }
  for (const category of ['conversations', 'notifications']) {
    assert.equal(render(category, 'unavailable').state, 'loading');
    assert.equal(render(category, 'loading').state, 'loading');
    assert.equal(render(category, 'ready', 'parent:A').state, 'loading');
    assert.equal(render(category, 'ready').state, 'ready');
    const failure = render(category, 'error'); assert.equal(failure.state, 'error'); failure.retry([category, category]);
  }
  assert.equal(historyRetries, 1); assert.equal(notificationRetries, 1); assert.equal(profileRetries, 2);
});

test('only the visible information-rail tab can hold the current screen', () => {
  const h = harness(), { visibleRailStartupReadiness } = h.load('src/startup/dataReadiness.ts');
  assert.equal(visibleRailStartupReadiness(true, 'attention', { tasks: 'loading', care: 'ready' }), 'loading');
  assert.equal(visibleRailStartupReadiness(false, 'attention', { tasks: 'loading' }), 'ready');
  assert.equal(visibleRailStartupReadiness(true, 'attention', { tasks: 'ready', care: 'loading' }), 'ready');
  assert.equal(visibleRailStartupReadiness(true, 'context', { tasks: 'loading', care: 'ready' }), 'ready');
  assert.equal(visibleRailStartupReadiness(true, 'context', { care: 'loading' }), 'loading');
  assert.equal(visibleRailStartupReadiness(true, 'context', { care: 'error' }), 'error');
  assert.equal(visibleRailStartupReadiness(true, 'attention', {}), 'loading', 'new scope without a projection must not use the prior rail');
});

test('the actual web shell includes only its open, selected rail tab and its guarded scope', () => {
  let scopeKey = 'parent:A', tasksState = 'loading', careState = 'ready', careScope = scopeKey, taskScope = scopeKey, retried;
  const native = { View: 'View', Pressable: 'Pressable', Platform: { OS: 'web' }, StyleSheet: { create: value => value, flatten: value => value, absoluteFill: {} }, useWindowDimensions: () => ({ width: 1440, height: 900 }) };
  const mocks = {
    'react-native': native,
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView', useSafeAreaInsets: () => ({ bottom: 0 }) },
    '../preview/PreviewNavigationGuard': { PreviewLink: 'Link' },
    './AppScrollView': { AppScrollView: 'ScrollView' },
    '../branding': { brand: {} }, '../theme': { colors: {}, spacing: {}, radius: {}, mobileIcons: {}, mobileLayout: {}, mobileType: {}, typeScale: {} },
    '../motion': { MotionDrawerOverlay: 'DrawerOverlay', MotionDrawerRight: 'DrawerRight', MotionEntrance: 'Entrance', MotionScopeBoundary: 'ScopeBoundary' },
    './navigation/app-navigation': { desktopNavigationGroups: [], navigationItems: { settings: { href: '/settings', label: 'Settings' } } },
    './RightRailContent': { RightRailContent: 'RightRailContent' },
    '../production/useProductionHome': { useProductionHome: () => ({ model: { selectedChildId: scopeKey.endsWith('A') ? 'A' : 'B', children: [{ id: 'A' }, { id: 'B' }] },
      actions: { selectChild() {} }, scopeKey, identityKey: 'parent' }) },
    '../production/ProductionFirstScreenGate': { useProductionSwitchReadiness: () => ({ state: 'ready', key: `${scopeKey}:/chat`, retry: names => retried = names }) },
    '../workspaces/CareWorkspace': { useCareWorkspace: () => ({ scopeKey: careScope, model: { list: { state: careState } } }) },
    '../workspaces/TasksWorkspace': { useTasksWorkspace: () => ({ scopeKey: taskScope, model: { access: 'active', readState: tasksState } }) },
  };
  for (const [path, symbol] of [['./BrandLogo', 'BrandLogo'], ['./AppIcon', 'AppIcon'], ['./AgentEntryButton', 'AgentEntryButton'],
    ['./agent/MobileQuickInputDock', 'MobileQuickInputDock'], ['./navigation/RecordsNavButton', 'RecordsNavButton'], ['./navigation/MobileNavSelection', 'MobileNavSelection'],
    ['./ChildKeyFacts', 'ChildKeyFacts'], ['./ChildPicker', 'ChildPicker'], ['./CompactHeaderIdentity', 'CompactHeaderIdentity'], ['./NotificationBell', 'NotificationBell'], ['./ToolbarIconButton', 'ToolbarIconButton']]) mocks[path] = { [symbol]: symbol };
  mocks['./ChildPicker'] = { ChildPicker: ({ children: childData, ...props }) => ({ type: 'ChildPicker', props }) };
  const h = harness(mocks), { AppShell } = h.load('src/components/AppShell.tsx'); h.route('/chat');
  const shell = () => h.hosts().find(x => x.type === 'ScopeBoundary').props;
  const railToggle = () => h.hosts().find(x => x.type === 'ToolbarIconButton').props.onPress();
  h.render(h.jsx(AppShell, { children: 'chat' })); assert.equal(shell().readiness, 'ready', 'closed rail cannot hold the page');
  railToggle(); h.render(); assert.equal(shell().readiness, 'loading'); assert.match(shell().readinessKey, /rail:attention$/);
  shell().onRetry(); assert.deepEqual(retried, ['tasks']);
  h.hosts().find(x => x.type === 'RightRailContent').props.onTabChange('context'); h.render();
  assert.equal(shell().readiness, 'ready'); assert.match(shell().readinessKey, /rail:context$/);
  careState = 'loading'; h.render(); assert.equal(shell().readiness, 'loading'); shell().onRetry(); assert.deepEqual(retried, ['care']);
  careState = 'ready'; scopeKey = 'parent:B'; h.render(); assert.equal(shell().readiness, 'loading', 'old-scope care is not current');
  careScope = scopeKey; h.render(); assert.equal(shell().readiness, 'ready');
  railToggle(); h.render(); tasksState = 'loading'; careState = 'loading'; h.render(); assert.equal(shell().readiness, 'ready');
});

test('old visible-tab recovery and timeout callbacks cannot affect the current tab', () => {
  const h = harness(); let retries = 0, returns = 0;
  h.render(scope(h, 'A')); measure(h);
  h.render(scope(h, 'B', { readiness: 'error', readinessKey: 'route:attention', onRetry: () => retries++, onReturn: () => returns++ })); h.finish();
  const oldButtons = h.hosts().filter(x => x.type === 'Button'), oldTimer = [...h.timers.values()][0].fn;
  h.render(scope(h, 'B', { readiness: 'loading', readinessKey: 'route:context', onRetry: () => retries++, onReturn: () => returns++ }));
  oldButtons.forEach(x => x.props.onPress()); oldTimer(); h.render();
  assert.equal(retries, 0); assert.equal(returns, 0); assert.equal(h.node('motion-child-recovery'), undefined);
  assert.equal(content(h).props['aria-hidden'], true);
});
