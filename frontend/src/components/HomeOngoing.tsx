import { RouteTextLink } from "./RouteTextLink";
import { BackgroundSurface } from "./appearance/BackgroundSurface";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { chineseFont, colors, readingType, spacing, workspaceType } from "../theme";
import { AppButton, TextLink } from "./ui";
import { ReadStateNotice } from "./ReadStateNotice";
import { HomeOverviewItems, type HomeSectionProps } from "./HomeOverviewItems";

export function HomeOngoing({ section, connection, onOpen, onRefresh }: HomeSectionProps) {
  if (!section) return null;
  if (section.state === "ready" && !section.items.length) return <View style={styles.emptyLine}><Text style={styles.meta}>目前沒有已載入的持續關注。</Text><RouteTextLink label="查看關注" href="/growth" /></View>;
  return <BackgroundSurface testID="home-ongoing" style={styles.section}>
    <View style={styles.heading}><Text accessibilityRole="header" aria-level={2} style={styles.title}>持續關注</Text><RouteTextLink label="查看全部" href="/growth" /></View>
    <ReadStateNotice state={section.state === "ready" ? section.items.length ? "ready" : "empty" : section.state}
      message={section.detail ?? (section.state === "ready" && !section.items.length ? "目前沒有持續關注" : undefined)}>
      {["error", "stale", "unavailable"].includes(section.state) ? <AppButton label="重新讀取關注" density="compact" variant="quiet" disabled={connection !== "online"} onPress={onRefresh} /> : null}
    </ReadStateNotice>
    {["ready", "stale", "loading"].includes(section.state) ? <HomeOverviewItems items={section.items.slice(0, 3)} onOpen={onOpen} compact /> : null}
  </BackgroundSurface>;
}
const styles = StyleSheet.create({ emptyLine: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: spacing.lg, minWidth: 0 }, section: { gap: spacing.md, minWidth: 0, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.lg }, heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }, title: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section }, meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta } });
