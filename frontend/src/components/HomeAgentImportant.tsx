import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { HomeActions, HomeViewModel } from "../view-model";
import { selectHomeAgentImportant } from "../home-overview";
import { chineseFont, colors, readingType, spacing, workspaceType } from "../theme";
import { AppButton, SectionCard, SectionHeader, TextLink } from "./ui";
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
  const visible = section.items.slice(0, 3);
  return <View style={styles.stack}>
    <SectionCard testID="home-agent-important" style={styles.important}>
      <SectionHeader title="Agent 提醒你" subtitle="先看這幾件事" density="compact" />
      <ReadStateNotice state={section.state === "ready" ? section.items.length ? "ready" : "empty" : section.state}
        title={section.state === "error" ? "未能讀取重要事項" : section.state === "unavailable" ? "暫未能確認重要事項" : undefined}
        message={section.detail ?? (section.state === "ready" ? "這次已載入快照沒有 Agent 重要事項。" : section.state === "loading" ? "正在讀取 Agent 重要事項…" : "目前未能取得 Agent 重要事項，不能當作沒有提醒。") }>
        {section.state === "error" || section.state === "unavailable" ? <AppButton label="重新讀取" density="compact" variant="quiet" disabled={model.connection !== "online"} onPress={actions.refresh} /> : null}
      </ReadStateNotice>
      {section.state === "ready" ? visible.map((item, index) => <View key={item.id} testID={`home-agent-important-item-${item.id}`} style={[styles.item, index > 0 && styles.divider]}>
        <Text style={styles.status}>{item.source.status === "unknown" ? "結果未知" : item.statusLabel}</Text>
        <Text accessibilityRole="header" style={[styles.title, index === 0 && styles.leadTitle]}>{item.title}</Text>
        {item.whyNow ? <Text style={styles.body}>{item.whyNow}</Text> : null}
        <Text style={styles.detail}>{item.detail}</Text>
        <View style={styles.itemFooter}><View style={styles.source}>
          {item.sourceLabel ? <Text style={styles.meta}>依據：{item.sourceLabel}</Text> : null}
          {timeLabel(item.source.createdAt) ? <Text style={styles.meta}>建立於 {timeLabel(item.source.createdAt)}</Text> : null}
        </View><AppButton label={item.action.label} density="compact" variant={index === 0 ? "secondary" : "quiet"} onPress={() => actions.open(item.action.destination)} /></View>
      </View>) : null}
      {section.state === "ready" && section.items.length > visible.length ? <TextLink label={`另有 ${section.items.length - visible.length} 項，開啟助手查看`} onPress={() => actions.open("chat")} /> : null}
      <View style={styles.provenance}>
        {section.synthetic ? <Text style={styles.meta}>合成示例 · 尚未接駁真正 Agent 推送</Text> : null}
        {loadedAt ? <Text style={styles.meta}>{section.synthetic ? "合成快照讀取時間" : "讀取於"} {loadedAt}</Text> : null}
        {model.connection !== "online" ? <Text style={styles.meta}>目前未連線；已載入的提醒可能不是最新狀態。</Text> : null}
      </View>
    </SectionCard>
    {operation.state !== "none" ? <View testID="home-operation-recovery" style={styles.recovery}>
      <SectionHeader title="你的操作狀態" density="compact" />
      <OperationNotice state={operation.state} title={operation.title} message={operation.detail}>
        {operation.state !== "saving" ? <AppButton label={operation.state === "unknown" ? "查核這次結果" : "查看原操作"} density="compact" variant="secondary" onPress={actions.reviewOperation} /> : null}
      </OperationNotice>
    </View> : null}
  </View>;
}
const styles = StyleSheet.create({
  stack: { gap: spacing.md }, important: { borderTopWidth: 3, borderTopColor: colors.teal },
  item: { gap: spacing.sm }, divider: { borderTopColor: colors.softLine, borderTopWidth: 1, paddingTop: spacing.md },
  status: { fontFamily: chineseFont, color: colors.teal, ...readingType.meta, fontWeight: "700" },
  title: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section, fontWeight: "700" },
  leadTitle: { fontSize: 22, lineHeight: 30, fontWeight: "800" },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool },
  detail: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  itemFooter: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  source: { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: spacing.xs },
  provenance: { borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.sm, gap: spacing.xs },
  recovery: { gap: spacing.sm },
});
