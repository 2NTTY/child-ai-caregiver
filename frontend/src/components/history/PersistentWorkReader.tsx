import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { Href } from "expo-router";
import type { AgentWork } from "../../../../src/shared/agent-work";
import { followUpStatusLabels, personalWorkStatusLabels, workResourceDestination } from "../../history-view-model";
import { memoryDateLabel } from "../../memory-reference-view-model";
import { chineseFont, colors, readingType, spacing } from "../../theme";
import { AppStatusBadge } from "../AppStatusBadge";
import { ReadTargetLink } from "../ReadTargetLink";
import { AppButton } from "../ui";

/** One saved work, not a second task owner or a promise that care has completed. */
export function PersistentWorkReader({ work, onNavigate, onContinue }: {
  work: AgentWork; onNavigate(path: string): void; onContinue?: (work: AgentWork) => void;
}) {
  const link = (path: string, label: string, key: string) => <ReadTargetLink key={key} href={path as Href} label={label} style={styles.link} onOpen={() => onNavigate(path)}><Text style={styles.linkText}>{label}</Text></ReadTargetLink>;
  return <View style={styles.content} testID={`personal-work-${work.id}`}>
    <View style={styles.row}><AppStatusBadge label={personalWorkStatusLabels[work.status]} /><Text style={styles.meta}>本人 · 版本 {work.version} · 更新於 {memoryDateLabel(work.updatedAt)}</Text></View>
    <Text style={styles.body}>助手整理，供接續工作核對；整理及接續完結不代表照護事項已完成。</Text>
    {work.focus ? <Text selectable style={styles.body}>{work.focus}</Text> : null}
    {work.questions.length ? <View style={styles.content}><Text accessibilityRole="header" aria-level={3} style={styles.heading}>待答問題</Text>{work.questions.map((question, index) => <Text selectable key={index} style={styles.body}>{index + 1}. {question}</Text>)}</View> : null}
    {work.pending.length ? <Text style={styles.body}>有 {work.pending.length} 項待確認，請回助手查看原候選。</Text> : null}
    {work.followUp ? <View style={styles.content}><Text accessibilityRole="header" aria-level={3} style={styles.heading}>接續安排</Text><Text style={styles.body}>{work.followUp.reason}</Text>
      {work.followUp.dueAt ? <Text style={styles.meta}>預定接續：{memoryDateLabel(work.followUp.dueAt)}</Text> : null}
      {work.followUp.watchResources ? <Text style={styles.body}>留意相關資料變化</Text> : null}</View> : null}
    {work.status === "cancelled" ? <Text style={styles.body}>此工作已取消，不再接續。</Text> : null}
    {work.latestFollowUp ? <Text style={styles.body}>{work.latestFollowUp.state === "cancelled" ? "此工作關聯接續" : "同批跟進事件"}：{followUpStatusLabels[work.latestFollowUp.state]} · {memoryDateLabel(work.latestFollowUp.createdAt)}</Text> : null}
    {work.resources.length ? <View style={styles.content}><Text accessibilityRole="header" aria-level={3} style={styles.heading}>相關資料</Text>{work.resources.map((resource, index) => {
      const destination = workResourceDestination(resource), label = `${destination.label} ${index + 1} · 當時版本 ${resource.version}`;
      return destination.path ? link(destination.path, label, `${resource.kind}:${resource.id}`) : <Text key={`${resource.kind}:${resource.id}`} style={styles.meta}>{label}</Text>;
    })}<Text style={styles.body}>開啟對應頁查看目前可讀資料；工作保留當時的版本依據。</Text></View> : null}
    {work.sourceMessageIds.length ? <View style={styles.content}><Text accessibilityRole="header" aria-level={3} style={styles.heading}>原對話</Text>{work.sourceMessageIds.map((id, index) => link(`/history?category=conversations&selectedId=${encodeURIComponent(id)}`, `查看相關訊息 ${index + 1} 原文`, id))}</View> : null}
    {onContinue ? <AppButton label="回助手續談" variant="quiet" onPress={() => onContinue(work)} /> : null}
  </View>;
}
const styles = StyleSheet.create({
  content: { gap: spacing.md, minWidth: 0 }, row: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  heading: { fontFamily: chineseFont, color: colors.ink, fontSize: 18, lineHeight: 28, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.body }, meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  link: { minHeight: 44, justifyContent: "center", alignSelf: "flex-start", minWidth: 0 },
  linkText: { fontFamily: chineseFont, color: colors.teal, ...readingType.body, textDecorationLine: "underline" },
});
