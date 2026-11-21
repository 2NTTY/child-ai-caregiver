import assert from 'node:assert/strict';
import test from 'node:test';
import { CHAT_REPLY_ERROR_COPY } from '../../src/client/chat-controller.ts';
import { chatReplyActivity, chatTurnStatus, privateChatChildName } from '../src/components/chat/chat-turn-status.ts';
import { harness } from './scope-transition-harness.mjs';

const question = 'question';
const replying = { messages: [], busy: 'reply', replyingMessageId: question };
const savedDraft = { phase: 'replying', savedUserMessageId: question, notice: '聊天已保存，正在等候 AI 回覆。' };
const line = (chat, draft, failure) => chatTurnStatus(chat, draft, chatReplyActivity(chat), failure);

test('one line follows the original question through save, progress, stopping and completion', () => {
  assert.equal(line({ messages: [], busy: 'save' }, savedDraft), null);
  assert.deepEqual(line(replying, savedDraft), { kind: 'progress', text: '正在回覆…' });
  const reading = { ...replying, feedback: { messageId: question, phase: 'reading' } };
  assert.equal(line(reading, savedDraft).text, '正在讀取相關資料');
  assert.equal(line({ ...reading, feedback: { messageId: 'older', phase: 'reading' } }, savedDraft).text, '正在回覆…');
  assert.equal(line({ ...reading, cancelAcceptedFor: question }, savedDraft).text, '正在停止…');
  const recovered = { messages: [], remoteReply: { status: 'running', messageId: question } };
  assert.equal(line(recovered).text, '正在回覆…');
  assert.equal(line({ ...recovered, messages: [{ role: 'model', inReplyTo: question }] }), null);
  assert.equal(line({ messages: [] }, { phase: 'draft', text: '', notice: '已確認聊天訊息及 AI 回覆。' }), null);
});

test('the matching saved failure speaks on its own row and other failures or uncertain saves stay visible', () => {
  const error = '這次回覆未完成，請查核原結果。';
  const draft = { ...savedDraft, phase: 'reply_failed', notice: error };
  const failed = { messages: [], replyError: error, remoteReply: { messageId: question, status: 'stopped' } };
  const row = { questionId: question, reason: '回覆核對未完成' };
  assert.equal(line(failed, draft, row), null);
  assert.equal(line(failed, draft, { ...row, questionId: 'other' }).text, error);
  assert.equal(line({ ...failed, replyError: CHAT_REPLY_ERROR_COPY.ai_busy }, draft).text, '助手忙碌，請稍後再試。');
  assert.equal(line({ ...replying, cancelNotice: '較早的停止要求' }, { phase: 'save_unknown', notice: '原保存結果待確認' }).text, '原保存結果待確認');
  assert.equal(line({ ...replying, cancelNotice: '未能確認停止要求' }, savedDraft).text, '未能確認停止要求');
});

test('child names disambiguate multiple or explicitly chosen private conversations', () => {
  const child = { id: 'a', displayName: '小晴' };
  assert.equal(privateChatChildName([child], 'a'), undefined);
  assert.equal(privateChatChildName([child], 'a', true), '小晴');
  assert.equal(privateChatChildName([child, { id: 'b', displayName: '阿樂' }], 'a'), '小晴');
  assert.equal(privateChatChildName([child], 'other', true), undefined);
});

function companionHarness(overrides = {}) {
  const h = harness({
    'react-native': { View: 'View', ScrollView: 'ScrollView', Platform: { OS: 'web' },
      StyleSheet: { create: value => value }, useWindowDimensions: () => ({ width: 390 }) },
    '../../theme': { colors: {}, mobileLayout: { breakpoint: 650 } },
    '../../production/useChatExposure': { useChatExposure() {}, useChatForeground: () => true },
    '../chat/chat-turn-status': { chatReplyActivity, chatTurnStatus, privateChatChildName },
    '../chat/ChatTurnStatusLine': { ChatTurnStatusLine: 'TurnStatus' },
    '../chat/ChatAction': { ChatAction: 'Action' }, '../agent/VoiceCapture': { VoiceCapture: 'Voice' },
    '../agent/ChatComposerInput': { ChatComposerInput: 'Input' },
    './CompanionSelection': { useCompanionSelection: () => undefined },
    './CharacterDock': { CharacterDock: 'Dock' },
    ...overrides,
  });
  const { SiteCompanion } = h.load('src/components/companion/SiteCompanion.tsx');
  const chat = { selectedChildId: 'child', drafts: {}, messages: [], online: true };
  h.production({ chatState: chat, selectedChildId: 'child', scopeKey: 'private', sharedChild: {},
    chatDraft: '', agentAttachments: [], agentRuns: {}, recordsState: { children: [{ id: 'child', displayName: '小晴' }] },
    chatWritesAllowed: true, voiceUpload: {}, photoUpload: {}, fileUpload: {} });
  h.route('/tasks'); h.render(h.jsx(SiteCompanion, {authorised:true,visible:true}));
  return { h, chat };
}

