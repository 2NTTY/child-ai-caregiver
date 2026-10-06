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
function renderTasks(readState, { items, operation = 'idle', online = true, history = false } = {}) {
  const fixture = createTaskFixture('copy-child', 'normal');
  const model = { ...fixture, child: { id: 'copy-child', displayName: 'Test child' }, access: 'editable', online,
    items: items ?? fixture.items, readState, reading: readState === 'loading', loadingMoreTasks: false,
    scheduleContext: taskPreviewClock, hasMoreTasks: false, selected: null, draft: null,
    operation: { state: operation, message: '' }, dataLabel: '家庭共享事項' };
  let retries = 0;
  const recovery = { reloadCurrent: () => { retries++; } };
  const source = readFileSync(new URL(history ? '../src/components/tasks/TaskHistoryView.tsx' : '../src/components/tasks/TasksView.tsx', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  const module = { exports: {} };
  const resolve = name => {
    if (name === 'react') return { useState: initial => [initial, () => {}], useRef: initial => ({ current: initial }), useEffect() {}, useLayoutEffect() {}, useId: () => 'tasks-copy' };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (name === 'react-native') return { ...elements, View: 'View', Pressable: 'Pressable', Platform: { OS: 'web' }, StyleSheet: { create: value => value } };
    if (name === 'react-native-paper') return { Text: 'Text', TextInput: { Icon: 'Icon' } };
    if (name === 'luxon') return { DateTime };
    if (name.endsWith('/task-view-model')) return taskViewModel;
    if (name === './task-calendar') return calendar;
    if (name === './TaskContent') return { taskAssigneeLabel: () => 'Test assignee' };
    if (name.endsWith('/workspaces/TasksWorkspace')) return { useTasksWorkspace: () => ({ model, actions: {}, recovery }) };
    if (name.endsWith('/theme')) return { colors: {}, spacing: {}, mobileLayout: { breakpoint: 650 }, mobileType: {}, readingType: {}, workspaceType: {} };
    if (name.endsWith('/useContainerWidth')) return { useContainerWidth: () => ({ width: 1440, ref: null, onLayout() {} }) };
    return elements;
  };
  new Function('require', 'module', 'exports', output.outputText)(resolve, module, module.exports);
  return { tree: history ? module.exports.TaskHistoryView({ searchText: '', dateRange: { from: null, to: null } }) : module.exports.TasksView({ model, actions: {}, recovery, onAgent() {}, onHistory() {} }), retries: () => retries };
}
function nodes(value) {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== 'object') return [];
  return [value, ...nodes(value.props?.children)];
}
const named = (tree, type) => nodes(tree).filter(node => node.type === type);

test('initial task read failure stays an error, hides unknown counts and offers the existing read retry', () => {
  const state = renderTasks('error', { items: [] });
  const notice = named(state.tree, 'ReadStateNotice')[0];
  assert.equal(notice.props.state, 'error');
  assert.match(notice.props.message, /未能讀取事項/);
  assert.doesNotMatch(notice.props.message, /沒有符合|暫時沒有/);
  assert.equal(named(state.tree, 'UnderlineTabs')[0].props.items[0].label, '待處理');
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

test('only successful empty reads show filter-empty copy, while loading stays a single read status', () => {
  const empty = renderTasks('ready', { items: [] });
  const notice = named(empty.tree, 'ReadStateNotice')[0];
  assert.equal(notice.props.state, 'empty'); assert.equal(notice.props.message, '沒有符合篩選的事項。');
  assert.ok(named(notice, 'AppButton').some(node => node.props.label === '清除篩選'));
  const loading = renderTasks('loading', { items: [] });
  assert.equal(named(loading.tree, 'ReadStateNotice').length, 1);
  assert.equal(named(loading.tree, 'ReadStateNotice')[0].props.message, '正在讀取事項…');
  assert.equal(named(loading.tree, 'UnderlineTabs')[0].props.items[0].label, '待處理');
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
