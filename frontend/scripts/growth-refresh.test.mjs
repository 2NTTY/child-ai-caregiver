import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';
import { growthArchivedConcerns, growthConcernTimelineEntries } from '../src/growth-view-model.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const child = { id: 'preview-child-1', displayName: '甲', ageLabel: '約 3 歲', accessRole: 'owner' };

// Deterministic component/hook transitions only. Browser layout needs its own verification.
function harness(entry, symbol, initialArgs, injectedWorkspace = () => null) {
  let cursor = 0, changed = false, args = initialArgs, timerId = 0;
  const slots = [], effects = [], timers = new Map(), cache = new Map(), guards = [];
  const react = {
    createContext() { return { Provider: 'ContextProvider' }; },
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useState(value) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = typeof value === 'function' ? value() : value;
      return [slots[index], next => {
        const result = typeof next === 'function' ? next(slots[index]) : next;
        if (!Object.is(result, slots[index])) { slots[index] = result; changed = true; }
      }];
    },
    useEffect(callback, dependencies) {
      const index = cursor++, previous = slots[index];
      if (!previous || dependencies.some((value, key) => !Object.is(value, previous.dependencies[key]))) {
        const next = { dependencies, cleanup: previous?.cleanup };
        slots[index] = next;
        effects.push(() => { next.cleanup?.(); next.cleanup = callback(); });
      }
    },
  };
  const jsx = (type, props, key) => ({ type, props, key });
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const output = ts.transpileModule(readFileSync(filename, 'utf8'), { fileName: filename,
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
    const module = { exports: {} };
    function resolve(name) {
      if (name === 'react') return react;
      if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
      if (name === 'react-native') return { View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: { create: value => value }, useWindowDimensions: () => ({ width: 1200 }) };
      if (name === 'react-native-paper') return { Text: 'Text', Button: 'PaperButton' };
      if (name.endsWith('/theme')) return { colors: {}, radius: {}, spacing: { xs: 4, sm: 8, md: 12, lg: 16 }, mobileLayout: { breakpoint: 650, touchTarget: 48 } };
      if (name.endsWith('/useInteractionDensity')) return { useInteractionDensity: () => false };
      if (name.endsWith('/useContainerWidth')) return { useContainerWidth: () => ({ width: 1200, ref: null, onLayout() {} }) };
      if (name.endsWith('/PreviewNavigationGuard')) return { usePreviewLeaveGuard: (...values) => guards.push(values) };
      if (name.endsWith('/workspaces/GrowthWorkspace')) return { useGrowthWorkspace: injectedWorkspace };
      if (name.endsWith('/AppDialog')) return { AppDialog: Object.assign(function Dialog() {}, { Title: 'DialogTitle', Content: 'DialogContent', Actions: 'DialogActions' }) };
      if (name === './growth-styles') return { growthStyles: {} };
      if (name === './GrowthArchive') return { GrowthArchive: 'GrowthArchive' };
      if (name === './GrowthConcernManualFallback') return { GrowthConcernManualFallback: 'GrowthConcernManualFallback' };
      if (name === './GrowthConcernTimeline') return { GrowthConcernIndex: 'GrowthConcernIndex', GrowthConcernTimeline: 'GrowthConcernTimeline' };
      if (name.endsWith('/ui')) return Object.fromEntries(['AppButton', 'AppSelect', 'AppTabPanel', 'SectionCard', 'SectionHeader', 'UnderlineTabs'].map(value => [value, value]));
      for (const component of ['AppCheckbox', 'PageFrame', 'StatusAnnouncement', 'ReadStateNotice', 'EmptyListCard', 'AppIcon', 'AppStatusBadge']) {
        if (name.endsWith(`/${component}`)) return { [component]: component };
      }
      if (!name.startsWith('.')) return require(name);
      const source = path.resolve(path.dirname(filename), name);
      return load(existsSync(source) ? source : existsSync(`${source}.ts`) ? `${source}.ts` : `${source}.tsx`);
    }
    new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', output)(resolve, module, module.exports,
      callback => { const id = ++timerId; timers.set(id, callback); return id; }, id => timers.delete(id));
    cache.set(filename, module.exports); return module.exports;
  }
  const renderFunction = load(path.join(root, entry))[symbol];
  function render(nextArgs = args) {
    args = nextArgs; let value, rounds = 0;
    do {
      assert.ok(++rounds < 10, 'Hook transitions must settle');
      cursor = 0; changed = false; value = renderFunction(...args);
      while (effects.length) effects.shift()();
    } while (changed);
    return value;
  }
  return { render, timers, guards, tick() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(callback => callback()); },
    unmount() { for (const slot of slots) slot?.cleanup?.(); } };
}

function nodes(tree, predicate, prefix = []) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap((value, index) => nodes(value, predicate, [...prefix, index]));
  const pureChild = typeof tree.type === 'function' && ['GrowthOperationRecovery', 'GrowthOriginalRequest', 'GrowthConcernChangeNotice'].includes(tree.type.name) ? tree.type(tree.props) : null;
  return [...(predicate(tree) ? [{ node: tree, path: prefix }] : []), ...nodes(pureChild, predicate, [...prefix, 'render']), ...nodes(tree.props?.headerActions, predicate, [...prefix, 'headerActions']), ...nodes(tree.props?.children, predicate, [...prefix, 'children'])];
}
const byType = (tree, type) => nodes(tree, node => node.type === type).map(value => value.node);
const byId = (tree, id) => nodes(tree, node => node.props?.testID === id).map(value => value.node);
const refreshNodes = tree => nodes(tree, node => node.type === 'AppButton' && /^(重讀成長關注並保留草稿|重讀並核對原操作|正在讀取／提交…)$/.test(node.props.accessibilityLabel ?? ''));
const owner = (currentChild = child) => harness('src/preview/useGrowthPreview.ts', 'useGrowthPreview', [currentChild, true, 'parent', 'server']);
const view = (model, actions) => harness('src/components/growth/GrowthView.tsx', 'GrowthView', [{ model, actions, onTask() {}, onMemory() {}, onSource() {}, onHistory() {} }]);

test('ordinary refresh keeps content stable without a toolbar reload or loading/success feedback', () => {
  const o = owner(); let state = o.render(); const v = view(state.model, state.actions);
  let tree = v.render(); const pageBefore = state.model.page;
  assert.equal(refreshNodes(tree).length, 0);
  assert.equal(tree.props.headerActions.props.testID, 'growth-refresh-toolbar');
  assert.equal(tree.props.description, undefined);
  const headerButtons = byType(tree.props.headerActions, 'AppButton');
  assert.deepEqual(headerButtons.map(button => button.props.label), ['查看關注歷史']);
  state.actions.refresh(); state.actions.refresh();
  assert.equal(o.timers.size, 1, 'Repeated requests cannot start a second read');
  state = o.render(); tree = v.render([{ model: state.model, actions: state.actions }]);
  assert.deepEqual(state.model.page, pageBefore);
  assert.equal(state.model.page.concerns, pageBefore.concerns);
  assert.equal(state.model.load, 'loading');
  assert.equal(refreshNodes(tree).length, 0);
  assert.equal(byId(tree, 'growth-refresh-status').length, 0);
  assert.equal(byType(tree, 'Text').some(node => /正在讀取關注|已重新讀取/.test(String(node.props.children))), false);
  o.tick(); state = o.render(); tree = v.render([{ model: state.model, actions: state.actions }]);
  assert.deepEqual(state.model.page, pageBefore);
  assert.equal(state.model.load, 'ready');
  assert.equal(refreshNodes(tree).length, 0);
  assert.equal(byType(tree, 'StatusAnnouncement').some(node => node.props.message === '已重新讀取'), false);
});

