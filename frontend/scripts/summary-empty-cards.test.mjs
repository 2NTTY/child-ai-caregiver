import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import ts from 'typescript';
import {careKindOptions} from '../src/care-view-model.ts';
import {taskStateLabels} from '../src/task-view-model.ts';
import {summaryPeriodLabel, summaryTime} from '../src/summary-view-model.ts';
import {summaryPeriodSchema} from '../src/components/summary/summary-form.ts';

// Deterministic shallow composition with synthetic records only; no API, model or browser access.
const jsx = (type, props) => ({type, props});
const elements = new Proxy({}, {get: (_target, key) => String(key)});
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes)
  : [tree, ...nodes(tree.props?.children), ...nodes(tree.props?.action)];
const cards = tree => nodes(tree).filter(node => node.type === 'EmptyListCard');
const find = (tree, name) => nodes(tree).find(node => node.type === name || node.type?.name === name);
function compile(relative, dependencies = {}) {
  const source = readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');
  const module = {exports: {}};
  const imports = {
    react: {useId: () => 'tabs', useState: initial => [initial, () => {}], useRef: value => ({current: value}), useEffect() {}, useLayoutEffect() {}},
    'react/jsx-runtime': {jsx, jsxs: jsx, Fragment: 'Fragment'},
    'react-native': {Platform: {OS: 'web'}, View: 'View'}, 'react-native-paper': {Text: 'Text'},
    '../../care-view-model': {careKindOptions}, '../../task-view-model': {taskStateLabels},
    '../../summary-view-model': {summaryPeriodLabel, summaryTime, sameSummaryPeriod: (a, b) => JSON.stringify(a) === JSON.stringify(b)},
    '../summary-view-model': {summaryPeriodLabel, summaryTime},
    './summary-form': {summaryPeriodSchema}, '../components/summary/summary-form': {summaryPeriodSchema},
    './summary-styles': {summaryStyles: {}}, '../components/summary/summary-styles': {summaryStyles: {}},
    '../useContainerWidth': {useContainerWidth: () => ({width: 800, ref: {}, onLayout() {}})},
    '../preview/PreviewNavigationGuard': {usePreviewNavigation: () => action => action()},
    ...dependencies,
  };
  new Function('require', 'module', 'exports', ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022}}).outputText)(name => imports[name] ?? elements, module, module.exports);
  return module.exports;
}
const period = {startDay: '2026-10-07', period: 'day', timeZone: 'Asia/Hong_Kong'};
const page = {
  childId: 'synthetic-child', childName: '合成孩子', canManage: true, period, endDayExclusive: '2026-10-08',
  generatedAt: '2026-10-07T08:00:00Z', basisVersion: 'synthetic-basis',
  profile: {version: 1, ageLabel: '年齡未提供', source: '合成來源', confirmedBy: null, confirmedAt: null, reason: null},
  counts: Object.fromEntries(careKindOptions.map(kind => [kind.value, 0])), metrics: [], records: [], appointments: [], conflicts: [],
  missing: {unknownEventTime: 0, invalidQuantities: 0, emptyKinds: []},
  preparation: {version: 1, appointmentTaskId: null, questions: [], checklist: [], reviewed: false, reviewedBasis: null, period: null, updatedBy: null, updatedAt: null}, reviewCurrent: false,
};
const base = {childName: '合成孩子', scopeKey: 'synthetic-scope', dataLabel: '合成摘要', query: period, page,
  online: true, access: 'editable', readFailed: false, busy: false, operation: 'none', notice: '', pending: null,
  originalConsent: false, dirty: false, formEpoch: 1, confirmationEpoch: 1};
const pending = {reference: 'synthetic-operation', confirmed: false, checked: false, appointmentLabel: '沒有指定預約',
  input: {expectedVersion: 1, basisVersion: 'synthetic-basis', period, appointmentTaskId: null, questions: [], checklist: [], reviewed: false}};
const blocked = [{online: false}, {readFailed: true}, {access: 'lost'}, {pending},
  ...['saving', 'failed', 'unknown', 'conflict', 'confirmed_unread'].map(operation => ({operation}))];
const {SummaryRecords} = compile('src/components/summary/SummaryRecords.tsx');
const recordProps = extra => ({page, onRecord() {}, onTask() {}, motion: {scopeKey: base.scopeKey, triggerKey: null, eligible: false}, ...extra});

