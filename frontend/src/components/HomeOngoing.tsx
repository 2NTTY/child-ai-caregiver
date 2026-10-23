import { BackgroundSurface } from "./appearance/BackgroundSurface";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { HomeActions, HomeViewModel } from "../view-model";
import { selectHomeOverview } from "../home-overview";
import { chineseFont, colors, readingType, spacing, workspaceType } from "../theme";
import { AppButton, TextLink } from "./ui";
import { ReadStateNotice } from "./ReadStateNotice";
import { HomeOverviewItems } from "./HomeOverviewItems";

export function HomeOngoing({ model, actions }: { model: HomeViewModel; actions: HomeActions }) {
  const overview = selectHomeOverview(model);
  if (!overview) return null;
  const section = overview.ongoing;
  return <BackgroundSurface padded frosted testID="home-ongoing" style={styles.section}>
    <View style={styles.heading}><Text accessibilityRole="header" style={styles.title}>持續關注</Text><TextLink label="查看全部" onPress={() => actions.open("growth")} /></View>
    <ReadStateNotice state={section.state === "ready" ? section.items.length ? "ready" : "empty" : section.state}
      message={section.detail ?? (section.state === "ready" && !section.items.length ? "目前沒有持續關注" : undefined)}>
      {["error", "stale", "unavailable"].includes(section.state) ? <AppButton label="重新讀取關注" density="compact" variant="quiet" disabled={model.connection !== "online"} onPress={actions.refresh} /> : null}
    </ReadStateNotice>
    {["ready", "stale", "loading"].includes(section.state) ? <HomeOverviewItems items={section.items.slice(0, 3)} actions={actions} compact /> : null}
  </BackgroundSurface>;
}
const styles = StyleSheet.create({ section: { gap: spacing.sm, minWidth: 0, borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.lg }, heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }, title: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section }, meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta } });
