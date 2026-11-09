import { PreviewLink } from "../preview/PreviewNavigationGuard";
import { homeTargetHref } from "../home-target";
import { RouteTextLink } from "./RouteTextLink";
import { AppStatusBadge } from "./AppStatusBadge";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { HomeOverviewItem, HomeOverviewSection } from "../home-overview";
import type { ConnectionState, HomeActions } from "../view-model";
import { chineseFont, colors, readingType, spacing, workspaceType } from "../theme";
import { AppButton } from "./ui";
import { AppIcon } from "./AppIcon";

export type HomeSectionProps = { section: HomeOverviewSection | null; connection: ConnectionState; onOpen: HomeActions["open"]; onRefresh(): void };
export function HomeOverviewItems({ items, onOpen, compact = false }: { items: HomeOverviewItem[]; onOpen: HomeActions["open"]; compact?: boolean }) {
  if (compact) return <View>{items.map(item => { const row = <Pressable key={item.id} testID={`home-overview-item-${item.id}`}
    accessibilityRole={Platform.OS === "web" ? "link" : "button"} accessibilityLabel={[item.title,item.detail,item.statusLabel,item.action.label].filter(Boolean).join("，")} accessibilityHint={item.sourceLabel ? `依據：${item.sourceLabel}` : undefined}
    onPress={Platform.OS === "web" ? undefined : () => onOpen(item.action.target)} style={StyleSheet.flatten([styles.compactItem])}>
    <View style={styles.compactCopy}><Text style={styles.compactTitle}>{item.title}</Text><AppStatusBadge label={item.statusLabel} tone="info" /><Text style={styles.meta}>{item.detail}</Text></View>
    <AppIcon name="chevron-right" size={18} />
  </Pressable>; return Platform.OS === "web" ? <PreviewLink key={item.id} href={homeTargetHref(item.action.target)}>{row}</PreviewLink> : row; })}</View>;
  return <View style={styles.list}>{items.map((item, index) => <View key={item.id} testID={`home-overview-item-${item.id}`} style={[styles.item, index > 0 && styles.divider]}>
    <View style={styles.heading}><AppStatusBadge label={item.statusLabel} tone="info" /><Text accessibilityRole="header" aria-level={3} style={styles.title}>{item.title}</Text></View>
    <Text style={styles.body}>{item.detail}</Text>
    {item.sourceLabel ? <Text style={styles.meta}>依據：{item.sourceLabel}</Text> : null}
    <View style={styles.action}><RouteTextLink label={item.action.label} href={homeTargetHref(item.action.target)} /></View>
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
