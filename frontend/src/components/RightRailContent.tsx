import { useId, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Divider, Text } from "react-native-paper";
import { AppScrollView as ScrollView } from "./AppScrollView";
import type { HomeActions, HomeViewModel } from "../view-model";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";
import { AppIcon } from "./AppIcon";
import { AppTabPanel, SectionCard, SectionHeader, TextLink, UnderlineTabs } from "./ui";
import { HomeFocus } from "./HomeFocus";

type RailTab = "attention" | "context";
// Pure rail content. AppShell owns desktop layout, modal geometry and motion.
export function RightRailContent({ model, actions, home = false }: { model: HomeViewModel; actions: HomeActions; home?: boolean }) {
  const tabsId = useId();
  const [tab, setTab] = useState<RailTab>("attention");
  const child = model.children.find(item => item.id === model.selectedChildId);
  const records = model.records.filter(item => item.childId === model.selectedChildId).slice(0, 3);
  return <View style={styles.root}>
    <View style={styles.tabs}><UnderlineTabs id={tabsId} label="照顧資訊分類"
      items={[{ key: "attention", label: "待辦／提醒" }, { key: "context", label: "照顧上下文" }]} value={tab} onChange={setTab} /></View>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.cards}>
      <AppTabPanel tabsId={tabsId} tabKey="attention" active={tab === "attention"}>
        {child ? <HomeFocus model={model} actions={actions} full /> : <SectionCard><Text style={styles.meta}>選擇孩子後，再查看對應的待辦與提醒。</Text></SectionCard>}
      </AppTabPanel>
      <AppTabPanel tabsId={tabsId} tabKey="context" active={tab === "context"} style={styles.context}>
        <SectionCard><SectionHeader title={home ? "已載入的孩子背景" : "目前孩子"} density="compact" action={<TextLink label="查看檔案" onPress={() => actions.open("profile")} />} />
          {child ? <View style={styles.identity}>
            <View style={styles.avatar}><Text style={styles.avatarText}>{child.displayName.slice(0, 1)}</Text></View>
            <View style={styles.copy}><Text style={styles.title}>{child.displayName}</Text><Text style={styles.meta}>{child.ageLabel}</Text><Text style={styles.meta}>{child.regionLabel} · {child.profileConfirmed ? "檔案已確認" : "檔案待核對"}</Text></View>
          </View> : <Text style={styles.meta}>尚未選擇孩子；請先建立檔案。</Text>}
          {child ? <><Text style={styles.meta}>過敏資料：{child.allergiesLabel ?? "未提供"}</Text><Text style={styles.meta}>背景可協助理解問題；實際使用的資料由每次回覆標示。</Text></> : null}
        </SectionCard>
        {!home ? <SectionCard><SectionHeader title="近期已確認記錄" density="compact" action={<TextLink label="查看全部" onPress={() => actions.open("care")} />} />
          {model.recordsLoad === "loading" ? <Text style={styles.meta}>正在讀取記錄…</Text> : model.recordsLoad === "error" ? <Text style={styles.meta}>暫時讀不到記錄，不能確認最新資料。</Text> : records.length === 0 ? <Text style={styles.meta}>目前沒有已載入記錄。</Text> : records.map((record, index) => <View key={record.id}>
            {index > 0 ? <Divider style={styles.divider} /> : null}
            <Pressable accessibilityRole="button" accessibilityLabel={`查看${record.title}`} onPress={() => actions.open("care")} style={({ pressed }) => [styles.record, pressed && styles.pressed]}>
              <AppIcon name="file-document-outline" size={20} /><View style={styles.copy}><Text style={styles.title}>{record.title}</Text><Text numberOfLines={2} style={styles.meta}>{record.eventTimeLabel} · {record.detail}</Text></View>
            </Pressable>
          </View>)}
        </SectionCard> : null}
        {model.connection !== "online" ? <Text style={styles.meta}>目前未連線；以上可能不是最新資料。</Text> : null}
      </AppTabPanel>
    </ScrollView>
  </View>;
}
const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0 }, tabs: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm }, scroll: { flex: 1, minHeight: 0 },
  cards: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl }, context: { gap: spacing.md },
  identity: { flexDirection: "row", alignItems: "center", gap: spacing.sm }, avatar: { width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.sage, alignItems: "center", justifyContent: "center" },
  avatarText: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.title, fontWeight: "800" }, copy: { flex: 1, minWidth: 0 },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "800" }, meta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 19 },
  record: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: spacing.sm }, divider: { backgroundColor: colors.softLine }, pressed: { opacity: 0.68 },
});
