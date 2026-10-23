import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Shallow projections exercise the real screen callbacks and state branches.
// They do not claim browser layout, live models or real family mutations.
const jsx = (type, props) => ({ type, props });
const components = new Proxy({}, { get: (_target, key) => String(key) });
function load(relative, mocks = {}) {
  const source = readFileSync(new URL(relative, import.meta.url), 'utf8');
  const { outputText, diagnostics } = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  }, reportDiagnostics: true });
  assert.equal(diagnostics.filter(item => item.category === ts.DiagnosticCategory.Error).length, 0);
  const module = { exports: {} };
  new Function('require', 'module', 'exports', outputText)(name => {
    if (name in mocks) return mocks[name];
    if (name === 'react') return { useState: value => [value, () => {}], useRef: value => ({ current: value }), useId: () => 'disclosure', useEffect() {}, useLayoutEffect() {} };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (name === 'react-native') return { View: 'View', Pressable: 'Pressable', StyleSheet: { create: value => value } };
    if (name === 'react-native-paper') return { Text: 'Text' };
    if (name.endsWith('/useContainerWidth')) return { useContainerWidth: () => ({ width: 1440, ref: null, onLayout() {} }) };
    if (name.endsWith('/growth-styles')) return { growthStyles: {} };
    if (name.endsWith('/theme')) return { mobileLayout: { breakpoint: 650 }, spacing: {} };
    if (name.endsWith('/summary-styles')) return { summaryStyles: {} };
    if (name.endsWith('/shared/growth')) return { GROWTH_KNOWLEDGE_NOTICES: { region: 'region', age: 'age' } };
    if (name.endsWith('/growth-view-model')) return { growthRefreshNotice: '已重新讀取' };
    return components;
  }, module, module.exports);
  return module.exports;
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...nodes(tree.props?.children), ...nodes(tree.props?.primary)];
}
const named = (tree, type) => nodes(tree).filter(node => node.type === type);
const model = () => ({ scopeKey: 'synthetic:child', childId: 'child', online: true, access: 'editable', load: 'ready',
  page: { authorityVersion: 'auth:1', concerns: { state: 'ready', items: [] }, items: [], topics: [], notices: [] },
  dirty: false, pending: null, notice: '', operation: 'none', missingTargets: [], resetCounts: {}, epoch: 1 });
const { GrowthView } = load('../src/components/growth/GrowthView.tsx');
function view(value, extra = {}) { return GrowthView({ model: value, actions: {}, onTask() {}, ...extra }); }

test('successful empty concerns show one card and a direct chat action, with manual fallback secondary', () => {
  let chats = 0;
  const value = model(), before = structuredClone(value);
  const tree = view(value, { onChat: () => chats++ });
  const cards = named(tree, 'EmptyListCard');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].props.title, '暫無持續關注');
  const group = named(tree, 'GrowthConcernActions')[0];
  const button = named(group.props.primary, 'AppButton')[0];
  assert.ok(nodes(group.props.primary).indexOf(button) < nodes(group.props.primary).indexOf(named(group, 'GrowthConcernManualFallback')[0]));
  assert.equal(named(cards[0], 'AppButton').length, 0, 'No duplicated empty-state chat action');
  assert.equal(button.props.label, '與助手討論');
  assert.equal(button.props.variant, 'primary'); assert.equal(button.props.density, 'compact');
  button.props.onPress(); assert.equal(chats, 1);
  const panel = named(tree, 'AppTabPanel').find(node => node.props.tabKey === 'concerns');
  assert.equal(named(panel, 'GrowthConcernManualFallback').length, 1);
  assert.deepEqual(value, before);
});

test('initial, failed, unavailable, offline and revoked concern reads do not claim successful emptiness', () => {
  const cases = [
    { ...model(), page: null, load: 'loading' },
    { ...model(), load: 'error' },
    { ...model(), online: false },
    { ...model(), access: 'lost' },
    ...['loading', 'error', 'unavailable'].map(state => ({ ...model(), page: { ...model().page, concerns: { state, items: [] } } })),
  ];
  for (const value of cases) assert.equal(named(view(value), 'EmptyListCard').length, 0);
  const refreshing = view({ ...model(), load: 'loading' });
  assert.equal(named(refreshing, 'EmptyListCard').length, 1, 'A retained successful read stays stable through refresh');
});

test('existing concerns and pending suggestion tools remain available only in the concerns tab', () => {
  const value = model();
  value.page.concerns.items = [{ id: 'concern-1', childId: 'child', title: 'Synthetic concern', status: 'following', attentionIds: [] }];
  const tools = jsx('CandidateTools', {});
  const tree = view(value, { previewTools: tools });
  assert.equal(named(tree, 'EmptyListCard').length, 0);
  assert.equal(named(tree, 'GrowthConcernTimeline')[0].props.concern.id, 'concern-1');
  const panels = named(tree, 'AppTabPanel');
  assert.equal(named(panels.find(node => node.props.tabKey === 'concerns'), 'CandidateTools').length, 1);
  assert.equal(named(panels.find(node => node.props.tabKey === 'preparation'), 'CandidateTools').length, 0);
});

