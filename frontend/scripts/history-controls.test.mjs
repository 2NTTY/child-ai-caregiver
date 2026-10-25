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
function harness(width = 1024, initialCategory = 'growth') {
  const slots = [], effects = [], events = [], cache = new Map();
  let cursor = 0, locked = false, selectedTask = null, selectedPreparation = null;
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
    useTasksWorkspace: () => ({model: {selected: selectedTask, reading: false, access: 'editable', operation: {state: 'none'}, scheduleContext: {timeZone: 'Asia/Hong_Kong'}}, actions: {closePanel: () => events.push('close-tasks')}}),
    useCareWorkspace: () => ({model: {access: 'editable', list: {state: 'ready'}, operation: {state: 'none'}, review: {state: 'ready'}}, actions: {closePanel: () => events.push('close-care')}}),
    usePreparationWorkspace: () => ({model: {condition: 'ready', selected: selectedPreparation, documents: selectedPreparation ? [selectedPreparation] : []}, actions: {closeDocument: () => events.push('close-preparation')}}),
    useGrowthWorkspace: () => ({scopeKey: 'scope-a', model: {access: 'editable', busy: locked, page: {concerns: {state: 'ready'}}}}),
  };
  const dependencies = {
    'react': react, 'react/jsx-runtime': require('react/jsx-runtime'), 'react-native': native, 'react-native-paper': paper,
    'expo-router': {useRouter: () => ({push: value => events.push(['push', value]), setParams() {}})},
    '../production/ProductionProvider': {useProduction: () => ({identityKey: 'synthetic-parent', scopeKey: 'scope-a', model: {selectedChildId: 'child-a', children: [{id: 'child-a', displayName: 'A', accessRole: 'owner'}]}, actions: {prepareQuestion: value => events.push(['prepare-question', value])}})},
    '../preview/PreviewNavigationGuard': {usePreviewNavigation: () => callback => {events.push('guard'); callback();}},
    '../components/useContainerWidth': {useContainerWidth: () => ({width, ref: null, onLayout() {}})},
    '../components/history/history-filters': historyFilters,
    '../components/date-time': {timeZoneLabel: value => value},
    '../preparation-view-model': {searchPreparationHistory: () => selectedPreparation ? [selectedPreparation] : []},
    '../components/DateTimeFields': {AppDateField: 'AppDateField'},
    '../components/FormDialog': {FormDialog: 'FormDialog'},
    '../components/appearance/BackgroundSurface': { BackgroundSurface: 'View' },
    './appearance/BackgroundSurface': { BackgroundSurface: 'View', useCustomBackground: () => false },
    '../components/PageFrame': {PageFrame: 'PageFrame'},
    '../components/workspace/Workspace': {Workspace: {Provider: 'WorkspaceProvider', Split: 'WorkspaceSplit', Main: 'WorkspaceMain', Aside: 'WorkspaceAside'}},
    '../components/history/HistoryCategoryNavigation': {HistoryCategoryNavigation: 'HistoryCategoryNavigation'},
    '../components/ui': {AppButton: 'AppButton', AppSelect: 'AppSelect', AppTabPanel: 'AppTabPanel', AppTextField: 'AppTextField', UnderlineTabs: 'UnderlineTabs'},
    '../components/tasks/TaskHistoryView': {TaskHistoryView: 'TaskHistoryView'},
    '../components/care/CareReviewHistoryView': {CareReviewHistoryView: 'CareReviewHistoryView'},
    '../components/care/CareSavedRecordsView': {CareSavedRecordsView: 'CareSavedRecordsView'},
    '../components/preparations/PreparationWorkspace': {PreparationHistoryView: 'PreparationHistoryView'},
    '../components/profile/ProfileHistoryView': {ProfileHistoryView: 'ProfileHistoryView'},
    '../workspaces/ProfileWorkspace': {useProfileWorkspace: () => ({scopeKey: 'scope-a', model: {child: {id: 'child-a'}}, actions: {showHistory() {events.push('profile-history-read');}}})},
    '../production/usePersonalHistory': {usePersonalHistoryWorkspace: () => ({scopeKey: 'scope-a'})},
    '../components/history/PersonalHistoryViews': {PersonalConversationHistoryView: 'PersonalConversationHistoryView', PersonalNotificationHistoryView: 'PersonalNotificationHistoryView'},
    '../components/growth/GrowthHistoryView': {GrowthHistoryView: 'GrowthHistoryView'},
    '../workspaces/TasksWorkspace': {useTasksWorkspace: workspace.useTasksWorkspace},
    '../workspaces/CareWorkspace': {useCareWorkspace: workspace.useCareWorkspace},
    '../workspaces/PreparationWorkspace': {usePreparationWorkspace: workspace.usePreparationWorkspace},
    '../workspaces/GrowthWorkspace': {useGrowthWorkspace: workspace.useGrowthWorkspace},
    '../theme': theme,
    './useQuietReadFocus': {useQuietReadFocus: disabled => ({host: {current: null}, preserveWebFocus: false, nativeDisabled: disabled})},
    './useInteractionDensity': {useInteractionDensity: () => false},
    './AppScrollView': {AppScrollView: 'AppScrollView'}, './AppIcon': {AppIcon: 'AppIcon'},
    './AppRadioItem': {AppRadioItem: 'AppRadioItem'}, './AppDialog': {AppDialog: 'AppDialog'},
    '../motion': {MotionEntrance: 'MotionEntrance'}, './AppStatusBadge': {AppStatusBadge: 'AppStatusBadge'},
    '../motion/MotionSelectionMarker': {MotionSelectionMarker: 'MotionSelectionMarker'},
    './HorizontalOverflowRail': {HorizontalOverflowRail: 'HorizontalOverflowRail'},
  };
  function load(relative) {
    if (cache.has(relative)) return cache.get(relative);
    const filename = path.join(root, relative);
    const output = ts.transpileModule(readFileSync(filename, 'utf8'), {fileName: filename, compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022}, reportDiagnostics: true});
    assert.equal(output.diagnostics.filter(item => item.category === ts.DiagnosticCategory.Error).length, 0);
    const module = {exports: {}};
    const resolve = name => { assert.ok(Object.hasOwn(dependencies, name), `Unmocked History dependency: ${name}`); return dependencies[name]; };
    new Function('require', 'module', 'exports', output.outputText + (relative.endsWith('historyScreen.tsx') ? '\nexports.HistoryWorkspace = HistoryWorkspace;' : ''))(resolve, module, module.exports);
    cache.set(relative, module.exports); return module.exports;
  }
  const {HistoryWorkspace} = load('src/screens/historyScreen.tsx');
  const {AppButton} = load('src/components/ui.tsx');
  return {
    events, lock(value = true) {locked = value;}, button: props => AppButton(props),
    selectHistory(task, preparation) {selectedTask = task; selectedPreparation = preparation;},
    render() {cursor = 0; const tree = HistoryWorkspace({scope: 'scope-a', childName: 'A', initialCategory, initialReviewStatus: 'all', olderOnly: false}); while (effects.length) effects.shift()(); return tree;},
  };
}

