import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';
import * as filters from '../src/components/history/history-filters.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  const children = Array.isArray(tree) ? tree : tree.props?.children;
  return [tree, ...(Array.isArray(children) ? children.flatMap(nodes) : nodes(children))];
}
const find = (tree, type) => nodes(tree).find(node => node.type === type);
const label = (tree, value) => nodes(tree).find(node => node.props?.label === value);

// Test only the merged History/provider boundaries; individual Care owner tests are not repeated.
function harness() {
  const slots = [], effects = [], events = [];
  let cursor = 0, pending, params = {}, width = 1024;
  const production = { scopeKey: 'scope-a', model: { caregiverName: 'Parent', selectedChildId: 'child-a', children: [{ id: 'child-a', displayName: 'A', accessRole: 'owner' }] }, actions: { prepareQuestion: question => events.push(['prepare-question', question]) } };
  let care = { scopeKey: 'scope-a', model: { scopeKey: 'scope-a', access: 'editable', online: true, list: { state: 'ready' }, operation: { state: 'none' }, draft: null, deletion: null, review: { state: 'ready' } }, actions: { closePanel: () => events.push('close-care') } };
  const preparations = { scopeKey: 'scope-a', model: { condition: 'ready', documents: [], selected: null }, actions: { closeDocument: () => events.push('close-preparation') } };
  const tasks = { model: { reading: false, access: 'editable', operation: { state: 'none' }, draft: null, selected: null, scheduleContext: { timeZone: 'Asia/Hong_Kong' } }, actions: { closePanel: () => events.push('close-task') } };
  const react = {
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useReducer(reducer, argument, initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial(argument); return [slots[index], action => { slots[index] = reducer(slots[index], action); }]; },
    useEffect(fn, deps) { const index = cursor++, old = slots[index]; if (!old || deps.some((value, key) => !Object.is(value, old[key]))) effects.push(fn); slots[index] = deps; },
  };
  const dependencies = {
    'react': react, 'react/jsx-runtime': require('react/jsx-runtime'),
    'expo-router': { usePathname: () => '/history', useLocalSearchParams: () => params, useRouter: () => ({ push: target => events.push(['push', target]), setParams: value => { params = { ...params, ...value }; events.push(['params', value]); } }) },
    'react-native': { View: 'View', StyleSheet: { create: value => value } }, 'react-native-paper': { Text: 'Text' },
    '../production/ProductionProvider': { useProduction: () => production },
    '../preview/PreviewNavigationGuard': { usePreviewNavigation: () => action => { events.push('guard'); pending = action; } },
    '../workspaces/TasksWorkspace': { useTasksWorkspace: () => tasks },
    '../workspaces/PreparationWorkspace': { usePreparationWorkspace: () => preparations },
    '../workspaces/CareWorkspace': { useCareWorkspace: () => care },
    '../workspaces/GrowthWorkspace': { useGrowthWorkspace: () => null },
    '../components/useContainerWidth': { useContainerWidth: () => ({ width, ref: null, onLayout() {} }) },
    '../components/history/history-filters': filters,
    '../components/DateTimeFields': { AppDateField: 'AppDateField' },
    '../components/PageFrame': { PageFrame: 'PageFrame' },
    '../components/ui': { AppButton: 'AppButton', AppSelect: 'AppSelect', AppTabPanel: 'AppTabPanel', AppTextField: 'AppTextField', UnderlineTabs: 'UnderlineTabs' },
    '../components/tasks/TaskHistoryView': { TaskHistoryView: 'TaskHistoryView' },
    '../components/care/CareReviewHistoryView': { CareReviewHistoryView: 'CareReviewHistoryView' },
    '../components/care/CareSavedRecordsView': { CareSavedRecordsView: 'CareSavedRecordsView' },
    '../components/preparations/PreparationWorkspace': { PreparationHistoryView: 'PreparationHistoryView' },
    '../components/growth/GrowthHistoryView': { GrowthHistoryView: 'GrowthHistoryView' },
    '../preparation-view-model': { searchPreparationHistory: () => [] },
    '../theme': { colors: {}, readingType: {}, spacing: {} },
  };
  const output = ts.transpileModule(readFileSync(path.join(root, 'src/screens/historyScreen.tsx'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output + '\nexports.HistoryWorkspace = HistoryWorkspace;')(name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unmocked History dependency: ${name}`);
    return dependencies[name];
  }, module, module.exports);
  const defaults = { scope: 'scope-a', childName: 'A', initialCategory: 'review', initialReviewStatus: 'all', olderOnly: false };
  return {
    events, production, get care() { return care; }, setCare(value) { care = value; }, query(value) { params = value; }, width(value) { width = value; },
    route() { return module.exports.default(); },
    render(props = {}) { cursor = 0; let tree = module.exports.HistoryWorkspace({ ...defaults, ...props }); while (effects.length) effects.shift()(); return tree; },
    approve() { const action = pending; pending = null; action?.(); },
  };
}

test('production owners compose once and keep Summary/Profile/Preparation and native route structure', () => {
  const rootLayout = readFileSync(path.join(root, 'app/_layout.tsx'), 'utf8');
  const layout = readFileSync(path.join(root, 'app/(dashboard)/_layout.tsx'), 'utf8');
  const domains = readFileSync(path.join(root, 'src/production/ProductionDomains.tsx'), 'utf8');
  const care = readFileSync(path.join(root, 'src/production/CareProfileDomains.tsx'), 'utf8');
  const knowledge = readFileSync(path.join(root, 'src/production/TaskKnowledgeDomains.tsx'), 'utf8');
  const photos = readFileSync(path.join(root, 'src/production/PhotoInputDomains.tsx'), 'utf8');
  const composition = [rootLayout, layout, domains, care, knowledge, photos].join('\n');
  for (const provider of ['ProductionProvider', 'BackgroundProvider', 'ProductionDomains', 'ProductionCareProfileDomains', 'ProductionTaskKnowledgeDomains', 'ProductionPhotoInputDomains', 'ProductionSettingsDomains', 'TasksWorkspaceProvider', 'ProfileWorkspaceProvider', 'PreparationWorkspaceProvider', 'CareWorkspaceProvider']) {
    assert.equal((composition.match(new RegExp(`<${provider}(?:>|\\s)`, 'g')) ?? []).length, 1, provider);
  }
  assert.doesNotMatch(composition, /<(?:PreviewProvider|PhotosWorkspaceProvider)(?:>|\s)/);
  assert.match(rootLayout, /<ProductionProvider><ProductionFirstScreenGate\b[\s\S]*<Stack\b/);
  assert.match(layout, /<ProductionGate><BackgroundProvider key=\{identityKey\}><ProductionDomains>/);
  assert.match(domains, /<ProductionCareProfileDomains><ProductionTaskKnowledgeDomains><ProductionPhotoInputDomains><ProductionSettingsDomains>/);
  assert.match(care, /<CareWorkspaceProvider scopeKey=\{env.scopeKey\} value=\{scoped\?\.care \?\? null\}>\s*<ProfileWorkspaceProvider scopeKey=\{env.scopeKey\} value=\{scoped\?\.profile \?\? null\}>/);
  assert.match(knowledge, /<TasksWorkspaceProvider scopeKey=\{env.scopeKey\} value=\{current\?\.tasks \?\? null\}>\s*<PreparationWorkspaceProvider scopeKey=\{env.scopeKey\} value=\{current\?\.documents.preparation \?\? null\}>/);
  assert.equal((photos.match(/<PhotoInputContext\.Provider\b/g) ?? []).length, 1);
  assert.equal((layout.match(/<Tabs\.Screen name=/g) ?? []).length, 5);
  assert.match(layout, /\["more", "history", "memory", "photos", "sources", "summary"/);
  const summary = readFileSync(path.join(root, 'src/screens/SummaryScreen.tsx'), 'utf8');
  assert.match(summary, /<ChildOverviewContent\b/);
  assert.match(summary, /<PreparationWorkspace\b/);
  assert.match(summary, /tab === "legacy-preparation" \? <TaskKnowledgeSummaryContent preparation\b/);
  // Source-level composition only; this does not exercise React provider lifecycles.
});

test('native Records navigation recognizes History without adding a sixth primary tab', () => {
  const layout = readFileSync(path.join(root, 'app/(dashboard)/_layout.tsx'), 'utf8');
  const predicate = layout.match(/<RecordsNavButton\s+active=\{([^}]+)\}/)?.[1];
  assert.ok(predicate, 'Native Records must declare its route activity');
  const active = new Function('pathname', `return (${predicate});`);
  for (const pathname of ['/care', '/more', '/photos', '/history']) assert.equal(active(pathname), true, pathname);
  for (const pathname of ['/', '/chat', '/tasks', '/growth']) assert.equal(active(pathname), false, pathname);
  assert.equal((layout.match(/<Tabs\.Screen name=/g) ?? []).length, 5);
  // Source-level composition only; this does not validate a native navigator or device.
});

test('review and older-pending deep links feed the single Care owner with no pretend date filter', () => {
  const h = harness(); h.query({ category: 'review', status: 'pending', older: '1' });
  const route = h.route(), tree = h.render(route.props), review = find(tree, 'CareReviewHistoryView');
  assert.equal(route.key, h.production.scopeKey); assert.equal(route.props.scope, h.production.scopeKey);
  assert.equal(review.props.model, h.care.model); assert.equal(review.props.actions, h.care.actions);
  assert.equal(review.props.initialStatus, 'pending'); assert.equal(review.props.olderOnly, true);
  assert.equal(find(tree, 'AppDateField'), undefined); assert.ok(label(tree, '搜尋核對記錄'));
  assert.equal(find(tree, 'CareSavedRecordsView'), undefined);
});

test('review search is blocked by original operations or active forms and masks a missing scope', () => {
  const h = harness(); let tree = h.render(); label(tree, '搜尋核對記錄').props.onChangeText('  milk  '); tree = h.render();
  assert.equal(find(tree, 'CareReviewHistoryView').props.searchText, '  milk  ');
  h.care.model.operation.state = 'unknown'; tree = h.render(); assert.equal(label(tree, '搜尋核對記錄').props.disabled, true);
  label(tree, '搜尋核對記錄').props.onChangeText('must not replace'); tree = h.render();
  assert.equal(find(tree, 'CareReviewHistoryView').props.searchText, '  milk  ');
  h.setCare(null); tree = h.render(); assert.equal(find(tree, 'CareReviewHistoryView'), undefined); assert.equal(label(tree, '搜尋核對記錄').props.disabled, true);
});

test('saved-record history owns its own search and paging without a duplicate toolbar', () => {
  const h = harness(), tree = h.render({ initialCategory: 'care' }), records = find(tree, 'CareSavedRecordsView');
  assert.equal(records.props.model, h.care.model); assert.equal(records.props.actions, h.care.actions);
  assert.equal(nodes(tree).some(node => node.props?.testID === 'history-filter-toolbar'), false);
  assert.equal(find(tree, 'AppDateField'), undefined); assert.equal(find(tree, 'PreparationHistoryView'), undefined);
});

test('preparation History keeps its owner, dates, scroll connection and return tab after Care integration', () => {
  const h = harness(), tree = h.render({ initialCategory: 'preparations' }), preparation = find(tree, 'PreparationHistoryView');
  assert.equal(preparation.props.onPrepareQuestion, h.production.actions.prepareQuestion);
  assert.deepEqual(preparation.props.dateRange, { from: null, to: null });
  assert.equal(preparation.props.scrollRef, tree.props.scrollRef);
  tree.props.onScroll({ nativeEvent: { contentOffset: { y: 315 } } }); assert.equal(preparation.props.getScrollPosition(), 315);
  assert.equal(nodes(tree).filter(node => node.type === 'AppDateField').length, 2);
  label(tree, '開啟準備單').props.onPress(); assert.deepEqual(h.events, ['guard']); h.approve();
  assert.deepEqual(h.events.at(-1), ['push', { pathname: '/summary', params: { tab: 'preparation' } }]);
});

test('category navigation waits for the guard and clears prior review-only URL filters', () => {
  const h = harness(); h.query({ category: 'review', status: 'pending', older: '1' }); const tree = h.render();
  find(tree, 'UnderlineTabs').props.onChange('preparations'); assert.deepEqual(h.events, ['guard']);
  assert.ok(find(h.render(), 'CareReviewHistoryView')); h.approve();
  assert.deepEqual(h.events.slice(1), ['close-task', 'close-preparation', 'close-care', ['params', { category: 'preparations', status: undefined, older: undefined }]]);
  assert.ok(find(h.render(), 'PreparationHistoryView'));
});
