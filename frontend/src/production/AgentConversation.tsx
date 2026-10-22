import { useEffect, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View, type ScrollView } from "react-native";
import { Text } from "react-native-paper";
import type { AgentActionReceipt } from "../../../src/shared/agent-actions";
import { useProduction } from "./ProductionProvider";
import { AgentRunView } from "../components/agent/AgentRunView";
import { ReadStateNotice } from "../components/ReadStateNotice";
import { AppDialog } from "../components/AppDialog";
import { AppScrollView } from "../components/AppScrollView";
import { AppStatusBadge } from "../components/AppStatusBadge";
import { locateCitationSource } from "../components/chat/locateCitationSource";
import { chatColors, chatFont, chatType } from "../components/chat/chat-presentation";
import { AppButton } from "../components/ui";
import { agentProposalLabels, agentTime, proposalExpired, type AgentInboxActions, type AgentInboxModel } from "../agent-view-model";
import { MotionDisclosure } from "../motion";
import { colors, spacing } from "../theme";

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
    <View style={styles.rowHeading}><Text accessibilityRole="header" style={styles.rowTitle}>{receiptKinds[item.kind]}</Text><AppStatusBadge label={receiptStates[item.state]} tone="neutral" /></View>
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

function BackgroundRuns({ model, actions }: { model: AgentInboxModel; actions: AgentInboxActions }) {
  const [expanded, setExpanded] = useState(false);
  const loading = model.state === "loading", denied = model.state === "denied", ready = model.state === "ready";
  const attention = model.state === "failed" || denied || !model.online || model.locked;
  const open = expanded || attention;
  return <View testID="agent-activity-background" style={styles.section}>
    {attention ? <Text accessibilityRole="header" style={styles.heading}>私人背景結果</Text>
      : <AppButton label="私人背景結果" expanded={open} variant="quiet" density="compact"
        onPress={() => setExpanded(value => !value)} style={styles.inlineButton} />}
    <MotionDisclosure expanded={open} scopeKey="background-results"><View style={styles.details}>
      <Text style={styles.label}>只供本人查看，最多展示 20 項。</Text>
      {model.state === "idle" ? <Text style={styles.label}>尚未讀取私人背景結果。</Text> : null}
      {loading ? <ReadStateNotice state="loading" message="正在讀取私人背景結果…" /> : null}
      {model.state === "failed" ? <Text style={styles.error}>未能讀取私人背景結果，請重試。</Text> : null}
      {denied ? <Text style={styles.warning}>已失去讀取權限，原清單已隱藏。</Text> : null}
      {!model.online ? <Text style={styles.warning}>目前離線，所示清單只是上次讀取的快照。</Text> : null}
      {model.locked && !denied ? <Text style={styles.warning}>原操作待查核，暫時不能切換或收起結果。</Text> : null}
      <AppButton label={model.state === "failed" ? "重試讀取私人背景結果" : "讀取私人背景結果"} variant="quiet" density="compact"
        disabled={!model.online || model.locked || loading || denied} loading={loading} onPress={actions.refresh} style={styles.inlineButton} />
      {ready ? model.entries.length ? model.entries.slice(0, 20).map(entry => <View key={entry.runId} style={styles.row} accessibilityState={{ selected: entry.runId === model.selectedRunId }} aria-selected={entry.runId === model.selectedRunId}>
        <Text style={styles.rowTitle}>{entry.label}</Text>
        <Text style={styles.label}>{backgroundTime(entry.createdAt)}</Text>
        {entry.runId === model.selectedRunId ? <Text style={styles.label}>目前展示此結果</Text> : null}
        <AppButton label="查看結果" accessibilityLabel={`查看私人背景結果：${entry.label}，${backgroundTime(entry.createdAt)}`} variant="quiet" density="compact"
          disabled={model.locked || !model.online || loading} onPress={() => actions.select(entry.runId)} style={styles.inlineButton} />
      </View>) : model.online ? <Text style={styles.label}>目前沒有私人背景結果。</Text> : null : null}
      {ready && model.selectedRunId ? <AppButton label="收起私人背景結果" variant="quiet" density="compact" disabled={model.locked} onPress={actions.collapse} style={styles.inlineButton} /> : null}
    </View></MotionDisclosure>
  </View>;
}

