import { useRef } from "react";
import { HomeReadRetry } from "./HomeReadRetry";
import { RouteTextLink } from "./RouteTextLink";
import { Platform, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { HomeActions, HomeViewModel } from "../view-model";
import { selectHomeOverview } from "../home-overview";
import { chineseFont, colors, readingType, spacing } from "../theme";
import { ReadStateNotice } from "./ReadStateNotice";
import { HomeOverviewRows } from "./HomeOverviewItems";

export function HomeActionSummary({ model, actions }: { model: HomeViewModel; actions: HomeActions }) {
  const heading = useRef<View | null>(null);
  const overview = selectHomeOverview(model);
  if (!overview) return null;
  const section = overview.attention;
  return <View testID="home-action-summary" style={styles.summary}>
    <View ref={heading} style={styles.heading}>
      <Text accessibilityRole="header" {...(Platform.OS === "web" ? { "aria-level": 2 } : {})} style={styles.title}>待辦與安排</Text>
      <RouteTextLink href="/tasks" scopeKey={model.scopeKey ?? null} label="全部待辦" />
    </View>

    <ReadStateNotice state={section.state === "ready" ? section.items.length ? "ready" : "empty" : section.state}
      refreshing={section.state === "loading" && section.items.length > 0}
      message={section.detail ?? (section.state === "ready" && !section.items.length ? "目前沒有待辦事項" : undefined)}>
    </ReadStateNotice>
    <HomeReadRetry state={section.state} scopeKey={model.scopeKey ?? null} online={model.connection === "online"} label="重新讀取待辦" onRetry={actions.refresh} heading={heading} />
    {["ready", "stale", "loading"].includes(section.state) ? <HomeOverviewRows items={section.items} actions={actions} scopeKey={model.scopeKey} groupTotals={section.groupTotals} /> : null}
    {section.state === "ready" && section.items.length > 0 && section.detail ? <Text accessibilityLiveRegion="polite" style={styles.meta}>{section.detail}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  summary: { gap: spacing.sm, minWidth: 0, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.lg },
  heading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: 18, lineHeight: 28, fontWeight: "700", flexShrink: 1 },
  description: { fontFamily: chineseFont, color: colors.muted, ...readingType.body },
  meta: { fontFamily: chineseFont, color: colors.muted, fontSize: 14, lineHeight: 22 },
});