test('manual concern entry keeps its existing closed form dialog and permission checks', () => {
  const { GrowthConcernManualFallback } = load('../src/components/growth/GrowthConcernManualFallback.tsx');
  const actions = { createConcern() {}, updateConcern() {} };
  const props = { model: model(), actions, concern: null };
  const entry = GrowthConcernManualFallback(props);
  assert.equal(entry.type, 'ManualFormDialog');
  assert.equal(entry.props.label, '手動');
  assert.equal(entry.props.title, '新增關注');
  assert.equal(entry.props.scopeKey, props.model.scopeKey);
  const followup = GrowthConcernManualFallback({ ...props, concern: { id: 'concern-1' } });
  assert.equal(followup.props.label, '手動'); assert.equal(followup.props.title, '新增／跟進關注');
  const { ManualFormDialog } = load('../src/components/FormDialog.tsx');
  const dialog = ManualFormDialog(entry.props);
  assert.equal(named(dialog, 'AppButton')[0].props.variant, 'quiet');
  assert.equal(named(dialog, 'AppButton')[0].props.label, '手動');
  assert.equal(named(dialog, 'AppButton')[0].props.accessibilityLabel, '手動：新增關注');
  assert.equal(named(ManualFormDialog(followup.props), 'AppButton')[0].props.accessibilityLabel, '手動：新增／跟進關注');
  assert.equal(named(ManualFormDialog({ ...entry.props, label: '其他手動', title: undefined }), 'AppButton')[0].props.accessibilityLabel, '其他手動');
  assert.equal(named(dialog, 'AppDialog').length, 0);
  for (const access of ['read_only', 'lost']) assert.equal(GrowthConcernManualFallback({ ...props, model: { ...model(), access } }), null);
  assert.equal(GrowthConcernManualFallback({ ...props, actions: {} }), null);
});

test('chat entry passes through the existing navigation guard before routing to chat', () => {
  const routed = [], queued = [];
  const workspace = { scopeKey: 'synthetic:child', model: model(), actions: {} };
  const { GrowthScreen } = load('../src/screens/GrowthScreen.tsx', {
    'expo-router': { usePathname: () => '/growth', useRouter: () => ({ push: path => routed.push(path) }), useLocalSearchParams: () => ({}) },
    '../preview/PreviewNavigationGuard': { usePreviewNavigation: () => callback => queued.push(callback) },
    '../production/ProductionProvider': { useProduction: () => ({ model: { selectedChildId: 'child', children: [{ id: 'child' }] }, actions: {} }) },
    '../workspaces/GrowthWorkspace': { useGrowthWorkspace: () => workspace },
    '../workspaces/TasksWorkspace': { useTasksWorkspace: () => null },
    '../workspaces/PreparationWorkspace': { usePreparationWorkspace: () => null },
    '../production/TaskKnowledgeDomains': { useProductionFamilyDocuments: () => null },
  });
  const tree = GrowthScreen();
  tree.props.onChat();
  assert.equal(queued.length, 1);
  assert.deepEqual(routed, [], 'No route change before the guard permits navigation');
  queued[0]();
  assert.deepEqual(routed, ['/chat']);
});


test('the compact detail action group separates manual entry from secondary management and retains the archive basis', () => {
  let archived;
  const value = model(), concern = { id: 'concern', childId: 'child', title: 'Synthetic topic', version: 3, status: 'following', attentionIds: [] };
  value.page.concerns.items = [concern]; value.page.canManage = true;
  const tree = GrowthView({ model: value, actions: { archiveConcern: (...args) => { archived = args; } }, onTask() {}, managementTools: jsx('SuggestionSettings', {}) });
  const group = named(tree, 'GrowthConcernActions')[0];
  assert.ok(group); assert.equal(group.props.hasManagement, true);
  assert.equal(named(group.props.primary, 'GrowthConcernManualFallback')[0].props.concern, concern);
  assert.equal(named(group.props.children, 'GrowthConcernManualFallback').length, 0);
  assert.equal(named(group.props.children, 'SuggestionSettings').length, 1);
  const detail = nodes(tree).find(node => node.props?.testID === 'growth-detail-surface');
  assert.ok(detail, 'The action group belongs to the detail column, not below the full-width workspace');
  assert.equal(detail.type, 'BackgroundSurface');
  assert.equal(detail.props.padded, true);
  assert.ok(detail.props.children.includes(group));
  const index = nodes(tree).find(node => node.props?.testID === 'growth-index-surface');
  assert.equal(index.type, 'BackgroundSurface'); assert.equal(index.props.padded, true);
  assert.ok(named(detail, 'GrowthConcernTimeline').length);
  const archive = named(group.props.children, 'GrowthArchiveConcernButton')[0];
  assert.equal(archive.props.scopeKey, value.scopeKey); assert.equal(archive.props.authorityVersion, 'auth:1');
  archive.props.onConfirm(); assert.deepEqual(archived, ['concern', 3, 'auth:1']);
  const dirty = GrowthView({ model: { ...value, dirty: true }, actions: {}, onTask() {} });
  assert.equal(named(dirty, 'GrowthArchiveConcernButton')[0].props.disabled, true);
  const locked = GrowthView({ model: { ...value, locked: true }, actions: {}, onTask() {} });
  assert.equal(named(locked, 'GrowthArchiveConcernButton')[0].props.disabled, true);
  const readOnly = structuredClone(value); readOnly.page.canManage = false;
  assert.equal(named(view(readOnly), 'GrowthArchiveConcernButton').length, 0);
  assert.equal(named(view({ ...value, access: 'lost' }), 'GrowthConcernActions').length, 0);
  assert.equal(named(view(value, { tab: 'preparation' }), 'GrowthConcernActions').length, 0);
});