export function AgentConversation({ visible, onDismiss, onClosed }: { visible: boolean; onDismiss(): void; onClosed?(): void; onOpenSettings(): void; onReloadChat(): void; reloadDisabled: boolean }) {
  const { scopeKey, agentModel, agentActions, agentInbox, agentInboxActions, agentPending, readAgentPending, selectAgentRun, authorization, authorizationActions } = useProduction();
  const scrollRef = useRef<ScrollView | null>(null);
  const onLocateSource = (target: View | null, horizontalScroll?: ScrollView | null, verticalTarget?: View | null) =>
    locateCitationSource(target, scrollRef.current, horizontalScroll, verticalTarget);
  const run = agentModel.readState === "ready" ? agentModel.run : null;
  const receipt = run ? authorization.receipts[run.id] : undefined;
  useEffect(() => { if (visible && run && !receipt) authorizationActions.readReceipts(run.id); }, [visible, run?.id, receipt?.state]);
  const pendingEntries = agentPending.entries.filter(entry => !run || entry.runId !== run.id
    || !run.proposals.some(proposal => proposal.id === entry.proposal.id && proposal.version >= entry.proposal.version));
  const showPending = !run || pendingEntries.length > 0 || agentPending.state !== "ready" || !!agentPending.nextCursor;
  const showReceipts = !!run && (receipt?.state !== "ready" || receipt.items.length > 0 || !authorization.online);
  const pendingContent = showPending ? <View testID="agent-other-pending" style={styles.section}>
        <Text accessibilityRole="header" style={styles.heading}>{run ? "其他待確認" : "待你確認"}</Text>
        {agentPending.state === "failed" ? <AppButton label="重新讀取待確認候選" variant="quiet" density="compact" disabled={!agentModel.online || !!agentModel.busy || !!agentModel.pendingDecision || !!agentModel.writesBlocked || agentModel.readState === "denied"} onPress={() => readAgentPending()} style={styles.inlineButton} /> : null}
        {agentPending.state === "idle" ? <Text style={styles.label}>{agentModel.online ? "待確認事項尚未讀取；等候目前操作完成後會自動讀取。" : "目前離線，待確認事項尚未核對。"}</Text> : null}
        {agentPending.state === "loading" ? <ReadStateNotice state="loading" refreshing={!!agentPending.hasSnapshot} message="正在讀取待確認事項…" /> : null}
        {agentPending.state === "denied" ? <Text style={styles.warning}>目前沒有權限查看這個孩子的待確認事項。</Text> : null}
        {agentPending.state === "failed" ? <Text style={styles.error}>{agentPending.hasSnapshot ? "未能更新，仍顯示上次讀取的事項。" : "未能讀取待確認事項，請重試。"}</Text> : null}
        {agentPending.state !== "denied" && (agentPending.state === "ready" || agentPending.hasSnapshot) ? pendingEntries.length ? pendingEntries.map(entry => <View key={entry.proposal.id} style={styles.row}>
          <View style={styles.rowHeading}><Text style={styles.rowTitle}>{entry.proposal.title}</Text><AppStatusBadge label={entry.proposal.status === "expired" || proposalExpired(entry.proposal) ? "已過期" : agentProposalLabels[entry.proposal.status]} tone="warning" /></View>
          <AppButton label="核對原運行與候選" accessibilityLabel={`核對待確認事項：${entry.proposal.title}`} variant="quiet" density="compact" disabled={!!agentModel.busy || !!agentModel.pendingDecision || !!agentModel.writesBlocked || !agentModel.online} onPress={() => selectAgentRun(entry.runId)} style={styles.inlineButton} />
        </View>) : agentPending.state === "ready" && agentModel.online ? <Text style={styles.label}>{agentPending.nextCursor ? "已載入頁面暫無其他待確認事項；仍可繼續讀取。" : "目前沒有待確認或過期事項。"}</Text> : null : null}
        {agentPending.nextCursor ? <AppButton label="讀取下一頁候選" variant="quiet" density="compact" disabled={!!agentModel.busy || !!agentModel.pendingDecision || !!agentModel.writesBlocked || !agentModel.online} onPress={() => readAgentPending(true)} style={styles.inlineButton} /> : null}
      </View> : null;
  return <AppDialog visible={visible} onDismiss={onDismiss} onClosed={onClosed} accessibilityLabel="活動" style={styles.dialog}>
    <AppDialog.Title>活動</AppDialog.Title>
    <AppDialog.ScrollArea style={styles.scrollArea}><AppScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.contents}>
      {agentModel.readState !== "idle" ? <AgentRunView model={agentModel} actions={agentActions} onLocateSource={onLocateSource} activity pendingContent={run ? pendingContent : undefined} /> : null}
      {!run ? pendingContent : null}
      {showReceipts && run ? <View testID="agent-operation-receipts" style={styles.section}>
        <View style={styles.rowHeading}><Text accessibilityRole="header" style={styles.heading}>操作結果</Text>
          <AppButton label={receipt?.state === "failed" ? "重試讀取收據" : "更新"} accessibilityLabel="重新讀取本次收據" variant="quiet" density="compact" disabled={!authorization.online || receipt?.state === "loading"} onPress={() => authorizationActions.readReceipts(run.id, true)} style={styles.inlineButton} /></View>
        {receipt?.state === "ready" ? receipt.items.length ? receipt.items.map(item => <Receipt key={`${run.id}:${item.id}`} item={item} />)
          : <Text style={styles.warning}>目前離線，操作收據尚未重新核對。</Text>
          : <Text style={receipt?.state === "failed" ? styles.error : styles.label}>{receipt?.state === "loading" ? "正在讀取操作收據…" : receipt?.state === "denied" ? "沒有權限查看操作收據。" : "操作收據尚未確認；不能推斷已保存。"}</Text>}
      </View> : null}
      {run?.privateSourceCitations?.length ? <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.heading}>私人參考</Text>
        <Text style={styles.label}>回答當時獲授權的原文快照；不是已核對的官方育兒來源，停用或更正後不供新回答使用。</Text>
        {run.privateSourceCitations.map((source, index) => <ActivityDetails key={`${run.id}:${source.citationId}`} label={`私人來源 ${index + 1} · ${source.label}`} scopeKey={`${run.id}:${source.citationId}`}>
          <Text style={styles.label}>版本 {source.version}</Text><Text selectable style={styles.label}>{source.excerpt}</Text>
        </ActivityDetails>)}
      </View> : null}
      <BackgroundRuns key={scopeKey} model={agentInbox} actions={agentInboxActions} />
    </AppScrollView></AppDialog.ScrollArea>
    <AppDialog.Actions><AppButton label="關閉" variant="quiet" onPress={onDismiss} /></AppDialog.Actions>
  </AppDialog>;
}
const styles = StyleSheet.create({
  dialog: { maxWidth: 720 }, scrollArea: { paddingHorizontal: 0, minHeight: 0 },
  contents: { gap: spacing.lg, minWidth: 0, padding: spacing.md },
  section: { gap: spacing.sm, minWidth: 0, borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.md },
  row: { gap: spacing.sm, minWidth: 0, paddingVertical: spacing.sm },
  rowHeading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, minWidth: 0 },
  details: { gap: spacing.sm, minWidth: 0 }, inlineButton: { alignSelf: "flex-start", maxWidth: "100%", minWidth: 0 },
  heading: { fontFamily: chatFont, color: chatColors.ink, ...chatType.section, flexShrink: 1, minWidth: 0 },
  rowTitle: { fontFamily: chatFont, color: chatColors.ink, ...chatType.tool, fontWeight: "600", flexShrink: 1, minWidth: 0 },
  label: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.meta, flexShrink: 1, minWidth: 0 },
  error: { fontFamily: chatFont, color: colors.errorInk, ...chatType.tool, flexShrink: 1 },
  warning: { fontFamily: chatFont, color: colors.warningInk, ...chatType.tool, flexShrink: 1 },
});
