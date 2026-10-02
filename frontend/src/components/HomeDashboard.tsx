import { useEffect, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { ActivityIndicator, Divider, Text } from "react-native-paper";
import { AppButton, AppTextField, OperationPill, SectionCard, SectionHeader, TextLink } from "./ui";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";
import type { HomeActions, HomeRecord, HomeViewModel } from "../view-model";
import { MobileHomeDashboard } from "./MobileHomeDashboard";
import { AppIcon, type AppIconName } from "./AppIcon";

const harbourArt = require("../../assets/images/harbour-family-hero.png");
const recordIcons: Record<HomeRecord["kind"], AppIconName> = { sleep: "weather-night", feeding: "silverware-fork-knife", measurement: "chart-bar", note: "notebook-outline", appointment: "calendar-outline" };

function DashboardLink({ icon, title, detail, onPress }: { icon: AppIconName; title: string; detail: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}>
    <View style={styles.glyphFrame}><AppIcon name={icon} size={22} /></View>
    <View style={styles.rowCopy}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.micro}>{detail}</Text></View>
    <AppIcon name="arrow-right" size={18} />
  </Pressable>;
}

function Highlight({ model, actions }: { model: HomeViewModel; actions: HomeActions }) {
  const selected = model.children.find(item => item.id === model.selectedChildId);
  const state = model.operation.state;
  const title = !selected ? "先建立第一位孩子的檔案" : state === "none" ? "目前沒有待確認內容" : model.operation.title;
  const detail = !selected ? "有了孩子的稱呼，才可以把記錄放到正確的資料空間。" : state === "none" ? "有新的候選內容時，先核對原文和時間，再決定是否確認。" : model.operation.detail;
  const actionLabel = !selected ? "查看子女檔案" : state === "unknown" ? "查核原操作" : state === "needs_confirmation" ? "查看待確認內容" : state === "failed" ? "返回原操作" : "查看照顧記錄";
  const tone = state === "unknown" ? styles.highlightUnknown : state === "failed" ? styles.highlightFailed : state === "needs_confirmation" ? styles.highlightConfirmation : undefined;
  return <SectionCard style={tone}>
    <View style={styles.highlightTop}><View style={styles.rowCopy}><Text style={styles.eyebrow}>{state === "none" || state === "needs_confirmation" ? "需要你確認" : "最近操作"}</Text><Text accessibilityRole="header" style={styles.highlightTitle}>{title}</Text></View>{selected && state !== "none" ? <OperationPill state={state} /> : null}</View>
    <Text accessibilityLiveRegion="polite" style={styles.body}>{detail}</Text>
    <View style={styles.actions}>{state === "saving" ? <ActivityIndicator color={colors.teal} /> : <AppButton label={actionLabel} onPress={() => {
      if (!selected) actions.open("profile");
      else if (["unknown", "needs_confirmation", "failed"].includes(state)) actions.reviewOperation();
      else actions.open("care");
    }} />}{state === "unknown" ? <Text style={styles.micro}>正式操作須以原 opId 查核，不可自動重送。</Text> : null}</View>
  </SectionCard>;
}

function DataOverview({ model, actions }: { model: HomeViewModel; actions: HomeActions }) {
  const child = model.children.find(item => item.id === model.selectedChildId);
  const count = model.records.filter(item => item.childId === model.selectedChildId).length;
  return <SectionCard>
    <SectionHeader title="資料概況" action={<TextLink label="查看照顧記錄" onPress={() => actions.open("care")} />} />
    <DashboardLink icon="file-document-outline" title="最近已確認記錄" detail={model.recordsLoad === "loading" ? "正在讀取記錄" : `只計已載入的 ${count} 項記錄`} onPress={() => actions.open("care")} />
    <DashboardLink icon="account-child-outline" title="孩子檔案" detail={child ? `${child.displayName} · ${child.ageLabel} · ${child.profileConfirmed ? "已確認" : "待核對"}` : "尚未有孩子"} onPress={() => actions.open("profile")} />
    <DashboardLink icon="history" title="最近操作" detail={model.operation.title} onPress={() => model.operation.state === "none" ? actions.open("care") : actions.reviewOperation()} />
  </SectionCard>;
}