test('all eight categories keep one category control and one content heading without inline dates', () => {
  for (const width of [1440, 1024, 390, 320]) for (const category of historyFilters.historyCategories) {
    const tree = harness(width, category.key).render();
    const picker = nodes(tree).find(node => node.type === 'HistoryCategoryNavigation');
    assert.equal(picker.props.value, category.key);
    assert.equal(picker.props.compact, width < 880);
    assert.equal(nodes(tree).filter(node => node.props?.accessibilityRole === 'header' && node.props.children === category.label).length, 1);
    assert.equal(nodes(tree).some(node => node.type === 'AppDateField'), false);
    assert.equal(nodes(tree).some(node => node.type === 'Text' && JSON.stringify(node.props.children).includes('來源：')), false);
    assert.equal(!!labelled(tree, '日期篩選'), !['review', 'care', 'profile'].includes(category.key));
    assert.equal(!!labelled(tree, `搜尋${category.label}`), !['care', 'profile'].includes(category.key));
    if (category.key === 'notifications') assert.ok(nodes(tree).some(node => node.props?.children === '本人消息，涵蓋帳戶及其他孩子'));
    if (category.key === 'review') assert.ok(nodes(tree).some(node => node.props?.children === '按內容及處理狀態搜尋；暫不支援日期篩選。'));
  }
});


