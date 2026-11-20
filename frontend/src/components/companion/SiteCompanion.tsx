import { useLayoutEffect, useMemo, useState } from 'react';
import { usePathname } from 'expo-router';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text, TextInput } from 'react-native-paper';
import { useChatExposure, useChatForeground } from '../../production/useChatExposure';
import { assistantPages, type ChatPageContext } from '../../../../src/shared/chat-page-context';
import { useProduction } from '../../production/ProductionProvider';
import { colors } from '../../theme';
import { AppDialog } from '../AppDialog';
import { CharacterDock } from './CharacterDock';
import { AppButton } from '../ui';
import { VoiceCapture } from '../agent/VoiceCapture';
import { useCompanionSelection } from './CompanionSelection';
export function SiteCompanion() {
  const { identityKey } = useProduction();
  return identityKey ? <Companion key={identityKey} /> : null;
}

type Panel = { page: string; scope: string | null; chosenChild?: string; includeItem: boolean; reminderId?: string };

function Companion() {
  const pathname = usePathname(), { height } = useWindowDimensions(), foreground = useChatForeground();
  const { apiBaseUrl, scopeKey, sharedChild, selectedChildId, chatState, online } = useProduction();
  const childId = !sharedChild.target && scopeKey && selectedChildId === chatState.selectedChildId ? selectedChildId : null;
  const scope = scopeKey ?? (sharedChild.target ? JSON.stringify(sharedChild.target) : null);
  const unread = childId && online && !chatState.error ? chatState.messages.find(m => m.childId === childId && m.proactive && m.proactiveUnread === true)?.id : undefined;
  const [panel, setPanel] = useState<Panel | null>(null);
  const quiet = pathname === '/chat';
  const open = !quiet && panel?.page === pathname && panel.scope === scope;
  useLayoutEffect(() => {
    setPanel(current => {
      if (!current || current.page !== pathname) return null;
      if (current.scope === scope) return current;
      // Only the explicitly chosen private conversation may follow a scope switch.
      if (current.chosenChild && !sharedChild.target && current.chosenChild === selectedChildId)
        return { page: pathname, scope, includeItem: false };
      return null;
    });
  }, [pathname, scope, selectedChildId, sharedChild.target]);
  const src = Platform.OS === 'web' ? '/companion/zundamon.html' : new URL('/companion/zundamon.html', apiBaseUrl).href;
  return <>
    <CharacterDock src={src} page={pathname} unread={unread || undefined} foreground={foreground} panelOpen={open}
      onChat={() => setPanel({ page: pathname, scope, includeItem: !!childId, reminderId: unread || undefined })} />
    {open && (childId
      ? <QuickConversation key={scope} page={pathname} childId={childId} includeItem={panel.includeItem} reminderId={panel.reminderId} height={height} close={() => setPanel(null)} />
      : <ConversationChoices close={() => setPanel(null)} onChoose={chosenChild => setPanel({ page: pathname, scope, chosenChild, includeItem: false })} />)}
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
  return <AppDialog visible onDismiss={close} accessibilityLabel="選擇私人對話" style={styles.dialog}>
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
  </AppDialog>;
}

