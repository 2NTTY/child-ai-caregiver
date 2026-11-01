import { AppStatusBadge } from "./AppStatusBadge";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { HomeOverviewItem } from "../home-overview";
import type { HomeActions } from "../view-model";
import { chineseFont, colors, readingType, spacing, workspaceType } from "../theme";
import { AppButton } from "./ui";
import { AppIcon } from "./AppIcon";

export function HomeOverviewItems({ items, actions, compact = false }: { items: HomeOverviewItem[]; actions: HomeActions; compact?: boolean }) {
  if (compact) return <View>{items.map(item => <Pressable key={item.id} testID={`home-overview-item-${item.id}`}
    accessibilityRole="button" accessibilityLabel={`${item.title}，${item.action.label}`} accessibilityHint={item.sourceLabel ? `依據：${item.sourceLabel}` : undefined}
    onPress={() => actions.open(item.action.destination)} style={({ pressed }) => [styles.compactItem, pressed && styles.pressed]}>
    <View style={styles.compactCopy}><Text style={styles.compactTitle}>{item.title}</Text><AppStatusBadge label={item.statusLabel} tone="info" /><Text style={styles.meta}>{item.detail}</Text></View>
    <AppIcon name="chevron-right" size={18} />
  </Pressable>)}</View>;
  return <View style={styles.list}>{items.map((item, index) => <View key={item.id} testID={`home-overview-item-${item.id}`} style={[styles.item, index > 0 && styles.divider]}>
    <View style={styles.heading}><AppStatusBadge label={item.statusLabel} tone="info" /><Text accessibilityRole="header" style={styles.title}>{item.title}</Text></View>
    <Text style={styles.body}>{item.detail}</Text>
    {item.sourceLabel ? <Text style={styles.meta}>依據：{item.sourceLabel}</Text> : null}
    <View style={styles.action}><AppButton label={item.action.label} density="compact" variant="secondary" onPress={() => actions.open(item.action.destination)} /></View>
  </View>)}</View>;
}
const styles = StyleSheet.create({
  list: { gap: spacing.md }, heading: { gap: spacing.xs },
  compactItem: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 56, paddingVertical: spacing.md, borderBottomColor: colors.softLine, borderBottomWidth: 1 },
  compactCopy: { flex: 1, minWidth: 0, gap: spacing.xs, borderLeftColor: colors.sage, borderLeftWidth: 3, paddingLeft: spacing.md },
  compactTitle: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.row, fontWeight: "700" },
  pressed: { backgroundColor: colors.pressedOverlay }, action: { alignSelf: "flex-start", maxWidth: "100%" }, item: { gap: spacing.sm }, divider: { borderTopColor: colors.softLine, borderTopWidth: 1, paddingTop: spacing.md },
  title: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool }, meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
});
