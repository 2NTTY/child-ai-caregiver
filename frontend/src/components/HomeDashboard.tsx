import { Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import { AppScrollView } from "./AppScrollView";
import { HomeWorkspace } from "./workspace/HomeWorkspace";
import type { HomeActions, HomeViewModel } from "../view-model";

export function HomeDashboard({ model, actions, introductionPending = false, onIntroductionPresented }: {
  model: HomeViewModel; actions: HomeActions; introductionPending?: boolean; onIntroductionPresented?: () => void;
}) {
  const { width } = useWindowDimensions(), columns = width >= 1280;
  return <AppScrollView testID="home-scroll" style={styles.scroll} contentContainerStyle={[styles.page, width < 650 && styles.compact]} keyboardShouldPersistTaps="handled">
    <HomeWorkspace.Provider model={model} actions={actions} introductionPending={introductionPending} onIntroductionPresented={onIntroductionPresented}>
      <View testID="home-reading-panel" role="region" accessibilityLabel="今天" tabIndex={-1} style={styles.workbench}
        {...(Platform.OS === "web" ? { dataSet: { pageSurface: "true" } } : {})}>
        <HomeWorkspace.Brief />
        <HomeWorkspace.Setup />
        <HomeWorkspace.Signals />
        <HomeWorkspace.Start />
        <View testID="desktop-home-grid" style={[styles.grid, columns && styles.columns]}>
          <View testID="home-actions-column" style={[styles.agenda, columns && styles.agendaWide]}><HomeWorkspace.Agenda /></View>
          <View testID="home-ongoing-column" style={[styles.ongoing, columns && styles.ongoingWide]}><HomeWorkspace.Ongoing /></View>
        </View>
      </View>
    </HomeWorkspace.Provider>
  </AppScrollView>;
}
const styles = StyleSheet.create({
  scroll: { flex: 1, minHeight: 0 }, page: { width: "100%", maxWidth: 1200, alignSelf: "center", padding: 32, paddingBottom: 32 }, compact: { padding: 16, paddingBottom: 24 },
  workbench: { minWidth: 0, gap: 24 }, grid: { gap: 24 }, columns: { flexDirection: "row", alignItems: "flex-start", gap: 32 },
  agenda: { minWidth: 0 }, agendaWide: { flex: 2 }, ongoing: { minWidth: 0 }, ongoingWide: { flex: 1 },
});
