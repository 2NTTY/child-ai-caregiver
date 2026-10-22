import { useLayoutEffect, useRef, useState } from "react";
import { Platform, StyleSheet, View, useWindowDimensions, type ScrollView as NativeScrollView } from "react-native";
import { AppScrollView as ScrollView } from "./AppScrollView";
import { Text } from "react-native-paper";
import { AppButton, SectionCard } from "./ui";
import { chineseFont, colors, readingType, spacing, workspaceType } from "../theme";
import type { HomeActions, HomeViewModel } from "../view-model";
import { homeAgentScope } from "../home-agent-entry";
import { MobileHomeDashboard } from "./MobileHomeDashboard";
import { HomeAgentImportant } from "./HomeAgentImportant";
import { HomeOngoing } from "./HomeOngoing";
import { HomeQuickActions } from "./HomeQuickActions";
import { HomeActionSummary } from "./HomeFocus";
import { HomeTodayHeading, HomeWelcome } from "./HomeWelcome";
import { BackgroundSurface } from "./appearance/BackgroundSurface";
import { HomeGuideCallout } from "./HomeGuideCallout";

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
  const knownNoChildren = model.profileLoad === "ready" && model.children.length === 0;
  if (windowWidth < 650) return <MobileHomeDashboard model={model} actions={actions} introductionPending={introductionPending} onIntroductionPresented={onIntroductionPresented} />;
  return <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={[styles.page, windowWidth < 900 && styles.floatingInputClearance]} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    <HomeWelcome introductionPending={introductionPending} onIntroductionPresented={onIntroductionPresented} scopeKey={homeAgentScope(model) ?? model.caregiverName} />
    <BackgroundSurface padded frosted testID="home-reading-panel" style={styles.content}>
      <HomeTodayHeading />
      <HomeGuideCallout status={model.guideStatus} onOpenGuide={() => actions.open("guide")} onOpenSettings={() => actions.open("settings")} />
      {knownNoChildren && model.guideStatus === "complete" ? <SectionCard><Text style={styles.rowTitle}>先建立第一位孩子的檔案</Text><Text style={styles.meta}>只填已知資料；未知及約數都可以如實保留。</Text><AppButton label="建立孩子檔案" onPress={() => actions.open("profile")} /></SectionCard> : null}
      <View testID="desktop-home-grid" style={[styles.grid, stacked && styles.gridStack]}>
        <View testID="home-ongoing-column" style={[styles.column, styles.mainColumn, stacked && styles.stackedColumn]}>
          <HomeAgentImportant model={model} actions={actions} />
          <HomeOngoing model={model} actions={actions} />
          {windowWidth >= 900 ? <HomeQuickActions model={model} actions={actions} /> : null}
        </View>
        <View testID="home-actions-column" style={[styles.column, styles.summaryColumn, stacked && styles.stackedColumn]}>
          <HomeActionSummary model={model} actions={actions} />
        </View>
      </View>
    </BackgroundSurface>
  </ScrollView>;
}
const styles = StyleSheet.create({
  scroll: { flex: 1 }, page: { width: "100%", maxWidth: 1160, alignSelf: "center", padding: spacing.xl },
  floatingInputClearance: { paddingBottom: 88 }, content: { gap: spacing.lg },
  grid: { flexDirection: "row", alignItems: "flex-start", gap: spacing.xl }, gridStack: { flexDirection: "column" },
  column: { flex: 1, minWidth: 0, width: "100%", gap: spacing.lg }, mainColumn: { flex: 2 },
  summaryColumn: { paddingTop: spacing.xs },
  stackedColumn: { flexGrow: 0, flexShrink: 0, flexBasis: "auto" },
  rowTitle: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.row, fontWeight: "700" }, meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
});
