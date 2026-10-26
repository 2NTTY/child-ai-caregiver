import { BackgroundSurface } from "./appearance/BackgroundSurface";
import { Workspace } from "./workspace/Workspace";
import { HomeWorkspace } from "./workspace/HomeWorkspace";
import { useLayoutEffect, useRef, useState } from "react";
import { Platform, StyleSheet, View, useWindowDimensions, type ScrollView as NativeScrollView } from "react-native";
import { AppScrollView as ScrollView } from "./AppScrollView";
import { spacing } from "../theme";
import type { HomeActions, HomeViewModel } from "../view-model";
import { MobileHomeDashboard } from "./MobileHomeDashboard";

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
  if (windowWidth < 650) return <MobileHomeDashboard model={model} actions={actions} introductionPending={introductionPending} onIntroductionPresented={onIntroductionPresented} />;
  return <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={[styles.page, windowWidth < 1024 && styles.floatingInputClearance]} onLayout={event => setWidth(event.nativeEvent.layout.width)}>
    <HomeWorkspace.Provider model={model} actions={actions} introductionPending={introductionPending} onIntroductionPresented={onIntroductionPresented}>
      <BackgroundSurface padded testID="home-reading-panel" role="region" accessibilityLabel="今日" tabIndex={-1}
        {...(Platform.OS === "web" ? { dataSet: { pageSurface: "true" } } : {})}>
        <Workspace.Root title="今天的照顧">
          <Workspace.Header><HomeWorkspace.Brief /></Workspace.Header>
          <Workspace.Body>
            <HomeWorkspace.Setup />
            <HomeWorkspace.Signals />
            <View testID="desktop-home-grid" style={[styles.grid, stacked && styles.gridStack]}>
              <View testID="home-actions-column" style={[styles.column, stacked && styles.stackedColumn]}><HomeWorkspace.Agenda /></View>
              <View testID="home-ongoing-column" style={[styles.column, stacked && styles.stackedColumn]}><HomeWorkspace.Ongoing /></View>
            </View>
            {windowWidth >= 1024 ? <HomeWorkspace.Capture /> : <HomeWorkspace.Start />}
          </Workspace.Body>
        </Workspace.Root>
      </BackgroundSurface>
    </HomeWorkspace.Provider>
  </ScrollView>;
}
const styles = StyleSheet.create({
  scroll: { flex: 1 }, page: { width: "100%", maxWidth: 1240, alignSelf: "center", padding: spacing.xl, paddingBottom: spacing.xxl },
  floatingInputClearance: { paddingBottom: 88 },
  grid: { flexDirection: "row", alignItems: "flex-start", gap: spacing.xxl }, gridStack: { flexDirection: "column", gap: spacing.xl },
  column: { flex: 1, minWidth: 0, width: "100%" }, stackedColumn: { flexGrow: 0, flexShrink: 0, flexBasis: "auto" },
});
