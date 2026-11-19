import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './scope-transition-harness.mjs';

const text = node =>
  !node ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node);

function collectHosts(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    for (const item of node) collectHosts(item, out);
    return out;
  }
  out.push(node);
  collectHosts(node.props?.children, out);
  collectHosts(node.props?.header, out);
  collectHosts(node.props?.footer, out);
  collectHosts(node.props?.emptyState, out);
  return out;
}

function setup() {
  const calls = [];
  const action = name => (...args) => calls.push([name, ...args]);
  const theme = {
    colors: {
      canvas: '#F7FCFC', controlSurface: '#FFFFFE', quietSurface: '#EDFAF9', ink: '#272343',
      muted: '#2D334A', softLine: '#E6E6EA', line: '#CAC9D4', controlOutline: '#737284',
      accent: '#FFD803', onAccent: '#272343', warningInk: '#5E4F0C', errorInk: '#954026',
      paleTeal: '#E3F6F5', paleAmber: '#FFF7D8', selectedPressed: '#A8D0D4', statusWarmLine: '#A38B19',
    },
    spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, hero: 40 },
    radius: { small: 10, medium: 16, large: 22, pill: 999 },
    mobileLayout: { breakpoint: 650, touchTarget: 48 },
  };
  const native = {
    Platform: { OS: 'web', select: value => value.web ?? value.default },
    StyleSheet: { create: value => value, flatten: value => Object.assign({}, ...(Array.isArray(value) ? value : [value]).filter(Boolean)) },
    View: 'View',
    Pressable: 'Pressable',
    ScrollView: 'ScrollView',
    useWindowDimensions: () => ({ width: 1280, height: 800, fontScale: 1 }),
  };
  const dialog = Object.assign(({ visible, children, ...props }) => (visible ? { type: 'Dialog', props: { ...props, children } } : null), {
    Title: 'DialogTitle',
    Content: 'DialogContent',
    Actions: 'DialogActions',
    ScrollArea: 'DialogScrollArea',
  });
  const mocks = {
    'react-native': native,
    'react-native-paper': { Text: 'Text', Portal: ({ children }) => children },
    'expo-router': { usePathname: () => '/chat', useRouter: () => ({ push: action('route') }), useLocalSearchParams: () => ({}) },
    '../theme': theme,
    '../../theme': theme,
    '../components/appearance/BackgroundSurface': { BackgroundSurface: 'BackgroundSurface', useCustomBackground: () => false },
    '../components/ui': {
      AppButton: ({ label, onPress, disabled, testID }) => ({ type: 'AppButton', props: { label, onPress, disabled, testID } }),
      SectionCard: 'SectionCard',
    },
    '../components/AppDialog': { AppDialog: dialog },
    '../components/StatusAnnouncement': { StatusAnnouncement: 'StatusAnnouncement' },
    '../components/agent/AgentComposer': { AgentComposer: 'AgentComposer' },
    '../components/chat/ChatMessage': {
      ChatMessage: p => ({ type: 'ChatMessage', props: p }),
      ChatProgressIndicator: 'ChatProgressIndicator',
    },
    '../components/chat/ChatAction': {
      ChatAction: p => ({ type: 'ChatAction', props: p }),
    },
    '../components/chat/ChatTimeline': {
      ChatTimeline: ({ items = [], renderItem, footer, header, emptyState }) => {
        const renderedItems = items.map(renderItem);
        return {
          type: 'ChatTimeline',
          props: {
            items,
            footer,
            header,
            emptyState,
            renderedItems,
            children: [header, emptyState, ...renderedItems, footer],
          },
        };
      },
    },
    '../components/chat/locateCitationSource': { locateCitationSource() {} },
    '../components/chat/OfficialHelpCards': { OfficialHelpCards: 'OfficialHelpCards', ProgressSourceCards: 'ProgressSourceCards' },
    '../production/ChatFileMessage': { ChatFileMessage: 'ChatFileMessage' },
    '../production/RegisteredReadingCard': { RegisteredReadingCard: 'RegisteredReadingCard' },
    '../production/VoiceMessage': { VoiceMessage: 'VoiceMessage' },
    '../production/AgentConversation': { AgentConversation: 'AgentConversation' },
    '../production/AgentAuthorization': { AgentAuthorization: 'AgentAuthorization' },
    '../production/PhotoInputDomains': { AgentPhotoInput: 'AgentPhotoInput' },
    '../production/ChatPhotoMessage': { ChatPhotoMessage: 'ChatPhotoMessage' },
    '../production/NotificationChatTarget': { NotificationChatTarget: () => null },
    '../production/useChatExposure': { useChatExposure() {}, useChatForeground: () => true },
    '../preview/PreviewNavigationGuard': { PreviewLink: 'PreviewLink', usePreviewLeaveGuard() {}, usePreviewNavigation: () => fn => fn() },
  };

  const h = harness(mocks);
  const { default: ChatPage } = h.load('src/screens/chatScreen.tsx');
  const { ChatModeSwitch } = h.load('src/components/chat/ChatModeSwitch.tsx');

  const owner = {
    scopeKey: 'user:child-a',
    model: { selectedChildId: 'child-a', children: [{ id: 'child-a', displayName: '小晴' }] },
    actions: { open: action('open'), refresh: action('refresh') },
    owner: { agentOwner: { readChatEvidence: async () => {} } },
    chatState: {
      userId: 'user',
      selectedChildId: 'child-a',
      drafts: {},
      chatModes: {},
      modeSwitchedDuringReply: null,
      messages: [
        { id: 'm1', childId: 'child-a', authorUserId: 'user', role: 'user', text: '之前在助手的對話', inReplyTo: null, createdAt: '2026-10-01T00:00:00Z' },
      ],
      limit: 100,
      busy: null,
      online: true,
      loading: false,
      loadedAt: '2026-10-21T00:00:00Z',
      nextCursor: null,
      loadingOlder: false,
      error: null,
      feedback: null,
      remoteReply: null,
      replyingMessageId: null,
      cancelling: false,
      cancelAcceptedFor: undefined,
      replyError: null,
    },
    chatController: {
      loadOlderMessages: action('older'),
      reloadMessages: action('reload'),
      cancelReply: action('cancel'),
      setChatMode: mode => {
        calls.push(['setChatMode', mode]);
        owner.chatMode = mode;
        owner.chatState.chatModes = { ...owner.chatState.chatModes, 'child-a': mode };
      },
      confirmFoundMessage: action('confirm'),
      unlockCheckedSave: action('unlock'),
      startNewMessage: action('new'),
      dismissRetainedFeedback: action('dismiss'),
    },
    chatMode: 'assistant',
    setChatMode: mode => owner.chatController.setChatMode(mode),
    chatDraft: '未送出的草稿文字',
    setChatDraft: action('draft'),
    agentAttachments: [],
    addAgentAttachment: action('attach'),
    removeAgentAttachment: action('remove'),
    composerFocusRequest: 0,
    sendChat: action('send'),
    requestChatReply: action('reply'),
    agentRuns: {},
    agentModel: { readState: 'ready', run: null, pendingDecision: null },
    agentPending: { state: 'ready', entries: [] },
    readAgentPending: action('pending'),
    voiceUpload: {},
    fileUpload: {},
    photoUpload: {},
    checkVoiceUpload: action('checkVoice'),
    checkFileUpload: action('checkFile'),
    checkPhotoUpload: action('checkPhoto'),
    authorization: { pending: false },
    chatWritesAllowed: true,
    selectAgentRun: action('run'),
    openAgentSource: action('source'),
  };

  function renderPage() {
    h.production(owner);
    const hosts = h.render(h.jsx(ChatPage, {}));
    return {
      hosts,
      byId: id => hosts.find(node => node.props?.testID === id),
      all: () => collectHosts(hosts),
    };
  }

  return { h, owner, calls, renderPage, ChatModeSwitch };
}

