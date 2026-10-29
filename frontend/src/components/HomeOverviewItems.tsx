import { homeTargetHref } from "../home-target";
import { RouteTextLink } from "./RouteTextLink";
import { Fragment } from "react";
import { AppStatusBadge } from "./AppStatusBadge";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { HomeOverviewItem, HomeOverviewSection } from "../home-overview";
import type { HomeActions } from "../view-model";
import { chineseFont, colors, readingType, spacing } from "../theme";
import { AppIcon } from "./AppIcon";

type OverviewItemsProps = { items: HomeOverviewItem[]; actions: HomeActions; scopeKey?: string | null; groupTotals?: HomeOverviewSection["groupTotals"] };

// A single navigation target per row: reading a summary never changes the underlying item.
export function HomeOverviewRows({ items, scopeKey, groupTotals }: OverviewItemsProps) {
  return <View>{items.map((item, index) => <Fragment key={item.id}>
    {item.group && item.group !== items[index - 1]?.group ? <Text accessibilityRole="header" aria-level={3} style={styles.groupTitle}>{groupLabels[item.group]}{groupTotals ? ` · ${groupTotals[item.group]} 項已載入` : ""}</Text> : null}
    <RouteTextLink testID={`home-overview-item-${item.id}`} href={homeTargetHref(item.action.target)} scopeKey={scopeKey ?? null}
      label={`${item.statusLabel}，${item.title}，${item.detail}，${item.action.label}`} style={styles.row}>
    <View style={styles.rowCopy}>
      <View style={styles.heading}><Text style={styles.rowTitle}>{item.title}</Text><AppStatusBadge label={item.statusLabel} tone="info" /><AppIcon name="arrow-right" size={18} color={colors.teal} importantForAccessibility="no" /></View>
      <Text style={styles.body}>{item.detail}</Text>
      {item.sourceLabel ? <Text style={styles.meta}>依據：{item.sourceLabel}</Text> : null}
    </View>
  </RouteTextLink></Fragment>)}</View>;
}

const groupLabels = { scheduled: "按安排時間", review: "待覆核 · 已停催", undated: "時間待核對" };
const styles = StyleSheet.create({
  groupTitle: { fontFamily: chineseFont, color: colors.ink, ...readingType.body, fontWeight: "700", paddingTop: spacing.lg },
  heading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  row: { minWidth: 0, minHeight: 56, paddingVertical: 12, borderBottomColor: colors.softLine, borderBottomWidth: 1 },
  rowCopy: { minWidth: 0, gap: spacing.sm },
  rowTitle: { flexGrow: 1, flexShrink: 1, flexBasis: 160, minWidth: 0, fontFamily: chineseFont, color: colors.ink, ...readingType.body, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.muted, ...readingType.body }, meta: { fontFamily: chineseFont, color: colors.muted, fontSize: 13, lineHeight: 20 },
});
