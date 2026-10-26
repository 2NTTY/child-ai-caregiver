import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {growthTime} from '../src/growth-view-model.ts';
import ts from 'typescript';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Pressable, Text } from 'react-native-web';
import { archiveReadingView, archiveReadableSource, archiveEntryReadable, filterArchiveItems, growthReportExportRequest, standardGrowthReportSections } from '../src/components/growth/growth-archive-view.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
function model() {
  const snapshot = {id: 'report-a', version: 2, ageLabel: '3 歲', periodLabel: '2026 年 9 月', generatedAt: '2026-10-01T02:00:00Z', sourceBasisVersion: 'records:2', coverageNote: '只有部分已取得的記錄', revisionChanges: [{id: 'revision', text: '已有記錄的修訂', sourceIds: ['source-a']}],
    sections: [
      {id: 'overview', title: '這段時間的孩子', entries: [{id: 'summary', reportDomain: 'profile', text: '家人記下公園見聞與晚間作息。', status: 'agent_summary', sourceIds: ['source-a']}]},
      {id: 'moments', title: '值得留下的片段', entries: [{id: 'moment', reportDomain: 'abilities_interests', title: '分享公園見聞', text: '回家主動分享在公園看見的事。', status: 'confirmed_record', sourceIds: ['source-a']}]},
    ], sources: [{id: 'source-a', version: 3, state: 'available', kind: 'record', recordId: 'record-a', label: '公園記錄', excerpt: '原始觀察內容', timeLabel: '9 月 22 日'}]};
  return {scopeKey: 'parent:child-a', childId: 'child-a', childName: '小昕', access: 'editable', load: 'ready',
    page: {authorityVersion: 'auth:1', items: [], archive: {scopeKey: 'parent:child-a', childId: 'child-a', authorityVersion: 'auth:1', state: 'ready', label: 'fixture only', snapshot, history: [], periods: [
      {id: 'year-2026', kind: 'year', year: 2026, label: '2026 年度', snapshotId: snapshot.id, snapshotVersion: 2, currentAnnual: true, coverage: 'partial', coverageLabel: '只包含 9 月片段'},
      {id: 'quarter-2026-q3', kind: 'quarter', year: 2026, quarter: 3, label: '2026 年第 3 季', snapshotId: snapshot.id, snapshotVersion: 2, currentAnnual: false, coverage: 'partial', coverageLabel: '只包含 9 月片段'},
    ]}}};
}
function deepFreeze(value) {if (value && typeof value === 'object') {Object.freeze(value); Object.values(value).forEach(deepFreeze);} return value;}

// Deterministic hook/render semantics; this is not browser or native layout evidence.
function harness(initialProps) {
  let cursor = 0, changed = false, props = initialProps;
  const slots = [], effects = [], cache = new Map();
  const effect = (callback, dependencies) => {
    const index = cursor++, previous = slots[index];
    if (!previous || dependencies.some((value, key) => !Object.is(value, previous.dependencies[key]))) {
      const next = {dependencies, cleanup: previous?.cleanup}; slots[index] = next;
      effects.push(() => {next.cleanup?.(); next.cleanup = callback();});
    }
  };
  const react = {useRef(value) {const index = cursor++; return slots[index] ??= {current: value};},
    useState(value) {const index = cursor++; if (!(index in slots)) slots[index] = typeof value === 'function' ? value() : value;
      return [slots[index], next => {const result = typeof next === 'function' ? next(slots[index]) : next; if (!Object.is(result, slots[index])) {slots[index] = result; changed = true;}}];},
    useEffect: effect, useLayoutEffect: effect};
  const jsx = (type, props, key) => ({type, props, key});
  const AppDialog = Object.assign(function AppDialog() {}, {Title: 'Dialog.Title', ScrollArea: 'Dialog.ScrollArea', Actions: 'Dialog.Actions'});
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const result = ts.transpileModule(readFileSync(filename, 'utf8'), {fileName: filename, compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022}, reportDiagnostics: true});
    assert.equal(result.diagnostics.filter(item => item.category === ts.DiagnosticCategory.Error).length, 0);
    const module = {exports: {}};
    function resolve(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return {jsx, jsxs: jsx, Fragment: 'Fragment'};
      if (name === 'react-native') return {Platform: {OS: 'web'}, Pressable: 'Pressable', View: 'View', StyleSheet: {create: value => value}, useWindowDimensions: () => ({width: props.viewportWidth ?? (props.wide ? 1440 : 390)})};
      if (name === 'react-native-paper') return {Text: 'Text'};
      if (name.endsWith('/theme')) return {chineseFont: 'sans-serif', colors: {}, radius: {}, readingType: {meta: {}, tool: {}}, mobileLayout: {breakpoint: 650}, spacing: {xs: 4, sm: 8, md: 12, lg: 16}};
      if (name.endsWith('/useInteractionDensity')) return {useInteractionDensity: () => props.touchInput ?? false};
      if (name === './growth-styles') return {growthStyles: {}};
      if (name.endsWith('/AppDialog')) return {AppDialog};
      if (name.endsWith('/ui')) return {AppButton: 'AppButton', AppSelect: 'AppSelect'};
      for (const component of ['AppCheckbox', 'AppScrollView', 'AppStatusBadge', 'AppIcon']) if (name.endsWith(`/${component}`)) return {[component]: component};
      if (!name.startsWith('.')) return require(name);
      const source = path.resolve(path.dirname(filename), name);
      return load(existsSync(source) ? source : existsSync(`${source}.ts`) ? `${source}.ts` : `${source}.tsx`);
    }
    new Function('require', 'module', 'exports', result.outputText)(resolve, module, module.exports);
    cache.set(filename, module.exports); return module.exports;
  }
  const renderFunction = load(path.join(root, 'src/components/growth/GrowthArchive.tsx')).GrowthArchive;
  return {render(nextProps = props) {props = nextProps; let tree, rounds = 0; do {assert.ok(++rounds < 10); cursor = 0; changed = false; tree = renderFunction(props); while (effects.length) effects.shift()();} while (changed); return tree;}};
}
function nodes(tree, includeHidden = false) {
  if (!tree || typeof tree !== 'object' || !includeHidden && tree.props?.visible === false) return [];
  if (Array.isArray(tree)) return tree.flatMap(value => nodes(value, includeHidden));
  return [tree, ...nodes(tree.props?.children, includeHidden)];
}
const find = (tree, predicate) => nodes(tree).find(predicate);
const byId = (tree, id) => find(tree, node => node.props?.testID === id);
const button = (tree, label) => find(tree, node => node.type === 'AppButton' && node.props.label === label);
const control = (tree, label) => find(tree, node => node.props?.accessibilityLabel === label);
const text = tree => nodes(tree).filter(node => node.type === 'Text').map(node => node.props.children).flat().join(' ');
const props = (value = model(), extra = {}) => ({model: value, wide: true, scrollRef: {current: null}, ...extra});

function samePeriodVersions() {
  const value = model(), archive = value.page.archive, source = archive.snapshot;
  const snapshots = [5, 4, 3, 2, 1].map(version => ({...structuredClone(source), version, generatedAt: `2026-10-01T02:00:0${version}Z`}));
  archive.snapshot = snapshots[0]; archive.history = snapshots.slice(1);
  archive.periods = snapshots.map(snapshot => ({id: `report-a-v${snapshot.version}`, kind: 'range', year: 2026, label: 'R1',
    snapshotId: snapshot.id, snapshotVersion: snapshot.version, currentAnnual: false, coverage: 'partial', coverageLabel: '只有部分內容'}));
  return value;
}
function openHistory(h) {
  const tree = h.render(); button(tree, '翻閱其他期間／版本').props.onPress();
  return h.render();
}

// This suite verifies the reconstructed structure and original guarded callbacks.
// It intentionally does not claim browser geometry or native accessibility results.
test('reconstructed report has a contents rail and full-width version ledger, with readable metadata at four widths', () => {
  for (const width of [320, 390, 1024, 1440]) {
    const wide = width >= 880, h = harness(props(samePeriodVersions(), {wide, viewportWidth: width}));
    let tree = h.render();
    const report = byId(tree, 'growth-standard-report');
    assert.equal(Object.assign({}, ...report.props.style.filter(Boolean)).borderWidth, undefined);
    assert.ok(byId(tree, 'growth-report-narrative'));
    assert.equal(nodes(tree).some(node => node.type?.name === 'ReportContents'), wide);
    assert.equal(nodes(tree).filter(node => node.type === 'AppSelect' && node.props.label === '跳到欄目').length, wide ? 0 : 1);
    const chapters = nodes(tree).filter(node => node.type?.name === 'ReportChapter');
    assert.deepEqual(chapters.map(chapter => chapter.props.number), ['01', '02']);
    tree = openHistory(h);
    const versions = nodes(tree).filter(node => node.props?.testID?.startsWith('growth-archive-card-'));
    assert.equal(versions.length, 5);
    for (const [index, item] of versions.entries()) {
      const style = Object.assign({}, ...item.props.style.filter(Boolean));
      assert.equal(style.width, undefined, 'Version ledger does not recreate two-column cards');
      assert.equal(style.minWidth, 0); assert.ok(style.minHeight >= 44);
      assert.equal(item.props.children[1].props.style.minWidth, 0);
      assert.equal(item.props.children[1].props.children[2].props.numberOfLines, undefined);
      assert.ok(text(item).includes(`版本 ${5 - index} · 整理於 ${growthTime(`2026-10-01T02:00:0${5-index}Z`)}`));
      assert.equal(item.props['aria-pressed'], index === 0);
    }
  }
});

test('desktop contents preserves the original section focus callback; disclosures meet the 44px target', () => {
  const h = harness(props()); let tree = h.render();
  let focused = 0;
  byId(tree, 'growth-report-abilities_interests').props.ref({isConnected: true, getClientRects: () => [1], focus: () => focused++});
  const rail = find(tree, node => node.type?.name === 'ReportContents');
  const chapter = byId(rail, 'growth-report-chapter-abilities_interests');
  assert.ok(Object.assign({}, ...chapter.props.style({pressed: false}).filter(Boolean)).minHeight >= 44);
  assert.equal(chapter.props.children[1].props.numberOfLines, undefined);
  chapter.props.onPress(); tree = h.render(); assert.equal(focused, 1);
  assert.ok(control(tree, '查看近況摘要的依據').props.style.minHeight >= 44);
  const mobile = harness(props(model(), {wide: false})).render();
  const picker = find(mobile, node => node.type === 'AppSelect' && node.props.label === '跳到欄目');
  assert.notEqual(picker.props.onChange, picker.props.onSelectionClosed);
});

test('report ledger selection retains exact original versions; authority changes suppress stale source and export actions', () => {
  const calls = [], value = samePeriodVersions(); value.online = true;
  const p = props(value, {onRecord: id => calls.push(['record', id]), onExportReport: request => calls.push(['export', request])});
  const h = harness(p); let tree = openHistory(h);
  byId(tree, 'growth-archive-card-report-a-v4').props.onPress(); tree = h.render();
  assert.ok(text(tree).includes('版本 4')); assert.equal(byId(tree, 'growth-archive-library'), undefined);
  control(tree, '查看近況摘要的依據').props.onPress(); tree = h.render();
  const source = find(tree, node => node.type?.name === 'SourceDisclosure');
  source.props.onRecord(source.props.sources[0]); assert.deepEqual(calls[0], ['record', 'record-a']);
  button(tree, '導出報告').props.onPress(); tree = h.render();
  const submit = button(tree, '下載這個版本的 PDF').props.onPress; submit();
  assert.equal(calls[1][1].snapshotVersion, 4); assert.equal(calls[1][1].periodId, 'report-a-v4');
  button(tree, '關閉').props.onPress(); h.render(); submit(); assert.equal(calls.length, 2);
  tree = h.render({...p, model: {...value, access: 'lost'}});
  source.props.onRecord(source.props.sources[0]); submit(); assert.equal(calls.length, 2);
  assert.ok(byId(tree, 'growth-archive-unavailable')); assert.equal(text(tree).includes('家人記下'), false);
});

test('new report presentation keeps unknown metadata honest', () => {
  const value = model(); value.page.archive.snapshot.generatedAt = ''; value.page.archive.snapshot.version = 0;
  for (const period of value.page.archive.periods) period.snapshotVersion = 0;
  const tree = harness(props(value)).render();
  assert.equal(text(tree).includes('Invalid Date'), false);
  assert.ok(text(tree).includes('整理時間未提供'));
  assert.ok(text(tree).includes('版本未提供'));
});

