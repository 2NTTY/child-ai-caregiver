import assert from 'node:assert/strict';
import test from 'node:test';
import { harness } from './scope-transition-harness.mjs';

// Actual chat components with synthetic owner snapshots and platform ports.
// Geometry, browser focus and device media permissions are not established here.
const flatten = value => Array.isArray(value) ? Object.assign({}, ...value.filter(Boolean).map(flatten)) : value || {};
const text = node => !node ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node);
function setup() {
  const native = { Platform: { OS: 'web', select: value => value.web ?? value.default }, StyleSheet: { create: value => value }, View: 'View', Pressable: 'Pressable', Image: 'Image', Keyboard: {}, useWindowDimensions: () => ({ width: 390 }) };
  const theme = { colors: { canvas: '#F7FCFC', controlSurface: '#FFFFFE', quietSurface: '#EDFAF9', ink: '#272343', muted: '#2D334A', softLine: '#E6E6EA', line: '#CAC9D4', accent: '#FFD803', onAccent: '#272343', warningInk: '#5E4F0C', errorInk: '#954026' }, spacing: { xs: 4, sm: 8, md: 12, lg: 16 }, radius: { pill: 99 }, mobileLayout: { breakpoint: 600, touchTarget: 48 } };
  const dialog = Object.assign(({ visible, children, ...props }) => visible ? { type: 'Dialog', props: { ...props, children } } : null,
    { Title: 'DialogTitle', Content: 'DialogContent', Actions: 'DialogActions', ScrollArea: 'DialogScrollArea' });
  const mocks = {
    'react-native': native, 'react-native-paper': { Portal: ({ children }) => children, Text: 'Text', ActivityIndicator: 'ActivityIndicator' },
    '../../theme': theme, '../theme': theme,
    '../AppDialog': { AppDialog: dialog }, '../components/AppDialog': { AppDialog: dialog },
    '../AppIcon': { AppIcon: 'Icon' }, '../AppScrollView': { AppScrollView: 'ScrollView' },
    './AssistantInputDialog': { AssistantInputDialog: 'InputDialog' },
    './VoiceCapture': { VoiceCapture: ({ ref, ...props }) => { ref.current = { start() {} }; return { type: 'VoiceCapture', props }; } },
    './ChatComposerInput': { ChatComposerInput: 'Input' },
    './LocalAudioPreview': { LocalAudioPreview: 'AudioPreview' },
    '../photos/PhotoFilePicker': { PhotoFilePicker: ({ renderTrigger, disabled }) => renderTrigger?.({ disabled, reading: false, onPress() {} }) },
    '../useInteractionDensity': { useInteractionDensity: () => false },
    '../../assistant-draft': { canPreviewAssistantDraft: ({ text }) => !!text.trim(), photoAttachment: value => value },
    '../../motion': { MotionDisclosure: ({ expanded, children }) => expanded ? children : null },
    './AnswerSources': { AnswerSources: ({ children }) => children, CitationText: 'CitationText' },
    '../production/AgentConversation': { AgentConversation: 'AgentConversation' },
    '../production/PhotoInputDomains': { AgentPhotoInput: 'AgentPhotoInput' },
    '../production/ChatFileMessage': { ChatFileMessage: 'FileMessage' },
    '../production/VoiceMessage': { VoiceMessage: 'VoiceMessage' },
    '../components/chat/OfficialHelpCards': { OfficialHelpCards: 'HelpCards' },
    '../components/chat/ChatTimeline': { ChatTimeline: 'ChatTimeline' },
    '../components/chat/locateCitationSource': { locateCitationSource() {} },
    '../preview/PreviewNavigationGuard': { usePreviewLeaveGuard() {}, usePreviewNavigation: () => action => action() },
    'expo-router': { usePathname: () => '/chat', useRouter: () => ({ push() {} }) },
  };
  const h = harness(mocks);
  const { AgentComposer } = h.load('src/components/agent/AgentComposer.tsx');
  const { ChatMessage, ChatProgressIndicator } = h.load('src/components/chat/ChatMessage.tsx');
  const { default: ChatPage } = h.load('src/screens/chatScreen.tsx');
  const button = label => h.hosts().find(node => node.props.accessibilityLabel === label || node.props.label === label);
  const baseProps = { enabled: true, compact: false, draft: '', attachments: [], onChangeDraft() {}, onPreview() {}, onSources() {}, onAddAttachment() { return true; }, onRemoveAttachment() {} };
  const renderComposer = props => h.render(h.jsx(AgentComposer, { ...baseProps, ...props }));
  return { h, theme, button, renderComposer, AgentComposer, ChatMessage, ChatProgressIndicator, ChatPage };
}
function production() {
  const calls = [];
  const action = name => (...args) => calls.push([name, ...args]);
  return { calls, scopeKey: 'synthetic-user:synthetic-child', model: { selectedChildId: 'child', children: [{ id: 'child' }] }, actions: { open: action('open'), refresh: action('refresh') },
    chatState: { userId: 'user', selectedChildId: 'child', drafts: {}, messages: [], busy: null, online: true, loading: false, loadedAt: '2026-10-21T00:00:00Z', limit: 20, nextCursor: null },
    chatController: { cancelReply: action('cancel'), reloadMessages: action('reload'), confirmFoundMessage: action('confirm'), unlockCheckedSave: action('unlock'), startNewMessage: action('new') },
    chatDraft: '', setChatDraft: action('draft'), agentAttachments: [], addAgentAttachment: action('attachment'), removeAgentAttachment: action('remove'), composerFocusRequest: 0, sendChat: action('send'), requestChatReply: action('reply'),
    agentRuns: {}, agentModel: { readState: 'ready', run: null, busy: null, pendingDecision: null }, agentPending: { state: 'ready', entries: [] }, readAgentPending: action('readPending'),
    voiceUpload: {}, fileUpload: {}, checkVoiceUpload: action('voiceCheck'), checkFileUpload: action('fileCheck'), authorization: {}, chatWritesAllowed: true, selectAgentRun: action('selectRun'), openAgentSource: action('source') };
}