test('selection, tab and newer reading position are not reset by refresh completion', () => {
  const o = owner(); let state = o.render();
  // The shipped fixture has one concern. Supply a second distinct authorized concern to test selection.
  const withSecondConcern = model => ({ ...model, page: { ...model.page, concerns: { ...model.page.concerns,
    items: [...model.page.concerns.items, { ...model.page.concerns.items[0], id: 'second-concern', title: 'Another concern' }] } } });
  const v = view(withSecondConcern(state.model), state.actions);
  let tree = v.render();
  const choices = byType(tree, 'GrowthConcernIndex')[0].props.items;
  assert.ok(choices.length > 1);
  byType(tree, 'GrowthConcernIndex')[0].props.onSelect(choices[1].id);
  tree = v.render();
  const viewport = { scrollTop: 280, scrollTo() { assert.fail('Refresh must not restore a stale scroll snapshot'); } };
  tree.props.scrollRef.current = viewport;
  state.actions.refresh(); state = o.render(); tree = v.render([{ model: withSecondConcern(state.model), actions: state.actions }]);
  assert.equal(byType(tree, 'GrowthConcernTimeline')[0].props.concern.id, choices[1].id);
  viewport.scrollTop = 420;
  o.tick(); state = o.render(); tree = v.render([{ model: withSecondConcern(state.model), actions: state.actions }]);
  assert.equal(viewport.scrollTop, 420);
  assert.equal(byType(tree, 'GrowthConcernTimeline')[0].props.concern.id, choices[1].id);
  byType(tree, 'UnderlineTabs')[0].props.onChange('archive'); tree = v.render();
  state.actions.refresh(); state = o.render(); v.render([{ model: withSecondConcern(state.model), actions: state.actions }]);
  o.tick(); state = o.render(); tree = v.render([{ model: withSecondConcern(state.model), actions: state.actions }]);
  assert.equal(byType(tree, 'UnderlineTabs')[0].props.value, 'archive');
  assert.equal(viewport.scrollTop, 420);
});

test('normal reading removes stage forms and their entrance without removing source/history data', () => {
  const o = owner(), state = o.render(), original = structuredClone(state.model.page);
  const v = view(state.model, state.actions), tree = v.render();
  const labels = byType(tree, 'AppButton').map(node => node.props.label);
  assert.ok(!labels.some(label => /階段建議|近況與設定|階段設定/.test(label)));
  assert.equal(byType(tree, 'GrowthAttentionCard').length, 0);
  assert.equal(byType(tree, 'GrowthTopicCard').length, 0);
  assert.ok(!byType(tree, 'Text').some(node => node.props.children === state.model.page.concerns.label));
  assert.deepEqual(state.model.page, original);
  assert.ok(state.model.page.items.some(item => item.state === 'dismissed'));
  assert.ok(state.model.page.topics.length > 0);
  assert.equal(byType(tree, 'GrowthConcernTimeline')[0].props.page, state.model.page);
});

test('dirty and unknown original operations retain their frozen body and guard through a read', () => {
  const o = owner(); let state = o.render();
  state.setOutcome('unknown'); state.actions.markDirty('item:preview-growth-current'); state = o.render();
  const item = state.model.page.items.find(value => value.id === 'preview-growth-current');
  state.actions.decide(item, { action: 'dismiss', note: 'Keep the original draft', expectedVersion: item.version, authorityVersion: state.model.page.authorityVersion, confirm: true });
  o.render(); o.tick(); state = o.render();
  const original = structuredClone(state.model.pending.attempt), v = view(state.model, state.actions);
  state.actions.refresh(); state = o.render(); o.tick(); state = o.render();
  assert.deepEqual(state.model.pending.attempt, original);
  assert.equal(state.model.pending.reviewed, true);
  assert.equal(state.model.originalConsent, false);
  assert.equal(state.model.dirty, true);
  assert.equal(state.model.locked, true);
  const tree = v.render([{ model: state.model, actions: state.actions }]);
  assert.equal(byId(tree, 'growth-drafts').length, 1);
  assert.equal(byId(tree, 'growth-pending').length, 1);
  assert.equal(byType(tree, 'AppButton').find(node => node.props.label === '明確查回原操作').props.disabled, true);
  assert.ok(o.guards.at(-1).every(Boolean));
});

test('lost access cancels in-flight reads and clears private data without restoring stale selection', () => {
  const o = owner(); let state = o.render(); const v = view(state.model, state.actions);
  let tree = v.render(); byType(tree, 'UnderlineTabs')[0].props.onChange('archive'); v.render();
  const oldRefresh = state.actions.refresh;
  oldRefresh(); state = o.render(); state.changeCondition('lost'); state = o.render();
  oldRefresh(); o.tick(); state = o.render(); tree = v.render([{ model: state.model, actions: state.actions }]);
  assert.equal(o.timers.size, 0);
  assert.equal(state.model.page, null);
  assert.equal(state.model.pending, null);
  assert.equal(state.model.dirty, false);
  assert.equal(byType(tree, 'GrowthConcernTimeline').length, 0);
  assert.equal(byType(tree, 'UnderlineTabs')[0].props.value, 'concerns');
  assert.ok(refreshNodes(tree).every(({ node }) => node.props.disabled));
});

test('failed reads and viewer permission remain explicit and keep a single refresh control', () => {
  const o = owner(); let state = o.render(); state.changeCondition('read_error'); state = o.render();
  state.actions.refresh(); o.render(); o.tick(); state = o.render();
  let tree = view(state.model, state.actions).render();
  assert.equal(state.model.load, 'error'); assert.equal(state.model.locked, true);
  assert.equal(refreshNodes(tree).length, 1); assert.ok(byType(tree, 'Text').some(node => /讀取/.test(String(node.props.children))));
  const viewer = owner({ ...child, accessRole: 'viewer' }); const readonly = viewer.render();
  tree = view(readonly.model, readonly.actions).render();
  assert.equal(readonly.model.page.canManage, false); assert.equal(readonly.model.locked, true);
  assert.equal(refreshNodes(tree).length, 0, 'Normal read-only pages do not need a reload control');
  const failedViewer = { ...readonly.model, load: 'error' };
  assert.equal(refreshNodes(view(failedViewer, readonly.actions).render())[0].node.props.disabled, false, 'Viewers can retry failed readable data');
  assert.ok(byType(tree, 'Text').some(node => String(node.props.children).includes('目前只有閱讀權限')));
});

test('scope remount cancels the previous response and does not reuse the previous child data', () => {
  const old = owner(); const previous = old.render(); previous.actions.refresh(); old.render(); old.unmount();
  assert.equal(old.timers.size, 0);
  const next = owner({ ...child, id: 'preview-child-2' }), state = next.render(); old.tick();
  assert.ok(state.model.page.items.every(item => item.childId === 'preview-child-2'));
  assert.ok(state.model.page.concerns.items.every(item => item.childId === 'preview-child-2'));
  assert.equal(state.model.pending, null); assert.equal(state.model.dirty, false);
  const source = readFileSync(path.join(root, 'src/preview/GrowthWorkspaceProvider.tsx'), 'utf8');
  assert.ok(source.includes('JSON.stringify([server, ownerIdentity, child?.id ?? null, child?.accessRole ?? "viewer"])'));
  assert.match(source, /<GrowthOwner key=\{projection\.generation\}[^>]*\/>/);
  assert.doesNotMatch(source, /<GrowthOwner[^>]*>\{children\}<\/GrowthOwner>/);
});

test('the chain composes related outcomes by child and canonical id without making new stored events', () => {
  const state = owner().render(), page = structuredClone(state.model.page), concern = page.concerns.items[0];
  const related = page.items.find(item => item.state === 'dismissed');
  page.items.push({ ...related, id: 'unrelated-id', title: related.title }, { ...related, childId: 'another-child' });
  const before = structuredClone(page), entries = growthConcernTimelineEntries(concern, page);
  assert.equal(entries.filter(entry => entry.kind === 'attention_state').length, 1);
  assert.equal(entries.find(entry => entry.kind === 'attention_state').item, related);
  assert.equal(entries.find(entry => entry.kind === 'attention_state').at, related.updatedAt);
  assert.deepEqual(page, before);
  concern.events.push({ id: 'canonical-result', at: related.updatedAt, kind: 'confirmed_action', title: 'Original result', text: 'Original content', sourceLabel: 'Original source', attentionId: related.id, attentionVersion: related.version });
  assert.equal(growthConcernTimelineEntries(concern, page).filter(entry => entry.kind === 'attention_state').length, 0);
  concern.events.at(-1).attentionVersion--;
  assert.equal(growthConcernTimelineEntries(concern, page).filter(entry => entry.kind === 'attention_state').length, 1, 'An older event cannot suppress the current state snapshot');
});

test('the related result is inside the chain and keeps coverage and task-state caveats', () => {
  const state = owner().render(), page = state.model.page, concern = page.concerns.items[0];
  const render = harness('src/components/growth/GrowthConcernTimeline.tsx', 'GrowthConcernTimeline', [{ concern, page, onTask() {} }]);
  const tree = render.render(), texts = byType(tree, 'Text').map(node => node.props.children);
  assert.ok(!texts.includes('已有確認結果'));
  assert.ok(texts.includes('只列已取得的事件；較早經過仍未完整載入。'));
  assert.ok(texts.includes('沒有連結任務；不代表已完成行動。'));
  assert.ok(texts.includes('原建議的來源或依據已失效；這裏只保留處理狀態，不作目前建議。'));
  assert.equal(byId(tree, 'growth-attention-state-preview-growth-previous').length, 1);
});

test('archive, History, return and refresh share one closed chain without changing attention or tasks', () => {
  const o = owner(); let state = o.render(), concern = state.model.page.concerns.items[0];
  const before = structuredClone({ items: state.model.page.items, topics: state.model.page.topics });
  const v = view(state.model, state.actions); let tree = v.render();
  const archive = byType(tree, 'GrowthConcernTimeline')[0].props.onArchive;
  assert.equal(typeof archive, 'function');
  archive(); archive(); assert.equal(o.timers.size, 1);
  o.render(); o.tick(); state = o.render(); concern = state.model.page.concerns.items[0];
  assert.equal(concern.status, 'closed'); assert.equal(concern.version, 2); assert.ok(concern.archivedAt);
  assert.equal(concern.events.filter(event => event.id.startsWith('preview-concern-archive:')).length, 1);
  assert.deepEqual({ items: state.model.page.items, topics: state.model.page.topics }, before);
  tree = v.render([{ model: state.model, actions: state.actions }]);
  assert.equal(byType(tree, 'GrowthConcernTimeline').length, 0);
  const history = harness('src/components/growth/GrowthHistoryView.tsx', 'GrowthHistoryView', [{ searchText: '', dateRange: { from: null, to: null }, onTask() {} }], () => ({ scopeKey: state.model.scopeKey, model: state.model, actions: state.actions }));
  let historyTree = history.render();
  assert.equal(byId(historyTree, `growth-history-${concern.id}`).length, 1);
  byType(historyTree, 'Pressable').find(button => button.props.accessibilityLabel === `查看已結束關注：${concern.title}`).props.onPress();
  historyTree = history.render();
  assert.equal(byType(historyTree, 'GrowthConcernTimeline')[0].props.concern, concern);
  // Navigation remounts readers, never the provider's owner.
  const returned = view(state.model, state.actions); assert.equal(byType(returned.render(), 'GrowthConcernTimeline').length, 0);
  state.actions.refresh(); o.render(); o.tick(); state = o.render();
  assert.equal(state.model.page.concerns.items[0].status, 'closed');
  assert.equal(growthArchivedConcerns(state.model)[0].id, concern.id);
  assert.equal(byType(returned.render([{ model: state.model, actions: state.actions }]), 'GrowthConcernTimeline').length, 0);
  state.actions.archiveConcern(concern.id, 1, state.model.page.authorityVersion);
  assert.equal(o.timers.size, 0); assert.equal(state.model.page.concerns.items[0].events.length, concern.events.length);
});

test('archive rejects stale version, authority, source, viewer and dirty inputs', () => {
  const o = owner(); let state = o.render(); const concern = state.model.page.concerns.items[0], authority = state.model.page.authorityVersion;
  state.actions.archiveConcern(concern.id, concern.version + 1, authority);
  state.actions.archiveConcern(concern.id, concern.version, 'old-authority');
  assert.equal(o.timers.size, 0);
  const oldAction = state.actions.archiveConcern;
  state.setReadScenario('source_unavailable'); state = o.render(); state.actions.refresh(); o.render(); o.tick(); state = o.render();
  oldAction(concern.id, concern.version, authority); assert.equal(o.timers.size, 0);
  const viewer = owner({ ...child, accessRole: 'viewer' }), readOnly = viewer.render();
  readOnly.actions.archiveConcern(concern.id, concern.version, readOnly.model.page.authorityVersion); assert.equal(viewer.timers.size, 0);
  const dirty = owner(); let draft = dirty.render(); draft.actions.markDirty('legacy-draft'); draft = dirty.render();
  draft.actions.archiveConcern(concern.id, concern.version, draft.model.page.authorityVersion); assert.equal(dirty.timers.size, 0);
});

