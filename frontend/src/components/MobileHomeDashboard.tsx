import { BackgroundSurface } from "./appearance/BackgroundSurface";
import { Workspace } from "./workspace/Workspace";
import { HomeWorkspace } from "./workspace/HomeWorkspace";
import { Platform, StyleSheet, View } from "react-native";
import { AppScrollView as ScrollView } from "./AppScrollView";
import type { HomeActions, HomeViewModel } from "../view-model";
import { mobileLayout } from "../theme";

export function MobileHomeDashboard({ model, actions, introductionPending = false, onIntroductionPresented }: {
  model: HomeViewModel; actions: HomeActions; introductionPending?: boolean; onIntroductionPresented?: () => void;
}) {
  return <ScrollView testID="mobile-home-scroll" style={styles.scroll} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <HomeWorkspace.Provider model={model} actions={actions} introductionPending={introductionPending} onIntroductionPresented={onIntroductionPresented}>
      <BackgroundSurface padded testID="home-reading-panel" role="region" accessibilityLabel="今日" tabIndex={-1}
        {...(Platform.OS === "web" ? { dataSet: { pageSurface: "true" } } : {})}>
        <Workspace.Root title="今天的照顧">
          <Workspace.Header><HomeWorkspace.Brief /></Workspace.Header>
          <Workspace.Body>
            <HomeWorkspace.Setup />
            <HomeWorkspace.Signals />
            <HomeWorkspace.Agenda />
            <HomeWorkspace.Ongoing />
            <HomeWorkspace.Start />
          </Workspace.Body>
        </Workspace.Root>
      </BackgroundSurface>
    </HomeWorkspace.Provider>
  </ScrollView>;
}
const styles = StyleSheet.create({
  scroll: { flex: 1, minHeight: 0 },
  page: { padding: mobileLayout.pageInset, paddingBottom: 88, width: "100%", maxWidth: mobileLayout.breakpoint, alignSelf: "center" },
});
