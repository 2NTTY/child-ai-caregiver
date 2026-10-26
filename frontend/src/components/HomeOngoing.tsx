import { Platform, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { HomeActions, HomeViewModel } from "../view-model";
import { selectHomeOverview } from "../home-overview";
import { chineseFont, colors, readingType, spacing } from "../theme";
import { AppButton, TextLink } from "./ui";
import { ReadStateNotice } from "./ReadStateNotice";
import { HomeOverviewRows } from "./HomeOverviewItems";

export function HomeOngoing({ model, actions }: { model: HomeViewModel; actions: HomeActions }) {
  const overview = selectHomeOverview(model);
  if (!overview) return null;
  const section = overview.ongoing;
  return <View testID="home-ongoing" style={styles.section}>
    <View style={styles.heading}>
      <Text accessibilityRole="header" {...(Platform.OS === "web" ? { "aria-level": 2 } : {})} style={styles.title}>持續關注</Text>
      <TextLink label="查看全部關注" onPress={() => actions.open("growth")} />
    </View>
    <Text style={styles.description}>接續觀察與準備，保留前後脈絡。</Text>
    <ReadStateNotice state={section.state === "ready" ? section.items.length ? "ready" : "empty" : section.state}
      refreshing={section.state === "loading" && section.items.length > 0}
      message={section.detail ?? (section.state === "ready" && !section.items.length ? "目前沒有持續關注" : undefined)}>
      {["error", "stale", "unavailable"].includes(section.state) ? <AppButton label="重新讀取關注" variant="quiet" disabled={model.connection !== "online"} onPress={actions.refresh} /> : null}
    </ReadStateNotice>
    {["ready", "stale", "loading"].includes(section.state) ? <HomeOverviewRows items={section.items.slice(0, 3)} actions={actions} /> : null}
    {section.items.length > 3 && ["ready", "stale", "loading"].includes(section.state) ? <Text style={styles.meta}>顯示首 3 項，其餘可在全部關注查看。</Text> : null}
  </View>;
}
const styles = StyleSheet.create({
  section: { gap: spacing.sm, minWidth: 0, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.lg },
  heading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: 20, lineHeight: 30, fontWeight: "700", flexShrink: 1 },
  description: { fontFamily: chineseFont, color: colors.muted, ...readingType.body },
  meta: { fontFamily: chineseFont, color: colors.muted, fontSize: 14, lineHeight: 22 },
});