function QuickConversation({ page, childId, includeItem, reminderId, height, close }: { page: string; childId: string; includeItem: boolean; reminderId?: string; height: number; close(): void }) {
  const { chatState: chat, chatDraft, setChatDraft, agentAttachments, addAgentAttachment, removeAgentAttachment, sendChat,
    chatController, chatWritesAllowed, voiceUpload, fileUpload, photoUpload, openAgentDraft, checkVoiceUpload } = useProduction();
  const selected = useCompanionSelection();
  const item = includeItem && selected?.page === page && selected.childId === childId ? selected.item : undefined;
  const [voiceOpen, setVoiceOpen] = useState(false);
  const draft = chat.drafts[childId];
  const activeReply = chat.replyingMessageId ?? (chat.remoteReply?.status === 'running'
    && !chat.messages.some(m => m.role === 'model' && m.inReplyTo === chat.remoteReply?.messageId) ? chat.remoteReply.messageId : null);
  const canStartNext = draft?.phase === 'reply_failed' && !!draft.savedUserMessageId && !chat.busy && !activeReply;
  const editable = chatWritesAllowed && chat.online && !chat.busy && !activeReply && !!chat.loadedAt && !chat.loading
    && (!draft || draft.phase === 'draft') && ![voiceUpload,fileUpload,photoUpload].some(u => u.busy || u.unknown);
  const reminder = reminderId ? chat.messages.find(m => m.id === reminderId && m.childId === childId && m.proactive) : undefined;
  const [exposed, setExposed] = useState(false);
  const foreground = useChatForeground();
  const exposedIds = useMemo(() => exposed && reminder ? [reminder.id] : [], [exposed, reminder?.id]);
  useChatExposure(foreground && exposed, exposedIds);
  const recent = chat.messages.filter(m => m.childId === childId && m.id !== reminder?.id && !m.proactiveUnread).slice(-4);
  const validPage = assistantPages.find(p => p === page);
  const send = () => {
    if (!editable || !validPage) return;
    const context: ChatPageContext = { page: validPage, ...(item ? {item} : {}) };
    void sendChat({ pageContext: context });
  };
  return <AppDialog visible onDismiss={close} accessibilityLabel="小助手對話" style={styles.dialog}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.heading}><Text variant="titleMedium">小助手</Text><AppButton variant="quiet" label="開啟助手頁" onPress={() => { close(); openAgentDraft(); }} /></View>
      <ScrollView style={{maxHeight:Math.max(100,Math.min(height * .48, 350))}} keyboardShouldPersistTaps="handled">
        {reminder && <View testID="companion-reminder" onLayout={() => setExposed(true)} style={styles.line}>
          <Text variant="labelSmall">助手提醒</Text><Text selectable>{reminder.text}</Text></View>}
        {recent.map(m => <View key={m.id} style={[styles.line,m.role === 'user' && styles.userLine]}><Text variant="labelSmall">{m.role === 'user' ? '你' : '助手'}</Text>
          <Text selectable>{m.text || (m.voice ? '語音訊息' : '附件訊息')}</Text></View>)}
        {voiceOpen && <VoiceCapture visible onDismiss={() => setVoiceOpen(false)} onPick={a => { if (addAgentAttachment(a)) setVoiceOpen(false); }} />}
      </ScrollView>
      {item && <Text variant="labelMedium">連同目前{({task:'待辦',record:'記錄',document:'文件'})[item.kind]}發問</Text>}
      {agentAttachments.map(a => <AppButton key={a.id} variant="quiet" disabled={!editable} label={'移除' + (a.kind === 'voice' ? '錄音' : '附件')} onPress={() => removeAgentAttachment(a.id)} />)}
      <TextInput mode="outlined" dense multiline accessibilityLabel="小助手問題" placeholder="想問甚麼？" maxLength={10000} disabled={!editable}
        value={draft?.savedUserMessageId ? '' : chatDraft} onChangeText={setChatDraft} style={styles.input} />
      {(chat.error || chat.replyError || draft?.notice || voiceUpload.notice) && <Text accessibilityLiveRegion="polite">{chat.error || chat.replyError || voiceUpload.notice || draft?.notice}</Text>}
      {canStartNext && <AppButton variant="quiet" label="開始下一條問題" onPress={() => chatController.startNewMessage()} />}
      {voiceUpload.unknown && <AppButton label="查核原錄音上傳" onPress={checkVoiceUpload} />}
      <View style={styles.actions}><AppButton variant="quiet" label="收起" onPress={close} />
        <AppButton variant="quiet" label="錄音" disabled={!editable || !!agentAttachments.length} onPress={() => setVoiceOpen(true)} />
        {activeReply ? <AppButton label="停止回覆" disabled={chat.cancelling || chat.cancelAcceptedFor === activeReply || !chat.online} onPress={() => void chatController.cancelReply()} />
          : <AppButton label="送出" disabled={!editable || !validPage || voiceOpen || (!chatDraft.trim() && !agentAttachments.length)} onPress={send} />}</View>
    </KeyboardAvoidingView>
  </AppDialog>;
}
const styles = StyleSheet.create({
  dialog:{width:'91%',maxWidth:420,alignSelf:'center',paddingHorizontal:14,paddingBottom:10},
  heading:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}, actions:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',justifyContent:'flex-end',gap:4},
  input:{maxHeight:90,backgroundColor:colors.white}, line:{marginBottom:8,alignSelf:'flex-start',maxWidth:'94%',padding:8,borderRadius:10,backgroundColor:colors.white},
  userLine:{alignSelf:'flex-end',backgroundColor:colors.paleTeal},
});
