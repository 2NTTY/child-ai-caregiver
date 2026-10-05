import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { HomeOverviewItem } from "../home-overview";
import type { HomeActions } from "../view-model";
import { chineseFont, colors, readingType, spacing, workspaceType } from "../theme";
import { AppButton } from "./ui";

export function HomeOverviewItems({ items, actions, compact = false }: { items: HomeOverviewItem[]; actions: HomeActions; compact?: boolean }) {
  return <View style={styles.list}>{items.map((item, index) => <View key={item.id} testID={`home-overview-item-${item.id}`} style={[styles.item, index > 0 && styles.divider, compact && styles.compactItem]}>
    <View style={styles.heading}><Text style={styles.status}>{item.statusLabel}</Text><Text accessibilityRole="header" style={styles.title}>{item.title}</Text></View>
    <Text style={styles.body}>{item.detail}</Text>
    {item.sourceLabel ? <Text style={styles.meta}>依據：{item.sourceLabel}</Text> : null}
    <View style={styles.action}><AppButton label={item.action.label} density="compact" variant={compact ? "quiet" : "secondary"} onPress={() => actions.open(item.action.destination)} /></View>
  </View>)}</View>;
}
const styles = StyleSheet.create({
  list: { gap: spacing.md }, heading: { gap: spacing.xs }, compactItem: { paddingVertical: spacing.xs }, action: { alignSelf: "flex-start", maxWidth: "100%" }, item: { gap: spacing.sm }, divider: { borderTopColor: colors.softLine, borderTopWidth: 1, paddingTop: spacing.md },
  status: { fontFamily: chineseFont, color: colors.teal, ...readingType.meta, fontWeight: "700" },
  title: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool }, meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
});
