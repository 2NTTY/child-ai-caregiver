import { useState, type Ref } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { agentTime, proposalExpired, type AgentProposalView, type AgentRunModel } from "../agent-view-model";
import type { AgentPendingDiscovery } from "../production/ProductAgentOwner";
import { chineseFont, colors, readingType, spacing } from "../theme";
import { AppIcon } from "../components/AppIcon";
import { AppStatusBadge } from "../components/AppStatusBadge";
import { EmptyListCard } from "../components/EmptyListCard";
import { ReadStateNotice } from "../components/ReadStateNotice";
import { AppButton } from "../components/ui";
import { useQuietReadFocus } from "../components/useQuietReadFocus";
import { summarizePendingShortcut } from "../components/agent/pending-review-model";
import { proposalContextLabel, proposalPrimaryText } from "../components/agent/proposal-presentation";

function PendingCard({
  testIDPrefix,
  runId,
  proposal,
  disabled,
  quietRefresh,
  onPress,
  cardRef,
}: {
  testIDPrefix: string;
  runId: string;
  proposal: AgentProposalView;
  disabled: boolean;
  quietRefresh: boolean;
  onPress(): void;
  cardRef?(node: View | null): void;
}) {
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const readFocus = useQuietReadFocus(disabled, quietRefresh);
  const status = proposal.status === "expired" || proposalExpired(proposal)
    ? "已過期"
    : proposal.contentState === "invalidated"
      ? "內容需重新核對"
      : "待你確認";

  return (
    <Pressable
      ref={node => {
        readFocus.host.current = node;
        cardRef?.(node);
      }}
      testID={`${testIDPrefix}-pending-card-${runId}-${proposal.id}`}
      accessibilityRole="button"
      accessibilityLabel={`核對：${proposalPrimaryText(proposal)}；${proposalContextLabel(proposal)}；${status}`}
      accessibilityState={{ disabled }}
      aria-disabled={disabled}
      disabled={readFocus.nativeDisabled}
      onPress={() => { if (!disabled) onPress(); }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [
        styles.proposalCard,
        hovered && !disabled && styles.cardHighlighted,
        focused && styles.cardFocused,
        pressed && !disabled && styles.cardHighlighted,
        disabled && !readFocus.preserveWebFocus && styles.cardDisabled,
      ]}
    >
      <View style={styles.cardLabels}>
        <Text style={[styles.meta, styles.cardKind]}>{proposalContextLabel(proposal)}</Text>
        <AppStatusBadge label={status} tone="warning" />
      </View>
      <Text numberOfLines={3} style={styles.cardContent}>{proposalPrimaryText(proposal)}</Text>
      <View style={styles.cardMeta}>
        <AppIcon name="clock-outline" size={14} />
        <Text style={[styles.meta, styles.cardTime]}>
          {Number.isFinite(Date.parse(proposal.createdAt)) ? `提出於 ${agentTime(proposal.createdAt)}` : "提出時間未知"}
          {` · ${proposal.scope === "family" ? "家庭共享" : "本人"}`}
        </Text>
      </View>
    </Pressable>
  );
}

/** Single-authority pending proposal list shared by /care and the top-right header shortcut. */
export function PendingReviewList({
  scopeKey,
  online,
  agentPending,
  agentModel,
  careLocked,
  testIDPrefix = "care",
  listRef,
  cardRef,
  onOpen,
  onRefresh,
}: {
  scopeKey: string | null;
  online: boolean;
  agentPending: AgentPendingDiscovery;
  agentModel: AgentRunModel;
  careLocked: boolean;
  testIDPrefix?: string;
  listRef?: Ref<View | null>;
  cardRef?(key: string, node: View | null): void;
  onOpen(runId: string, proposalId: string, cardKey: string, proposal?: AgentProposalView): void;
  onRefresh(more?: boolean): void;
}) {
  const locked = careLocked || !!agentModel.writesBlocked;
  const summary = summarizePendingShortcut({
    scopeKey,
    online,
    pending: agentPending,
    pendingDecision: agentModel.pendingDecision,
    readState: agentModel.readState,
  });
  const denied = summary.denied;
  const readable = summary.readable;
  const pending = summary.confirmableEntries;
  const original = agentModel.pendingDecision;

  const canOpen = (runId: string, proposalId: string) => !!scopeKey && online && !denied && !agentModel.busy && !careLocked
    && (original ? original.runId === runId && original.proposalId === proposalId : !locked);

  const quietRefresh = online && !!agentPending.hasSnapshot && agentModel.busy === "read" && !denied && !locked && !original;
  const recoveryKey = original ? `recovery:${original.runId}:${original.proposalId}` : "";

  return (
    <View ref={listRef} tabIndex={-1} accessibilityLabel="待確認事項" testID={`${testIDPrefix}-agent-pending`} style={styles.pendingList}>
      {agentPending.state === "idle" ? <Text style={styles.meta}>{online ? "待確認事項尚未讀取。" : "目前離線，待確認事項尚未核對。"}</Text> : null}
      {agentPending.state === "loading" ? <ReadStateNotice state="loading" scopeKey={scopeKey ?? undefined} refreshing={!!agentPending.hasSnapshot} message="正在讀取待確認事項…" /> : null}
      {agentPending.state === "failed" ? <>
        <Text style={styles.meta}>{agentPending.hasSnapshot ? "未能更新；顯示上次資料，數量尚未核對。" : "未能讀取待確認事項，請重試。"}</Text>
        <AppButton label="重試讀取待確認事項" variant="quiet" disabled={!online || locked || !!agentModel.busy || !!original} onPress={() => onRefresh(false)} />
      </> : null}
      {denied ? <Text style={styles.meta}>目前沒有權限查看這個孩子的待確認事項。</Text> : null}
      {!online && readable ? <Text style={styles.meta}>目前離線；以下只代表上次載入的資料，待確認數量尚未核對。</Text> : null}
      {agentPending.nextCursor && !denied ? <Text testID={`${testIDPrefix}-pending-more`} style={styles.meta}>只計已載入可確認項；還有更多。</Text> : null}
      {pending.length ? (
        <View testID={`${testIDPrefix}-pending-grid`} style={styles.cardGrid}>
          {pending.map(({ runId, proposal }) => {
            const key = `${runId}:${proposal.id}`;
            return (
              <PendingCard
                key={key}
                testIDPrefix={testIDPrefix}
                runId={runId}
                proposal={proposal}
                disabled={!canOpen(runId, proposal.id)}
                quietRefresh={quietRefresh}
                cardRef={node => cardRef?.(key, node)}
                onPress={() => onOpen(runId, proposal.id, key, proposal)}
              />
            );
          })}
        </View>
      ) : null}
      {(agentPending.state === "ready" || agentPending.state === "loading" && agentPending.hasSnapshot) && online && !denied && !pending.length && !original ? (
        <EmptyListCard title={agentPending.nextCursor ? "已載入頁面暫無可確認事項" : "暫無可確認事項"} />
      ) : null}
      {original && !denied ? (
        <View style={styles.pendingList}>
          <Text style={styles.meta}>結果待查</Text>
          {!pending.some(entry => entry.runId === original.runId && entry.proposal.id === original.proposalId) ? (
            <AppButton
              ref={node => cardRef?.(recoveryKey, node)}
              label="查核原決定"
              variant="secondary"
              disabled={!canOpen(original.runId, original.proposalId)}
              onPress={() => onOpen(original.runId, original.proposalId, recoveryKey)}
            />
          ) : null}
        </View>
      ) : null}
      {agentPending.nextCursor && !denied ? (
        <AppButton
          label="載入較早待確認事項"
          variant="quiet"
          disabled={!online || !!agentModel.busy || !!original || locked}
          onPress={() => onRefresh(true)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pendingList: { gap: spacing.md, minWidth: 0 },
  cardGrid: { gap: spacing.md, minWidth: 0 },
  proposalCard: { minWidth: 0, gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.line, borderRadius: 0, backgroundColor: colors.controlSurface },
  cardLabels: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: spacing.sm },
  cardKind: { flex: 1, minWidth: 0 },
  cardContent: { fontFamily: chineseFont, ...readingType.body, color: colors.ink, minWidth: 0 },
  cardMeta: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  cardTime: { flex: 1 },
  meta: { fontFamily: chineseFont, ...readingType.meta, color: colors.muted, minWidth: 0, flexShrink: 1 },
  cardHighlighted: { backgroundColor: colors.paleTeal },
  cardFocused: { borderColor: colors.ink, borderWidth: 2 },
  cardDisabled: { opacity: 0.6 },
});
