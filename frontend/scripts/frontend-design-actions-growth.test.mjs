// Frontend-design reconstruction: journal composition and original domain-action boundaries.
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
    if (name === 'react-native') return { View: 'View', Pressable: 'Pressable', Platform: { OS: 'web' }, StyleSheet: { create: value => value } };
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

test('all widths expose a concern index, separate reader, and original history/recovery actions', () => {
  for (const width of [320, 390, 1024, 1440]) {
    const { GrowthView: SizedView } = load('../src/components/growth/GrowthView.tsx', {
      '../useContainerWidth': { useContainerWidth: () => ({ width, ref: null, onLayout() {} }) },
    });
    const value = model(), calls = [];
    const concern = {id: 'concern-1', childId: 'child', title: 'Synthetic concern', version: 3, status: 'following', attentionIds: []};
    value.page.concerns.items = [concern]; value.page.canManage = true; value.load = 'error';
    const before = structuredClone(value), actions = {refresh: () => calls.push('refresh'), archiveConcern: (...args) => calls.push(args)};
    const tree = SizedView({model: value, actions, onTask() {}, onHistory: () => calls.push('history'), onChat: () => calls.push('chat'), onTabChange() {}});
    assert.equal(tree.props.title, '關注手冊');
    assert.equal(named(tree, 'GrowthConcernIndex').length, 1);
    assert.equal(named(tree, 'AppSelect').length, 0, 'The concern list is not hidden behind a small-screen picker');
    assert.equal(named(tree, 'GrowthConcernTimeline')[0].props.concern, concern);
    const detail = nodes(tree).find(node => node.props?.testID === 'growth-detail-surface');
    assert.equal(detail.type, 'View'); assert.equal(detail.props.tabIndex, -1);
    const header = named(tree.props.headerActions, 'AppButton');
    header.find(node => node.props.accessibilityLabel === '查看關注歷史').props.onPress();
    header.find(node => node.props.accessibilityLabel === '重讀成長關注並保留草稿').props.onPress();
    const archive = named(tree, 'GrowthArchiveConcernButton')[0];
    archive.props.onConfirm();
    assert.deepEqual(calls, ['history', 'refresh', ['concern-1', 3, 'auth:1']]);
    const group = named(tree, 'GrowthConcernActions')[0];
    assert.equal(named(group.props.primary, 'GrowthConcernManualFallback')[0].props.concern, concern);
    assert.deepEqual(value, before);
    const pending = SizedView({model: {...value, pending: {original: true}, busy: true}, actions, onTask() {}, onTabChange() {}});
    assert.equal(named(pending.props.headerActions, 'AppButton').find(node => node.props.accessibilityLabel === '重讀並核對原操作').props.disabled, true);
  }
});

test('an intentional small-screen index choice moves to its reader without writing', () => {
  const {GrowthView: SmallView} = load('../src/components/growth/GrowthView.tsx', {
    '../useContainerWidth': {useContainerWidth: () => ({width: 390, ref: null, onLayout() {}})},
  });
  const value = model(); value.page.concerns.items = [{id: 'concern-1', childId: 'child', title: 'Synthetic', status: 'following', attentionIds: []}];
  const tree = SmallView({model: value, actions: {}, onTask() {}, onTabChange() {}}), moves = [];
  const detail = nodes(tree).find(node => node.props?.testID === 'growth-detail-surface');
  detail.props.ref.current = {scrollIntoView: options => moves.push(['scroll', options]), focus: options => moves.push(['focus', options])};
  assert.deepEqual(moves, []);
  named(tree, 'GrowthConcernIndex')[0].props.onSelect('concern-1');
  assert.deepEqual(moves, [['scroll', {block: 'start', behavior: 'auto'}], ['focus', {preventScroll: true}]]);
});

test('empty guidance remains distinct from failed, offline, unavailable and lost access', () => {
  assert.equal(named(view(model(), {onChat() {}}), 'EmptyListCard').length, 1);
  for (const change of [value => value.online = false, value => value.load = 'error', value => value.access = 'lost', value => value.page = null]) {
    const value = model(); change(value);
    assert.equal(named(view(value), 'EmptyListCard').length, 0);
  }
  const value = model(); value.page.concerns.items = [{id: 'closed', childId: 'child', title: 'Closed', status: 'closed', attentionIds: []}];
  assert.equal(named(view(value), 'GrowthConcernIndex').length, 0);
  assert.equal(named(view({...value, access: 'lost'}), 'GrowthConcernActions').length, 0);
});

test('manual-entry labels describe the action while retaining the original permission and dialog contracts', () => {
  const {GrowthConcernManualFallback} = load('../src/components/growth/GrowthConcernManualFallback.tsx');
  const props = {model: model(), actions: {createConcern() {}, updateConcern() {}}, concern: null};
  const create = GrowthConcernManualFallback(props);
  assert.equal(create.type, 'ManualFormDialog'); assert.equal(create.props.label, '新增關注'); assert.equal(create.props.scopeKey, props.model.scopeKey);
  const update = GrowthConcernManualFallback({...props, concern: {id: 'concern-1'}});
  assert.equal(update.props.label, '新增／補充觀察'); assert.equal(update.props.title, '新增／跟進關注');
  for (const access of ['read_only', 'lost']) assert.equal(GrowthConcernManualFallback({...props, model: {...props.model, access}}), null);
  assert.equal(GrowthConcernManualFallback({...props, actions: {}}), null);
});
