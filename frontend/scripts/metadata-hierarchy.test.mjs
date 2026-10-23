import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { DateTime } from 'luxon';
import * as preparations from '../src/preparation-view-model.ts';
import * as tasks from '../src/task-view-model.ts';

// Synthetic component projections only; no browser, API or owner mutations.
const jsx = (type, props, key) => ({ type, props, key });
const elements = new Proxy({}, { get: (_, key) => String(key) });
function load(file, { sourceOpen = false } = {}) {
  let stateIndex = 0;
  const source = readFileSync(new URL(`../src/components/${file}`, import.meta.url), 'utf8');
  const result = ts.transpileModule(source, { fileName: file, reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  assert.deepEqual(result.diagnostics, []);
  const resolve = name => {
    if (name === 'react') return { useState: value => [stateIndex++ === 0 && sourceOpen ? true : value, () => {}], useRef: value => ({ current: value }), useEffect() {}, useLayoutEffect() {} };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (name === 'react-native') return { ...elements, StyleSheet: { create: value => value }, Platform: { OS: 'web' } };
    if (name === 'react-native-paper') return { Text: 'Text' };
    if (name === 'luxon') return { DateTime };
    if (name.endsWith('/preparation-view-model')) return preparations;
    if (name.endsWith('/task-view-model')) return tasks;
    if (name.endsWith('/growth-view-model')) return { growthConcernTimelineEntries: (_, page) => page.entries, growthConcernFollowUpLabel: () => null, growthTime: value => value, growthStateLabels: { dismissed: '已關閉' } };
    if (name.endsWith('/growth-styles')) return { growthStyles: { row: { flexDirection: 'row', flexWrap: 'wrap' }, meta: { flexShrink: 1 } } };
    if (name.endsWith('/theme')) return { chineseFont: 'font', colors: {}, radius: {}, spacing: { xs: 4, sm: 8, md: 12, lg: 16 }, readingType: {} };
    return elements;
  };
  const module = { exports: {} };
  const expose = file.startsWith('preparations/') ? '\nexports.PreparationRow = PreparationRow; exports.PreparationDocumentDetail = PreparationDocumentDetail;' : '';
  new Function('require', 'module', 'exports', result.outputText + expose)(resolve, module, module.exports);
  return module.exports;
}
function expand(tree) {
  if (Array.isArray(tree)) return tree.map(expand);
  if (!tree || typeof tree !== 'object') return tree;
  if (typeof tree.type === 'function') return expand(tree.type(tree.props));
  if (tree.type === 'MotionReveal') return expand(tree.props.children(tree.props.value));
  return { ...tree, props: { ...tree.props, children: expand(tree.props.children) } };
}
function nodes(tree) { return Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : []; }
const named = (tree, type) => nodes(tree).filter(node => node.type === type);
function text(tree) { return Array.isArray(tree) ? tree.map(text).join('') : tree && typeof tree === 'object' ? text(tree.props?.children) : typeof tree === 'string' || typeof tree === 'number' ? String(tree) : ''; }
const labels = tree => nodes(tree).map(node => node.props?.accessibilityLabel).filter(Boolean);
const document = () => ({ id: 'doc-a', childId: 'child-a', purpose: 'appointment', version: 2, status: 'active', archivedAt: null, readState: 'ready',
  revision: { id: 'rev-a', number: 1, title: 'Synthetic preparation', summary: 'Read this preparation first', eventDate: null, updatedAt: '2026-10-22T01:00:00Z', sourceAsOf: null,
    sections: [], sourceRefs: [{ id: 'source-a', version: 1 }] },
  sources: [{ id: 'source-a', label: 'Synthetic source', visibility: 'private', version: 2, updatedAt: null }] });
function workspace(doc, role = 'owner') { return { scopeKey: 'scope-a', model: { child: { displayName: 'Synthetic child' }, scope: { authorityKey: 'scope-a', childId: 'child-a', online: true, role, condition: 'ready' }, online: true, condition: 'ready', capabilities: { archive: true, checkItem: true } }, actions: { archiveDocument() {}, checkItem() {} } }; }
const task = () => ({ id: 'task-a', kind: 'ordinary', version: 3, title: 'Synthetic task', details: 'Read this task first', assigneeUserId: 'parent-a', createdAt: '2026-10-20T01:00:00Z', updatedAt: '2026-10-21T01:00:00Z', completedAt: '2026-10-22T01:00:00Z', occurrence: { state: 'completed', dueAt: '2026-10-21T08:30:00Z', timeZone: 'Asia/Hong_Kong' } });

test('preparation title and body precede neutral metadata and omit only the empty optional event date', () => {
  const { PreparationRow } = load('preparations/PreparationWorkspace.tsx');
  const doc = document(); let opens = 0;
  const tree = expand(PreparationRow({ document: doc, selected: false, onPress: () => opens++, rowRef() {} }));
  const texts = named(tree, 'Text').map(text);
  assert.deepEqual(texts.slice(0, 2), ['Synthetic preparation', 'Read this preparation first']);
  assert.ok(texts.includes('到診準備'));
  assert.doesNotMatch(text(tree), /日期未提供|使用日期/);
  assert.deepEqual(named(tree, 'AppStatusBadge').map(node => node.props.label), ['可查閱']);
  assert.ok(labels(tree).includes('用途：到診準備'));
  tree.props.onPress(); assert.equal(opens, 1);
  const archived = expand(PreparationRow({ document: { ...doc, status: 'archived' }, selected: false, history: true, onPress() {}, rowRef() {} }));
  assert.match(text(archived), /歸檔 日期未提供/);
});

test('preparation details retain source freshness, private scope, revision disclosure and unavailable warnings', () => {
  const doc = document();
  const { PreparationDocumentDetail } = load('preparations/PreparationWorkspace.tsx', { sourceOpen: true });
  const tree = expand(PreparationDocumentDetail({ document: doc, workspace: workspace(doc), onClose() {} }));
  assert.deepEqual(named(tree, 'Text').slice(0, 2).map(text), ['Synthetic preparation', 'Read this preparation first']);
  assert.ok(!labels(tree).some(label => label.startsWith('使用日期：')));
  assert.match(text(tree), /資料截至 日期未提供/);
  assert.match(text(tree), /私人來源/); assert.match(text(tree), /已有較新版本/);
  assert.ok(named(tree, 'AppButton').find(node => node.props.label === '來源與版本').props.expanded);
  assert.match(text(tree), /正文版本 1 · 文件版本 2/);
  for (const state of ['stale', 'restricted', 'invalidated', 'unknown']) {
    const blocked = { ...doc, readState: state, revision: state === 'stale' ? doc.revision : null };
    const Detail = load('preparations/PreparationWorkspace.tsx').PreparationDocumentDetail;
    const warning = expand(Detail({ document: blocked, workspace: workspace(blocked, 'viewer'), onClose() {} }));
    assert.match(text(warning), /較早資料|權限已改變|來源已失效|尚未確認/);
    assert.equal(named(warning, 'AppButton').find(node => node.props.label === '使用完畢，歸檔').props.disabled, true);
  }
});

test('task metadata keeps assignee and due-time meaning, status, eligibility warnings and motion parity', () => {
  const { TaskSnapshot } = load('tasks/TaskContent.tsx');
  const item = task(), assignees = [{ userId: 'parent-a', name: 'Synthetic parent' }];
  const tree = expand(TaskSnapshot({ task: item, assignees }));
  assert.deepEqual(named(tree, 'Text').slice(0, 2).map(text), ['Synthetic task', 'Read this task first']);
  assert.ok(labels(tree).includes('負責人：Synthetic parent'));
  assert.match(text(tree), /預定完成 2026年10月21日 16:30/);
  assert.doesNotMatch(text(tree), /2026年10月22日/);
  assert.equal(named(tree, 'AppStatusBadge')[0].props.label, '已完成');
  assert.equal(named(tree, 'AppStatusBadge')[0].props.tone, 'success');
  const animated = expand(TaskSnapshot({ task: item, assignees, motion: { scopeKey: 'scope-a', triggerKey: 1, eligible: true } }));
  assert.deepEqual(labels(animated), labels(tree));
  const missing = expand(TaskSnapshot({ task: { ...item, details: '', occurrence: { ...item.occurrence, state: 'scheduled' } }, assignees: [], announceEligibility: true, compact: true }));
  assert.doesNotMatch(text(missing), /沒有詳細內容/); assert.match(text(missing), /原負責人已不具執行資格/);
  assert.equal(named(missing, 'StatusAnnouncement')[0].props.urgent, true);
  assert.doesNotMatch(text(missing), /版本 3|加入 /);
});

test('growth event kinds are neutral icon-text metadata while real states and source limits remain explicit', () => {
  const { GrowthConcernTimeline } = load('growth/GrowthConcernTimeline.tsx');
  const calls = [], kinds = ['agent_proposal', 'observation', 'pending_record', 'confirmed_action'];
  const entries = kinds.map((kind, i) => ({ kind: 'event', event: { id: `event-${i}`, kind, title: `Title ${i}`, text: `Body ${i}`, at: `2026-10-${20 + i}`, recordId: i === 1 ? 'record-a' : undefined, taskId: i === 3 ? 'task-a' : undefined } }));
  entries.push({ kind: 'attention_state', item: { id: 'attention-a', version: 1, updatedAt: 'invalid', state: 'dismissed', title: 'Prior suggestion', sourceAvailable: false } });
  const tree = expand(GrowthConcernTimeline({ concern: { id: 'concern-a', title: 'Concern', reason: 'Reason', status: 'following', historyComplete: false }, page: { entries }, onRecord: id => calls.push(['record', id]), onTask: id => calls.push(['task', id]) }));
  const badges = named(tree, 'AppStatusBadge').map(node => [node.props.label, node.props.tone]);
  assert.deepEqual(badges, [['持續關注', 'info'], ['待核對記錄', 'warning'], ['已確認操作', 'success'], ['建議已關閉', 'neutral']]);
  assert.ok(labels(tree).includes('事件種類：助手提議')); assert.ok(labels(tree).includes('事件種類：原始觀察'));
  assert.ok(labels(tree).includes('事件時間：2026-10-20')); assert.match(text(tree), /時間未提供/);
  assert.match(text(tree), /來源或依據已失效/); assert.match(text(tree), /較早經過仍未完整載入/);
  for (const label of ['查看原始記錄', '前往待核對記錄', '查看已連結跟進']) named(tree, 'AppButton').find(node => node.props.label === label).props.onPress();
  assert.deepEqual(calls, [['record', 'record-a'], ['record', undefined], ['task', 'task-a']]);
});
