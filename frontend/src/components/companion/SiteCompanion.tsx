import { useLayoutEffect, useMemo, useState } from 'react';
import { usePathname } from 'expo-router';
import { Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text } from 'react-native-paper';
import { useChatExposure, useChatForeground } from '../../production/useChatExposure';
import { assistantPages, type ChatPageContext } from '../../../../src/shared/chat-page-context';
import { useProduction } from '../../production/ProductionProvider';
import { colors, mobileLayout } from '../../theme';
import { CompanionPopover } from './CompanionPopover';
import { AgentComposer } from '../agent/AgentComposer';
import { AssistantByline } from '../chat/AssistantByline';
import { ChatAction } from '../chat/ChatAction';
import { failedChatReply } from '../chat/failed-reply';
import { chatReplyActivity, chatTurnStatus, privateChatChildName } from '../chat/chat-turn-status';
import { ChatTurnStatusLine } from '../chat/ChatTurnStatusLine';
import { CharacterDock } from './CharacterDock';
import { AppButton } from '../ui';
import { AppIcon } from '../AppIcon';
import { useCompanionSelection } from './CompanionSelection';
function characterSource(apiBaseUrl: string) {
  return Platform.OS === 'web' ? '/companion/zundamon.html' : new URL('/companion/zundamon.html', apiBaseUrl).href;
}

type Panel = { page: string; scope: string | null; chosenChild?: string; privateChild?: string; includeItem: boolean; reminderId?: string; focusRequest?: number };

