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
    if (name === 'react') return { useState: value => [value, () => {}], useRef: value => ({ current: value }), useId: () => 'disclosure', useEffect() {} };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (name === 'react-native') return { View: 'View', Pressable: 'Pressable', StyleSheet: { create: value => value } };
    if (name === 'react-native-paper') return { Text: 'Text' };
    if (name.endsWith('/useContainerWidth')) return { useContainerWidth: () => ({ width: 1440, ref: null, onLayout() {} }) };
    if (name.endsWith('/growth-styles')) return { growthStyles: {} };
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
  return [tree, ...nodes(tree.props?.children)];
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
  const button = named(cards[0], 'AppButton')[0];
  assert.equal(button.props.label, '與助手討論');
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
  assert.equal(named(panels.find(node => node.props.tabKey === 'archive'), 'CandidateTools').length, 0);
});

test('manual concern entry keeps its existing collapsed disclosure and permission checks', () => {
  const { GrowthConcernManualFallback } = load('../src/components/growth/GrowthConcernManualFallback.tsx');
  const actions = { createConcern() {}, updateConcern() {} };
  const props = { model: model(), actions, concern: null };
  const entry = GrowthConcernManualFallback(props);
  assert.equal(entry.type, 'SummaryDisclosure');
  assert.equal(entry.props.label, '手動新增關注');
  assert.equal(GrowthConcernManualFallback({ ...props, concern: { id: 'concern-1' } }).props.label, '手動管理關注');
  const { SummaryDisclosure } = load('../src/components/summary/SummaryDisclosure.tsx');
  const disclosure = SummaryDisclosure(entry.props);
  assert.equal(named(disclosure, 'Pressable')[0].props['aria-expanded'], false);
  assert.equal(named(disclosure, 'MotionDisclosure')[0].props.expanded, false);
  for (const access of ['read_only', 'lost']) assert.equal(GrowthConcernManualFallback({ ...props, model: { ...model(), access } }), null);
  assert.equal(GrowthConcernManualFallback({ ...props, actions: {} }), null);
});

test('chat entry passes through the existing navigation guard before routing to chat', () => {
  const routed = [], queued = [];
  const workspace = { scopeKey: 'synthetic:child', model: model(), actions: {} };
  const { GrowthScreen } = load('../src/screens/GrowthScreen.tsx', {
    'expo-router': { useRouter: () => ({ push: path => routed.push(path) }), useLocalSearchParams: () => ({}) },
    '../preview/PreviewNavigationGuard': { usePreviewNavigation: () => callback => queued.push(callback) },
    '../production/ProductionProvider': { useProduction: () => ({ model: { selectedChildId: 'child', children: [{ id: 'child' }] }, actions: {} }) },
    '../workspaces/GrowthWorkspace': { useGrowthWorkspace: () => workspace },
    '../workspaces/TasksWorkspace': { useTasksWorkspace: () => null },
    '../production/TaskKnowledgeDomains': { useProductionFamilyDocuments: () => null },
  });
  const tree = GrowthScreen();
  tree.props.onChat();
  assert.equal(queued.length, 1);
  assert.deepEqual(routed, [], 'No route change before the guard permits navigation');
  queued[0]();
  assert.deepEqual(routed, ['/chat']);
});
