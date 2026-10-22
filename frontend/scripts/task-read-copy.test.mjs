import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { DateTime } from 'luxon';
import * as taskViewModel from '../src/task-view-model.ts';
import * as calendar from '../src/components/tasks/task-calendar.ts';
import { createTaskFixture, taskPreviewClock } from '../src/preview/task-fixture.ts';

// Pure component projections. No API calls or browser/layout claims.
const jsx = (type, props) => ({ type, props });
const elements = new Proxy({}, { get: (_target, key) => String(key) });
function renderTasks(readState, { items, operation = 'idle', online = true, history = false, refreshing = false, hasMoreTasks = false, tab = 'pending', query = '', calendarOpen = false, width = 1440, dateRange = { from: null, to: null } } = {}) {
  const fixture = createTaskFixture('copy-child', 'normal');
  const model = { ...fixture, child: { id: 'copy-child', displayName: 'Test child' }, access: 'editable', online,
    items: items ?? fixture.items, readState, reading: refreshing || readState === 'loading', loadingMoreTasks: false,
    scheduleContext: taskPreviewClock, hasMoreTasks, selected: null, draft: null,
    operation: { state: operation, message: '' }, dataLabel: '家庭共享事項' };
  let retries = 0;
  const recovery = { reloadCurrent: () => { retries++; } };
  const source = readFileSync(new URL(history ? '../src/components/tasks/TaskHistoryView.tsx' : '../src/components/tasks/TasksView.tsx', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  const module = { exports: {} };
  const resolve = name => {
    if (name === 'react') return { useState: initial => [initial === 'pending' ? tab : initial === '' ? query : initial === false ? calendarOpen : initial, () => {}], useRef: initial => ({ current: initial }), useEffect() {}, useLayoutEffect() {}, useId: () => 'tasks-copy' };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (name === 'react-native') return { ...elements, View: 'View', Pressable: 'Pressable', Platform: { OS: 'web' }, StyleSheet: { create: value => value } };
    if (name === 'react-native-paper') return { Text: 'Text', TextInput: { Icon: 'Icon' } };
    if (name.endsWith('/appearance/BackgroundSurface')) return { BackgroundSurface: 'View', useCustomBackground: () => false };
    if (name === 'luxon') return { DateTime };
    if (name.endsWith('/task-view-model')) return taskViewModel;
    if (name === './task-calendar') return calendar;
    if (name === './TaskContent') return { taskAssigneeLabel: () => 'Test assignee' };
    if (name.endsWith('/workspaces/TasksWorkspace')) return { useTasksWorkspace: () => ({ model, actions: {}, recovery }) };
    if (name.endsWith('/theme')) return { colors: {}, spacing: { sm: 8, md: 12, lg: 16, xl: 24 }, mobileLayout: { breakpoint: 650 }, mobileType: {}, readingType: {}, workspaceType: {} };
    if (name.endsWith('/useContainerWidth')) return { useContainerWidth: () => ({ width, ref: null, onLayout() {} }) };
    return elements;
  };
  new Function('require', 'module', 'exports', output.outputText)(resolve, module, module.exports);
  return { tree: history ? module.exports.TaskHistoryView({ searchText: query, dateRange }) : module.exports.TasksView({ model, actions: {}, recovery, onAgent() {}, onHistory() {} }), retries: () => retries };
}
function nodes(value) {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object') return [];
  // TabToolbar renders its action slot beside children in the real component.
  return [value, ...nodes(value.props?.children), ...nodes(value.type === "TabToolbar" ? value.props?.actions : null)];
}
const named = (tree, type) => nodes(tree).filter(node => node.type === type);

test('completed tab uses concise copy without changing its domain key', () => {
  const state = renderTasks('ready');
  const completed = named(state.tree, 'UnderlineTabs')[0].props.items.find(item => item.key === 'completed');
  assert.deepEqual(completed, { key: 'completed', label: '已完成' });
});

test('initial task read failure stays an error, hides unknown counts and offers the existing read retry', () => {
  const state = renderTasks('error', { items: [] });
  const notice = named(state.tree, 'ReadStateNotice')[0];
  assert.equal(notice.props.state, 'error');
  assert.match(notice.props.message, /未能讀取事項/);
  assert.doesNotMatch(notice.props.message, /沒有符合|暫時沒有/);
  assert.deepEqual(named(state.tree, 'UnderlineTabs')[0].props.items[0], { key: 'pending', label: '待處理', count: undefined });
  assert.equal(named(state.tree, 'TasksCalendar').length, 0);
  assert.equal(named(state.tree, 'MotionList').length, 0);
  const retry = named(notice, 'AppButton').find(node => node.props.label === '重新讀取事項');
  assert.equal(retry.props.disabled, false); retry.props.onPress(); assert.equal(state.retries(), 1);
  assert.equal(named(state.tree, 'AppButton').find(node => node.props.label === '手動新增').props.disabled, true);
});

test('failed refresh keeps retained task rows explicitly stale and leaves original-operation recovery intact', () => {
  const state = renderTasks('stale', { operation: 'unknown' });
  const notice = named(state.tree, 'ReadStateNotice')[0];
  assert.equal(notice.props.state, 'stale');
  assert.match(notice.props.message, /上次讀取/);
  assert.ok(named(state.tree, 'MotionList').some(node => node.props.items.length));
  assert.equal(named(state.tree, 'WriteRecoveryNotice')[0].props.operation.state, 'unknown');
  assert.equal(named(notice, 'AppButton')[0].props.disabled, true);
});

test('successful complete empty reads show a clear card without redundant counts or irrelevant filter controls', () => {
  const empty = renderTasks('ready', { items: [] });
  const card = named(empty.tree, 'EmptyListCard').find(node => node.props.testID === 'tasks-empty-card');
  assert.ok(card);
  assert.equal(card.props.title, '暫無待辦');
  assert.equal(card.props.icon, 'clipboard-check-outline');
  assert.ok(named(empty.tree, 'StatusAnnouncement').some(node => node.props.message === '暫無待辦'));
  assert.ok(card.props.style.minHeight >= 160);
  assert.ok(card.props.style.padding >= 24);
  assert.deepEqual(named(empty.tree, 'UnderlineTabs')[0].props.items[0], { key: 'pending', label: '待處理', count: '0' });
  assert.equal(named(empty.tree, 'AppTextField').length, 0);
  assert.equal(named(empty.tree, 'AppSelect').length, 0);
  assert.equal(named(empty.tree, 'Text').some(node => JSON.stringify(node.props.children).includes('已載入')), false);
  assert.equal(named(empty.tree, 'AppButton').some(node => node.props.label === '清除篩選'), false);
  assert.equal(named(empty.tree, 'ReadStateNotice').length, 0);
});

test('loading, error, stale and offline reads never present the successful empty card', () => {
  for (const [readState, online] of [['loading', true], ['error', true], ['stale', true], ['ready', false]]) {
    const state = renderTasks(readState, { items: [], online });
    assert.equal(named(state.tree, 'EmptyListCard').some(node => node.props.testID === 'tasks-empty-card'), false);
    assert.equal(named(state.tree, 'ReadStateNotice').length, 1);
    assert.notEqual(named(state.tree, 'ReadStateNotice')[0].props.state, 'empty');
  }
  const loading = renderTasks('loading', { items: [] });
  assert.equal(named(loading.tree, 'ReadStateNotice')[0].props.message, '正在讀取事項…');
  assert.equal(named(loading.tree, 'UnderlineTabs')[0].props.items[0].label, '待處理');
});

test('filtered-empty, partial-loaded and completed states keep their distinct meaning in cards', () => {
  const filtered = renderTasks('ready', { query: 'No matching task title' });
  const filteredCard = named(filtered.tree, 'EmptyListCard').find(node => node.props.testID === 'tasks-empty-card');
  assert.equal(filteredCard.props.title, '沒有符合篩選的事項');
  assert.ok(named(filteredCard, 'AppButton').some(node => node.props.label === '清除篩選'));
  assert.ok(named(filtered.tree, 'AppTextField').length);

  const partial = renderTasks('ready', { items: [], hasMoreTasks: true });
  const partialCard = named(partial.tree, 'EmptyListCard').find(node => node.props.testID === 'tasks-empty-card');
  assert.equal(partialCard.props.title, '已載入的事項中暫無待辦');
  assert.ok(named(partial.tree, 'AppButton').some(node => node.props.label === '載入更多事項'));
  assert.deepEqual(named(partial.tree, 'UnderlineTabs')[0].props.items[0], { key: 'pending', label: '待處理', count: '0+' });

  const completed = renderTasks('ready', { items: [], tab: 'completed' });
  const completedCard = named(completed.tree, 'EmptyListCard').find(node => node.props.testID === 'tasks-empty-card');
  assert.equal(completedCard.props.title, '暫無已完成的事項');
  assert.equal(named(completedCard, 'AppButton').length, 0);
  assert.equal(named(completed.tree, 'MotionList').length, 0);
  assert.equal(named(completed.tree, 'Text').some(node => JSON.stringify(node.props.children).includes('只顯示最近')), false);
});

test('real task action copy retains the confirmation and history callbacks without simulation claims', () => {
  const form = readFileSync(new URL('../src/components/tasks/TaskForm.tsx', import.meta.url), 'utf8');
  assert.match(form, /draft\.mode === "create" \? "確認建立共享事項" : "確認保存更改"/);
  assert.match(form, /if \(confirmed\) actions\.submitReviewed\(\)/);
  assert.doesNotMatch(form, /確認家庭共享並模擬/);
  const detail = readFileSync(new URL('../src/components/tasks/TaskDetail.tsx', import.meta.url), 'utf8');
  assert.match(detail, /label="載入較早記錄"[^>]+onPress=\{actions\.loadOlderHistory\}/);
});


test('task history preserves the same failed-versus-stale distinction without unknown result counts', () => {
  const failed = renderTasks('error', { history: true, items: [] });
  assert.equal(named(failed.tree, 'ReadStateNotice')[0].props.state, 'error');
  assert.equal(named(failed.tree, 'Text').some(node => JSON.stringify(node.props.children).includes('項符合')), false);
  const retry = named(failed.tree, 'AppButton').find(node => node.props.label === '重新讀取事項');
  assert.equal(retry.props.disabled, false); retry.props.onPress(); assert.equal(failed.retries(), 1);
  const stale = renderTasks('stale', { history: true });
  assert.equal(named(stale.tree, 'ReadStateNotice')[0].props.state, 'stale');
  assert.ok(named(stale.tree, 'TaskListRow').length > 0);
});


test('same-scope task refresh keeps the existing list and count without a loading notice', () => {
  for (const history of [false, true]) {
    const state = renderTasks('ready', { refreshing: true, history });
    const notice = named(state.tree, 'ReadStateNotice')[0];
    assert.notEqual(notice.props.state, 'loading');
    assert.doesNotMatch(notice.props.message, /正在讀取|正在載入/);
    assert.equal(named(notice, 'AppButton').some(node => node.props.label === '重新讀取事項'), false);
    assert.ok(named(state.tree, 'MotionList').some(node => node.props.items.length) || named(state.tree, 'TaskList').length || history);
  }
  const empty = renderTasks('ready', { items: [], refreshing: true });
  assert.equal(named(empty.tree, 'ReadStateNotice').length, 0);
  assert.ok(named(empty.tree, 'EmptyListCard').some(node => node.props.testID === 'tasks-empty-card'));
});


test('pending tabs keep the text separate from their count at zero, one and higher values', () => {
  const fixture = createTaskFixture('copy-child', 'normal');
  const pending = taskViewModel.pendingTasks(fixture.items);
  for (const count of [0, 1, 4]) {
    const state = renderTasks('ready', { items: pending.slice(0, count) });
    assert.deepEqual(named(state.tree, 'UnderlineTabs')[0].props.items[0], { key: 'pending', label: '待處理', count: String(count) });
  }
});


test('a successful empty mobile list cannot leave an expanded calendar without its toggle', () => {
  const state = renderTasks('ready', { items: [], calendarOpen: true, width: 390 });
  assert.equal(named(state.tree, 'MotionDisclosure').filter(node => named(node, 'TasksCalendar').length > 0).length, 0);
  assert.equal(named(state.tree, 'TasksCalendar').length, 0);
  assert.ok(named(state.tree, 'EmptyListCard').some(node => node.props.testID === 'tasks-empty-card'));
});


test('completed empty pages qualify their loaded window until the remaining tasks are read', () => {
  const partial = renderTasks('ready', { items: [], tab: 'completed', hasMoreTasks: true });
  const card = named(partial.tree, 'EmptyListCard').find(node => node.props.testID === 'tasks-empty-card');
  assert.equal(card.props.title, '已載入的事項中暫無已完成的事項');
  assert.ok(named(partial.tree, 'AppButton').some(node => node.props.label === '載入更多事項'));
});

test('task history distinguishes full, filtered and partially loaded empty results without a duplicate zero count', () => {
  for (const [query, hasMoreTasks, expected] of [
    ['', false, '暫無完成或取消的事項'],
    ['', true, '已載入的事項中暫無完成或取消的事項'],
    ['missing task', false, '沒有符合篩選的事項'],
    ['missing task', true, '已載入的事項中沒有符合篩選的事項'],
  ]) {
    const state = renderTasks('ready', { history: true, items: [], query, hasMoreTasks });
    const notice = named(state.tree, 'ReadStateNotice')[0];
    assert.equal(notice.props.state, 'empty');
    assert.equal(notice.props.message, expected);
    assert.equal(named(state.tree, 'Text').some(node => JSON.stringify(node.props.children).includes('項符合')), false);
    assert.equal(named(state.tree, 'AppButton').some(node => node.props.label === '載入更多事項'), hasMoreTasks);
  }
  const byDate = renderTasks('ready', { history: true, items: [], dateRange: { from: '2026-10-01', to: null } });
  assert.equal(named(byDate.tree, 'ReadStateNotice')[0].props.message, '沒有符合篩選的事項');
  const populated = renderTasks('ready', { history: true, hasMoreTasks: true });
  assert.ok(named(populated.tree, 'TaskListRow').length > 0);
  assert.ok(named(populated.tree, 'Text').some(node => JSON.stringify(node.props.children).includes('已載入的事項中有 ')));
});

test('task history never claims success-empty for unavailable, stale or offline reads', () => {
  for (const [readState, online] of [['loading', true], ['error', true], ['stale', true], ['ready', false]]) {
    const state = renderTasks(readState, { history: true, items: [], online });
    assert.notEqual(named(state.tree, 'ReadStateNotice')[0].props.state, 'empty');
    assert.equal(named(state.tree, 'Text').some(node => JSON.stringify(node.props.children).includes('項符合')), false);
  }
});


test('Tasks removes the repeated visible page title while retaining its stable named content focus target', () => {
  const { tree } = renderTasks('ready');
  const region = nodes(tree).find(node => node.props?.role === 'region' && node.props.accessibilityLabel === '待辦');
  assert.ok(region); assert.equal(region.props.tabIndex, -1);
  assert.equal(region.props.dataSet.pageSurface, 'true');
  assert.ok(!named(tree, 'Text').some(node => node.props.accessibilityRole === 'header' && node.props.children === '待辦'));
  const form = named(tree, 'FormDialog')[0];
  // The real layout port owns a ref; this shallow fixture does not invoke native refs.
  assert.ok(form.props.returnFocusRef);
  assert.ok(named(tree, 'UnderlineTabs').length);
});


test('page actions share the tab toolbar, with a compact disclosure instead of squeezing the tabs', () => {
  const wide = renderTasks('ready', { width: 1440 }).tree;
  const toolbar = named(wide, 'TabToolbar')[0]; assert.ok(toolbar);
  assert.ok(named(toolbar.props.children, 'UnderlineTabs').length);
  assert.deepEqual(named(toolbar.props.actions, 'AppButton').map(node => node.props.label), ['請助手安排', '手動新增', '歷史']);
  const compact = renderTasks('ready', { width: 320 }).tree;
  const smallToolbar = named(compact, 'TabToolbar')[0];
  assert.equal(smallToolbar.props.actions.props.accessibilityLabel, '待辦操作');
  const menu = nodes(compact).find(node => node.props?.testID === 'tasks-page-actions'); assert.ok(menu);
  assert.deepEqual(named(menu, 'AppButton').map(node => node.props.label), ['請助手安排', '手動新增', '歷史']);
});
