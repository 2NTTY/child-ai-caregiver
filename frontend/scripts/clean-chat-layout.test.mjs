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
const nodes = value => !value || typeof value !== 'object' ? [] : [value, ...[value.props?.children].flat(Infinity).flatMap(nodes)];
const node = (tree, type) => nodes(tree).find(item => item.type === type);
const label = (tree, name) => nodes(tree).find(item => item.props?.label === name);
const content = tree => !tree ? '' : Array.isArray(tree) ? tree.map(content).join(' ') : typeof tree === 'object' ? content(tree.props?.children) : String(tree);
const theme = load('src/theme.ts');
const presentation = load('src/components/chat/chat-presentation.ts');
function load(relative) {
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
    : name.endsWith('/SettingsDomains') ? { useProductionSettingsDomains: () => ({ modelSettings: { model: {}, actions: {} } }), ProductionChannelSettings: 'ProductionChannelSettings', ProductionNotificationPreferences: 'ProductionNotificationPreferences' }
    : name.endsWith('/PreviewNavigationGuard') ? { usePreviewNavigation: () => action => action(), usePreviewLeaveGuard: (...args) => current.guards.push(args) }
    : name.endsWith('/AppDialog') ? { AppDialog: dialog }
    : name.endsWith('/useContainerWidth') ? { useContainerWidth: () => ({ width: 390, ref: null, onLayout: noop }) }
    : name.endsWith('/useInteractionDensity') ? { useInteractionDensity: () => false }
    : name.endsWith('/useChatInitialPosition') ? { useChatInitialPosition: () => noop }
    : name.endsWith('/useChatScrollIntent') ? { useChatScrollIntent: noop }
    : name.endsWith('/chat-arrival') ? { isNewReplyArrival: () => false }
    : name.endsWith('/agent-view-model') ? { proposalExpired: proposal => Date.parse(proposal.expiresAt) < Date.now(), agentTime: value => value, agentProposalLabels: { pending: '待你確認' } }
    : name.endsWith('/AgentAuthorizationOwner') ? { mayRetryAuthorization: () => false, maySavePolicy: () => false, reminderEligible: () => false }
    : name.endsWith('/routes') ? { isProductionRouteConnected: () => true }
    : name.endsWith('/branding') ? { brand: { name: '育伴港' } }
    : new Proxy({}, { get: (_target, key) => String(key) });
  new Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
  return module.exports;
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
    scopeKey: 'synthetic-user:synthetic-child', identityKey: 'synthetic-user', user: { name: '合成用戶', email: 'synthetic@example.invalid' },
    model: { selectedChildId: 'synthetic-child', children: [{ id: 'synthetic-child', displayName: '合成孩子' }] },
    actions: { open: action('open'), refresh: noop },
    chatState: { userId: 'synthetic-user', selectedChildId: 'synthetic-child', drafts: {}, messages: [], busy: null, online: true, loading: false, loadedAt: '2026-10-06T00:00:00Z', limit: 20, nextCursor: null },
    chatController: { reloadMessages: action('reload'), loadOlderMessages: action('older'), cancelReply: action('cancel'), confirmFoundMessage: action('confirm'), unlockCheckedSave: action('unlock'), startNewMessage: action('new-message') },
    chatDraft: '', setChatDraft: noop, agentAttachments: [], addAgentAttachment: noop, removeAgentAttachment: noop,
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
function chat() { const page = render(ChatPage).tree; return render(page.props.children.type, page.props.children.props); }

test('clean empty chat has one prompt, separate toolbar, stable composer, and compact privacy access', () => {
  base(); const view = chat(); const timeline = node(view.tree, 'ChatTimeline');
  assert.equal(timeline.props.presentation, 'conversation');
  const heading = nodes(view.tree).find(item => item.props?.testID === 'chat-screen-reader-heading');
  assert.equal(heading.props.accessibilityRole, 'header');
  assert.deepEqual(flatten(heading.props.style), { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 });
  const toolbar = nodes(view.tree).find(item => item.props?.testID === 'chat-top-toolbar');
  assert.equal(flatten(toolbar.props.style).justifyContent, 'flex-end');
  assert.equal(content(timeline.props.emptyState), '今天想聊些甚麼？');
  assert.equal(timeline.props.header, undefined);
  assert.equal(node(view.tree, 'AgentComposer').props.inputHint, undefined);
  assert.equal(node(view.tree, 'AgentConversation').props.visible, false);
  assert.equal(node(view.tree, 'AgentAuthorization'), undefined);
  assert.ok(label(view.tree, 'Google AI 處理 · 僅供合成資料試用'));
  assert.doesNotMatch(content(timeline.props.footer), /已讀取|最後讀取|尚未有已保存聊天/);
  const oldComposer = [view.tree.props.children].flat().findIndex(item => item?.type === 'AgentComposer');
  production.chatState.messages = [{ id: 'u1', role: 'user', text: '合成問題', authorUserId: 'synthetic-user' }];
  rerender(view);
  assert.equal([view.tree.props.children].flat().findIndex(item => item?.type === 'AgentComposer'), oldComposer);
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

test('activity owns a real dialog and reads no receipts while closed; manual candidates and settings remain reachable', () => {
  base(); production.agentModel = { ...production.agentModel, readState: 'ready', run: { id: 'synthetic-run', proposals: [] } };
  let view = render(AgentConversation, { visible: false, onDismiss: noop, onOpenSettings: noop, onReloadChat: noop, reloadDisabled: false });
  view.effects.forEach(fn => fn()); assert.deepEqual(calls, []); assert.equal(view.tree.type, dialog);
  assert.equal(node(view.tree, 'AgentAuthorization'), undefined);
  assert.ok(label(view.tree, '讀取待確認候選')); assert.ok(label(view.tree, '助手設定'));
  view = render(AgentConversation, { ...view.props, visible: true }); view.effects.forEach(fn => fn());
  assert.deepEqual(calls, [['receipts', 'synthetic-run']]);
  label(view.tree, '讀取待確認候選').props.onPress(); assert.deepEqual(calls.at(-1), ['pending']);
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