test('the dock separates attachments from voice/send and preserves 320–1440 control budgets', () => {
  for (const width of [320, 390, 1024, 1440]) {
    const s = setup(); s.renderComposer({ compact: width < 600 });
    const left = s.h.node('composer-attachment-actions'), right = s.h.node('composer-send-actions');
    assert.ok(left); assert.ok(right);
    assert.equal(s.h.hosts().filter(node => node.props.accessibilityLabel === '語音輸入').length, 1);
    const toolbar = s.h.node('agent-input-toolbar');
    assert.equal(toolbar.props.children[2], null, 'voice is not duplicated in attachment controls');
    for (const label of ['拍照', '加入文件', '語音輸入', '預覽輸入']) {
      const control = s.button(label), style = flatten(control.props.style({}));
      assert.equal(style.width, width < 600 ? 48 : 40);
      assert.equal(style.height, width < 600 ? 48 : 40);
      assert.equal(style.borderWidth, 0);
    }
    const target = width < 600 ? 48 : 40;
    assert.ok(5 * target + 8 <= Math.min(width, 760) - (width < 600 ? 32 : 48) - 18);
  }
});

test('suggestions disappear in an established conversation; file/voice cancel preserve the draft', () => {
  const s = setup(); const changes = [], removed = [];
  s.renderComposer({ suggestionsAvailable: false, draft: '保留合成草稿', onChangeDraft: value => changes.push(value), onRemoveAttachment: id => removed.push(id) });
  assert.equal(s.h.node('composer-suggestions-toggle'), undefined);
  for (const label of ['加入文件', '語音輸入']) {
    s.button(label).props.onPress(); s.h.render();
    const modal = s.h.hosts().find(node => node.type === 'InputDialog');
    assert.equal(modal.props.kind, label === '加入文件' ? 'file' : null);
    if (label === '語音輸入') {
      const capture = s.h.hosts().find(node => node.type === 'VoiceCapture');
      assert.equal(capture.props.visible, true); capture.props.onDismiss();
    } else modal.props.onDismiss();
    s.h.render();
    assert.equal(s.h.hosts().find(node => node.type === 'InputDialog').props.kind, null);
    assert.equal(s.h.hosts().find(node => node.type === 'Input').props.value, '保留合成草稿');
  }
  assert.deepEqual(changes, []); assert.deepEqual(removed, []);
});

