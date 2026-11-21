import { BackgroundSurface, useCustomBackground } from "../components/appearance/BackgroundSurface";
import { ChatFileMessage } from '../production/ChatFileMessage';
import { RegisteredReadingCard } from '../production/RegisteredReadingCard';
import { VoiceMessage } from '../production/VoiceMessage';
import { OfficialHelpCards, ProgressSourceCards } from '../components/chat/OfficialHelpCards';
import {
  AGENT_PROGRESS_LABELS,
  isIncompleteModelReplyText,
  matchOfficialHelpForText,
  OFFICIAL_HELP_ENTRY_COPY,
} from '../../../src/shared/agent-feedback';
import { agentStopMessage } from '../../../src/shared/agent-stop-message';
import { failedChatReply } from '../components/chat/failed-reply';
import { CHILD_PROFILES_CHAT_TEXT, matchesLegacyDirectoryQuestion } from '../../../src/shared/chat-workspace-view';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocalSearchParams, usePathname, useRouter } from "expo-router";
import { Platform, ScrollView, StyleSheet, View, useWindowDimensions, type LayoutChangeEvent, type ScrollView as NativeScrollView } from "react-native";
import { Text } from "react-native-paper";
import { AppButton, SectionCard } from "../components/ui";
import { AppDialog } from "../components/AppDialog";
import { StatusAnnouncement } from "../components/StatusAnnouncement";
import { AgentComposer } from "../components/agent/AgentComposer";
import { ChatMessage, ChatProgressIndicator } from "../components/chat/ChatMessage";
import { ChatAction } from "../components/chat/ChatAction";
import { CompanionSlot } from "../components/companion/CompanionViewport";
import { ChatTimeline, type ChatTimelineControls } from "../components/chat/ChatTimeline";
import { locateCitationSource } from "../components/chat/locateCitationSource";
import { chatColors, chatFont, chatLayout, chatType } from "../components/chat/chat-presentation";
import { useProduction } from "../production/ProductionProvider";
import { AgentConversation } from "../production/AgentConversation";
import { ChatPhotoMessage } from "../production/ChatPhotoMessage";
import { NotificationChatTarget } from "../production/NotificationChatTarget";
import { AssistantByline } from '../components/chat/AssistantByline';
import { conversationTurns } from '../components/chat/conversation-turns';
import { QuestionDiscussion } from '../components/chat/QuestionDiscussion';
import { useChatExposure, useChatForeground } from "../production/useChatExposure";
import { usePreviewLeaveGuard, usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { proposalNeedsConfirmation, publicAnswerSources } from "../agent-view-model";
import { colors, mobileLayout } from "../theme";
import type { ChatReplyPhase } from "../chat-view-model";

const attachmentLeaveCopy = { message: "離開將移除未送出的附件；文字仍在本次暫存保留。", actionLabel: "移除附件並離開" };
const runPhases = { running: "thinking", completed: "complete", stopped: "stopped", unknown: "unknown" } satisfies Record<string, ChatReplyPhase>;
export default function ChatPage() {
  const { scopeKey } = useProduction();
  const { messageId } = useLocalSearchParams<{ messageId?: string }>();
  const customBackground = useCustomBackground();
  const viewportWidth = useWindowDimensions().width;
  const [paneWidth, setPaneWidth] = useState(0);
  return <View style={[styles.root, customBackground && styles.customRoot]} role="region" accessibilityLabel="助手" tabIndex={-1} {...(Platform.OS === "web" ? { dataSet: { pageSurface: "true" } } : {})}>
    <View testID="chat-page-layout" style={styles.pageLayout} onLayout={event => setPaneWidth(event.nativeEvent.layout.width)}>
      <ChatContents key={scopeKey ?? "no-authorized-child"} compact={(paneWidth || viewportWidth) < mobileLayout.breakpoint} />
    </View>
    <NotificationChatTarget key={`${scopeKey}:${messageId}`} />
  </View>;
}
function ChatContents({ compact }: { compact: boolean }) {
  const pathname = usePathname(), router = useRouter(), navigate = usePreviewNavigation();
  const { messageId: notificationMessageId } = useLocalSearchParams<{ messageId?: string }>();
  const { model, actions, owner, scopeKey, chatState: chat, chatController, chatDraft, setChatDraft, agentAttachments,
    addAgentAttachment, removeAgentAttachment, composerFocusRequest, sendChat, requestChatReply, agentRuns, agentModel,
    voiceUpload, checkVoiceUpload, fileUpload, checkFileUpload, photoUpload, checkPhotoUpload, agentPending, readAgentPending, authorization, chatWritesAllowed, selectAgentRun, openAgentSource } = useProduction();
  const { height: viewportHeight, fontScale = 1 } = useWindowDimensions();
  const child = model.children.find(item => item.id === model.selectedChildId);
  const draft = child ? chat.drafts[child.id] : undefined;
  const phase = draft?.phase ?? "draft", busy = chat.busy !== null;
  const scrollRef = useRef<NativeScrollView | null>(null), timelineRef = useRef<ChatTimelineControls | null>(null);
  const [followRequest, setFollowRequest] = useState<string>();
  const detailsTrigger = useRef<View | null>(null);
  const [activityEntry, setActivityEntry] = useState<"list" | "detail">("list");
  const [paneHeight, setPaneHeight] = useState(0);
  const [discussNext, setDiscussNext] = useState(false);
  const [openedDiscussion, setOpenedDiscussion] = useState<string>();
  useEffect(() => { if (pathname !== '/chat') setDiscussNext(false); }, [pathname]);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const handlePaneLayout = (event: LayoutChangeEvent) => {
    setPaneHeight(event.nativeEvent.layout.height);
  };
  const foreground = useChatForeground(), [visibleIds, setVisibleIds] = useState<string[]>([]);
  useChatExposure(foreground && pathname === "/chat" && !notificationMessageId && !detailsOpen && !optionsOpen, visibleIds);
  const displayedMessages = visibleIds.length ? chat.messages.filter(message => visibleIds.includes(message.id)) : chat.messages.slice(-6);
  const turns = useMemo(() => conversationTurns(chat.messages), [chat.messages]);
  const displayedRuns = displayedMessages.flatMap(message => {
    const discussion = turns.discussions.get(message.id);
    const discussionRunId = discussion?.reply?.agentRunId ?? discussion?.question.agentRunId;
    const ids = message.role === 'model' && message.agentRunId ? [message.agentRunId] : [];
    return discussionRunId ? [...ids, discussionRunId] : ids;
  }).join(',');
  useEffect(() => {
    if (pathname !== '/chat' || !scopeKey || !chat.online || !displayedRuns || chat.selectedChildId !== child?.id) return;
    const read = new AbortController();
    void owner.agentOwner.readChatEvidence(scopeKey, displayedRuns.split(','), read.signal);
    return () => read.abort();
  }, [owner, pathname, scopeKey, chat.online, chat.selectedChildId, child?.id, displayedRuns]);
  const previous = useRef({ ids: new Set(chat.messages.map(item => item.id)), busy: chat.busy });
  const lastMessage = chat.messages[chat.messages.length - 1];
  const newReplyId = lastMessage?.role === "model" && !previous.current.ids.has(lastMessage.id) && previous.current.busy === "reply" ? lastMessage.id : undefined;
  useLayoutEffect(() => { previous.current = { ids: new Set(chat.messages.map(item => item.id)), busy: chat.busy }; }, [chat.messages, chat.busy]);
  useEffect(() => { if (agentModel.pendingDecision) setDetailsOpen(true); }, [agentModel.pendingDecision?.runId, agentModel.pendingDecision?.proposalId]);
  useEffect(() => { if (scopeKey && chat.online) readAgentPending(); }, [scopeKey, chat.online]);
  const needsDecision = agentModel.readState === "ready" && agentModel.run?.proposals.some(proposalNeedsConfirmation)
    || agentPending.state === "ready" && agentPending.entries.some(item => proposalNeedsConfirmation(item.proposal));
  const pendingReadLabel = agentPending.state === "idle" ? "尚未讀取" : agentPending.state === "loading" ? "讀取中"
    : agentPending.state === "failed" ? "讀取失敗" : agentPending.state === "denied" ? "無法讀取" : null;
  const locateSource = (target: View | null, horizontalScroll?: NativeScrollView | null, verticalTarget?: View | null) => {
    timelineRef.current?.holdReadingPosition(); locateCitationSource(target, scrollRef.current, horizontalScroll, verticalTarget);
  };
  usePreviewLeaveGuard(agentAttachments.length > 0 && pathname === "/chat", voiceUpload.busy || voiceUpload.unknown || fileUpload.busy || fileUpload.unknown || photoUpload.busy || photoUpload.unknown, "child", attachmentLeaveCopy);
  const remoteReplyStillRunning = chat.remoteReply?.status === "running"
    && !chat.messages.some(item => item.role === "model" && item.inReplyTo === chat.remoteReply?.messageId);
  const replyRunning = chat.busy === "reply" || remoteReplyStillRunning;
  const activeReplyId = chat.replyingMessageId ?? (remoteReplyStillRunning ? chat.remoteReply?.messageId : null);
  const stopPending = chat.cancelling || !!activeReplyId && chat.cancelAcceptedFor === activeReplyId;
  const submittedDraft = !!draft?.savedUserMessageId && (phase === "replying" || phase === "reply_failed");
  const composerText = submittedDraft ? draft.nextText ?? "" : chatDraft;
  const canSend = !replyRunning && !!scopeKey && !!child && chat.selectedChildId === child.id && chat.online && !busy && !chat.loading
    && chatWritesAllowed && !voiceUpload.busy && !fileUpload.busy && !voiceUpload.unknown && !fileUpload.unknown && !photoUpload.busy && !photoUpload.unknown && (agentAttachments.length === 0 || agentAttachments.length === 1 && ["voice", "file", "photo"].includes(agentAttachments[0].kind)) && !!chat.loadedAt && phase === "draft" && (!!chatDraft.trim() || agentAttachments.some(v=>v.kind==="voice"||v.kind==="file"||v.kind==="photo")) && chatDraft.length <= 10_000;
  function send() {
    if (!canSend) return;
    setFollowRequest(`send-${Date.now()}`);
    setDiscussNext(false);
    return discussNext ? sendChat({ discussion: true }) : sendChat();
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
  const childScopedChat = !!child && chat.selectedChildId === child.id;
  const scopedMessages = childScopedChat ? chat.messages : [];
  const scopedFeedback = childScopedChat && chatWritesAllowed ? chat.feedback : null;
  // The controller owns the post-failure target. The newest visible message may predate an explicit retry.
  const replying = chat.busy === "reply";
  const targetId = replying ? chat.replyingMessageId : scopedFeedback?.messageId
    ?? (phase === "reply_failed" ? draft?.savedUserMessageId : null);
  const candidate = targetId || replying
    ? scopedMessages.find(item => item.role === "user" && item.id === targetId)
    : [...scopedMessages].reverse().find(item => item.role === "user");
  const helpMessage = !chatWritesAllowed || chat.busy === "save" || (!replying && candidate?.id === draft?.dismissedHelpMessageId) ? undefined : candidate;
  const turnReplies = helpMessage
    ? scopedMessages.filter(item => item.role === "model" && item.inReplyTo === helpMessage.id)
    : [];
  // Timeline order is oldest first. A successful later result supersedes a stopped row for the same turn.
  const currentReply = turnReplies[turnReplies.length - 1];
  const supersededRun = (id: string) => !!currentReply && currentReply.agentRunId !== id
    && turnReplies.some(item => item !== currentReply && item.agentRunId === id);
  const remote = chat.remoteReply;
  const cachedStatus = currentReply?.agentRunId ? agentRuns[currentReply.agentRunId]?.status : undefined;
  const matchingRemote = remote && remote.messageId === helpMessage?.id && !supersededRun(remote.runId)
    && (!currentReply?.agentRunId || remote.runId === currentReply.agentRunId) ? remote : null;
  const currentStatus = matchingRemote?.status ?? cachedStatus;
  const unfinishedReply = !!currentReply && (currentStatus === "running" || currentStatus === "stopped" || currentStatus === "unknown"
    || isIncompleteModelReplyText(currentReply.text));
  const turnFeedback = helpMessage && scopedFeedback?.messageId === helpMessage.id
    && (replying || !supersededRun(scopedFeedback.runId)) ? scopedFeedback : null;
  const showTurnHelp = !!helpMessage && (
    replying || !currentReply || unfinishedReply || !!(turnFeedback?.cards?.length || turnFeedback?.sources?.length)
  );
  const savedHelp = !turnFeedback?.cards?.length && unfinishedReply && (!turnFeedback || !currentReply.agentRunId || turnFeedback.runId === currentReply.agentRunId)
    ? currentReply.officialHelp ?? [] : [];
  const currentDraftHelp = (childScopedChat && (chatWritesAllowed || phase === "draft") || !child && !chat.selectedChildId)
    ? matchOfficialHelpForText(composerText) : [];
  const autoHelpIds = [
    ...new Set([
      ...currentDraftHelp,
      ...(showTurnHelp && helpMessage ? matchOfficialHelpForText(helpMessage.text) : []),
      ...(turnFeedback?.cards ?? []),
      ...savedHelp,
    ]),
  ];
  const hasEmergencyHelp = autoHelpIds.includes("emergency-hk-v1");
  const hasMedicalConsultHelp = !hasEmergencyHelp && autoHelpIds.includes("medical-consult-hk-v1");
  const progressLabel = chat.busy === "save" ? "正在保存…"
    : replying ? (turnFeedback ? AGENT_PROGRESS_LABELS[turnFeedback.phase] : "已保存，正在等候回覆…")
      : remoteReplyStillRunning ? "原回覆仍在處理，毋須重新發送。" : null;
  // Leave room for the composer when a contextual card opens on a short screen.
  const measuredPaneHeight = paneHeight > 0 ? paneHeight : Math.max(0, (viewportHeight || 640) - 180);
  const preferredDockHeight = Math.min(220, Math.max(132, Math.round((viewportHeight || 640) * (compact || fontScale > 1.25 ? 0.28 : 0.34))));
  const maxHelpDockHeight = Math.min(preferredDockHeight, Math.max(56, measuredPaneHeight - 168));
  const officialHelpPanel = autoHelpIds.length > 0 ? <View testID="chat-official-help-dock" style={[styles.helpDock, compact && styles.compactColumn, { maxHeight: maxHelpDockHeight }]}>
    <ScrollView nestedScrollEnabled style={styles.helpDockScroll} contentContainerStyle={styles.helpDockContent}>
      <BackgroundSurface testID="chat-official-help-panel" style={styles.feedback}>
        {hasEmergencyHelp ? <Text testID="chat-official-help-urgent-notice" accessibilityRole="alert" style={styles.warning}>{OFFICIAL_HELP_ENTRY_COPY.urgentNotice}</Text> : null}
        {hasMedicalConsultHelp ? <Text testID="chat-official-help-consult-notice" accessibilityLiveRegion="polite" style={styles.meta}>{OFFICIAL_HELP_ENTRY_COPY.medicalConsultNotice}</Text> : null}
        <OfficialHelpCards ids={autoHelpIds} />
      </BackgroundSurface>
    </ScrollView>
  </View> : null;
  const savedFailure = currentReply && unfinishedReply && failedChatReply(currentReply.text,
    currentReply.agentRunId ? agentRuns[currentReply.agentRunId]?.stopReasonLabel : undefined);
  const savedDraftReply = !!draft?.savedUserMessageId && scopedMessages.some(m => m.inReplyTo === draft.savedUserMessageId);
  const recoveryRowId = phase === 'reply_failed' && savedFailure && currentReply?.inReplyTo === draft?.savedUserMessageId
    && turns.rows.slice(-6).some(row => row.id === currentReply.id) ? currentReply.id : undefined;
  const showDraftNotice = phase === 'save_unknown' || phase === 'checked' || phase === 'draft' && !!chatDraft.trim()
    || phase === 'reply_failed' && !(savedFailure && currentReply?.inReplyTo === draft?.savedUserMessageId);
  const sameFailureNotice = savedFailure && (!remote || remote.messageId === currentReply?.inReplyTo)
    && (chat.replyError?.startsWith('這次回覆未完成，') || chat.replyError === savedFailure.reason);
  const replyNotice = sameFailureNotice ? null : chat.replyError;
  const notice = (showDraftNotice && draft?.notice) || replyNotice;
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
      <View style={styles.progressCopy}><ChatProgressIndicator /><Text accessibilityLiveRegion="polite" style={styles.progressLabel}>{stopPending && replyRunning ? "正在停止…" : progressLabel}</Text></View>
    </View> : null}
    {turnFeedback?.sources?.length
      ? <ProgressSourceCards sources={turnFeedback.sources} reviewing={replying && turnFeedback.phase === "reviewing"} retainedAfterFailure={!replying} />
      : null}
    {chat.error ? <Text accessibilityRole="alert" style={styles.error}>{chat.error}</Text> : null}
    {notice && notice !== chat.error ? <Text accessibilityRole="alert" style={styles.warning}>{notice}</Text> : null}
    {chat.error || phase === "save_unknown" || phase === "checked" ? <AppButton label={phase === "save_unknown" || phase === "checked" ? "重新讀取並查核原保存" : "重試讀取聊天"}
      variant="quiet" density="compact" loading={chat.loading} disabled={busy || chat.loading || !chat.online} onPress={() => { void chatController.reloadMessages(); }} /> : null}
    {chat.cancelNotice ? <Text accessibilityLiveRegion="polite" style={styles.warning}>{chat.cancelNotice}</Text> : null}
    {phase === "checked" ? <View style={styles.statusRow}>
      {draft?.candidateMessageId ? <AppButton label="已核對，確認這則聊天已保存" variant="quiet" disabled={busy} onPress={() => chatController.confirmFoundMessage()} /> : null}
      <AppButton label="已核對，解鎖原文重試" variant="quiet" disabled={busy || !chat.online} onPress={() => chatController.unlockCheckedSave()} /></View> : null}
    {phase === "reply_failed" && draft?.savedUserMessageId && !recoveryRowId ? <View style={styles.statusRow}>
      <ChatAction label={savedDraftReply ? '查核原回覆' : '重試原訊息回覆'} disabled={busy || !chat.online || chat.loading || !chatWritesAllowed}
        onPress={() => { void requestChatReply(draft.savedUserMessageId!); }} />
      <ChatAction label="開始新訊息" disabled={busy} onPress={() => chatController.startNewMessage()} /></View> : null}
    {!busy && turnFeedback && (turnFeedback.cards?.length || turnFeedback.sources?.length)
      && !(remote?.messageId === turnFeedback.messageId && remote.status === "running") && turnFeedback.messageId !== draft?.savedUserMessageId
      ? <AppButton label="收起這次查核提示" variant="quiet" density="compact"
        onPress={() => chatController.dismissRetainedFeedback(turnFeedback.messageId)} /> : null}
    {authorization.pending ? <View style={styles.statusRow}><Text accessibilityRole="alert" style={styles.warning}>助手設定的原操作待查核。</Text>
      <ChatAction label="前往查核" onPress={openSettings} compact={compact} /></View> : null}

  </BackgroundSurface> : null;
  const timelineFooter = feedback ? <View style={styles.feedback}>{feedback}</View> : null;
  const confirmedEmptyChat = !!child && chat.selectedChildId === child.id && !chat.messages.length && !!chat.loadedAt
    && !chat.loadingOlder && !chat.nextCursor && !chat.error;
  const welcome = confirmedEmptyChat && !busy && !agentAttachments.length && phase === 'draft';
  const empty = !child ? <SectionCard><Text style={styles.body}>先選擇孩子。</Text><AppButton label="重新讀取子女檔案" onPress={actions.refresh} /></SectionCard>
    : chat.loading && !chat.loadedAt ? <BackgroundSurface padded frosted style={styles.emptyState}><ChatProgressIndicator /><Text accessibilityLiveRegion="polite" style={styles.meta}>正在讀取聊天…</Text></BackgroundSurface> : null;
  return <>
    <StatusAnnouncement eventKey={chat.loading && !!chat.loadedAt ? "refreshing" : "settled"} message={chat.loading && !!chat.loadedAt ? "正在重新核對聊天。" : ""} />
    <BackgroundSurface frosted testID="chat-top-toolbar" style={[styles.toolbar, compact && styles.compactColumn]}>
      <View style={styles.headerIdentity}>
        {compact && <CompanionSlot quietHeight={78} />}
        <View><Text testID="chat-screen-reader-heading" accessibilityRole="header" style={styles.headingTitle}>育有方助手</Text>
          {child && <Text style={styles.meta}>{child.displayName}的私人對話</Text>}</View>
      </View>
      <View style={styles.toolbarActions}>
        <ChatAction icon="clock-outline" label={agentModel.pendingDecision ? '活動 · 待查核' : needsDecision ? '活動 · 待確認' : compact ? '活動' : '對話活動'}
          accessibilityLabel={agentModel.pendingDecision ? "對話詳情與活動，原決定待查核" : needsDecision ? "對話詳情與活動，有事項待確認" : pendingReadLabel ? `對話詳情與活動，待確認事項${pendingReadLabel}` : "對話詳情與活動"}
          onPress={target => { detailsTrigger.current = target; setActivityEntry("list"); setDetailsOpen(true); }} compact={compact} disabled={!child} />
        <ChatAction label="更多助手選項" icon="dots-horizontal" iconOnly expanded={optionsOpen} onPress={() => setOptionsOpen(true)} />
      </View>
    </BackgroundSurface>
    <View style={styles.conversationLayout}>
    <BackgroundSurface frosted testID="chat-reading-panel" onLayout={handlePaneLayout} style={[styles.readingPanel, welcome && styles.welcomePanel]} activeStyle={styles.boundedReadingPanel}>
    {welcome ? <View testID="chat-empty-prompt" style={styles.welcome}><Text accessibilityRole="header" style={[styles.emptyTitle, compact && styles.compactEmptyTitle]}>想先聊聊甚麼？</Text></View> : <ChatTimeline items={childScopedChat ? turns.rows : []} recentLimit={6} compact={compact} presentation="conversation" emptyState={empty}
      onVisibleItems={ids => setVisibleIds(previous => previous.join(",") === ids.join(",") ? previous : ids)}
      history={{ cursor: child ? chat.nextCursor : null, loading: chat.loadingOlder,
        enabled: !!child && !busy && !chat.loading && chat.online, load: () => chatController.loadOlderMessages() }}
      footer={timelineFooter} scrollRef={scrollRef} controlsRef={timelineRef} followRequest={followRequest} newReplyId={newReplyId} renderItem={message => {
        const run = message.agentRunId ? agentRuns[message.agentRunId] : undefined;
        const sourcesMatch = run?.text === message.text || !!run?.text && !!run.stopReasonLabel
          && (run.status === "stopped" || run.status === "unknown")
          && message.text === `這次回覆未完成：${run.stopReasonLabel}。\n\n${run.text}`;
        const stoppedWithoutQueue = run?.status === "stopped" && run.stopReasonLabel === agentStopMessage("busy")
          || chat.remoteReply?.messageId === message.id && chat.remoteReply.status === "stopped" && chat.remoteReply.stopReason === "busy";
        const repliesToMessage = message.role === "user" ? scopedMessages.filter(item => item.role === "model" && item.inReplyTo === message.id) : [];
        const hasModelReply = repliesToMessage.length > 0;
        const detailsOnReply = !!message.agentRunId && repliesToMessage.some(item => item.agentRunId === message.agentRunId);
        const effectiveRunStatus = run?.status === "running" && (message.role === "model" || hasModelReply) ? "completed" : run?.status;
        const pendingReply = message.role === "user" && message.authorUserId === chat.userId && chat.messages.slice(-chat.limit).some(item => item.id === message.id)
          && !hasModelReply
          && !stoppedWithoutQueue;
        const failure = message.role === "model" && (effectiveRunStatus === "stopped" || effectiveRunStatus === "unknown" || !effectiveRunStatus)
          ? failedChatReply(message.text, run?.stopReasonLabel) : null;
        const original = message.inReplyTo ? scopedMessages.find(row => row.id === message.inReplyTo && row.role === "user") : undefined;
        const linked = turns.discussions.get(message.id);
        const followup = linked?.question, discussionReply = linked?.reply;
        const linkedRunId = discussionReply?.agentRunId ?? followup?.agentRunId;
        const discussionRun = linkedRunId ? agentRuns[linkedRunId] : original?.discussion ? run : undefined;
        const discussionQuestion = followup ?? (original?.discussion ? original : message.discussion && !hasModelReply ? message : undefined);
        const discussionActive = !!discussionQuestion && activeReplyId === discussionQuestion.id && replyRunning;
        const discussionState = discussionActive ? (scopedFeedback?.messageId === discussionQuestion?.id
          ? AGENT_PROGRESS_LABELS[scopedFeedback.phase] : '討論進行中，發言核對後會在這裏顯示。')
          : discussionRun?.status === 'completed' ? discussionRun.discussion?.length ? '已完成部分觀點。' : '這次討論沒有可顯示的觀點。'
          : discussionRun?.stopReasonLabel ?? (discussionRun?.status === 'unknown' ? '結果待核對。'
            : chat.remoteReply?.messageId === discussionQuestion?.id && chat.remoteReply?.status === 'stopped' ? '討論已停止。'
            : message.role === 'user' && !message.agentRunId ? '討論尚未開始。' : '正在等候原討論結果。');
        const directoryMarker = message.role === "model" && message.text === CHILD_PROFILES_CHAT_TEXT;
        const mismatchedDirectory = directoryMarker && !!original && !matchesLegacyDirectoryQuestion(original.text);
        const childProfiles = message.role === "model" && !!message.agentRunId && !!child && child.id === chat.selectedChildId
          && directoryMarker && !!original && !mismatchedDirectory && !!run?.showChildProfiles && sourcesMatch;
        const inlineSteps = failure && run?.readOnlyStop ? run.tools.map(tool => ({
          id: tool.id, label: tool.nameLabel, state: tool.status === "succeeded" ? "succeeded" as const : "failed" as const,
        })) : undefined;
        const followupRemote = remote?.messageId === followup?.id ? remote : null;
        const canCheckFollowup = followup && !discussionReply && !discussionActive && followup.authorUserId === chat.userId
          && chat.messages.slice(-chat.limit).some(item => item.id === followup.id)
          && !(discussionRun?.status === 'stopped' && discussionRun.stopReasonLabel === agentStopMessage('busy'))
          && !(followupRemote?.status === 'stopped' && followupRemote.stopReason === 'busy');
        const discussionPanel = discussionQuestion && <QuestionDiscussion key={discussionQuestion.id}
          initiallyExpanded={openedDiscussion === message.id || !!message.discussionOf} summary={discussionReply?.text}
          runId={linkedRunId ?? discussionRun?.id ?? (original?.discussion ? message.agentRunId : undefined)}
          status={discussionRun?.status} state={discussionState} online={chat.online}
          checkOriginal={canCheckFollowup ? () => { void requestChatReply(followup.id); } : undefined}
          checkDisabled={busy || chat.loading || !chat.online || !chatWritesAllowed}
          onToggle={() => timelineRef.current?.holdReadingPosition()}
          read={async (id, signal) => scopeKey ? owner.agentOwner.readChatEvidence(scopeKey, [id], signal, true) : undefined}
          onOpenSource={openAgentSource} onLocateSource={locateSource} />;
        if (message.discussionOf) return discussionPanel;
        return <ChatMessage message={{ id: message.id, role: message.role === "model" ? "assistant" : "user", text: childProfiles && model.children.length
          ? model.children.map(item => item.displayName).join("、") : mismatchedDirectory ? "這則舊回覆未能回答你的問題。" : failure?.body ?? message.text,
          phase: effectiveRunStatus ? runPhases[effectiveRunStatus] : failure ? "stopped" : undefined, activities: inlineSteps,
          sources: sourcesMatch && !failure ? publicAnswerSources(run) : undefined }}
          phaseLabel={failure?.reason ?? (effectiveRunStatus === "running" ? "運行仍在處理" : undefined)} onLocateSource={locateSource}
          onOpenSource={run ? id => openAgentSource(run.id, id) : undefined}
          header={<>
            {message.role === 'model' && !failure && <AssistantByline />}
            {message.role === 'user' && message.pageContext?.item && (message.pageContext.item.kind === 'document'
              ? <Text style={styles.meta}>提問時所選的文件 · 版本 {message.pageContext.item.version}</Text>
              : <ChatAction compact={compact} label={message.pageContext.item.kind === 'task' ? '查看提問時所選的待辦' : '查看提問時所選的記錄'}
                  onPress={() => {
                    const item = message.pageContext?.item;
                    if (item?.kind === 'task') navigate(() => router.push({ pathname: '/tasks', params: { taskId: item.id } }), 'workspace');
                    if (item?.kind === 'record') navigate(() => router.push({ pathname: '/care', params: { recordId: item.id } }), 'workspace');
                  }} />)}
            {message.photo?<ChatPhotoMessage key={`${scopeKey}:${message.photo.id}`} photo={message.photo}/>:null}
            {message.file?<ChatFileMessage messageId={message.id} file={message.file}/>:null}
            {message.voice?<VoiceMessage messageId={message.id} voice={message.voice}/>:null}
            {message.role === "model" && message.officialHelp?.length ? <OfficialHelpCards ids={message.officialHelp} /> : null}
          </>}
          degraded={run?.retrievalMode === "keyword_degraded"} footer={message.agentRunId || pendingReply || message.id === recoveryRowId ? <>
            {discussionQuestion ? discussionPanel
              : message.role === 'model' && !failure && run?.status === 'completed' && original?.authorUserId === chat.userId
                ? <ChatAction label="討論這個回答" icon="account-group-outline" disabled={busy || chat.loading || !chat.online || !chatWritesAllowed}
                  onPress={() => { setOpenedDiscussion(message.id); timelineRef.current?.holdReadingPosition(); void chatController.discussAnswer(message.id); }} /> : null}
            {childProfiles ? <ChatAction label="查看子女檔案" compact={compact} onPress={() => actions.open("profile")} /> : null}
            {message.role === 'model' && sourcesMatch && run?.sourceCardReadings?.map(target =>
              <RegisteredReadingCard key={JSON.stringify(target)} target={target} active={displayedMessages.some(item => item.id === message.id)} />)}
            {message.role === 'model' && sourcesMatch && run?.sourceCardLinks?.map(link =>
              <ChatAction key={link.cardId} label={link.authorize ? '前往來源卡登入' : '查看來源卡'} compact={compact}
                accessibilityLabel={link.authorize ? '前往這張來源卡填寫登入資料' : '查看這次操作的來源卡'}
                onPress={() => navigate(() => router.push({ pathname: '/memory', params: {
                  sourceCard: link.cardId, ...(link.authorize ? { sourceAction: 'authorize' } : {}),
                } }), 'workspace')} />)}
            {message.role === 'model' && sourcesMatch && run?.platformSeriesIds?.map(series =>
              <ChatAction key={series} label="查看已加入的平台卡" compact={compact}
                onPress={() => navigate(() => router.push({ pathname: '/memory', params: { series } }), 'workspace')} />)}
            {message.id === recoveryRowId && <ChatAction label="開始新訊息" icon="plus" disabled={busy} onPress={() => chatController.startNewMessage()} />}
            {message.agentRunId && (!inlineSteps || message.id === recoveryRowId) && !detailsOnReply ? <ChatAction label="回覆詳情" accessibilityLabel="查看這則回覆的來源與候選" compact={compact}
              disabled={!chat.online || !!agentModel.busy || !!agentModel.pendingDecision || !!agentModel.writesBlocked || agentModel.readState === "denied"}
              onPress={target => { detailsTrigger.current = target; setActivityEntry("detail"); selectAgentRun(message.agentRunId!); setDetailsOpen(true); }} /> : null}
            {pendingReply && !(phase === 'reply_failed' && draft?.savedUserMessageId === message.id) && !(replyRunning && activeReplyId === message.id) ? <ChatAction label={message.agentRunId ? "查核原回覆" : "取得回覆"}
              accessibilityLabel="要求這則已保存訊息的回覆" compact={compact} disabled={busy || !chat.online || chat.loading || !chatWritesAllowed}
              onPress={() => { void requestChatReply(message.id); }} /> : null}
          </> : undefined} />;
      }} />}
    {welcome && timelineFooter}
    {officialHelpPanel}
    <AgentComposer centered={welcome} discussionControl={childScopedChat && !replyRunning && phase === 'draft' && <ChatAction label={discussNext ? '只討論本題 ×' : '三方討論'}
      accessibilityLabel={discussNext ? '取消這一題的討論' : '為這一題開啟三個 AI 觀點討論'}
      icon={discussNext ? 'check' : 'account-group-outline'} compact disabled={busy || !chat.online || !chatWritesAllowed}
      onPress={() => setDiscussNext(value => !value)} />}
      enabled={!!child && pathname === "/chat" && !busy && !voiceUpload.busy && !voiceUpload.unknown && !fileUpload.busy && !fileUpload.unknown && !photoUpload.busy && !photoUpload.unknown && phase === "draft" && !replyRunning} compact={compact} draft={composerText}
      allowTyping={childScopedChat && pathname === "/chat" && (replyRunning || submittedDraft) && chatWritesAllowed && chat.busy !== "save" && (submittedDraft || phase === "draft")}
      onStop={childScopedChat && replyRunning ? () => { void chatController.cancelReply(); } : undefined}
      queueAction={childScopedChat && chatWritesAllowed && chat.online && !stopPending && phase === "replying" && activeReplyId && draft?.savedUserMessageId === activeReplyId && !!composerText.trim() && composerText.length <= 10_000
        ? { queued: chat.queuedTextAfter === activeReplyId, press: () => chat.queuedTextAfter === activeReplyId ? chatController.unqueueNextText() : chatController.queueNextText() } : undefined}
      stopDisabled={stopPending || !chat.online} stopTarget={activeReplyId ?? undefined}
      attachments={submittedDraft ? [] : agentAttachments} onChangeDraft={setChatDraft} onPreview={send} submitEnabled={canSend} submitLabel="送出"
      suggestionLabel="建議問題" suggestionsAvailable={confirmedEmptyChat}
      onAddAttachment={addAgentAttachment} onRemoveAttachment={removeAgentAttachment} focusRequest={composerFocusRequest} />
    </BackgroundSurface>
    {!compact && <View style={styles.companionAside}><View style={styles.companionStage}>
      <View pointerEvents="none" style={styles.companionBackdrop} /><CompanionSlot quietHeight={214} />
    </View></View>}
    </View>
    <AgentConversation visible={detailsOpen} entry={activityEntry} onOpenResource={path => navigate(() => { setDetailsOpen(false); router.push(path as Parameters<typeof router.push>[0]); }, "workspace")} onClosed={restoreDetailsFocus} onDismiss={() => setDetailsOpen(false)} onOpenSettings={openSettings}
      onReloadChat={() => { void chatController.reloadMessages(); }} reloadDisabled={busy || chat.loading || !chat.online} />
    <AppDialog visible={optionsOpen} onDismiss={() => setOptionsOpen(false)} accessibilityLabel="助手選項">
      <AppDialog.Title>助手選項</AppDialog.Title>
      <AppDialog.Content style={styles.optionsContent}>
        {child && <ChatAction label="平台卡庫" icon="book-open-variant" onPress={() => {
          setOptionsOpen(false);
          navigate(() => router.push({ pathname: '/memory', params: { section: 'references', catalog: 'platform' } }), 'workspace');
        }} />}
        <Text accessibilityRole="header" style={styles.optionHeading}>AI 資料處理說明</Text>
        <Text style={styles.body}>送出後會保存聊天並要求 AI 回覆。獲授權的文字或照片會交由 Google 或你選用的模型供應商處理；私人來源不加入公共知識庫，通知及分享仍需另外授權。</Text>
      </AppDialog.Content>
      <AppDialog.Actions><AppButton label="關閉" variant="quiet" onPress={() => setOptionsOpen(false)} /></AppDialog.Actions>
    </AppDialog>
  </>;
}
const styles = StyleSheet.create({
  customRoot: { backgroundColor: "transparent", padding: 12 },
  pageLayout: { flex: 1, minHeight: 0, minWidth: 0, position: "relative" },
  readingPanel: { flex: 1, minHeight: 0, minWidth: 0, width: "100%" },
  boundedReadingPanel: { maxWidth: chatLayout.maxWidth, alignSelf: "center" },
  root: { flex: 1, minHeight: 0, backgroundColor: chatColors.canvas },
  toolbar: { width: "100%", maxWidth: 1060, borderBottomWidth: 1, borderBottomColor: colors.softLine, alignSelf: "center", flexShrink: 0,
    paddingHorizontal: chatLayout.wideInset, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  compactColumn: { paddingHorizontal: chatLayout.compactInset }, toolbarActions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center" },
  headerIdentity: { flexDirection: 'row', alignItems: 'center', gap: 12, flexShrink: 1 },
  headingTitle: { color: colors.ink, fontSize: 21, lineHeight: 29, fontWeight: '700' },
  optionsContent: { gap: 8 },
  optionHeading: { ...chatType.section, color: colors.ink },
  welcomePanel: { justifyContent: 'center' },
  welcome: { width: '100%', maxWidth: chatLayout.maxWidth, alignSelf: 'center', paddingHorizontal: 22, paddingBottom: 4 },
  conversationLayout: { justifyContent: 'center', flex: 1, flexDirection: 'row', minHeight: 0, width: '100%', maxWidth: 1060, alignSelf: 'center' },
  companionAside: { width: '20%', maxWidth: 190, alignItems: 'center', justifyContent: 'center', paddingBottom: 32 },
  companionStage: { width: '100%', alignItems: 'center', justifyContent: 'flex-end' },
  companionBackdrop: { position: 'absolute', height: 163, width: '85%', bottom: 0, borderRadius: 82, backgroundColor: colors.sage },
  body: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.body },
  meta: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.meta },
  warning: { fontFamily: chatFont, color: colors.warningInk, ...chatType.tool },
  error: { fontFamily: chatFont, color: colors.errorInk, ...chatType.tool },
  feedback: { gap: 10, minWidth: 0 }, helpDock: { flexShrink: 0, width: "100%", maxWidth: chatLayout.maxWidth, alignSelf: "center",
    paddingHorizontal: chatLayout.wideInset, overflow: "hidden", marginBottom: chatLayout.composerOverlap },
  helpDockScroll: { flexGrow: 0 }, helpDockContent: { paddingVertical: 4 },
  statusRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  progressRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, minWidth: 0 },
  progressCopy: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0, flexShrink: 1 },
  progressLabel: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.tool, flexShrink: 1 },
  emptyState: { alignItems: "center", gap: 12, paddingVertical: 28 },
  emptyTitle: { fontFamily: chatFont, color: chatColors.ink, fontSize: 28, lineHeight: 38, fontWeight: "600" },
  compactEmptyTitle: { fontSize: 24, lineHeight: 34 },
});

