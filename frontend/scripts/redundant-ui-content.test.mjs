import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

// Shallow production renderers and real projections, using synthetic data only.
// These assertions do not claim browser layout, network, model or native coverage.
const root = path.resolve(import.meta.dirname, '..'), require = createRequire(import.meta.url);
const jsx = (type, props, key) => ({ type, props, key });
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const type = (tree, name) => nodes(tree).find(node => node.type === name || node.type?.name === name);
const label = (tree, text) => nodes(tree).find(node => node.props?.label === text);
const text = tree => !tree ? '' : Array.isArray(tree) ? tree.map(text).join(' ') : typeof tree === 'object' ? text(tree.props?.children) : String(tree);
const noop = () => {};
function renderer(relative, symbol, overrides = {}, expose = '') {
  const slots = [], cache = new Map(); let cursor = 0;
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useRef(value) { return slots[cursor++] ??= { current: value }; }, useEffect: noop, useLayoutEffect: noop, useId: () => 'synthetic-tabs',
  };
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const output = ts.transpileModule(readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const module = { exports: {} }; cache.set(filename, module.exports);
    const resolve = name => {
      if (name in overrides) return overrides[name];
      if (name === 'react') return hooks;
      if (name === 'expo-router') return { usePathname: () => '/care', useRouter: () => ({}), useLocalSearchParams: () => ({}) };
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
      if (name === 'react-native') return { View: 'View', Pressable: 'Pressable', Platform: { OS: 'web' }, StyleSheet: { create: value => value } };
      if (name === 'react-native-paper') return { Text: 'Text', ActivityIndicator: 'ActivityIndicator', TextInput: { Icon: 'Icon' } };
      if (name.endsWith('/theme')) return { colors: {}, radius: {}, readingType: {}, workspaceType: {}, typeScale: {}, spacing: { xs: 4, sm: 8, md: 12, lg: 16 }, mobileLayout: { breakpoint: 650 } };
      if (name.endsWith('/useContainerWidth')) return { useContainerWidth: () => ({ width: 1024, ref: null, onLayout: noop }) };
      if (name.endsWith('/growth-styles')) return { growthStyles: {} };
      if (name.endsWith('-view-model') || name.endsWith('/shared/growth') || name.endsWith('/profile-view-model')) {
        const target = path.resolve(path.dirname(filename), name); return load(existsSync(target) ? target : `${target}.ts`);
      }
      if (!name.startsWith('.')) return require(name);
      return new Proxy({}, { get: (_target, key) => String(key) });
    };
    new Function('require', 'module', 'exports', output + (filename === path.join(root, relative) ? expose : ''))(resolve, module, module.exports);
    return module.exports;
  }
  const component = load(path.join(root, relative))[symbol];
  return props => { cursor = 0; return component(props); };
}
const careModel = () => ({ scopeKey: 'scope', child: { id: 'child' }, access: 'editable', online: true, operation: { state: 'none' }, draft: null, deletion: null, detail: null,
  list: { state: 'ready', records: [], activeQuery: '', activeKind: 'all', hasMore: false, hasPrevious: false, message: null },
  review: { state: 'ready', scopeKey: 'scope', items: [], hasMore: false } });

test('review empty is one named sentence without irrelevant filters and never replaces read failure', () => {
  const render = renderer('src/components/care/CareReviewHistoryView.tsx', 'CareReviewWorkspace');
  const model = careModel(), actions = { closePanel: noop };
  let tree = render({ model, actions });
  assert.equal(type(tree, 'ReadStateNotice').props.message, '暫無待確認記錄');
  assert.equal(label(tree, '篩選'), undefined); assert.equal(label(tree, '清除篩選'), undefined);
  for (const state of ['loading', 'error', 'unavailable']) {
    model.review.state = state; tree = render({ model, actions });
    assert.equal(type(tree, 'ReadStateNotice').props.state, state);
    assert.ok(!text(tree).includes('暫無待確認記錄'));
  }
});

test('filtered review empty retains a working clear-filter action', () => {
  const render = renderer('src/components/care/CareReviewHistoryView.tsx', 'CareReviewWorkspace');
  const props = { model: careModel(), actions: { closePanel: noop }, history: true, initialStatus: 'important_pending' };
  let tree = render(props); assert.ok(label(tree, '篩選'));
  assert.equal(type(tree, 'ReadStateNotice').props.message, '沒有符合篩選的核對記錄');
  label(tree, '清除篩選').props.onPress(); tree = render(props);
  assert.equal(type(tree, 'ReadStateNotice').props.message, '暫無核對記錄');
});