test('task and preparation modal selection keeps the complete history filter toolbar at every width', () => {
  for (const width of [1440, 1024, 390, 320]) for (const category of ['tasks', 'preparations']) {
    const h = harness(width, category);
    const label = historyFilters.historyCategories.find(item => item.key === category).label;
    const assertToolbar = tree => {
      assert.equal(nodes(tree).filter(node => node.props?.testID === 'history-filter-toolbar').length, 1);
      assert.equal(nodes(tree).filter(node => node.type === 'AppTextField' && node.props.label === `搜尋${label}`).length, 1);
      assert.equal(labelled(tree, '日期篩選').props.disabled, false);
      assert.ok(nodes(tree).some(node => node.type === (category === 'tasks' ? 'TaskHistoryView' : 'PreparationHistoryView')));
    };
    assertToolbar(h.render());
    for (const state of ['completed', 'cancelled']) {
      h.selectHistory({ occurrence: { state } }, { id: 'synthetic-archived-preparation', status: 'archived' });
      assertToolbar(h.render());
    }
    h.selectHistory(null, null);
    assertToolbar(h.render());
    assert.deepEqual(h.events, [], 'Selection must not navigate, close the owner or mutate filters');
  }
});

test('history date controls keep a wrapping toolbar and touch-safe AppButton sizing without return shortcuts', () => {
  for (const width of [1440, 1024, 390, 320]) {
    const h = harness(width), tree = h.render();
    const date = labelled(tree, '日期篩選');
    const group = nodes(tree).find(node => node.type === 'View' && node.props.children?.includes?.(date));
    assert.equal(group.props.style.flexWrap, 'wrap'); assert.equal(group.props.style.maxWidth, '100%'); assert.equal(group.props.style.alignItems, 'center');
    for (const entry of [date]) {
      const button = h.button(entry.props);
      assert.equal(button.props.compact, true); assert.equal(button.props.mode, 'outlined');
      assert.equal(flatten(button.props.style).height, undefined);
      if (width < 650) assert.ok(flatten(button.props.contentStyle).minHeight >= 48);
    }
    assert.deepEqual(h.events, []);
    const search = labelled(tree, '搜尋關注與成長'), wrapper = nodes(tree).find(node => node.props?.children === search);
    assert.equal(wrapper.props.style.minWidth, 0); assert.equal(wrapper.props.style.maxWidth, '100%');
  }
});

const result = (tree, type = 'GrowthHistoryView') => nodes(tree).find(node => node.type === type);
const dateDialog = tree => nodes(tree).find(node => node.type === 'FormDialog' && node.props.title === '日期篩選');
const appliedDates = tree => nodes(tree).find(node => node.props?.testID === 'history-applied-dates');

test('date drafts do not filter, close readers or show applied state before atomic apply', () => {
  const h = harness(); let tree = h.render();
  assert.equal(labelled(tree, '清除篩選'), undefined);
  labelled(tree, '搜尋關注與成長').props.onChangeText('  family  '); tree = h.render();
  const beforeEdit = h.events.length, trigger = labelled(tree, '日期篩選'); trigger.props.onPress(); tree = h.render();
  assert.equal(dateDialog(tree).props.visible, true); assert.equal(dateDialog(tree).props.returnFocusRef, trigger.props.ref);
  labelled(tree, '開始日期（可不填）').props.onChange('2026-09-01'); tree = h.render();
  labelled(tree, '結束日期（可不填）').props.onChange('2026-09-30'); tree = h.render();
  assert.equal(h.events.length, beforeEdit); assert.deepEqual(result(tree).props.dateRange, {from: null, to: null}); assert.equal(appliedDates(tree), undefined);
  labelled(tree, '套用日期').props.onPress(); tree = h.render();
  assert.deepEqual(h.events.slice(beforeEdit), ['close-tasks', 'close-preparation', 'close-care']); assert.equal(dateDialog(tree).props.visible, false);
  assert.equal(result(tree).props.searchText, '  family  '); assert.deepEqual(result(tree).props.dateRange, {from: '2026-09-01', to: '2026-09-30'});
  assert.equal(appliedDates(tree).props.children.join(''), '日期：2026-09-01 至 2026-09-30'); assert.ok(labelled(tree, '日期已篩選'));
  labelled(tree, '清除篩選').props.onPress(); tree = h.render();
  assert.equal(labelled(tree, '搜尋關注與成長').props.value, ''); assert.deepEqual(result(tree).props.dateRange, {from: null, to: null}); assert.equal(appliedDates(tree), undefined);
});

test('cancel, invalid drafts and draft clear leave results intact; reopen uses applied dates', () => {
  const h = harness(); let tree = h.render();
  labelled(tree, '日期篩選').props.onPress(); tree = h.render();
  labelled(tree, '開始日期（可不填）').props.onChange('2026-09-30'); tree = h.render();
  labelled(tree, '套用日期').props.onPress(); tree = h.render();
  assert.equal(appliedDates(tree).props.children.join(''), '日期：2026-09-30 起');
  const applied = result(tree).props.dateRange, beforeEdit = h.events.length;
  labelled(tree, '日期已篩選').props.onPress(); tree = h.render();
  for (const invalid of ['2026-09-01', '2026-02-29', '2026-9-1']) {
    labelled(tree, '結束日期（可不填）').props.onChange(invalid); tree = h.render();
    assert.ok(labelled(tree, '結束日期（可不填）').props.error); assert.equal(labelled(tree, '套用日期').props.disabled, true);
    labelled(tree, '套用日期').props.onPress(); tree = h.render();
    assert.equal(dateDialog(tree).props.visible, true); assert.deepEqual(result(tree).props.dateRange, applied);
  }
  labelled(tree, '清空日期').props.onPress(); tree = h.render();
  assert.equal(labelled(tree, '開始日期（可不填）').props.value, ''); assert.equal(labelled(tree, '結束日期（可不填）').props.value, ''); assert.deepEqual(result(tree).props.dateRange, applied);
  dateDialog(tree).props.onClose(); tree = h.render(); assert.equal(dateDialog(tree).props.visible, false); assert.equal(h.events.length, beforeEdit);
  labelled(tree, '日期已篩選').props.onPress(); tree = h.render();
  assert.equal(labelled(tree, '開始日期（可不填）').props.value, '2026-09-30'); assert.equal(labelled(tree, '結束日期（可不填）').props.value, '');
  labelled(tree, '清空日期').props.onPress(); tree = h.render(); labelled(tree, '套用日期').props.onPress(); tree = h.render();
  assert.deepEqual(result(tree).props.dateRange, {from: null, to: null});
});

test('original locks block search and apply without trapping disposable filter drafts', () => {
  const h = harness(); let tree = h.render();
  labelled(tree, '搜尋關注與成長').props.onChangeText('family'); tree = h.render();
  labelled(tree, '日期篩選').props.onPress(); tree = h.render(); labelled(tree, '開始日期（可不填）').props.onChange('2026-09-01'); tree = h.render();
  h.lock(); tree = h.render(); const count = h.events.length;
  for (const label of ['清除篩選', '搜尋關注與成長', '套用日期', '開始日期（可不填）', '結束日期（可不填）']) assert.equal(labelled(tree, label).props.disabled, true);
  labelled(tree, '搜尋關注與成長').props.onChangeText('blocked'); labelled(tree, '清除篩選').props.onPress(); labelled(tree, '套用日期').props.onPress(); tree = h.render();
  assert.equal(h.events.length, count); assert.equal(labelled(tree, '搜尋關注與成長').props.value, 'family'); assert.deepEqual(result(tree).props.dateRange, {from: null, to: null});
  dateDialog(tree).props.onClose(); tree = h.render(); assert.equal(dateDialog(tree).props.visible, false);
});