test('the single-child companion replaces the waiting line with the saved failure and one original-message action', () => {
  const { h, chat } = companionHarness();
  h.hosts().find(node => node.type === 'Dock').props.onChat(); h.render();
  const ask = { id: question, childId: 'child', role: 'user', text: '你是誰' };
  Object.assign(chat, replying, { messages: [ask], drafts: { child: savedDraft } });
  h.render();
  const statuses = () => h.hosts().filter(node => node.type === 'TurnStatus').map(node => node.props.status.text);
  const copy = () => h.hosts().filter(node => node.type === 'Text').flatMap(node => [node.props.children].flat()).filter(value => typeof value === 'string').join('');
  assert.deepEqual(statuses(), ['正在回覆…']); assert.doesNotMatch(copy(), /私人對話|小晴|等候 AI 回覆|想問甚麼/);
  chat.feedback = { messageId: question, phase: 'reading' }; h.render();
  assert.deepEqual(statuses(), ['正在讀取相關資料']);
  chat.messages.push({ id:'reply', childId:'child', role:'model', inReplyTo:question, text:'這次回覆未完成：服務暫時未能使用。' });
  chat.busy = null; chat.replyingMessageId = null; chat.replyError = '這次回覆未完成，請查核原結果。';
  chat.drafts.child = { ...savedDraft, phase:'reply_failed', notice:chat.replyError }; h.render();
  assert.deepEqual(statuses(), []);
  assert.equal(copy().split('服務暫時未能使用').length - 1, 1);
  assert.doesNotMatch(copy(), /這次回覆未完成，請查核原結果/);
  assert.deepEqual(h.hosts().filter(node => node.type === 'Action').map(node => node.props.label), ['查核原訊息', '送出']);
});

test('refreshing the selected detail preserves a local voice preview and its original item until explicit send', () => {
  const original = { kind: 'task', id: 'saved-task', version: 3 };
  let selected = { page: '/tasks', childId: 'child', item: original, label: '公園觀察小袋' };
  const sends = [];
  let starts = 0, cancels = 0, adopted = 0;
  const { h, chat } = companionHarness({
    './CompanionSelection': { useCompanionSelection: () => selected },
    '../agent/VoiceCapture': { VoiceCapture: props => {
      props.ref.current = { start() { starts++; }, cancel() { cancels++; } };
      return { type: 'Capture', props };
    } },
  });
  chat.loadedAt = 'ready';
  h.production({ chatState: chat, selectedChildId: 'child', scopeKey: 'private', sharedChild: {}, chatWritesAllowed: true,
    chatDraft: '', agentAttachments: [], agentRuns: {}, recordsState: { children: [] }, voiceUpload: {}, photoUpload: {}, fileUpload: {},
    addAgentAttachment() { adopted++; return true; }, sendChat: async options => { sends.push(options); } });
  h.render();
  const control = name => h.hosts().find(node => node.type === name).props;
  control('Dock').onVoice(); h.render();
  assert.equal(starts, 1); assert.equal(control('Capture').visible, true);
  chat.loading = true; selected = null; h.render();
  assert.equal(control('Capture').visible, true); assert.equal(control('Capture').confirmDisabled, true);
  chat.loading = false; h.render();
  const pick = control('Capture').onPick;
  pick({ kind: 'voice', id: 'local' }); pick({ kind: 'voice', id: 'local' });
  assert.equal(adopted, 1); assert.deepEqual(sends, [{ pageContext: { page: '/tasks', item: original } }]);
  selected = { page: '/tasks', childId: 'child', item: { ...original, version: 4 } }; h.render();
  assert.equal(cancels, 1); assert.equal(control('Capture').visible, false);
});
