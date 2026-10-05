import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { HomeActions, HomeViewModel } from "../view-model";
import { selectHomeOverview } from "../home-overview";
import { chineseFont, colors, readingType, spacing } from "../theme";
import { AppButton, SectionHeader, TextLink } from "./ui";
import { ReadStateNotice } from "./ReadStateNotice";
import { HomeOverviewItems } from "./HomeOverviewItems";

export function HomeOngoing({ model, actions }: { model: HomeViewModel; actions: HomeActions }) {
  const overview = selectHomeOverview(model);
  if (!overview) return null;
  const section = overview.ongoing;
  return <View testID="home-ongoing" style={styles.section}>
    <SectionHeader title="持續關注" subtitle="回看變化，再決定下一步" density="compact" />
    <ReadStateNotice state={section.state === "ready" ? section.items.length ? "ready" : "empty" : section.state}
      message={section.items.length ? undefined : section.detail ?? "目前沒有已載入的持續關注內容。"}>
      {section.state === "unavailable" ? <AppButton label="重新讀取關注" density="compact" variant="quiet" disabled={model.connection !== "online"} onPress={actions.refresh} /> : null}
    </ReadStateNotice>
    {section.state === "ready" ? <HomeOverviewItems items={section.items.slice(0, 3)} actions={actions} compact /> : null}
    {model.connection !== "online" ? <Text style={styles.meta}>目前未連線；以上保留較早讀取的關注快照。</Text> : null}
    <TextLink label="查看持續話題與依據" onPress={() => actions.open("memory")} />
  </View>;
}
const styles = StyleSheet.create({ section: { gap: spacing.md, minWidth: 0 }, meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta } });
