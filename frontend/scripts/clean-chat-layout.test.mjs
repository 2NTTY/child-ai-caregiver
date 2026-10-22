import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import ts from 'typescript';

// Shallow synthetic rendering only: no browser, network, storage, or production owner.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let current, production, section;
const calls = [];
const noop = () => {};
const slot = initial => {
  const index = current.cursor++;
  if (!(index in current.slots)) current.slots[index] = typeof initial === 'function' ? initial() : initial;
  return [current, index];
};
const hooks = {
  useState(initial) { const [instance, index] = slot(initial); return [instance.slots[index], value => { instance.slots[index] = typeof value === 'function' ? value(instance.slots[index]) : value; }]; },
  useRef(initial) { const [instance, index] = slot(() => ({ current: initial })); return instance.slots[index]; },
  useEffect(fn) { current.effects.push(fn); }, useLayoutEffect() {}, useId: () => 'synthetic-tabs', useImperativeHandle() {},
};
const dialog = Object.assign(() => null, { Title: 'DialogTitle', Content: 'DialogContent', Actions: 'DialogActions', ScrollArea: 'DialogScrollArea' });
const flatten = value => Array.isArray(value) ? Object.assign({}, ...value.filter(Boolean).map(flatten)) : value || {};
const nodes = value => !value || typeof value !== 'object' ? [] : [value, ...[value.props?.children, value.props?.pendingContent].flat(Infinity).flatMap(nodes)];
const node = (tree, type) => nodes(tree).find(item => item.type === type);
const label = (tree, name) => nodes(tree).find(item => item.props?.label === name);
const content = tree => !tree ? '' : Array.isArray(tree) ? tree.map(content).join(' ') : typeof tree === 'object' ? (tree.type === 'EmptyListCard' ? [tree.props.title, tree.props.detail].filter(Boolean).join(' ') : content([tree.props?.children, tree.props?.pendingContent])) : String(tree);
const theme = load('src/theme.ts');
const presentation = load('src/components/chat/chat-presentation.ts');
function load(relative, suffix = "") {
  const filename = path.join(root, relative);
  const output = ts.transpileModule(readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  const localRequire = name => name === 'react' ? hooks
    : name === 'react/jsx-runtime' ? require(name)
    : name === 'react-native' ? { Platform: { OS: 'web', select: value => value.web ?? value.default }, StyleSheet: { create: value => value }, Pressable: 'Pressable', View: 'View', useWindowDimensions: () => ({ width: 390, height: 844 }) }
    : name === 'react-native-paper' ? { Text: 'Text', ActivityIndicator: 'ActivityIndicator', MD3LightTheme: { colors: {}, fonts: {} }, configureFonts: value => value }
    : name === 'expo-router' ? { usePathname: () => '/chat', useRouter: () => ({ push: destination => calls.push(['route', destination]) }), useLocalSearchParams: () => ({ section }) }
    : name.endsWith('/theme') ? theme
    : name.endsWith('/chat-presentation') ? presentation
    : name.endsWith('/ProductionProvider') ? { useProduction: () => production }
    : name.endsWith('/BackgroundSurface') ? { BackgroundSurface: 'BackgroundSurface', useCustomBackground: () => false }
    : name.endsWith('/ProductionFirstScreenGate') ? { useProductionVisibleSettingsSection: noop }
    : name.endsWith('/agent-feedback') ? { AGENT_PROGRESS_LABELS: {} }
    : name.endsWith('/CareProfileDomains') ? { useProductionCareProfile: () => null }
    : name.endsWith('/CareWorkspace') ? { useCareWorkspace: () => null }
    : name.endsWith('/SettingsDomains') ? { useProductionSettingsDomains: () => ({ modelSettings: { model: {}, actions: {} } }), ProductionChannelSettings: 'ProductionChannelSettings', ProductionNotificationPreferences: 'ProductionNotificationPreferences' }
    : name.endsWith('/PreviewNavigationGuard') ? { usePreviewNavigation: () => action => action(), usePreviewLeaveGuard: (...args) => current.guards.push(args) }
    : name.endsWith('/AppDialog') ? { AppDialog: dialog }
    : name.endsWith('/useContainerWidth') ? { useContainerWidth: () => ({ width: 390, ref: null, onLayout: noop }) }
    : name.endsWith('/useInteractionDensity') ? { useInteractionDensity: () => false }
    : name.endsWith('/useChatInitialPosition') ? { useChatInitialPosition: () => noop }
    : name.endsWith('/useChatScrollIntent') ? { useChatScrollIntent: noop }
    : name.endsWith('/chat-arrival') ? { isNewReplyArrival: () => false }
    : name.endsWith('/agent-view-model') ? { proposalExpired: proposal => Date.parse(proposal.expiresAt) < Date.now(), agentTime: value => value, agentProposalLabels: { pending: '待你確認' } }
    : name.endsWith('/proposal-presentation') ? load('src/components/agent/proposal-presentation.ts')
    : name.endsWith('/AgentAuthorizationOwner') ? { mayRetryAuthorization: () => false, maySavePolicy: () => false, reminderEligible: () => false }
    : name.endsWith('/routes') ? { isProductionRouteConnected: () => true }
    : name.endsWith('/branding') ? { brand: { name: '育伴港' } }
    : name.endsWith('/care-view-model') ? { careKindOptions: [] }
    : name.endsWith('/useDomainEnvironment') ? { useDomainEnvironment: () => ({ scopeKey: production.scopeKey }) }
    : name.endsWith('/locateCitationSource') ? { locateCitationSource: () => { throw new Error('Citation scrolling is outside this shallow harness'); } }
    : componentDependency(name);
  new Function('require', 'module', 'exports', output + suffix)(localRequire, module, module.exports);
  return module.exports;
}
function componentDependency(name) {
  const modules = {
    '/EmptyListCard': ['EmptyListCard'], '/ChatFileMessage': ['ChatFileMessage'], '/VoiceMessage': ['VoiceMessage'],
    '/OfficialHelpCards': ['OfficialHelpCards'], '/AdminEntry': ['AdminEntry'], '/AccountDataControls': ['AccountDataControls', 'AccountSecurityControls'],
    '/ui': ['AppButton', 'AppTextField', 'AppTabPanel', 'SectionCard', 'SectionHeader', 'TextLink'],
    '/AgentComposer': ['AgentComposer'], '/ChatMessage': ['ChatMessage'], '/ChatTimeline': ['ChatTimeline'],
    '/AgentConversation': ['AgentConversation'], '/PhotoInputDomains': ['AgentPhotoInput'],
    '/AppScrollView': ['AppScrollView'], '/AppIcon': ['AppIcon'], '/AppStatusBadge': ['AppStatusBadge'], '/motion': ['MotionEntrance', 'MotionDisclosure'],
    '/AgentInboxView': ['AgentInboxView'], '/AgentRunView': ['AgentRunView'], '/ReadStateNotice': ['ReadStateNotice'],
    '/AppCheckbox': ['AppCheckbox'], '/BackgroundSettings': ['BackgroundSettings'], '/MotionSettings': ['MotionSettings'],
    '/PageFrame': ['PageFrame'], '/AgentAuthorization': ['AgentAuthorization'], '/ModelSettingsView': ['ModelSettingsView'],
    '/SettingsNavigation': ['SettingsNavigation'], '/SettingsSection': ['SettingsSection'],
    '/CareRecordsView': ['CareRecordsView'], '/CareSavedRecordsView': ['CareSavedRecordsView'], '/photosScreen': ['PhotoWorkspace'],
  };
  const exports = Object.entries(modules).find(([suffix]) => name.endsWith(suffix))?.[1];
  assert.ok(exports, `Unmocked chat dependency: ${name}`);
  return Object.fromEntries(exports.map(component => [component, component]));
}
function render(component, props = {}, instance) {
  current = instance ?? { slots: [] };
  Object.assign(current, { component, props, cursor: 0, effects: [], guards: [] });
  current.tree = component(props);
  return current;
}
function rerender(instance) { return render(instance.component, instance.props, instance); }
function base() {
  calls.length = 0; section = undefined;
  const action = name => (...args) => calls.push([name, ...args]);
  production = {
    online: true, recordsState: { childrenLoadedAt: '2026-10-07', childrenLoading: false, childrenError: null },
    scopeKey: 'synthetic-user:synthetic-child', identityKey: 'synthetic-user', user: { name: '合成用戶', email: 'synthetic@example.invalid' },
    model: { selectedChildId: 'synthetic-child', children: [{ id: 'synthetic-child', displayName: '合成孩子' }] },
    actions: { open: action('open'), refresh: noop },
    chatState: { userId: 'synthetic-user', selectedChildId: 'synthetic-child', drafts: {}, messages: [], busy: null, online: true, loading: false, loadedAt: '2026-10-06T00:00:00Z', limit: 20, nextCursor: null },
    chatController: { reloadMessages: action('reload'), loadOlderMessages: action('older'), cancelReply: action('cancel'), confirmFoundMessage: action('confirm'), unlockCheckedSave: action('unlock'), startNewMessage: action('new-message') },
    chatDraft: '', setChatDraft: noop, agentAttachments: [], addAgentAttachment: noop, removeAgentAttachment: noop,
    voiceUpload: { busy: false, unknown: false, notice: null }, fileUpload: { busy: false, unknown: false, notice: null },
    checkVoiceUpload: action('check-voice'), checkFileUpload: action('check-file'),
    sendChat: action('send'), requestChatReply: action('reply'), agentRuns: {}, chatWritesAllowed: true, selectAgentRun: action('select-run'), openAgentSource: noop,
    agentModel: { online: true, readState: 'idle', run: null, busy: null, pendingDecision: null },
    agentPending: { state: 'idle', entries: [] }, agentInbox: {}, agentActions: {}, agentInboxActions: {}, readAgentPending: action('pending'),
    authorization: { policy: null, policyState: 'idle', draft: { recordKinds: [], allowPrivateNotes: false, allowSelfTasks: false, allowRecordCorrections: false, reminders: false }, notes: [], receipts: {}, online: true },
    authorizationActions: { readReceipts: action('receipts') }, owner: { authorizationOwner: { mayDelete: () => false } }, signOut: noop,
  };
  return production;
}
const { default: ChatPage } = load('src/screens/chatScreen.tsx');
const { ChatTimeline } = load('src/components/chat/ChatTimeline.tsx');
const { AgentConversation } = load('src/production/AgentConversation.tsx');
const { AgentAuthorization } = load('src/production/AgentAuthorization.tsx');
const { default: SettingsPage } = load('src/screens/settingsScreen.tsx');
function chat() {
  const page = render(ChatPage).tree;
  const contents = nodes(page).find(item => typeof item.type === 'function');
  assert.ok(contents, 'ChatContents remains mounted under the page-local layout');
  return render(contents.type, contents.props);
}

test('clean empty chat has one prompt, separate toolbar, stable composer, and compact privacy access', () => {
  base(); const view = chat(); const timeline = node(view.tree, 'ChatTimeline');
  assert.equal(timeline.props.presentation, 'conversation');
  const heading = nodes(view.tree).find(item => item.props?.testID === 'chat-screen-reader-heading');
  assert.equal(heading.props.accessibilityRole, 'header');
  assert.deepEqual(flatten(heading.props.style), { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 });
  const toolbar = nodes(view.tree).find(item => item.props?.testID === 'chat-top-toolbar');
  assert.equal(flatten(toolbar.props.style).justifyContent, 'flex-end');
  assert.equal(content(timeline.props.emptyState).trim(), '想先聊聊什麼？');
  assert.equal(timeline.props.header, undefined);
  assert.equal(node(view.tree, 'AgentComposer').props.inputHint, undefined);
  assert.equal(node(view.tree, 'AgentConversation').props.visible, false);
  assert.equal(node(view.tree, 'AgentAuthorization'), undefined);
  assert.ok(label(view.tree, 'AI 處理 · 僅使用獲授權資料'));
  assert.doesNotMatch(content(timeline.props.footer), /已讀取|最後讀取|尚未有已保存聊天/);
  const readingPanel = nodes(view.tree).find(item => item.props?.testID === 'chat-reading-panel');
  const oldComposer = [readingPanel.props.children].flat().findIndex(item => item?.type === 'AgentComposer');
  assert.ok(oldComposer >= 0);
  production.chatState.messages = [{ id: 'u1', role: 'user', text: '合成問題', authorUserId: 'synthetic-user' }];
  rerender(view);
  assert.equal([nodes(view.tree).find(item => item.props?.testID === 'chat-reading-panel').props.children].flat().findIndex(item => item?.type === 'AgentComposer'), oldComposer);
});

test('activity toolbar uses page-local layout units and leaves the reading panel only when a full side gutter fits', () => {
  base(); const page = render(ChatPage);
  const child = () => nodes(page.tree).find(item => typeof item.type === 'function');
  const layout = () => nodes(page.tree).find(item => item.props?.testID === 'chat-page-layout');
  assert.equal(child().props.externalActivity, false, 'unknown layout width must use the safe in-flow toolbar');
  const view = render(child().type, child().props);
  const panel = () => nodes(view.tree).find(item => item.props?.testID === 'chat-reading-panel');
  const toolbar = () => nodes(view.tree).find(item => item.props?.testID === 'chat-top-toolbar');
  const timeline = node(view.tree, 'ChatTimeline'), composer = node(view.tree, 'AgentComposer');
  const childShape = () => [panel().props.children].flat().filter(Boolean).map(item => [item.type, item.key]);
  const originalShape = childShape(), scrollRef = timeline.props.scrollRef, controlsRef = timeline.props.controlsRef;
  assert.ok(!nodes(panel()).includes(toolbar()), 'activity is outside the body reading surface, never in message content');
  assert.equal(flatten(toolbar().props.style).maxWidth, undefined);
  for (const width of [1440, 1112, 1111, 1024, 800, 390, 320, 1440]) {
    layout().props.onLayout({ nativeEvent: { layout: { width } } }); rerender(page);
    child().props.onPaneLayout({ nativeEvent: { layout: { width: Math.min(width, 760) } } }); rerender(page);
    view.props = child().props; rerender(view);
    const floating = width >= 1112, style = flatten(toolbar().props.style);
    assert.equal(child().props.externalActivity, floating, `CSS layout width ${width}; no visual/zoom rect conversion`);
    assert.equal(style.position, floating ? 'absolute' : undefined);
    assert.equal(style.width, floating ? 152 : '100%');
    if (floating) {
      const bodyRight = width / 2 + 760 / 2, toolbarLeft = width - style.right - style.width;
      assert.ok(toolbarLeft - bodyRight >= 16, 'a full gap separates the toolbar and maximum reading column');
    }
    assert.deepEqual(childShape(), originalShape, 'responsive positioning never reparents timeline/composer');
    assert.equal(node(view.tree, 'ChatTimeline').props.scrollRef, scrollRef);
    assert.equal(node(view.tree, 'ChatTimeline').props.controlsRef, controlsRef);
    assert.equal(node(view.tree, 'ChatTimeline').key, timeline.key);
    assert.equal(node(view.tree, 'AgentComposer').key, composer.key);
    assert.equal(node(view.tree, 'ChatTimeline').props.followRequest, undefined);
  }
  label(view.tree, '活動 · 尚未讀取').props.onPress(); rerender(view);
  assert.equal(node(view.tree, 'AgentConversation').props.visible, true);
  assert.deepEqual(calls, [], 'moving the entry neither selects another run nor issues any new read/write');
  assert.equal(node(view.tree, 'ChatTimeline').props.scrollRef, scrollRef);
  production.model.children = []; rerender(view);
  assert.equal(label(view.tree, '活動 · 尚未讀取').props.disabled, true);
});

test('conversation timeline opts into top alignment and centered empty prompt without changing generic defaults', () => {
  base(); const props = { items: [{ id: 'one' }], renderItem: () => 'message' };
  const standard = render(ChatTimeline, props).tree;
  assert.equal(flatten(node(standard, 'AppScrollView').props.contentContainerStyle).justifyContent, 'flex-end');
  assert.ok(nodes(standard).some(item => item.props?.testID === 'chat-history-start'));
  const clean = render(ChatTimeline, { ...props, presentation: 'conversation' }).tree;
  assert.equal(flatten(node(clean, 'AppScrollView').props.contentContainerStyle).justifyContent, 'flex-start');
  assert.ok(!nodes(clean).some(item => item.props?.testID === 'chat-history-start'));
  const empty = render(ChatTimeline, { ...props, items: [], presentation: 'conversation', emptyState: 'prompt' }).tree;
  assert.equal(flatten(node(empty, 'AppScrollView').props.contentContainerStyle).justifyContent, 'center');
  const older = render(ChatTimeline, { ...props, items: [{ id: 'one' }, { id: 'two' }], recentLimit: 1, presentation: 'conversation' }).tree;
  assert.ok(label(older, '查看較早記錄（1 則）'));
});

test('earlier chat appears only for a real cursor and calls the existing pagination owner', () => {
  base(); production.chatState.nextCursor = 'synthetic-cursor';
  const timeline = node(chat().tree, 'ChatTimeline');
  const earlier = label(timeline.props.header, '較早對話');
  assert.ok(earlier); earlier.props.onPress(); assert.deepEqual(calls, [['older']]);
});

test('message details select the original run and pending decisions remain discoverable after dismissal', () => {
  base(); const message = { id: 'a1', role: 'model', text: '合成回答', agentRunId: 'synthetic-run' };
  production.chatState.messages = [message]; const view = chat();
  const response = node(view.tree, 'ChatTimeline').props.renderItem(message);
  label(response.props.footer, '詳情').props.onPress();
  assert.deepEqual(calls, [['select-run', 'synthetic-run']]);
  rerender(view); assert.equal(node(view.tree, 'AgentConversation').props.visible, true);
  node(view.tree, 'AgentConversation').props.onDismiss(); rerender(view);
  production.agentModel.pendingDecision = { runId: 'synthetic-run', proposalId: 'synthetic-proposal' };
  rerender(view); view.effects.forEach(fn => fn()); rerender(view);
  assert.equal(node(view.tree, 'AgentConversation').props.visible, true);
  assert.ok(label(view.tree, '活動 · 待查核'));
});

test('send, unknown recovery, stop, original reply retry, and attachment gates keep existing callbacks', () => {
  base(); production.chatDraft = '合成問題'; let view = chat();
  assert.equal(node(view.tree, 'AgentComposer').props.submitEnabled, true);
  node(view.tree, 'AgentComposer').props.onPreview(); assert.deepEqual(calls, [['send']]);
  production.chatState.drafts['synthetic-child'] = { phase: 'save_unknown', notice: '原保存未知' };
  view = chat(); assert.equal(node(view.tree, 'AgentComposer').props.submitEnabled, false);
  label(node(view.tree, 'ChatTimeline').props.footer, '重新讀取並查核原保存').props.onPress();
  assert.deepEqual(calls.at(-1), ['reload']);
  production.chatState.drafts['synthetic-child'] = { phase: 'checked', candidateMessageId: 'u1' };
  view = chat(); const checked = node(view.tree, 'ChatTimeline').props.footer;
  label(checked, '已核對，確認這則聊天已保存').props.onPress(); label(checked, '已核對，解鎖原文重試').props.onPress();
  assert.deepEqual(calls.slice(-2), [['confirm'], ['unlock']]);
  production.chatState.drafts['synthetic-child'] = { phase: 'reply_failed', savedUserMessageId: 'u1' };
  view = chat(); label(node(view.tree, 'ChatTimeline').props.footer, '重試原訊息回覆').props.onPress();
  assert.deepEqual(calls.at(-1), ['reply', 'u1']);
  production.chatState.busy = 'reply'; view = chat(); label(node(view.tree, 'ChatTimeline').props.footer, '停止回覆').props.onPress();
  assert.deepEqual(calls.at(-1), ['cancel']);
  production.chatState.busy = null; production.chatState.drafts = {}; production.agentAttachments = [{ id: 'synthetic-photo', photo: {} }];
  view = chat(); assert.equal(node(view.tree, 'AgentComposer').props.submitEnabled, false);
  assert.ok(node(node(view.tree, 'ChatTimeline').props.footer, 'AgentPhotoInput'));
});

test('activity owns a real dialog, reads no receipts while closed, and exposes guarded retry only after candidate failure', () => {
  base(); production.agentModel = { ...production.agentModel, readState: 'ready', run: { id: 'synthetic-run', proposals: [] } };
  let view = render(AgentConversation, { visible: false, onDismiss: noop, onOpenSettings: noop, onReloadChat: noop, reloadDisabled: false });
  view.effects.forEach(fn => fn()); assert.deepEqual(calls, []); assert.equal(view.tree.type, dialog);
  assert.equal(node(view.tree, 'AgentAuthorization'), undefined);
  assert.equal(label(view.tree, '重新讀取待確認候選'), undefined); assert.equal(label(view.tree, '助手設定'), undefined);
  assert.equal(label(view.tree, '重新讀取聊天'), undefined); assert.ok(label(view.tree, '關閉'));
  assert.ok(node(view.tree, 'AgentRunView'), 'the selected run remains in its detail renderer');
  view = render(AgentConversation, { ...view.props, visible: true }); view.effects.forEach(fn => fn());
  assert.deepEqual(calls, [['receipts', 'synthetic-run']]);
  production.agentModel = { ...production.agentModel, readState: 'idle', run: null };
  production.agentPending = { state: 'failed', entries: [] }; rerender(view);
  const retry = label(view.tree, '重新讀取待確認候選');
  assert.equal(retry.props.disabled, false); retry.props.onPress(); assert.deepEqual(calls.at(-1), ['pending']);
  for (const guard of [{ online: false }, { busy: 'read' }, { pendingDecision: {} }, { writesBlocked: true }, { readState: 'denied' }]) {
    const original = production.agentModel; production.agentModel = { ...original, ...guard }; rerender(view);
    if (guard.readState === 'denied') assert.equal(label(view.tree, '重新讀取待確認候選'), undefined, 'access loss shows only the guarded detail notice, not discovery controls');
    else assert.equal(label(view.tree, '重新讀取待確認候選').props.disabled, true);
    production.agentModel = original;
  }
  for (const state of ['idle', 'loading', 'ready', 'denied']) {
    production.agentPending = { state, entries: [] }; rerender(view);
    assert.equal(label(view.tree, '重新讀取待確認候選'), undefined);
  }
});

test('assistant settings uses the existing authorization view with child scope and explicit route selection', () => {
  base(); section = 'assistant'; const view = render(SettingsPage);
  const panel = nodes(view.tree).find(item => item.type === 'AppTabPanel' && item.props.tabKey === 'assistant');
  assert.equal(panel.props.active, true); assert.equal(node(panel, 'AgentAuthorization').key, production.scopeKey);
  assert.ok(node(view.tree, 'SettingsNavigation').props.items.some(item => item.key === 'assistant'));
});

test('authorization keeps private-note confirmation and child-scoped dirty/pending leave guards', () => {
  base(); const state = production.authorization;
  state.policyState = 'ready'; state.policy = { recordKinds: [], allowPrivateNotes: false, allowSelfTasks: false, allowRecordCorrections: false, reminderBindings: [], version: 1 };
  state.draft.allowPrivateNotes = true;
  const view = render(AgentAuthorization);
  assert.equal(view.guards[0][0], true); assert.equal(view.guards[0][1], false); assert.equal(view.guards[0][2], 'child');
  assert.ok(label(view.tree, '確認刪除')); assert.ok(label(view.tree, '確認保存授權'));
  assert.equal(nodes(view.tree).filter(item => item.type === 'MotionDisclosure').length, 0);
  state.pending = { kind: 'policy', input: { recordKinds: [], reminderBindings: [], expectedVersion: 1 } };
  const pending = render(AgentAuthorization); assert.equal(pending.guards[0][1], true);
  assert.ok(label(pending.tree, '明確重試原操作'));
});


test('fresh Chat automatically requests pending discovery and shows the loaded cross-conversation candidate badge', () => {
  base(); let view = chat(); view.effects.forEach(fn => fn());
  assert.deepEqual(calls, [['pending']]);
  assert.ok(label(view.tree, '活動 · 尚未讀取'));
  production.agentPending = { state: 'loading', entries: [] }; rerender(view);
  assert.ok(label(view.tree, '活動 · 讀取中'));
  production.agentPending = { state: 'failed', entries: [] }; rerender(view);
  assert.ok(label(view.tree, '活動 · 讀取失敗'));
  production.agentPending = { state: 'ready', entries: [{ runId: 'older-conversation', proposal: { id: 'pending-fact', status: 'pending', expiresAt: '2099-01-01T00:00:00Z' } }] };
  rerender(view); assert.ok(label(view.tree, '活動 · 待確認'));
  production.agentPending = { state: 'ready', entries: [] }; rerender(view); assert.ok(label(view.tree, '活動'));
  base(); production.chatState.online = false; view = chat(); view.effects.forEach(fn => fn()); assert.deepEqual(calls, []);
});

test('Care and activity never describe unread, loading, failed or denied discovery as empty', () => {
  const { AgentPendingReview } = load('src/screens/careScreen.tsx', '\nexports.AgentPendingReview = AgentPendingReview;');
  base(); production.online = true;
  for (const state of ['idle', 'loading', 'failed', 'denied', 'ready']) {
    production.agentPending = { state, entries: [] };
    const care = content(render(AgentPendingReview).tree);
    const activity = content(render(AgentConversation, { visible: true, onDismiss: noop, onOpenSettings: noop, onReloadChat: noop, reloadDisabled: false }).tree);
    if (state === 'ready') { assert.match(care, /暫無待確認提案/u); assert.match(activity, /沒有待確認/u); }
    else { assert.doesNotMatch(care, /沒有待確認|暫無待確認提案/u); assert.doesNotMatch(activity, /沒有待確認/u); }
    if (state === 'idle') { assert.match(care, /尚未讀取/u); assert.match(activity, /尚未讀取/u); }
    if (state === 'denied') { assert.match(care, /沒有權限/u); assert.match(activity, /沒有權限/u); }
  }
});

test('reply details retain the pressed node before selecting a run and restore only after dialog closes', () => {
  base(); const message = { id: 'a1', role: 'model', text: 'Synthetic reply', agentRunId: 'synthetic-run' };
  production.chatState.messages = [message]; const view = chat();
  const entry = label(node(view.tree, 'ChatTimeline').props.renderItem(message).props.footer, '詳情');
  const button = render(entry.type, entry.props).tree;
  const focused = [];
  const trigger = { isConnected: true, hasAttribute: () => false, getAttribute: () => null, closest: () => null, focus: options => focused.push(options) };
  button.props.ref.current = trigger;
  production.selectAgentRun = id => { calls.push(['select-run', id]); production.agentModel.busy = 'read'; };
  button.props.onPress(); rerender(view);
  assert.deepEqual(calls, [['select-run', 'synthetic-run']]);
  assert.equal(node(view.tree, 'AgentConversation').props.visible, true);
  production.agentModel.busy = null;
  node(view.tree, 'AgentConversation').props.onDismiss(); rerender(view);
  assert.deepEqual(focused, [], 'closing must not race the still-active modal focus trap');
  node(view.tree, 'AgentConversation').props.onClosed();
  assert.deepEqual(focused, [{ preventScroll: true }]);
  node(view.tree, 'AgentConversation').props.onClosed();
  assert.equal(focused.length, 1, 'a completed close must consume the trigger');
  label(view.tree, '活動 · 尚未讀取').props.onPress(); rerender(view);
  node(view.tree, 'AgentConversation').props.onDismiss(); rerender(view);
  node(view.tree, 'AgentConversation').props.onClosed();
  assert.equal(focused.length, 1, 'header keeps its existing native modal focus restoration');
});

test('reply details do not restore a detached, disabled, or hidden trigger', () => {
  for (const guard of [{ isConnected: false }, { hasAttribute: () => true }, { getAttribute: () => 'true' }, { closest: () => ({}) }]) {
    base(); const message = { id: 'a1', role: 'model', text: 'Synthetic reply', agentRunId: 'synthetic-run' };
    production.chatState.messages = [message]; const view = chat(); let focused = false;
    const trigger = { isConnected: true, hasAttribute: () => false, getAttribute: () => null, closest: () => null, focus: () => { focused = true; }, ...guard };
    label(node(view.tree, 'ChatTimeline').props.renderItem(message).props.footer, '詳情').props.onPress(trigger);
    rerender(view); node(view.tree, 'AgentConversation').props.onDismiss(); rerender(view);
    node(view.tree, 'AgentConversation').props.onClosed();
    assert.equal(focused, false);
  }
});

test('settings navigation drops the reply details focus target', () => {
  base(); const message = { id: 'a1', role: 'model', text: 'Synthetic reply', agentRunId: 'synthetic-run' };
  production.chatState.messages = [message]; const view = chat(); let focused = false;
  const trigger = { isConnected: true, hasAttribute: () => false, getAttribute: () => null, closest: () => null, focus: () => { focused = true; } };
  label(node(view.tree, 'ChatTimeline').props.renderItem(message).props.footer, '詳情').props.onPress(trigger);
  rerender(view); node(view.tree, 'AgentConversation').props.onOpenSettings(); rerender(view);
  node(view.tree, 'AgentConversation').props.onClosed();
  assert.deepEqual(calls.at(-1), ['route', '/settings?section=assistant']);
  assert.equal(focused, false);
});

test('activity forwards post-close notification and shares dismissal with its close button', () => {
  base(); const dismiss = () => {}, closed = () => {};
  const view = render(AgentConversation, { visible: true, onDismiss: dismiss, onClosed: closed, onOpenSettings: noop, onReloadChat: noop, reloadDisabled: false });
  assert.equal(view.tree.props.onDismiss, dismiss);
  assert.equal(view.tree.props.onClosed, closed);
  assert.equal(label(view.tree, '關閉').props.onPress, dismiss);
});
