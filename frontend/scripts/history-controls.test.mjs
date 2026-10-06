import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import * as historyFilters from '../src/components/history/history-filters.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const flatten = value => Array.isArray(value) ? Object.assign({}, ...value.filter(Boolean).map(flatten)) : value || {};
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const labelled = (tree, label) => nodes(tree).find(node => node.props?.label === label);

// Hook and control-prop checks only; final browser geometry is a separate acceptance step.
function harness(width = 1024) {
  const slots = [], effects = [], events = [], cache = new Map();
  let cursor = 0, locked = false;
  const react = {
    useRef(value) { const index = cursor++; return slots[index] ??= {current: value}; },
    useState(value) { const index = cursor++; if (!(index in slots)) slots[index] = typeof value === 'function' ? value() : value; return [slots[index], next => { slots[index] = next; }]; },
    useReducer(reducer, argument, initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial(argument); return [slots[index], action => { slots[index] = reducer(slots[index], action); }]; },
    useEffect(callback, deps) { const index = cursor++, prior = slots[index]; if (!prior || deps.some((value, key) => !Object.is(value, prior[key]))) effects.push(callback); slots[index] = deps; },
  };
  const theme = {chineseFont: 'sans-serif', colors: {}, radius: {}, readingType: {}, typeScale: {small: 14}, mobileLayout: {breakpoint: 650, touchTarget: 48}, mobileType: {}, spacing: {xs: 4, sm: 8, md: 12, lg: 16}};
  const native = {Platform: {OS: 'web'}, View: 'View', StyleSheet: {create: value => value, flatten}, useWindowDimensions: () => ({width})};
  const paper = {Text: 'Text', Button: 'PaperButton'};
  const workspace = {
    useTasksWorkspace: () => ({model: {reading: false, access: 'editable', operation: {state: 'none'}, scheduleContext: {timeZone: 'Asia/Hong_Kong'}}, actions: {closePanel: () => events.push('close-tasks')}}),
    useCareWorkspace: () => ({model: {access: 'editable', list: {state: 'ready'}, operation: {state: 'none'}, review: {state: 'ready'}}, actions: {closePanel: () => events.push('close-care')}}),
    usePreparationWorkspace: () => ({model: {condition: 'ready', documents: []}, actions: {closeDocument: () => events.push('close-preparation')}}),
    useGrowthWorkspace: () => ({scopeKey: 'scope-a', model: {access: 'editable', busy: locked, page: {concerns: {state: 'ready'}}}}),
  };
  const dependencies = {
    'react': react, 'react/jsx-runtime': require('react/jsx-runtime'), 'react-native': native, 'react-native-paper': paper,
    'expo-router': {useRouter: () => ({push: value => events.push(['push', value]), setParams() {}})},
    '../preview/PreviewContext': {usePreview: () => ({actions: {}})},
    '../preview/PreviewNavigationGuard': {usePreviewNavigation: () => callback => {events.push('guard'); callback();}},
    '../components/useContainerWidth': {useContainerWidth: () => ({width, ref: null, onLayout() {}})},
    '../components/history/history-filters': historyFilters,
    '../components/date-time': {timeZoneLabel: value => value},
    '../preparation-view-model': {searchPreparationHistory: () => []},
  };
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative);
    const filename = path.join(root, relative);
    const output = ts.transpileModule(readFileSync(filename, 'utf8'), {fileName: filename, compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022}, reportDiagnostics: true});
    assert.equal(output.diagnostics.filter(item => item.category === ts.DiagnosticCategory.Error).length, 0);
    const module = {exports: {}};
    const resolve = name => dependencies[name] ?? (name.includes('/workspaces/') ? workspace : name.endsWith('/theme') ? theme : name.endsWith('/useInteractionDensity') ? {useInteractionDensity: () => false} : new Proxy({}, {get: (_target, key) => String(key)}));
    new Function('require', 'module', 'exports', output.outputText + (relative.endsWith('historyScreen.tsx') ? '\nexports.HistoryWorkspace = HistoryWorkspace;' : ''))(resolve, module, module.exports);
    cache.set(relative, module.exports); return module.exports;
  }
  const {HistoryWorkspace} = load('src/screens/historyScreen.tsx');
  const {AppButton} = load('src/components/ui.tsx');
  return {
    events, lock() {locked = true;}, button: props => AppButton(props),
    render() {cursor = 0; const tree = HistoryWorkspace({scope: 'scope-a', childName: 'A', initialCategory: 'growth', initialReviewStatus: 'all', olderOnly: false}); while (effects.length) effects.shift()(); return tree;},
  };
}

test('growth source actions share compact sizing and centered self-alignment without a Link wrapper', () => {
  for (const width of [1440, 1024, 390, 320]) {
    const h = harness(width), tree = h.render();
    const first = labelled(tree, '查看持續關注'), second = labelled(tree, '查看年度與季度檔案');
    const group = nodes(tree).find(node => node.type === 'View' && node.props.children?.includes?.(first) && node.props.children.includes(second));
    assert.ok(group);
    assert.equal(group.props.style.flexWrap, 'wrap');
    assert.equal(group.props.style.maxWidth, '100%');
    assert.equal(group.props.style.alignItems, 'center');
    const buttons = [first, second].map(node => h.button(node.props));
    assert.ok(buttons.every(node => node.props.compact && node.props.mode === 'outlined'));
    assert.deepEqual(flatten(buttons[0].props.contentStyle), flatten(buttons[1].props.contentStyle));
    for (const button of buttons) {
      assert.equal(flatten(button.props.style).alignSelf, 'center');
      assert.equal(flatten(button.props.style).height, undefined);
      if (width < 650) assert.ok(flatten(button.props.contentStyle).minHeight >= 48);
    }
    first.props.onPress(); second.props.onPress();
    assert.deepEqual(h.events, ['guard', ['push', '/growth'], 'guard', ['push', '/growth?tab=archive']]);
  }
});

test('date clear aligns with the Paper outlined border and drops the offset when stacked', () => {
  for (const width of [1440, 1024, 390, 320]) {
    const h = harness(width), tree = h.render(), clear = labelled(tree, '清除篩選');
    const row = nodes(tree).find(node => node.type === 'View' && node.props.children?.includes?.(clear));
    const style = flatten(clear.props.style);
    assert.equal(style.minHeight, 50);
    assert.equal(style.justifyContent, 'center');
    assert.equal(style.marginTop, width < 680 ? 0 : 6);
    assert.equal(flatten(row.props.style).flexDirection, width < 680 ? 'column' : 'row');
    assert.equal(flatten(row.props.style).alignItems, width < 680 ? 'stretch' : 'flex-start');
    assert.equal(nodes(row).filter(node => node.type === 'AppDateField').length, 2);
    assert.ok(flatten(h.button(clear.props).props.contentStyle).minHeight >= 44);
  }
});

test('date filtering, reset and the original locked guard are unchanged by the layout', () => {
  const h = harness(); let tree = h.render();
  assert.equal(labelled(tree, '清除篩選').props.disabled, true);
  labelled(tree, '搜尋關注與成長').props.onChangeText('  family  ');
  labelled(tree, '開始日期（可不填）').props.onChange('2026-09-01');
  labelled(tree, '結束日期（可不填）').props.onChange('2026-09-30');
  tree = h.render();
  const result = nodes(tree).find(node => node.type === 'GrowthHistoryView');
  assert.equal(result.props.searchText, '  family  ');
  assert.deepEqual(result.props.dateRange, {from: '2026-09-01', to: '2026-09-30'});
  labelled(tree, '清除篩選').props.onPress(); tree = h.render();
  assert.equal(labelled(tree, '搜尋關注與成長').props.value, '');
  assert.equal(labelled(tree, '開始日期（可不填）').props.value, '');
  assert.equal(labelled(tree, '結束日期（可不填）').props.value, '');
  h.lock(); tree = h.render(); const count = h.events.length;
  assert.equal(labelled(tree, '清除篩選').props.disabled, true);
  labelled(tree, '搜尋關注與成長').props.onChangeText('blocked');
  labelled(tree, '清除篩選').props.onPress();
  assert.equal(h.events.length, count);
  assert.equal(labelled(h.render(), '搜尋關注與成長').props.value, '');
});

test('History removes only the permanent closing caveat and keeps restore and coverage conditions', () => {
  const source = readFileSync(path.join(root, 'src/components/growth/GrowthHistoryView.tsx'), 'utf8');
  assert.ok(!source.includes('只列已取得的已結束關注；結束關注不代表已連結的任務完成。'));
  assert.ok(source.includes('actions.restoreConcern(concern.id, concern.version, model.page!.authorityVersion)'));
  assert.ok(source.includes('growthArchivedConcerns(model, searchText, dateRange)'));
  assert.ok(source.includes('目前離線，內容可能未更新。'));
  assert.ok(source.includes('未取得原狀態，暫未能恢復。'));
});

function closedHistoryHarness(width = 1024, touch = false) {
  const slots = []; let cursor = 0;
  const calls = [];
  const concern = (id, title) => ({id, title, childId: 'child-a', reason: `${title}摘要`, status: 'closed', statusBeforeArchive: 'following', version: id === 'one' ? 3 : 7, archivedAt: '2026-10-05T11:00:00Z', attentionIds: [], events: [], historyComplete: false});
  let workspace = {scopeKey: 'scope-a', model: {childId: 'child-a', access: 'editable', online: true, load: 'ready', locked: false, dirty: false, page: {authorityVersion: 'auth-a', canManage: true, concerns: {state: 'ready', items: [concern('one', '第一條'), concern('two', '第二條')]}}}, actions: {restoreConcern: (...args) => calls.push(args)}};
  const source = readFileSync(path.join(root, 'src/components/growth/GrowthHistoryView.tsx'), 'utf8');
  const output = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022}}).outputText;
  const module = {exports: {}};
  const modelSource = ts.transpileModule(readFileSync(path.join(root, 'src/growth-view-model.ts'), 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const modelModule = {exports: {}};
  new Function('require', 'module', 'exports', modelSource)(require, modelModule, modelModule.exports);
  const dependencies = {
    'react': {useState: initial => {const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => {slots[index] = value;}];}}, 'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': {View: 'View', Pressable: 'Pressable', StyleSheet: {create: value => value}, useWindowDimensions: () => ({width})}, 'react-native-paper': {Text: 'Text', Button: 'Button'},
    '../useInteractionDensity': {useInteractionDensity: () => touch},
    '../../growth-view-model': modelModule.exports,
    '../../workspaces/GrowthWorkspace': {useGrowthWorkspace: () => workspace},
    '../../theme': {colors: {line: '#CAC9D4', controlSurface: '#FFFFFE', ink: '#272343', quietSurface: '#EDFAF9'}, mobileLayout: {breakpoint: 650, touchTarget: 48}, radius: {small: 10}, spacing: {xs: 4, sm: 8, md: 12, lg: 16}},
    './growth-styles': {growthStyles: {stack: {gap: 12}}},
  };
  new Function('require', 'module', 'exports', output)(name => dependencies[name] ?? new Proxy({}, {get: (_target, key) => String(key)}), module, module.exports);
  return {calls, get workspace() {return workspace;}, setWorkspace(value) {workspace = value;}, render(searchText = '') {cursor = 0; return module.exports.GrowthHistoryView({searchText, dateRange: {from: null, to: null}, onTask() {}});}};
}
const identified = (tree, id) => nodes(tree).find(node => node.props?.testID === id);

const restoreControl = tree => nodes(tree).find(node => node.type === 'Button' && node.props.accessibilityLabel?.startsWith('恢復關注：'));
const readingControl = tree => nodes(tree).find(node => node.type === 'Pressable' && node.props.accessibilityLabel?.startsWith('查看已結束關注：'));

test('closed chains are distinct name/date rows with sibling reading targets and small right-side restore tools', () => {
  for (const [width, touch] of [[1440, false], [1024, true], [390, false], [320, false]]) {
    const h = closedHistoryHarness(width, touch), tree = h.render();
    assert.ok(tree.props.style.gap > 0);
    for (const id of ['one', 'two']) {
      const card = identified(tree, `growth-history-${id}`);
      assert.equal(card.key, id);
      assert.equal(card.props.style.borderWidth, 1);
      assert.equal(card.props.style.backgroundColor, '#FFFFFE');
      const row = card.props.children[0], reading = readingControl(row), restore = restoreControl(row);
      assert.equal(row.props.style.flexDirection, 'row');
      assert.equal(row.props.children[0], reading);
      assert.equal(row.props.children[1], restore);
      assert.equal(restoreControl(reading), undefined, 'Restore must not nest inside the reading button');
      const texts = nodes(reading).filter(node => node.type === 'Text');
      assert.equal(texts.length, 2);
      assert.equal(texts[0].props.children, id === 'one' ? '第一條' : '第二條');
      assert.match(texts[1].props.children, /^結束於 /);
      assert.ok(!texts.some(node => node.props.children.includes('摘要')));
      const readStyle = flatten(reading.props.style({pressed: false}));
      assert.equal(readStyle.flex, 1); assert.ok(readStyle.minHeight >= 48);
      assert.equal(restore.props.mode, 'text'); assert.equal(restore.props.compact, true);
      assert.equal(restore.props.children, '恢復');
      assert.equal(restore.props.style.borderWidth, 0); assert.equal(restore.props.style.flexShrink, 0);
      assert.ok(flatten(restore.props.contentStyle).minHeight >= (touch || width < 650 ? 48 : 40));
      let stopped = false;
      restore.props.onPress({stopPropagation() {stopped = true;}});
      assert.equal(stopped, true);
      assert.equal(nodes(h.render()).filter(node => node.type === 'GrowthConcernTimeline').length, 0);
    }
    assert.deepEqual(h.calls, [['one', 3, 'auth-a'], ['two', 7, 'auth-a']]);
  }
});

test('selected History keeps its chain identity through reorder and filtering and never opens a sibling timeline', () => {
  const h = closedHistoryHarness(); let tree = h.render();
  readingControl(identified(tree, 'growth-history-two')).props.onPress(); tree = h.render();
  const timeline = () => nodes(tree).filter(node => node.type === 'GrowthConcernTimeline');
  assert.equal(timeline().length, 1); assert.equal(timeline()[0].props.concern.id, 'two');
  assert.equal(timeline()[0].props.concern.reason, '第二條摘要');
  assert.ok(identified(tree, 'growth-history-detail-two'));
  h.workspace.model.page.concerns.items.reverse(); tree = h.render();
  assert.equal(timeline()[0].props.concern.id, 'two');
  tree = h.render('第一條'); assert.equal(timeline().length, 0);
  assert.ok(identified(tree, 'growth-history-one'));
  tree = h.render(); assert.equal(timeline()[0].props.concern.id, 'two');
  restoreControl(tree).props.onPress({stopPropagation() {}});
  assert.deepEqual(h.calls, [['two', 7, 'auth-a']]);
  labelled(tree, '返回關注歷史').props.onPress(); tree = h.render();
  readingControl(identified(tree, 'growth-history-one')).props.onPress(); tree = h.render();
  assert.equal(timeline().length, 1); assert.equal(timeline()[0].props.concern.id, 'one');
  h.setWorkspace({...h.workspace, scopeKey: 'scope-b'}); tree = h.render();
  assert.equal(timeline().length, 0);
});

test('lightweight restore retains locked, dirty, missing-state and viewer gates, with keyboard and hover reading feedback', () => {
  for (const mutate of [model => {model.locked = true;}, model => {model.dirty = true;}, model => {delete model.page.concerns.items[0].statusBeforeArchive;}]) {
    const h = closedHistoryHarness(); mutate(h.workspace.model);
    assert.equal(restoreControl(identified(h.render(), 'growth-history-one')).props.disabled, true);
  }
  const h = closedHistoryHarness(); let tree = h.render(), reading = readingControl(identified(tree, 'growth-history-one'));
  reading.props.onFocus(); tree = h.render(); reading = readingControl(identified(tree, 'growth-history-one'));
  assert.equal(flatten(reading.props.style({pressed: false})).borderColor, '#272343');
  reading.props.onBlur(); reading.props.onHoverIn(); tree = h.render(); reading = readingControl(identified(tree, 'growth-history-one'));
  assert.equal(flatten(reading.props.style({pressed: false})).backgroundColor, '#EDFAF9');
  assert.equal(flatten(reading.props.style({pressed: true})).opacity, 0.65);
  h.workspace.model.page.canManage = false;
  assert.equal(restoreControl(h.render()), undefined);
});

test('success is concise while unknown and failure messages remain explicit and list copy has no permanent caveats', () => {
  const h = closedHistoryHarness();
  h.workspace.model.operation = 'saved'; h.workspace.model.notice = '已恢復這條關注，原有經過與核對狀態保留；沒有改動已連結任務。';
  let texts = nodes(h.render()).filter(node => node.type === 'Text').map(node => node.props.children);
  assert.ok(texts.includes('已恢復關注。')); assert.ok(!texts.includes(h.workspace.model.notice));
  for (const operation of ['unknown', 'failed']) {
    h.workspace.model.operation = operation; h.workspace.model.notice = '原操作仍未核實，請查回結果。';
    texts = nodes(h.render()).filter(node => node.type === 'Text').map(node => node.props.children);
    assert.ok(texts.includes(h.workspace.model.notice));
  }
  const screen = readFileSync(path.join(root, 'src/screens/historyScreen.tsx'), 'utf8');
  assert.ok(screen.includes('!growthCategory ? <Text style={styles.meta}>{current.description}'));
  assert.ok(!screen.includes('日期按結束關注的時間篩選'));
});
