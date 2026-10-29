import { RouteTextLink } from "./RouteTextLink";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { HomeOverviewSection } from "../home-overview";
import { chineseFont, colors, readingType, spacing, workspaceType } from "../theme";
import { AppButton } from "./ui";
import { ReadStateNotice } from "./ReadStateNotice";
import { HomeOverviewItems } from "./HomeOverviewItems";

export function HomeOngoing({ section, online, onRefresh }: { section: HomeOverviewSection; online: boolean; onRefresh(): void }) {
  return <View testID="home-ongoing" style={styles.section}>
    <View style={styles.heading}><Text accessibilityRole="header" aria-level={2} style={styles.title}>持續關注</Text><RouteTextLink href="/growth" label="查看全部關注" /></View>
    <ReadStateNotice state={section.state === "ready" ? section.items.length ? "ready" : "empty" : section.state}
      message={section.detail ?? (section.state === "ready" && !section.items.length ? "目前沒有持續關注" : undefined)}>
      {["error", "stale", "unavailable"].includes(section.state) ? <AppButton label="重新讀取關注" density="compact" variant="quiet" disabled={!online} onPress={onRefresh} /> : null}
    </ReadStateNotice>
    {["ready", "stale", "loading"].includes(section.state) ? <HomeOverviewItems items={section.items.slice(0, 3)} compact /> : null}
  </View>;
}
const styles = StyleSheet.create({ section: { gap: spacing.sm, minWidth: 0, paddingTop: spacing.xs }, heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }, title: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section }, meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta } });
