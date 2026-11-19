import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, View, type ScrollView } from "react-native";
import { Text } from "react-native-paper";
import type { AgentActionReceipt } from "../../../src/shared/agent-actions";
import { usePersonalHistoryWorkspace } from "./usePersonalHistory";
import { PersistentWorkCards } from "../components/history/PersistentWorkCards";
import { useProduction } from "./ProductionProvider";
import { AgentRunView, type ActivityProposalTarget } from "../components/agent/AgentRunView";
import { ReadStateNotice } from "../components/ReadStateNotice";
import { AppDialog } from "../components/AppDialog";
import { AppScrollView } from "../components/AppScrollView";
import { AppStatusBadge } from "../components/AppStatusBadge";
import { AppIcon } from "../components/AppIcon";
import { ChatAction } from "../components/chat/ChatAction";
import { proposalContextLabel, proposalPrimaryText } from "../components/agent/proposal-presentation";
import { locateCitationSource } from "../components/chat/locateCitationSource";
import { chatColors, chatFont, chatType } from "../components/chat/chat-presentation";
import { AppButton } from "../components/ui";
import { proposalDisplayStatus, proposalNeedsConfirmation, type AgentProposalView } from "../agent-view-model";
import { MotionDisclosure } from "../motion";
import { colors, radius, spacing } from "../theme";

const receiptKinds = { save_record: "保存照護記錄", revise_record: "更正照護記錄", save_private_note: "保存私人備註", revise_private_note: "修改私人備註", create_self_task: "建立本人待辦", change_self_task: "更改本人待辦" };
const receiptStates = { saved: "已保存", updated: "已更新", scheduled: "已安排", completed: "已記錄完成", cancelled: "已取消" };

function ActivityDetails({ label, scopeKey, children }: { label: string; scopeKey: string; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  return <View style={styles.details}>
    <ChatAction label={label} expanded={expanded} disclosure onPress={() => setExpanded(value => !value)} />
    <MotionDisclosure expanded={expanded} scopeKey={scopeKey}><View style={styles.details}>{children}</View></MotionDisclosure>
  </View>;
}

function Receipt({ item }: { item: AgentActionReceipt }) {
  return <View testID="agent-direct-receipt" style={styles.row}>
    <View style={styles.rowHeading}><Text accessibilityRole="header" style={styles.rowTitle}>{receiptKinds[item.kind]}</Text><AppStatusBadge label={receiptStates[item.state]} tone="neutral" /></View>
    {item.resource.kind === "private_note" && <Text style={styles.label}>只供本人查看</Text>}
    {item.notification === "authorized_for_due_event" && <Text style={styles.label}>到期提示已授權 · {item.channels.map(channel => channel === "telegram" ? "Telegram" : "瀏覽器推送").join("、")}</Text>}
  </View>;
}

function ActivityCard({ cardKey, content, context, status, warning = false, selected = false, disabled, onPress, cardRef }: {
  cardKey: string; content: string; context: string; status?: string; warning?: boolean; selected?: boolean; disabled: boolean;
  onPress(): void; cardRef?(node: View | null): void;
}) {
  const [focused, setFocused] = useState(false), [hovered, setHovered] = useState(false);
  return <Pressable ref={cardRef} testID={`activity-card-${cardKey}`} accessibilityRole="button"
    accessibilityLabel={`查看活動詳情：${content}；${context}${status ? `；${status}` : ""}`}
    accessibilityState={{ disabled, selected }} aria-disabled={disabled} aria-current={selected ? "true" : undefined}
    disabled={disabled} onPress={onPress} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={({ pressed }) => [styles.activityCard, hovered && !disabled && styles.cardHighlighted, focused && styles.cardFocused,
      pressed && !disabled && styles.cardPressed, disabled && styles.cardDisabled]}>
    <View style={styles.cardCopy}>
      <Text numberOfLines={3} style={styles.cardContent}>{content}</Text>
      <View style={styles.rowHeading}><Text style={styles.label}>{context}</Text>
        {status ? <AppStatusBadge label={status} tone={warning ? "warning" : "neutral"} /> : null}</View>
    </View>
    <AppIcon name="chevron-right" size={20} />
  </Pressable>;
}

export function AgentConversation({ visible, entry, onDismiss, onClosed, onOpenResource }: { visible: boolean; entry: "list" | "detail"; onDismiss(): void; onClosed?(): void; onOpenResource?(path: string): void; onOpenSettings(): void; onReloadChat(): void; reloadDisabled: boolean }) {
  const { scopeKey, agentModel, agentActions, agentInboxActions, agentPending, readAgentPending, selectAgentRun, authorization, authorizationActions } = useProduction();
  const history = usePersonalHistoryWorkspace();
  const workOwner = history && history.scopeKey === scopeKey && !history.messageOnly && history.access === "active" && agentModel.readState !== "denied" ? history : null;
  const work = workOwner?.work;
  const pendingReader = useRef(readAgentPending); pendingReader.current = readAgentPending;
  useEffect(() => {
    if (visible && scopeKey && agentModel.online) pendingReader.current(false, true);
  }, [visible, scopeKey, agentModel.online]);
  const scrollRef = useRef<ScrollView | null>(null);
  const detailRef = useRef<View | null>(null), listRef = useRef<View | null>(null);
  const cardRefs = useRef(new Map<string, View>()), scrollPosition = useRef(0), selectionSerial = useRef(0);
  const returnAnchor = useRef<{ scopeKey: string; cardKey: string; y: number } | null>(null);
  const pendingReturn = useRef(false), focusedSelection = useRef<string | null>(null);
  const visibleScope = useRef<string | null>(null);
  const [selection, setSelection] = useState<{ scopeKey: string; runId: string; cardKey: string; label: string; serial: number; target?: ActivityProposalTarget } | null>(null);
  const [pastScope, setPastScope] = useState<string | null>(null);
  const [listRequested, setListRequested] = useState<boolean | null>(null);
  const selected = selection?.scopeKey === scopeKey ? selection : null;
  const preferList = listRequested ?? (entry === "list" && !agentModel.pendingDecision && !agentModel.writesBlocked);
  const showDetails = !preferList && (!!selected || !!agentModel.pendingDecision || agentModel.readState !== "idle");
  const cannotNavigate = !scopeKey || !!agentModel.busy || !!agentModel.pendingDecision || !!agentModel.writesBlocked || agentModel.readState === "denied";
  const cannotReturn = agentModel.busy === "write" || !!agentModel.writesBlocked || agentModel.readState === "denied";
  function cardRef(key: string, node: View | null) { if (node) cardRefs.current.set(key, node); else cardRefs.current.delete(key); }
  function openProposal(entry: { runId: string; proposal: AgentProposalView }) {
    if (!scopeKey || cannotNavigate || !agentModel.online) return;
    const cardKey = `proposal-${entry.runId}-${entry.proposal.id}`;
    returnAnchor.current = { scopeKey, cardKey, y: scrollPosition.current };
    setSelection({ scopeKey, runId: entry.runId, cardKey, label: entry.proposal.title, serial: ++selectionSerial.current,
      target: { runId: entry.runId, id: entry.proposal.id, version: entry.proposal.version, kind: entry.proposal.kind, scope: entry.proposal.scope } });
    setListRequested(false); selectAgentRun(entry.runId);
  }
  function returnToCards() {
    if (cannotReturn) return;
    pendingReturn.current = true;
    if (!agentModel.pendingDecision) agentInboxActions.collapse();
    setSelection(null); setListRequested(true);
  }
  useLayoutEffect(() => {
    if (selection && selection.scopeKey !== scopeKey) {
      setSelection(null); setListRequested(null); returnAnchor.current = null; pendingReturn.current = false; focusedSelection.current = null;
    }
    if (!visible) {
      setPastScope(null);
      if (selection) setSelection(null);
      setListRequested(null);
      returnAnchor.current = null; pendingReturn.current = false; focusedSelection.current = null;
      return;
    }
    if (!showDetails && pendingReturn.current) {
      pendingReturn.current = false;
      const saved = returnAnchor.current;
      const node = saved?.scopeKey === scopeKey ? cardRefs.current.get(saved.cardKey) : null;
      const target = node ?? listRef.current;
      scrollRef.current?.scrollTo?.({ y: node && saved ? saved.y : 0, animated: false });
      if (Platform.OS === "web") (target as unknown as HTMLElement | null)?.focus?.({ preventScroll: true });
      return;
    }
    if (!selected || agentModel.readState !== "ready" || agentModel.run?.id !== selected.runId) return;
    const target = selected.target;
    const matching = !target || agentModel.run.proposals.some(proposal => proposal.id === target.id && proposal.kind === target.kind
      && proposal.scope === target.scope && proposal.version >= target.version);
    const token = `${scopeKey}:${selected.serial}`;
    if (!matching || focusedSelection.current === token) return;
    focusedSelection.current = token;
    scrollRef.current?.scrollTo?.({ y: 0, animated: false });
    if (Platform.OS === "web") (detailRef.current as unknown as HTMLElement | null)?.focus?.({ preventScroll: true });
  }, [visible, scopeKey, showDetails, selected?.serial, agentModel.readState, agentModel.run]);
  useLayoutEffect(() => {
    const openedScope = visible && agentModel.online ? scopeKey : null;
    if (openedScope && visibleScope.current !== openedScope && agentModel.pendingDecision && !agentModel.busy) agentActions.refresh();
    visibleScope.current = openedScope;
  }, [visible, scopeKey, agentModel.online]);
  const onLocateSource = (target: View | null, horizontalScroll?: ScrollView | null, verticalTarget?: View | null) =>
    locateCitationSource(target, scrollRef.current, horizontalScroll, verticalTarget);
  const run = showDetails && agentModel.readState === "ready" ? agentModel.run : null;
  const receipt = run ? authorization.receipts[run.id] : undefined;
  useEffect(() => { if (visible && run && !receipt) authorizationActions.readReceipts(run.id); }, [visible, run?.id, receipt?.state]);
  const pendingEntries = agentPending.entries.filter(entry => !run || entry.runId !== run.id
    || !run.proposals.some(proposal => proposal.id === entry.proposal.id && proposal.version >= entry.proposal.version));
  const showReceipts = !!run && (receipt?.state !== "ready" || receipt.items.length > 0 || !authorization.online);
  const emptyList = agentModel.online && !agentModel.pendingDecision && !agentModel.writesBlocked
    && agentPending.state === "ready" && !agentPending.entries.length && !agentPending.nextCursor
    && (work?.state === "ready" && work.data.complete && !work.data.items.length || !workOwner);
  const actionable = pendingEntries.filter(entry => proposalNeedsConfirmation(entry.proposal));
  const showPending = actionable.length > 0 || agentPending.state !== "ready" || !!agentPending.nextCursor;
  const inactive = pendingEntries.filter(entry => !proposalNeedsConfirmation(entry.proposal));
  const loadedPendingCount = (run?.proposals.filter(proposalNeedsConfirmation).length ?? 0)
    + (agentPending.state === "ready" ? actionable.length : 0);
  const pendingCountKnown = agentModel.online && agentPending.state === "ready" && (agentModel.readState === "idle" || agentModel.readState === "ready");
  const activityHeading = <View style={styles.activityHeading}>
    <AppDialog.Title style={styles.activityTitle}>{showDetails ? selected?.target ? "事項詳情" : "回覆詳情" : "對話活動"}</AppDialog.Title>
    {(loadedPendingCount > 0 || !!agentPending.nextCursor) && <Text testID="agent-activity-count" style={styles.activityCount} accessibilityLabel={pendingCountKnown
      ? `已載入 ${loadedPendingCount} 項待確認${agentPending.nextCursor ? "，仍有更多待讀取" : ""}` : "待確認數量尚未核對"}>
      {pendingCountKnown ? `${loadedPendingCount}${agentPending.nextCursor ? "+" : ""} 項待確認` : "待確認未核對"}
    </Text>}
  </View>;
  const hasPendingSnapshot = agentPending.state !== "denied" && (agentPending.state === "ready" || !!agentPending.hasSnapshot);
  const renderProposal = (entry: typeof pendingEntries[number]) => <ActivityCard key={`${entry.runId}-${entry.proposal.id}`}
    cardKey={`proposal-${entry.runId}-${entry.proposal.id}`} content={proposalPrimaryText(entry.proposal)} context={proposalContextLabel(entry.proposal)}
    status={proposalNeedsConfirmation(entry.proposal) ? undefined : proposalDisplayStatus(entry.proposal)}
    disabled={cannotNavigate || !agentModel.online} onPress={() => openProposal(entry)}
    cardRef={node => cardRef(`proposal-${entry.runId}-${entry.proposal.id}`, node)} />;
  const pendingContent = showPending ? <View testID="agent-other-pending" style={styles.section}>
        {agentPending.state === "failed" ? <AppButton label="重新讀取待確認候選" variant="quiet" density="compact" disabled={!agentModel.online || !!agentModel.busy || !!agentModel.pendingDecision || !!agentModel.writesBlocked || agentModel.readState === "denied"} onPress={() => readAgentPending()} style={styles.inlineButton} /> : null}
        {agentPending.state === "idle" ? <Text style={styles.label}>{agentModel.online ? "待確認事項尚未讀取；等候目前操作完成後會自動讀取。" : "目前離線，待確認事項尚未核對。"}</Text> : null}
        {agentPending.state === "loading" ? <ReadStateNotice state="loading" refreshing={!!agentPending.hasSnapshot} message="正在讀取待確認事項…" /> : null}
        {agentPending.state === "denied" ? <Text style={styles.warning}>目前沒有權限查看這個孩子的待確認事項。</Text> : null}
        {agentPending.state === "failed" ? <Text style={styles.error}>{agentPending.hasSnapshot ? "未能更新，仍顯示上次讀取的事項。" : "未能讀取待確認事項，請重試。"}</Text> : null}
        {hasPendingSnapshot && actionable.length > 0 && <View style={styles.details}>
          <Text accessibilityRole="header" style={styles.heading}>待你確認</Text>
          {actionable.map(renderProposal)}
        </View>}
        {agentPending.nextCursor ? <AppButton label="讀取下一頁候選" variant="quiet" density="compact" disabled={!!agentModel.busy || !!agentModel.pendingDecision || !!agentModel.writesBlocked || !agentModel.online} onPress={() => readAgentPending(true)} style={styles.inlineButton} /> : null}
      </View> : null;
  return <AppDialog visible={visible} onDismiss={onDismiss} onClosed={onClosed} accessibilityLabel={showDetails ? "活動詳情" : "對話活動"} style={styles.dialog}>
    <View testID="agent-activity-header" style={styles.activityToolbar}>
      {showDetails ? <ChatAction label="返回活動" accessibilityLabel="返回活動列表" iconOnly icon="arrow-left" disabled={cannotReturn} onPress={returnToCards} /> : null}
      {activityHeading}
      <ChatAction label="關閉" accessibilityLabel="關閉活動" icon="close" iconOnly onPress={onDismiss} />
    </View>
    <AppDialog.ScrollArea style={styles.scrollArea}><AppScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.contents}
      onScroll={event => { scrollPosition.current = event.nativeEvent.contentOffset.y; }} scrollEventThrottle={16}>
      {showDetails ? <View ref={detailRef} tabIndex={-1} testID="agent-activity-detail" accessibilityLabel={`活動詳情${selected ? `：${selected.label}` : ""}`} style={styles.details}>
        <AgentRunView model={agentModel} actions={agentActions} onLocateSource={onLocateSource} activity activityHeaderVisible proposalTarget={selected?.target} proposalOnly={!!selected?.target}
          activityNavigation={cannotReturn ? <Text style={styles.label}>目前正在處理或未能核對存取權，暫時不能返回。</Text> : null} />
      </View>
        : null}
      {!showDetails ? <View ref={listRef} tabIndex={-1} accessibilityLabel="活動列表" testID="agent-activity-list" style={styles.details}>
        {agentModel.pendingDecision ? <AppButton label="查看待確認結果" variant="quiet" density="compact"
          disabled={!agentModel.online || !!agentModel.busy || agentModel.readState === "denied"}
          onPress={() => { setListRequested(false); selectAgentRun(agentModel.pendingDecision!.runId); }} style={styles.inlineButton} /> : null}
        {emptyList ? <Text style={styles.label}>{workOwner ? "目前沒有待確認或交辦事項。" : "目前沒有待確認事項。"}</Text> : <>
          {pendingContent}
          {workOwner && work && (work.state !== "ready" || work.data.items.length > 0 || !work.data.complete) ? <View style={styles.section}>
            <Text accessibilityRole="header" style={styles.heading}>我的交辦</Text>
            {work.state === "loading" ? <ReadStateNotice state="loading" message="正在讀取交辦事項…" /> : null}
            {work.state === "stale" || work.state === "error" || work.state === "unavailable" ? <Text style={styles.label}>{work.state === "stale" ? "顯示上次讀取的交辦事項。" : "暫時無法讀取交辦事項。"}</Text> : null}
            {work.data ? <PersistentWorkCards key={workOwner.scopeKey} compact activity items={work.data.items} online={workOwner.online} onResource={onOpenResource} /> : null}
            {workOwner.online && (work.state === "error" || work.state === "stale" || work.state === "unavailable") ? <AppButton label="重新讀取交辦事項" variant="quiet" density="compact" disabled={workOwner.busy.work} onPress={workOwner.actions.loadWork} /> : null}
            {work.data?.nextCursor ? <AppButton label="更多交辦事項" variant="quiet" density="compact" disabled={!workOwner.online || workOwner.busy.work} onPress={workOwner.actions.moreWork} /> : null}
          </View> : null}
          {hasPendingSnapshot && inactive.length > 0 && <View style={styles.section}>
            <ChatAction label={`已結束事項 · ${inactive.length}`} disclosure expanded={!!scopeKey && pastScope === scopeKey}
              onPress={() => setPastScope(pastScope === scopeKey ? null : scopeKey)} />
            {scopeKey && pastScope === scopeKey && inactive.map(renderProposal)}
          </View>}
        </>}
      </View> : null}
      {showDetails && !selected?.target && showReceipts && run && (!selected || selected.runId === run.id) ? <View testID="agent-operation-receipts" style={styles.section}>
        <View style={styles.rowHeading}><Text accessibilityRole="header" style={styles.heading}>操作結果</Text>
          <AppButton label="重新檢查" accessibilityLabel="重新檢查本次操作是否已保存" variant="quiet" density="compact" disabled={!authorization.online || receipt?.state === "loading"} onPress={() => authorizationActions.readReceipts(run.id, true)} style={styles.inlineButton} /></View>
        {receipt?.state === "ready" ? receipt.items.length ? receipt.items.map(item => <Receipt key={`${run.id}:${item.id}`} item={item} />)
          : <Text style={styles.warning}>目前離線，操作收據尚未重新核對。</Text>
          : <Text style={receipt?.state === "failed" ? styles.error : styles.label}>{receipt?.state === "loading" ? "正在檢查是否已保存…" : receipt?.state === "denied" ? "沒有權限查看操作結果。" : "暫時無法確認是否已保存"}</Text>}
      </View> : null}
      {showDetails && !selected?.target && (!selected || selected.runId === run?.id) && run?.privateSourceCitations?.length ? <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.heading}>私人參考</Text>
        {run.privateSourceCitations.map((source, index) => <ActivityDetails key={`${run.id}:${source.citationId}`} label={`私人來源 ${index + 1} · ${source.label}`} scopeKey={`${run.id}:${source.citationId}`}>
          <Text style={styles.label}>版本 {source.version}</Text><Text selectable style={styles.label}>{source.excerpt}</Text>
        </ActivityDetails>)}
      </View> : null}
    </AppScrollView></AppDialog.ScrollArea>
  </AppDialog>;
}
const styles = StyleSheet.create({
  dialog: { maxWidth: 500, paddingTop: 0 }, scrollArea: { paddingHorizontal: 0, minHeight: 0, flexGrow: 0, borderTopWidth: 0, borderBottomWidth: 0 },
  contents: { gap: spacing.md, minWidth: 0, paddingHorizontal: spacing.lg, paddingBottom: spacing.lg },
  activityToolbar: { flexDirection: "row", alignItems: "center", flexWrap: "nowrap", gap: spacing.xs, minWidth: 0, marginTop: 0, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  activityHeading: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, minWidth: 0 },
  activityTitle: { marginHorizontal: 0, marginVertical: 0, flexShrink: 1, fontSize: 18, lineHeight: 24 },
  activityCount: { fontFamily: chatFont, color: chatColors.secondary, fontSize: 13, lineHeight: 18, flexShrink: 1, minWidth: 0 },
  section: { gap: spacing.sm, minWidth: 0, borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.md },
  row: { gap: spacing.sm, minWidth: 0, paddingVertical: spacing.sm },
  rowHeading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, minWidth: 0 },
  details: { gap: spacing.sm, minWidth: 0 }, inlineButton: { alignSelf: "flex-start", maxWidth: "100%", minWidth: 0 },
  activityCard: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minWidth: 0, minHeight: 48, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.softLine },
  cardCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  cardContent: { fontFamily: chatFont, color: chatColors.ink, fontSize: 16, lineHeight: 23, fontWeight: "600", minWidth: 0 },
  cardHighlighted: { backgroundColor: colors.quietSurface }, cardFocused: { borderWidth: 2, borderColor: colors.teal },
  cardPressed: { backgroundColor: colors.paleTeal }, cardDisabled: { opacity: 0.6 },
  heading: { fontFamily: chatFont, color: chatColors.ink, ...chatType.section, flexShrink: 1, minWidth: 0 },
  rowTitle: { fontFamily: chatFont, color: chatColors.ink, ...chatType.tool, fontWeight: "600", flexShrink: 1, minWidth: 0 },
  label: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.meta, flexShrink: 1, minWidth: 0 },
  error: { fontFamily: chatFont, color: colors.errorInk, ...chatType.tool, flexShrink: 1 },
  warning: { fontFamily: chatFont, color: colors.warningInk, ...chatType.tool, flexShrink: 1 },
});