test('history and recovery share the original tab toolbar with compact labels and unchanged callbacks', () => {
  for (const width of [320, 390, 1024, 1440]) {
    const { GrowthView: SizedGrowthView } = load('../src/components/growth/GrowthView.tsx', {
      '../useContainerWidth': { useContainerWidth: () => ({ width, ref: null, onLayout() {} }) },
    });
    let histories = 0, refreshes = 0;
    const onHistory = () => histories++, refresh = () => refreshes++;
    const value = { ...model(), load: 'error' };
    const props = { model: value, actions: { refresh }, onTask() {}, onHistory, onTabChange() {} };
    const tree = SizedGrowthView(props);
    const status = nodes(tree).find(node => node.props?.testID === 'growth-status-surface');
    assert.equal(status.type, 'BackgroundSurface'); assert.equal(status.props.padded, true);
    assert.equal(tree.props.headerActions, undefined);
    const toolbar = named(tree, 'TabToolbar')[0];
    assert.equal(named(toolbar, 'UnderlineTabs')[0].props.id, 'growth-workspace');
    const buttons = named(toolbar.props.actions, 'AppButton');
    const history = buttons.find(node => node.props.accessibilityLabel === '查看關注歷史');
    const recovery = buttons.find(node => node.props.accessibilityLabel === '重讀成長關注並保留草稿');
    assert.equal(history.props.label, width < 650 ? '歷史' : '查看關注歷史');
    assert.equal(history.props.onPress, onHistory); history.props.onPress(); assert.equal(histories, 1);
    assert.equal(recovery.props.label, width < 650 ? '重讀' : '重新讀取');
    assert.equal(recovery.props.onPress, refresh); recovery.props.onPress(); assert.equal(refreshes, 1);
    const pending = SizedGrowthView({ ...props, model: { ...value, pending: { original: true }, busy: true } });
    const pendingButton = named(named(pending, 'TabToolbar')[0].props.actions, 'AppButton').find(node => node.props.accessibilityLabel === '重讀並核對原操作');
    assert.equal(pendingButton.props.label, width < 650 ? '核對原操作' : '重讀並核對原操作');
    assert.equal(pendingButton.props.disabled, true);
    const preparation = SizedGrowthView({ ...props, tab: 'preparation' });
    assert.equal(named(preparation, 'TabToolbar')[0].props.actions, undefined);
  }
});


test('loaded concerns keep a compact assistant action before the manual fallback through refresh and read-only views', () => {
  for (const width of [320, 390, 1024, 1440]) {
    const { GrowthView: SizedGrowthView } = load('../src/components/growth/GrowthView.tsx', {
      '../useContainerWidth': { useContainerWidth: () => ({ width, ref: null, onLayout() {} }) },
    });
    for (const access of ['editable', 'read_only']) {
      let chats = 0;
      const value = model(); value.access = access; value.load = 'loading'; value.busy = true;
      value.page.concerns.items = [{ id: 'concern-1', childId: 'child', title: 'Synthetic concern', status: 'following', attentionIds: [] }];
      const onChat = () => chats++;
      const tree = SizedGrowthView({ model: value, actions: {}, onTask() {}, onChat });
      const primary = named(tree, 'GrowthConcernActions')[0].props.primary, ordered = nodes(primary);
      const button = named(primary, 'AppButton')[0], manual = named(primary, 'GrowthConcernManualFallback')[0];
      assert.equal(button.props.label, '與助手跟進'); assert.equal(button.props.variant, 'primary');
      assert.equal(button.props.density, 'compact'); assert.equal(button.props.disabled, false);
      assert.equal(button.props.onPress, onChat); assert.ok(ordered.indexOf(button) < ordered.indexOf(manual));
      button.props.onPress(); assert.equal(chats, 1);
      assert.equal(named(tree, 'GrowthConcernTimeline').length, 1);
      value.online = false;
      assert.equal(named(SizedGrowthView({ model: value, actions: {}, onTask() {}, onChat }), 'AppButton').find(node => node.props.label === '與助手跟進').props.disabled, true);
    }
  }
});
