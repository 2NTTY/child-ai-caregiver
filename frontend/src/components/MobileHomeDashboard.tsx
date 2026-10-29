import { Platform, StyleSheet } from "react-native";
import { AppScrollView as ScrollView } from "./AppScrollView";
import type { HomeActions, HomeViewModel } from "../view-model";
import { homeAgentScope } from "../home-agent-entry";
import { mobileLayout, spacing } from "../theme";
import { HomeWelcome } from "./HomeWelcome";
import { BackgroundSurface } from "./appearance/BackgroundSurface";
import { HomeWorkspace } from "./workspace/HomeWorkspace";

// An explicit mobile composition keeps the same business source without a maze
// of responsive booleans in the domain components.
export function MobileHomeDashboard({ model, actions, introductionPending = false, onIntroductionPresented }: {
  model: HomeViewModel; actions: HomeActions; introductionPending?: boolean; onIntroductionPresented?: () => void;
}) {
  return <HomeWorkspace.Provider state={model} actions={actions}>
    <ScrollView testID="mobile-home-scroll" style={styles.scroll} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <HomeWelcome compact introductionPending={introductionPending} onIntroductionPresented={onIntroductionPresented} scopeKey={homeAgentScope(model) ?? model.caregiverName} childName={model.children.find(child => child.id === model.selectedChildId)?.displayName} />
      <BackgroundSurface padded frosted testID="home-reading-panel" style={styles.content} role="region" accessibilityLabel="今日" tabIndex={-1}
        {...(Platform.OS === "web" ? { dataSet: { pageSurface: "true" } } : {})}>
        <HomeWorkspace.Setup /><HomeWorkspace.Important /><HomeWorkspace.Capture /><HomeWorkspace.Tasks /><HomeWorkspace.Ongoing /><HomeWorkspace.Shortcuts />
      </BackgroundSurface>
    </ScrollView>
  </HomeWorkspace.Provider>;
}
const styles = StyleSheet.create({
  scroll: { flex: 1, minHeight: 0 },
  page: { padding: mobileLayout.pageInset, paddingTop: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm, width: "100%", maxWidth: 650, alignSelf: "center" },
  content: { gap: spacing.lg },
});