test('successful empty summary collections use scoped shared cards and default readiness is conservative', () => {
  const tree = SummaryRecords(recordProps({emptyReady: true}));
  assert.deepEqual(cards(tree).map(card => [card.props.testID, card.props.title]), [
    ['summary-metrics-empty', '已載入的記錄沒有數值統計'],
    ['summary-records-empty', '本期間已載入的記錄清單為空'],
    ['summary-appointments-empty', '已載入的待處理預約清單為空'],
  ]);
  assert.equal(cards(tree)[0].props.detail, '只代表本期間已取得的記錄，並非完整期間的總量。');
  assert.equal(cards(tree)[1].props.detail, '沒有記錄不等於沒有發生。');
  assert.equal(cards(tree)[2].props.detail, '只代表目前取得的家庭安排。');
  for (const extra of [{}, {emptyReady: false}]) {
    const withheld = SummaryRecords(recordProps(extra));
    assert.equal(cards(withheld).length, 0);
    assert.equal(nodes(withheld).some(node => node.type === 'Text' && String(node.props.children).includes('本次摘要沒有列出的缺項')), false);
  }
});

test('nonempty summary rows retain their original controls while only the empty collection gets a card', () => {
  const events = [], record = {id: 'synthetic-record', kind: 'note', text: '合成觀察', quantity: null, eventTime: {rawText: '今日', at: '2026-10-07T08:00:00Z', timeZone: 'Asia/Hong_Kong', precision: 'exact'}, source: '合成來源', reason: '測試', confirmedBy: '合成家長', confirmedAt: '2026-10-07T08:00:00Z', createdAt: '2026-10-07T08:00:00Z', version: 1};
  const task = {id: 'synthetic-task', title: '合成預約', details: '合成安排', assigneeUserId: 'synthetic-parent', createdBy: 'synthetic-parent', updatedAt: '2026-10-07T08:00:00Z', version: 1, occurrence: {id: 'synthetic-occurrence', dueAt: '2026-10-08T08:00:00Z', timeZone: 'Asia/Hong_Kong', state: 'pending'}};
  const populated = {...page, counts: {...page.counts, note: 1}, records: [record], appointments: [task]};
  const tree = SummaryRecords(recordProps({page: populated, emptyReady: true, onRecord: id => events.push(['record', id]), onTask: id => events.push(['task', id])}));
  assert.deepEqual(cards(tree).map(card => card.props.testID), ['summary-metrics-empty']);
  for (const [component, label] of [['RecordSource', '查看原記錄及更正歷史'], ['TaskSource', '核對這項任務']]) {
    const node = find(tree, component), row = node.type(node.props);
    nodes(row).find(button => button.type === 'AppButton' && button.props.label === label).props.onPress();
  }
  assert.deepEqual(events, [['record', record.id], ['task', task.id]]);
  const metric = {kind: 'feeding', unit: 'ml', samples: 1, approximate: 0, total: '60', min: '60', max: '60', recordIds: [record.id]};
  const measured = SummaryRecords(recordProps({page: {...populated, metrics: [metric]}, emptyReady: true}));
  assert.equal(cards(measured).length, 0);
  assert.equal(find(measured, 'MetricResult').props.metric, metric);
  const stale = SummaryRecords(recordProps({page: populated, emptyReady: false}));
  assert.equal(cards(stale).length, 0);
  assert.equal(find(stale, 'RecordSource').props.record, record);
  assert.equal(find(stale, 'TaskSource').props.task, task);
});

test('both summary owners pass successful-read readiness, excluding stale, offline, pending and error states', () => {
  const {SummaryView} = compile('src/components/summary/SummaryView.tsx');
  for (const file of ['legacy', 'production']) {
    function render(patch) {
      const model = {...base, ...patch}, props = {model, actions: {}, onRecord() {}, onTask() {}};
      if (file === 'legacy') return SummaryView(props);
      const {TaskKnowledgeSummaryContent} = compile('src/production/TaskKnowledgeSummaryContent.tsx', {'./TaskKnowledgeDomains': {useProductionTaskKnowledgeSummary: () => ({model, actions: {}})}});
      return TaskKnowledgeSummaryContent(props);
    }
    for (const patch of [{}, {busy: true}, {operation: 'saved'}, {busy: true, operation: 'saved'}, {access: 'read_only'}]) {
      const tree = render(patch), records = find(tree, 'SummaryRecords');
      assert.equal(records.props.page, page, file);
      assert.equal(records.props.emptyReady, true, `${file}: ${JSON.stringify(patch)}`);
      assert.equal(cards(SummaryRecords({...records.props})).length, 3);
    }
    for (const patch of blocked) {
      const tree = render(patch), records = find(tree, 'SummaryRecords');
      assert.equal(records.props.page, page, file);
      assert.equal(records.props.emptyReady, false, `${file}: ${JSON.stringify(patch)}`);
      assert.equal(cards(SummaryRecords({...records.props})).length, 0);
    }
    assert.equal(find(render({page: null, busy: true}), 'SummaryRecords'), undefined);
  }
});