test('unsupported categories do not claim hidden dates are applied or lose original owners', () => {
  const h = harness(); let tree = h.render();
  labelled(tree, '日期篩選').props.onPress(); tree = h.render(); labelled(tree, '結束日期（可不填）').props.onChange('2026-09-30'); tree = h.render();
  labelled(tree, '套用日期').props.onPress(); tree = h.render();
  for (const [category, view] of [['review', 'CareReviewHistoryView'], ['care', 'CareSavedRecordsView'], ['profile', 'ProfileHistoryView']]) {
    nodes(tree).find(node => node.type === 'HistoryCategoryNavigation').props.onChange(category); tree = h.render();
    assert.ok(result(tree, view)); assert.equal(labelled(tree, '日期篩選'), undefined); assert.equal(labelled(tree, '日期已篩選'), undefined);
    assert.equal(appliedDates(tree), undefined); assert.equal(dateDialog(tree).props.visible, false);
  }
  nodes(tree).find(node => node.type === 'HistoryCategoryNavigation').props.onChange('growth'); tree = h.render();
  assert.deepEqual(result(tree).props.dateRange, {from: null, to: '2026-09-30'});
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
    'react': {useRef: value => ({current: value}), useEffect() {}, useState: initial => {const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], value => {slots[index] = value;}];}}, 'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': {View: 'View', Pressable: 'Pressable', StyleSheet: {create: value => value}, useWindowDimensions: () => ({width})}, 'react-native-paper': {Text: 'Text', Button: 'Button'},
    '../useInteractionDensity': {useInteractionDensity: () => touch},
    '../history/HistoryCards': {HistoryCardGrid: 'HistoryCardGrid'}, '../FormDialog': {FormDialog: 'FormDialog'},
    '../../growth-view-model': modelModule.exports,
    '../../workspaces/GrowthWorkspace': {useGrowthWorkspace: () => workspace},
    '../../theme': {colors: {line: '#CAC9D4', controlSurface: '#FFFFFE', ink: '#272343', quietSurface: '#EDFAF9', paleTeal: '#E3F6F5'}, mobileLayout: {breakpoint: 650, touchTarget: 48}, radius: {small: 10}, spacing: {xs: 4, sm: 8, md: 12, lg: 16}},
    './growth-styles': {growthStyles: {stack: {gap: 12}}},
    '../ui': {AppButton: 'AppButton'}, '../AppIcon': {AppIcon: 'AppIcon'},
    './GrowthConcernTimeline': {GrowthConcernTimeline: 'GrowthConcernTimeline'},
    '../EmptyListCard': {EmptyListCard: 'EmptyListCard'}, '../ReadStateNotice': {ReadStateNotice: 'ReadStateNotice'},
    './GrowthOperationRecovery': {GrowthOperationRecovery: 'GrowthOperationRecovery'},
    '../StatusAnnouncement': {StatusAnnouncement: 'StatusAnnouncement'},
  };
  new Function('require', 'module', 'exports', output)(name => { assert.ok(Object.hasOwn(dependencies, name), `Unmocked closed-history dependency: ${name}`); return dependencies[name]; }, module, module.exports);
  return {calls, get workspace() {return workspace;}, setWorkspace(value) {workspace = value;}, render(searchText = '') {cursor = 0; return module.exports.GrowthHistoryView({searchText, dateRange: {from: null, to: null}, onTask() {}});}};
}
const identified = (tree, id) => nodes(tree).find(node => node.props?.testID === id);

const restoreControl = tree => nodes(tree).find(node => node.type === 'Button' && node.props.accessibilityLabel?.startsWith('恢復關注：'));
const readingControl = tree => nodes(tree).find(node => node.type === 'Pressable' && node.props.accessibilityLabel?.startsWith('查看已結束關注：'));

