import { StyleSheet } from "react-native";
import { Text } from "react-native-paper";
import type { HomeActions, HomeViewModel } from "../view-model";
import { selectHomeOverview } from "../home-overview";
import { chineseFont, colors, readingType } from "../theme";
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
  const emptyMessage = operation.state === "none" ? section.detail ?? "目前沒有指定待處理事項。" : "這次快照沒有其他指定待辦。";
  return <SectionCard testID={full ? "rail-attention" : "home-focus"}>
    <SectionHeader title={full ? "待辦與提醒" : "現在要處理"} density="compact" />
    {operation.state !== "none" ? <OperationNotice state={operation.state} title={operation.title} message={operation.detail}>
      {operation.state !== "saving" ? <AppButton label={operation.state === "unknown" ? "查核這次結果" : "查看原操作"} density="compact" variant="secondary" onPress={actions.reviewOperation} /> : null}
    </OperationNotice> : null}
    <ReadStateNotice state={section.state === "ready" ? section.items.length ? "ready" : "empty" : section.state}
      title={section.state === "unavailable" ? "暫未能確認待辦與提醒" : undefined}
      message={section.state === "ready" && section.items.length === 0 ? emptyMessage : section.detail}>
      {section.state === "unavailable" ? <AppButton label="重新讀取" density="compact" variant="quiet" disabled={model.connection !== "online"} onPress={actions.refresh} /> : null}
    </ReadStateNotice>
    {section.state === "ready" ? <HomeOverviewItems items={visibleItems} actions={actions} /> : null}
    {!full && section.items.length > visibleItems.length ? <Text style={styles.meta}>另有 {section.items.length - visibleItems.length} 項，可在資訊側欄的「待辦／提醒」查看。</Text> : null}
    {full ? <Text style={styles.meta}>只顯示這次已載入的事項；安排、送達與照顧完成各自核對。</Text> : null}
    {model.connection !== "online" ? <Text style={styles.meta}>目前未連線；已載入的事項可能不是最新狀態。</Text> : null}
  </SectionCard>;
}
const styles = StyleSheet.create({ meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta } });
