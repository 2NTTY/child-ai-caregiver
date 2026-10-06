import { useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "expo-router";
import { StyleSheet, View, useWindowDimensions, type ScrollView as NativeScrollView } from "react-native";
import { ActivityIndicator, Text } from "react-native-paper";
import { AppButton, SectionCard, TextLink } from "../components/ui";
import { AgentComposer } from "../components/agent/AgentComposer";
import { ChatMessage } from "../components/chat/ChatMessage";
import { ChatTimeline, type ChatTimelineControls } from "../components/chat/ChatTimeline";
import { locateCitationSource } from "../components/chat/locateCitationSource";
import { chatColors, chatFont, chatType } from "../components/chat/chat-presentation";
import { useProduction } from "../production/ProductionProvider";
import { AgentConversation } from "../production/AgentConversation";
import { AgentPhotoInput } from "../production/PhotoInputDomains";
import { usePreviewLeaveGuard } from "../preview/PreviewNavigationGuard";
import { mobileLayout } from "../theme";
import type { ChatReplyPhase } from "../chat-view-model";

const attachmentLeaveCopy = { message: "離開將移除未送出的附件；文字仍在本次暫存保留。", actionLabel: "移除附件並離開" };
const runPhases = { running: "thinking", completed: "complete", stopped: "stopped", unknown: "unknown" } satisfies Record<string, ChatReplyPhase>;
export default function ChatPage() {
  const { scopeKey } = useProduction();
  const viewportWidth = useWindowDimensions().width;
  const [paneWidth, setPaneWidth] = useState(0);
  return <View onLayout={event => setPaneWidth(event.nativeEvent.layout.width)} style={styles.root}>
    <ChatContents key={scopeKey ?? "no-authorized-child"} compact={(paneWidth || viewportWidth) < mobileLayout.breakpoint} />
  </View>;
}
function ChatContents({ compact }: { compact: boolean }) {
  const pathname = usePathname();
  const { model, actions, scopeKey, chatState: chat, chatController, chatDraft, setChatDraft, agentAttachments,
    addAgentAttachment, removeAgentAttachment, composerFocusRequest, sendChat, requestChatReply, agentRuns, agentModel, chatWritesAllowed, selectAgentRun, openAgentSource } = useProduction();
  const child = model.children.find(item => item.id === model.selectedChildId);
  const draft = child ? chat.drafts[child.id] : undefined;
  const phase = draft?.phase ?? "draft", busy = chat.busy !== null;
  const scrollRef = useRef<NativeScrollView | null>(null), timelineRef = useRef<ChatTimelineControls | null>(null);
  const [followRequest, setFollowRequest] = useState<string>();
  const previous = useRef({ ids: new Set(chat.messages.map(item => item.id)), busy: chat.busy });
  const lastMessage = chat.messages[chat.messages.length - 1];
  const newReplyId = lastMessage?.role === "model" && !previous.current.ids.has(lastMessage.id) && previous.current.busy === "reply" ? lastMessage.id : undefined;
  useLayoutEffect(() => { previous.current = { ids: new Set(chat.messages.map(item => item.id)), busy: chat.busy }; }, [chat.messages, chat.busy]);
  const locateSource = (target: View | null, horizontalScroll?: NativeScrollView | null, verticalTarget?: View | null) => {
    timelineRef.current?.holdReadingPosition(); locateCitationSource(target, scrollRef.current, horizontalScroll, verticalTarget);
  };
  usePreviewLeaveGuard(agentAttachments.length > 0 && pathname === "/chat", false, "child", attachmentLeaveCopy);
  const canSend = !!scopeKey && !!child && chat.selectedChildId === child.id && chat.online && !busy && !chat.loading
    && chatWritesAllowed && agentAttachments.length === 0 && !!chat.loadedAt && phase === "draft" && !!chatDraft.trim() && chatDraft.length <= 10_000;
  function send() {
    if (!canSend) return;
    setFollowRequest(`send-${Date.now()}`); void sendChat();
  }
  const header = <>
    <View style={styles.headingCard}>
      <View style={styles.headingRow}><Text accessibilityRole="header" style={styles.screenReaderTitle}>助手</Text>
        <View style={styles.headingActions}><TextLink label="對話歷史"
          onPress={() => { if (!child || busy || chat.loading || !chat.online) return; timelineRef.current?.holdReadingPosition(); void chatController.reloadMessages(); }} />
          <TextLink label="記憶與參考" onPress={() => actions.open("memory")} /></View></View>
    </View>
    {child ? <>
      <Text style={styles.meta}>送出後會保存聊天並要求 AI 回覆；孩子稱呼及獲授權資料可能交由 Google 處理。試用時請使用合成資料。</Text>
      <View style={styles.statusRow}><Text style={styles.meta}>已讀取 {chat.messages.length} 則對話。</Text>
        {chat.nextCursor ? <AppButton label="讀取更早對話" variant="quiet" density="compact" loading={chat.loadingOlder}
          disabled={busy || chat.loading || chat.loadingOlder || !chat.online} onPress={() => { timelineRef.current?.holdReadingPosition(); void chatController.loadOlderMessages(); }} /> : null}
        <AppButton label={chat.loading ? "正在讀取聊天" : phase === "save_unknown" || phase === "checked" ? "重新讀取並查核原保存" : "重新讀取聊天"}
          variant="quiet" density="compact" loading={chat.loading} disabled={busy || chat.loading || !chat.online} onPress={() => { void chatController.reloadMessages(); }} /></View>
      {chat.available === false ? <Text style={styles.meta}>AI 目前未開放；已保存訊息可以稍後再要求回覆。</Text> : null}
      {!chat.online ? <Text style={styles.warning}>目前離線；所示聊天是上次讀取的快照，未送出草稿仍保留。</Text> : null}
      {chat.loading || busy ? <View style={styles.statusRow}><ActivityIndicator size={14} color={chatColors.secondary} />
        <Text accessibilityLiveRegion="polite" style={styles.meta}>{chat.busy === "save" ? "正在保存聊天…" : chat.busy === "reply" ? "聊天已保存，正在等候 AI 回覆…" : "正在讀取已保存聊天…"}</Text></View> : null}
      {chat.error ? <Text accessibilityRole="alert" style={styles.warning}>{chat.error}</Text> : null}
      {draft?.notice && (phase === "save_unknown" || phase === "checked" || phase === "reply_failed" || phase === "draft" && !!chatDraft.trim()) ? <Text accessibilityRole="alert" style={styles.warning}>{draft.notice}</Text> : null}
      {chat.replyError && chat.replyError !== draft?.notice ? <Text accessibilityRole="alert" style={styles.warning}>{chat.replyError}</Text> : null}
      {chat.busy === "reply" ? <AppButton label="停止這次 Agent 運行" variant="quiet" density="compact" loading={chat.cancelling}
        disabled={chat.cancelling || !chat.online} onPress={() => { void chatController.cancelReply(); }} /> : null}
      {chat.cancelNotice ? <Text accessibilityLiveRegion="polite" style={styles.warning}>{chat.cancelNotice}</Text> : null}
      {phase === "checked" ? <View style={styles.statusRow}>
        {draft?.candidateMessageId ? <AppButton label="已核對，確認這則聊天已保存" variant="quiet" disabled={busy} onPress={() => chatController.confirmFoundMessage()} /> : null}
        <AppButton label="已核對，解鎖原文重試" variant="quiet" disabled={busy || !chat.online} onPress={() => chatController.unlockCheckedSave()} /></View> : null}
      {phase === "reply_failed" && draft?.savedUserMessageId ? <View style={styles.statusRow}>
        <AppButton label="再次取得原訊息的回覆" variant="quiet" disabled={busy || !chat.online || chat.loading || !chatWritesAllowed}
          onPress={() => { void requestChatReply(draft.savedUserMessageId!); }} />
        <AppButton label="開始新訊息" variant="quiet" disabled={busy} onPress={() => chatController.startNewMessage()} /></View> : null}
      {chat.loadedAt ? <Text style={styles.meta}>最後讀取：{new Date(chat.loadedAt).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" })}</Text> : null}
      {!chat.loading && chat.loadedAt && chat.messages.length === 0 ? <Text style={styles.body}>尚未有已保存聊天。</Text> : null}
      <AgentConversation onLocateSource={locateSource} />
      {agentAttachments.map(attachment => attachment.photo ? <AgentPhotoInput key={attachment.id} original={attachment.photo}
        onTransferred={() => removeAgentAttachment(attachment.id)} onPhotos={() => actions.open("photos")} /> : null)}
    </> : <SectionCard><Text style={styles.body}>先選擇孩子。</Text>
      <AppButton label="重新讀取子女檔案" onPress={actions.refresh} /></SectionCard>}
  </>;
  return <>
    <ChatTimeline items={child ? chat.messages : []} recentLimit={6} compact={compact} header={header} scrollRef={scrollRef} controlsRef={timelineRef}
      followRequest={followRequest} newReplyId={newReplyId} renderItem={message => {
        const run = message.agentRunId ? agentRuns[message.agentRunId] : undefined;
        const sourcesMatch = run?.text === message.text;
        const pendingReply = message.role === "user" && message.authorUserId === chat.userId && chat.messages.slice(-chat.limit).some(item => item.id === message.id)
          && !chat.messages.some(item => item.role === "model" && item.inReplyTo === message.id);
        return <ChatMessage message={{ id: message.id, role: message.role === "model" ? "assistant" : "user", text: message.text,
          phase: run ? runPhases[run.status] : undefined, sources: sourcesMatch ? run.citations : undefined,
          note: new Date(message.createdAt).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong" }) }}
          phaseLabel={run?.status === "running" ? "運行仍在處理" : undefined} onLocateSource={locateSource}
          onOpenSource={run ? id => openAgentSource(run.id, id) : undefined}
          degraded={run?.retrievalMode === "keyword_degraded"} footer={<>
            {message.agentRunId ? <AppButton label="查看這則回覆的來源與候選" variant="quiet" density="compact"
              disabled={!chat.online || !!agentModel.busy || !!agentModel.pendingDecision || agentModel.readState === "denied"}
              onPress={() => selectAgentRun(message.agentRunId!)} /> : null}
            {pendingReply ? <AppButton label={chat.replyingMessageId === message.id ? "正在等候原訊息回覆" : "要求這則已保存訊息的回覆"}
              variant="quiet" density="compact" disabled={busy || !chat.online || chat.loading || !chatWritesAllowed} onPress={() => { void requestChatReply(message.id); }} /> : null}
          </>} />;
      }} />
    <AgentComposer enabled={!!child && pathname === "/chat" && !busy && phase === "draft"} compact={compact} draft={chatDraft}
      attachments={agentAttachments} onChangeDraft={setChatDraft} onPreview={send} submitEnabled={canSend} submitLabel="送出"
      suggestionLabel="建議問題" inputHint={agentAttachments.length ? "請在上方照片入口保存及核對；照片不會隨文字自動交模型或共享。" : "支援文字聊天及照片核對；語音和其他文件尚未接通。"}
      filesUnavailableReason="文件提交尚未接通，請先使用文字" voiceUnavailableReason="語音提交尚未接通，請先使用文字"
      onSources={() => actions.open("sources")} onAddAttachment={addAgentAttachment} onRemoveAttachment={removeAgentAttachment} focusRequest={composerFocusRequest} />
  </>;
}
const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: chatColors.canvas }, headingCard: { gap: 4, minWidth: 0 },
  headingRow: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 12, flexWrap: "wrap" },
  headingActions: { flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" },
  screenReaderTitle: { position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0 },
  body: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.body },
  meta: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.meta },
  warning: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.tool },
  statusRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
});