test('closed concerns are whole content-first cards; restore remains a secondary detail action', () => {
  for (const [width, touch] of [[1440, false], [1024, true], [390, false], [320, false]]) {
    const h = closedHistoryHarness(width, touch);
    for (const id of ['one', 'two']) {
      let tree = h.render(); const card = identified(tree, `growth-history-${id}`);
      assert.equal(card.type, 'Pressable'); assert.equal(card.key, id);
      const style = flatten(card.props.style({pressed: false}));
      assert.equal(style.borderWidth, 1); assert.equal(style.backgroundColor, '#FFFFFE');
      assert.equal(restoreControl(card), undefined, 'No nested mutation inside the reading target');
      const texts = nodes(card).filter(node => node.type === 'Text');
      assert.equal(texts[0].props.children, id === 'one' ? '第一條' : '第二條');
      assert.ok(texts[1].props.children.includes('摘要')); assert.match(texts[2].props.children, /^結束於 /);
      card.props.onPress(); tree = h.render();
      const dialog = nodes(tree).find(node => node.type === 'FormDialog'); assert.equal(dialog.props.visible, true);
      const restore = restoreControl(dialog); assert.ok(restore);
      assert.equal(restore.props.mode, 'text'); assert.equal(restore.props.compact, true);
      assert.ok(flatten(restore.props.contentStyle).minHeight >= (touch || width < 650 ? 48 : 40));
      let stopped = false; restore.props.onPress({stopPropagation() {stopped = true;}}); assert.equal(stopped, true);
      dialog.props.onClose(); tree = h.render(); assert.equal(restoreControl(tree), undefined);
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
  nodes(tree).find(node => node.type === 'FormDialog').props.onClose(); tree = h.render();
  readingControl(identified(tree, 'growth-history-one')).props.onPress(); tree = h.render();
  assert.equal(timeline().length, 1); assert.equal(timeline()[0].props.concern.id, 'one');
  h.setWorkspace({...h.workspace, scopeKey: 'scope-b'}); tree = h.render();
  assert.equal(timeline().length, 0);
});

test('lightweight restore retains locked, dirty, missing-state and viewer gates, with keyboard and hover reading feedback', () => {
  for (const mutate of [model => {model.locked = true;}, model => {model.dirty = true;}, model => {delete model.page.concerns.items[0].statusBeforeArchive;}]) {
    const h = closedHistoryHarness(); mutate(h.workspace.model);
    const card = readingControl(identified(h.render(), 'growth-history-one')); card.props.onPress();
    assert.equal(restoreControl(h.render()).props.disabled, true);
  }
  const h = closedHistoryHarness(); let tree = h.render(), reading = readingControl(identified(tree, 'growth-history-one'));
  reading.props.onFocus(); tree = h.render(); reading = readingControl(identified(tree, 'growth-history-one'));
  assert.equal(flatten(reading.props.style({pressed: false})).borderColor, '#272343');
  reading.props.onBlur(); reading.props.onHoverIn(); tree = h.render(); reading = readingControl(identified(tree, 'growth-history-one'));
  assert.equal(flatten(reading.props.style({pressed: false})).backgroundColor, '#EDFAF9');
  const pressed = flatten(reading.props.style({pressed: true}));
  assert.equal(pressed.opacity ?? 1, 1);
  assert.equal(pressed.backgroundColor, '#E3F6F5');
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
  assert.equal(nodes(harness().render()).some(node => node.props?.accessibilityRole === 'header' && node.props.children === '關注與成長'), true);
  assert.ok(!screen.includes('日期按結束關注的時間篩選'));
});


test('profile history category renders the same scoped reader on desktop and mobile without fake search or eager reads', () => {
  for (const width of [1440, 1024, 390, 320]) {
    const h = harness(width, 'profile'), tree = h.render();
    assert.ok(nodes(tree).some(node => node.type === 'ProfileHistoryView'));
    assert.equal(nodes(tree).some(node => node.props?.testID === 'history-filter-toolbar'), false);
    const picker = nodes(tree).find(node => node.type === 'HistoryCategoryNavigation');
    assert.equal(picker.props.value, 'profile');
    assert.equal(picker.props.compact, width < 880);
    assert.equal(h.events.includes('profile-history-read'), false);
    assert.equal(labelled(tree, '查看檔案'), undefined);
    assert.deepEqual(h.events, []);
  }
});


test('all history categories omit redundant return shortcuts and empty toolbars while preserving the reader', () => {
  const shortcuts = ['開啟待辦', '開啟準備單', '開啟核對', '查看檔案', '查看持續關注', '查看年度與季度檔案'];
  for (const width of [1440, 1024, 390, 320]) for (const category of historyFilters.historyCategories) {
    const h = harness(width, category.key), tree = h.render();
    for (const shortcut of shortcuts) assert.equal(labelled(tree, shortcut), undefined, `${category.key}: ${shortcut}`);
    assert.equal(tree.props.title, '歷史資料庫');
    const toolbar = nodes(tree).find(node => node.props?.testID === 'history-filter-toolbar');
    if (['care', 'profile'].includes(category.key)) assert.equal(toolbar, undefined, 'Do not leave an empty surface or spacing row');
    else assert.equal(toolbar.props.testID, 'history-filter-toolbar');
    assert.ok(nodes(tree).some(node => node.props?.testID === 'history-current-results' && node.props.accessibilityLabel === category.label));
    assert.deepEqual(h.events, []);
  }
});
