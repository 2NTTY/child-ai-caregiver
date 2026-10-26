import { AppStatusBadge } from "./AppStatusBadge";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { HomeOverviewItem } from "../home-overview";
import type { HomeActions } from "../view-model";
import { chineseFont, colors, readingType, spacing } from "../theme";
import { AppButton } from "./ui";
import { AppIcon } from "./AppIcon";

type OverviewItemsProps = { items: HomeOverviewItem[]; actions: HomeActions };

// A single navigation target per row: reading a summary never changes the underlying item.
export function HomeOverviewRows({ items, actions }: OverviewItemsProps) {
  return <View>{items.map(item => <Pressable key={item.id} testID={`home-overview-item-${item.id}`}
    accessibilityRole="button" accessibilityLabel={`${item.statusLabel}，${item.title}，${item.action.label}`} accessibilityHint={[item.detail, item.sourceLabel ? `依據：${item.sourceLabel}` : null].filter(Boolean).join("；")}
    onPress={() => actions.open(item.action.destination)} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
    <View style={styles.rowCopy}>
      <View style={styles.heading}><Text style={styles.rowTitle}>{item.title}</Text><AppStatusBadge label={item.statusLabel} tone="info" /></View>
      <Text style={styles.body}>{item.detail}</Text>
      {item.sourceLabel ? <Text style={styles.meta}>依據：{item.sourceLabel}</Text> : null}
      <View style={styles.destination}><Text style={styles.destinationLabel}>{item.action.label}</Text><AppIcon name="arrow-right" size={18} color={colors.teal} importantForAccessibility="no" /></View>
    </View>
  </Pressable>)}</View>;
}

export function HomeOverviewItems({ items, actions }: OverviewItemsProps) {
  return <View style={styles.list}>{items.map((item, index) => <View key={item.id} testID={`home-overview-item-${item.id}`} style={[styles.item, index > 0 && styles.divider]}>
    <View style={styles.heading}><AppStatusBadge label={item.statusLabel} tone="info" /><Text accessibilityRole="header" aria-level={3} style={styles.title}>{item.title}</Text></View>
    <Text style={styles.body}>{item.detail}</Text>
    {item.sourceLabel ? <Text style={styles.meta}>依據：{item.sourceLabel}</Text> : null}
    <View style={styles.action}><AppButton label={item.action.label} variant="secondary" onPress={() => actions.open(item.action.destination)} /></View>
  </View>)}</View>;
}
const styles = StyleSheet.create({
  list: { gap: spacing.lg }, heading: { gap: spacing.sm },
  row: { minWidth: 0, minHeight: 56, paddingVertical: spacing.lg, borderBottomColor: colors.softLine, borderBottomWidth: 1 },
  rowCopy: { minWidth: 0, gap: spacing.sm },
  rowTitle: { fontFamily: chineseFont, color: colors.ink, ...readingType.body, fontWeight: "700" },
  pressed: { backgroundColor: colors.pressedOverlay }, action: { alignSelf: "flex-start", maxWidth: "100%" }, item: { gap: spacing.sm }, divider: { borderTopColor: colors.softLine, borderTopWidth: 1, paddingTop: spacing.lg },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: 18, lineHeight: 28, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.muted, ...readingType.body }, meta: { fontFamily: chineseFont, color: colors.muted, fontSize: 14, lineHeight: 22 },
  destination: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm },
  destinationLabel: { fontFamily: chineseFont, color: colors.teal, ...readingType.body, fontWeight: "600", flexShrink: 1 },
});
