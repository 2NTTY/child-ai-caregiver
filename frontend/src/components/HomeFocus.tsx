import { Platform, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { HomeActions, HomeViewModel } from "../view-model";
import { selectHomeOverview } from "../home-overview";
import { chineseFont, colors, readingType, spacing } from "../theme";
import { AppButton, SectionCard, SectionHeader, TextLink } from "./ui";
import { OperationNotice } from "./OperationNotice";
import { ReadStateNotice } from "./ReadStateNotice";
import { HomeOverviewItems, HomeOverviewRows } from "./HomeOverviewItems";

export function HomeFocus({ model, actions, full = false }: { model: HomeViewModel; actions: HomeActions; full?: boolean }) {
  const overview = selectHomeOverview(model);
  if (!overview) return null;
  const section = overview.attention;
  const operation = model.operation;
  const visibleItems = full ? section.items : section.items.slice(0, 1);
  const canShowItems = section.state === "ready" || section.state === "stale" || section.state === "loading";
  return <SectionCard testID={full ? "rail-attention" : "home-focus"}>
    <SectionHeader title={full ? "待辦與提醒" : "現在要處理"} density="compact" />
    {operation.state !== "none" ? <OperationNotice state={operation.state} title={operation.title} message={operation.detail}>
      {operation.state !== "saving" ? <AppButton label={operation.state === "unknown" ? "查核這次結果" : "查看原操作"} density="compact" variant="secondary" onPress={actions.reviewOperation} /> : null}
    </OperationNotice> : null}
    <ReadStateNotice state={section.state === "ready" ? section.items.length ? "ready" : "empty" : section.state}
      message={section.detail ?? (section.state === "ready" && !section.items.length ? "目前沒有待辦事項" : undefined)}>
      {["error", "stale", "unavailable"].includes(section.state) ? <AppButton label="重新讀取" density="compact" variant="quiet" disabled={model.connection !== "online"} onPress={actions.refresh} /> : null}
    </ReadStateNotice>
    {canShowItems ? <HomeOverviewItems items={visibleItems} actions={actions} /> : null}
    {section.state === "ready" && section.items.length > 0 && section.detail ? <Text accessibilityLiveRegion="polite" style={styles.meta}>{section.detail}</Text> : null}
    {!full && canShowItems && section.items.length > visibleItems.length ? <Text style={styles.meta}>另有 {section.items.length - visibleItems.length} 項，可在資訊側欄查看。</Text> : null}
  </SectionCard>;
}

// The daily agenda and information rail share the same authorized attention source.
export function HomeActionSummary({ model, actions }: { model: HomeViewModel; actions: HomeActions }) {
  const overview = selectHomeOverview(model);
  if (!overview) return null;
  const section = overview.attention;
  return <View testID="home-action-summary" style={styles.summary}>
    <View style={styles.heading}>
      <Text accessibilityRole="header" {...(Platform.OS === "web" ? { "aria-level": 2 } : {})} style={styles.title}>待辦與安排</Text>
      <TextLink label="查看全部待辦" onPress={() => actions.open("tasks")} />
    </View>
    <Text style={styles.description}>核對已有安排，再決定下一步。</Text>
    <ReadStateNotice state={section.state === "ready" ? section.items.length ? "ready" : "empty" : section.state}
      refreshing={section.state === "loading" && section.items.length > 0}
      message={section.detail ?? (section.state === "ready" && !section.items.length ? "目前沒有待辦事項" : undefined)}>
      {["error", "stale", "unavailable"].includes(section.state) ? <AppButton label="重新讀取待辦" variant="quiet" disabled={model.connection !== "online"} onPress={actions.refresh} /> : null}
    </ReadStateNotice>
    {["ready", "stale", "loading"].includes(section.state) ? <HomeOverviewRows items={section.items} actions={actions} /> : null}
    {section.state === "ready" && section.items.length > 0 && section.detail ? <Text accessibilityLiveRegion="polite" style={styles.meta}>{section.detail}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  summary: { gap: spacing.sm, minWidth: 0, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.lg },
  heading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: 20, lineHeight: 30, fontWeight: "700", flexShrink: 1 },
  description: { fontFamily: chineseFont, color: colors.muted, ...readingType.body },
  meta: { fontFamily: chineseFont, color: colors.muted, fontSize: 14, lineHeight: 22 },
});