test('1. chat mode switch defaults to assistant and manual switch preserves messages and draft', () => {
  const s = setup();
  let view = s.renderPage();

  const assistantOpt = view.byId('chat-mode-option-assistant');
  const chatOnlyOpt = view.byId('chat-mode-option-chat-only');
  assert.ok(view.byId('chat-mode-switch'));
  assert.equal(assistantOpt.props.accessibilityState.checked, true);
  assert.equal(chatOnlyOpt.props.accessibilityState.checked, false);
  assert.equal(view.byId('chat-mode-only-banner'), undefined);

  chatOnlyOpt.props.onPress();
  view = s.renderPage();
  assert.deepEqual(s.calls.find(c => c[0] === 'setChatMode'), ['setChatMode', 'chat_only']);
  assert.equal(view.byId('chat-mode-option-chat-only').props.accessibilityState.checked, true);
  assert.equal(s.owner.chatState.messages.length, 1);
  assert.equal(s.owner.chatDraft, '未送出的草稿文字');
});

test('2. chat_only mode displays clear status banner and one-tap switch back to assistant', () => {
  const s = setup();
  s.owner.chatMode = 'chat_only';
  s.owner.chatState.chatModes = { 'child-a': 'chat_only' };
  let view = s.renderPage();

  const banner = view.byId('chat-mode-only-banner');
  assert.ok(banner);
  assert.match(text(banner), /只是聊天.*不建立正式記錄/);

  const switchBackBtn = view.byId('chat-mode-switch-to-assistant');
  assert.ok(switchBackBtn);
  switchBackBtn.props.onPress();
  view = s.renderPage();
  assert.equal(s.owner.chatMode, 'assistant');
  assert.equal(view.byId('chat-mode-only-banner'), undefined);
});

