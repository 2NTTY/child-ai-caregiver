import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';
import { careKindOptions } from '../src/care-view-model.ts';
import { taskStateLabels } from '../src/task-view-model.ts';
import { summaryPeriodLabel, summaryTime } from '../src/summary-view-model.ts';
import { summaryPeriodSchema } from '../src/components/summary/summary-form.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const source = file => readFileSync(path.join(root, file), 'utf8');
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  const children = Array.isArray(tree) ? tree : tree.props?.children;
  return [tree, ...(Array.isArray(children) ? children.flatMap(nodes) : nodes(children))];
}
const find = (tree, type) => nodes(tree).find(node => node.type === type);
function compile(file, resolve, suffix = "") {
  const output = ts.transpileModule(source(file), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output + suffix)(resolve, module, module.exports);
  return module.exports;
}

// Deterministic route and guard harness. It checks composition, not browser layout or real navigation.
function harness(screen = "summary") {
  let cursor = 0, route = '/' + screen, params = {}, pending = null, measurements, profileSource;
  const slots = [], events = [], effects = [];
  let identityKey = 'synthetic-parent';
  const scope = () => model.selectedChildId ? JSON.stringify(['synthetic-server', identityKey, model.selectedChildId, model.children.find(child => child.id === model.selectedChildId)?.accessRole]) : null;
  let model = { caregiverName: 'Parent', selectedChildId: 'child-a', connection: 'online', children: [{ id: 'child-a', displayName: 'Child A', accessRole: 'owner' }, { id: 'child-b', displayName: 'Child B', accessRole: 'viewer' }] };
  const react = {
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useEffect(fn, deps) {
      const index = cursor++, old = slots[index];
      if (!old || deps.some((value, key) => !Object.is(value, old.deps[key]))) {
        slots[index] = { deps, cleanup: old?.cleanup };
        effects.push(() => { slots[index].cleanup?.(); slots[index].cleanup = fn(); });
      }
    },
  };
  react.useLayoutEffect = react.useEffect;
  const dependencies = {
    'react': react,
    'react/jsx-runtime': require('react/jsx-runtime'),
    'expo-router': { Redirect: 'Redirect', usePathname: () => route, useLocalSearchParams: () => params,
      useRouter: () => ({ push: value => events.push(['push', value]), setParams: value => { events.push(['params', value]); params = { ...params, ...value }; } }) },
    'react-native': { View: 'View', StyleSheet: { create: value => value } },
    'react-native-paper': { Text: 'Text' },
    '../production/ProductionProvider': { useProduction: () => ({ identityKey, scopeKey: scope(), model, actions: { prepareQuestion: question => events.push(['prepare-question', question]) } }) },
    '../production/useProductionAvatar': { useProductionAvatar: () => ({ state: { key: scope(), uri: null } }) },
    '../components/avatar/AvatarView': { AvatarView: 'AvatarView' },
    '../platform/file-export': { useFileExportAvailable: () => typeof document !== 'undefined' },
    '../preview/PreviewNavigationGuard': { usePreviewNavigation: () => action => { events.push(['guard']); pending = action; } },
    '../workspaces/ProfileWorkspace': { useProfileWorkspace: () => ({ scopeKey: scope(), measurements, profileSource, actions: { showHistory: () => events.push(['profile-history']) } }) },
    '../components/growth/GrowthArchive': { GrowthArchive: 'GrowthArchive' },
    '../components/growth/GrowthView': { GrowthView: 'GrowthView' },
    '../components/useContainerWidth': { useContainerWidth: () => ({ ref: null, width: 900, onLayout() {} }) },
    '../components/ReadStateNotice': { ReadStateNotice: 'ReadStateNotice' },
    '../production/TaskKnowledgeDomains': { useProductionFamilyDocuments: () => ({ exportReport: 'synthetic-export', exportBusy: false }) },
    '../production/FamilyReportControls': { FamilyReportControls: 'FamilyReportControls' },
    '../production/TaskKnowledgeGrowthCandidates': { TaskKnowledgeGrowthCandidates: 'TaskKnowledgeGrowthCandidates' },
    '../workspaces/GrowthWorkspace': { useGrowthWorkspace: () => ({ scopeKey: scope(), model: growthModel, actions: { refresh: combinedRefresh } }) },
    '../workspaces/TasksWorkspace': { useTasksWorkspace: () => ({ actions: { selectTask: id => events.push(['task', id]) } }) },
    '../workspaces/PreparationWorkspace': { usePreparationWorkspace: () => ({ actions: { closeDocument: () => events.push(['close-preparation']) } }) },
    '../theme': { colors: {}, readingType: {}, spacing: {} },
    '../components/child-overview/ChildOverviewConcerns': { ChildOverviewConcerns: 'ChildOverviewConcerns' },
    '../components/child-overview/ChildOverviewContent': { ChildOverviewContent: 'ChildOverviewContent' },
    '../components/preparations/PreparationWorkspace': { PreparationWorkspace: 'PreparationWorkspace' },
    '../components/PageFrame': { PageFrame: 'PageFrame' },
    '../components/ui': { AppButton: 'AppButton', AppTabPanel: 'AppTabPanel', UnderlineTabs: 'UnderlineTabs' },
    '../production/TaskKnowledgeSummaryContent': { TaskKnowledgeSummaryContent: 'TaskKnowledgeSummaryContent' },
  };
  const combinedRefresh = () => events.push(["combined-refresh"]);
  const growthModel = { scopeKey: scope(), online: true, page: { authorityVersion: 'retained-authority', archive: { state: 'invalidated' } } };
  const exports = compile(screen === 'summary' ? 'src/screens/SummaryScreen.tsx' : 'src/screens/GrowthScreen.tsx', name => { assert.ok(Object.hasOwn(dependencies, name), `Unmocked Summary dependency: ${name}`); return dependencies[name]; });
  return {
    normalize: exports.normalizeSummaryTab, events, growthModel,
    render() { cursor = 0; const tree = screen === "summary" ? exports.SummaryScreen() : exports.GrowthScreen(); while (effects.length) effects.shift()(); return tree; },
    query(value) { params = value; }, route(value) { route = value; },
    child(value) { model = { ...model, selectedChildId: value }; },
    identity(value) { identityKey = value; },
    role(value) { model = { ...model, children: model.children.map(child => child.id === model.selectedChildId ? { ...child, accessRole: value } : child) }; },
    profile(value) { ({ measurements, profileSource } = value); },
    approve() { const action = pending; pending = null; action?.(); },
    cancel() { pending = null; },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

// Execute the shipped summary content, record list and row callbacks with synthetic data.
// Host components are shallow; this does not exercise a browser, Expo Router or the guard dialog.
function summaryTaskRows(props) {
  const tasks = [
    { id: '8c0614da-d04f-454e-837a-b0d0f1649034' },
    { id: 'cd90c73b-7934-4eac-b34e-4262cecf26ab' },
  ].map(task => ({ ...task, title: 'Same synthetic appointment title', details: '', assigneeUserId: 'synthetic-parent',
    createdBy: 'synthetic-parent', updatedAt: '2026-10-22T08:00:00Z', version: 1,
    occurrence: { id: `occurrence-${task.id}`, state: 'scheduled', dueAt: '2026-10-23T08:00:00Z', timeZone: 'Asia/Hong_Kong' } }));
  const query = { startDay: '2026-10-22', period: 'day', timeZone: 'Asia/Hong_Kong' };
  const page = { childId: props.childId ?? 'child-a', period: query, generatedAt: '2026-10-22T08:00:00Z', canManage: true,
    counts: {}, metrics: [], records: [], conflicts: tasks, appointments: tasks,
    missing: { unknownEventTime: 0, invalidQuantities: 0, emptyKinds: [] } };
  const elements = new Proxy({}, { get: (_target, key) => String(key) });
  const dependencies = {
    react: { useState: value => [value, () => {}], useRef: value => ({ current: value }), useEffect() {} },
    'react/jsx-runtime': require('react/jsx-runtime'), 'react-native': { View: 'View' }, 'react-native-paper': { Text: 'Text' },
    '../preview/PreviewNavigationGuard': { usePreviewNavigation: () => () => assert.fail('Rows must use the screen guard') },
    './TaskKnowledgeDomains': { useProductionTaskKnowledgeSummary: () => ({ model: {
      scopeKey: props.scopeKey ?? 'synthetic-scope', page, query, online: true, busy: false, pending: null, access: 'editable', operation: 'none',
    }, actions: {} }) },
    '../summary-view-model': { summaryPeriodLabel, summaryTime }, '../../summary-view-model': { summaryTime },
    '../../care-view-model': { careKindOptions }, '../../task-view-model': { taskStateLabels },
    '../components/summary/summary-form': { summaryPeriodSchema },
    '../components/summary/summary-styles': { summaryStyles: {} }, './summary-styles': { summaryStyles: {} },
  };
  const resolve = name => dependencies[name] ?? elements;
  const { TaskKnowledgeSummaryContent } = compile('src/production/TaskKnowledgeSummaryContent.tsx', resolve);
  const { SummaryRecords } = compile('src/components/summary/SummaryRecords.tsx', resolve);
  const content = TaskKnowledgeSummaryContent(props), records = find(content, 'SummaryRecords');
  return nodes(SummaryRecords(records.props)).filter(node => node.type?.name === 'TaskSource').map(node => ({
    group: node.props.group, id: node.props.task.id,
    press: nodes(node.type(node.props)).find(button => button.type === 'AppButton' && button.props.label === '核對這項任務').props.onPress,
  }));
}

test('summary conflict and appointment rows preserve the exact A/B task id through the screen guard', () => {
  for (const group of ['conflict', 'appointment']) for (const index of [0, 1]) {
    const h = harness(), content = find(h.render(), 'TaskKnowledgeSummaryContent');
    const rows = summaryTaskRows(content.props).filter(row => row.group === group), row = rows[index];
    assert.notEqual(rows[0].id, rows[1].id);
    row.press(); assert.deepEqual(h.events, [['guard']], 'No selection or navigation before guard approval');
    h.approve(); assert.deepEqual(h.events, [['guard'], ['push', `/tasks?taskId=${encodeURIComponent(row.id)}`]]);
    h.unmount();
  }
});

test('both summary branches preserve and encode task ids without selecting another owner', () => {
  for (const tab of ['overview', 'legacy-preparation']) for (const id of ['8c0614da-d04f-454e-837a-b0d0f1649034', 'cd90c73b-7934-4eac-b34e-4262cecf26ab', 'invalid&id=other#task']) {
    const h = harness(); h.query({ tab });
    find(h.render(), 'TaskKnowledgeSummaryContent').props.onTask(id); h.approve();
    assert.deepEqual(h.events, [['guard'], ['push', `/tasks?taskId=${encodeURIComponent(id)}`]]);
    h.unmount();
  }
});

test('summary task navigation rejects cancellation and late approval after scope, route, tab or unmount changes', () => {
  for (const tab of ['overview', 'legacy-preparation']) for (const change of [
    h => h.child('child-b'), h => h.identity('other-parent'), h => h.role('viewer'),
    h => h.route('/history'), h => h.query({ tab: 'archive' }), h => h.cancel(), h => h.unmount(),
  ]) {
    const h = harness(); h.query({ tab });
    find(h.render(), 'TaskKnowledgeSummaryContent').props.onTask('8c0614da-d04f-454e-837a-b0d0f1649034');
    change(h); if (!change.toString().includes('unmount')) h.render(); h.approve();
    assert.deepEqual(h.events, [['guard']]); h.unmount();
  }
});

test('summary defaults to overview while archive consumes the same authority-gated growth projection', () => {
  const h = harness();
  for (const value of [undefined, '', 'report', 'unknown', [], ['overview', 'archive']]) assert.equal(h.normalize(value), 'overview');
  assert.equal(h.normalize('archive'), 'archive'); assert.equal(h.normalize('legacy-preparation'), 'legacy-preparation');
  let tree = h.render(); assert.equal(tree.props.title, '孩子概況');
  assert.equal(find(tree, 'UnderlineTabs').props.label, '概況與成長檔案');
  assert.deepEqual(find(tree, 'UnderlineTabs').props.items, [{ key: 'overview', label: '概況' }, { key: 'archive', label: '成長檔案' }]);
  assert.ok(find(tree, 'ChildOverviewContent')); assert.ok(find(tree, 'TaskKnowledgeSummaryContent'));
  assert.equal(find(tree, 'GrowthArchive'), undefined); assert.equal(find(tree, 'PreparationWorkspace'), undefined);
  h.query({ tab: 'archive' }); tree = h.render();
  assert.equal(find(tree, 'ChildOverviewContent'), undefined); assert.equal(find(tree, 'TaskKnowledgeSummaryContent'), undefined);
  assert.equal(find(tree, 'GrowthArchive').props.model, h.growthModel);
  assert.equal(find(tree, 'GrowthArchive').props.model.page.archive.state, 'invalidated');
  assert.equal(find(tree, 'GrowthArchive').props.scrollRef, tree.props.scrollRef);
  assert.equal(find(tree, 'FamilyReportControls').props.scopeKey, h.growthModel.scopeKey);
  find(tree, 'FamilyReportControls').props.onRefresh(); assert.deepEqual(h.events.at(-1), ['combined-refresh']);
});

test('old preparation and archive links redirect once to canonical pages without creating another owner', () => {
  const summary = harness(); summary.query({ tab: 'preparation' });
  assert.equal(summary.render().type, 'Redirect'); assert.equal(summary.render().props.href, '/growth?tab=preparation');
  const growth = harness('growth'); growth.query({ tab: 'archive' });
  assert.equal(growth.render().type, 'Redirect'); assert.equal(growth.render().props.href, '/summary?tab=archive');
  summary.query({ tab: 'archive' }); assert.equal(summary.render().type, 'PageFrame');
  growth.query({ tab: 'preparation' }); assert.equal(growth.render().type, 'GrowthView');
});

test('overview measurements keep the original owner and profile history navigates only after approval', () => {
  const h = harness(), measurements = { childId: 'child-a', state: 'ready' }, profileSource = { state: 'available' };
  h.profile({ measurements, profileSource }); const overview = find(h.render(), 'ChildOverviewContent');
  assert.equal(overview.props.measurements, measurements); assert.equal(overview.props.profileSource, profileSource);
  overview.props.onOpenMeasurement('canonical-record'); assert.deepEqual(h.events, [['guard']]); h.approve();
  assert.deepEqual(h.events.at(-1), ['push', { pathname: '/care', params: { record: 'canonical-record' } }]);
  const before = h.events.length; overview.props.onOpenProfileHistory();
  assert.deepEqual(h.events.slice(before), [['guard']]); h.approve();
  assert.deepEqual(h.events.at(-1), ['push', '/history?category=profile']);
  assert.equal(h.events.some(event => event[0] === 'profile-history'), false, 'Navigation must not eagerly read history');
});

test('growth preparation and concern actions stay wired, and switching tabs closes only after guard approval', () => {
  const h = harness('growth'); let tree = h.render();
  assert.equal(tree.props.tab, 'concerns'); tree.props.onTabChange('preparation');
  assert.deepEqual(h.events, [['guard']]); assert.equal(h.render().props.tab, 'concerns'); h.approve(); tree = h.render();
  assert.equal(tree.props.tab, 'preparation'); assert.deepEqual(h.events.slice(-2), [['close-preparation'], ['params', { tab: 'preparation' }]]);
  tree.props.onPreparationHistory(); h.approve(); assert.deepEqual(h.events.at(-1), ['push', { pathname: '/history', params: { category: 'preparations' } }]);
  tree.props.onTask('original-task'); h.approve(); assert.deepEqual(h.events.slice(-2), [['task', 'original-task'], ['push', '/tasks']]);
  tree.props.onPrepareQuestion('synthetic question'); assert.deepEqual(h.events.at(-1), ['prepare-question', 'synthetic question']);
});

test('both regrouped pages reject late guard approval after scope, route, tab or unmount changes', () => {
  for (const screen of ['summary', 'growth']) for (const change of [h => h.child('child-b'), h => h.identity('Other parent'), h => h.route('/history'), h => h.query({ tab: screen === 'summary' ? 'archive' : 'preparation' }), h => h.unmount()]) {
    const h = harness(screen), tree = h.render();
    if (screen === 'summary') find(tree, 'UnderlineTabs').props.onChange('archive'); else tree.props.onTabChange('preparation');
    change(h); if (change.toString().includes('unmount') === false) h.render(); h.approve();
    assert.deepEqual(h.events, [['guard']]);
  }
});

test('legacy preparation keeps the production summary recovery, and tab switches remain guarded', () => {
  const h = harness(); h.query({ tab: 'legacy-preparation' }); let tree = h.render();
  const recovery = find(tree, 'TaskKnowledgeSummaryContent'); assert.equal(recovery.props.preparation, true);
  assert.equal(find(tree, 'GrowthArchive'), undefined); assert.equal(find(tree, 'ChildOverviewContent'), undefined);
  find(tree, 'UnderlineTabs').props.onChange('overview'); assert.deepEqual(h.events, [['guard']]);
  assert.equal(find(h.render(), 'TaskKnowledgeSummaryContent').props.preparation, true); h.approve(); tree = h.render();
  assert.equal(find(tree, 'UnderlineTabs').props.value, 'overview'); assert.ok(find(tree, 'ChildOverviewContent'));
});

test('scope changes reset presentation while hidden native routes do not mount another reader', () => {
  for (const screen of ['summary', 'growth']) {
    const h = harness(screen); let tree = h.render();
    h.route('/history'); assert.equal(h.render(), null);
    h.route('/' + screen); h.child(null); tree = h.render();
    assert.equal(find(tree, 'ChildOverviewContent'), undefined); assert.equal(find(tree, 'GrowthArchive'), undefined); assert.equal(tree.type, 'PageFrame');
  }
});

test('shared production owners mount once without altering five native tabs or navigation groups', () => {
  const rootLayout = source('app/_layout.tsx'), layout = source('app/(dashboard)/_layout.tsx');
  const domains = source('src/production/ProductionDomains.tsx'), care = source('src/production/CareProfileDomains.tsx');
  const knowledge = source('src/production/TaskKnowledgeDomains.tsx'), photos = source('src/production/PhotoInputDomains.tsx');
  const composition = [rootLayout, layout, domains, care, knowledge, photos].join('\n');
  for (const provider of ['ProductionProvider', 'BackgroundProvider', 'ProductionDomains', 'ProductionCareProfileDomains', 'ProductionTaskKnowledgeDomains', 'ProductionPhotoInputDomains', 'ProductionSettingsDomains', 'TasksWorkspaceProvider', 'ProfileWorkspaceProvider', 'PreparationWorkspaceProvider']) {
    assert.equal((composition.match(new RegExp(`<${provider}(?:>|\\s)`, 'g')) ?? []).length, 1, provider);
  }
  assert.doesNotMatch(composition, /<(?:PreviewProvider|PhotosWorkspaceProvider)(?:>|\s)/);
  assert.match(rootLayout, /<ProductionProvider><ProductionFirstScreenGate\b[\s\S]*<Stack\b/);
  assert.match(layout, /<ProductionGate><BackgroundProvider key=\{identityKey\} scope=\{backgroundScope\}><ProductionDomains>/);
  assert.match(domains, /<ProductionCareProfileDomains><ProductionTaskKnowledgeDomains><ProductionPhotoInputDomains><ProductionSettingsDomains>/);
  assert.match(care, /<ProfileWorkspaceProvider scopeKey=\{env.scopeKey\} value=\{scoped\?\.profile \?\? null\}>/);
  assert.match(knowledge, /<TasksWorkspaceProvider scopeKey=\{env.scopeKey\} value=\{current\?\.tasks \?\? null\}>\s*<PreparationWorkspaceProvider scopeKey=\{env.scopeKey\} value=\{current\?\.documents.preparation \?\? null\}>/);
  assert.equal((photos.match(/<PhotoInputContext\.Provider\b/g) ?? []).length, 1);
  assert.equal((layout.match(/<Tabs\.Screen name=/g) ?? []).length, 5);
  assert.match(layout, /\["more", "history", "memory", "photos", "sources", "summary"/);
  const navigation = compile('src/components/navigation/app-navigation.ts', name => { throw new Error(`Unexpected import ${name}`); });
  assert.equal(navigation.navigationItems.summary.label, '概況');
  assert.deepEqual(navigation.desktopNavigationGroups.map(group => group.keys), [['home', 'tasks', 'growth', 'care'], ['summary', 'profile', 'photos', 'memory', 'sources', 'history'], ['family', 'contact', 'guide', 'more']]);
  assert.ok(navigation.moreNavigationGroups.flatMap(group => group.items).some(item => item.key === 'summary'));
  assert.equal(navigation.navigationItems.summary.short, '概況');
});

test('production summary composition uses the shared owner and retains original-operation recovery guards', () => {
  const screen = source('src/screens/SummaryScreen.tsx'), content = source('src/production/TaskKnowledgeSummaryContent.tsx');
  const domains = source('src/production/TaskKnowledgeDomains.tsx');
  assert.doesNotMatch(screen, /LegacySummaryRecovery|useSummaryPreview|PreviewContext/);
  assert.match(content, /const owner = useProductionTaskKnowledgeSummary\(\)/);
  assert.match(domains, /<SummaryContext.Provider value=\{current\?\.summary \?\? null\}>/);
  assert.match(content, /model.online && !model.busy && !model.readFailed && model.access === "editable" && !!page\?\.canManage && !!model.pending\?\.checked && !model.pending.confirmed/);
  assert.match(content, /disabled=\{!canRetry \|\| !model.originalConsent\} onPress=\{actions.retryOriginal\}/);
  assert.match(content, /!model.pending.confirmed \? <>/);
  assert.match(content, /onDismiss=\{\(\) => navigate\(\(\) => \{ actions.discard\(\); setOpen\(false\); \}\)\}/);
  assert.match(content, /value\?\.model.dirty && !value.model.pending && !value.model.busy/);
});


test('the archive retry invokes the original combined owner and cannot bypass mismatched authority', () => {
  let snapshot, growthReads = 0, documentReads = 0;
  const growth = { model: { page: null }, actions: { refresh() { growthReads++; growth.model.page = { authorityVersion: 'current' }; } } };
  const documents = { archive: { authorityVersion: 'current', state: 'ready', snapshot: { id: 'original-report' }, history: [], periods: [] }, refresh() { documentReads++; } };
  const dependencies = {
    react: { memo: fn => fn, createContext: () => ({}), useLayoutEffect: fn => fn() },
    './task-knowledge-tasks': { useTaskKnowledgeTasks: () => ({}) }, './task-knowledge-summary': { useTaskKnowledgeSummary: () => ({}) },
    './task-knowledge-growth': { useTaskKnowledgeGrowth: () => growth }, './task-knowledge-memory': { useTaskKnowledgeMemory: () => ({}) },
    './usePersonalHistory': { usePersonalHistory: () => ({}) }, './useFamilyDocuments': { useFamilyDocuments: () => documents },
  };
  const { DomainBridge } = compile('src/production/TaskKnowledgeDomains.tsx', name => dependencies[name] ?? {}, '\nexports.DomainBridge = DomainBridge;');
  const render = () => DomainBridge({ env: { scopeKey: 'synthetic-scope' }, publish: value => { snapshot = value; } });
  render(); assert.equal(snapshot.growth.model.page, null);
  snapshot.growth.actions.refresh(); assert.equal(growthReads, 1); assert.equal(documentReads, 1);
  render(); assert.equal(snapshot.growth.model.page.archive, documents.archive);
  growth.model.page = { authorityVersion: 'older' }; render(); assert.equal(snapshot.growth.model.page.archive.state, 'invalidated');
  assert.equal(snapshot.growth.model.page.archive.snapshot, null);
  snapshot.growth.actions.refresh(); render(); assert.equal(snapshot.growth.model.page.archive.snapshot.id, 'original-report');
  const { FamilyReportControls } = compile('src/production/FamilyReportControls.tsx', name => {
    if (name === 'react/jsx-runtime') return require(name);
    if (name === './TaskKnowledgeDomains') return { useProductionFamilyDocuments: () => ({ ...documents, operation: {}, busy: false }) };
    if (name === '../workspaces/GrowthWorkspace') return { useGrowthWorkspace: () => ({ ...snapshot.growth, scopeKey: 'synthetic-scope' }) };
    if (name.endsWith('/growth-styles')) return { growthStyles: {} };
    return new Proxy({}, { get: (_target, key) => String(key) });
  });
  assert.equal(nodes(FamilyReportControls({ scopeKey: 'synthetic-scope', online: true })).find(node => node.props?.label === '重新讀取報告'), undefined);
  growth.model.page = { authorityVersion: 'older' }; render();
  assert.equal(nodes(FamilyReportControls({ scopeKey: 'different-scope', online: true })).find(node => node.props?.label === '重新讀取報告'), undefined);
  const before = growthReads, controls = FamilyReportControls({ scopeKey: 'synthetic-scope', online: true, onRefresh: snapshot.growth.actions.refresh });
  nodes(controls).find(node => node.props?.label === '重新讀取報告').props.onPress();
  assert.equal(growthReads, before + 1); assert.equal(documentReads, growthReads);
});
