import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, View, type ScrollView } from "react-native";
import { Text } from "react-native-paper";
import type { AgentActionReceipt } from "../../../src/shared/agent-actions";
import { subscribeOnlineRefresh } from "../../../src/client/online-refresh-events";
import { useProduction } from "./ProductionProvider";
import { AgentRunView, type ActivityProposalTarget } from "../components/agent/AgentRunView";
import { ReadStateNotice } from "../components/ReadStateNotice";
import { AppDialog } from "../components/AppDialog";
import { AppScrollView } from "../components/AppScrollView";
import { AppStatusBadge } from "../components/AppStatusBadge";
import { AppIcon } from "../components/AppIcon";
import { proposalContextLabel, proposalPrimaryText } from "../components/agent/proposal-presentation";
import { locateCitationSource } from "../components/chat/locateCitationSource";
import { chatColors, chatFont, chatType } from "../components/chat/chat-presentation";
import { AppButton } from "../components/ui";
import { agentProposalLabels, agentTime, proposalExpired, type AgentInboxActions, type AgentInboxModel, type AgentProposalView } from "../agent-view-model";
import { MotionDisclosure } from "../motion";
import { colors, radius, spacing } from "../theme";

const receiptKinds = { save_record: "保存照護記錄", revise_record: "更正照護記錄", save_private_note: "保存私人備註", revise_private_note: "修改私人備註", create_self_task: "建立本人待辦", change_self_task: "更改本人待辦" };
const receiptStates = { saved: "已保存", updated: "已更新", scheduled: "已安排", completed: "已記錄完成", cancelled: "已取消" };
const resourceKinds = { care_record: "照護記錄", private_note: "私人備註", task: "待辦" };

function ActivityDetails({ label, scopeKey, children }: { label: string; scopeKey: string; children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  return <View style={styles.details}>
    <AppButton label={label} expanded={expanded} variant="quiet" density="compact" onPress={() => setExpanded(value => !value)} style={styles.inlineButton} />
    <MotionDisclosure expanded={expanded} scopeKey={scopeKey}><View style={styles.details}>{children}</View></MotionDisclosure>
  </View>;
}

function Receipt({ item }: { item: AgentActionReceipt }) {
  return <View testID="agent-direct-receipt" style={styles.row}>
    <View style={styles.rowHeading}><Text accessibilityRole="header" aria-level={2} style={styles.rowTitle}>{receiptKinds[item.kind]}</Text><AppStatusBadge label={receiptStates[item.state]} tone="neutral" /></View>
    <Text style={styles.label}>{resourceKinds[item.resource.kind]} · {item.resource.kind === "private_note" ? "只供本人查看" : "按原資料權限查看"}</Text>
    <Text style={styles.label}>{item.notification === "authorized_for_due_event" ? `已授權到期提示（${item.channels.map(channel => channel === "telegram" ? "Telegram" : "瀏覽器推送").join("、")}）；不表示已發送或送達。` : "沒有授權外部到期提示。"}</Text>
    <ActivityDetails label="查看保存詳情" scopeKey={item.id}>
      <Text selectable style={styles.label}>{resourceKinds[item.resource.kind]}：{item.resource.id} · 版本 {item.resource.version}</Text>
    </ActivityDetails>
  </View>;
}

function backgroundTime(value: string): string {
  return Number.isFinite(Date.parse(value)) ? agentTime(value) : "時間未能核對";
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

function BackgroundRuns({ model, actions, onSelect, cardRef }: { model: AgentInboxModel; actions: AgentInboxActions;
  onSelect(runId: string, label: string): void; cardRef(key: string, node: View | null): void }) {
  const loading = model.state === "loading", denied = model.state === "denied", ready = model.state === "ready";
  const hasSnapshot = !denied && !!model.loadedAt;
  return <View testID="agent-activity-background" style={styles.section}>
      <Text accessibilityRole="header" aria-level={2} style={styles.heading}>其他活動</Text>
      <Text style={styles.label}>只限你本人查看，最多展示 20 項。</Text>
      {model.state === "idle" ? <Text style={styles.label}>尚未載入其他活動。</Text> : null}
      {loading ? <ReadStateNotice state="loading" refreshing={hasSnapshot} message="正在載入其他活動…" /> : null}
      {model.state === "failed" ? <Text style={styles.error}>{hasSnapshot ? "未能更新其他活動，顯示上次讀取的內容。" : "未能載入其他活動，請重試。"}</Text> : null}
      {denied ? <Text style={styles.warning}>已失去讀取權限，原清單已隱藏。</Text> : null}
      {!model.online ? <Text style={styles.warning}>目前離線，所示清單只是上次讀取的快照。</Text> : null}
      {model.locked && !denied ? <Text style={styles.warning}>暫時無法確認結果</Text> : null}
      {model.state === "failed" ? <AppButton label="重新載入活動記錄" variant="quiet" density="compact"
        disabled={!model.online || model.locked} onPress={actions.refresh} style={styles.inlineButton} /> : null}
      {ready || hasSnapshot ? model.entries.length ? model.entries.slice(0, 20).map(entry => <ActivityCard key={entry.runId} cardKey={`run-${entry.runId}`}
        content="活動結果" context={backgroundTime(entry.createdAt)} selected={entry.runId === model.selectedRunId}
        disabled={model.locked || !model.online || loading} onPress={() => onSelect(entry.runId, backgroundTime(entry.createdAt))}
        cardRef={node => cardRef(`run-${entry.runId}`, node)} />)
        : ready && model.online ? <Text style={styles.label}>目前沒有其他活動。</Text> : null : null}
  </View>;
}

export function AgentConversation({ visible, onDismiss, onClosed }: { visible: boolean; onDismiss(): void; onClosed?(): void; onOpenSettings(): void; onReloadChat(): void; reloadDisabled: boolean }) {
  const { scopeKey, agentModel, agentActions, agentInbox, agentInboxActions, agentPending, readAgentPending, readAgentActivity, selectAgentRun, authorization, authorizationActions } = useProduction();
  const activityRead = useRef(readAgentActivity); activityRead.current = readAgentActivity;
  useEffect(() => {
    if (!visible || !scopeKey || !agentModel.online) return;
    activityRead.current();
    // The global invalidation already re-reads pending; only add the visible inbox.
    return subscribeOnlineRefresh(() => activityRead.current(false));
  }, [visible, scopeKey, agentModel.online]);
  const scrollRef = useRef<ScrollView | null>(null);
  const detailRef = useRef<View | null>(null), listRef = useRef<View | null>(null);
  const cardRefs = useRef(new Map<string, View>()), scrollPosition = useRef(0), selectionSerial = useRef(0);
  const returnAnchor = useRef<{ scopeKey: string; cardKey: string; y: number } | null>(null);
  const pendingReturn = useRef(false), focusedSelection = useRef<string | null>(null);
  const visibleScope = useRef<string | null>(null);
  const [selection, setSelection] = useState<{ scopeKey: string; runId: string; cardKey: string; label: string; serial: number; target?: ActivityProposalTarget } | null>(null);
  const [listRequested, setListRequested] = useState(false);
  const selected = selection?.scopeKey === scopeKey ? selection : null;
  const showDetails = !listRequested && (!!selected || !!agentModel.pendingDecision || agentModel.readState !== "idle");
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
  function openBackground(runId: string, time: string) {
    if (!scopeKey || cannotNavigate || agentInbox.locked || !agentInbox.online) return;
    const cardKey = `run-${runId}`;
    returnAnchor.current = { scopeKey, cardKey, y: scrollPosition.current };
    setSelection({ scopeKey, runId, cardKey, label: `活動結果 · ${time}`, serial: ++selectionSerial.current });
    setListRequested(false); agentInboxActions.select(runId);
  }
  function returnToCards() {
    if (cannotReturn) return;
    pendingReturn.current = true;
    if (!agentModel.pendingDecision) agentInboxActions.collapse();
    setSelection(null); setListRequested(true);
  }
  useLayoutEffect(() => {
    if (selection && selection.scopeKey !== scopeKey) {
      setSelection(null); setListRequested(false); returnAnchor.current = null; pendingReturn.current = false; focusedSelection.current = null;
    }
    if (!visible) {
      if (selection) setSelection(null);
      setListRequested(false);
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
  const run = agentModel.readState === "ready" ? agentModel.run : null;
  const receipt = run ? authorization.receipts[run.id] : undefined;
  useEffect(() => { if (visible && run && !receipt) authorizationActions.readReceipts(run.id); }, [visible, run?.id, receipt?.state]);
  const pendingEntries = agentPending.entries.filter(entry => !run || entry.runId !== run.id
    || !run.proposals.some(proposal => proposal.id === entry.proposal.id && proposal.version >= entry.proposal.version));
  const showPending = !run || pendingEntries.length > 0 || agentPending.state !== "ready" || !!agentPending.nextCursor;
  const showReceipts = !!run && (receipt?.state !== "ready" || receipt.items.length > 0 || !authorization.online);
  const loadedPendingCount = (run?.proposals.filter(proposal => proposal.status === "pending" && proposal.contentState !== "invalidated" && !proposalExpired(proposal)).length ?? 0)
    + (agentPending.state === "ready" ? pendingEntries.filter(entry => entry.proposal.status === "pending" && entry.proposal.contentState !== "invalidated" && !proposalExpired(entry.proposal)).length : 0);
  const pendingCountKnown = agentModel.online && agentPending.state === "ready" && (agentModel.readState === "idle" || agentModel.readState === "ready");
  const activityHeading = <View style={styles.activityHeading}>
    <AppDialog.Title style={styles.activityTitle}>活動</AppDialog.Title>
    <Text testID="agent-activity-count" style={styles.activityCount} accessibilityLabel={pendingCountKnown
      ? `已載入 ${loadedPendingCount} 項待確認${agentPending.nextCursor ? "，仍有更多待讀取" : ""}` : "待確認數量尚未核對"}>
      {pendingCountKnown ? `${loadedPendingCount}${agentPending.nextCursor ? "+" : ""} 項待確認` : "待確認未核對"}
    </Text>
  </View>;
  const pendingContent = showPending ? <View testID="agent-other-pending" style={styles.section}>
        <Text accessibilityRole="header" aria-level={2} style={styles.heading}>{run ? "其他待確認" : "待你確認"}</Text>
        {agentPending.state === "failed" ? <AppButton label="重新讀取待確認候選" variant="quiet" density="compact" disabled={!agentModel.online || !!agentModel.busy || !!agentModel.pendingDecision || !!agentModel.writesBlocked || agentModel.readState === "denied"} onPress={() => readAgentPending()} style={styles.inlineButton} /> : null}
        {agentPending.state === "idle" ? <Text style={styles.label}>{agentModel.online ? "待確認事項尚未讀取；等候目前操作完成後會自動讀取。" : "目前離線，待確認事項尚未核對。"}</Text> : null}
        {agentPending.state === "loading" ? <ReadStateNotice state="loading" refreshing={!!agentPending.hasSnapshot} message="正在讀取待確認事項…" /> : null}
        {agentPending.state === "denied" ? <Text style={styles.warning}>目前沒有權限查看這個孩子的待確認事項。</Text> : null}
        {agentPending.state === "failed" ? <Text style={styles.error}>{agentPending.hasSnapshot ? "未能更新，仍顯示上次讀取的事項。" : "未能讀取待確認事項，請重試。"}</Text> : null}
        {agentPending.state !== "denied" && (agentPending.state === "ready" || agentPending.hasSnapshot) ? pendingEntries.length ? pendingEntries.map(entry => <ActivityCard key={`${entry.runId}-${entry.proposal.id}`}
          cardKey={`proposal-${entry.runId}-${entry.proposal.id}`} content={proposalPrimaryText(entry.proposal)} context={proposalContextLabel(entry.proposal)}
          status={entry.proposal.status === "expired" || proposalExpired(entry.proposal) ? "已過期" : agentProposalLabels[entry.proposal.status]} warning
          disabled={cannotNavigate || !agentModel.online} onPress={() => openProposal(entry)}
          cardRef={node => cardRef(`proposal-${entry.runId}-${entry.proposal.id}`, node)} />)
          : agentPending.state === "ready" && agentModel.online ? <Text style={styles.label}>{agentPending.nextCursor ? "已載入頁面暫無其他待確認事項；仍可繼續讀取。" : "目前沒有待確認或過期事項。"}</Text> : null : null}
        {agentPending.nextCursor ? <AppButton label="讀取下一頁候選" variant="quiet" density="compact" disabled={!!agentModel.busy || !!agentModel.pendingDecision || !!agentModel.writesBlocked || !agentModel.online} onPress={() => readAgentPending(true)} style={styles.inlineButton} /> : null}
      </View> : null;
  return <AppDialog visible={visible} onDismiss={onDismiss} onClosed={onClosed} accessibilityLabel="活動" style={styles.dialog}>
    <AppDialog.ScrollArea style={styles.scrollArea}><AppScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.contents}
      onScroll={event => { scrollPosition.current = event.nativeEvent.contentOffset.y; }} scrollEventThrottle={16}>
      {showDetails ? <View ref={detailRef} tabIndex={-1} testID="agent-activity-detail" accessibilityLabel={`活動詳情${selected ? `：${selected.label}` : ""}`} style={styles.details}>
        <AgentRunView model={agentModel} actions={agentActions} onLocateSource={onLocateSource} activity activityHeading={activityHeading} proposalTarget={selected?.target} proposalOnly={!!selected?.target}
          activityNavigation={<View style={styles.details}><AppButton label="返回活動" accessibilityLabel="返回活動列表" variant="quiet" density="compact" disabled={cannotReturn} onPress={returnToCards} style={styles.inlineButton} />
            {cannotReturn ? <Text style={styles.label}>{"目前正在處理或未能核對存取權，暫時不能返回。"}</Text> : null}</View>} />
      </View>
        : <View testID="agent-activity-header" style={styles.activityToolbar}>{activityHeading}</View>}
      {!showDetails ? <View ref={listRef} tabIndex={-1} accessibilityLabel="活動列表" testID="agent-activity-list" style={styles.details}>
        {agentModel.pendingDecision ? <AppButton label="查看待確認結果" variant="quiet" density="compact"
          disabled={!agentModel.online || !!agentModel.busy || agentModel.readState === "denied"}
          onPress={() => { setListRequested(false); selectAgentRun(agentModel.pendingDecision!.runId); }} style={styles.inlineButton} /> : null}
        {pendingContent}
        <BackgroundRuns key={scopeKey} model={agentInbox} actions={agentInboxActions} onSelect={openBackground} cardRef={cardRef} />
      </View> : null}
      {showDetails && !selected?.target && showReceipts && run && (!selected || selected.runId === run.id) ? <View testID="agent-operation-receipts" style={styles.section}>
        <View style={styles.rowHeading}><Text accessibilityRole="header" aria-level={2} style={styles.heading}>操作結果</Text>
          <AppButton label="重新檢查" accessibilityLabel="重新檢查本次操作是否已保存" variant="quiet" density="compact" disabled={!authorization.online || receipt?.state === "loading"} onPress={() => authorizationActions.readReceipts(run.id, true)} style={styles.inlineButton} /></View>
        {receipt?.state === "ready" ? receipt.items.length ? receipt.items.map(item => <Receipt key={`${run.id}:${item.id}`} item={item} />)
          : <Text style={styles.warning}>目前離線，操作收據尚未重新核對。</Text>
          : <Text style={receipt?.state === "failed" ? styles.error : styles.label}>{receipt?.state === "loading" ? "正在檢查是否已保存…" : receipt?.state === "denied" ? "沒有權限查看操作結果。" : "暫時無法確認是否已保存"}</Text>}
      </View> : null}
      {showDetails && !selected?.target && (!selected || selected.runId === run?.id) && run?.privateSourceCitations?.length ? <View style={styles.section}>
        <Text accessibilityRole="header" aria-level={2} style={styles.heading}>私人參考</Text>
        <Text style={styles.label}>回答當時獲授權的原文快照；不是已核對的官方育兒來源，停用或更正後不供新回答使用。</Text>
        {run.privateSourceCitations.map((source, index) => <ActivityDetails key={`${run.id}:${source.citationId}`} label={`私人來源 ${index + 1} · ${source.label}`} scopeKey={`${run.id}:${source.citationId}`}>
          <Text style={styles.label}>版本 {source.version}</Text><Text selectable style={styles.label}>{source.excerpt}</Text>
        </ActivityDetails>)}
      </View> : null}
    </AppScrollView></AppDialog.ScrollArea>
    <AppDialog.Actions><AppButton label="關閉" variant="quiet" onPress={onDismiss} /></AppDialog.Actions>
  </AppDialog>;
}
const styles = StyleSheet.create({
  dialog: { maxWidth: 720 }, scrollArea: { paddingHorizontal: 0, minHeight: 0 },
  contents: { gap: spacing.lg, minWidth: 0, padding: spacing.md },
  activityToolbar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minWidth: 0 },
  activityHeading: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, minWidth: 0 },
  activityTitle: { marginHorizontal: 0, marginVertical: 0, flexShrink: 0, fontSize: 22, lineHeight: 28 },
  activityCount: { fontFamily: chatFont, color: chatColors.secondary, fontSize: 13, lineHeight: 18, flexShrink: 1, minWidth: 0 },
  section: { gap: spacing.sm, minWidth: 0, borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.md },
  row: { gap: spacing.sm, minWidth: 0, paddingVertical: spacing.sm },
  rowHeading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, minWidth: 0 },
  details: { gap: spacing.sm, minWidth: 0 }, inlineButton: { alignSelf: "flex-start", maxWidth: "100%", minWidth: 0 },
  activityCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, minWidth: 0, minHeight: 96, padding: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: radius.medium, backgroundColor: colors.white },
  cardCopy: { flex: 1, minWidth: 0, gap: spacing.sm },
  cardContent: { fontFamily: chatFont, color: chatColors.ink, fontSize: 20, lineHeight: 29, fontWeight: "600", minWidth: 0 },
  cardHighlighted: { backgroundColor: colors.quietSurface }, cardFocused: { borderWidth: 2, borderColor: colors.teal },
  cardPressed: { backgroundColor: colors.paleTeal }, cardDisabled: { opacity: 0.6 },
  heading: { fontFamily: chatFont, color: chatColors.ink, ...chatType.section, flexShrink: 1, minWidth: 0 },
  rowTitle: { fontFamily: chatFont, color: chatColors.ink, ...chatType.tool, fontWeight: "600", flexShrink: 1, minWidth: 0 },
  label: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.meta, flexShrink: 1, minWidth: 0 },
  error: { fontFamily: chatFont, color: colors.errorInk, ...chatType.tool, flexShrink: 1 },
  warning: { fontFamily: chatFont, color: colors.warningInk, ...chatType.tool, flexShrink: 1 },
});
