import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';

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
    profile(value) { ({ measurements, profileSource } = value); },
    approve() { const action = pending; pending = null; action?.(); },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); },
  };
}

test('summary defaults to overview while archive consumes the same authority-gated growth projection', () => {
  const h = harness();
  for (const value of [undefined, '', 'report', 'unknown', [], ['overview', 'archive']]) assert.equal(h.normalize(value), 'overview');
  assert.equal(h.normalize('archive'), 'archive'); assert.equal(h.normalize('legacy-preparation'), 'legacy-preparation');
  let tree = h.render(); assert.equal(tree.props.title, '概況');
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

test('injected overview measurements and profile history keep guarded original owner callbacks', () => {
  const h = harness(), measurements = { childId: 'child-a', state: 'ready' }, profileSource = { state: 'available' };
  h.profile({ measurements, profileSource }); const overview = find(h.render(), 'ChildOverviewContent');
  assert.equal(overview.props.measurements, measurements); assert.equal(overview.props.profileSource, profileSource);
  overview.props.onOpenMeasurement('canonical-record'); assert.deepEqual(h.events, [['guard']]); h.approve();
  assert.deepEqual(h.events.at(-1), ['push', { pathname: '/care', params: { record: 'canonical-record' } }]);
  overview.props.onOpenProfileHistory(); h.approve();
  assert.deepEqual(h.events.slice(-2), [['profile-history'], ['push', '/profile']]);
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
  assert.deepEqual(navigation.desktopNavigationGroups.map(group => group.keys), [['home'], ['tasks', 'growth'], ['care', 'summary', 'history'], ['profile', 'memory', 'more']]);
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
    if (name.endsWith('/growth-styles')) return { growthStyles: {} };
    return new Proxy({}, { get: (_target, key) => String(key) });
  });
  const before = growthReads, controls = FamilyReportControls({ scopeKey: 'synthetic-scope', online: true, onRefresh: snapshot.growth.actions.refresh });
  nodes(controls).find(node => node.props?.label === '重新讀取報告').props.onPress();
  assert.equal(growthReads, before + 1); assert.equal(documentReads, growthReads);
});
