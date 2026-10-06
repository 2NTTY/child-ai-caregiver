import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
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

test('default is the current full report and export is a distinct action; periods stay secondary', () => {
  const p = props(deepFreeze(model())), h = harness(p), tree = h.render();
  assert.ok(byId(tree, 'growth-current-report'));
  assert.ok(byId(tree, 'growth-report-profile'));
  assert.ok(byId(tree, 'growth-report-abilities_interests'));
  assert.ok(text(tree).includes('家人記下公園見聞與晚間作息。'));
  assert.ok(button(tree, '導出報告'));
  assert.ok(button(tree, '翻閱年度／季度'));
  assert.equal(byId(tree, 'growth-archive-library'), undefined);
  assert.equal(byId(tree, 'growth-report-export'), undefined);
  assert.equal(nodes(tree).filter(node => node.type === 'AppSelect').length, 0);
});

test('period filtering and selection retain canonical references without inventing unavailable years', () => {
  const value = deepFreeze(model()), before = JSON.stringify(value), view = archiveReadingView(value);
  assert.equal(view.current.snapshot, value.page.archive.snapshot);
  assert.equal(view.items[0].period, value.page.archive.periods[0]);
  assert.equal(filterArchiveItems(view.items, 'quarter').length, 1);
  assert.equal(growthReportExportRequest(value, view.items[0], 'family', true, false).snapshotVersion, 2);
  assert.equal(JSON.stringify(value), before);
  const bad = model(); bad.page.archive.periods.push({...bad.page.archive.periods[0], id: 'missing', year: 2025, snapshotVersion: 1});
  assert.equal(archiveReadingView(bad).items.length, 2);
});

test('loaded period choice survives ordinary refresh; switching child clears it and export choices', () => {
  const p = props(), h = harness(p); let tree = h.render();
  button(tree, '翻閱年度／季度').props.onPress(); tree = h.render();
  control(tree, '顯示季度成長檔案').props.onPress(); tree = h.render();
  assert.equal(byId(tree, 'growth-archive-card-year-2026'), undefined);
  byId(tree, 'growth-archive-card-quarter-2026-q3').props.onPress(); tree = h.render();
  assert.equal(byId(tree, 'growth-archive-library'), undefined);
  assert.ok(button(tree, '回到目前報告'));
  tree = h.render({...p, model: {...p.model, load: 'loading'}});
  assert.ok(button(tree, '回到目前報告'));
  button(tree, '導出報告').props.onPress(); tree = h.render();
  control(tree, '就診溝通版').props.onPress(); tree = h.render();
  const next = model(); next.scopeKey = next.page.archive.scopeKey = 'parent:child-b'; next.childId = next.page.archive.childId = 'child-b'; next.childName = '乙';
  tree = h.render({...p, model: next});
  assert.equal(byId(tree, 'growth-report-export'), undefined);
  assert.equal(button(tree, '回到目前報告'), undefined);
  button(tree, '導出報告').props.onPress(); tree = h.render();
  assert.equal(control(tree, '家庭成長版').props['aria-checked'], true);
});

test('export selections are local and PDF stays disabled without an adapter', () => {
  const p = props(), before = JSON.stringify(p.model), h = harness(p); let tree = h.render();
  button(tree, '導出報告').props.onPress(); tree = h.render();
  assert.ok(byId(tree, 'growth-report-export'));
  for (const label of ['家庭成長版', '就診溝通版', '照護交接版', '入園認識版']) assert.ok(control(tree, label));
  control(tree, '照護交接版').props.onPress(); tree = h.render();
  assert.equal(button(tree, 'PDF 下載暫不可用').props.disabled, true);
  assert.ok(byId(tree, 'growth-export-unavailable'));
  assert.equal(JSON.stringify(p.model), before);
  button(tree, '關閉').props.onPress(); tree = h.render();
  assert.equal(byId(tree, 'growth-report-export'), undefined);
  assert.ok(byId(tree, 'growth-report-profile'));
});

test('typed export intent carries exact scope and version and rejects stale callbacks after close or revocation', () => {
  const calls = [], p = props(model(), {onExportReport: request => calls.push(request)}), h = harness(p); let tree = h.render();
  button(tree, '導出報告').props.onPress(); tree = h.render();
  control(tree, '入園認識版').props.onPress(); tree = h.render();
  find(tree, node => node.type === 'AppCheckbox' && node.props.label === '本版更新說明').props.onChange(true); tree = h.render();
  const callback = button(tree, '準備 PDF 報告').props.onPress; callback();
  assert.deepEqual(calls[0], {scopeKey: 'parent:child-a', childId: 'child-a', authorityVersion: 'auth:1', snapshotId: 'report-a', snapshotVersion: 2, periodId: 'year-2026', purpose: 'school', includeSources: true, includeRevision: true});
  button(tree, '關閉').props.onPress(); tree = h.render(); callback(); assert.equal(calls.length, 1);
  tree = h.render({...p, model: {...p.model, access: 'lost'}}); callback();
  assert.equal(calls.length, 1); assert.ok(byId(tree, 'growth-archive-unavailable')); assert.equal(text(tree).includes('家人記下'), false);
});

test('source disclosure uses current authorized source and does not replay a record callback after invalidation', () => {
  const calls = [], p = props(model(), {onRecord: id => calls.push(id)}), h = harness(p); let tree = h.render();
  control(tree, '查看近況摘要的依據').props.onPress(); tree = h.render();
  const disclosure = find(tree, node => typeof node.type === 'function' && node.type.name === 'SourceDisclosure');
  const source = disclosure.props.sources[0], callback = disclosure.props.onRecord;
  callback(source); assert.deepEqual(calls, ['record-a']);
  const changed = structuredClone(p.model); changed.page.archive.snapshot.sources[0].state = 'invalidated';
  tree = h.render({...p, model: changed}); callback(source);
  assert.deepEqual(calls, ['record-a']); assert.equal(text(tree).includes('家人記下公園見聞'), false);
  assert.equal(archiveEntryReadable(changed, changed.page.archive.snapshot, changed.page.archive.snapshot.sections[0].entries[0]), false);
});

test('wrong owner, authority, source version, missing evidence, and invalidated projection never expose narration', () => {
  for (const change of [value => {value.access = 'lost';}, value => {value.childId = 'foreign';}, value => {value.scopeKey = 'foreign';}, value => {value.page.authorityVersion = 'changed';}, value => {value.page.archive.state = 'invalidated';}]) {
    const value = model(); change(value); assert.equal(archiveReadingView(value).items.length, 0);
    const tree = harness(props(value)).render(); assert.equal(text(tree).includes('家人記下公園見聞'), false);
  }
  const value = model(), snapshot = value.page.archive.snapshot;
  snapshot.sources[0] = {...snapshot.sources[0], kind: 'attention', attentionId: 'attention-a'};
  value.page.items = [{id: 'attention-a', childId: 'child-a', version: 2, sourceAvailable: true}];
  assert.equal(archiveReadableSource(value, snapshot, 'source-a'), undefined);
  value.page.items[0].version = 3; assert.ok(archiveReadableSource(value, snapshot, 'source-a'));
  value.page.items[0].childId = 'child-b'; assert.equal(archiveReadableSource(value, snapshot, 'source-a'), undefined);
  assert.equal(archiveEntryReadable(value, snapshot, {...snapshot.sections[0].entries[0], sourceIds: []}), false);
});

test('mobile chapter selection waits for the shared modal to close before scrolling', () => {
  const h = harness(props(model(), {wide: false})), tree = h.render();
  const picker = find(tree, node => node.type === 'AppSelect' && node.props.label === '跳到欄目');
  assert.equal(typeof picker.props.onSelectionClosed, 'function');
  assert.notEqual(picker.props.onChange, picker.props.onSelectionClosed);
  const section = byId(tree, 'growth-report-abilities_interests'); let focused = 0;
  section.props.ref({isConnected: true, getClientRects: () => [1], focus: () => focused++});
  picker.props.onChange('abilities_interests'); h.render(); assert.equal(focused, 0);
  picker.props.onSelectionClosed('abilities_interests'); assert.equal(focused, 1);
});

test('missing selected period offers a route back to the available current report instead of silently replacing it', () => {
  const p = props(), h = harness(p); let tree = h.render();
  button(tree, '翻閱年度／季度').props.onPress(); tree = h.render();
  byId(tree, 'growth-archive-card-quarter-2026-q3').props.onPress(); h.render();
  const next = structuredClone(p.model); next.page.archive.periods.pop(); tree = h.render({...p, model: next});
  assert.ok(byId(tree, 'growth-archive-unavailable')); assert.ok(button(tree, '回到目前報告'));
  button(tree, '回到目前報告').props.onPress(); tree = h.render(); assert.ok(byId(tree, 'growth-current-report'));
});


test('entry tools center the badge independently and use a compact outlined disclosure on desktop', () => {
  const h = harness(props()), tree = h.render();
  const row = byId(tree, 'growth-archive-entry-tools-summary');
  assert.equal(row.props.style.flexDirection, 'row');
  assert.equal(row.props.style.alignItems, 'center');
  assert.equal(row.props.style.flexWrap, 'wrap');
  const [badgeWrapper, disclosure] = row.props.children;
  assert.equal(badgeWrapper.props.style.alignSelf, 'center');
  assert.equal(badgeWrapper.props.style.justifyContent, 'center');
  assert.equal(badgeWrapper.props.children.type, 'AppStatusBadge');
  assert.equal(disclosure.type, 'AppButton');
  assert.equal(disclosure.props.variant, 'quiet');
  assert.equal(disclosure.props.density, 'compact');
  assert.equal(disclosure.props.style.minHeight, 32);
  assert.equal(disclosure.props.expanded, false);
  disclosure.props.onPress();
  assert.equal(control(h.render(), '收起近況摘要的依據').props.expanded, true);
});

test('narrow screens and coarse pointers retain the shared touch target instead of the desktop height override', () => {
  for (const extra of [{wide: false}, {wide: true, touchInput: true}, {wide: true, viewportWidth: 320}]) {
    const tree = harness(props(model(), extra)).render();
    assert.equal(control(tree, '查看近況摘要的依據').props.style, undefined);
    assert.equal(button(tree, '報告資料').props.style, undefined);
  }
});

test('report footer shares one wrapping action row and keeps coverage and versions in one disclosure', () => {
  const extra = {footerActions: {type: 'ParentActions', props: {}}, footerDetails: {type: 'ParentDetails', props: {}}};
  const p = props(model(), extra), h = harness(p); let tree = h.render();
  const row = byId(tree, 'growth-archive-footer-actions');
  assert.equal(row.props.style.flexDirection, 'row');
  assert.equal(row.props.style.flexWrap, 'wrap');
  assert.equal(row.props.children[1], extra.footerActions);
  assert.ok(find(byId(tree, 'growth-archive-footer'), node => node.type === 'ParentDetails'));
  assert.equal(text(tree).includes(p.model.page.archive.snapshot.coverageNote), false);
  assert.equal(byId(tree, 'growth-archive-revision'), undefined);
  button(tree, '報告資料').props.onPress(); tree = h.render();
  assert.ok(text(tree).includes(p.model.page.archive.snapshot.coverageNote));
  assert.ok(text(tree).includes('也不是發展評估'));
  assert.ok(byId(tree, 'growth-archive-revision'));
  assert.equal(button(tree, '本次更新與版本'), undefined);
  button(tree, '收起報告資料').props.onPress(); tree = h.render();
  assert.equal(byId(tree, 'growth-archive-revision'), undefined);
});

test('available parent footer actions remain reachable when no report is available', () => {
  const value = model(); value.page.archive.state = 'not_generated'; value.page.archive.snapshot = null;
  const extra = {footerActions: {type: 'ParentActions', props: {}}, footerDetails: {type: 'ParentDetails', props: {}}};
  const tree = harness(props(value, extra)).render();
  assert.ok(byId(tree, 'growth-archive-unavailable'));
  assert.ok(find(tree, node => node.type === 'ParentActions'));
  assert.ok(find(tree, node => node.type === 'ParentDetails'));
  assert.equal(button(tree, '報告資料'), undefined);
});


test('standard report uses fixed domains with original entry references and omits empty sections', () => {
  const value = model(), snapshot = value.page.archive.snapshot;
  snapshot.sections.push({id: 'observations', title: '舊觀察章節', entries: [
    {id: 'sleep', title: '睡眠記錄', reportDomain: 'body_life', text: '原話保留約數', status: 'confirmed_record', sourceIds: ['source-a']},
  ]});
  const original = JSON.stringify(value); deepFreeze(value);
  const sections = standardGrowthReportSections(value, snapshot);
  assert.deepEqual(sections.map(section => section.id), ['profile', 'body_life', 'abilities_interests']);
  assert.equal(sections[1].entries[0], snapshot.sections[2].entries[0]);
  assert.equal(JSON.stringify(value), original);
  const tree = harness(props(value)).render();
  assert.ok(byId(tree, 'growth-standard-report'));
  assert.ok(byId(tree, 'growth-report-profile-facts'));
  assert.ok(byId(tree, 'growth-report-body_life'));
  assert.equal(byId(tree, 'growth-report-concerns'), undefined);
  assert.equal(byId(tree, 'growth-report-changes_support'), undefined);
  assert.equal(text(tree).includes('這段時間的孩子'), false);
  assert.equal(text(tree).includes('值得留下的片段'), false);
});

test('legacy unclassified content stays neutral and does not infer a domain from wording', () => {
  const value = model(), snapshot = value.page.archive.snapshot;
  delete snapshot.sections[0].entries[0].reportDomain;
  snapshot.sections[0].entries[0].text = '身高與睡眠字眼不足以授權分類';
  const sections = standardGrowthReportSections(value, snapshot);
  assert.deepEqual(sections.map(section => section.id), ['profile', 'abilities_interests', 'recorded']);
  assert.equal(sections[2].entries[0], snapshot.sections[0].entries[0]);
  assert.equal(sections.some(section => section.id === 'body_life'), false);
});

test('standard report follows current authoritative content rather than storing a second report', () => {
  const value = model(), previous = value.page.archive.snapshot;
  const changed = structuredClone(value);
  changed.page.archive.snapshot.sections[0].entries[0].text = '同一來源的新整理內容';
  const sections = standardGrowthReportSections(changed, previous);
  assert.equal(sections[0].entries[0], changed.page.archive.snapshot.sections[0].entries[0]);
  assert.equal(sections[0].entries[0].text, '同一來源的新整理內容');
  changed.access = 'lost';
  assert.deepEqual(standardGrowthReportSections(changed, previous), []);
});