test('saved-record true empty hides tools; filtered empty keeps tools and original search callback', () => {
  const render = renderer('src/components/care/CareSavedRecordsView.tsx', '__body', {}, '\nmodule.exports.__body = CareSavedRecordsBody;');
  const model = careModel(), calls = [], actions = { search: (...args) => calls.push(args) };
  let tree = render({ model, actions });
  assert.equal(type(tree, 'ReadStateNotice').props.message, '暫無已保存記錄');
  assert.equal(type(tree, 'AppTextField'), undefined);
  model.list.activeQuery = 'synthetic'; tree = render({ model, actions });
  assert.ok(type(tree, 'AppTextField')); assert.equal(type(tree, 'ReadStateNotice').props.message, '沒有符合篩選的已保存記錄');
  label(tree, '清除篩選').props.onPress(); assert.deepEqual(calls, [['', 'all']]);
  for (const state of ['loading', 'error', 'stale']) {
    model.list.state = state; model.list.message = 'Synthetic read status'; tree = render({ model, actions });
    assert.equal(type(tree, 'ReadStateNotice').props.state, state === 'stale' ? 'unavailable' : state);
    assert.equal(type(tree, 'ReadStateNotice').props.message, 'Synthetic read status');
  }
});

test('ready empty records preserve 404 and offline deep-link notices before ordinary empty copy', () => {
  const render = renderer('src/components/care/CareSavedRecordsView.tsx', '__body', {}, '\nmodule.exports.__body = CareSavedRecordsBody;');
  const model = careModel(), actions = { search: noop };
  for (const [online, message] of [
    [true, '所選記錄已刪除或目前不可讀；不再顯示舊記錄。'],
    [false, '所指定記錄未載入；連線恢復後才可核對。'],
  ]) {
    model.online = online; model.list.message = message;
    const tree = render({ model, actions }), notice = type(tree, 'ReadStateNotice');
    assert.equal(notice.props.message, message);
    assert.equal(notice.props.state, 'unavailable');
    assert.ok(type(tree, 'AppTextField'), 'Recovery/search tools remain available instead of presenting confirmed global empty');
    assert.equal(label(tree, '搜尋').props.disabled, !online);
  }
  model.online = true; model.list.message = null;
  const tree = render({ model, actions });
  assert.equal(type(tree, 'ReadStateNotice').props.state, 'empty');
  assert.equal(type(tree, 'ReadStateNotice').props.message, '暫無已保存記錄');
  assert.equal(type(tree, 'AppTextField'), undefined);
});

test('agent proposal empty is concise while unread, denied and failed remain distinct', () => {
  const production = { scopeKey: 'scope', online: true, agentPending: { state: 'ready', entries: [], nextCursor: null }, agentModel: {}, readAgentPending: noop };
  const render = renderer('src/screens/careScreen.tsx', '__pending', {
    '../production/ProductionProvider': { useProduction: () => production }, '../workspaces/CareWorkspace': { useCareWorkspace: () => null }, '../production/CareProfileDomains': { useProductionCareProfile: () => null },
  }, '\nmodule.exports.__pending = AgentPendingReview;');
  let tree = render(); assert.equal(type(tree, 'SectionHeader').props.subtitle, undefined);
  assert.ok(text(tree).includes('暫無待確認提案'));
  for (const state of ['idle', 'loading', 'failed', 'denied']) {
    production.agentPending.state = state; tree = render(); assert.ok(!text(tree).includes('暫無待確認提案'));
  }
});

test('child overview removes repeated unknown teaching while retaining actual field values and measurement states', () => {
  const workspace = { scopeKey: 'scope', model: { child: { id: 'child', name: 'Synthetic child' }, access: 'editable', online: true, reading: false, current: null, operation: { state: 'none' } }, dataLabel: 'Server 已確認孩子檔案', measurements: { scopeKey: 'scope', childId: 'child', state: 'ready', height: null, weight: null } };
  const render = renderer('src/components/child-overview/ChildOverviewContent.tsx', 'ChildOverviewContent', { '../../workspaces/ProfileWorkspace': { useProfileWorkspace: () => workspace } });
  const tree = render({ onOpenProfile: noop, onOpenProfileHistory: noop });
  assert.ok(text(tree).includes('暫無興趣與生活偏好資料'));
  assert.ok(!text(tree).includes('Server')); assert.ok(!text(tree).includes('未知不代表')); assert.ok(!text(tree).includes('未有資料的欄位'));
  const facts = nodes(tree).filter(node => node.type?.name === 'Fact');
  assert.equal(facts.find(node => node.props.label === '過敏資料').props.value, '未知');
  const measurement = type(tree, 'MeasurementCard');
  for (const [state, expected] of [['ready', '暫無身高量度'], ['unavailable', '身高量度暫不可用'], ['loading', '正在讀取身高量度'], ['error', '身高量度未能讀取']]) {
    const card = measurement.type({ label: '身高', state, fact: null }); assert.equal(text(card).trim(), expected);
  }
});

test('growth removes general notes and empty index but preserves local blocked-source and draft warnings', () => {
  const notices = require(path.resolve(root, '../src/shared/growth.ts')).GROWTH_KNOWLEDGE_NOTICES;
  const render = renderer('src/components/growth/GrowthView.tsx', 'GrowthView');
  const model = { scopeKey: 'scope', childId: 'child', access: 'editable', online: true, load: 'ready', notice: '', dirty: false, missingTargets: [], operation: 'none',
    page: { items: [], notices: [notices.region], concerns: { state: 'ready', items: [] } } };
  const props = { model, actions: { refresh: noop }, onTask: noop };
  let tree = render(props); assert.equal(label(tree, '資料說明'), undefined); assert.equal(type(tree, 'GrowthConcernIndex'), undefined);
  assert.ok(!text(tree).includes(notices.region)); assert.ok(!text(tree).includes('地區未能核對'));
  model.page.concerns.items = [{ id: 'concern', childId: 'child', status: 'following', attentionIds: ['attention'] }];
  model.page.items = [{ id: 'attention', sourceAvailable: false }]; model.dirty = true; model.missingTargets = ['item:attention']; tree = render(props);
  assert.ok(text(tree).includes('建議來源的地區未能核對')); assert.ok(text(tree).includes('部分草稿的來源未能核對'));
  model.pending = { attempt: {} }; model.operation = 'unknown'; tree = render(props); assert.ok(type(tree, 'GrowthOperationRecovery'));
});

test('task general reminder explanation is removed while item-level delivery and unknown checks remain', () => {
  const view = readFileSync(path.join(root, 'src/components/tasks/TasksView.tsx'), 'utf8');
  const detail = readFileSync(path.join(root, 'src/components/tasks/TaskDetail.tsx'), 'utf8');
  assert.ok(!view.includes('提醒說明')); assert.ok(!view.includes('本頁沒有發送通知'));
  assert.ok(detail.includes('提醒處理結果未確定')); assert.ok(detail.includes('外部通知送達仍須另行核對'));
});


test('confirmed empty Care remains quiet on refresh, while a cold offline read never becomes empty', () => {
  const render = renderer('src/components/care/CareSavedRecordsView.tsx', '__body', {}, '\nmodule.exports.__body = CareSavedRecordsBody;');
  const model = careModel(), actions = { search: noop };
  model.list.hasSnapshot = true; model.list.state = 'loading';
  let tree = render({ model, actions });
  assert.equal(type(tree, 'ReadStateNotice').props.state, 'empty');
  assert.equal(type(tree, 'ReadStateNotice').props.message, '暫無已保存記錄');
  assert.equal(type(tree, 'AppTextField'), undefined, 'A background refresh cannot bring hidden empty filters back');
  model.online = false; model.list.state = 'stale'; tree = render({ model, actions });
  assert.equal(type(tree, 'ReadStateNotice').props.state, 'stale');
  model.list.hasSnapshot = false; tree = render({ model, actions });
  assert.equal(type(tree, 'ReadStateNotice').props.state, 'unavailable');
  assert.doesNotMatch(type(tree, 'ReadStateNotice').props.message, /暫無|沒有符合/);
});

test('review history has one failed-read notice and one same-owner retry on cold and stale reads', () => {
  for (const [listState, reviewState, hasSnapshot] of [['error', 'error', false], ['stale', 'unavailable', false], ['stale', 'ready', true]]) {
    const render = renderer('src/components/care/CareReviewHistoryView.tsx', 'CareReviewWorkspace');
    const model = careModel(), calls = [], actions = { closePanel: noop, search: (...args) => calls.push(args) };
    Object.assign(model.list, { state: listState, hasSnapshot, message: 'Synthetic read failure' }); model.review.state = reviewState;
    const tree = render({ model, actions, history: true });
    const failures = nodes(tree).filter(node => node.type === 'ReadStateNotice' && ['error', 'stale', 'unavailable'].includes(node.props.state));
    assert.equal(failures.length, 1);
    const retries = nodes(tree).filter(node => node.props?.label === '重新讀取記錄'); assert.equal(retries.length, 1);
    retries[0].props.onPress(); assert.deepEqual(calls, [['', 'all']]);
  }
});
