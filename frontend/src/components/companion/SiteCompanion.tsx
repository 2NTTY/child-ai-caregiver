import { Component, useState, type ReactNode } from 'react';
import { usePathname } from 'expo-router';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Text, TextInput } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { assistantPages, type ChatPageContext } from '../../../../src/shared/chat-page-context';
import { useProduction } from '../../production/ProductionProvider';
import { colors, mobileLayout } from '../../theme';
import { AppDialog } from '../AppDialog';
import { AppIcon } from '../AppIcon';
import { AppButton } from '../ui';
import { VoiceCapture } from '../agent/VoiceCapture';
import { useCompanionSelection } from './CompanionSelection';
import CharacterFrame from './CharacterFrame';

class RenderBoundary extends Component<{children: ReactNode}, {failed: boolean}> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

export function SiteCompanion() {
  const { scopeKey, identityKey, sharedChild, selectedChildId, chatState } = useProduction();
  if (!identityKey) return null;
  return <Companion key={sharedChild.target ? 'shared' : scopeKey ?? identityKey} childId={!sharedChild.target && scopeKey && selectedChildId === chatState.selectedChildId ? selectedChildId : null} />;
}

function Companion({ childId }: { childId: string | null }) {
  const pathname = usePathname(), insets = useSafeAreaInsets(), { width, height } = useWindowDimensions();
  const { apiBaseUrl, actions } = useProduction();
  const [gesture, setGesture] = useState(0), [ready, setReady] = useState(false);
  const [minimized, setMinimized] = useState(false), [openOn, setOpenOn] = useState<string | null>(null);
  const quiet = pathname === '/chat';
  const open = !!childId && !quiet && openOn === pathname;
  const small = width < mobileLayout.breakpoint;
  const size = quiet ? 48 : small ? 64 : 88;
  const src = Platform.OS === 'web' ? '/companion/zundamon.html' : new URL('/companion/zundamon.html', apiBaseUrl).href;
  const collapsed = minimized && !quiet;
  return <>
    <View style={[styles.dock, quiet ? styles.quiet : { right: 8, bottom: Platform.OS === 'web' ? 6 : mobileLayout.tabMinHeight + insets.bottom + 4 }]}>
      <Pressable testID="site-companion" accessibilityRole="button" accessibilityLabel={quiet ? '跟助手揮手' : collapsed ? '展開小助手' : '跟小助手對話'}
        onPress={() => {
          if (collapsed) { setMinimized(false); return; }
          setGesture(n => n + 1);
          if (!quiet) { if (childId) setOpenOn(pathname); else actions.open('chat'); }
        }} style={[styles.character, { width: collapsed ? 44 : size, height: collapsed ? 44 : size }]}>
        {(!ready || collapsed) && <AppIcon name="message-text-outline" size={24} color={colors.teal} />}
        <View pointerEvents="none" importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill, (!ready || collapsed) && { opacity: 0 }]}>
          <RenderBoundary><CharacterFrame src={src} gesture={gesture} onState={async value => setReady(value)}
            dom={{ style: { width: '100%', height: '100%', backgroundColor: 'transparent' }, scrollEnabled: false }} /></RenderBoundary>
        </View>
      </Pressable>
      {!collapsed && !quiet && <Pressable accessibilityRole="button" accessibilityLabel="收起小助手" hitSlop={5}
        style={styles.minimize} onPress={() => setMinimized(true)}><AppIcon name="close" size={13} /></Pressable>}
    </View>
    {open && <QuickConversation key={pathname} page={pathname} childId={childId!} height={height} close={() => setOpenOn(null)} />}
  </>;
}

function QuickConversation({ page, childId, height, close }: { page: string; childId: string; height: number; close(): void }) {
  const { chatState: chat, chatDraft, setChatDraft, agentAttachments, addAgentAttachment, removeAgentAttachment, sendChat,
    chatController, chatWritesAllowed, voiceUpload, fileUpload, photoUpload, openAgentDraft, checkVoiceUpload } = useProduction();
  const selected = useCompanionSelection();
  const item = selected?.page === page && selected.childId === childId ? selected.item : undefined;
  const [voiceOpen, setVoiceOpen] = useState(false);
  const draft = chat.drafts[childId];
  const activeReply = chat.replyingMessageId ?? (chat.remoteReply?.status === 'running'
    && !chat.messages.some(m => m.role === 'model' && m.inReplyTo === chat.remoteReply?.messageId) ? chat.remoteReply.messageId : null);
  const canStartNext = draft?.phase === 'reply_failed' && !!draft.savedUserMessageId && !chat.busy && !activeReply;
  const editable = chatWritesAllowed && chat.online && !chat.busy && !activeReply && !!chat.loadedAt && !chat.loading
    && (!draft || draft.phase === 'draft') && ![voiceUpload,fileUpload,photoUpload].some(u => u.busy || u.unknown);
  const recent = chat.messages.filter(m => m.childId === childId).slice(-4);
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
  dock:{position:'absolute', zIndex:4, alignItems:'center'}, quiet:{top:0,left:6},
  character:{alignItems:'center',justifyContent:'center',overflow:'hidden',borderRadius:24},
  minimize:{position:'absolute',right:-2,top:-3,width:23,height:23,borderRadius:12,alignItems:'center',justifyContent:'center',backgroundColor:colors.white},
  dialog:{width:'91%',maxWidth:420,alignSelf:'center',paddingHorizontal:14,paddingBottom:10},
  heading:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}, actions:{flexDirection:'row',flexWrap:'wrap',alignItems:'center',justifyContent:'flex-end',gap:4},
  input:{maxHeight:90,backgroundColor:colors.white}, line:{marginBottom:8,alignSelf:'flex-start',maxWidth:'94%',padding:8,borderRadius:10,backgroundColor:colors.white},
  userLine:{alignSelf:'flex-end',backgroundColor:colors.paleTeal},
});
