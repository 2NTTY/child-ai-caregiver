import { AppStatusBadge } from "../AppStatusBadge";
import { useId, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import {
  agentProposalLabels, agentRunLabels, agentTime, agentToolLabels, mayCheckShared, mayDecide,
  mayRetryOriginal, proposalExpired, type AgentProposalView,
  type AgentRunActions, type AgentRunModel,
} from "../../agent-view-model";
import { chineseFont, colors, radius, readingType, spacing, workspaceType } from "../../theme";
import { AppCheckbox } from "../AppCheckbox";
import { AppIcon } from "../AppIcon";
import { AppButton } from "../ui";
import { StatusAnnouncement } from "../StatusAnnouncement";
import type { LocateAnswerSource } from "../chat/AnswerSources";
import { ChatMessage } from "../chat/ChatMessage";
import { MotionDisclosure, MotionFeedback, MotionReveal } from "../../motion";
import { proposalContextLabel, proposalDetailGroups, proposalDetailIcon, proposalDetailIsChange } from "./proposal-presentation";

export interface ActivityProposalTarget { runId: string; id: string; version: number; kind: AgentProposalView["kind"]; scope: AgentProposalView["scope"] }

type DecisionMotionIntent = { serial: number; proposalId: string; version: number; status: "accepted" | "dismissed" };

type Tone = "neutral" | "saved" | "warning" | "error";
const sharedConfirmationLabel = "我已核對內容及對象，明確同意寫入家庭共享資料";
const destinations: Record<AgentProposalView["kind"], string> = {
  task_create: "新增待辦", task_change: "更新原待辦", family_document_change: "更新原家庭文件",
  memory_fact: "保存確認事實", memory_fact_revise: "更正原事實", memory_fact_deactivate: "停用原事實",
  private_source_create: "保存私人來源", private_source_change: "更新原私人來源",
  concern_create: "加入持續關注", concern_change: "更新原關注",
};
const receiptDescriptions: Record<NonNullable<AgentProposalView["result"]>["kind"], string> = {
  family_document: "指定修改已保存到同一份家庭文件；請按目前來源及版本核對正文。",
  task: "此收據代表任務資料已保存；照護事項的完成狀態另行記錄。",
  memory_fact: "此收據代表確認事實已保存；不代表照護事項已完成。",
  concern: "關注鏈已保存。",
  private_source: "私人來源設定已保存；連結保存不等於取得正文，亦沒有建立家庭事實、提醒或公共知識。",
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
  const concise = label === "來源" || label === "負責人" || label === "接受後可見範圍";
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
  const confirmed = model.online && model.readState === "ready" && !model.busy && !model.pendingDecision && model.notice?.tone === "saved"
    && decisionIntent !== null && decisionIntent.proposalId === proposal.id && proposal.version > decisionIntent.version && proposal.status === decisionIntent.status;
  const expired = proposal.status === "expired" || proposalExpired(proposal);
  const pending = proposal.status === "pending" || proposal.status === "expired";
  const details = proposalDetailGroups(proposal);
  const changes = details.visible.filter(detail => proposalDetailIsChange(proposal.kind, detail.label));
  const metadata = details.visible.filter(detail => !proposalDetailIsChange(proposal.kind, detail.label));
  const acceptLabel = proposal.kind === "task_create" ? "建立待辦" : proposal.kind === "task_change" ? "確認更改" : "確認資料";
  const outcome = proposal.result ? Object.hasOwn(receiptDescriptions, proposal.result.kind)
    ? receiptDescriptions[proposal.result.kind] : "保存收據種類未能辨識，請重新讀取核對。"
    : proposal.status === "accepted" ? "已接受；本次快照未提供保存收據，不能據此確認已保存。"
      : "已略過，沒有以此決定執行候選事項。";
  return <View testID={`agent-proposal-${proposal.id}`} style={pending ? styles.entry : styles.resultEntry}>
    <View style={styles.top}><Text accessibilityRole="header" style={pending ? styles.proposalContext : styles.title}>{pending ? proposalContextLabel(proposal) : proposal.title}</Text>
      <MotionFeedback active={confirmed} triggerKey={confirmed ? decisionIntent?.serial ?? null : null} scopeKey={`${scopeKey}:${proposal.id}`} testID="agent-proposal-feedback"><AppStatusBadge label={expired && pending ? "已過期" : agentProposalLabels[proposal.status]} tone={proposal.status === "accepted" && proposal.result && Object.hasOwn(receiptDescriptions, proposal.result.kind) ? "success" : pending ? "warning" : "neutral"} /></MotionFeedback></View>
    {pending ? <>
      <View testID={`agent-change-content-${proposal.id}`} style={styles.changeContent}>
        {changes.map((detail, index) => <ChangeDetail key={`${index}-${detail.label}`} label={detail.label} value={detail.value} prominent />)}
        <MotionReveal value={proposal.content} contentKey={proposal.content} scopeKey={`${scopeKey}:${proposal.id}`} regionKey={`agent-proposal-${proposal.id}`} triggerKey={readTrigger} eligible={readEligible}>{text => <Text selectable style={changes.length ? styles.meta : styles.changeBody}>{text}</Text>}</MotionReveal>
      </View>
      <View style={styles.metadata}>
        {metadata.map((detail, index) => <ChangeDetail key={`${index}-${detail.label}`} label={detail.label} value={detail.value} />)}
        <ChangeDetail label="接受後可見範圍" value={proposal.scope === "family" ? "家庭共享；目前只限你查看，確認後按家庭權限共享。" : "本人"} />
        <ChangeDetail label="確認期限" value={timeLabel(proposal.expiresAt)} />
      </View>
      <AppButton label={sourceExpanded ? "收起其他詳情" : "其他詳情"} expanded={sourceExpanded}
        accessibilityLabel={`${sourceExpanded ? "收起" : "查看"}其他詳情：${proposal.title}`} variant="quiet" density="compact"
        onPress={() => setSourceExpanded(value => !value)} style={styles.inlineButton} />
      <MotionDisclosure expanded={sourceExpanded} scopeKey={`${scopeKey}:${proposal.id}:${proposal.version}`}><View style={styles.proposalDetails}>
        {details.supporting.map((detail, index) => <DetailRow key={`${index}-${detail.label}`} label={detail.label} value={detail.value} />)}
        <DetailRow label="候選版本" value={String(proposal.version)} />
      </View></MotionDisclosure>
      {expired ? <StateNote tone="warning">候選已過期，不能接受；可核對後明確略過。</StateNote> : null}
      {proposal.scope === "family" ? <AppCheckbox label={sharedConfirmationLabel}
        accessibilityLabel={`${sharedConfirmationLabel}: ${proposal.title}`} checked={!!model.sharedConfirmed[proposal.id]}
        disabled={!mayCheckShared(model, proposal)} onChange={checked => actions.setSharedConfirmation(proposal.id, checked)} /> : null}
      <View style={styles.actions}>
        <AppButton label={acceptLabel} accessibilityLabel={`明確${acceptLabel}：${proposal.title}`} disabled={!mayDecide(model, proposal, "accept")}
          preserveFocusWhenDisabled={preserveDecisionFocusOnRead && model.busy === "read" && mayDecide({ ...model, busy: null }, proposal, "accept")}
          onPress={() => actions.decide(proposal.id, "accept")} style={styles.decisionButton} />
        <AppButton label="略過" accessibilityLabel={`略過此事項：${proposal.title}`} variant="quiet" disabled={!mayDecide(model, proposal, "dismiss")}
          preserveFocusWhenDisabled={preserveDecisionFocusOnRead && model.busy === "read" && mayDecide({ ...model, busy: null }, proposal, "dismiss")}
          onPress={() => actions.decide(proposal.id, "dismiss")} style={styles.decisionButton} />
      </View>
    </> : <>
      <Text style={styles.meta}>{outcome}</Text>
      <AppButton expanded={expanded} label={expanded ? "收起詳情" : "查看詳情"} accessibilityLabel={`${expanded ? "收起" : "查看"}結果詳情：${proposal.title}`}
        variant="quiet" density="compact" onPress={() => setExpanded(value => !value)} style={styles.inlineButton} />
      <MotionDisclosure expanded={expanded} scopeKey={`${scopeKey}:${proposal.id}`}><View style={styles.proposalDetails}>
        <Text selectable style={styles.body}>{proposal.content}</Text>
        <Text style={styles.meta}>{destinations[proposal.kind]} · {proposal.scope === "family" ? "家庭共享資料" : "只供本人查看"}</Text>
        {proposal.details.map((detail, index) => <DetailRow key={`${index}-${detail.label}`} label={detail.label} value={detail.value} />)}
        {proposal.result ? <DetailRow label="保存收據" value={`${proposal.result.label} · 版本 ${proposal.result.version}`} /> : null}
      </View></MotionDisclosure>
    </>}
  </View>;
}

function RunDetails({ run }: { run: NonNullable<AgentRunModel["run"]> }) {
  const [expanded, setExpanded] = useState(false);
  if (!run.tools.length) return null;
  return <View style={styles.section}>
    <AppButton expanded={expanded} label={`處理步驟 · ${run.tools.length} 項`} variant="quiet" density="compact"
      onPress={() => setExpanded(value => !value)} style={styles.inlineButton} />
    <MotionDisclosure expanded={expanded} scopeKey={run.id}><View style={styles.details}>
      {run.tools.map(tool => <View key={tool.id} style={styles.tool}>
        <View style={styles.top}><Text style={styles.body}>{tool.nameLabel}</Text><AppStatusBadge label={agentToolLabels[tool.status]} tone={tool.status === "succeeded" ? "neutral" : tool.status === "failed" ? "error" : "warning"} /></View>
        {tool.status === "succeeded" ? <Text style={styles.meta}>{tool.savesCandidate
          ? "已準備候選，仍需你核對及確認。"
          : "工具已回報成功；不代表照護事項已完成。"}</Text> : null}
        {tool.status === "unknown" ? <Text style={styles.warning}>工具結果未知，請查核原運行，不能以新操作代替核對。</Text> : null}
      </View>)}
    </View></MotionDisclosure>
  </View>;
}

function RunAnswer({ run, activity, actions, onLocateSource }: {
  run: NonNullable<AgentRunModel["run"]>; activity: boolean; actions: AgentRunActions; onLocateSource?: LocateAnswerSource;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!run.text && !run.citations.length) return null;
  const answer = <ChatMessage testID="agent-answer" embedded
    message={{ id: run.id, role: "assistant", text: run.text, sources: run.citations.length ? run.citations : undefined,
      phase: run.status === "running" ? "thinking" : run.status === "unknown" ? "unknown" : run.status === "stopped" ? "stopped" : "complete" }}
    phaseLabel={agentRunLabels[run.status]} onOpenSource={actions.openSource} onLocateSource={onLocateSource}
    degraded={run.retrievalMode === "keyword_degraded"} />;
  return <View style={styles.section}>
    {activity ? <>
      <AppButton label={run.citations.length ? `回覆與來源 · ${run.citations.length} 個` : "查看原回覆"} expanded={expanded}
        variant="quiet" density="compact" onPress={() => setExpanded(value => !value)} style={styles.inlineButton} />
      <MotionDisclosure expanded={expanded} scopeKey={run.id}><View style={styles.details}>{answer}</View></MotionDisclosure>
    </> : answer}
  </View>;
}

export function AgentRunView({ model, actions: sourceActions, onLocateSource, activity = false, activityHeading, activityNavigation, proposalTarget, proposalOnly = false, pendingContent, preserveDecisionFocusOnRead = false }: { model: AgentRunModel; actions: AgentRunActions; onLocateSource?: LocateAnswerSource; activity?: boolean; activityHeading?: ReactNode; activityNavigation?: ReactNode; proposalTarget?: ActivityProposalTarget; proposalOnly?: boolean; pendingContent?: ReactNode; preserveDecisionFocusOnRead?: boolean }) {
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
  const readMessage = model.readState === "idle" ? "尚未讀取運行結果。請手動讀取後再核對。"
    : model.readState === "loading" ? "正在讀取原運行結果，請稍候；讀取中不能決定候選事項。"
      : model.readState === "failed" ? "未能讀取運行結果。請重新讀取，暫時不能確認候選事項。"
        : denied ? "已失去讀取此運行的權限，原結果及候選內容已隱藏。"
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
  const pending = selectedProposals.filter(proposal => proposal.status === "pending" || proposal.status === "expired");
  const handled = selectedProposals.filter(proposal => proposal.status === "accepted" || proposal.status === "dismissed");
  const targetUnavailable = (proposalOnly || !!proposalTarget) && ready && (!run || selectedProposals.length === 0);
  const problems = run?.tools.filter(tool => tool.status !== "succeeded") ?? [];
  const recoveryNeeded = targetUnavailable || !!model.pendingDecision || model.readState === "failed" || run?.status === "unknown" || !proposalOnly && problems.length > 0;
  const refreshLabel = model.pendingDecision ? "重新確認" : run?.status === "unknown" || !proposalOnly && problems.length ? "讀取原運行並核對" : model.readState === "failed" ? "重試讀取結果" : targetUnavailable ? "重新檢查這項活動" : "更新";
  const showRunToolbar = !proposalOnly || recoveryNeeded || !ready || !model.online || run?.status !== "completed"
    || model.notice?.tone === "error" || selectedProposals.some(proposal => proposal.contentState === "invalidated");
  return <View testID="agent-run-view" style={styles.root}>
    <StatusAnnouncement eventKey={announcementKey} message={announcementMessage}
      urgent={model.readState === "failed" || announcementKey.startsWith("notice:error:")} />
    {showRunToolbar ? <View testID={activityHeading ? "agent-activity-header" : undefined} style={[styles.toolbar, !!activityHeading && styles.activityToolbar]}>
      {activityHeading ?? (run && ready && (!proposalOnly || run.status !== "completed") ? <AppStatusBadge label={agentRunLabels[run.status]} tone={run.status === "unknown" ? "warning" : run.status === "running" ? "info" : "neutral"} /> : null)}
      {recoveryNeeded || !ready || run?.status !== "completed" || model.notice?.tone === "error" || selectedProposals.some(proposal => proposal.contentState === "invalidated") ? <AppButton label={model.pendingDecision ? "重新確認" : activityHeading && recoveryNeeded ? "重新檢查" : refreshLabel} accessibilityLabel={recoveryNeeded ? refreshLabel : "更新活動結果"} variant={recoveryNeeded ? "secondary" : "quiet"} density="compact"
        disabled={!model.online || !!model.busy || denied || model.readState === "loading"} loading={model.busy === "read"}
        onPress={actions.refresh} style={styles.inlineButton} /> : null}
    </View> : null}
    {activityNavigation}
    {activityHeading && run && ready && run.status !== "completed" ? <View style={styles.scope}><AppStatusBadge label={agentRunLabels[run.status]} tone={run.status === "unknown" ? "warning" : run.status === "running" ? "info" : "neutral"} /></View> : null}
    {readMessage && !model.pendingDecision ? <StateNote tone={model.readState === "failed" ? "error" : denied ? "warning" : "neutral"}>{readMessage}</StateNote> : null}
    {targetUnavailable ? <StateNote tone="warning">未能核對你點選的事項，請重新檢查；不會改為展示另一項供你確認。</StateNote> : null}
    {proposalTarget && ready && selectedProposals.some(proposal => proposal.version > proposalTarget.version) ? <Text style={styles.meta}>內容已更新，以下是剛讀取的版本，請重新核對。</Text> : null}
    {!model.online ? <StateNote tone="warning">目前離線；所示資料是上次讀取的快照。恢復連線後才可重新讀取或確認事項。</StateNote> : null}
    {!denied ? <>
      {model.notice && !model.pendingDecision && !readMessage ? <StateNote tone={model.notice.tone}>{model.notice.text}</StateNote> : null}
      {model.busy === "write" ? <StateNote>正在處理原決定，請等候原操作結果。</StateNote> : null}
      {model.busy !== "write" ? <OriginalDecision model={model} actions={actions} /> : null}
    </> : null}
    {run ? <View style={[styles.runContents, !ready && styles.hidden]} aria-hidden={!ready} accessibilityElementsHidden={!ready} importantForAccessibility={ready ? "auto" : "no-hide-descendants"} pointerEvents={ready ? "auto" : "none"}>
      {run.stopReasonLabel && (!proposalOnly || run.status !== "completed") ? <StateNote tone="warning">{run.stopReasonLabel}{run.stopReasonDetail ? (" " + run.stopReasonDetail) : ""}</StateNote> : null}
      {run.status === "running" ? <StateNote>仍在處理；可稍後更新查看結果。</StateNote> : null}
      {run.status === "unknown" ? <StateNote tone="warning">本次運行結果未知，請讀取原運行核對；未知不能當作已成功或已完成。</StateNote> : null}
      {!proposalOnly && problems.length ? <View testID="agent-run-problems" style={styles.problems}>
        {problems.map(tool => <StateNote key={tool.id} tone={tool.status === "failed" ? "error" : "warning"}>{tool.nameLabel}：{agentToolLabels[tool.status]}。請讀取原運行核對，不要以新操作代替。</StateNote>)}
      </View> : null}
      {!proposalOnly && run.retrievalMode === "keyword_degraded" && !run.citations.length ? <StateNote tone="warning">檢索已降級；請核對原來源及適用範圍。</StateNote> : null}
      {!proposalOnly && !targetUnavailable && (!activityHeading || (!pending.length && !handled.length)) ? <Text testID="agent-run-summary" style={styles.meta}>{pending.length || handled.length
        ? [pending.length ? `${pending.length} 項待你確認` : null, handled.length ? `${handled.length} 項已處理` : null].filter(Boolean).join(" · ")
        : ready && model.online && run.status === "completed" && !problems.length ? "本次沒有待確認事項。" : "請核對以下結果；尚未確認的結果不代表已保存。"}</Text> : null}
      {pending.length ? <View testID="agent-pending-proposals" style={styles.proposalGroup}>
        {!activityHeading && !proposalOnly ? <Text accessibilityRole="header" style={styles.title}>待你確認</Text> : null}
        {pending.map(proposal => <ProposalCard preserveDecisionFocusOnRead={preserveDecisionFocusOnRead} key={proposal.id} proposal={proposal} model={model} actions={actions} scopeKey={scopeKey} readTrigger={readTrigger} readEligible={readEligible} decisionIntent={decisionIntent} />)}
      </View> : null}
      {pendingContent}
      {handled.length ? <View testID="agent-handled-proposals" style={styles.section}>
        <Text accessibilityRole="header" style={styles.title}>已處理</Text>
        {handled.map(proposal => <ProposalCard key={proposal.id} proposal={proposal} model={model} actions={actions} scopeKey={scopeKey} readTrigger={readTrigger} readEligible={readEligible} decisionIntent={decisionIntent} />)}
      </View> : null}
      {!proposalOnly && !targetUnavailable ? <RunAnswer key={`answer-${run.id}`} run={run} activity={activity} actions={actions} onLocateSource={onLocateSource} /> : null}
      {!proposalOnly && !targetUnavailable ? <RunDetails key={run.id} run={run} /> : null}
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  root: { minWidth: 0, width: "100%", gap: spacing.md }, runContents: { gap: spacing.md, minWidth: 0 }, hidden: { display: "none" },
  toolbar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: spacing.sm, minWidth: 0 },
  activityToolbar: { flexWrap: "nowrap" },
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
});
