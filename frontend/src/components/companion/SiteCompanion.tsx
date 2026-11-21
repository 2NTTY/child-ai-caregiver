import { useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { usePathname } from 'expo-router';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { chatDraftIsSubmitted } from '../../../../src/client/chat-controller';
import { useChatExposure, useChatForeground } from '../../production/useChatExposure';
import { assistantPages, sameChatPageContext, type ChatPageContext } from '../../../../src/shared/chat-page-context';
import { useProduction } from '../../production/ProductionProvider';
import { colors } from '../../theme';
import { ChatComposerInput, type ChatComposerInputHandle } from '../agent/ChatComposerInput';
import { VoiceCapture } from '../agent/VoiceCapture';
import type { VoiceCaptureHandle } from '../agent/VoiceRecordingTimer';
import type { AssistantAttachment } from '../../assistant-draft';
import { ChatAction } from '../chat/ChatAction';
import { failedChatReply } from '../chat/failed-reply';
import { chatReplyActivity, chatTurnStatus, privateChatChildName } from '../chat/chat-turn-status';
import { ChatTurnStatusLine } from '../chat/ChatTurnStatusLine';
import { CharacterDock } from './CharacterDock';
import { AppButton } from '../ui';
import { useCompanionSelection } from './CompanionSelection';
function characterSource(apiBaseUrl: string) {
  return Platform.OS === 'web' ? '/companion/zundamon.html' : new URL('/companion/zundamon.html', apiBaseUrl).href;
}

type Panel = { page: string; scope: string | null; chosenChild?: string; privateChild?: string; includeItem: boolean; reminderId?: string;
  voice?: { item?: ChatPageContext['item']; label?: string }; focus?: boolean };

export function SiteCompanion({ authorised, visible }: { authorised: boolean; visible: boolean }) {
  const pathname = usePathname(), foreground = useChatForeground();
  const { apiBaseUrl, scopeKey, sharedChild, selectedChildId, chatState, online, chatWritesAllowed,
    agentAttachments, voiceUpload, fileUpload, photoUpload, chatDraft } = useProduction();
  const childId = !sharedChild.target && scopeKey && selectedChildId === chatState.selectedChildId ? selectedChildId : null;
  const scope = scopeKey ?? (sharedChild.target ? JSON.stringify(sharedChild.target) : null);
  const unread = childId && online && !chatState.error ? chatState.messages.find(m => m.childId === childId && m.proactive && m.proactiveUnread === true)?.id : undefined;
  const editable = !!childId && chatWritesAllowed && chatState.online && !chatState.busy && !chatReplyActivity(chatState).activeReplyId
    && !!chatState.loadedAt && !chatState.loading && (chatState.drafts[childId]?.phase ?? 'draft') === 'draft'
    && ![voiceUpload, fileUpload, photoUpload].some(u => u.busy || u.unknown);
  const canRecord = editable && assistantPages.some(page => page === pathname) && !agentAttachments.length && chatDraft.length <= 10_000;
  const [panel, setPanel] = useState<Panel | null>(null);
  const voice = useRef<VoiceCaptureHandle>(null);
  const selection = useCompanionSelection();
  const quiet = pathname === '/chat';
  const open = authorised && visible && !quiet && panel?.page === pathname && panel.scope === scope &&
    (!panel.privateChild || panel.privateChild === childId);
  useLayoutEffect(() => {
    setPanel(current => {
      if (!visible || !authorised || !current || current.page !== pathname || (current.privateChild && current.privateChild !== childId)) return null;
      if (current.scope === scope) return current;
      // Only the explicitly chosen private conversation may follow a scope switch.
      if (current.chosenChild && !sharedChild.target && current.chosenChild === selectedChildId)
        return { page: pathname, scope, includeItem: false, privateChild: childId ?? undefined };
      return null;
    });
  }, [visible, authorised, pathname, scope, childId, selectedChildId, sharedChild.target]);
  const close = () => { if (open && panel.voice) voice.current?.cancel(); setPanel(null); };
  function show(record = false) {
    const start = record && !!voice.current;
    const includeItem = open ? panel.includeItem : !!childId;
    const selected = includeItem && selection?.page === pathname && selection.childId === childId ? selection : null;
    setPanel({ page: pathname, scope, privateChild: childId ?? undefined, includeItem, reminderId: unread || undefined,
      voice: start ? { item: selected?.item, label: selected?.label } : undefined, focus: !record });
    if (start) voice.current?.start();
  }
  return <CharacterDock src={characterSource(apiBaseUrl)} page={pathname} unread={unread || undefined} foreground={foreground && visible} panelOpen={open} inToolbar={quiet}
    detailOpen={selection?.page === pathname && selection.childId === childId}
    onChat={() => open ? close() : show()} onCollapse={close}
    onVoice={childId && !canRecord || open && panel.voice ? undefined : () => show(true)}>
    {authorised && visible && !quiet && childId
      ? <QuickConversation key={JSON.stringify([pathname, scope, childId])} page={pathname} childId={childId} panel={open ? panel : null}
          editable={editable} canRecord={canRecord} voice={voice} endVoice={() => setPanel(p => p && { ...p, voice: undefined, focus: false })} close={close} />
      : open && <ConversationChoices close={close} onChoose={chosenChild => setPanel({ page: pathname, scope, chosenChild, includeItem: false })} />}
  </CharacterDock>;
}

function ConversationChoices({ close, onChoose }: { close(): void; onChoose(id: string): void }) {
  const { recordsState, controller, actions, sharedChild, owner, online } = useProduction();
  const { children, childrenLoading, childrenLoadedAt, childrenError, deletion } = recordsState;
  const verified = online && !!childrenLoadedAt && !childrenLoading && !childrenError;
  const selectable = verified && !deletion && !recordsState.busy && recordsState.childOutcome !== 'unknown'
    && recordsState.childOutcome !== 'checked' && owner.canStartDomainWrite();
  function choose(id: string) {
    onChoose(id);
    if (!sharedChild.target && id === recordsState.selectedChildId) actions.refresh();
    else actions.selectChild(id);
  }
  return <View accessibilityLabel="選擇私人對話" style={styles.chooser}>
    <Text variant="titleMedium">選擇私人對話</Text>
    {verified && children.length > 0 ? <>
      <Text>{sharedChild.target ? '選擇後，本頁會切換到該孩子的私人空間。共享項目會留在原空間。' : '選擇孩子後，可在本頁繼續對話。'}</Text>
      <ScrollView style={{ maxHeight: 220 }}>{children.map(child =>
        <AppButton key={child.id} variant="secondary" disabled={!selectable} label={child.displayName + '的私人對話'}
          onPress={() => choose(child.id)} />)}</ScrollView>
      {!selectable && <Text>請待目前操作完成後再選擇。</Text>}
    </> : verified ? <>
      <Text>目前沒有可用的私人對話。你可以先建立孩子檔案。</Text>
      <AppButton variant="secondary" label="前往新增孩子" onPress={() => { close(); actions.open('guide'); }} />
    </> : <>
      <Text>{!online ? '恢復連線後可核對私人對話。' : childrenLoading ? '正在讀取可用的私人對話…' : '孩子名單尚待核對。'}</Text>
      <AppButton variant="secondary" label="重新讀取孩子名單" disabled={!online || childrenLoading} onPress={() => void controller.reloadChildren()} />
    </>}
    <AppButton variant="quiet" label="收起" onPress={close} />
  </View>;
}

function QuickConversation({ page, childId, panel, editable, canRecord, voice, endVoice, close }: {
  page: string; childId: string; panel: Panel | null; editable: boolean; canRecord: boolean; voice: RefObject<VoiceCaptureHandle | null>; endVoice(): void; close(): void;
}) {
  const { chatState: chat, chatDraft, setChatDraft, agentAttachments, addAgentAttachment, removeAgentAttachment, sendChat,
    chatController, chatWritesAllowed, voiceUpload, fileUpload, photoUpload, openAgentDraft, agentRuns, recordsState } = useProduction();
  const selected = useCompanionSelection();
  const currentItem = panel?.includeItem && selected?.page === page && selected.childId === childId ? selected.item : undefined;
  const item = panel?.voice ? panel.voice.item : currentItem;
  const draft = chat.drafts[childId], phase = draft?.phase ?? 'draft';
  const beforeSend = useRef<Set<string> | null>(null), sending = useRef(false);
  const activity = chatReplyActivity(chat);
  const activeReply = activity.activeReplyId;
  const targetId = activeReply ?? draft?.savedUserMessageId;
  const outgoing = chat.outgoing?.childId === childId ? chat.outgoing : undefined;
  const question = panel && !outgoing ? [...chat.messages].reverse().find(m => m.childId === childId && m.role === 'user' && !m.discussionOf
    && (targetId ? m.id === targetId : beforeSend.current && !beforeSend.current.has(m.id))) : undefined;
  const reply = question && [...chat.messages].reverse().find(m => m.childId === childId && m.role === 'model' && m.inReplyTo === question.id);
  const reason = reply && failedChatReply(reply.text, reply.agentRunId ? agentRuns[reply.agentRunId]?.stopReasonLabel : undefined);
  const submitted = chatDraftIsSubmitted(chat, draft);
  const upload = [voiceUpload, fileUpload, photoUpload].find(u => u.busy || u.unknown || u.notice);
  const reminder = panel?.reminderId ? chat.messages.find(m => m.id === panel.reminderId && m.childId === childId && m.proactive) : undefined;
  const [exposed, setExposed] = useState(false);
  const foreground = useChatForeground();
  const exposedIds = useMemo(() => exposed && reminder && !question && !outgoing && !panel?.voice ? [reminder.id] : [], [exposed, reminder?.id, question?.id, outgoing, panel?.voice]);
  useChatExposure(foreground && exposed, exposedIds);
  const validPage = assistantPages.find(p => p === page);
  const pageContext: ChatPageContext | undefined = validPage ? { page: validPage, ...(item ? { item } : {}) } : undefined;
  useLayoutEffect(() => { if (!panel) setExposed(false); }, [panel]);
  async function send(recording?: AssistantAttachment) {
    if (!editable || !pageContext || !panel || sending.current) { recording?.dispose?.(); return; }
    if (recording && !addAgentAttachment(recording)) return;
    sending.current = true;
    beforeSend.current = new Set(chat.messages.map(message => message.id));
    try { await sendChat({ pageContext }); } finally { sending.current = false; }
  }
  const composerText = submitted ? draft?.nextText ?? '' : chatDraft;
  const queued = !!activeReply && chat.queuedText?.afterMessageId === activeReply;
  const canQueue = !!pageContext && chatWritesAllowed && chat.online && !chat.cancelling && !chat.cancelAcceptedFor
    && chat.busy === 'reply' && phase === 'replying' && !!activeReply && draft?.savedUserMessageId === activeReply
    && !!composerText.trim() && composerText.length <= 10_000;
  const turnStatus = chatTurnStatus(chat, draft, activity, reason && question ? { questionId: question.id, reason: reason.reason } : undefined, chatWritesAllowed);
  const notice = upload?.notice || chat.error;
  const childName = privateChatChildName(recordsState.children, childId, panel?.includeItem === false);
  const needsRecovery = phase === 'save_unknown' || phase === 'checked' || upload?.unknown || phase === 'reply_failed';
  const openFull = () => { close(); openAgentDraft(); };
  const recording = !!panel?.voice;
  useLayoutEffect(() => {
    // A refresh can briefly unmount the detail. Keep its original reference and local audio.
    if (recording && currentItem && validPage && !sameChatPageContext({ page: validPage, item: currentItem }, pageContext)) {
      voice.current?.cancel(); endVoice();
    }
  }, [recording, currentItem, validPage, pageContext, voice, endVoice]);
  const canSend = editable && !!validPage && (!!chatDraft.trim() || !!agentAttachments.length) && chatDraft.length <= 10_000;
  const canType = !!outgoing || chatWritesAllowed && (submitted || phase === 'draft' && chat.online && !!chat.loadedAt && chat.busy !== 'save' && !upload?.unknown);
  const input = useRef<ChatComposerInputHandle>(null), focusedPanel = useRef<Panel | null>(null);
  useLayoutEffect(() => {
    if (!input.current?.focus || !panel || !canType || recording || panel.focus === false || panel === focusedPanel.current) return;
    const frame = requestAnimationFrame(() => { input.current?.focus({ preventScroll: true }); focusedPanel.current = panel; });
    return () => cancelAnimationFrame(frame);
  }, [panel, canType, recording]);
  const submit = () => {
    if (canQueue) { if (queued) chatController.unqueueNextText(); else chatController.queueNextText(pageContext); }
    else if (canSend) void send();
  };
  const speech = reason?.body || (!reason && reply?.text);
  const showBubble = !!(outgoing || reminder || question || turnStatus || notice || needsRecovery);
  const itemLabel = item && (({ task: '待辦', record: '記錄', document: '文件' })[item.kind] + ' · ' + ((recording ? panel?.voice?.label : selected?.label) || '目前選取的項目'));
  return <>
    {panel && !recording && showBubble && <View testID="companion-turn" style={styles.bubble}>
      {reminder && !question && !outgoing && <View testID="companion-reminder" onLayout={() => setExposed(true)}>
        <Text style={styles.context}>助手提醒</Text><Text numberOfLines={3} style={styles.body}>{reminder.text}</Text></View>}
      {outgoing ? <Text testID="companion-outgoing" numberOfLines={2} style={styles.context}>{[outgoing.attachmentLabel, outgoing.text].filter(Boolean).join(' · ')}</Text>
        : question && !reply && <Text numberOfLines={1} style={styles.context}>{question.text || (question.voice ? '你的語音訊息' : '你的附件')}</Text>}
      {!!reason && <Text accessibilityRole="alert" numberOfLines={2} style={styles.warning}>{reason.reason}</Text>}
      {!!speech && <Text numberOfLines={4} selectable style={styles.body}>{speech}</Text>}
      {turnStatus && turnStatus.text !== notice && <ChatTurnStatusLine status={turnStatus} />}
      {!!notice && <Text accessibilityRole="alert" numberOfLines={2} style={styles.warning}>{notice}</Text>}
      {(reply || reminder || needsRecovery) && <ChatAction label={needsRecovery ? '查核原訊息' : '閱讀完整回覆'}
        accessibilityLabel={needsRecovery ? '在完整對話查核原訊息' : '在助手頁閱讀完整回覆'} onPress={openFull} icon="arrow-right" subtle />}
    </View>}
    {panel && !recording && <View testID="companion-entry" style={styles.entry}>
      {(itemLabel || childName && composerText) ? <Text style={styles.context} numberOfLines={1}>{[childName, itemLabel].filter(Boolean).join(' · ')}</Text> : null}
      {!submitted && agentAttachments.map(a => <View key={a.id} style={styles.row}>
        <Text numberOfLines={1} style={[styles.context, styles.input]}>{a.fileName}</Text>
        <ChatAction label="移除附件" onPress={() => removeAgentAttachment(a.id)} disabled={!editable} icon="close" iconOnly /></View>)}
      <View style={styles.row}><View style={styles.input}>
        <ChatComposerInput ref={input} disabled={!canType} value={composerText} placeholder={childName ? `問關於${childName}的事…` : '問小助手…'}
          onChangeText={setChatDraft} onSubmit={submit} canSubmit={canQueue || canSend} /></View>
        {activeReply && <ChatAction label="停止回覆" disabled={chat.cancelling || !!chat.cancelAcceptedFor || !chat.online}
          onPress={() => void chatController.cancelReply()} icon="checkbox-blank-outline" iconOnly />}
        {(!activeReply || canQueue) &&
          <ChatAction label={canQueue ? queued ? '取消排隊' : '排隊送出' : '送出'} disabled={!canSend && !canQueue} onPress={submit}
            icon={queued ? 'close' : 'arrow-up'} iconOnly />}
      </View>
    </View>}
    {(canRecord || recording) && <View style={recording ? styles.voice : undefined} pointerEvents={recording ? 'auto' : 'none'}>
      {recording && !!chatDraft.trim() && <Text numberOfLines={1} style={styles.context}>{chatDraft}</Text>}
      <VoiceCapture ref={voice} visible={recording} sendRecording confirmDisabled={!canRecord} onDismiss={endVoice} onPick={a => void send(a)} />
    </View>}
  </>;
}
const styles = StyleSheet.create({
  chooser: { gap: 8, backgroundColor: colors.white, borderRadius: 16, padding: 12, borderWidth: 1, borderColor: colors.line },
  bubble: { backgroundColor: colors.white, borderColor: colors.line, borderWidth: 1, borderRadius: 18, borderBottomLeftRadius: 6,
    paddingHorizontal: 13, paddingVertical: 8, gap: 3, shadowColor: colors.ink, shadowOffset: { width: 0, height: 2 }, shadowRadius: 5, shadowOpacity: .1, elevation: 2 },
  entry: { backgroundColor: colors.white, borderColor: colors.sage, borderWidth: 1, borderRadius: 20, paddingHorizontal: 7,
    shadowColor: colors.ink, shadowOffset: { width: 0, height: 2 }, shadowRadius: 5, shadowOpacity: .12, elevation: 2 },
  voice: { backgroundColor: colors.white, borderColor: colors.line, borderWidth: 1, borderRadius: 24, paddingHorizontal: 8 },
  row: { flexDirection: 'row', alignItems: 'center' }, input: { flex: 1, minWidth: 0 },
  body: { color: colors.ink, fontSize: 15, lineHeight: 22 }, warning: { color: colors.warningInk, fontSize: 13, lineHeight: 19 },
  context: { color: colors.muted, fontSize: 12, lineHeight: 18 },
});
