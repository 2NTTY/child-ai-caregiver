import { StyleSheet } from "react-native";
import { Text } from "react-native-paper";
import type { HomeActions, HomeViewModel } from "../view-model";
import { selectHomeOverview } from "../home-overview";
import { chineseFont, colors, readingType } from "../theme";
import { AppButton, SectionCard, SectionHeader, TextLink } from "./ui";
import { ReadStateNotice } from "./ReadStateNotice";
import { HomeOverviewItems } from "./HomeOverviewItems";

export function HomeOngoing({ model, actions }: { model: HomeViewModel; actions: HomeActions }) {
  const overview = selectHomeOverview(model);
  if (!overview) return null;
  const section = overview.ongoing;
  return <SectionCard testID="home-ongoing">
    <SectionHeader title="持續關注" subtitle="把需要經常回看的話題留在一起" density="compact" />
    <ReadStateNotice state={section.state === "ready" ? section.items.length ? "ready" : "empty" : section.state}
      message={section.items.length ? undefined : section.detail ?? "目前沒有已載入的持續關注內容。"}>
      {section.state === "unavailable" ? <AppButton label="重新讀取關注" density="compact" variant="quiet" disabled={model.connection !== "online"} onPress={actions.refresh} /> : null}
    </ReadStateNotice>
    {section.state === "ready" ? <HomeOverviewItems items={section.items} actions={actions} /> : null}
    {model.connection !== "online" ? <Text style={styles.meta}>目前未連線；以上保留較早讀取的關注快照。</Text> : null}
    <TextLink label="查看所有照顧記錄" onPress={() => actions.open("care")} />
  </SectionCard>;
}
const styles = StyleSheet.create({ meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta } });
