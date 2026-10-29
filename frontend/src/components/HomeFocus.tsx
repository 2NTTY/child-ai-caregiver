import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { HomeActions, HomeViewModel } from "../view-model";
import { selectHomeOverview, type HomeOverviewSection } from "../home-overview";
import { chineseFont, colors, readingType, spacing, workspaceType } from "../theme";
import { AppButton, SectionCard, SectionHeader } from "./ui";
import { OperationNotice } from "./OperationNotice";
import { ReadStateNotice } from "./ReadStateNotice";
import { HomeOverviewItems } from "./HomeOverviewItems";

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
    {canShowItems ? <HomeOverviewItems items={visibleItems} /> : null}
    {section.state === "ready" && section.items.length > 0 && section.detail ? <Text accessibilityLiveRegion="polite" style={styles.meta}>{section.detail}</Text> : null}
    {!full && canShowItems && section.items.length > visibleItems.length ? <Text style={styles.meta}>另有 {section.items.length - visibleItems.length} 項，可在資訊側欄查看。</Text> : null}
  </SectionCard>;
}

// A short projection of the same authorized attention source used by the information rail.
export function HomeActionSummary({ section, online, onRefresh }: { section: HomeOverviewSection; online: boolean; onRefresh(): void }) {
  const groups = section.groups?.filter(group => group.items.length > 0);
  const moreLoaded = !!section.coverage?.moreLoaded || !!groups?.some(group => group.items.length > 2);
  const coverage = section.coverage
    ? [moreLoaded ? "另有已載入事項，請到待辦查看。" : null, section.coverage.moreUnloaded ? "尚有未載入的事項。" : null].filter(Boolean).join(" ")
    : section.detail ?? (moreLoaded ? "另有已載入事項，請到待辦查看。" : "");
  return <View testID="home-action-summary" style={styles.summary}>

    <ReadStateNotice state={section.state === "ready" ? section.items.length ? "ready" : "empty" : section.state}
      message={section.detail ?? (section.state === "ready" && !section.items.length ? "目前沒有待辦事項" : undefined)}>
      {["error", "stale", "unavailable"].includes(section.state) ? <AppButton label="重新讀取待辦" density="compact" variant="quiet" disabled={!online} onPress={onRefresh} /> : null}
    </ReadStateNotice>
    {["ready", "stale", "loading"].includes(section.state) ? groups
      ? groups.map(group => <View key={group.key} testID={`home-task-group-${group.key}`} style={styles.summary}>
        {group.key !== "scheduled" || groups.length > 1 ? <Text accessibilityRole="header" aria-level={3} style={styles.title}>{group.label}</Text> : null}
        <HomeOverviewItems items={group.items.slice(0, 2)} compact />
      </View>) : <HomeOverviewItems items={section.items} compact /> : null}
    {section.state === "ready" && section.items.length > 0 && coverage ? <Text testID="home-task-coverage" accessibilityLiveRegion="polite" style={styles.meta}>{coverage}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({ summary: { gap: spacing.sm, minWidth: 0 }, heading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }, title: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section }, meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta } });
