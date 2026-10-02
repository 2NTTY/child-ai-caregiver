import { useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import {
  agentProposalLabels, agentRunLabels, agentTime, agentToolLabels, mayCheckShared, mayDecide,
  mayRetryOriginal, proposalExpired, type AgentProposalView,
  type AgentRunActions, type AgentRunModel,
} from "../../agent-view-model";
import { chineseFont, colors, radius, spacing, typeScale } from "../../theme";
import { AppCheckbox } from "../AppCheckbox";
import { AppIcon } from "../AppIcon";
import { AppButton, SectionCard, SectionHeader } from "../ui";
import { AnswerSources, CitationText } from "./AnswerSources";

type Tone = "neutral" | "saved" | "warning" | "error";
const sharedConfirmationLabel = "我已核對內容及對象，明確同意寫入家庭共享資料";
const retrievalLabels = {
  vector_keyword: "向量及關鍵詞檢索",
  keyword_degraded: "已降級為關鍵詞檢索",
  not_used: "本次沒有使用知識檢索",
} as const;

function timeLabel(value: string | null): string {
  return value === null ? "未提供" : Number.isFinite(Date.parse(value)) ? `${agentTime(value)}（香港時間）` : "時間資料無效，請重新讀取";
}

function StateNote({ children, tone = "neutral" }: { children: ReactNode; tone?: Tone }) {
  return <View style={[styles.note, tone === "saved" && styles.savedNote, tone === "warning" && styles.warningNote, tone === "error" && styles.errorNote]}>
    <AppIcon name={tone === "saved" ? "check-circle" : "information-outline"} size={18}
      color={tone === "saved" ? colors.deepTeal : tone === "warning" ? colors.warningInk : tone === "error" ? colors.errorInk : colors.muted} />
    <Text accessibilityRole={tone === "warning" || tone === "error" ? "alert" : "text"}
      style={[styles.noteCopy, tone === "saved" && styles.saved, tone === "warning" && styles.warning, tone === "error" && styles.error]}>{children}</Text>
  </View>;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <View style={styles.detailRow}><Text style={styles.detailLabel}>{label}</Text><Text selectable style={styles.detailValue}>{value}</Text></View>;
}

function OriginalDecision({ model, actions }: { model: AgentRunModel; actions: AgentRunActions }) {
  const pending = model.pendingDecision;
  if (!pending) return null;
  const originalProposal = model.run?.proposals.find(proposal => proposal.id === pending.proposalId);
  return <View style={styles.review}>
    <Text accessibilityRole="header" style={styles.title}>原確認結果待查核</Text>
    <Text style={styles.body}>原操作的結果尚未確定，所有新決定暫停。先讀取原運行並核對，不要另建一次確認。</Text>
    <DetailRow label="原決定" value={pending.input.decision === "accept" ? "接受" : "略過"} />
    <DetailRow label="原核對版本" value={String(pending.input.expectedVersion)} />
    <DetailRow label="原候選事項" value={originalProposal?.title ?? pending.proposalId} />
    <DetailRow label="原運行" value={pending.runId} />
    <Text style={styles.warning}>{!pending.reviewed
      ? "尚未重新讀取原運行；核對後才可明確重試原決定。"
      : pending.reconfirm
        ? "原確認條件已變更，請重新讀取並核對；目前不能重試原決定。"
        : "已讀取原運行，請核對事項、版本及家庭共享同意；明確重試會沿用原決定。"}</Text>
    <AppButton label={pending.input.decision === "accept" ? "明確重試原確認" : "明確重試原略過"}
      variant="secondary" disabled={!mayRetryOriginal(model)} onPress={actions.retryOriginal} style={styles.fullButton} />
  </View>;
}

function ProposalCard({ proposal, model, actions }: { proposal: AgentProposalView; model: AgentRunModel; actions: AgentRunActions }) {
  const expired = proposalExpired(proposal);
  const pending = proposal.status === "pending";
  return <View testID={`agent-proposal-${proposal.id}`} style={styles.entry}>
    <View style={styles.top}><Text accessibilityRole="header" style={styles.title}>{proposal.title}</Text>
      <Text style={[styles.badge, (pending || proposal.status === "expired") && styles.warningBadge]}>{agentProposalLabels[proposal.status]}</Text></View>
    <Text selectable style={styles.body}>{proposal.content}</Text>
    <View style={styles.scope}><AppIcon name={proposal.scope === "family" ? "account-group-outline" : "lock-outline"} size={18} />
      <Text style={styles.meta}>{proposal.scope === "family"
        ? pending ? "候選只限本人查看；接受後按家庭權限共享" : "家庭共享資料：接受後家庭成員可按權限查看"
        : "私人資料：只供本人查看"}</Text></View>
    {proposal.details.map((detail, index) => <DetailRow key={`${index}-${detail.label}`} label={detail.label} value={detail.value} />)}
    <Text style={styles.meta}>候選版本：{proposal.version}</Text>
    <Text style={styles.meta}>建立：{timeLabel(proposal.createdAt)}</Text>
    <Text style={styles.meta}>到期：{timeLabel(proposal.expiresAt)}</Text>
    {pending ? <>
      <Text style={styles.meta}>這是待確認候選，尚未執行或寫入正式事項。</Text>
      {expired ? <StateNote tone="warning">候選期限無效或已過期，不能接受或略過。請重新讀取運行結果，再核對最新狀態。</StateNote> : null}
      {proposal.scope === "family" ? <AppCheckbox label={sharedConfirmationLabel}
        accessibilityLabel={`${sharedConfirmationLabel}: ${proposal.title}`} checked={!!model.sharedConfirmed[proposal.id]}
        disabled={!mayCheckShared(model, proposal)} onChange={checked => actions.setSharedConfirmation(proposal.id, checked)} /> : null}
      <View style={styles.actions}>
        <AppButton label="接受事項" accessibilityLabel={`明確接受此事項：${proposal.title}`} disabled={!mayDecide(model, proposal, "accept")}
          onPress={() => actions.decide(proposal.id, "accept")} style={styles.fullButton} />
        <AppButton label="略過" accessibilityLabel={`略過此事項：${proposal.title}`} variant="quiet" disabled={!mayDecide(model, proposal, "dismiss")}
          onPress={() => actions.decide(proposal.id, "dismiss")} style={styles.fullButton} />
      </View>
    </> : null}
    {proposal.result ? <View style={styles.receipt}>
      <Text style={styles.title}>保存收據：{proposal.result.label}</Text>
      <Text style={styles.meta}>保存結果版本：{proposal.result.version}</Text>
      <Text style={styles.meta}>{proposal.result.kind === "task"
        ? "此收據代表任務資料已保存；照護事項的完成狀態另行記錄。"
        : "此收據代表確認事實已保存；不代表照護事項已完成。"}</Text>
    </View> : proposal.status === "accepted" ? <Text style={styles.meta}>此候選已接受；本次快照未提供保存收據詳情。</Text> : null}
    {proposal.status === "dismissed" ? <Text style={styles.meta}>此候選已略過，沒有以此決定執行候選事項。</Text> : null}
    {proposal.status === "expired" ? <Text style={styles.meta}>此候選已過期。請重新讀取運行結果核對最新狀態。</Text> : null}
  </View>;
}

function RunDetails({ run }: { run: NonNullable<AgentRunModel["run"]> }) {
  const [expanded, setExpanded] = useState(false);
  return <View style={styles.section}>
    <AppButton label={expanded ? "收起運行詳情" : "查看運行詳情"} variant="quiet"
      onPress={() => setExpanded(value => !value)} style={styles.fullButton} />
    {expanded ? <>
      {run.counts === null ? <Text style={styles.meta}>統計未知，不能當作零用量。</Text> : null}
      <View style={styles.metrics}>
        <Text style={styles.meta}>AI 調用：{run.counts === null ? "未知" : run.counts.modelCalls}</Text>
        <Text style={styles.meta}>工具：{run.counts === null ? "未知" : run.counts.toolCalls}</Text>
        <Text style={styles.meta}>知識查詢：{run.counts === null ? "未知" : run.counts.queryEmbeddings}</Text>
      </View>
      <Text style={run.retrievalMode === "keyword_degraded" ? styles.warning : styles.meta}>檢索方式：{retrievalLabels[run.retrievalMode]}</Text>
      <Text accessibilityRole="header" style={styles.title}>工具結果</Text>
      {run.tools.length === 0 ? <Text style={styles.meta}>本次沒有工具結果。</Text> : run.tools.map(tool => <View key={tool.id} style={styles.tool}>
        <View style={styles.top}><Text style={styles.body}>{tool.nameLabel}</Text><Text style={[styles.badge,
          (tool.status === "unknown" || tool.status === "conflict" || tool.status === "rejected") && styles.warningBadge,
          tool.status === "failed" && styles.errorBadge]}>{agentToolLabels[tool.status]}</Text></View>
        {tool.status === "succeeded" ? <Text style={styles.meta}>{tool.savesCandidate
          ? "候選已保存，尚未執行；請核對下方內容，再明確決定。"
          : "工具已回報成功；照護事項的完成狀態仍須另行核對。"}</Text> : null}
        {tool.status === "unknown" ? <Text style={styles.warning}>工具結果未知，請查核原運行，不能以新操作代替核對。</Text> : null}
      </View>)}
    </> : null}
  </View>;
}

export function AgentRunView({ model, actions, onLocateSource }: { model: AgentRunModel; actions: AgentRunActions; onLocateSource?: (target: View | null) => void }) {
  const denied = model.readState === "denied";
  const run = model.readState === "ready" ? model.run : null;
  const readMessage = model.readState === "idle" ? "尚未讀取運行結果。請手動讀取後再核對。"
    : model.readState === "loading" ? "正在讀取原運行結果，請稍候；讀取中不能決定候選事項。"
      : model.readState === "failed" ? "未能讀取運行結果。請重新讀取，暫時不能確認候選事項。"
        : denied ? "已失去讀取此運行的權限，原結果及候選內容已隱藏。"
          : !run ? "目前沒有可展示的運行結果。" : null;
  return <View testID="agent-run-view" style={styles.root}><SectionCard style={styles.card}>
    <SectionHeader title="Agent 運行結果" icon="clipboard-check-outline" subtitle="核對本次回覆、候選及來源；運行結束不代表照護事項已完成。" />
    <AppButton label={model.pendingDecision ? "讀取原運行並核對" : "重新讀取運行結果"} variant="secondary"
      disabled={!model.online || !!model.busy || denied || model.readState === "loading"} loading={model.busy === "read"}
      onPress={actions.refresh} style={styles.fullButton} />
    {readMessage ? <StateNote tone={model.readState === "failed" ? "error" : denied ? "warning" : "neutral"}>{readMessage}</StateNote> : null}
    {!model.online ? <StateNote tone="warning">目前離線；所示資料是上次讀取的快照。恢復連線後才可重新讀取或確認事項。</StateNote> : null}
    {!denied ? <>
      {model.notice ? <StateNote tone={model.notice.tone}>{model.notice.text}</StateNote> : null}
      {model.busy === "write" ? <StateNote>正在處理原決定，請等候原操作結果。</StateNote> : null}
      <OriginalDecision model={model} actions={actions} />
    </> : null}
    {run ? <>
      <View style={styles.top}><Text accessibilityRole="header" style={styles.title}>本次運行</Text>
        <Text style={[styles.badge, run.status === "unknown" && styles.warningBadge]}>{agentRunLabels[run.status]}</Text></View>
      <Text style={styles.meta}>結果讀取時間：{timeLabel(model.loadedAt)}</Text>
      <Text style={styles.meta}>運行建立：{timeLabel(run.createdAt)}</Text>
      {run.stopReasonLabel ? <Text style={styles.meta}>停止原因：{run.stopReasonLabel}</Text> : null}
      {run.status === "running" ? <StateNote>處理尚未結束，可稍後手動重新讀取。</StateNote> : null}
      {run.status === "unknown" ? <StateNote tone="warning">本次運行結果未知，請讀取原運行核對；未知不能當作已成功或已完成。</StateNote> : null}
      <AnswerSources key={`answer-${run.id}`} testID="agent-answer" sources={run.citations} onOpenSource={actions.openSource}
        onLocateSource={onLocateSource} degraded={run.retrievalMode === "keyword_degraded"}>
        <CitationText style={styles.body}>{run.text}</CitationText>
      </AnswerSources>
      <RunDetails key={run.id} run={run} />
      <View style={styles.section}>
        <Text accessibilityRole="header" style={styles.title}>待核對及已處理候選</Text>
        {run.proposals.length === 0 ? <Text style={styles.meta}>本次沒有候選事項。</Text> : run.proposals.map(proposal => <ProposalCard key={proposal.id} proposal={proposal} model={model} actions={actions} />)}
      </View>
    </> : null}
  </SectionCard></View>;
}

const styles = StyleSheet.create({
  root: { minWidth: 0, width: "100%" }, card: { gap: spacing.lg, minWidth: 0 },
  section: { gap: spacing.md, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.softLine },
  entry: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: radius.medium, padding: spacing.md, gap: spacing.md, minWidth: 0 },
  top: { flexDirection: "row", alignItems: "flex-start", flexWrap: "wrap", gap: spacing.sm, minWidth: 0 },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.body, lineHeight: 25, fontWeight: "700", flexShrink: 1, minWidth: 0 },
  body: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, lineHeight: 24, flexShrink: 1, minWidth: 0 },
  meta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 21, flexShrink: 1, minWidth: 0 },
  badge: { fontFamily: chineseFont, color: colors.muted, backgroundColor: colors.quietSurface, borderRadius: radius.small, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, fontSize: typeScale.caption, lineHeight: 20, overflow: "hidden" },
  warningBadge: { backgroundColor: colors.paleAmber, color: colors.warningInk }, errorBadge: { backgroundColor: colors.paleCoral, color: colors.errorInk },
  scope: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, minWidth: 0 },
  detailRow: { gap: spacing.xs, minWidth: 0 },
  detailLabel: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 },
  detailValue: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, lineHeight: 23, flexShrink: 1, minWidth: 0 },
  note: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, backgroundColor: colors.quietSurface, borderRadius: radius.small, padding: spacing.md, minWidth: 0 },
  noteCopy: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 23, flex: 1, minWidth: 0 },
  savedNote: { backgroundColor: colors.paleTeal, borderLeftWidth: 3, borderLeftColor: colors.deepTeal },
  saved: { color: colors.deepTeal },
  warningNote: { backgroundColor: colors.paleAmber, borderLeftWidth: 3, borderLeftColor: colors.amber },
  errorNote: { backgroundColor: colors.paleCoral, borderLeftWidth: 3, borderLeftColor: colors.coral },
  warning: { fontFamily: chineseFont, color: colors.warningInk, fontSize: typeScale.small, lineHeight: 23, flexShrink: 1 },
  error: { color: colors.errorInk },
  review: { backgroundColor: colors.paleAmber, borderWidth: 1, borderColor: colors.amber, borderRadius: radius.medium, padding: spacing.md, gap: spacing.md, minWidth: 0 },
  actions: { gap: spacing.sm, minWidth: 0 }, fullButton: { alignSelf: "stretch", maxWidth: "100%", minWidth: 0 },
  receipt: { gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.md },
  metrics: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  tool: { gap: spacing.sm, paddingBottom: spacing.sm },
});
