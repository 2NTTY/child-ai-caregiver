import { useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { usePathname } from 'expo-router';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
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
import { AppIcon } from '../AppIcon';
import { DialoguePlacement, DialogueSlot } from './DialoguePlacement';
import type { CharacterAction } from './CharacterFrame';
import { CharacterDock } from './CharacterDock';
import { AppButton } from '../ui';
import { useCompanionSelection } from './CompanionSelection';
function characterSource(apiBaseUrl: string) {
  return Platform.OS === 'web' ? '/companion/zundamon.html' : new URL('/companion/zundamon.html', apiBaseUrl).href;
}

const completedNotices = new Set(['聊天已保存，AI 已回覆。', '已在聊天記錄找到 AI 回覆。', '已查回原回覆，沒有重新執行。', '已確認聊天訊息及 AI 回覆。']);

type Panel = { page: string; scope: string | null; chosenChild?: string; privateChild?: string; includeItem: boolean; reminderId?: string;
  voice?: { item?: ChatPageContext['item']; label?: string }; focus?: boolean };

export function SiteCompanion({ authorised, visible, bounds }: { authorised: boolean; visible: boolean; bounds: { width: number; height: number } }) {
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
  const [listening, setListening] = useState(false);
  const [performance, setPerformance] = useState<{ action: CharacterAction; serial: number }>({ action: 'nod', serial: 0 });
  const perform = useCallback((action: CharacterAction) => setPerformance(previous => ({ action, serial: previous.serial + 1 })), []);
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
  return <CharacterDock bounds={bounds} src={characterSource(apiBaseUrl)} page={pathname} unread={unread || undefined} foreground={foreground && visible} panelOpen={open} inToolbar={quiet}
    listening={!!(open && panel.voice && listening)} performance={performance}
    onChat={() => open ? close() : show()} onCollapse={close}
    onVoice={childId && !canRecord || open && panel.voice ? undefined : () => show(true)}>
    {authorised && visible && !quiet && childId
      ? <QuickConversation key={JSON.stringify([pathname, scope, childId])} page={pathname} childId={childId} panel={open ? panel : null}
          editable={editable} startVoice={() => show(true)} perform={perform} onListening={setListening} canRecord={canRecord} voice={voice} endVoice={() => setPanel(p => p && { ...p, voice: undefined, focus: false })} close={close} />
      : open && <DialogueSlot chooser><ConversationChoices close={close} onChoose={chosenChild => setPanel({ page: pathname, scope, chosenChild, includeItem: false })} /></DialogueSlot>}
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

function QuickConversation({ page, childId, panel, editable, canRecord, voice, endVoice, startVoice, perform, onListening, close }: {
  startVoice(): void; perform(action: CharacterAction): void; onListening(active: boolean): void;
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
    perform('acknowledge');
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
    else if (canSend) { void send(); input.current?.focus?.({ preventScroll: true }); }
  };
  const speech = reason?.body || (!reason && reply?.text) || (!question && !outgoing && reminder?.text) || '';
  const spokenReply = panel && !recording && !reason && reply?.id;
  const lastReply = useRef<string | undefined>(undefined);
  useLayoutEffect(() => {
    if (spokenReply && spokenReply !== lastReply.current) { lastReply.current = spokenReply; perform('answer'); }
  }, [spokenReply, perform]);
  const { leftOfFace, sideRoom } = useContext(DialoguePlacement);
  const [focused, setFocused] = useState(false);
  const paragraph = speech.trim().split(/\n\s*\n/u)[0];
  const budget = Math.max(18, Math.floor((Math.min(248, sideRoom) - 22) / 15) * 3);
  const opening = paragraph.slice(0, budget).match(/^[\s\S]*[。！？!?]/u)?.[0];
  const preview = paragraph.length > budget && opening ? opening : paragraph;
  const long = speech !== preview || preview.length > budget || preview.split('\n').length > 3;
  const progress = turnStatus?.kind === 'progress' ? turnStatus.text : outgoing ? '正在傳送…' : undefined;
  const waiting = !!progress && !speech && !reason && !notice && !needsRecovery;
  const showBubble = !!(speech || reason || progress || turnStatus || notice || needsRecovery);
  const itemLabel = item && (({ task: '待辦', record: '記錄', document: '文件' })[item.kind] + ' · ' + ((recording ? panel?.voice?.label : selected?.label) || '目前選取的項目'));
  const hasContent = !!composerText.trim() || !submitted && !!agentAttachments.length;
  const sendLabel = canQueue ? queued ? '取消排隊' : '排隊送出' : '送出';
  const stop = !!activeReply && !canQueue;
  const label = stop ? '停止回覆' : hasContent ? sendLabel : '錄製語音訊息';
  const disabled = stop ? chat.cancelling || !!chat.cancelAcceptedFor || !chat.online : hasContent ? !canSend && !canQueue : !canRecord;
  return <>
    {panel && outgoing && <Text testID="companion-outgoing" accessibilityLiveRegion="polite" style={styles.screenReader}>
      {[outgoing.attachmentLabel, outgoing.text].filter(Boolean).join(' · ')}</Text>}
    {panel && !recording && showBubble && <DialogueSlot speech><View testID="companion-turn" style={styles.bubble}>
      <View pointerEvents="none" style={[styles.tail, leftOfFace ? styles.tailRight : styles.tailLeft]} />
      {waiting ? <View testID="companion-wait" accessible accessibilityLiveRegion="polite" accessibilityLabel={progress} style={styles.dots}>
        {[0, 1, 2].map(i => <View key={i} style={[styles.dot, { opacity: .5 + i * .2 }]} />)}</View>
        : <>
          {!!reason && <Text accessibilityRole="alert" numberOfLines={2} style={styles.warning}>{reason.reason}</Text>}
          {!!preview && <View testID={reminder && !question ? 'companion-reminder' : 'companion-answer'} onLayout={() => { if (reminder && !question) setExposed(true); }}>
            <Text numberOfLines={4} selectable style={styles.body}>{preview}</Text></View>}
          {turnStatus?.kind === 'notice' && turnStatus.text !== notice && !(reply && completedNotices.has(turnStatus.text)) && <ChatTurnStatusLine status={turnStatus} />}
          {!!notice && <Text accessibilityRole="alert" numberOfLines={2} style={styles.warning}>{notice}</Text>}
          {(needsRecovery || long) && <Pressable accessibilityRole="button" accessibilityLabel={needsRecovery ? '在完整對話查核原訊息' : '在助手頁閱讀完整回覆'} onPress={openFull} hitSlop={3}>
            <Text style={styles.more}>{needsRecovery ? '查核原訊息' : '閱讀全文'} ›</Text></Pressable>}
        </>}
    </View></DialogueSlot>}
    <DialogueSlot>
      {panel && !recording && <View testID="companion-entry" style={[styles.entry, focused && styles.focused]}>
        {!submitted && agentAttachments.map(a => <View key={a.id} style={styles.row}>
          <Text numberOfLines={1} style={[styles.context, styles.input]}>{a.fileName}</Text>
          <ChatAction label="移除附件" onPress={() => removeAgentAttachment(a.id)} disabled={!editable} icon="close" iconOnly /></View>)}
        <View style={styles.row}><View style={styles.input}>
          <ChatComposerInput ref={input} compact disabled={!canType} value={composerText} placeholder={childName ? `問${childName}的事…` : '想問甚麼？'}
            hint={[childName, itemLabel].filter(Boolean).join(' · ')} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
            onChangeText={setChatDraft} onSubmit={submit} canSubmit={canQueue || canSend} /></View>
          {canQueue && <Pressable accessibilityRole="button" accessibilityLabel="停止回覆" onPress={() => void chatController.cancelReply()} style={styles.action}>
            <AppIcon name="checkbox-blank-outline" size={15} color={colors.muted} /></Pressable>}
          <Pressable testID={label === '錄製語音訊息' ? 'companion-microphone' : 'companion-send'} accessibilityRole="button"
            accessibilityLabel={label} disabled={disabled} accessibilityState={{ disabled }} style={styles.action}
            onPress={stop ? () => void chatController.cancelReply() : hasContent ? submit : startVoice}>
            <View style={[styles.actionIcon, hasContent && !stop && styles.send, disabled && styles.disabled]}>
              <AppIcon name={stop ? 'checkbox-blank-outline' : !hasContent ? 'microphone-outline' : queued ? 'close' : 'arrow-up'} size={17} color={colors.ink} />
            </View></Pressable>
        </View>
      </View>}
      {(canRecord || recording) && <View style={recording ? styles.voice : undefined} pointerEvents={recording ? 'auto' : 'none'}>
        {recording && !!chatDraft.trim() && <Text numberOfLines={1} style={styles.context}>{chatDraft}</Text>}
        <VoiceCapture ref={voice} visible={recording} sendRecording onListening={onListening} confirmDisabled={!canRecord} onDismiss={endVoice} onPick={a => void send(a)} />
      </View>}
    </DialogueSlot>
  </>;
}
const styles = StyleSheet.create({
  chooser: { gap: 8, backgroundColor: colors.white, borderRadius: 16, padding: 12, borderWidth: 1, borderColor: colors.line },
  bubble: { maxWidth: '100%', backgroundColor: colors.white, borderWidth: 1, borderColor: '#ADC9BF', borderRadius: 16, paddingHorizontal: 11, paddingVertical: 7, gap: 3,
    shadowColor: colors.ink, shadowOffset: { width: 0, height: 2 }, shadowRadius: 5, shadowOpacity: .16, elevation: 2 },
  tail: { position: 'absolute', bottom: 6, width: 11, height: 11, backgroundColor: colors.white, borderColor: '#ADC9BF', transform: [{ rotate: '45deg' }] },
  tailLeft: { left: -6, borderLeftWidth: 1, borderBottomWidth: 1 }, tailRight: { right: -6, borderRightWidth: 1, borderTopWidth: 1 },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 15, paddingHorizontal: 1 },
  dot: { width: 5, height: 5, backgroundColor: '#437567', borderRadius: 3 },
  screenReader: { position: 'absolute', width: 1, height: 1, overflow: 'hidden', opacity: 0 },
  entry: { backgroundColor: colors.paleTeal, borderColor: 'transparent', borderWidth: 1, borderRadius: 22, paddingLeft: 5, paddingRight: 2 },
  focused: { borderColor: '#50887E' },
  voice: { backgroundColor: colors.paleTeal, borderRadius: 22, paddingHorizontal: 4 },
  row: { flexDirection: 'row', alignItems: 'center' }, input: { flex: 1, minWidth: 0 },
  action: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  actionIcon: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  send: { backgroundColor: colors.accent }, disabled: { opacity: .4 },
  body: { color: colors.ink, fontSize: 15, lineHeight: 21 }, warning: { color: colors.warningInk, fontSize: 13, lineHeight: 19 },
  more: { color: '#396B60', fontSize: 12, lineHeight: 22 }, context: { color: colors.muted, fontSize: 12, lineHeight: 18 },
});
