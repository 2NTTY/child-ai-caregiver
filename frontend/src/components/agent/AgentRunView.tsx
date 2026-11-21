import { AppStatusBadge } from "../AppStatusBadge";
import { useId, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import {
  agentRunLabels, agentTime, agentToolLabels, mayCheckShared, mayDecide, mayEditProposal,
  mayRetryOriginal, proposalNeedsConfirmation, proposalDisplayStatus, type AgentProposalView,
  type AgentRunActions, type AgentRunModel,
  publicAnswerSources,
} from "../../agent-view-model";
import { DRAFT_CANCEL_NOT_HISTORY_UNDO_COPY, describeOperationUndoCapability } from "../../../../src/shared/operation-undo.ts";
import { ProposalDraftEditor } from "./ProposalDraftEditor.tsx";
import { chineseFont, colors, radius, readingType, spacing, workspaceType } from "../../theme";
import { AppCheckbox } from "../AppCheckbox";
import { AppIcon } from "../AppIcon";
import { AppButton } from "../ui";
import { StatusAnnouncement } from "../StatusAnnouncement";
import type { LocateAnswerSource } from "../chat/AnswerSources";
import { ChatMessage } from "../chat/ChatMessage";
import { ChatAction } from "../chat/ChatAction";
import { compactStopReason, failedReplyContent } from "../chat/failed-reply";
import { MotionDisclosure, MotionFeedback, MotionReveal } from "../../motion";
import { proposalContextLabel, proposalDetailGroups, proposalDetailIcon, proposalDetailIsChange } from "./proposal-presentation";

export interface ActivityProposalTarget { runId: string; id: string; version: number; kind: AgentProposalView["kind"]; scope: AgentProposalView["scope"] }

type DecisionMotionIntent = { serial: number; proposalId: string; version: number; status: "accepted" | "dismissed" };

type Tone = "neutral" | "saved" | "warning" | "error";
const sharedConfirmationLabel = "同意將這項資料分享給家庭";
const destinations: Record<AgentProposalView["kind"], string> = {
  care_record_create: "保存照護記錄", care_record_revise: "更正原照護記錄",
  private_note_create: "保存私人備註", private_note_revise: "更正原私人備註",
  task_create: "新增待辦", task_change: "更新原待辦", family_document_change: "更新原家庭文件",
  memory_fact: "保存確認事實", memory_fact_revise: "更正原事實", memory_fact_deactivate: "停用原事實",
  private_source_create: "保存私人來源", private_source_change: "更新原私人來源",
  concern_create: "加入持續關注", concern_change: "更新原關注",
};
const receiptDescriptions: Record<NonNullable<AgentProposalView["result"]>["kind"], string> = {
  care_record: "已儲存照護記錄",
  private_note: "已儲存私人備註",
  family_document: "已更新家庭文件",
  task: "已儲存待辦",
  memory_fact: "已儲存記憶",
  concern: "已儲存關注",
  private_source: "已儲存私人來源設定",
};

function timeLabel(value: string | null): string {
  return value === null ? "未提供" : Number.isFinite(Date.parse(value)) ? `${agentTime(value)}` : "時間資料無效，請重新讀取";
}

function StateNote({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return <View style={[styles.note, tone === "saved" && styles.savedNote, tone === "warning" && styles.warningNote, tone === "error" && styles.errorNote]}>
    <AppIcon name={tone === "saved" ? "check-circle" : "information-outline"} size={18}
      color={tone === "saved" ? colors.deepTeal : tone === "warning" ? colors.warningInk : tone === "error" ? colors.errorInk : colors.muted} />
    <Text style={[styles.noteCopy, tone === "saved" && styles.saved, tone === "warning" && styles.warning, tone === "error" && styles.error]}>{children}</Text>
  </View>;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <View style={styles.detailRow}><Text style={styles.detailLabel}>{label}</Text><Text selectable style={styles.detailValue}>{value}</Text></View>;
}

function ChangeDetail({ label, value, prominent = false }: { label: string; value: string; prominent?: boolean }) {
  if (prominent) return <View style={styles.exactChange}>
    <Text style={styles.detailLabel}>{label}</Text>
    <Text selectable style={styles.changeBody}>{value}</Text>
  </View>;
  const icon = proposalDetailIcon(label, value);
  const concise = label === "來源" || label === "接受後可見範圍";
  return <View style={styles.changeDetail}>
    {icon ? <AppIcon name={icon} size={15} /> : null}
    <Text selectable accessibilityLabel={`${label}：${value}`} style={styles.detailCopy}>{concise ? value : `${label}：${value}`}</Text>
  </View>;
}

function decisionMessage(model: AgentRunModel): string {
  const pending = model.pendingDecision;
  return pending?.rejected || pending?.reconfirm
    ? pending.input.decision === "accept" ? "未接受成功" : "未略過成功"
    : "暫時無法確認結果";
}

function OriginalDecision({ model, actions }: { model: AgentRunModel; actions: AgentRunActions }) {
  const pending = model.pendingDecision;
  if (!pending) return null;
  return <View testID="agent-decision-recovery" style={styles.recovery}>
    <StateNote tone={pending.rejected || pending.reconfirm ? "error" : "warning"}>
      {model.busy === "read" ? "正在確認…" : decisionMessage(model)}
    </StateNote>
    {pending.reviewed && !pending.reconfirm ? <AppButton label={pending.input.decision === "accept" ? "再次接受" : "再次略過"}
      variant="secondary" disabled={!mayRetryOriginal(model)} onPress={actions.retryOriginal} style={styles.inlineButton} /> : null}
  </View>;
}

function ProposalCard({ proposal, model, actions, scopeKey, readTrigger, readEligible, decisionIntent, preserveDecisionFocusOnRead = false }: {
  proposal: AgentProposalView; model: AgentRunModel; actions: AgentRunActions; scopeKey: string;
  readTrigger: number | null; readEligible: boolean; decisionIntent: DecisionMotionIntent | null; preserveDecisionFocusOnRead?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [sourceExpanded, setSourceExpanded] = useState(false);
  const [editingVersion, setEditingVersion] = useState<number | null>(null);
  const confirmed = model.online && model.readState === "ready" && !model.busy && !model.pendingDecision && model.notice?.tone === "saved"
    && decisionIntent !== null && decisionIntent.proposalId === proposal.id && proposal.version > decisionIntent.version && proposal.status === decisionIntent.status;
  const pending = proposal.status === "pending" || proposal.status === "expired";
  const closed = pending && !proposalNeedsConfirmation(proposal);
  const isEditing = editingVersion === proposal.version && !closed;
  const details = proposalDetailGroups(proposal);
  const changes = details.visible.filter(detail => proposalDetailIsChange(proposal.kind, detail.label));
  const metadata = details.visible.filter(detail => !proposalDetailIsChange(proposal.kind, detail.label));
  const acceptLabel = proposal.kind === "task_create" ? "建立待辦" : proposal.kind === "task_change" ? "確認更改" : "確認資料";
  const undoCapability = !pending && proposal.status === "accepted" && proposal.result && Object.hasOwn(receiptDescriptions, proposal.result.kind)
    ? describeOperationUndoCapability(proposal.result.kind)
    : null;
  const outcome = proposal.result ? Object.hasOwn(receiptDescriptions, proposal.result.kind)
    ? receiptDescriptions[proposal.result.kind] : "保存收據種類未能辨識，請重新讀取核對。"
    : proposal.status === "accepted" ? "尚未確認是否已儲存" : null;
  return <View testID={`agent-proposal-${proposal.id}`} style={pending ? styles.entry : styles.resultEntry}>
    <View style={styles.top}><Text accessibilityRole="header" style={pending && !closed ? styles.proposalContext : styles.title}>{pending && !closed ? proposalContextLabel(proposal) : proposal.title}</Text>
      <MotionFeedback active={confirmed} triggerKey={confirmed ? decisionIntent?.serial ?? null : null} scopeKey={`${scopeKey}:${proposal.id}`} testID="agent-proposal-feedback"><AppStatusBadge label={proposalDisplayStatus(proposal)} tone={proposal.status === "accepted" && proposal.result && Object.hasOwn(receiptDescriptions, proposal.result.kind) ? "success" : pending && !closed ? "warning" : "neutral"} /></MotionFeedback></View>
    {pending ? <>
      {!closed && proposal.diff ? <View testID={`agent-proposal-diff-${proposal.id}`} style={styles.diffBox}>
        <View style={styles.diffBefore}>
          <Text style={styles.detailLabel}>{proposal.diff.beforeLabel}</Text>
          {proposal.diff.beforeTitle ? <Text selectable style={styles.detailValue}>{proposal.diff.beforeTitle}</Text> : null}
          <Text selectable style={styles.meta}>{proposal.diff.beforeText}</Text>
        </View>
        <View style={styles.diffAfter}>
          <Text style={styles.detailLabel}>{proposal.diff.afterLabel}</Text>
          {proposal.diff.afterTitle ? <Text selectable style={styles.detailValue}>{proposal.diff.afterTitle}</Text> : null}
          <Text selectable style={styles.detailValue}>{proposal.diff.afterText}</Text>
        </View>
      </View> : null}
      <View testID={`agent-change-content-${proposal.id}`} style={styles.changeContent}>
        {changes.map((detail, index) => <ChangeDetail key={`${index}-${detail.label}`} label={detail.label} value={detail.value} prominent />)}
        <MotionReveal value={proposal.content} contentKey={proposal.content} scopeKey={`${scopeKey}:${proposal.id}`} regionKey={`agent-proposal-${proposal.id}`} triggerKey={readTrigger} eligible={readEligible}>{text => <Text selectable style={closed ? styles.body : changes.length ? styles.meta : styles.changeBody}>{text}</Text>}</MotionReveal>
      </View>
      <View style={styles.metadata}>
        {(closed ? metadata.filter(detail => ["負責人", "到期時間", "時區"].includes(detail.label)) : metadata).map((detail, index) => <ChangeDetail key={`${index}-${detail.label}`} label={detail.label} value={detail.value} />)}
        {!closed ? <ChangeDetail label="草稿版本" value={`版本 ${proposal.version}`} /> : null}
        {!closed && proposal.scope === "private" ? <ChangeDetail label="接受後可見範圍" value="本人" /> : null}
        <ChangeDetail label="確認期限" value={timeLabel(proposal.expiresAt)} />
      </View>
      {!closed && details.supporting.length > 0 ? <><AppButton label={sourceExpanded ? "收起其他詳情" : "其他詳情"} expanded={sourceExpanded}
        accessibilityLabel={`${sourceExpanded ? "收起" : "查看"}其他詳情：${proposal.title}`} variant="quiet" density="compact"
        onPress={() => setSourceExpanded(value => !value)} style={styles.inlineButton} />
      <MotionDisclosure expanded={sourceExpanded} scopeKey={`${scopeKey}:${proposal.id}:${proposal.version}`}><View style={styles.proposalDetails}>
        {details.supporting.map((detail, index) => <DetailRow key={`${index}-${detail.label}`} label={detail.label} value={detail.value} />)}
      </View></MotionDisclosure></> : null}
      {isEditing && proposal.editableDraft && actions.editProposal ? <ProposalDraftEditor
        key={`${proposal.id}:${proposal.version}`}
        proposalId={proposal.id}
        draft={proposal.editableDraft}
        disabled={!mayEditProposal(model, proposal)}
        busy={model.busy === "write"}
        onSave={async input => {
          const ok = await actions.editProposal?.(proposal.id, input);
          if (ok) setEditingVersion(null);
          return Boolean(ok);
        }}
        onCancel={() => setEditingVersion(null)}
      /> : null}
      {!closed && proposal.scope === "family" ? <AppCheckbox label={sharedConfirmationLabel}
        accessibilityLabel={`${sharedConfirmationLabel}: ${proposal.title}`} checked={!!model.sharedConfirmed[proposal.id]}
        disabled={isEditing || !mayCheckShared(model, proposal)} onChange={checked => actions.setSharedConfirmation(proposal.id, checked)} /> : null}
      <View style={styles.actions}>
        {!closed && <AppButton label={acceptLabel} accessibilityLabel={`明確${acceptLabel}：${proposal.title}`} disabled={isEditing || !mayDecide(model, proposal, "accept")}
          preserveFocusWhenDisabled={preserveDecisionFocusOnRead && model.busy === "read" && mayDecide({ ...model, busy: null }, proposal, "accept")}
          onPress={() => actions.decide(proposal.id, "accept")} style={styles.decisionButton} />}
        {!closed && !isEditing && proposal.editableDraft && actions.editProposal ? <AppButton label="修改草稿"
          accessibilityLabel={`修改草稿：${proposal.title}`} variant="secondary" disabled={!mayEditProposal(model, proposal)}
          onPress={() => setEditingVersion(proposal.version)} style={styles.decisionButton} /> : null}
        <AppButton label="略過" accessibilityLabel={`略過此事項：${proposal.title}`} variant="quiet" disabled={isEditing || !mayDecide(model, proposal, "dismiss")}
          preserveFocusWhenDisabled={preserveDecisionFocusOnRead && model.busy === "read" && mayDecide({ ...model, busy: null }, proposal, "dismiss")}
          onPress={() => actions.decide(proposal.id, "dismiss")} style={styles.decisionButton} />
      </View>
      {!closed ? <Text testID={`agent-draft-cancel-note-${proposal.id}`} style={styles.meta}>{DRAFT_CANCEL_NOT_HISTORY_UNDO_COPY}</Text> : null}
    </> : <>
      {outcome ? <Text style={styles.meta}>{outcome}</Text> : null}
      <AppButton expanded={expanded} label={expanded ? "收起詳情" : "查看詳情"} accessibilityLabel={`${expanded ? "收起" : "查看"}結果詳情：${proposal.title}`}
        variant="quiet" density="compact" onPress={() => setExpanded(value => !value)} style={styles.inlineButton} />
      <MotionDisclosure expanded={expanded} scopeKey={`${scopeKey}:${proposal.id}`}><View style={styles.proposalDetails}>
        <Text selectable style={styles.body}>{proposal.content}</Text>
        <Text style={styles.meta}>{destinations[proposal.kind]} · {proposal.scope === "family" ? "家庭共享資料" : "只供本人查看"}</Text>
        {[...details.visible, ...details.supporting].map((detail, index) => <DetailRow key={`${index}-${detail.label}`} label={detail.label} value={detail.value} />)}
        {undoCapability ? <DetailRow label="後續處理與撤銷範圍" value={`${undoCapability.label}；${undoCapability.limitation}`} /> : null}
      </View></MotionDisclosure>
    </>}
  </View>;
}

function RunDetails({ run }: { run: NonNullable<AgentRunModel["run"]> }) {
  const [expanded, setExpanded] = useState(false);
  if (!run.tools.length) return null;
  return <View style={styles.section}>
    <ChatAction expanded={expanded} disclosure label={`處理步驟 · ${run.tools.length} 項`} onPress={() => setExpanded(value => !value)} />
    <MotionDisclosure expanded={expanded} scopeKey={run.id}><View style={styles.details}>
      {run.tools.map(tool => <View key={tool.id} style={styles.tool}>
        <View style={styles.top}>
          {tool.status === "succeeded" && <AppIcon name="check" size={14} />}
          <Text accessibilityLabel={`${tool.nameLabel}，${agentToolLabels[tool.status]}`} style={styles.meta}>{tool.nameLabel}</Text>
          {tool.status !== "succeeded" && <Text style={tool.status === "failed" ? styles.error : styles.warning}>{agentToolLabels[tool.status]}</Text>}
        </View>
      </View>)}
    </View></MotionDisclosure>
  </View>;
}

function RunAnswer({ run, activity, actions, onLocateSource }: {
  run: NonNullable<AgentRunModel["run"]>; activity: boolean; actions: AgentRunActions; onLocateSource?: LocateAnswerSource;
}) {
  const [expanded, setExpanded] = useState(false);
  const text = run.status === "stopped" || run.status === "unknown" ? failedReplyContent(run.text) : run.text;
  if (!text && !run.citations.length) return null;
  const answer = <ChatMessage testID="agent-answer" embedded
    message={{ id: run.id, role: "assistant", text, sources: publicAnswerSources(run),
      phase: run.status === "running" ? "thinking" : run.status === "unknown" ? "unknown" : run.status === "stopped" ? "stopped" : "complete" }}
    phaseLabel={agentRunLabels[run.status]} onOpenSource={actions.openSource} onLocateSource={onLocateSource}
    degraded={run.retrievalMode === "keyword_degraded"} />;
  return <View style={styles.section}>
    {activity ? <>
      <ChatAction label={run.citations.length ? `回覆與來源 · ${run.citations.length} 個` : "查看原回覆"} expanded={expanded}
        disclosure onPress={() => setExpanded(value => !value)} />
      <MotionDisclosure expanded={expanded} scopeKey={run.id}><View style={styles.details}>{answer}</View></MotionDisclosure>
    </> : answer}
  </View>;
}

export function AgentRunView({ model, actions: sourceActions, onLocateSource, activity = false, activityHeaderVisible, activityNavigation, proposalTarget, proposalOnly = false, pendingContent, preserveDecisionFocusOnRead = false }: { model: AgentRunModel; actions: AgentRunActions; onLocateSource?: LocateAnswerSource; activity?: boolean; activityHeaderVisible?: boolean; activityNavigation?: ReactNode; proposalTarget?: ActivityProposalTarget; proposalOnly?: boolean; pendingContent?: ReactNode; preserveDecisionFocusOnRead?: boolean }) {
  const instanceScope = useId();
  const serial = useRef(0);
  const [readIntent, setReadIntent] = useState<{ serial: number; runId: string } | null>(null);
  const [decisionIntent, setDecisionIntent] = useState<DecisionMotionIntent | null>(null);
  const denied = model.readState === "denied";
  const run = !denied && model.readState !== "idle" && (!proposalTarget || model.run?.id === proposalTarget.runId) ? model.run : null;
  const ready = model.readState === "ready";
  const scopeKey = `${instanceScope}:${run?.childId ?? "none"}:${run?.id ?? "none"}`;
  const readEligible = !!run && ready && model.online && !model.busy && run.status !== "unknown" && model.notice?.tone !== "error";
  const readTrigger = readIntent && readIntent.runId === run?.id && model.online && (model.readState === "loading" || readEligible) ? readIntent.serial : null;
  const actions: AgentRunActions = {
    ...sourceActions,
    refresh() {
      const pending = model.pendingDecision;
      if (!pending || pending.proposalId !== decisionIntent?.proposalId || pending.input.expectedVersion !== decisionIntent.version) setDecisionIntent(null);
      setReadIntent(model.run ? { serial: ++serial.current, runId: model.run.id } : null);
      sourceActions.refresh();
    },
    decide(id, decision) {
      const proposal = model.run?.proposals.find(item => item.id === id);
      if (!proposal || !mayDecide(model, proposal, decision)) return;
      setReadIntent(null);
      setDecisionIntent({ serial: ++serial.current, proposalId: id, version: proposal.version, status: decision === "accept" ? "accepted" : "dismissed" });
      sourceActions.decide(id, decision);
    },
    retryOriginal() {
      const pending = model.pendingDecision;
      if (!pending || !mayRetryOriginal(model)) return;
      setReadIntent(null);
      setDecisionIntent({ serial: ++serial.current, proposalId: pending.proposalId, version: pending.input.expectedVersion, status: pending.input.decision === "accept" ? "accepted" : "dismissed" });
      sourceActions.retryOriginal();
    },
  };
  const readMessage = model.readState === "idle" ? "尚未讀取結果"
    : model.readState === "loading" ? "正在讀取…"
      : model.readState === "failed" ? model.notice?.text ?? "未能讀取結果"
        : denied ? "你已沒有權限查看這次結果"
          : !run ? "目前沒有可展示的運行結果。" : null;
  const announcementKey = readMessage ? `read:${model.readState}`
    : !model.online ? "offline" : model.busy === "write" ? "decision:working"
      : model.notice ? `notice:${model.notice.tone}:${model.notice.text}`
        : model.pendingDecision ? `decision:pending:${model.pendingDecision.reviewed}:${model.pendingDecision.reconfirm}`
          : `run:${run?.status ?? "empty"}`;
  const announcementMessage = model.pendingDecision ? model.busy === "read" ? "正在確認…" : decisionMessage(model) : readMessage
    ?? (!model.online ? "目前離線，恢復連線後才可重新讀取或確認事項。"
      : model.busy === "write" ? "正在處理原決定，請等候原操作結果。"
        : model.notice?.text ?? (run ? proposalOnly && run.status === "completed" ? "請核對所選事項。" : `Agent 運行${agentRunLabels[run.status]}；請核對結果。` : ""));
  const selectedProposals = run?.proposals.filter(proposal => !proposalTarget ? !proposalOnly : (proposal.id === proposalTarget.id
    && proposal.kind === proposalTarget.kind && proposal.scope === proposalTarget.scope && proposal.version >= proposalTarget.version)) ?? [];
  const pending = selectedProposals.filter(proposalNeedsConfirmation);
  const handled = selectedProposals.filter(proposal => !proposalNeedsConfirmation(proposal));
  const targetUnavailable = (proposalOnly || !!proposalTarget) && ready && (!run || selectedProposals.length === 0);
  const problems = run?.tools.filter(tool => tool.status !== "succeeded") ?? [];
  const recoveryNeeded = targetUnavailable || !!model.pendingDecision || model.readState === "failed" || run?.status === "unknown" || !proposalOnly && problems.length > 0;
  const refreshLabel = model.pendingDecision ? "重新確認" : run?.status === "unknown" || !proposalOnly && problems.length ? "讀取原運行並核對" : model.readState === "failed" ? "重試讀取結果" : targetUnavailable ? "重新檢查這項活動" : "更新";
  const showRunToolbar = !proposalOnly || recoveryNeeded || !ready || !model.online || run?.status !== "completed"
    || model.notice?.tone === "error" || selectedProposals.some(proposal => proposal.contentState === "invalidated");
  const canRefresh = recoveryNeeded || model.readState === "idle" || run?.status === "running" || model.notice?.tone === "error"
    || selectedProposals.some(proposal => proposal.contentState === "invalidated");
  return <View testID="agent-run-view" style={styles.root}>
    <StatusAnnouncement eventKey={announcementKey} message={announcementMessage}
      urgent={model.readState === "failed" || announcementKey.startsWith("notice:error:")} />
    {showRunToolbar && (!activityHeaderVisible || canRefresh) ? <View style={styles.toolbar}>
      {!activityHeaderVisible && (run && ready && (!proposalOnly || run.status !== "completed") ? <AppStatusBadge label={agentRunLabels[run.status]} tone={run.status === "unknown" ? "warning" : run.status === "running" ? "info" : "neutral"} /> : null)}
      {canRefresh ? <AppButton label={model.pendingDecision ? "重新確認" : activityHeaderVisible && recoveryNeeded ? "重新檢查" : refreshLabel} accessibilityLabel={recoveryNeeded ? refreshLabel : "更新活動結果"} variant={recoveryNeeded ? "secondary" : "quiet"} density="compact"
        disabled={!model.online || !!model.busy || denied || model.readState === "loading"} loading={model.busy === "read"}
        onPress={actions.refresh} style={styles.inlineButton} /> : null}
    </View> : null}
    {activityNavigation}
    {activityHeaderVisible && run && ready && run.status !== "completed" && !run.stopReasonLabel ? <View style={styles.scope}><AppStatusBadge label={agentRunLabels[run.status]} tone={run.status === "unknown" ? "warning" : run.status === "running" ? "info" : "neutral"} /></View> : null}
    {readMessage && !model.pendingDecision ? <StateNote tone={model.readState === "failed" ? model.notice?.tone ?? "error" : denied ? "warning" : "neutral"}>{readMessage}</StateNote> : null}
    {targetUnavailable ? <StateNote tone="warning">未能核對你點選的事項，請重新檢查；不會改為展示另一項供你確認。</StateNote> : null}
    {proposalTarget && ready && selectedProposals.some(proposal => proposal.version > proposalTarget.version) ? <Text style={styles.meta}>內容已更新，以下是剛讀取的版本，請重新核對。</Text> : null}
    {!model.online ? <StateNote tone="warning">目前離線；所示資料是上次讀取的快照。恢復連線後才可重新讀取或確認事項。</StateNote> : null}
    {!denied ? <>
      {model.notice && !model.pendingDecision && !readMessage ? <StateNote tone={model.notice.tone}>{model.notice.text}</StateNote> : null}
      {model.busy === "write" ? <StateNote>正在處理原決定，請等候原操作結果。</StateNote> : null}
      {model.busy !== "write" ? <OriginalDecision model={model} actions={actions} /> : null}
    </> : null}
    {run ? <View style={[styles.runContents, !ready && styles.hidden]} aria-hidden={!ready} accessibilityElementsHidden={!ready} importantForAccessibility={ready ? "auto" : "no-hide-descendants"} pointerEvents={ready ? "auto" : "none"}>
      {run.stopReasonLabel && (!proposalOnly || run.status !== "completed") ? <Text accessibilityRole="alert" style={styles.warning}>{compactStopReason(run.stopReasonLabel)}</Text> : null}
      {run.status === "running" ? <StateNote>仍在處理；可稍後更新查看結果。</StateNote> : null}
      {run.status === "unknown" && !run.stopReasonLabel ? <StateNote tone="warning">尚未確認結果，請重新檢查。</StateNote> : null}
      {!proposalOnly && problems.length ? <View testID="agent-run-problems" style={styles.problems}>
        {problems.map(tool => <StateNote key={tool.id} tone={tool.status === "failed" ? "error" : "warning"}>{tool.nameLabel}：{agentToolLabels[tool.status]}。請讀取原運行核對，不要以新操作代替。</StateNote>)}
      </View> : null}
      {!proposalOnly && run.retrievalMode === "keyword_degraded" && !run.citations.length ? <StateNote tone="warning">檢索已降級；請核對原來源及適用範圍。</StateNote> : null}
      {!proposalOnly && !targetUnavailable && !activityHeaderVisible && (pending.length > 0 || handled.length > 0) ? <Text testID="agent-run-summary" style={styles.meta}>{[pending.length ? `${pending.length} 項待你確認` : null, handled.length ? `${handled.length} 項已結束` : null].filter(Boolean).join(" · ")}</Text> : null}
      {pending.length ? <View testID="agent-pending-proposals" style={styles.proposalGroup}>
        {!activityHeaderVisible && !proposalOnly ? <Text accessibilityRole="header" style={styles.title}>待你確認</Text> : null}
        {pending.map(proposal => <ProposalCard preserveDecisionFocusOnRead={preserveDecisionFocusOnRead} key={proposal.id} proposal={proposal} model={model} actions={actions} scopeKey={scopeKey} readTrigger={readTrigger} readEligible={readEligible} decisionIntent={decisionIntent} />)}
      </View> : null}
      {pendingContent}
      {handled.length ? <View testID="agent-handled-proposals" style={styles.section}>
        {!proposalOnly && <Text accessibilityRole="header" style={styles.title}>已結束事項</Text>}
        {handled.map(proposal => <ProposalCard key={proposal.id} proposal={proposal} model={model} actions={actions} scopeKey={scopeKey} readTrigger={readTrigger} readEligible={readEligible} decisionIntent={decisionIntent} />)}
      </View> : null}
      {!proposalOnly && !targetUnavailable ? <RunAnswer key={`answer-${run.id}`} run={run}
        activity={activity && (!activityHeaderVisible || run.status !== "completed" || run.proposals.length > 0)}
        actions={actions} onLocateSource={onLocateSource} /> : null}
      {!proposalOnly && !targetUnavailable ? <RunDetails key={run.id} run={run} /> : null}
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  root: { minWidth: 0, width: "100%", gap: spacing.md }, runContents: { gap: spacing.md, minWidth: 0 }, hidden: { display: "none" },
  toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: spacing.sm, minWidth: 0 },
  section: { gap: spacing.sm, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.softLine, minWidth: 0 },
  details: { gap: spacing.md, minWidth: 0, paddingTop: spacing.sm }, proposalGroup: { gap: spacing.sm, minWidth: 0 },
  entry: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: radius.medium, padding: spacing.md, gap: spacing.md, minWidth: 0 },
  resultEntry: { paddingVertical: spacing.sm, gap: spacing.sm, minWidth: 0 },
  top: { flexDirection: "row", alignItems: "flex-start", flexWrap: "wrap", gap: spacing.sm, minWidth: 0 },
  title: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section, flexShrink: 1, minWidth: 0 },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, flexShrink: 1, minWidth: 0 },
  proposalContext: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta, flex: 1, minWidth: 0 },
  changeContent: { gap: spacing.md, minWidth: 0, paddingVertical: spacing.sm },
  changeBody: { fontFamily: chineseFont, color: colors.ink, fontSize: 22, lineHeight: 32, fontWeight: "600", minWidth: 0, flexShrink: 1 },
  changeDetails: { gap: spacing.sm, minWidth: 0 },
  exactChange: { gap: spacing.xs, minWidth: 0 },
  changeDetail: { flexDirection: "row", alignItems: "flex-start", gap: spacing.xs, minWidth: 0 },
  detailCopy: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta, flex: 1, minWidth: 0 },
  metadata: { gap: spacing.sm, minWidth: 0 },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta, flexShrink: 1, minWidth: 0 },
  destination: { fontFamily: chineseFont, color: colors.ink, ...readingType.meta, flexShrink: 1, minWidth: 0 },
  scope: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, minWidth: 0 }, proposalDetails: { gap: spacing.sm, minWidth: 0 },
  detailRow: { gap: spacing.xs, minWidth: 0 },
  detailLabel: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  detailValue: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, flexShrink: 1, minWidth: 0 },
  note: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, backgroundColor: colors.quietSurface, borderRadius: radius.small, padding: spacing.md, minWidth: 0 },
  noteCopy: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool, flex: 1, minWidth: 0 },
  savedNote: { backgroundColor: colors.paleTeal, borderLeftWidth: 3, borderLeftColor: colors.deepTeal }, saved: { color: colors.deepTeal },
  warningNote: { backgroundColor: colors.paleAmber, borderLeftWidth: 3, borderLeftColor: colors.amber },
  errorNote: { backgroundColor: colors.paleCoral, borderLeftWidth: 3, borderLeftColor: colors.coral },
  warning: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.tool, flexShrink: 1 }, error: { color: colors.errorInk },
  recovery: { gap: spacing.sm, minWidth: 0 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, minWidth: 0 }, decisionButton: { flexGrow: 1, flexBasis: 120, minWidth: 0, maxWidth: "100%" },
  fullButton: { alignSelf: "stretch", maxWidth: "100%", minWidth: 0 }, inlineButton: { alignSelf: "flex-start", maxWidth: "100%", minWidth: 0 },
  problems: { gap: spacing.sm, minWidth: 0 }, tool: { gap: spacing.sm, paddingBottom: spacing.sm },
  diffBox: { gap: spacing.xs, minWidth: 0 },
  diffBefore: { backgroundColor: colors.quietSurface, borderLeftWidth: 3, borderLeftColor: colors.line, borderRadius: radius.small, padding: spacing.sm, gap: spacing.xs, minWidth: 0 },
  diffAfter: { backgroundColor: colors.paleTeal, borderLeftWidth: 3, borderLeftColor: colors.teal, borderRadius: radius.small, padding: spacing.sm, gap: spacing.xs, minWidth: 0 },
});
