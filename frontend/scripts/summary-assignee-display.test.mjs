import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import ts from 'typescript';
import {z} from 'zod';
import {taskValuesSchema} from '../../src/shared/tasks.ts';
import {careKindOptions} from '../src/care-view-model.ts';
import {taskStateLabels} from '../src/task-view-model.ts';
import {summaryTime} from '../src/summary-view-model.ts';

// Synthetic shallow composition only: no API, model, browser or alternative name owner.
const jsx = (type, props) => ({type, props});
const elements = new Proxy({}, {get: (_target, key) => String(key)});
const dependencies = {
  'react/jsx-runtime': {jsx, jsxs: jsx, Fragment: 'Fragment'},
  'react-native': {View: 'View'}, 'react-native-paper': {Text: 'Text'},
  '../../care-view-model': {careKindOptions}, '../../task-view-model': {taskStateLabels},
  '../../summary-view-model': {summaryTime}, './summary-styles': {summaryStyles: {}},
};
const source = readFileSync(new URL('../src/components/summary/SummaryRecords.tsx', import.meta.url), 'utf8');
const module = {exports: {}};
new Function('require', 'module', 'exports', ts.transpileModule(source, {
  compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022},
}).outputText)(name => dependencies[name] ?? elements, module, module.exports);
const {SummaryRecords} = module.exports;
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes)
  : [tree, ...nodes(tree.props?.children)];
const text = tree => tree == null || typeof tree === 'boolean' ? '' : Array.isArray(tree) ? tree.map(text).join('')
  : typeof tree === 'object' ? text(tree.props?.children) : String(tree);
const motion = {scopeKey: 'synthetic-summary-scope', triggerKey: null, eligible: false};
const at = '2026-10-22T08:00:00Z';
const taskA = {
  id: '71000000-0000-4000-8000-000000000001', childId: '71000000-0000-4000-8000-000000000002',
  version: 2, title: '合成預約 A', details: '合成安排詳情 A', kind: 'appointment',
  assigneeUserId: '72000000-0000-4000-8000-000000000001',
  createdBy: '72000000-0000-4000-8000-000000000001', createdAt: at, updatedAt: at,
  occurrence: {id: '73000000-0000-4000-8000-000000000001', dueAt: at, timeZone: 'Asia/Hong_Kong', state: 'scheduled', terminalBasisVersion: null},
};
const taskB = {...taskA, id: '71000000-0000-4000-8000-000000000003', title: '合成待覆核 B', details: '合成安排詳情 B',
  assigneeUserId: '72000000-0000-4000-8000-000000000002',
  occurrence: {...taskA.occurrence, id: '73000000-0000-4000-8000-000000000002', state: 'needs_review', terminalBasisVersion: 1}};
function rows(appointments, conflicts = [], onTask = () => {}) {
  const page = {counts: Object.fromEntries(careKindOptions.map(kind => [kind.value, 0])), metrics: [], records: [],
    missing: {unknownEventTime: 0, invalidQuantities: 0, emptyKinds: []}, appointments, conflicts};
  return nodes(SummaryRecords({page, motion, onTask, onRecord() {}}))
    .filter(node => node.type?.name === 'TaskSource').map(node => ({task: node.props.task, tree: node.type(node.props)}));
}
function primaryReadout(tree) {
  const readout = nodes(tree).find(node => node.type?.name === 'Readout');
  const reveal = readout.type(readout.props);
  return reveal.props.children(reveal.props.value);
}

test('assigned summary appointments and conflicts use an honest fallback, not raw IDs or inferred names', () => {
  for (const task of [taskA, taskB]) {
    assert.equal(z.uuid().safeParse(task.assigneeUserId).success, true);
    assert.equal(taskValuesSchema.safeParse({title: task.title, details: task.details, kind: task.kind,
      assigneeUserId: task.assigneeUserId, dueAt: task.occurrence.dueAt, timeZone: task.occurrence.timeZone}).success, true);
  }
  const rendered = rows([taskA], [taskB]);
  assert.equal(rendered.length, 2);
  for (const {tree} of rendered) {
    const visible = text(primaryReadout(tree));
    assert.ok(visible.includes('負責人：見原安排 · Asia/Hong_Kong'));
    for (const task of [taskA, taskB]) assert.equal(visible.includes(task.assigneeUserId), false);
    assert.doesNotMatch(visible, /未指定|未分配|本人|家人/);
  }
});

test('a missing assignee uses unassigned wording without claiming null is a supported API value', () => {
  // The current wire contract requires a nonempty ID; this is defensive presentation coverage only.
  const [{tree}] = rows([{...taskA, assigneeUserId: null}]);
  const visible = text(primaryReadout(tree));
  assert.ok(visible.includes('負責人：未指定 · Asia/Hong_Kong'));
  assert.doesNotMatch(visible, /見原安排/);
});

test('both summary rows keep exact task callbacks and their existing source/version disclosure', () => {
  const selected = [];
  for (const {task, tree} of rows([taskA], [taskB], id => selected.push(id))) {
    nodes(tree).find(node => node.type === 'AppButton' && node.props.label === '核對這項任務').props.onPress();
    const disclosure = nodes(tree).find(node => node.type === 'SummaryDisclosure');
    assert.equal(disclosure.props.label, '安排詳情與來源版本');
    assert.equal(disclosure.props.scopeKey, `${motion.scopeKey}:${task.id}`);
    const detail = text(disclosure);
    for (const original of [task.details, task.createdBy, `原任務 ${task.id}`, `版本 ${task.version}`, `事項 ${task.occurrence.id}`]) {
      assert.ok(detail.includes(original));
    }
  }
  assert.deepEqual(selected, [taskB.id, taskA.id]);
});
