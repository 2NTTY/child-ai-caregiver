import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Divider, Text } from "react-native-paper";
import type { HomeActions, HomeRecord, HomeViewModel } from "../view-model";
import { chineseFont, colors, readingType, spacing, workspaceType } from "../theme";
import { AppIcon, type AppIconName } from "./AppIcon";
import { AppButton, AppTextField, SectionCard, SectionHeader, TextLink } from "./ui";
import { ReadStateNotice } from "./ReadStateNotice";

const recordIcons: Record<HomeRecord["kind"], AppIconName> = { sleep: "weather-night", feeding: "silverware-fork-knife", measurement: "chart-bar", note: "notebook-outline", appointment: "calendar-outline" };
export function HomeRecentRecords({ model, actions, filterable = false }: { model: HomeViewModel; actions: HomeActions; filterable?: boolean }) {
  const [query, setQuery] = useState("");
  useEffect(() => setQuery(""), [model.selectedChildId]);
  const selected = model.children.some(item => item.id === model.selectedChildId);
  const recent = model.records.filter(item => item.childId === model.selectedChildId);
  const records = recent.filter(item => `${item.title} ${item.detail}`.toLocaleLowerCase("zh-HK").includes(query.trim().toLocaleLowerCase("zh-HK")));
  const state = !selected ? "empty" : model.recordsLoad === "loading" ? "loading" : model.recordsLoad === "error" ? "error" : records.length ? "ready" : "empty";
  const message = !selected ? "選擇或建立孩子後，這裏會顯示相應記錄。" : state === "loading" ? "正在讀取已確認記錄…" : state === "error" ? "暫時讀不到記錄，尚未能確認最新資料。" : state === "empty" ? query ? "已載入記錄中沒有符合的內容。" : "目前沒有已確認的照顧記錄。" : "";
  return <SectionCard testID="home-recent-records"><SectionHeader title="最近已確認記錄" density="compact" action={selected ? <TextLink label="查看記錄頁" onPress={() => actions.open("care")} /> : undefined} />
    {model.connection !== "online" ? <Text style={styles.meta}>未連線；以下是較早讀取的快照。</Text> : null}
    {filterable && selected && model.recordsLoad === "ready" && recent.length ? <AppTextField dense label="篩選下方已載入的記錄" value={query} onChangeText={setQuery} accessibilityLabel="篩選下方已載入的記錄" /> : null}
    <ReadStateNotice state={state} message={message}>{state === "error" ? <AppButton label="重新讀取記錄" density="compact" variant="secondary" onPress={actions.refresh} disabled={model.connection !== "online"} /> : null}</ReadStateNotice>
    {state === "ready" ? records.map((item, index) => <View key={item.id}>{index ? <Divider style={styles.divider} /> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={`查看${item.title}，${item.detail}`} onPress={() => actions.open("care")} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
        <AppIcon name={recordIcons[item.kind]} size={22} /><View style={styles.copy}><Text style={styles.title}>{item.title}</Text><Text style={styles.body}>{item.detail}</Text>
          <Text style={styles.meta}>事件：{item.eventTimeLabel} · {item.confirmedAtLabel}加入</Text></View><AppIcon name="chevron-right" size={18} />
      </Pressable></View>) : null}
    <Text style={styles.meta}>{model.lastReadLabel ? `最後讀取：${model.lastReadLabel}。` : ""}按加入時間顯示，與事件時間分開；不包括候選內容。</Text>
  </SectionCard>;
}
const styles = StyleSheet.create({
  row: { minHeight: 72, paddingVertical: spacing.sm, flexDirection: "row", alignItems: "center", gap: spacing.md },
  copy: { flex: 1, minWidth: 0, gap: spacing.xs }, pressed: { opacity: 0.68 }, divider: { backgroundColor: colors.softLine },
  title: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.row, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool }, meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
});
