import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

// Shallow synthetic state tests, not browser or API acceptance.
const root = path.resolve(import.meta.dirname, '..'), require = createRequire(import.meta.url);
const noop = () => {}, jsx = (type, props) => ({ type, props });
const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
const cards = tree => nodes(tree).filter(node => node.type === 'EmptyListCard');
const visibleText = tree => !tree ? '' : Array.isArray(tree) ? tree.map(visibleText).join(' ') : typeof tree === 'object' ? visibleText(tree.props?.children) : String(tree);
const cardText = tree => cards(tree).map(node => `${node.props.title} ${node.props.detail ?? ''}`).join(' ');
const placeholders = new Proxy({}, { get: (_, key) => String(key) });
function load(relative, overrides = {}, suffix = '') {
  const source = readFileSync(path.join(root, relative), 'utf8');
  const module = { exports: {} };
  const resolve = name => {
    if (name in overrides) return overrides[name];
    if (name === 'react') return { useId: () => 'synthetic', useEffect: noop, useLayoutEffect: noop,
      useRef: value => ({ current: value }), useMemo: fn => fn(), useState: initial => [typeof initial === 'function' ? initial() : initial, noop] };
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (name === 'react-native') return { View: 'View', Pressable: 'Pressable', Platform: { OS: 'web' }, StyleSheet: { create: value => value } };
    if (name === 'react-native-paper') return { Text: 'Text' };
    if (name === 'expo-router') return { useRouter: () => ({ push: noop }), useLocalSearchParams: () => ({}), usePathname: () => '/' };
    if (name.endsWith('/ProductionFirstScreenGate')) return { useProductionVisibleSettingsSection: noop };
    if (name.endsWith('/theme')) return { colors: {}, spacing: {}, radius: {}, readingType: {}, workspaceType: {}, typeScale: {} };
    if (name.endsWith('/agent-view-model')) return { agentTime: value => value, agentRunLabels: {}, agentProposalLabels: {} };
    if (name.endsWith('/chat-presentation')) return { chatColors: {}, chatType: {} };
    if (name.endsWith('/useContainerWidth')) return { useContainerWidth: () => ({ width: 1024, ref: null, onLayout: noop }) };
    if (name.endsWith('/useContentDeletionFocus')) return { useContentDeletionFocus: () => ({ start: noop, onClosed: noop, rowRef: noop }) };
    if (name.endsWith('/useContentListMotion')) return { useContentListMotion: () => null };
    if (name.endsWith('/PreviewNavigationGuard')) return { usePreviewNavigation: () => fn => fn(), usePreviewLeaveGuard: noop };
    if (name.endsWith('/source-styles')) return { sourceStyles: {} };
    if (name.endsWith('/contact-styles')) return { contactStyles: {} };
    if (name.endsWith('/AppDialog')) return { AppDialog: Object.assign(noop, { Title: 'Title', Content: 'Content', Actions: 'Actions', ScrollArea: 'ScrollArea' }) };
    if (!name.startsWith('.')) return require(name);
    return placeholders;
  };
  new Function('require', 'module', 'exports', ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText + suffix)(resolve, module, module.exports);
  return module.exports;
}

test('source success empty card belongs inside list and disappears for stale, offline, failed and denied reads', () => {
  const { SourcesView } = load('src/components/shared-inputs/SourcesView.tsx');
  const model = { scopeKey: 'synthetic', online: true, fresh: true, access: 'editable', load: 'ready', items: [], operation: { state: 'none' }, selected: null };
  const render = patch => SourcesView({ model: { ...model, ...patch }, actions: {}, onPhotos: noop, onRecord: noop });
  const tree = render({}), list = nodes(tree).find(node => node.props?.testID === 'source-list');
  assert.equal(cards(tree).length, 1); assert.equal(cards(list).length, 1);
  for (const patch of [{ load: 'loading' }, { load: 'error' }, { online: false }, { fresh: false }, { access: 'lost' }]) assert.equal(cards(render(patch)).length, 0);
});

test('Agent activity empty snapshots do not become success after failures, loading, loss or offline', () => {
  const production = { agentModel: { readState: 'idle', online: true }, agentActions: {}, agentInbox: {}, agentInboxActions: {}, authorization: { receipts: {} }, authorizationActions: {} };
  const { AgentConversation } = load('src/production/AgentConversation.tsx', { './ProductionProvider': { useProduction: () => production } });
  const render = state => { production.agentPending = { state, entries: [], hasSnapshot: true, nextCursor: null }; return AgentConversation({ visible: true }); };
  assert.equal(cards(render('ready')).length, 0, 'activity uses a quiet empty line rather than another nested card');
  assert.match(visibleText(render('ready')), /目前沒有待確認/);
  for (const state of ['idle', 'loading', 'failed', 'denied']) assert.doesNotMatch(visibleText(render(state)), /目前沒有待確認/, state);
  production.agentModel.online = false; assert.doesNotMatch(visibleText(render('ready')), /目前沒有待確認/);
  production.agentModel.online = true; render('ready'); production.agentPending.nextCursor = 'more';
  assert.match(visibleText(AgentConversation({ visible: true })), /已載入頁面/);
});

test('inbox shows a successful empty card only after a current online read', () => {
  const { AgentInboxView } = load('src/components/agent/AgentInboxView.tsx');
  for (const state of ['idle', 'loading', 'failed', 'denied', 'ready']) {
    const model = { state, online: true, entries: [], loadedAt: '2026-10-07T00:00:00Z' };
    assert.equal(cards(AgentInboxView({ model, actions: {} })).length, state === 'ready' ? 1 : 0);
    assert.equal(cards(AgentInboxView({ model: { ...model, online: false }, actions: {} })).length, 0);
  }
});

test('completed activity has a quiet empty summary, never a false empty outcome for unfinished or stale runs', () => {
  const { AgentRunView, RunDetails } = load('src/components/agent/AgentRunView.tsx', {}, '\nexports.RunDetails = RunDetails;');
  const run = { id: 'synthetic', tools: [], proposals: [], status: 'completed', counts: null, citations: [], text: '' };
  const model = { online: true, readState: 'ready', run, loadedAt: '2026-10-07T00:00:00Z' };
  assert.equal(cards(AgentRunView({ model, actions: {} })).length, 0);
  assert.match(visibleText(AgentRunView({ model, actions: {} })), /本次沒有待確認事項/);
  assert.equal(RunDetails({ run }), null, 'no empty tool-placeholder disclosure');
  for (const status of ['running', 'unknown', 'failed', 'cancelled']) assert.doesNotMatch(visibleText(AgentRunView({ model: { ...model, run: { ...run, status } }, actions: {} })), /本次沒有待確認事項/);
  assert.doesNotMatch(visibleText(AgentRunView({ model: { ...model, online: false }, actions: {} })), /本次沒有待確認事項/);
});

test('preparation empty state preserves failure, loading, offline and uncertain-source semantics', () => {
  const { PreparationEmptyState } = load('src/components/preparations/PreparationWorkspace.tsx', {}, '\nexports.PreparationEmptyState = PreparationEmptyState;');
  for (const condition of ['ready', 'empty', 'read_only', 'loading', 'unavailable', 'refresh_failed', 'unknown', 'lost', 'source_changed', 'source_invalidated', 'private_revoked']) {
    const workspace = { model: { condition, online: true } };
    assert.equal(cards(PreparationEmptyState({ workspace })).length, ['ready', 'empty', 'read_only'].includes(condition) ? 1 : 0, condition);
    workspace.model.online = false; assert.equal(cards(PreparationEmptyState({ workspace })).length, 0, condition);
  }
});

test('contact lists never call stale or failed reads empty and acknowledge loaded scope', () => {
  const { ContactHistory } = load('src/components/contact/ContactHistory.tsx');
  const model = { scopeKey: 'synthetic', load: 'ready', online: true, access: 'editable', page: { requests: [] } };
  assert.match(cardText(ContactHistory({ model, actions: {} })), /已載入資料中/);
  for (const patch of [{ load: 'loading' }, { load: 'error' }, { online: false }, { access: 'lost' }]) assert.equal(cards(ContactHistory({ model: { ...model, ...patch }, actions: {} })).length, 0);
});

test('family lacks success evidence after failed initial reads, so canStartAction gates production empty cards', () => {
  const { FamilyView } = load('src/components/family/FamilyView.tsx');
  const model = { loadState: 'ready', online: true, canStartAction: true, operation: { state: 'none' }, families: [], family: null, children: [] };
  assert.equal(cards(FamilyView({ model, actions: {}, production: true })).length, 1);
  for (const patch of [{ loadState: 'loading' }, { loadState: 'lost' }, { online: false }, { canStartAction: false }]) assert.equal(cards(FamilyView({ model: { ...model, ...patch }, actions: {}, production: true })).length, 0);
});

test('recent notification deliveries do not imply a complete delivery history or an offline success', () => {
  const { RecentDeliveries } = load('src/components/notifications/ChannelCards.tsx', {}, '\nexports.RecentDeliveries = RecentDeliveries;');
  assert.match(cardText(RecentDeliveries({ deliveries: [], emptyReady: true })), /已載入資料中/);
  assert.equal(cards(RecentDeliveries({ deliveries: [], emptyReady: false })).length, 0);
});

test('settings and guide child empties require successful, settled online reads', () => {
  const production = { model: { children: [] }, actions: {}, user: {}, authorization: {}, recordsState: {}, online: true };
  const overrides = { '../production/ProductionProvider': { useProduction: () => production },
    '../production/SettingsDomains': { useProductionSettingsDomains: () => ({ modelSettings: { model: {}, actions: {} } }) },
    '../branding': { brand: { name: 'Synthetic' } } };
  const { default: SettingsPage } = load('src/screens/settingsScreen.tsx', overrides);
  const { default: GuideScreen } = load('src/screens/guideScreen.tsx', overrides);
  for (const [recordsState, online, expected] of [[{}, true, 0], [{ childrenLoadedAt: 'synthetic' }, true, 1],
    [{ childrenLoadedAt: 'synthetic', childrenLoading: true }, true, 0], [{ childrenLoadedAt: 'synthetic', childrenError: 'failed' }, true, 0], [{ childrenLoadedAt: 'synthetic' }, false, 0]]) {
    production.recordsState = recordsState; production.online = online;
    assert.equal(cards(SettingsPage()).length, expected);
    assert.equal(cards(GuideScreen()).length, expected);
  }
});