export function SiteCompanion({ authorised, visible }: { authorised: boolean; visible: boolean }) {
  const pathname = usePathname(), foreground = useChatForeground();
  const { apiBaseUrl, scopeKey, sharedChild, selectedChildId, chatState, online } = useProduction();
  const childId = !sharedChild.target && scopeKey && selectedChildId === chatState.selectedChildId ? selectedChildId : null;
  const scope = scopeKey ?? (sharedChild.target ? JSON.stringify(sharedChild.target) : null);
  const unread = childId && online && !chatState.error ? chatState.messages.find(m => m.childId === childId && m.proactive && m.proactiveUnread === true)?.id : undefined;
  const [panel, setPanel] = useState<Panel | null>(null);
  const quiet = pathname === '/chat';
  const open = authorised && !quiet && panel?.page === pathname && panel.scope === scope &&
    (!panel.privateChild || panel.privateChild === childId);
  useLayoutEffect(() => {
    setPanel(current => {
      if (!authorised || !current || current.page !== pathname || (current.privateChild && current.privateChild !== childId)) return null;
      if (current.scope === scope) return current;
      // Only the explicitly chosen private conversation may follow a scope switch.
      if (current.chosenChild && !sharedChild.target && current.chosenChild === selectedChildId)
        return { page: pathname, scope, includeItem: false, privateChild: childId ?? undefined };
      return null;
    });
  }, [authorised, pathname, scope, childId, selectedChildId, sharedChild.target]);
  return <>
    <CharacterDock src={characterSource(apiBaseUrl)} page={pathname} unread={unread || undefined} foreground={foreground && visible} panelOpen={open} inToolbar={quiet}
      onChat={() => setPanel(current => open && current ? { ...current, focusRequest: (current.focusRequest ?? 1) + 1 }
        : { page: pathname, scope, privateChild: childId ?? undefined, includeItem: !!childId, reminderId: unread || undefined })} />
    {open && <CompanionPopover>{childId
      ? <QuickConversation key={scope} page={pathname} childId={childId} includeItem={panel.includeItem} reminderId={panel.reminderId} focusRequest={panel.focusRequest ?? 1} close={() => setPanel(null)} />
      : <ConversationChoices close={() => setPanel(null)} onChoose={chosenChild => setPanel({ page: pathname, scope, chosenChild, includeItem: false })} />}</CompanionPopover>}
  </>;
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

function QuickConversation({ page, childId, includeItem, reminderId, focusRequest, close }: {
  page: string; childId: string; includeItem: boolean; reminderId?: string; focusRequest: number; close(): void;
}) {
  const { chatState: chat, chatDraft, setChatDraft, agentAttachments, addAgentAttachment, removeAgentAttachment, sendChat,
    chatController, chatWritesAllowed, voiceUpload, fileUpload, photoUpload, openAgentDraft, agentRuns, recordsState } = useProduction();
  const selected = useCompanionSelection(), compact = useWindowDimensions().width < mobileLayout.breakpoint;
  const item = includeItem && selected?.page === page && selected.childId === childId ? selected.item : undefined;
  const draft = chat.drafts[childId], phase = draft?.phase ?? 'draft';
  const [previousIds] = useState(() => new Set(chat.messages.map(m => m.id)));
  const activity = chatReplyActivity(chat);
  const activeReply = activity.activeReplyId;
  const targetId = activeReply ?? draft?.savedUserMessageId;
  const question = [...chat.messages].reverse().find(m => m.childId === childId && m.role === 'user' && !m.discussionOf
    && (targetId ? m.id === targetId : !previousIds.has(m.id)));
  const reply = question && [...chat.messages].reverse().find(m => m.childId === childId && m.role === 'model' && m.inReplyTo === question.id);
  const reason = reply && failedChatReply(reply.text, reply.agentRunId ? agentRuns[reply.agentRunId]?.stopReasonLabel : undefined);
  const submitted = !!draft?.savedUserMessageId && (phase === 'replying' || phase === 'reply_failed');
  const upload = [voiceUpload, fileUpload, photoUpload].find(u => u.busy || u.unknown || u.notice);
  const editable = chatWritesAllowed && chat.online && !chat.busy && !activeReply && !!chat.loadedAt && !chat.loading
    && phase === 'draft' && ![voiceUpload, fileUpload, photoUpload].some(u => u.busy || u.unknown);
  const reminder = reminderId ? chat.messages.find(m => m.id === reminderId && m.childId === childId && m.proactive) : undefined;
  const [exposed, setExposed] = useState(false);
  const foreground = useChatForeground();
  const exposedIds = useMemo(() => exposed && reminder ? [reminder.id] : [], [exposed, reminder?.id]);
  useChatExposure(foreground && exposed, exposedIds);
  const validPage = assistantPages.find(p => p === page);
  const send = () => {
    if (!editable || !validPage) return;
    const context: ChatPageContext = { page: validPage, ...(item ? { item } : {}) };
    return sendChat({ pageContext: context });
  };
  const turnStatus = chatTurnStatus(chat, draft, activity, reason && question ? { questionId: question.id, reason: reason.reason } : undefined, chatWritesAllowed);
  const notice = upload?.notice || chat.error;
  const childName = privateChatChildName(recordsState.children, childId, !includeItem);
  const needsRecovery = phase === 'save_unknown' || phase === 'checked' || upload?.unknown || phase === 'reply_failed';
  const openFull = () => { close(); openAgentDraft(); };
  return <>
    <View style={styles.heading}>
      <View style={[styles.identity, styles.title]}><AppIcon name="message-text-outline" size={18} /><Text style={styles.headingText}>小助手{childName ? ` · ${childName}` : ''}</Text></View>
      <View style={styles.identity}><ChatAction label={needsRecovery ? '查核原訊息' : '完整對話'}
        accessibilityLabel={needsRecovery ? '在完整對話查核原訊息' : '開啟助手頁'} onPress={openFull} icon="arrow-right" />
        <ChatAction label="收起小助手對話" onPress={close} icon="close" iconOnly /></View>
    </View>
    {(reminder || question || turnStatus || notice) && <ScrollView testID="companion-turn" style={styles.preview} keyboardShouldPersistTaps="handled">
      {reminder && <View testID="companion-reminder" onLayout={() => setExposed(true)} style={styles.reply}>
        <Text style={styles.byline}>助手提醒</Text><Text selectable style={styles.body}>{reminder.text}</Text></View>}
      {question && <View style={styles.question}><Text selectable style={styles.body}>{question.text || '附件訊息'}</Text></View>}
      {reply && <View style={styles.reply}><AssistantByline />
        {reason && <Text accessibilityRole="alert" style={styles.warning}>{reason.reason}</Text>}
        {!!(reason ? reason.body : reply.text) && <Text selectable style={styles.body}>{reason ? reason.body : reply.text}</Text>}</View>}
      {turnStatus && turnStatus.text !== notice && <ChatTurnStatusLine status={turnStatus} />}
      {!!notice && <Text accessibilityRole="alert" style={styles.warning}>{notice}</Text>}
    </ScrollView>}
    {!question && !reminder && !turnStatus && !notice && <Text style={styles.prompt}>想問甚麼？</Text>}
    {item && <Text style={styles.context}>{({ task: '待辦', record: '記錄', document: '文件' })[item.kind]} · {selected?.label || '目前選取的項目'}</Text>}
    <AgentComposer embedded compact={compact} enabled={editable} allowTyping={submitted && chatWritesAllowed && !chat.busy && !activeReply}
      focusRequest={focusRequest} draft={submitted ? draft.nextText ?? '' : chatDraft} attachments={submitted ? [] : agentAttachments}
      onChangeDraft={setChatDraft} onPreview={send} submitLabel="送出" suggestionsAvailable={false}
      onStop={activeReply ? () => void chatController.cancelReply() : undefined} stopTarget={activeReply ?? undefined}
      stopDisabled={chat.cancelling || chat.cancelAcceptedFor === activeReply || !chat.online}
      submitEnabled={editable && !!validPage && (!!chatDraft.trim() || !!agentAttachments.length) && chatDraft.length <= 10000}
      onAddAttachment={addAgentAttachment} onRemoveAttachment={removeAgentAttachment} />
  </>;
}
const styles = StyleSheet.create({
  chooser: { gap: 8 }, heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.paleTeal, borderBottomWidth: 1, borderColor: colors.sage,
    marginTop: -12, marginHorizontal: -12, paddingHorizontal: 12, borderTopLeftRadius: 19, borderTopRightRadius: 19 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 6 }, title: { flexShrink: 1 }, headingText: { fontSize: 16, fontWeight: '700', color: colors.ink, flexShrink: 1 },
  preview: { maxHeight: 170, flexShrink: 1 }, byline: { fontSize: 12, fontWeight: '600', color: colors.muted },
  reply: { paddingVertical: 6, gap: 3 }, question: { alignSelf: 'flex-end', maxWidth: '90%', borderRadius: 12, padding: 8, backgroundColor: colors.sage },
  body: { color: colors.ink, fontSize: 15, lineHeight: 22 }, warning: { color: colors.warningInk, fontSize: 13, lineHeight: 19 },
  prompt: { fontSize: 19, lineHeight: 26, fontWeight: '600', color: colors.ink, marginTop: 10 },
  context: { color: colors.muted, fontSize: 12, marginTop: 2 },
});
