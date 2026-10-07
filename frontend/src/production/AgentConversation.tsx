import { useEffect, useRef } from "react";
import { StyleSheet, View, type ScrollView } from "react-native";
import { Text } from "react-native-paper";
import { useProduction } from "./ProductionProvider";
import { AgentInboxView } from "../components/agent/AgentInboxView";
import { AgentRunView } from "../components/agent/AgentRunView";
import { AppDialog } from "../components/AppDialog";
import { AppScrollView } from "../components/AppScrollView";
import { locateCitationSource } from "../components/chat/locateCitationSource";
import { chatColors, chatFont, chatType } from "../components/chat/chat-presentation";
import { AppButton, SectionCard, SectionHeader } from "../components/ui";
import { agentProposalLabels, agentTime, proposalExpired } from "../agent-view-model";
import { colors, spacing } from "../theme";

export function AgentConversation({ visible, onDismiss, onOpenSettings, onReloadChat, reloadDisabled }: { visible: boolean; onDismiss(): void; onOpenSettings(): void; onReloadChat(): void; reloadDisabled: boolean }) {
  const { agentModel, agentActions, agentInbox, agentInboxActions, agentPending, readAgentPending, selectAgentRun, authorization, authorizationActions } = useProduction();
  const scrollRef = useRef<ScrollView | null>(null);
  const onLocateSource = (target: View | null, horizontalScroll?: ScrollView | null, verticalTarget?: View | null) =>
    locateCitationSource(target, scrollRef.current, horizontalScroll, verticalTarget);
  const run = agentModel.readState === "ready" ? agentModel.run : null;
  const receipt = run ? authorization.receipts[run.id] : undefined;
  useEffect(() => { if (visible && run && !receipt) authorizationActions.readReceipts(run.id); }, [visible, run?.id, receipt?.state]);
  return <AppDialog visible={visible} onDismiss={onDismiss} accessibilityLabel="對話詳情與活動" style={styles.dialog}>
    <AppDialog.Title>對話詳情與活動</AppDialog.Title>
    <AppDialog.ScrollArea style={styles.scrollArea}><AppScrollView ref={scrollRef} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.contents}>
        {agentModel.readState !== "idle" ? <AgentRunView model={agentModel} actions={agentActions} onLocateSource={onLocateSource} /> : null}
        {run?.privateSourceCitations?.length?<SectionCard><SectionHeader title="本人的私人參考" density="compact" subtitle="回答當時獲授權的原文快照；不是已核對的官方育兒來源，停用或更正後不供新回答使用。"/>
          {run.privateSourceCitations.map((source,index)=><View key={source.citationId} style={styles.receipt}>
            <Text style={styles.label}>私人來源 {index+1} · {source.label} · 版本 {source.version}</Text>
            <Text selectable style={styles.label}>{source.excerpt}</Text>
          </View>)}
        </SectionCard>:null}
        {run ? <SectionCard><SectionHeader title="本次操作收據" density="compact" />
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
          {agentPending.state === "idle" ? <Text style={styles.label}>{agentModel.online ? "待確認候選尚未讀取；等候目前操作完成後會自動讀取。" : "目前離線，待確認候選尚未核對。"}</Text> : null}
          {agentPending.state === "loading" ? <Text style={styles.label}>正在讀取待確認候選…</Text> : null}
          {agentPending.state === "denied" ? <Text style={styles.label}>目前沒有權限查看這個孩子的待確認候選。</Text> : null}
          {agentPending.state === "failed" ? <Text style={styles.label}>未能讀取候選，原清單已隱藏。</Text> : null}
          {agentPending.state === "ready" ? agentPending.entries.length ? agentPending.entries.map(entry => <View key={entry.proposal.id} style={styles.receipt}>
            <Text style={styles.label}>{entry.proposal.title} · {entry.proposal.status === "expired" || proposalExpired(entry.proposal) ? "已過期" : agentProposalLabels[entry.proposal.status]}</Text>
            <Text style={styles.label}>建立：{agentTime(entry.proposal.createdAt)} · 版本 {entry.proposal.version}</Text>
            <AppButton label="核對原運行與候選" variant="quiet" disabled={!!agentModel.busy || !!agentModel.pendingDecision || !!agentModel.writesBlocked || !agentModel.online} onPress={() => selectAgentRun(entry.runId)} />
          </View>) : <Text style={styles.label}>目前沒有待確認或過期候選。</Text> : null}
          {agentPending.nextCursor ? <AppButton label="讀取下一頁候選" variant="quiet" disabled={!!agentModel.busy || !!agentModel.pendingDecision || !!agentModel.writesBlocked || !agentModel.online} onPress={() => readAgentPending(true)} /> : null}
        </SectionCard>
        <AgentInboxView model={agentInbox} actions={agentInboxActions} />
    </AppScrollView></AppDialog.ScrollArea>
    <AppDialog.Actions><AppButton label="重新讀取聊天" variant="quiet" onPress={onReloadChat} disabled={reloadDisabled} /><AppButton label="助手設定" variant="quiet" onPress={onOpenSettings} />
      <AppButton label="關閉" variant="quiet" onPress={onDismiss} /></AppDialog.Actions>
  </AppDialog>;
}
const styles = StyleSheet.create({
  dialog: { maxWidth: 800 }, scrollArea: { paddingHorizontal: 0, minHeight: 0 }, receipt: { gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.sm }, contents: { gap: spacing.md, minWidth: 0, padding: spacing.md },
  label: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.tool },
});
