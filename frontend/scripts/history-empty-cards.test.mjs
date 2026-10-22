import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

// Actual reader branches and pure projections with synthetic owner snapshots.
// Native layout and hooks are bounded ports; browser rendering is separate QA.
const root = path.resolve(import.meta.dirname, '..'), require = createRequire(import.meta.url);
const noop = () => {}, jsx = (type, props) => ({ type, props });
const nodes = value => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(nodes) : [value, ...nodes(value.props?.children)];
const empty = tree => nodes(tree).filter(node => node.type === 'EmptyListCard' || node.type === 'ReadStateNotice' && node.props.state === 'empty');
const placeholders = new Proxy({}, { get: (_, key) => String(key) });
function load(relative, overrides = {}, suffix = '') {
  const file = path.join(root, relative), module = {exports: {}};
  const resolve = name => {
    if (name in overrides) return overrides[name];
    if (name === 'react') return {useId: () => 'synthetic', useEffect: noop, useLayoutEffect: noop, useRef: value => ({current: value}), useState: value => [typeof value === 'function' ? value() : value, noop]};
    if (name === 'react/jsx-runtime') return {jsx, jsxs: jsx, Fragment: 'Fragment'};
    if (name === 'react-native') return {View: 'View', Pressable: 'Pressable', Platform: {OS: 'web'}, StyleSheet: {create: value => value}, useWindowDimensions: () => ({width: 1024})};
    if (name === 'react-native-paper') return {Text: 'Text', Button: 'Button'};
    if (name.endsWith('/theme')) return {colors: {}, spacing: {}, radius: {}, readingType: {}, workspaceType: {}, typeScale: {}, mobileLayout: {breakpoint: 650}};
    if (name.endsWith('/appearance/BackgroundSurface')) return {BackgroundSurface: 'BackgroundSurface', useCustomBackground: () => false};
    if (name.endsWith('/useContainerWidth')) return {useContainerWidth: () => ({width: 1024, ref: null, onLayout: noop})};
    if (name.endsWith('/useInteractionDensity')) return {useInteractionDensity: () => false};
    if (name.endsWith('/growth-styles')) return {growthStyles: {}};
    if (name.includes('view-model') || name.endsWith('/concerns.ts')) {
      const target = path.resolve(path.dirname(file), name + (path.extname(name) ? '' : '.ts'));
      return load(path.relative(root, target), overrides);
    }
    if (!name.startsWith('.')) return require(name);
    return placeholders;
  };
  const js = ts.transpileModule(readFileSync(file, 'utf8'), {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  new Function('require', 'module', 'exports', js + suffix)(resolve, module, module.exports);
  return module.exports;
}
const range = {from: null, to: null};
const careModel = () => ({scopeKey: 'parent:child-a', child: {id: 'child-a'}, access: 'editable', online: true,
  operation: {state: 'none'}, list: {state: 'ready', records: [], hasSnapshot: true, activeQuery: '', activeKind: 'all', message: null, hasMore: false},
  review: {state: 'ready', scopeKey: 'parent:child-a', items: [], hasMore: false, capabilities: {}}});

test('review and saved-record history use cards only for successfully read empty results, preserving partial scope', () => {
  const {CareReviewWorkspace} = load('src/components/care/CareReviewHistoryView.tsx');
  const {CareSavedRecordsList} = load('src/components/care/CareSavedRecordsView.tsx');
  for (const render of [model => CareReviewWorkspace({model, actions: {}, history: true}), model => CareSavedRecordsList({model, actions: {}})]) {
    // Execute the private saved-list body rather than its wrapper element.
    const inspect = model => { let tree = render(model); if (typeof tree.type === 'function') tree = tree.type(tree.props); return tree; };
    const model = careModel(); assert.equal(empty(inspect(model)).length, 1);
    for (const state of ['loading', 'loading_more', 'error', 'stale']) assert.equal(empty(inspect({...model, list: {...model.list, state}})).length, 0, state);
    for (const patch of [{online: false}, {access: 'lost'}, {list: {...model.list, message: 'Not yet verified'}}]) assert.equal(empty(inspect({...model, ...patch})).length, 0);
    const partial = inspect({...model, list: {...model.list, hasMore: true}, review: {...model.review, hasMore: true}});
    assert.equal(empty(partial).length, 1); assert.match(empty(partial)[0].props.message, /此頁|已載入範圍/);
  }
});

test('growth history replaces the bare empty line with a card, never during refresh, failure or lost access', () => {
  let model = {scopeKey: 'scope', childId: 'child-a', online: true, access: 'editable', load: 'ready', operation: 'none', notice: '', page: {concerns: {state: 'ready', items: []}}};
  const {GrowthHistoryView} = load('src/components/growth/GrowthHistoryView.tsx', {'../../workspaces/GrowthWorkspace': {useGrowthWorkspace: () => ({scopeKey: 'scope', model, actions: {}})}});
  const render = () => GrowthHistoryView({searchText: '', dateRange: range, onTask: noop});
  assert.equal(empty(render()).length, 1); const baseline = model;
  for (const patch of [{load: 'loading'}, {load: 'error'}, {online: false}, {access: 'lost'}, {page: null}, {page: {concerns: {state: 'unavailable'}}}]) {
    model = {...baseline, ...patch}; assert.equal(empty(render()).length, 0);
  }
});

test('conversation and notification empty cards preserve successful refresh snapshots with explicit partial coverage but not uncertain reads', () => {
  const initial = () => ({scopeKey: 'scope', access: 'editable', online: true, busy: {history: false, notifications: false, message: false}, actions: {}, message: {data: null},
    history: {state: 'ready', data: {query: '', matches: [], complete: false, nextCursor: 'more', scanned: 100}},
    notifications: {state: 'ready', data: {items: [], complete: false, nextCursor: 'more'}}});
  let owner = initial();
  const views = load('src/components/history/PersonalHistoryViews.tsx', {'../../production/usePersonalHistory': {usePersonalHistoryWorkspace: () => owner}});
  for (const [kind, render] of [['history', () => views.PersonalConversationHistoryView({searchText: '', dateRange: range, onPrepareQuestion: noop})], ['notifications', () => views.PersonalNotificationContent({owner, searchText: '', dateRange: range})]]) {
    owner = initial(); assert.equal(empty(render()).length, 1); if (kind === 'history') assert.match(empty(render())[0].props.detail, /仍有/);
    for (const state of ['loading', 'error', 'unavailable', 'stale']) { owner = initial(); owner[kind] = {...owner[kind], state, ...(state === 'stale' ? {} : {data: null})}; assert.equal(empty(render()).length, 0, state); }
    for (const patch of [{online: false}, {access: 'revoked'}, {busy: {[kind]: true}}]) { owner = {...initial(), ...patch}; assert.equal(empty(render()).length, patch.busy ? 1 : 0); }
    owner = initial(); owner[kind].data.complete = true; owner[kind].data.nextCursor = null; assert.equal(empty(render()).length, 1);
    owner.busy[kind] = true; assert.equal(empty(render()).length, 1, 'a successful empty snapshot stays visible during refresh');
  }
  owner = initial(); owner.history.data.query = 'previous query'; assert.equal(empty(views.PersonalConversationHistoryView({searchText: '', dateRange: range, onPrepareQuestion: noop})).length, 0);
});

test('profile empty is authoritative only after history success or current version zero, preserving unknown and pagination', () => {
  const {ProfileHistoryView} = load('src/components/profile/ProfileHistoryView.tsx');
  const model = {child: {id: 'child-a', name: 'Synthetic'}, access: 'editable', online: true, reading: false, needsRefresh: false,
    current: {version: 4}, history: [], historyOpen: true, hasMoreHistory: false, notice: null, operation: {state: 'none'}};
  const render = patch => ProfileHistoryView({model: {...model, ...patch}, actions: {}});
  assert.equal(empty(render({})).length, 1);
  for (const patch of [{historyOpen: false}, {reading: true}, {online: false}, {needsRefresh: true}, {current: null}, {notice: 'Read failed'}, {access: 'lost'}, {operation: {state: 'unknown'}}, {operation: {state: 'saving'}}, {operation: {state: 'conflict'}}]) assert.equal(empty(render(patch)).length, 0);
  assert.equal(empty(render({current: {version: 0}, historyOpen: false})).length, 1);
  assert.equal(empty(render({current: {version: 0}, historyOpen: false, needsRefresh: true})).length, 0);
  const partial = render({hasMoreHistory: true}); assert.match(empty(partial)[0].props.detail, /仍有較早版本/);
  assert.ok(nodes(partial).some(node => node.props?.label === '載入更早版本'));
});

test('existing task and preparation history still use successful-empty cards, not initial loading or unavailable states', () => {
  let task = {child: {id: 'child-a'}, access: 'editable', online: true, operation: {state: 'none'}, items: [], eligibleAssignees: [], scheduleContext: {timeZone: 'Asia/Hong_Kong'}, readState: 'ready'};
  const {TaskHistoryView} = load('src/components/tasks/TaskHistoryView.tsx', {'../../workspaces/TasksWorkspace': {useTasksWorkspace: () => ({scopeKey: 'scope', model: task, actions: {}})}});
  assert.equal(empty(TaskHistoryView({searchText: '', dateRange: range})).length, 1);
  for (const state of ['loading', 'error', 'stale']) { task = {...task, readState: state}; assert.equal(empty(TaskHistoryView({searchText: '', dateRange: range})).length, 0); }
  const {PreparationEmptyState} = load('src/components/preparations/PreparationWorkspace.tsx', {}, '\nexports.PreparationEmptyState = PreparationEmptyState;');
  const model = {online: true, condition: 'ready', reading: {archiveReady: true, pageBusy: false, pageError: null, archiveHasMore: true}};
  assert.equal(empty(PreparationEmptyState({workspace: {model}, history: true})).length, 1);
  for (const patch of [{online: false}, {condition: 'loading'}, {condition: 'refresh_failed'}, {condition: 'lost'}, {reading: {...model.reading, archiveReady: false}}, {reading: {...model.reading, pageBusy: true}}, {reading: {...model.reading, pageError: 'Failed'}}]) assert.equal(empty(PreparationEmptyState({workspace: {model: {...model, ...patch}}, history: true})).length, 0);
});

test('the actual PreparationHistoryView reader wiring gates archive empty by archive readiness and paging, not active documents', () => {
  const ready = {scopeKey: 'scope', actions: {}, model: {condition: 'ready', online: true, documents: [], selected: null,
    reading: {archiveStarted: true, archiveReady: true, pageBusy: false, pageError: null, archiveHasMore: false, activeHasMore: true, online: true}}};
  let workspace = ready;
  const {PreparationHistoryView} = load('src/components/preparations/PreparationWorkspace.tsx', {
    '../../workspaces/PreparationWorkspace': {usePreparationWorkspace: () => workspace},
  });
  const render = () => {
    const page = PreparationHistoryView({searchText: '', dateRange: range});
    const reader = nodes(page).find(node => typeof node.type === 'function' && node.type.name === 'PreparationReader');
    assert.ok(reader); assert.equal(reader.props.history, true);
    const list = reader.type(reader.props);
    const emptyState = nodes(list).find(node => typeof node.type === 'function' && node.type.name === 'PreparationEmptyState');
    assert.ok(emptyState); assert.equal(emptyState.props.history, true, 'Reader must propagate archive context');
    return emptyState.type(emptyState.props);
  };
  assert.equal(empty(render()).length, 1); assert.equal(empty(render())[0].props.detail, '試試其他搜尋或日期。');
  for (const reading of [{archiveReady: false}, {pageBusy: true}, {pageError: 'Synthetic failure'}]) {
    workspace = {...ready, model: {...ready.model, reading: {...ready.model.reading, ...reading}}}; assert.equal(empty(render()).length, 0);
  }
  workspace = {...ready, model: {...ready.model, reading: {...ready.model.reading, archiveHasMore: true, activeHasMore: false}}};
  assert.match(empty(render())[0].props.detail, /仍有更多文件/);
});
