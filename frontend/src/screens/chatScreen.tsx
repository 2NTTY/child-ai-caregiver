import { BackgroundSurface, useCustomBackground } from "../components/appearance/BackgroundSurface";
import { ChatFileMessage } from '../production/ChatFileMessage';
import { VoiceMessage } from '../production/VoiceMessage';
import { OfficialHelpCards } from '../components/chat/OfficialHelpCards';
import { AGENT_PROGRESS_LABELS } from '../../../src/shared/agent-feedback';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "expo-router";
import { Platform, Pressable, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent, type PressableStateCallbackType, type ScrollView as NativeScrollView } from "react-native";
import { Text } from "react-native-paper";
import { AppButton, SectionCard } from "../components/ui";
import { AppScrollView } from "../components/AppScrollView";
import { AppDialog } from "../components/AppDialog";
import { StatusAnnouncement } from "../components/StatusAnnouncement";
import { AgentComposer } from "../components/agent/AgentComposer";
import { ChatMessage, ChatProgressIndicator } from "../components/chat/ChatMessage";
import { ChatTimeline, type ChatTimelineControls } from "../components/chat/ChatTimeline";
import { locateCitationSource } from "../components/chat/locateCitationSource";
import { chatColors, chatFont, chatLayout, chatType } from "../components/chat/chat-presentation";
import { useProduction } from "../production/ProductionProvider";
import { AgentConversation } from "../production/AgentConversation";
import { ChatPhotoMessage } from "../production/ChatPhotoMessage";
import { usePreviewLeaveGuard, usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { proposalExpired } from "../agent-view-model";
import { colors, mobileLayout } from "../theme";
import type { ChatReplyPhase } from "../chat-view-model";

const attachmentLeaveCopy = { message: "離開將移除未送出的附件；文字仍在本次暫存保留。", actionLabel: "移除附件並離開" };
const minimumTimelineHeight = 120;
const workspaceInsets = 16 * 2 + 1 * 2; // Page padding and reading-panel borders.
const runPhases = { running: "thinking", completed: "complete", stopped: "stopped", unknown: "unknown" } satisfies Record<string, ChatReplyPhase>;
export default function ChatPage() {
  const { scopeKey } = useProduction();
  const customBackground = useCustomBackground();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const [paneWidth, setPaneWidth] = useState(0);
  const [availableHeight, setAvailableHeight] = useState<number>();
  const [toolbarHeight, setToolbarHeight] = useState(0), [composerHeight, setComposerHeight] = useState(0);
  // A minimum height alone is unbounded inside a ScrollView. Keep the timeline
  // finite; only the measured controls plus a useful reading window may require
  // outer scrolling. RN Web onLayout reports layout units, not zoomed rectangles.
  const pageHeight = Math.max(availableHeight ?? viewportHeight,
    toolbarHeight + composerHeight + minimumTimelineHeight + workspaceInsets);
  return <View style={[styles.root, customBackground && styles.customRoot]} role="region" accessibilityLabel="助手" tabIndex={-1} {...(Platform.OS === "web" ? { dataSet: { pageSurface: "true" } } : {})}>
    <AppScrollView testID="chat-workspace-scroll" style={styles.workspaceScroll} contentContainerStyle={styles.workspaceContent} keyboardShouldPersistTaps="handled"
      onLayout={event => setAvailableHeight(event.nativeEvent.layout.height)}>
      <View testID="chat-page-layout" style={[styles.pageLayout, { height: pageHeight }]}>
        <ChatContents key={scopeKey ?? "no-authorized-child"} compact={(paneWidth || viewportWidth) < mobileLayout.breakpoint}
          onPaneLayout={event => setPaneWidth(event.nativeEvent.layout.width)}
          onToolbarLayout={event => setToolbarHeight(event.nativeEvent.layout.height)}
          onComposerLayout={event => setComposerHeight(event.nativeEvent.layout.height)} />
      </View>
    </AppScrollView>
  </View>;
}
function ChatContents({ compact, onPaneLayout, onToolbarLayout, onComposerLayout }: {
  compact: boolean; onPaneLayout?(event: LayoutChangeEvent): void;
  onToolbarLayout?(event: LayoutChangeEvent): void; onComposerLayout?(event: LayoutChangeEvent): void;
}) {
  const pathname = usePathname(), router = useRouter(), navigate = usePreviewNavigation();
  const { model, actions, scopeKey, chatState: chat, chatController, chatDraft, setChatDraft, agentAttachments,
    addAgentAttachment, removeAgentAttachment, composerFocusRequest, sendChat, requestChatReply, agentRuns, agentModel,
    voiceUpload, checkVoiceUpload, fileUpload, checkFileUpload, photoUpload, checkPhotoUpload, agentPending, readAgentPending, authorization, chatWritesAllowed, selectAgentRun, openAgentSource } = useProduction();
  const child = model.children.find(item => item.id === model.selectedChildId);
  const draft = child ? chat.drafts[child.id] : undefined;
  const phase = draft?.phase ?? "draft", busy = chat.busy !== null;
  const replyIndex = useMemo(() => ({
    recent: new Set(chat.messages.slice(-chat.limit).map(message => message.id)),
    answered: new Set(chat.messages.filter(message => message.role === "model").map(message => message.inReplyTo)),
  }), [chat.messages, chat.limit]);
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
  usePreviewLeaveGuard(agentAttachments.length > 0 && pathname === "/chat", voiceUpload.busy || voiceUpload.unknown || fileUpload.busy || fileUpload.unknown || photoUpload.busy || photoUpload.unknown, "child", attachmentLeaveCopy);
  const canSend = !!scopeKey && !!child && chat.selectedChildId === child.id && chat.online && !busy && !chat.loading
    && chatWritesAllowed && !voiceUpload.busy && !fileUpload.busy && !voiceUpload.unknown && !fileUpload.unknown && !photoUpload.busy && !photoUpload.unknown && (agentAttachments.length === 0 || agentAttachments.length === 1 && ["voice", "file", "photo"].includes(agentAttachments[0].kind)) && !!chat.loadedAt && phase === "draft" && (!!chatDraft.trim() || agentAttachments.some(v=>v.kind==="voice"||v.kind==="file"||v.kind==="photo")) && chatDraft.length <= 10_000;
  function send() {
    if (!canSend) return;
    setFollowRequest(`send-${Date.now()}`); return sendChat();
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
    navigate(() => router.push("/settings?section=assistant"), "workspace");
  }
  const replyRunning = chat.busy === "reply" || chat.remoteReply?.status === "running";
  const progressLabel = chat.busy === "save" ? "正在保存…"
    : chat.busy === "reply" ? (chat.feedback ? AGENT_PROGRESS_LABELS[chat.feedback.phase] : "已保存，正在等候回覆…")
      : chat.remoteReply?.status === "running" ? "原回覆仍在處理，毋須重新發送。" : null;
  const feedback = child ? <BackgroundSurface style={styles.feedback}>
    {photoUpload.busy?<Text accessibilityLiveRegion="polite" style={styles.meta}>正在保存照片…</Text>:null}
    {photoUpload.notice?<Text accessibilityRole="alert" style={styles.warning}>{photoUpload.notice}</Text>:null}
    {photoUpload.unknown?<AppButton label="查核原照片上傳" disabled={photoUpload.busy||!chat.online} onPress={checkPhotoUpload}/>:null}
    {fileUpload.busy?<Text accessibilityLiveRegion="polite" style={styles.meta}>正在上傳原檔；確認保存後才開始處理…</Text>:null}
    {fileUpload.notice?<Text accessibilityRole="alert" style={styles.warning}>{fileUpload.notice}</Text>:null}
    {fileUpload.unknown?<AppButton label="查核原檔案上傳" disabled={fileUpload.busy||!chat.online} onPress={checkFileUpload}/>:null}
    {voiceUpload.busy?<Text accessibilityLiveRegion="polite" style={styles.meta}>正在上傳原錄音；確認保存後才開始處理…</Text>:null}
    {voiceUpload.notice?<Text accessibilityRole="alert" style={styles.warning}>{voiceUpload.notice}</Text>:null}
    {voiceUpload.unknown?<AppButton label="查核原錄音上傳" disabled={voiceUpload.busy||!chat.online} onPress={checkVoiceUpload}/>:null}
    {chat.available === false ? <Text style={styles.meta}>AI 暫未開放，已保存訊息可稍後再要求回覆。</Text> : null}
    {!chat.online ? <Text accessibilityRole="alert" style={styles.warning}>{chat.messages.length ? "目前離線，所示聊天是上次讀取的快照；草稿仍保留。" : "目前離線，草稿仍保留。"}</Text> : null}
    {progressLabel ? <View testID="chat-operation-status" style={styles.progressRow}>
      <View style={styles.progressCopy}><ChatProgressIndicator /><Text accessibilityLiveRegion="polite" style={styles.progressLabel}>{progressLabel}</Text></View>
      {replyRunning ? <AppButton label="停止回覆" variant="quiet" density="compact" loading={chat.cancelling}
        disabled={chat.cancelling || !chat.online} onPress={() => { void chatController.cancelReply(); }} /> : null}
    </View> : null}
    {chat.busy === "reply" && chat.feedback?.cards.length ? <OfficialHelpCards ids={chat.feedback.cards} /> : null}
    {chat.error ? <Text accessibilityRole="alert" style={styles.error}>{chat.error}</Text> : null}
    {draft?.notice && (phase === "save_unknown" || phase === "checked" || phase === "reply_failed" || phase === "draft" && !!chatDraft.trim()) ? <Text accessibilityRole="alert" style={styles.warning}>{draft.notice}</Text> : null}
    {chat.replyError && chat.replyError !== draft?.notice ? <Text accessibilityRole="alert" style={styles.error}>{chat.replyError}</Text> : null}
    {chat.error || phase === "save_unknown" || phase === "checked" ? <AppButton label={phase === "save_unknown" || phase === "checked" ? "重新讀取並查核原保存" : "重試讀取聊天"}
      variant="quiet" density="compact" loading={chat.loading} disabled={busy || chat.loading || !chat.online} onPress={() => { void chatController.reloadMessages(); }} /> : null}
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

  </BackgroundSurface> : null;
  const confirmedEmptyChat = !!child && chat.selectedChildId === child.id && !chat.messages.length && !!chat.loadedAt
    && !chat.loadingOlder && !chat.nextCursor && !chat.error;
  const empty = !child ? <SectionCard><Text style={styles.body}>先選擇孩子。</Text><AppButton label="重新讀取子女檔案" onPress={actions.refresh} /></SectionCard>
    : chat.loading && !chat.loadedAt ? <BackgroundSurface padded frosted style={styles.emptyState}><ChatProgressIndicator /><Text accessibilityLiveRegion="polite" style={styles.meta}>正在讀取聊天…</Text></BackgroundSurface>
      : confirmedEmptyChat && !busy && !agentAttachments.length && phase === "draft" ? <BackgroundSurface padded frosted testID="chat-empty-prompt" style={styles.emptyState}>
        <Text accessibilityRole="header" aria-level={2} style={[styles.emptyTitle, compact && styles.compactEmptyTitle]}>想先聊聊什麼？</Text></BackgroundSurface> : null;
  return <>
    <StatusAnnouncement eventKey={chat.loading && !!chat.loadedAt ? "refreshing" : "settled"} message={chat.loading && !!chat.loadedAt ? "正在重新核對聊天。" : ""} />
    <BackgroundSurface frosted testID="chat-top-toolbar" onLayout={onToolbarLayout} style={[styles.toolbar, compact && styles.compactColumn]}>
      <View style={styles.titleCopy}><Text testID="chat-screen-reader-heading" accessibilityRole="header" aria-level={1} style={styles.title}>與助手整理照顧</Text><Text style={styles.meta}>交代情況、討論問題，重要內容由你核對。</Text></View>
      <View style={styles.toolbarActions}>
        <ChatAction label="資料使用說明" accessibilityLabel="查看 AI 資料處理說明" onPress={() => setPrivacyOpen(true)} compact={compact} />
        <ChatAction label={agentModel.pendingDecision ? "活動 · 待查核" : needsDecision ? "活動 · 待確認" : pendingReadLabel ? `活動 · ${pendingReadLabel}` : "活動"}
          accessibilityLabel={agentModel.pendingDecision ? "對話詳情與活動，原決定待查核" : needsDecision ? "對話詳情與活動，有事項待確認" : pendingReadLabel ? `對話詳情與活動，待確認事項${pendingReadLabel}` : "對話詳情與活動"} onPress={() => setDetailsOpen(true)} compact={compact} disabled={!child} />
      </View>
    </BackgroundSurface>
    <BackgroundSurface frosted testID="chat-reading-panel" onLayout={onPaneLayout} style={styles.readingPanel} activeStyle={styles.boundedReadingPanel}>
    <View testID="chat-timeline-frame" style={styles.timelineFrame}><ChatTimeline items={child ? chat.messages : []} recentLimit={6} compact={compact} presentation="conversation" emptyState={empty}
      history={{ cursor: child ? chat.nextCursor : null, loading: chat.loadingOlder,
        enabled: !!child && !busy && !chat.loading && chat.online, load: () => chatController.loadOlderMessages() }}
      footer={feedback} scrollRef={scrollRef} controlsRef={timelineRef} followRequest={followRequest} newReplyId={newReplyId} renderItem={message => {
        const run = message.agentRunId ? agentRuns[message.agentRunId] : undefined;
        const sourcesMatch = run?.text === message.text || !!run?.text && !!run.stopReasonLabel
          && (run.status === "stopped" || run.status === "unknown")
          && message.text === `這次回覆未完成：${run.stopReasonLabel}。\n\n${run.text}`;
        const pendingReply = message.role === "user" && message.authorUserId === chat.userId && replyIndex.recent.has(message.id)
          && !replyIndex.answered.has(message.id);
        return <ChatMessage message={{ id: message.id, role: message.role === "model" ? "assistant" : "user", text: message.text,
          phase: run ? runPhases[run.status] : undefined, sources: sourcesMatch ? run.citations : undefined }}
          phaseLabel={run?.status === "running" ? "運行仍在處理" : undefined} onLocateSource={locateSource}
          onOpenSource={run ? id => openAgentSource(run.id, id) : undefined}
          header={<>
            {message.photo?<ChatPhotoMessage key={`${scopeKey}:${message.photo.id}`} photo={message.photo}/>:null}
            {message.file?<ChatFileMessage messageId={message.id} file={message.file}/>:null}
            {message.voice?<VoiceMessage messageId={message.id} voice={message.voice}/>:null}
            {message.role === "model" && message.officialHelp?.length ? <OfficialHelpCards ids={message.officialHelp} /> : null}
            {run && (run.status === "stopped" || run.status === "unknown") && run.stopReasonLabel && !message.text.startsWith("這次回覆未完成：")
              ? <Text accessibilityRole="alert" style={styles.warning}>這次回覆未完成：{run.stopReasonLabel}。</Text> : null}
          </>}
          degraded={run?.retrievalMode === "keyword_degraded"} footer={message.agentRunId || pendingReply ? <>
            {message.agentRunId ? <ChatAction label="詳情" accessibilityLabel="查看這則回覆的來源與候選" compact={compact}
              disabled={!chat.online || !!agentModel.busy || !!agentModel.pendingDecision || !!agentModel.writesBlocked || agentModel.readState === "denied"}
              onPress={target => { detailsTrigger.current = target; selectAgentRun(message.agentRunId!); setDetailsOpen(true); }} /> : null}
            {pendingReply ? <ChatAction label={chat.replyingMessageId === message.id ? "正在等候回覆" : message.agentRunId ? "查核原回覆" : "取得回覆"}
              accessibilityLabel="要求這則已保存訊息的回覆" compact={compact} disabled={busy || !chat.online || chat.loading || !chatWritesAllowed}
              onPress={() => { void requestChatReply(message.id); }} /> : null}
          </> : undefined} />;
      }} /></View>
    <View testID="chat-composer-frame" onLayout={onComposerLayout} style={styles.composerFrame}><AgentComposer enabled={!!child && pathname === "/chat" && !busy && !voiceUpload.busy && !voiceUpload.unknown && !fileUpload.busy && !fileUpload.unknown && !photoUpload.busy && !photoUpload.unknown && phase === "draft"} compact={compact} draft={chatDraft}
      attachments={agentAttachments} onChangeDraft={setChatDraft} onPreview={send} submitEnabled={canSend} submitLabel="送出"
      suggestionLabel="建議問題" suggestionsAvailable={confirmedEmptyChat} inputHint={agentAttachments.some(v=>v.kind==="voice") ? "按送出會保存錄音並交 AI 理解；背景補上的轉錄不會再次執行指令。" : agentAttachments.some(v=>v.kind==="file") ? "按送出會保存原檔，並讓助手按你的要求讀取及處理。" : agentAttachments.length ? "按送出會保存照片，並交給目前選用的模型按你的要求處理。" : undefined}
      onSources={() => actions.open("sources")} onAddAttachment={addAgentAttachment} onRemoveAttachment={removeAgentAttachment} focusRequest={composerFocusRequest} /></View>

    </BackgroundSurface>
    <AgentConversation visible={detailsOpen} onClosed={restoreDetailsFocus} onDismiss={() => setDetailsOpen(false)} onOpenSettings={openSettings}
      onReloadChat={() => { void chatController.reloadMessages(); }} reloadDisabled={busy || chat.loading || !chat.online} />
    <AppDialog visible={privacyOpen} onDismiss={() => setPrivacyOpen(false)} accessibilityLabel="AI 資料處理說明">
      <AppDialog.Title>AI 資料處理</AppDialog.Title><AppDialog.Content><Text style={styles.body}>送出後會保存聊天並要求 AI 回覆。獲授權的文字或照片會交由 Google 或你選用的模型供應商處理；私人來源不加入公共知識庫，通知及分享仍需另外授權。</Text></AppDialog.Content>
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
  customRoot: { backgroundColor: "transparent", padding: 12 },
  pageLayout: { flexShrink: 0, minWidth: 0, width: "100%", maxWidth: 1120, alignSelf: "center", padding: 16 },
  workspaceScroll: { flex: 1, minHeight: 0 }, workspaceContent: { flexGrow: 1 },
  timelineFrame: { flex: 1, minHeight: minimumTimelineHeight }, composerFrame: { flexShrink: 0, borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: 12 },
  titleCopy: { minWidth: 0, flexShrink: 1, gap: 4 }, title: { fontFamily: chatFont, fontSize: 26, lineHeight: 36, fontWeight: "700", color: chatColors.ink },
  readingPanel: { flex: 1, minHeight: 0, minWidth: 0, width: "100%", backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: 16, overflow: "hidden" },
  boundedReadingPanel: { maxWidth: chatLayout.maxWidth, alignSelf: "center" },
  root: { flex: 1, minHeight: 0, backgroundColor: chatColors.canvas },
  toolbar: { width: "100%", flexShrink: 0, paddingHorizontal: chatLayout.wideInset,
    minHeight: 92, paddingVertical: 12, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 },
  compactColumn: { paddingHorizontal: chatLayout.compactInset }, toolbarActions: { flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 },
  body: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.body },
  meta: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.meta },
  warning: { fontFamily: chatFont, color: colors.warningInk, ...chatType.tool },
  error: { fontFamily: chatFont, color: colors.errorInk, ...chatType.tool },
  feedback: { gap: 10, minWidth: 0 }, statusRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  progressRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, minWidth: 0 },
  progressCopy: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0, flexShrink: 1 },
  progressLabel: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.tool, flexShrink: 1 }, emptyState: { alignItems: "flex-start", gap: 12, paddingVertical: 40, paddingHorizontal: 16 },
  emptyTitle: { fontFamily: chatFont, color: chatColors.ink, fontSize: 28, lineHeight: 38, fontWeight: "500", textAlign: "left" },
  compactEmptyTitle: { fontSize: 24, lineHeight: 34 },
  action: { alignSelf: "flex-start", minHeight: 40, paddingHorizontal: 8, justifyContent: "center", borderRadius: 10 },
  compactAction: { minHeight: 48 }, subtleAction: { minHeight: 32, alignSelf: "center" },
  actionLabel: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.tool },
  actionActive: { backgroundColor: chatColors.hover }, actionFocused: { outlineColor: chatColors.focus, outlineWidth: 2, outlineStyle: "solid" },
  disabled: { opacity: .45 },
});
