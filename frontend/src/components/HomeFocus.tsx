import { HOME_TASK_SUMMARY_LIMIT } from "../home-task-projection";
import { RouteTextLink } from "./RouteTextLink";
import { BackgroundSurface } from "./appearance/BackgroundSurface";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { HomeOperation } from "../view-model";
import { chineseFont, colors, readingType, spacing, workspaceType } from "../theme";
import { AppButton, SectionCard, SectionHeader, TextLink } from "./ui";
import { OperationNotice } from "./OperationNotice";
import { ReadStateNotice } from "./ReadStateNotice";
import { HomeOverviewItems, type HomeSectionProps } from "./HomeOverviewItems";

export function HomeFocus({ section, operation, connection, onOpen, onRefresh, onReviewOperation, full = false }: HomeSectionProps & { operation: HomeOperation; onReviewOperation(): void; full?: boolean }) {
  if (!section) return null;
  const visibleItems = full ? section.items : section.items.slice(0, 1);
  const canShowItems = section.state === "ready" || section.state === "stale" || section.state === "loading";
  return <SectionCard testID={full ? "rail-attention" : "home-focus"}>
    <SectionHeader title={full ? "待辦與提醒" : "現在要處理"} density="compact" />
    {operation.state !== "none" ? <OperationNotice headingLevel={3} state={operation.state} title={operation.title} message={operation.detail}>
      {operation.state !== "saving" ? <AppButton label={operation.state === "unknown" ? "查核這次結果" : "查看原操作"} density="compact" variant="secondary" onPress={onReviewOperation} /> : null}
    </OperationNotice> : null}
    <ReadStateNotice state={section.state === "ready" ? section.items.length ? "ready" : "empty" : section.state}
      message={section.detail ?? (section.state === "ready" && !section.items.length ? "目前沒有待辦事項" : undefined)}>
      {["error", "stale", "unavailable"].includes(section.state) ? <AppButton label="重新讀取" density="compact" variant="quiet" disabled={connection !== "online"} onPress={onRefresh} /> : null}
    </ReadStateNotice>
    {canShowItems ? <HomeOverviewItems items={visibleItems} onOpen={onOpen} /> : null}
    {section.state === "ready" && section.items.length > 0 && section.detail ? <Text accessibilityLiveRegion="polite" style={styles.meta}>{section.detail}</Text> : null}
    {!full && canShowItems && section.items.length > visibleItems.length ? <Text style={styles.meta}>更多已載入內容可在資訊側欄查看。</Text> : null}
  </SectionCard>;
}

// A short projection of the same authorized attention source used by the information rail.
export type HomeActionSummaryProps = HomeSectionProps & { readOnly: boolean };
export function HomeActionSummary({ section, connection, onOpen, onRefresh, readOnly }: HomeActionSummaryProps) {
  if (!section) return null;
  if (section.state === "ready" && !section.items.length) return <View testID="home-no-tasks" style={styles.emptyLine}>
    <Text style={styles.body}>目前已載入的內容沒有待辦。</Text><RouteTextLink label={readOnly ? "查看事項" : "查看／新增事項"} href="/tasks" />
    {section.detail ? <Text style={styles.meta}>{section.detail}</Text> : null}
  </View>;
  const groups = [
    { key: "scheduled", label: "按日期接續", items: section.items.filter(item => !item.group || item.group === "scheduled") },
    { key: "undated", label: "時間待確認", items: section.items.filter(item => item.group === "undated") },
    { key: "review", label: "待覆核 · 已停催", items: section.items.filter(item => item.group === "review") },
  ];
  const coverage = section.detail ?? (groups.some(group => group.items.length > HOME_TASK_SUMMARY_LIMIT) ? "首頁只列出部分已載入事項，可查看全部。" : undefined);
  return <View testID="home-action-summary" style={styles.summary}>
    <View style={styles.heading}><Text accessibilityRole="header" aria-level={2} style={styles.title}>接下來的安排</Text><RouteTextLink label="查看全部" href="/tasks" /></View>
    <ReadStateNotice state={section.state} message={section.detail}>
      {["error", "stale", "unavailable"].includes(section.state) ? <AppButton label="重新讀取待辦" density="compact" variant="quiet" disabled={connection !== "online"} onPress={onRefresh} /> : null}
    </ReadStateNotice>
    {section.state === "ready" && coverage ? <Text style={styles.meta}>{coverage}</Text> : null}
    {["ready", "stale", "loading"].includes(section.state) ? groups.filter(group => group.items.length).map(group => <View key={group.key} testID={`home-task-group-${group.key}`} style={styles.group}>
      <Text accessibilityRole="header" aria-level={3} style={styles.groupTitle}>{group.label}</Text>
      <HomeOverviewItems items={group.items.slice(0, HOME_TASK_SUMMARY_LIMIT)} onOpen={onOpen} compact />
    </View>) : null}
  </View>;
}

const styles = StyleSheet.create({
  summary: { gap: spacing.md, minWidth: 0, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.lg },
  heading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  title: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section, fontWeight: "700" },
  group: { minWidth: 0 }, groupTitle: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta, fontWeight: "700", paddingTop: spacing.xs },
  emptyLine: { minWidth: 0, flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: spacing.lg, rowGap: spacing.xs, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.md },
  body: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, flexShrink: 1 }, meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
});