test('attachment removal uses the original callback and unknown locks all input controls', () => {
  const s = setup(), removed = [];
  const attachment = { id: 'synthetic-file', kind: 'file', fileName: 'synthetic.txt', bytes: 100, mimeType: 'text/plain' };
  s.renderComposer({ attachments: [attachment], onRemoveAttachment: id => removed.push(id) });
  s.button('移除附件：synthetic.txt').props.onPress(); assert.deepEqual(removed, ['synthetic-file']);
  s.renderComposer({ enabled: false, draft: '不可重送', attachments: [attachment] });
  for (const label of ['加入文件', '語音輸入', '預覽輸入', '移除附件：synthetic.txt']) assert.equal(s.button(label).props.disabled, true);
  assert.equal(s.h.hosts().find(node => node.type === 'Input').props.disabled, true);
});

test('an explicit focus request is consumed once rather than repeated after busy becomes enabled', () => {
  const s = setup(), frames = new Map(); let next = 0, focused = 0;
  const oldRequest = globalThis.requestAnimationFrame, oldCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = fn => { frames.set(++next, fn); return next; };
  globalThis.cancelAnimationFrame = id => frames.delete(id);
  try {
    s.renderComposer({ focusRequest: 1 });
    s.h.hosts().find(node => node.type === 'Input').props.ref.current.focus = () => focused++;
    for (const fn of frames.values()) fn(); frames.clear(); assert.equal(focused, 1);
    s.renderComposer({ focusRequest: 1, enabled: false }); s.renderComposer({ focusRequest: 1 });
    assert.equal(frames.size, 0);
    s.renderComposer({ focusRequest: 2 }); for (const fn of frames.values()) fn();
    assert.equal(focused, 2);
  } finally { globalThis.requestAnimationFrame = oldRequest; globalThis.cancelAnimationFrame = oldCancel; }
});

test('ordinary status is a quiet row while failure, unknown and original recovery remain reachable', () => {
  const s = setup(), p = production(); s.h.production(p);
  const render = () => s.h.render(s.h.jsx(s.ChatPage, {}));
  // Render the timeline footer through the real components in this bounded harness.
  const footer = () => { const timeline = s.h.hosts().find(node => node.type === 'ChatTimeline'); s.h.render(timeline.props.footer); };
  p.chatState.busy = 'reply'; p.chatState.feedback = { phase: 'reading', cards: [] };
  render(); footer(); assert.ok(s.h.node('chat-operation-status'));
  assert.match(s.h.hosts().map(text).join(''), /正在讀取相關資料/);
  s.button('停止回覆').props.onPress(); assert.deepEqual(p.calls.at(-1), ['cancel']);
  p.chatState.busy = null; p.chatState.drafts.child = { phase: 'save_unknown', notice: '合成保存結果未知' };
  p.fileUpload = { unknown: true, notice: '合成原檔待核對' };
  render(); footer(); s.button('查核原檔案上傳').props.onPress(); assert.deepEqual(p.calls.at(-1), ['fileCheck']);
  s.button('重新讀取並查核原保存').props.onPress(); assert.deepEqual(p.calls.at(-1), ['reload']);
  assert.ok(s.h.hosts().some(node => node.props.accessibilityRole === 'alert' && text(node).includes('未知')));
  p.chatState.drafts.child = { phase: 'reply_failed', savedUserMessageId: 'original-user-message' };
  render(); footer(); s.button('重試原訊息回覆').props.onPress(); assert.deepEqual(p.calls.at(-1), ['reply', 'original-user-message']);
});

test('message actions are outside the user bubble and reduced motion uses a stationary status', () => {
  const s = setup();
  s.h.render(s.h.jsx(s.ChatMessage, { message: { id: 'user-1', role: 'user', text: '合成問題' }, footer: s.h.jsx('Button', { label: '查核原回覆' }) }));
  assert.ok(s.h.node('chat-message-actions'));
  const row = s.h.node('chat-message');
  assert.equal(row.props.children.length, 2);
  assert.notEqual(row.props.children[0], s.h.node('chat-message-actions'));
  s.h.render(s.h.jsx(s.ChatProgressIndicator, {})); assert.ok(s.h.hosts().some(node => node.type === 'ActivityIndicator'));
  s.h.reduce(); s.h.render(); assert.ok(s.h.node('chat-progress-static'));
  assert.equal(s.h.hosts().some(node => node.type === 'ActivityIndicator'), false);
});
