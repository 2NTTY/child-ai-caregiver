import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "expo-router";
import { Platform, Pressable, StyleSheet, View, useWindowDimensions, type PressableStateCallbackType, type ScrollView as NativeScrollView } from "react-native";
import { ActivityIndicator, Text } from "react-native-paper";
import { AppButton, SectionCard } from "../components/ui";
import { AppDialog } from "../components/AppDialog";
import { AgentComposer } from "../components/agent/AgentComposer";
import { ChatMessage } from "../components/chat/ChatMessage";
import { ChatTimeline, type ChatTimelineControls } from "../components/chat/ChatTimeline";
import { locateCitationSource } from "../components/chat/locateCitationSource";
import { chatColors, chatFont, chatLayout, chatType } from "../components/chat/chat-presentation";
import { useProduction } from "../production/ProductionProvider";
import { AgentConversation } from "../production/AgentConversation";
import { AgentPhotoInput } from "../production/PhotoInputDomains";
import { usePreviewLeaveGuard, usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { proposalExpired } from "../agent-view-model";
import { colors, mobileLayout } from "../theme";
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
  const pathname = usePathname(), router = useRouter(), navigate = usePreviewNavigation();
  const { model, actions, scopeKey, chatState: chat, chatController, chatDraft, setChatDraft, agentAttachments,
    addAgentAttachment, removeAgentAttachment, composerFocusRequest, sendChat, requestChatReply, agentRuns, agentModel,
    agentPending, readAgentPending, authorization, chatWritesAllowed, selectAgentRun, openAgentSource } = useProduction();
  const child = model.children.find(item => item.id === model.selectedChildId);
  const draft = child ? chat.drafts[child.id] : undefined;
  const phase = draft?.phase ?? "draft", busy = chat.busy !== null;
  const scrollRef = useRef<NativeScrollView | null>(null), timelineRef = useRef<ChatTimelineControls | null>(null);
  const [followRequest, setFollowRequest] = useState<string>();
  const detailsTrigger = useRef<View | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false), [privacyOpen, setPrivacyOpen] = useState(false);
  const previous = useRef({ ids: new Set(chat.messages.map(item => item.id)), busy: chat.busy });
  const lastMessage = chat.messages[chat.messages.length - 1];
  const newReplyId = lastMessage?.role === "model" && !previous.current.ids.has(lastMessage.id) && previous.current.busy === "reply" ? lastMessage.id : undefined;
  useLayoutEffect(() => { previous.current = { ids: new Set(chat.messages.map(item => item.id)), busy: chat.busy }; }, [chat.messages, chat.busy]);
  useEffect(() => { if (agentModel.pendingDecision) setDetailsOpen(true); }, [agentModel.pendingDecision?.runId, agentModel.pendingDecision?.proposalId]);
  useEffect(() => { if (scopeKey && chat.online) readAgentPending(); }, [scopeKey, chat.online]);
  const needsDecision = agentModel.readState === "ready" && agentModel.run?.proposals.some(item => item.status === "pending" && !proposalExpired(item))
    || agentPending.state === "ready" && agentPending.entries.some(item => item.proposal.status === "pending" && !proposalExpired(item.proposal));
  const pendingReadLabel = agentPending.state === "idle" ? "尚未讀取" : agentPending.state === "loading" ? "讀取中"
    : agentPending.state === "failed" ? "讀取失敗" : agentPending.state === "denied" ? "無法讀取" : null;
  const locateSource = (target: View | null, horizontalScroll?: NativeScrollView | null, verticalTarget?: View | null) => {
    timelineRef.current?.holdReadingPosition(); locateCitationSource(target, scrollRef.current, horizontalScroll, verticalTarget);
  };
  const composerGuardId = usePreviewLeaveGuard(agentAttachments.length > 0 && pathname === "/chat", false, "child", attachmentLeaveCopy);
  const canSend = !!scopeKey && !!child && chat.selectedChildId === child.id && chat.online && !busy && !chat.loading
    && chatWritesAllowed && agentAttachments.length === 0 && !!chat.loadedAt && phase === "draft" && !!chatDraft.trim() && chatDraft.length <= 10_000;
  function send() {
    if (!canSend) return;
    setFollowRequest(`send-${Date.now()}`); void sendChat();
  }
  function restoreDetailsFocus() {
    const target = detailsTrigger.current as unknown as HTMLElement | null;
    detailsTrigger.current = null;
    if (Platform.OS === "web" && !detailsOpen && pathname === "/chat" && target?.isConnected
      && !target.hasAttribute("disabled") && target.getAttribute("aria-disabled") !== "true"
      && !target.closest('[inert],[aria-hidden="true"]')) target.focus({ preventScroll: true });
  }
  function openSettings() {
    detailsTrigger.current = null;
    setDetailsOpen(false);
    navigate(() => router.push("/settings?section=assistant"));
  }
  const feedback = child ? <View style={styles.feedback}>
    {chat.available === false ? <Text style={styles.meta}>AI 暫未開放，已保存訊息可稍後再要求回覆。</Text> : null}
    {!chat.online ? <Text accessibilityRole="alert" style={styles.warning}>{chat.messages.length ? "目前離線，所示聊天是上次讀取的快照；草稿仍保留。" : "目前離線，草稿仍保留。"}</Text> : null}
    {chat.loading && chat.messages.length || busy ? <View style={styles.statusRow}><ActivityIndicator size={14} color={chatColors.secondary} />
      <Text accessibilityLiveRegion="polite" style={styles.meta}>{chat.busy === "save" ? "正在保存…" : chat.busy === "reply" ? "已保存，正在等候回覆…" : "正在讀取聊天…"}</Text></View> : null}
    {chat.error ? <Text accessibilityRole="alert" style={styles.warning}>{chat.error}</Text> : null}
    {draft?.notice && (phase === "save_unknown" || phase === "checked" || phase === "reply_failed" || phase === "draft" && !!chatDraft.trim()) ? <Text accessibilityRole="alert" style={styles.warning}>{draft.notice}</Text> : null}
    {chat.replyError && chat.replyError !== draft?.notice ? <Text accessibilityRole="alert" style={styles.warning}>{chat.replyError}</Text> : null}
    {chat.error || phase === "save_unknown" || phase === "checked" ? <AppButton label={phase === "save_unknown" || phase === "checked" ? "重新讀取並查核原保存" : "重試讀取聊天"}
      variant="quiet" density="compact" loading={chat.loading} disabled={busy || chat.loading || !chat.online} onPress={() => { void chatController.reloadMessages(); }} /> : null}
    {chat.busy === "reply" ? <AppButton label="停止回覆" variant="quiet" density="compact" loading={chat.cancelling}
      disabled={chat.cancelling || !chat.online} onPress={() => { void chatController.cancelReply(); }} /> : null}
    {chat.cancelNotice ? <Text accessibilityLiveRegion="polite" style={styles.warning}>{chat.cancelNotice}</Text> : null}
    {phase === "checked" ? <View style={styles.statusRow}>
      {draft?.candidateMessageId ? <AppButton label="已核對，確認這則聊天已保存" variant="quiet" disabled={busy} onPress={() => chatController.confirmFoundMessage()} /> : null}
      <AppButton label="已核對，解鎖原文重試" variant="quiet" disabled={busy || !chat.online} onPress={() => chatController.unlockCheckedSave()} /></View> : null}
    {phase === "reply_failed" && draft?.savedUserMessageId ? <View style={styles.statusRow}>
      <AppButton label="重試原訊息回覆" variant="quiet" disabled={busy || !chat.online || chat.loading || !chatWritesAllowed}
        onPress={() => { void requestChatReply(draft.savedUserMessageId!); }} />
      <AppButton label="開始新訊息" variant="quiet" disabled={busy} onPress={() => chatController.startNewMessage()} /></View> : null}
    {authorization.pending ? <View style={styles.statusRow}><Text accessibilityRole="alert" style={styles.warning}>助手設定的原操作待查核。</Text>
      <ChatAction label="前往查核" onPress={openSettings} compact={compact} /></View> : null}
    {agentAttachments.map(attachment => attachment.photo ? <AgentPhotoInput key={attachment.id} original={attachment.photo}
      composerGuardId={composerGuardId} /> : null)}
  </View> : null;
  const empty = !child ? <SectionCard><Text style={styles.body}>先選擇孩子。</Text><AppButton label="重新讀取子女檔案" onPress={actions.refresh} /></SectionCard>
    : chat.loading ? <View style={styles.emptyState}><ActivityIndicator size={18} color={chatColors.secondary} /><Text accessibilityLiveRegion="polite" style={styles.meta}>正在讀取聊天…</Text></View>
      : chat.loadedAt && !chat.error && !busy && !agentAttachments.length && phase === "draft" ? <View testID="chat-empty-prompt" style={styles.emptyState}>
        <Text accessibilityRole="header" style={[styles.emptyTitle, compact && styles.compactEmptyTitle]}>今天想聊些甚麼？</Text></View> : null;
  return <>
    <View testID="chat-top-toolbar" style={[styles.toolbar, compact && styles.compactColumn]}>
      <Text testID="chat-screen-reader-heading" accessibilityRole="header" style={styles.screenReaderTitle}>助手</Text>
      <View style={styles.toolbarActions}><ChatAction label="記憶與參考" onPress={() => actions.open("memory")} compact={compact} />
        <ChatAction label={agentModel.pendingDecision ? "活動 · 待查核" : needsDecision ? "活動 · 待確認" : pendingReadLabel ? `活動 · ${pendingReadLabel}` : "活動"}
          accessibilityLabel={agentModel.pendingDecision ? "對話詳情與活動，原決定待查核" : needsDecision ? "對話詳情與活動，有事項待確認" : pendingReadLabel ? `對話詳情與活動，待確認事項${pendingReadLabel}` : "對話詳情與活動"} onPress={() => setDetailsOpen(true)} compact={compact} disabled={!child} />
      </View>
    </View>
    <ChatTimeline items={child ? chat.messages : []} recentLimit={6} compact={compact} presentation="conversation" emptyState={empty}
      header={child && chat.nextCursor ? <View style={styles.earlier}><ChatAction label={chat.loadingOlder ? "正在讀取…" : "較早對話"} compact={compact}
        disabled={busy || chat.loading || chat.loadingOlder || !chat.online}
        onPress={() => { timelineRef.current?.holdReadingPosition(); void chatController.loadOlderMessages(); }} /></View> : undefined}
      footer={feedback} scrollRef={scrollRef} controlsRef={timelineRef} followRequest={followRequest} newReplyId={newReplyId} renderItem={message => {
        const run = message.agentRunId ? agentRuns[message.agentRunId] : undefined;
        const sourcesMatch = run?.text === message.text;
        const pendingReply = message.role === "user" && message.authorUserId === chat.userId && chat.messages.slice(-chat.limit).some(item => item.id === message.id)
          && !chat.messages.some(item => item.role === "model" && item.inReplyTo === message.id);
        return <ChatMessage message={{ id: message.id, role: message.role === "model" ? "assistant" : "user", text: message.text,
          phase: run ? runPhases[run.status] : undefined, sources: sourcesMatch ? run.citations : undefined }}
          phaseLabel={run?.status === "running" ? "運行仍在處理" : undefined} onLocateSource={locateSource}
          onOpenSource={run ? id => openAgentSource(run.id, id) : undefined}
          degraded={run?.retrievalMode === "keyword_degraded"} footer={<>
            {message.agentRunId ? <ChatAction label="詳情" accessibilityLabel="查看這則回覆的來源與候選" compact={compact}
              disabled={!chat.online || !!agentModel.busy || !!agentModel.pendingDecision || !!agentModel.writesBlocked || agentModel.readState === "denied"}
              onPress={target => { detailsTrigger.current = target; selectAgentRun(message.agentRunId!); setDetailsOpen(true); }} /> : null}
            {pendingReply ? <ChatAction label={chat.replyingMessageId === message.id ? "正在等候回覆" : "取得回覆"}
              accessibilityLabel="要求這則已保存訊息的回覆" compact={compact} disabled={busy || !chat.online || chat.loading || !chatWritesAllowed}
              onPress={() => { void requestChatReply(message.id); }} /> : null}
          </>} />;
      }} />
    <AgentComposer enabled={!!child && pathname === "/chat" && !busy && phase === "draft"} compact={compact} draft={chatDraft}
      attachments={agentAttachments} onChangeDraft={setChatDraft} onPreview={send} submitEnabled={canSend} submitLabel="送出"
      suggestionLabel="建議問題" inputHint={agentAttachments.length ? "請在上方保存及核對照片；照片不會隨文字自動交模型或共享。" : undefined}
      filesUnavailableReason="暫未支援文件，請使用文字" voiceUnavailableReason="暫未支援語音，請使用文字"
      onSources={() => actions.open("sources")} onAddAttachment={addAgentAttachment} onRemoveAttachment={removeAgentAttachment} focusRequest={composerFocusRequest} />
    <View style={styles.privacyFooter}><ChatAction label="Google AI 處理 · 僅供合成資料試用" accessibilityLabel="查看 Google AI 資料處理說明"
      onPress={() => setPrivacyOpen(true)} subtle /></View>
    <AgentConversation visible={detailsOpen} onClosed={restoreDetailsFocus} onDismiss={() => setDetailsOpen(false)} onOpenSettings={openSettings}
      onReloadChat={() => { void chatController.reloadMessages(); }} reloadDisabled={busy || chat.loading || !chat.online} />
    <AppDialog visible={privacyOpen} onDismiss={() => setPrivacyOpen(false)} accessibilityLabel="AI 資料處理說明">
      <AppDialog.Title>AI 資料處理</AppDialog.Title><AppDialog.Content><Text style={styles.body}>送出後會保存聊天並要求 AI 回覆。孩子稱呼及獲授權資料可能交由 Google 處理；試用時請只使用合成資料。</Text></AppDialog.Content>
      <AppDialog.Actions><AppButton label="知道了" variant="quiet" onPress={() => setPrivacyOpen(false)} /></AppDialog.Actions>
    </AppDialog>
  </>;
}
function ChatAction({ label, accessibilityLabel = label, onPress, disabled = false, compact = false, subtle = false }: {
  label: string; accessibilityLabel?: string; onPress(target: View | null): void; disabled?: boolean; compact?: boolean; subtle?: boolean;
}) {
  const actionRef = useRef<View | null>(null);
  return <Pressable ref={actionRef} accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityState={{ disabled }} aria-disabled={disabled}
    disabled={disabled} onPress={() => onPress(actionRef.current)} style={({ pressed, hovered, focused }: PressableStateCallbackType & { hovered?: boolean; focused?: boolean }) => [
      styles.action, compact && styles.compactAction, subtle && styles.subtleAction, disabled && styles.disabled,
      !disabled && (pressed || hovered) && styles.actionActive, focused && styles.actionFocused,
    ]}><Text style={subtle ? styles.meta : styles.actionLabel}>{label}</Text></Pressable>;
}
const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: chatColors.canvas },
  toolbar: { width: "100%", maxWidth: chatLayout.maxWidth, alignSelf: "center", flexShrink: 0, paddingHorizontal: chatLayout.wideInset,
    minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 },
  compactColumn: { paddingHorizontal: chatLayout.compactInset }, toolbarActions: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 },
  screenReaderTitle: { position: "absolute", width: 1, height: 1, overflow: "hidden", opacity: 0 },
  body: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.body },
  meta: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.meta },
  warning: { fontFamily: chatFont, color: colors.warningInk, ...chatType.tool },
  feedback: { gap: 10, minWidth: 0 }, statusRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  earlier: { alignItems: "center" }, emptyState: { alignItems: "center", gap: 12, paddingVertical: 28 },
  emptyTitle: { fontFamily: chatFont, color: chatColors.ink, fontSize: 28, lineHeight: 38, fontWeight: "500", textAlign: "center" },
  compactEmptyTitle: { fontSize: 24, lineHeight: 34 },
  action: { alignSelf: "flex-start", minHeight: 40, paddingHorizontal: 8, justifyContent: "center", borderRadius: 10 },
  compactAction: { minHeight: 48 }, subtleAction: { minHeight: 32, alignSelf: "center" },
  actionLabel: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.tool },
  actionActive: { backgroundColor: chatColors.hover }, actionFocused: { outlineColor: chatColors.focus, outlineWidth: 2, outlineStyle: "solid" },
  disabled: { opacity: .45 }, privacyFooter: { flexShrink: 0, paddingHorizontal: 8, paddingBottom: 4, marginTop: -8 },
});
