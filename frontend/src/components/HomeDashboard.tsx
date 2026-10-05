import { brand } from "../branding";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, View, useWindowDimensions, type ScrollView as NativeScrollView } from "react-native";
import { AppScrollView as ScrollView } from "./AppScrollView";
import { Text } from "react-native-paper";
import { AppButton, TextLink } from "./ui";
import { chineseFont, colors, radius, readingType, spacing, workspaceType } from "../theme";
import type { HomeActions, HomeViewModel } from "../view-model";
import { MobileHomeDashboard } from "./MobileHomeDashboard";
import { AppIcon, type AppIconName } from "./AppIcon";
import { HomeBackground } from "./appearance/HomeBackground";
import { HomeAgentImportant } from "./HomeAgentImportant";
import { HomeOngoing } from "./HomeOngoing";
import { HomeQuickActions } from "./HomeQuickActions";
import { HomeActionSummary } from "./HomeFocus";

function DashboardLink({ icon, title, detail, onPress }: { icon: AppIconName; title: string; detail: string; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}>
    <AppIcon name={icon} size={22} /><View style={styles.rowCopy}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.meta}>{detail}</Text></View><AppIcon name="arrow-right" size={18} />
  </Pressable>;
}

export function HomeDashboard({ model, actions, introductionPending = false, onIntroductionPresented }: {
  model: HomeViewModel; actions: HomeActions; introductionPending?: boolean; onIntroductionPresented?: () => void;
}) {
  const { width: windowWidth } = useWindowDimensions();
  const scrollRef = useRef<NativeScrollView | null>(null);
  const [width, setWidth] = useState(900);
  const stacked = Math.min(width, windowWidth) < 760;
  useLayoutEffect(() => {
    if (Platform.OS !== "web" || windowWidth < 650) return;
    const viewport = (scrollRef.current as (NativeScrollView & { getScrollableNode(): HTMLElement }) | null)?.getScrollableNode();
    if (viewport) setWidth(viewport.clientWidth);
  }, [windowWidth]);
  const needsGuide = model.guideStatus === "first_login" || model.guideStatus === "incomplete";
  const selected = model.children.find(child => child.id === model.selectedChildId);
  useEffect(() => { if (introductionPending) onIntroductionPresented?.(); }, [introductionPending, onIntroductionPresented]);
  if (windowWidth < 650) return <MobileHomeDashboard model={model} actions={actions} introductionPending={introductionPending} />;
  return <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.page} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    <View testID="desktop-home-banner" style={styles.introCard}>
      <HomeBackground surface={colors.paper} protectFullWidth={stacked} wideIllustration />
      <View style={[styles.introText, stacked && styles.introTextWide]}><Text style={styles.eyebrow}>今日 · {selected?.displayName ?? "照顧日常"}</Text>
        <Text accessibilityRole="header" style={styles.introTitle}>你好，{model.caregiverName}</Text>
        <Text style={styles.body}>先看重點，再安心安排今天。每個小日常，都值得好好記下。</Text>
        <View style={styles.actions}>{!selected ? <AppButton label="建立孩子檔案" onPress={() => actions.open("profile")} /> : null}
          {needsGuide ? <TextLink label="了解如何使用" onPress={() => actions.open("guide")} /> : null}</View>
      </View>
    </View>
    <HomeAgentImportant model={model} actions={actions} />
    <View testID="desktop-home-grid" style={[styles.grid, stacked && styles.gridStack]}>
      <View testID="home-ongoing-column" style={[styles.column, styles.recordsColumn, stacked && styles.stackedColumn]}><HomeOngoing model={model} actions={actions} /></View>
      <View testID="home-actions-column" style={[styles.column, styles.summaryColumn, stacked && styles.stackedColumn]}><HomeActionSummary model={model} actions={actions} /></View>
    </View>
    {windowWidth >= 900 ? <HomeQuickActions model={model} actions={actions} /> : null}
    <View style={styles.links}><DashboardLink icon="notebook-outline" title="核對照顧記錄" detail="整理結果、原文及更正歷史" onPress={() => actions.open("care")} /><DashboardLink icon="account-group-outline" title="家庭協調" detail="成員、角色與共享範圍" onPress={() => actions.open("family")} /></View>
    <Text style={styles.footer}>{brand.name} · 用資料陪伴成長</Text>
  </ScrollView>;
}
const styles = StyleSheet.create({
  scroll: { flex: 1 }, page: { width: "100%", maxWidth: 1260, alignSelf: "center", padding: spacing.xl, gap: spacing.xl }, pressed: { opacity: 0.68 },
  introCard: { minHeight: 178, backgroundColor: colors.paper, borderRadius: radius.large, overflow: "hidden", borderWidth: 1, borderColor: colors.softLine },
  introText: { width: "64%", minWidth: 0, padding: spacing.lg, justifyContent: "center", gap: spacing.sm }, introTextWide: { width: "100%" },
  eyebrow: { fontFamily: chineseFont, color: colors.teal, ...readingType.meta, fontWeight: "700" },
  introTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: 28, lineHeight: 36, fontWeight: "800" }, body: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  grid: { flexDirection: "row", alignItems: "flex-start", gap: spacing.xl }, gridStack: { flexDirection: "column" }, column: { flex: 1, minWidth: 0, width: "100%", gap: spacing.lg }, recordsColumn: { flex: 1.5 },
  summaryColumn: { paddingTop: spacing.xs }, links: { borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.sm },
  stackedColumn: { flexGrow: 0, flexShrink: 0, flexBasis: "auto" },
  linkRow: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.softLine },
  rowCopy: { flex: 1, minWidth: 0, gap: spacing.xs }, rowTitle: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.row, fontWeight: "700" }, meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  footer: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta, textAlign: "center", padding: spacing.sm },
});