function summaryFixture() {
  return {counts: {note: 0, feeding: 0, sleep: 0, diaper: 0, temperature: 0, measurement: 0, appointment: 0},
    metrics: [], records: [], appointments: [], conflicts: [], missing: {unknownEventTime: 0, invalidQuantities: 0, emptyKinds: []}};
}
function summaryComponent() {
  const file = path.join(root, 'src/components/summary/SummaryRecords.tsx'), module = {exports: {}};
  const jsx = (type, props) => ({type, props});
  const dependencies = {
    'react/jsx-runtime': {jsx, jsxs: jsx, Fragment: 'Fragment'}, 'react-native': {View: 'View'}, 'react-native-paper': {Text: 'Text'},
    '../../care-view-model': {careKindOptions: [{value: 'note', label: '日常記錄'}, {value: 'feeding', label: '飲食'}]},
    '../../summary-view-model': {summaryTime: value => value}, '../../task-view-model': {taskStateLabels: {pending: '待處理'}},
    '../../motion': {MotionReveal: 'MotionReveal'}, '../ui': {AppButton: 'AppButton'}, '../EmptyListCard': {EmptyListCard: 'EmptyListCard'},
    '../AppStatusBadge': {AppStatusBadge: 'AppStatusBadge'}, './SummaryDisclosure': {SummaryDisclosure: 'SummaryDisclosure'}, './summary-styles': {summaryStyles: {}},
  };
  const js = ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require', 'module', 'exports', js)(name => {assert.ok(dependencies[name], name); return dependencies[name];}, module, module.exports);
  return module.exports.SummaryRecords;
}
const SummaryRecords = summaryComponent();
const briefProps = (extra = {}) => ({page: summaryFixture(), onRecord() {}, onTask() {}, motion: {scopeKey: 'child-a', eligible: false, triggerKey: null}, ...extra});

test('care brief reads observations, limitations, follow-up, then source appendix; all empty states remain scoped', () => {
  const tree = SummaryRecords(briefProps({emptyReady: true}));
  const chapters = nodes(tree).filter(node => node.type?.name === 'BriefSection');
  assert.deepEqual(chapters.map(node => [node.props.number, node.props.title]), [
    ['01', '已記錄的情況'], ['02', '閱讀時要留意'], ['03', '預約與跟進'], ['04', '回到原始記錄'],
  ]);
  const empties = nodes(tree).filter(node => node.type === 'EmptyListCard');
  assert.deepEqual(empties.map(node => node.props.testID), ['summary-metrics-empty', 'summary-appointments-empty', 'summary-records-empty']);
  assert.ok(empties.find(node => node.props.testID === 'summary-records-empty').props.detail.includes('沒有記錄不等於沒有發生'));
  assert.equal(nodes(SummaryRecords(briefProps())).filter(node => node.type === 'EmptyListCard').length, 0);
});

test('care brief preserves source references, approximate samples, unknown times and original record/task callbacks', () => {
  const calls = [], page = summaryFixture();
  const record = {id: 'record-a', kind: 'feeding', text: '約半碗', quantity: {rawValue: '半', unit: '碗', precision: 'approximate'},
    eventTime: {at: null, precision: 'unknown', timeZone: 'Asia/Hong_Kong', rawText: '前幾日'}, source: '家長提供', reason: '核對原話', version: 2};
  const task = {id: 'task-a', title: '跟進安排', occurrence: {state: 'pending', timeZone: 'Asia/Hong_Kong'}, assigneeUserId: 'parent-a'};
  page.records = [record]; page.appointments = [task]; page.counts.feeding = 1; page.missing.unknownEventTime = 2;
  page.metrics = [{kind: 'feeding', unit: '碗', total: null, min: '0.5', max: '0.5', samples: 1, approximate: 1, recordIds: ['record-a']}];
  const before = JSON.stringify(page);
  const tree = SummaryRecords(briefProps({page, onRecord: id => calls.push(['record', id]), onTask: id => calls.push(['task', id])}));
  for (const [name, label, value] of [['RecordSource', '查看原記錄及更正歷史', record], ['TaskSource', '核對這項任務', task]]) {
    const component = find(tree, node => node.type?.name === name);
    assert.equal(component.props[name === 'RecordSource' ? 'record' : 'task'], value);
    button(component.type(component.props), label).props.onPress();
  }
  assert.deepEqual(calls, [['record', 'record-a'], ['task', 'task-a']]);
  const source = find(tree, node => node.type?.name === 'RecordSource');
  const readout = find(source.type(source.props), node => node.type?.name === 'Readout');
  const read = readout.props.children(readout.props.value);
  assert.ok(text(read).includes('約 ')); assert.ok(text(read).includes('未知')); assert.ok(text(tree).includes('並非本日／本週缺漏數'));
  const metric = find(tree, node => node.type?.name === 'MetricResult');
  assert.equal(metric.props.metric, page.metrics[0]); assert.ok(text(metric.type(metric.props)).includes('合計未提供，保留原單位'));
  assert.equal(JSON.stringify(page), before);
});
