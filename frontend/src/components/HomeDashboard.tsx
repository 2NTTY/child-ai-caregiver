import { Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import { AppScrollView as ScrollView } from "./AppScrollView";
import { selectHomeOverview } from "../home-overview";
import { spacing } from "../theme";
import type { HomeActions, HomeViewModel } from "../view-model";
import { homeAgentScope } from "../home-agent-entry";
import { MobileHomeDashboard } from "./MobileHomeDashboard";
import { HomeWelcome } from "./HomeWelcome";
import { BackgroundSurface } from "./appearance/BackgroundSurface";
import { useContainerWidth } from "./useContainerWidth";
import { Workspace } from "./workspace/Workspace";
import { HomeWorkspace } from "./workspace/HomeWorkspace";

export function HomeDashboard({ model, actions, introductionPending = false, onIntroductionPresented }: {
  model: HomeViewModel; actions: HomeActions; introductionPending?: boolean; onIntroductionPresented?: () => void;
}) {
  const { width } = useWindowDimensions();
  const container = useContainerWidth();
  const overview = selectHomeOverview(model);
  const hasCompanion = !!overview?.ongoing.items.length;
  if (width < 650) return <MobileHomeDashboard model={model} actions={actions} introductionPending={introductionPending} onIntroductionPresented={onIntroductionPresented} />;
  return <View ref={container.ref} onLayout={container.onLayout} style={styles.root}>
    <HomeWorkspace.Provider state={model} actions={actions}><Workspace.Provider title="今日照顧" compact={container.width < 850}>
      <ScrollView style={styles.root} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <HomeWelcome introductionPending={introductionPending} onIntroductionPresented={onIntroductionPresented} scopeKey={homeAgentScope(model) ?? model.caregiverName} childName={model.children.find(child => child.id === model.selectedChildId)?.displayName} />
        <BackgroundSurface padded frosted testID="home-reading-panel" style={styles.content} role="region" accessibilityLabel="今日" tabIndex={-1}
          {...(Platform.OS === "web" ? { dataSet: { pageSurface: "true" } } : {})}>
          <HomeWorkspace.Setup /><HomeWorkspace.Important /><HomeWorkspace.Capture />
          <Workspace.Split testID="desktop-home-grid">
            <Workspace.Main testID="home-ongoing-column"><HomeWorkspace.Tasks />{!hasCompanion ? <><HomeWorkspace.Ongoing /><HomeWorkspace.Shortcuts /></> : null}</Workspace.Main>
            {hasCompanion ? <Workspace.Aside testID="home-actions-column"><HomeWorkspace.Ongoing /><HomeWorkspace.Shortcuts /></Workspace.Aside> : null}
          </Workspace.Split>
        </BackgroundSurface>
      </ScrollView>
    </Workspace.Provider></HomeWorkspace.Provider>
  </View>;
}
const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, minWidth: 0 },
  page: { width: "100%", maxWidth: 1320, alignSelf: "center", padding: 28, gap: spacing.lg },
  content: { gap: spacing.lg },
});