test('unknown archive freezes one original request until read and explicit recovery consent', () => {
  const o = owner(); let state = o.render(); state.setOutcome('unknown'); state = o.render();
  const concern = state.model.page.concerns.items[0]; state.actions.archiveConcern(concern.id, concern.version, state.model.page.authorityVersion);
  o.render(); o.tick(); state = o.render(); const original = structuredClone(state.model.pending.attempt);
  assert.equal(original.kind, 'concern'); assert.equal(state.model.page.concerns.items[0].status, 'proposed');
  state.actions.archiveConcern(concern.id, concern.version, state.model.page.authorityVersion); assert.equal(o.timers.size, 0);
  state.actions.refresh(); o.render(); o.tick(); state = o.render();
  assert.deepEqual(state.model.pending.attempt, original); assert.equal(state.model.pending.reviewed, true);
  state.actions.retryOriginal(); assert.equal(o.timers.size, 0);
  state.actions.setOriginalConsent(true); state = o.render(); const oldRetry = state.actions.retryOriginal;
  state.actions.setOriginalConsent(false); state = o.render(); oldRetry(); assert.equal(o.timers.size, 0, 'A stale callback cannot reuse withdrawn recovery consent');
  state.actions.setOriginalConsent(true); state.setOutcome('success'); state = o.render(); state.actions.retryOriginal();
  o.render(); o.tick(); state = o.render(); assert.equal(state.model.pending, null);
  assert.equal(state.model.page.concerns.items[0].status, 'closed');
  assert.equal(state.model.page.concerns.items[0].events.filter(event => event.id.startsWith('preview-concern-archive:')).length, 1);
});

test('Growth and History consume the same injected owner and mismatched scopes are withheld', () => {
  const state = owner().render(), value = { scopeKey: state.model.scopeKey, model: state.model, actions: state.actions };
  const injection = harness('src/workspaces/GrowthWorkspace.tsx', 'GrowthWorkspaceProvider', [{ scopeKey: value.scopeKey, value, children: 'Readers' }]);
  assert.equal(injection.render().props.value, value);
  assert.equal(injection.render([{ scopeKey: 'different-child', value, children: 'Readers' }]).props.value, null);
  assert.equal(injection.render([{ scopeKey: value.scopeKey, value: { ...value, model: { ...value.model, scopeKey: 'old-scope' } }, children: 'Readers' }]).props.value, null);
  const provider = readFileSync(path.join(root, 'src/preview/GrowthWorkspaceProvider.tsx'), 'utf8');
  const screen = readFileSync(path.join(root, 'src/screens/GrowthScreen.tsx'), 'utf8');
  const history = readFileSync(path.join(root, 'src/components/growth/GrowthHistoryView.tsx'), 'utf8');
  const layout = readFileSync(path.join(root, 'app/(dashboard)/_layout.tsx'), 'utf8');
  assert.equal((provider.match(/useGrowthPreview\(/g) ?? []).length, 1);
  assert.ok(!screen.includes('useGrowthPreview(')); assert.ok(!history.includes('/preview/'));
  assert.ok(!provider.includes('usePathname'));
  assert.equal((layout.match(/<ProductionDomains>/g) ?? []).length, 1);
  assert.doesNotMatch(layout, /preview\/(?:Growth|MemoryReference)WorkspaceProvider/);
  const domains = readFileSync(path.join(root, 'src/production/ProductionDomains.tsx'), 'utf8');
  assert.equal((domains.match(/<ProductionTaskKnowledgeDomains>/g) ?? []).length, 1);
  const connected = readFileSync(path.join(root, 'src/production/TaskKnowledgeDomains.tsx'), 'utf8');
  assert.equal((connected.match(/useTaskKnowledgeGrowth\(env\)/g) ?? []).length, 1);
  assert.equal((connected.match(/<GrowthWorkspaceProvider\s/g) ?? []).length, 1);
  assert.match(connected, /snapshot\.scopeKey === env\.scopeKey \? snapshot : null/);
  assert.match(connected, /<GrowthWorkspaceProvider scopeKey=\{env\.scopeKey\} value=\{current\?\.growth \?\? null\}>/);
  assert.match(connected, /<MemoryReferenceWorkspaceProvider scopeKey=\{env\.scopeKey\} value=\{current\?\.memory\.value \?\? null\}>/);
});

test('ending a concern uses a filled control and frozen confirmation; cancel and dismissal never write', () => {
  const state = owner().render(), concern = state.model.page.concerns.items[0]; let writes = 0;
  const props = { concern, scopeKey: state.model.scopeKey, authorityVersion: state.model.page.authorityVersion, disabled: false, onConfirm: () => writes++ };
  const h = harness('src/components/growth/GrowthArchiveConcernButton.tsx', 'GrowthArchiveConcernButton', [props]);
  let tree = h.render(); const trigger = () => byType(tree, 'AppButton').find(button => button.props.label === '結束關注');
  assert.equal(trigger().props.variant, 'danger'); assert.equal(trigger().props.style.borderWidth, 0);
  trigger().props.onPress(); tree = h.render();
  let dialog = byId(tree, 'growth-archive-confirmation')[0];
  assert.equal(dialog.props.visible, true); assert.ok(dialog.props.accessibilityLabel.includes(concern.title)); assert.equal(writes, 0);
  byType(tree, 'AppButton').find(button => button.props.label === '取消').props.onPress(); tree = h.render();
  assert.equal(byId(tree, 'growth-archive-confirmation')[0].props.visible, false); assert.equal(writes, 0);
  trigger().props.onPress(); tree = h.render(); byId(tree, 'growth-archive-confirmation')[0].props.onDismiss(); tree = h.render();
  assert.equal(byId(tree, 'growth-archive-confirmation')[0].props.visible, false); assert.equal(writes, 0);
  trigger().props.onPress(); tree = h.render();
  const confirm = byType(tree, 'AppButton').find(button => button.props.label === '確認結束關注').props.onPress;
  confirm(); confirm(); assert.equal(writes, 1); tree = h.render();
  assert.equal(byId(tree, 'growth-archive-confirmation')[0].props.visible, false);
});

test('archive confirmation is invalidated by a new version, authority, scope, or write guard', () => {
  const state = owner().render(), concern = state.model.page.concerns.items[0];
  for (const update of [props => ({ ...props, concern: { ...concern, version: concern.version + 1 } }), props => ({ ...props, authorityVersion: 'new-authority' }),
    props => ({ ...props, scopeKey: 'new-child-scope' }), props => ({ ...props, disabled: true })]) {
    let writes = 0;
    const props = { concern, scopeKey: state.model.scopeKey, authorityVersion: state.model.page.authorityVersion, disabled: false, onConfirm: () => writes++ };
    const h = harness('src/components/growth/GrowthArchiveConcernButton.tsx', 'GrowthArchiveConcernButton', [props]);
    let tree = h.render(); byType(tree, 'AppButton').find(button => button.props.label === '結束關注').props.onPress(); tree = h.render();
    const confirm = byType(tree, 'AppButton').find(button => button.props.label === '確認結束關注').props.onPress;
    tree = h.render([update(props)]); confirm();
    assert.equal(byId(tree, 'growth-archive-confirmation')[0].props.visible, false); assert.equal(writes, 0);
  }
});

test('undo restores the original review status and preserves both archive and restore history exactly once', () => {
  const o = owner(); let state = o.render(); const original = structuredClone(state.model.page), concern = original.concerns.items[0];
  state.actions.archiveConcern(concern.id, concern.version, original.authorityVersion); o.render(); o.tick(); state = o.render();
  const archived = state.model.page.concerns.items[0]; assert.equal(archived.statusBeforeArchive, concern.status);
  const notice = harness('src/components/growth/GrowthConcernChangeNotice.tsx', 'GrowthConcernChangeNotice', [{ model: state.model, actions: state.actions }]);
  const undo = byType(notice.render(), 'AppButton')[0]; assert.equal(undo.props.disabled, false);
  undo.props.onPress(); undo.props.onPress(); assert.equal(o.timers.size, 1);
  o.render(); o.tick(); state = o.render(); const restored = state.model.page.concerns.items[0];
  assert.equal(restored.id, concern.id); assert.equal(restored.status, concern.status); assert.equal(restored.version, concern.version + 2);
  assert.equal(restored.archivedAt, null); assert.equal(growthArchivedConcerns(state.model).length, 0);
  assert.equal(restored.events.filter(event => event.id.startsWith('preview-concern-archive:')).length, 1);
  assert.equal(restored.events.filter(event => event.id.startsWith('preview-concern-restore:')).length, 1);
  assert.deepEqual(state.model.page.items, original.items); assert.deepEqual(state.model.page.topics, original.topics);
  assert.equal(notice.render([{ model: state.model, actions: state.actions }]), null);
  const active = view(state.model, state.actions).render(); assert.equal(byType(active, 'GrowthConcernTimeline')[0].props.concern.id, concern.id);
  state.actions.refresh(); o.render(); o.tick(); state = o.render(); assert.equal(state.model.page.concerns.items[0].status, concern.status);
});

test('History restores through the same owner and provides recovery locally for an unknown restore', () => {
  const o = owner(); let state = o.render(); const concern = state.model.page.concerns.items[0];
  state.actions.archiveConcern(concern.id, concern.version, state.model.page.authorityVersion); o.render(); o.tick(); state = o.render();
  state.setOutcome('unknown'); state = o.render();
  const history = harness('src/components/growth/GrowthHistoryView.tsx', 'GrowthHistoryView', [{ searchText: '', dateRange: { from: null, to: null }, onTask() {} }], () => ({ scopeKey: state.model.scopeKey, model: state.model, actions: state.actions }));
  let tree = history.render(); byType(tree, 'PaperButton').find(button => button.props.accessibilityLabel === `恢復關注：${concern.title}`).props.onPress({ stopPropagation() {} });
  o.render(); o.tick(); state = o.render(); tree = history.render();
  assert.equal(state.model.pending.attempt.input.action, 'restore'); const frozen = structuredClone(state.model.pending.attempt);
  assert.equal(state.model.page.concerns.items[0].status, 'closed'); assert.equal(byId(tree, 'growth-pending').length, 1);
  byType(tree, 'AppButton').find(button => button.props.label === '重讀並核對原操作').props.onPress();
  o.render(); o.tick(); state = o.render(); tree = history.render();
  assert.deepEqual(state.model.pending.attempt, frozen);
  assert.equal(byType(tree, 'AppButton').find(button => button.props.label === '明確查回原操作').props.disabled, true);
  byType(tree, 'AppCheckbox')[0].props.onChange(true); state.setOutcome('success'); state = o.render(); tree = history.render();
  byType(tree, 'AppButton').find(button => button.props.label === '明確查回原操作').props.onPress();
  o.render(); o.tick(); state = o.render(); tree = history.render();
  assert.equal(state.model.pending, null); assert.equal(state.model.page.concerns.items[0].status, concern.status);
  assert.equal(byId(tree, `growth-history-${concern.id}`).length, 0);
});

test('restore and undo reject stale versions, dirty drafts, lost sources, and unmounted scope callbacks', () => {
  const o = owner(); let state = o.render(), concern = state.model.page.concerns.items[0];
  state.actions.archiveConcern(concern.id, concern.version, state.model.page.authorityVersion); o.render(); o.tick(); state = o.render(); concern = state.model.page.concerns.items[0];
  state.actions.restoreConcern(concern.id, concern.version - 1, state.model.page.authorityVersion);
  state.actions.restoreConcern(concern.id, concern.version, 'old-authority'); assert.equal(o.timers.size, 0);
  const oldRestore = state.actions.restoreConcern;
  state.actions.markDirty('legacy-draft'); state = o.render(); oldRestore(concern.id, concern.version, state.model.page.authorityVersion); assert.equal(o.timers.size, 0);
  state.actions.askDiscard(); state = o.render(); state.actions.discardDrafts(); o.render(); o.tick(); state = o.render();
  state.setReadScenario('source_unavailable'); state = o.render(); state.actions.refresh(); o.render(); o.tick(); state = o.render();
  oldRestore(concern.id, concern.version, state.model.page.authorityVersion); assert.equal(o.timers.size, 0);
  const notice = harness('src/components/growth/GrowthConcernChangeNotice.tsx', 'GrowthConcernChangeNotice', [{ model: state.model, actions: state.actions }]); assert.equal(notice.render(), null);
  o.unmount(); oldRestore(concern.id, concern.version, state.model.page.authorityVersion); assert.equal(o.timers.size, 0);
});
