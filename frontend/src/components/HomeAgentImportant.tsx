import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { HomeActions, HomeViewModel } from "../view-model";
import { selectHomeAgentImportant } from "../home-overview";
import { chineseFont, colors, readingType, spacing, workspaceType } from "../theme";
import { AppButton, SectionCard, SectionHeader } from "./ui";
import { OperationNotice } from "./OperationNotice";
import { ReadStateNotice } from "./ReadStateNotice";

function timeLabel(value: string | null): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toLocaleString("zh-HK", { timeZone: "Asia/Hong_Kong", hour12: false });
}

// The owning adapter supplies authorized Agent items and their order. This view only navigates.
export function HomeAgentImportant({ model, actions }: { model: HomeViewModel; actions: HomeActions }) {
  const section = selectHomeAgentImportant(model);
  if (!section) return null;
  const operation = model.operation;
  const loadedAt = timeLabel(section.loadedAt);
  return <>
    <SectionCard testID="home-agent-important">
      <SectionHeader title="Agent 提醒你" density="compact" />
      {section.synthetic ? <Text style={styles.meta}>合成示例 · 尚未接駁真正 Agent 推送</Text> : null}
      <ReadStateNotice state={section.state === "ready" ? section.items.length ? "ready" : "empty" : section.state}
        title={section.state === "error" ? "未能讀取重要事項" : section.state === "unavailable" ? "暫未能確認重要事項" : undefined}
        message={section.detail ?? (section.state === "ready" ? "這次已載入快照沒有 Agent 重要事項。" : section.state === "loading" ? "正在讀取 Agent 重要事項…" : "目前未能取得 Agent 重要事項，不能當作沒有提醒。") }>
        {section.state === "error" || section.state === "unavailable" ? <AppButton label="重新讀取" density="compact" variant="quiet" disabled={model.connection !== "online"} onPress={actions.refresh} /> : null}
      </ReadStateNotice>
      {section.state === "ready" ? section.items.map((item, index) => <View key={item.id} testID={`home-agent-important-item-${item.id}`} style={[styles.item, index > 0 && styles.divider]}>
        <Text style={styles.status}>{item.source.status === "unknown" ? "結果未知" : item.statusLabel}</Text>
        <Text accessibilityRole="header" style={styles.title}>{item.title}</Text>
        {item.whyNow ? <Text style={styles.body}>{item.whyNow}</Text> : null}
        <Text style={styles.detail}>{item.detail}</Text>
        {item.sourceLabel ? <Text style={styles.meta}>依據：{item.sourceLabel}</Text> : null}
        {timeLabel(item.source.createdAt) ? <Text style={styles.meta}>建立於 {timeLabel(item.source.createdAt)}</Text> : null}
        <View style={styles.action}><AppButton label={item.action.label} density="compact" variant="accent" onPress={() => actions.open(item.action.destination)} /></View>
      </View>) : null}
      {loadedAt ? <Text style={styles.meta}>{section.synthetic ? "合成快照讀取時間" : "讀取於"} {loadedAt}</Text> : null}
      {model.connection !== "online" ? <Text style={styles.meta}>目前未連線；已載入的提醒可能不是最新狀態。</Text> : null}
    </SectionCard>
    {operation.state !== "none" ? <SectionCard testID="home-operation-recovery">
      <SectionHeader title="你的操作狀態" density="compact" />
      <OperationNotice state={operation.state} title={operation.title} message={operation.detail}>
        {operation.state !== "saving" ? <AppButton label={operation.state === "unknown" ? "查核這次結果" : "查看原操作"} density="compact" variant="secondary" onPress={actions.reviewOperation} /> : null}
      </OperationNotice>
    </SectionCard> : null}
  </>;
}
const styles = StyleSheet.create({
  item: { gap: spacing.sm }, divider: { borderTopColor: colors.softLine, borderTopWidth: 1, paddingTop: spacing.md },
  status: { fontFamily: chineseFont, color: colors.teal, ...readingType.meta, fontWeight: "700" },
  title: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool },
  detail: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  action: { alignSelf: "flex-start", maxWidth: "100%" },
});
