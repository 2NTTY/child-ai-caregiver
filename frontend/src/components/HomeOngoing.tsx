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

export function HomeOngoing({ model, actions }: { model: HomeViewModel; actions: HomeActions }) {
  const heading = useRef<View | null>(null);
  const overview = selectHomeOverview(model);
  if (!overview) return null;
  const section = overview.ongoing;
  return <View testID="home-ongoing" style={styles.section}>
    <View ref={heading} style={styles.heading}>
      <Text accessibilityRole="header" {...(Platform.OS === "web" ? { "aria-level": 2 } : {})} style={styles.title}>持續關注</Text>
      <RouteTextLink href="/growth" scopeKey={model.scopeKey ?? null} label="全部關注" />
    </View>

    <ReadStateNotice state={section.state === "ready" ? section.items.length ? "ready" : "empty" : section.state}
      refreshing={section.state === "loading" && section.items.length > 0}
      message={section.detail ?? (section.state === "ready" && !section.items.length ? "目前沒有持續關注" : undefined)}>
    </ReadStateNotice>
    <HomeReadRetry state={section.state} scopeKey={model.scopeKey ?? null} online={model.connection === "online"} label="重新讀取關注" onRetry={actions.refresh} heading={heading} />
    {["ready", "stale", "loading"].includes(section.state) ? <HomeOverviewRows items={section.items.slice(0, 3)} actions={actions} scopeKey={model.scopeKey} /> : null}
    {section.items.length > 3 && ["ready", "stale", "loading"].includes(section.state) ? <Text style={styles.meta}>顯示首 3 項，其餘可在全部關注查看。</Text> : null}
  </View>;
}
const styles = StyleSheet.create({
  section: { gap: spacing.sm, minWidth: 0, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.lg },
  heading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: 18, lineHeight: 28, fontWeight: "700", flexShrink: 1 },
  description: { fontFamily: chineseFont, color: colors.muted, ...readingType.body },
  meta: { fontFamily: chineseFont, color: colors.muted, fontSize: 14, lineHeight: 22 },
});