test('3. chat_only mode hides assistant authorization prompts and renders zero auto-auth setup UI', () => {
  const s = setup();
  s.owner.authorization.pending = true;
  s.owner.chatMode = 'chat_only';
  s.owner.chatState.chatModes = { 'child-a': 'chat_only' };
  let view = s.renderPage();

  const pageTextChatOnly = text(view.all());
  assert.doesNotMatch(pageTextChatOnly, /助手設定的原操作待查核|前往查核/);
  assert.equal(view.hosts.some(node => node.type === 'AgentAuthorization'), false);

  s.owner.chatMode = 'assistant';
  s.owner.chatState.chatModes = { 'child-a': 'assistant' };
  view = s.renderPage();
  const pageTextAssistant = text(view.all());
  assert.match(pageTextAssistant, /助手設定的原操作待查核/);
});

test('4. timeline marks chat_only messages with mode badge while leaving assistant messages untagged', () => {
  const s = setup();
  s.owner.chatState.messages = [
    { id: 'msg-assistant', childId: 'child-a', authorUserId: 'user', role: 'user', text: '助手提問', chatMode: 'assistant', inReplyTo: null, createdAt: '2026-10-01T00:00:00Z' },
    { id: 'msg-chat-only', childId: 'child-a', authorUserId: 'user', role: 'user', text: '只是聊天提問', chatMode: 'chat_only', inReplyTo: null, createdAt: '2026-10-01T00:01:00Z' },
  ];
  const view = s.renderPage();
  const timeline = view.hosts.find(node => node.type === 'ChatTimeline');
  const renderedNodes = collectHosts(timeline.props.renderedItems);

  assert.equal(renderedNodes.some(n => n.props?.testID === 'chat-message-mode-msg-assistant'), false);
  const tag = renderedNodes.find(n => n.props?.testID === 'chat-message-mode-msg-chat-only');
  assert.ok(tag);
  assert.equal(text(tag), '只是聊天');
});

test('5. in-flight mode switch alert renders without hiding or disabling the stop-reply control', () => {
  const s = setup();
  s.owner.chatMode = 'chat_only';
  s.owner.chatState.busy = 'reply';
  s.owner.chatState.replyingMessageId = 'm1';
  s.owner.chatState.modeSwitchedDuringReply = { messageId: 'm1', from: 'assistant', to: 'chat_only' };

  const view = s.renderPage();
  const alert = view.byId('chat-mode-inflight-notice');
  assert.ok(alert);
  assert.equal(alert.props.accessibilityRole, 'alert');
  assert.match(text(alert), /後續新訊息生效.*不會假稱已撤回/);

  const composer = view.hosts.find(n => n.type === 'AgentComposer');
  assert.ok(composer);
  assert.equal(typeof composer.props.onStop, 'function');
  assert.equal(composer.props.stopDisabled, false);
  composer.props.onStop();
  assert.deepEqual(s.calls.at(-1), ['cancel']);
});
