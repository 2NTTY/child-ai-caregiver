import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { AgentWork } from "../../../../src/shared/agent-work";
import { followUpStatusLabels, personalWorkStatusLabels, workResourceDestination } from "../../history-view-model";
import { memoryDateLabel } from "../../memory-reference-view-model";
import { chineseFont, colors, radius, readingType, spacing } from "../../theme";
import { AppStatusBadge } from "../AppStatusBadge";
import { AppButton } from "../ui";

export function PersistentWorkCards({ items, online, busy, onMessage, onResource, onContinue }: {
  items: readonly AgentWork[]; online: boolean; busy?: boolean;
  onMessage?: (id: string) => void; onResource?: (path: string) => void; onContinue?: (work: AgentWork) => void;
}) {
  return <View style={styles.list}>{items.map(work => <View key={work.id} style={styles.card} testID={`personal-work-${work.id}`}>
    <View style={styles.row}><Text accessibilityRole="header" aria-level={3} style={styles.title}>{work.goal}</Text><AppStatusBadge label={personalWorkStatusLabels[work.status]} /></View>
    <Text style={styles.meta}>Agent 整理 · 供接續工作核對</Text>
    {work.focus ? <Text selectable style={styles.body}>{work.focus}</Text> : null}
    {work.questions.length ? <View style={styles.list}><Text style={styles.label}>待答問題</Text>{work.questions.map((question, index) => <Text selectable key={index} style={styles.body}>{index + 1}. {question}</Text>)}</View> : null}
    {work.pending.length ? <Text style={styles.meta}>有 {work.pending.length} 項待確認，請回助手查看原候選。</Text> : null}
    {work.followUp ? <View style={styles.list}><Text style={styles.label}>接續安排</Text><Text style={styles.body}>{work.followUp.reason}</Text>
      {work.followUp.dueAt ? <Text style={styles.meta}>預定接續：{memoryDateLabel(work.followUp.dueAt)}</Text> : null}
      {work.followUp.watchResources ? <Text style={styles.meta}>留意相關資料變化</Text> : null}</View> : null}
    {work.status === "cancelled" ? <Text style={styles.meta}>此工作已取消，不再接續。</Text> : null}
    {work.latestFollowUp ? <Text style={styles.meta}>{work.latestFollowUp.state === "cancelled" ? "此工作關聯接續" : "同批跟進事件"}：{followUpStatusLabels[work.latestFollowUp.state]} · {memoryDateLabel(work.latestFollowUp.createdAt)}</Text> : null}
    {work.resources.length ? <View style={styles.list}><Text style={styles.label}>相關資料</Text><View style={styles.row}>{work.resources.map((resource, index) => {
      const destination = workResourceDestination(resource);
      return destination.path && onResource ? <AppButton key={`${resource.kind}:${resource.id}`} label={`${destination.label} ${index + 1} · 版本 ${resource.version}`}
        variant="quiet" density="compact" onPress={() => onResource(destination.path!)} />
        : <Text key={`${resource.kind}:${resource.id}`} style={styles.meta}>{destination.label} · 版本 {resource.version}</Text>;
    })}</View><Text style={styles.meta}>開啟對應頁查看目前可讀資料；工作保留當時的版本依據。</Text></View> : null}
    <View style={styles.row}>{onMessage ? work.sourceMessageIds.map((id, index) => <AppButton key={id} label={`相關訊息 ${index + 1}`} variant="quiet" density="compact" disabled={!online || busy} onPress={() => onMessage(id)} />) : null}
      {onContinue ? <AppButton label="回助手續談" variant="secondary" density="compact" onPress={() => onContinue(work)} /> : null}</View>
    <Text style={styles.meta}>更新於 {memoryDateLabel(work.updatedAt)} · 工作整理及接續完結不代表照護事項已完成。</Text>
  </View>)}</View>;
}
const styles = StyleSheet.create({
  list: { gap: spacing.sm, minWidth: 0 },
  card: { backgroundColor: colors.paper, borderColor: colors.line, borderWidth: 1, borderRadius: radius.medium, padding: spacing.lg, gap: spacing.sm, minWidth: 0 },
  row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  title: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700", flexGrow: 1, flexShrink: 1 },
  label: { fontFamily: chineseFont, color: colors.ink, ...readingType.meta, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.body },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
});
