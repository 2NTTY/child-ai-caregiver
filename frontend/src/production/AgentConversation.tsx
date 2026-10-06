import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { useProduction } from "./ProductionProvider";
import { AgentInboxView } from "../components/agent/AgentInboxView";
import { AgentRunView } from "../components/agent/AgentRunView";
import { AppIcon } from "../components/AppIcon";
import type { LocateAnswerSource } from "../components/chat/AnswerSources";
import { chatColors, chatFont, chatType } from "../components/chat/chat-presentation";
import { MotionDisclosure } from "../motion";
import { AgentAuthorization } from "./AgentAuthorization";
import { AppButton, SectionCard, SectionHeader } from "../components/ui";
import { agentProposalLabels, agentTime, proposalExpired } from "../agent-view-model";
import { colors, spacing } from "../theme";

export function AgentConversation({ onLocateSource }: { onLocateSource?: LocateAnswerSource }) {
  const { agentModel, agentActions, agentInbox, agentInboxActions, agentPending, readAgentPending, selectAgentRun, authorization, authorizationActions, scopeKey } = useProduction();
  const [expanded, setExpanded] = useState(false);
  useEffect(() => { if (agentModel.readState !== "idle") setExpanded(true); }, [agentModel.run?.id, agentModel.readState]);
  const run = agentModel.readState === "ready" ? agentModel.run : null;
  const receipt = run ? authorization.receipts[run.id] : undefined;
  useEffect(() => { if (run && !receipt) authorizationActions.readReceipts(run.id); }, [run?.id, receipt?.state]);
  return <View style={styles.root}>
    <Pressable testID="agent-conversation-toggle" accessibilityRole="button" accessibilityLabel="Agent 活動與候選"
      accessibilityState={{ expanded }} aria-expanded={expanded} onPress={() => setExpanded(value => !value)}
      style={({ pressed }) => [styles.disclosure, pressed && styles.pressed]}>
      <AppIcon name={expanded ? "chevron-down" : "chevron-right"} size={16} color={chatColors.secondary} />
      <Text style={styles.label}>Agent 活動與候選{agentModel.pendingDecision ? " · 原決定待查核" : ""}</Text>
    </Pressable>
    <MotionDisclosure expanded={expanded} scopeKey={scopeKey ?? "no-child"}>
      <View style={styles.contents}>
        {agentModel.readState !== "idle" ? <AgentRunView model={agentModel} actions={agentActions} onLocateSource={onLocateSource} /> : null}
        {run ? <SectionCard><SectionHeader title="本次操作收據" density="compact" subtitle="與上方真實工具結果一起核對；運行結束不代表照護事項已完成。" />
          {receipt?.state === "ready" ? receipt.items.length ? receipt.items.map(item => <View key={item.id} style={styles.receipt}>
            <Text style={styles.label}>{({ save_record: "保存照護記錄", revise_record: "更正照護記錄", save_private_note: "保存私人備註", revise_private_note: "修改私人備註", create_self_task: "建立本人待辦", change_self_task: "更改本人待辦" })[item.kind]} · {({ saved: "已保存", updated: "已更新", scheduled: "已安排", completed: "已記錄完成", cancelled: "已取消" })[item.state]}</Text>
            <Text selectable style={styles.label}>{({ care_record: "照護記錄", private_note: "私人備註", task: "待辦" })[item.resource.kind]}：{item.resource.id} · 版本 {item.resource.version}</Text>
            <Text style={styles.label}>{item.notification === "authorized_for_due_event" ? `已授權到期事件提示（${item.channels.map(channel => channel === "telegram" ? "Telegram" : "瀏覽器推送").join("、")}）；此收據不表示已發送或送達。` : "沒有授權外部到期提示。"}</Text>
            <Text style={styles.label}>{agentTime(item.createdAt)}</Text>
          </View>) : <Text style={styles.label}>本次沒有直接操作收據。</Text> : <Text style={styles.label}>{receipt?.state === "loading" ? "正在讀取操作收據…" : "操作收據尚未確認；不能推斷已保存。"}</Text>}
          <AppButton label="重新讀取本次收據" variant="quiet" disabled={!authorization.online || receipt?.state === "loading"} onPress={() => authorizationActions.readReceipts(run.id, true)} />
        </SectionCard> : null}
        <SectionCard><SectionHeader title="待確認候選" density="compact" subtitle="每頁 20 項，包含過期事項；不受聊天歷史範圍限制。" />
          <AppButton label="讀取待確認候選" variant="quiet" loading={agentPending.state === "loading"} disabled={!agentModel.online || !!agentModel.busy || !!agentModel.pendingDecision || !!agentModel.writesBlocked || agentModel.readState === "denied"} onPress={() => readAgentPending()} />
          {agentPending.state === "failed" ? <Text style={styles.label}>未能讀取候選，原清單已隱藏。</Text> : null}
          {agentPending.state === "ready" ? agentPending.entries.length ? agentPending.entries.map(entry => <View key={entry.proposal.id} style={styles.receipt}>
            <Text style={styles.label}>{entry.proposal.title} · {entry.proposal.status === "expired" || proposalExpired(entry.proposal) ? "已過期" : agentProposalLabels[entry.proposal.status]}</Text>
            <Text style={styles.label}>建立：{agentTime(entry.proposal.createdAt)} · 版本 {entry.proposal.version}</Text>
            <AppButton label="核對原運行與候選" variant="quiet" disabled={!!agentModel.busy || !!agentModel.pendingDecision || !!agentModel.writesBlocked || !agentModel.online} onPress={() => selectAgentRun(entry.runId)} />
          </View>) : <Text style={styles.label}>目前沒有待確認或過期候選。</Text> : null}
          {agentPending.nextCursor ? <AppButton label="讀取下一頁候選" variant="quiet" disabled={!!agentModel.busy || !!agentModel.pendingDecision || !!agentModel.writesBlocked || !agentModel.online} onPress={() => readAgentPending(true)} /> : null}
        </SectionCard>
        <AgentInboxView model={agentInbox} actions={agentInboxActions} />
      </View>
    </MotionDisclosure>
    <AgentAuthorization />
  </View>;
}
const styles = StyleSheet.create({
  root: { minWidth: 0 }, receipt: { gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.sm }, contents: { gap: spacing.md, minWidth: 0, paddingTop: spacing.md },
  disclosure: { backgroundColor: colors.quietSurface, borderWidth: 1, borderColor: colors.controlOutline, borderRadius: 10,
    paddingHorizontal: spacing.sm, alignSelf: "flex-start", minHeight: 48, flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  label: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.tool }, pressed: { backgroundColor: colors.paleTeal },
});
