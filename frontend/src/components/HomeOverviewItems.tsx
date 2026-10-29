import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { HomeOverviewItem } from "../home-overview";
import { homeTargetHref } from "../home-target";
import { PreviewLink } from "../preview/PreviewNavigationGuard";
import { chineseFont, colors, readingType, spacing } from "../theme";
import { RouteTextLink } from "./RouteTextLink";

function ItemRow({ item }: { item: HomeOverviewItem }) {
  const [hovered, setHovered] = useState(false), [pressed, setPressed] = useState(false);
  return <PreviewLink href={homeTargetHref(item.action.target)}><Pressable testID={`home-overview-item-${item.id}`} accessibilityRole="link"
    accessibilityLabel={[...new Set([item.title, item.statusLabel, item.detail, item.action.label].filter(Boolean))].join("，")}
    accessibilityHint={item.sourceLabel ? `依據：${item.sourceLabel}` : undefined} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)} onBlur={() => setPressed(false)}
    style={StyleSheet.flatten([styles.row, (hovered || pressed) && styles.active])}>
    <View style={styles.copy}><Text style={styles.title}>{item.title}</Text><Text style={styles.detail}>{item.detail}</Text>
      {item.sourceLabel ? <Text style={styles.meta}>依據：{item.sourceLabel}</Text> : null}</View>
    <Text style={styles.status}>{item.statusLabel}</Text>
  </Pressable></PreviewLink>;
}
export function HomeOverviewItems({ items, compact = false }: { items: HomeOverviewItem[]; compact?: boolean }) {
  if (compact) return <View>{items.map(item => <ItemRow key={item.id} item={item} />)}</View>;
  return <View style={styles.list}>{items.map(item => <View key={item.id} testID={`home-overview-item-${item.id}`} style={styles.item}>
    <Text style={styles.status}>{item.statusLabel}</Text><Text accessibilityRole="header" aria-level={3} style={styles.title}>{item.title}</Text>
    <Text style={styles.detail}>{item.detail}</Text>{item.sourceLabel ? <Text style={styles.meta}>依據：{item.sourceLabel}</Text> : null}
    <RouteTextLink href={homeTargetHref(item.action.target)} label={item.action.label} />
  </View>)}</View>;
}
const styles = StyleSheet.create({
  list: { gap: spacing.lg }, row: { flexDirection: "row", flexWrap: "wrap", alignItems: "baseline", gap: spacing.md, minHeight: 64, minWidth: 0, paddingVertical: spacing.lg, paddingHorizontal: spacing.xs, borderBottomColor: colors.softLine, borderBottomWidth: 1 },
  copy: { flexGrow: 1, flexShrink: 1, flexBasis: 220, minWidth: 0, gap: spacing.xs },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: 17, lineHeight: 27, fontWeight: "700" },
  detail: { fontFamily: chineseFont, color: colors.muted, fontSize: 16, lineHeight: 26 },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta }, status: { fontFamily: chineseFont, color: colors.deepTeal, ...readingType.meta, fontWeight: "600", flexShrink: 1 },
  active: { backgroundColor: colors.paleTeal }, item: { gap: spacing.xs, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.line },
});