function RecordRow({ item, onPress }: { item: HomeRecord; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={`查看${item.title}，${item.detail}`} onPress={onPress} style={({ pressed }) => [styles.recordRow, pressed && styles.pressed]}>
    <View style={styles.glyphFrame}><AppIcon name={recordIcons[item.kind]} size={22} /></View>
    <View style={styles.rowCopy}><View style={styles.rowHeading}><Text numberOfLines={1} style={styles.rowTitle}>{item.title}</Text><Text style={styles.confirmed}>已確認</Text></View><Text numberOfLines={2} style={styles.body}>{item.detail}</Text><Text style={styles.micro}>{item.eventTimeLabel} · {item.confirmedAtLabel}加入</Text></View>
    <AppIcon name="chevron-right" size={18} />
  </Pressable>;
}

function RecentRecords({ model, actions }: { model: HomeViewModel; actions: HomeActions }) {
  const [query, setQuery] = useState("");
  useEffect(() => setQuery(""), [model.selectedChildId]);
  const selected = model.children.find(item => item.id === model.selectedChildId);
  const recent = model.records.filter(item => item.childId === model.selectedChildId);
  const filtered = recent.filter(item => `${item.title} ${item.detail}`.toLocaleLowerCase("zh-HK").includes(query.trim().toLocaleLowerCase("zh-HK")));
  return <SectionCard>
    <SectionHeader title="最近加入的已確認記錄" subtitle={model.lastReadLabel ? `最後讀取：${model.lastReadLabel}` : "只顯示已載入的記錄"} action={selected ? <TextLink label="查看記錄頁" onPress={() => actions.open("care")} /> : undefined} />
    {model.connection === "offline" ? <View style={styles.warning}><Text style={styles.warningText}>目前離線；以下可能是較早讀取的資料，不能當作最新狀態。</Text></View> : null}
    {selected && model.recordsLoad === "ready" && recent.length > 0 ? <AppTextField dense label="篩選下方已載入的記錄" value={query} onChangeText={setQuery} accessibilityLabel="篩選下方已載入的記錄" /> : null}
    {!selected ? <Text style={styles.body}>選擇或建立孩子後，這裏會顯示相應記錄。</Text> : model.recordsLoad === "loading" ? <View style={styles.loading}><ActivityIndicator color={colors.teal} /><Text style={styles.body}>正在讀取已確認記錄…</Text></View> : model.recordsLoad === "error" ? <View style={styles.loading}><Text style={styles.body}>暫時讀不到記錄，尚未能確認最新資料。</Text><AppButton label="重新讀取" variant="secondary" onPress={actions.refresh} disabled={model.connection !== "online"} /></View> : filtered.length === 0 ? <Text style={styles.body}>{query ? "這幾項已載入記錄中沒有符合的內容。" : "目前沒有已確認的照顧記錄。"}</Text> : filtered.map((item, index) => <View key={item.id}>{index > 0 ? <Divider style={styles.divider} /> : null}<RecordRow item={item} onPress={() => actions.open("care")} /></View>)}
    <Text style={styles.micro}>按加入時間顯示；事件發生時間可以不同。候選內容不列作已確認。</Text>
  </SectionCard>;
}

export function HomeDashboard({ model, actions }: { model: HomeViewModel; actions: HomeActions }) {
  const { width: windowWidth } = useWindowDimensions();
  const [width, setWidth] = useState(900);
  const stacked = Math.min(width, windowWidth) < 760;
  const needsGuide = model.guideStatus === "first_login" || model.guideStatus === "incomplete";
  if (windowWidth < 650) return <MobileHomeDashboard model={model} actions={actions} />;
  return <ScrollView style={styles.scroll} contentContainerStyle={styles.page} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    <View style={[styles.introCard, stacked && styles.introStack]}>
      <View style={styles.introText}><Text style={styles.eyebrow}>育伴港 · 照顧整理空間</Text><Text accessibilityRole="header" style={styles.introTitle}>把每天的細節，慢慢整理清楚。</Text><Text style={styles.body}>結合孩子的已確認資料與可靠來源，幫你看清目前狀態，再決定下一步。</Text><View style={[styles.actions, windowWidth < 360 && styles.actionsNarrow]}><AppButton label={needsGuide ? "前往使用引導" : "進行對話"} onPress={() => actions.open(needsGuide ? "guide" : "chat")} /><AppButton label="查看照顧記錄" variant="secondary" onPress={() => actions.open("care")} /></View></View>
      <Image source={harbourArt} resizeMode="cover" accessibilityLabel="照顧者與孩子在香港海旁同行" style={[styles.introArt, stacked && styles.introArtStack]} />
    </View>
    <View style={[styles.grid, stacked && styles.gridStack]}>
      <View style={styles.column}><DataOverview model={model} actions={actions} /><RecentRecords model={model} actions={actions} /></View>
      <View style={styles.column}><Highlight model={model} actions={actions} /><SectionCard><SectionHeader title="常用入口" subtitle="從已掌握的資料繼續。" /><DashboardLink icon="message-text-outline" title="基本聊天" detail="整理需要討論的問題" onPress={() => actions.open("chat")} /><DashboardLink icon="notebook-outline" title="照顧記錄" detail="查看已確認的內容" onPress={() => actions.open("care")} /><DashboardLink icon="account-group-outline" title="家庭協調" detail="查看成員與共享範圍" onPress={() => actions.open("family")} /></SectionCard></View>
    </View>
    <Text style={styles.footer}>育伴港 · 用資料陪伴成長</Text>
  </ScrollView>;
}

const styles = StyleSheet.create({
  scroll: { flex: 1 }, page: { width: "100%", maxWidth: 1260, alignSelf: "center", paddingHorizontal: spacing.xl, paddingVertical: spacing.xl, gap: spacing.lg },
  pressed: { opacity: 0.68 },
  introCard: { minHeight: 235, backgroundColor: colors.paper, borderRadius: radius.large, overflow: "hidden", flexDirection: "row", borderWidth: 1, borderColor: colors.softLine },
  introStack: { flexDirection: "column-reverse" },
  introText: { flex: 1, minWidth: 0, padding: spacing.xl, justifyContent: "center", gap: spacing.md },
  introArt: { width: "38%", height: 235, minHeight: 235 }, introArtStack: { width: "100%", height: 135, minHeight: 135 },
  eyebrow: { fontFamily: chineseFont, color: colors.teal, fontSize: typeScale.caption, fontWeight: "800" },
  introTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.heading, lineHeight: 37, fontWeight: "800" },
  body: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 22 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  actionsNarrow: { flexDirection: "column", alignItems: "stretch" },
  grid: { flexDirection: "row", alignItems: "flex-start", gap: spacing.lg }, gridStack: { flexDirection: "column" }, column: { flex: 1, minWidth: 0, width: "100%", gap: spacing.lg },
  highlightUnknown: { backgroundColor: colors.statusUnknown, borderColor: colors.statusUnknownLine }, highlightFailed: { backgroundColor: colors.paleCoral, borderColor: colors.statusFailedLine }, highlightConfirmation: { backgroundColor: colors.statusWarm, borderColor: colors.statusWarmLine },
  highlightTop: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm, flexWrap: "wrap" }, highlightTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.title, lineHeight: 29, fontWeight: "800" },
  linkRow: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.sm, borderWidth: 1, borderColor: colors.softLine, borderRadius: radius.small },
  glyphFrame: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.paleTeal, alignItems: "center", justifyContent: "center" }, glyph: { color: colors.deepTeal, fontSize: 22 },
  rowCopy: { flex: 1, minWidth: 0, gap: spacing.xs }, rowTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "800" }, micro: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 19 }, arrow: { color: colors.teal, fontSize: 23 },
  recordRow: { minHeight: 92, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm }, rowHeading: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm }, confirmed: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: 11, backgroundColor: colors.paleTeal, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.pill },
  warning: { backgroundColor: colors.paleAmber, borderRadius: radius.small, padding: spacing.md }, warningText: { fontFamily: chineseFont, color: colors.warningInk, fontSize: typeScale.small, lineHeight: 21 }, loading: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.md }, divider: { backgroundColor: colors.softLine },
  footer: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, textAlign: "center", padding: spacing.sm },
});
