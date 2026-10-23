import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './scope-transition-harness.mjs';

// Actual screen/entry render logic with synthetic owner snapshots. This does not
// establish browser geometry, real API pagination, IME or native focus behavior.
const text = node => !node ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node);
const flatten = value => Array.isArray(value) ? Object.assign({}, ...value.filter(Boolean).map(flatten)) : value || {};
function setup(width = 1440) {
  const native = { Platform: { OS: 'web', select: value => value.web ?? value.default }, StyleSheet: { create: value => value, flatten },
    View: 'View', Pressable: 'Pressable', useWindowDimensions: () => ({ width }) };
  const surface = { BackgroundSurface: 'BackgroundSurface', useCustomBackground: () => false };
  const dialog = Object.assign(() => null, { Title: 'DialogTitle', Content: 'DialogContent', Actions: 'DialogActions' });
  const mocks = {
    'react-native': native,
    'react-native-paper': { Text: 'Text', TouchableRipple: 'TouchableRipple', MD3LightTheme: { colors: {}, fonts: {} }, configureFonts: value => value },
    '../components/appearance/BackgroundSurface': surface,
    '../components/AppDialog': { AppDialog: dialog }, '../components/agent/AgentComposer': { AgentComposer: 'AgentComposer' },
    '../components/chat/ChatMessage': { ChatMessage: 'ChatMessage', ChatProgressIndicator: 'ChatProgressIndicator' },
    '../components/chat/ChatTimeline': { ChatTimeline: 'ChatTimeline' },
    '../components/chat/locateCitationSource': { locateCitationSource() {} },
    '../production/AgentConversation': { AgentConversation: 'AgentConversation' },
    '../production/PhotoInputDomains': { AgentPhotoInput: 'AgentPhotoInput' },
    '../production/ChatFileMessage': { ChatFileMessage: 'ChatFileMessage' },
    '../production/VoiceMessage': { VoiceMessage: 'VoiceMessage' },
    '../components/chat/OfficialHelpCards': { OfficialHelpCards: 'OfficialHelpCards' },
    '../preview/PreviewNavigationGuard': { PreviewLink: 'PreviewLink', usePreviewLeaveGuard() {}, usePreviewNavigation: () => action => action() },
    './AppIcon': { AppIcon: 'AppIcon' }, 'expo-router': { usePathname: () => '/chat', useRouter: () => ({ push() {} }) },
  };
  const h = harness(mocks);
  const theme = h.load('src/theme.ts'); mocks['../theme'] = theme; mocks['../../theme'] = theme;
  const { default: ChatPage } = h.load('src/screens/chatScreen.tsx');
  const { AgentEntryButton } = h.load('src/components/AgentEntryButton.tsx');
  const { navigationItems, desktopNavigationGroups, moreNavigationGroups } = h.load('src/components/navigation/app-navigation.ts');
  const calls = [], action = name => (...args) => calls.push([name, ...args]);
  const owner = { scopeKey: 'user:child-a', model: { selectedChildId: 'child-a', children: [{ id: 'child-a' }, { id: 'child-b' }] },
    actions: { open: action('open'), refresh: action('refresh') },
    chatState: { userId: 'user', selectedChildId: 'child-a', drafts: {}, messages: [], busy: null, online: true, loading: false,
      loadedAt: '2026-10-21T00:00:00Z', limit: 20, nextCursor: null, loadingOlder: false, error: null },
    chatController: { loadOlderMessages: action('older'), reloadMessages: action('reload') },
    chatDraft: '保留草稿', setChatDraft: action('draft'), agentAttachments: [], addAgentAttachment: action('attach'), removeAgentAttachment: action('remove'),
    composerFocusRequest: 7, sendChat: action('send'), requestChatReply: action('reply'), agentRuns: {},
    agentModel: { readState: 'ready', run: null, pendingDecision: null }, agentPending: { state: 'ready', entries: [] }, readAgentPending: action('pending'),
    voiceUpload: {}, fileUpload: {}, authorization: {}, chatWritesAllowed: true, selectAgentRun: action('run'), openAgentSource: action('source') };
  const render = () => { h.production(owner); h.render(h.jsx(ChatPage, {})); return h.hosts().find(node => node.type === 'ChatTimeline'); };
  const composer = () => h.hosts().find(node => node.type === 'AgentComposer');
  return { h, theme, owner, calls, render, composer, AgentEntryButton, navigationItems, desktopNavigationGroups, moreNavigationGroups };
}

test('desktop primary entry restores both lines and the original guarded link, icon, chevron and focus treatment', () => {
  const s = setup(); s.h.render(s.h.jsx(s.AgentEntryButton, { active: false }));
  const link = s.h.hosts().find(node => node.type === 'PreviewLink'), entry = s.h.node('agent-entry');
  assert.equal(link.props.href, '/chat'); assert.equal(entry.props.accessibilityRole, 'link');
  assert.equal(entry.props.accessibilityLabel, '與 Agent 對話');
  assert.equal(text(entry), '與 Agent 對話提問・整理・規劃');
  assert.deepEqual(s.h.hosts().filter(node => node.type === 'AppIcon').map(node => node.props.name), ['star-four-points', 'chevron-right']);
  assert.equal(entry.props.style.backgroundColor, s.theme.colors.accent);
  assert.equal(entry.props.style.borderRadius, s.theme.radius.medium); assert.equal(entry.props.style.borderWidth, 2);
  entry.props.onFocus(); s.h.render(); assert.equal(s.h.node('agent-entry').props.style.outlineWidth, 2);
  s.h.render(s.h.jsx(s.AgentEntryButton, { active: true })); assert.equal(s.h.node('agent-entry').props['aria-current'], 'page');
  assert.equal(s.navigationItems.chat.short, '助手'); assert.equal(s.navigationItems.chat.href, '/chat');
});

test('the initial prompt requires a confirmed empty selected-child history, not a loading/error/older-page gap', () => {
  const s = setup(), state = s.owner.chatState;
  assert.equal(text(s.render().props.emptyState), '想先聊聊什麼？'); assert.equal(s.composer().props.suggestionsAvailable, true);
  for (const patch of [{ loadedAt: null }, { loading: true, loadedAt: null }, { error: '合成讀取失敗' }, { loadingOlder: true }, { nextCursor: 'older-page' },
    { selectedChildId: 'child-b' }, { messages: [{ id: 'existing', role: 'user', text: '已保存訊息' }] }]) {
    const previous = { ...state }; Object.assign(state, patch);
    assert.doesNotMatch(text(s.render().props.emptyState), /想先聊聊/); assert.equal(s.composer().props.suggestionsAvailable, false);
    Object.assign(state, previous);
  }
  for (const patch of [{ busy: 'save' }, { drafts: { 'child-a': { phase: 'save_unknown' } } }]) {
    const previous = { ...state }; Object.assign(state, patch); assert.doesNotMatch(text(s.render().props.emptyState), /想先聊聊/); Object.assign(state, previous);
  }
  s.owner.agentAttachments = [{ id: 'pending-file', kind: 'file' }]; assert.doesNotMatch(text(s.render().props.emptyState), /想先聊聊/);
});

test('child changes wait for that child read; timestamps do not reset established history or draft/focus props', () => {
  const s = setup(), state = s.owner.chatState;
  const messages = [{ id: 'saved-a', role: 'user', text: '已保存訊息', authorUserId: 'user' }]; state.messages = messages;
  for (const loadedAt of ['2026-10-21T23:59:00Z', '2026-10-22T00:01:00Z']) {
    state.loadedAt = loadedAt; const timeline = s.render();
    assert.equal(timeline.props.items, messages); assert.equal(timeline.props.emptyState, null);
    assert.equal(s.composer().props.draft, '保留草稿'); assert.equal(s.composer().props.focusRequest, 7);
  }
  s.owner.model.selectedChildId = 'child-b'; s.owner.scopeKey = 'user:child-b';
  state.selectedChildId = 'child-b'; state.messages = []; state.loadedAt = null; state.loading = true;
  assert.match(text(s.render().props.emptyState), /正在讀取聊天/);
  state.loading = false; state.loadedAt = '2026-10-22T00:01:00Z';
  assert.equal(text(s.render().props.emptyState), '想先聊聊什麼？');
  s.owner.model.selectedChildId = 'child-a'; s.owner.scopeKey = 'user:child-a';
  Object.assign(state, { selectedChildId: 'child-a', messages, loadedAt: '2026-10-22T00:02:00Z' });
  assert.equal(s.render().props.items, messages); assert.equal(s.render().props.emptyState, null);
});

test('an empty page with an older cursor keeps the existing pagination callback rather than offering a first conversation', () => {
  const s = setup(); s.owner.chatState.nextCursor = 'older-page'; const timeline = s.render();
  assert.equal(timeline.props.emptyState, null); assert.equal(timeline.props.header.props.children.props.label, '較早對話');
  timeline.props.header.props.children.props.onPress(); assert.deepEqual(s.calls.at(-1), ['older']);
  assert.equal(s.composer().props.onChangeDraft, s.owner.setChatDraft);
});


test('the chat toolbar keeps activity but no duplicate memory shortcut at compact and desktop widths', () => {
  for (const width of [320, 390, 1024, 1440]) {
    const s = setup(width); s.render();
    const toolbar = () => s.h.node('chat-top-toolbar');
    const activity = () => toolbar().props.children[1].props.children;
    assert.equal(activity().props.label, '活動');
    assert.equal(activity().props.compact, width < s.theme.mobileLayout.breakpoint);
    assert.doesNotMatch(text(toolbar()), /記憶與參考/);
    assert.equal(s.h.hosts().some(node => node.props.accessibilityLabel === '記憶與參考'), false);
    s.owner.agentPending.entries = [{ proposal: { status: 'pending', expiresAt: '2099-01-01T00:00:00Z' } }];
    s.render(); assert.equal(activity().props.label, '活動 · 待確認');
    assert.equal(activity().props.accessibilityLabel, '對話詳情與活動，有事項待確認');
    activity().props.onPress(); s.h.render();
    assert.equal(s.h.hosts().find(node => node.type === 'AgentConversation').props.visible, true);
    s.owner.agentModel.pendingDecision = { runId: 'original-run', proposalId: 'original-proposal' };
    s.render(); assert.equal(activity().props.label, '活動 · 待查核');
    assert.equal(s.navigationItems.memory.href, '/memory');
    assert.equal(s.navigationItems.memory.label, '記憶與參考');
    assert.ok(s.desktopNavigationGroups.some(group => group.keys.includes('memory')));
    assert.ok(s.moreNavigationGroups.some(group => group.items.some(item => item.key === 'memory')));
  }
});
