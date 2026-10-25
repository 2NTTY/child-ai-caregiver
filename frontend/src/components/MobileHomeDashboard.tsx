import { Workspace } from "./workspace/Workspace";
import { HomeWorkspace } from "./workspace/HomeWorkspace";
import { Platform, StyleSheet } from "react-native";
import { AppScrollView as ScrollView } from "./AppScrollView";
import { Text } from "react-native-paper";
import type { HomeActions, HomeViewModel } from "../view-model";
import { chineseFont, colors, mobileLayout, mobileType } from "../theme";
import { AppButton, SectionCard } from "./ui";
import { BackgroundSurface } from "./appearance/BackgroundSurface";
import { HomeGuideCallout } from "./HomeGuideCallout";

export function MobileHomeDashboard({ model, actions, introductionPending = false, onIntroductionPresented }: {
  model: HomeViewModel; actions: HomeActions; introductionPending?: boolean; onIntroductionPresented?: () => void;
}) {
  const knownNoChildren = model.profileLoad === "ready" && model.children.length === 0;
  return <ScrollView testID="mobile-home-scroll" style={styles.scroll} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <HomeWorkspace.Provider model={model} actions={actions} introductionPending={introductionPending} onIntroductionPresented={onIntroductionPresented}>
    <Workspace.Root title="照顧工作台"><Workspace.Header><Workspace.Heading eyebrow="今天" /></Workspace.Header><Workspace.Body>
    <BackgroundSurface padded frosted testID="home-reading-panel" style={styles.content} role="region" accessibilityLabel="今日" tabIndex={-1}
      {...(Platform.OS === "web" ? { dataSet: { pageSurface: "true" } } : {})}>
      <HomeGuideCallout status={model.guideStatus} onOpenGuide={() => actions.open("guide")} onOpenSettings={() => actions.open("settings")} />
      {knownNoChildren && model.guideStatus === "complete" ? <SectionCard testID="mobile-child-setup">
        <Text style={styles.title}>先建立第一位孩子的檔案</Text>
        <Text style={styles.body}>只填已知資料；未知及約數都可以如實保留。</Text>
        <AppButton label="查看子女檔案" onPress={() => actions.open("profile")} />
      </SectionCard> : null}
      <HomeWorkspace.Signals />
      <HomeWorkspace.Start />
      <HomeWorkspace.Ongoing />
      <HomeWorkspace.Agenda />
    </BackgroundSurface>
    </Workspace.Body></Workspace.Root></HomeWorkspace.Provider>
  </ScrollView>;
}

const styles = StyleSheet.create({
  scroll: { flex: 1, minHeight: 0 },
  page: { padding: mobileLayout.pageInset, paddingBottom: 88, width: "100%", maxWidth: mobileLayout.breakpoint, alignSelf: "center" },
  content: { gap: mobileLayout.sectionGap },
  title: { fontFamily: chineseFont, color: colors.ink, ...mobileType.itemTitle, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.muted, ...mobileType.body },
});
