import { StyleSheet, View } from "react-native";
import { AppScrollView as ScrollView } from "./AppScrollView";
import { Text } from "react-native-paper";
import type { HomeActions, HomeViewModel } from "../view-model";
import { homeAgentScope } from "../home-agent-entry";
import { chineseFont, colors, mobileLayout, mobileType } from "../theme";
import { AppButton, SectionCard } from "./ui";
import { HomeAgentImportant } from "./HomeAgentImportant";
import { HomeOngoing } from "./HomeOngoing";
import { HomeActionSummary } from "./HomeFocus";
import { HomeTodayHeading, HomeWelcome } from "./HomeWelcome";
import { HomeGuideCallout } from "./HomeGuideCallout";

export function MobileHomeDashboard({ model, actions, introductionPending = false, onIntroductionPresented }: {
  model: HomeViewModel; actions: HomeActions; introductionPending?: boolean; onIntroductionPresented?: () => void;
}) {
  const knownNoChildren = model.profileLoad === "ready" && model.children.length === 0;
  return <View style={styles.root}><ScrollView testID="mobile-home-scroll" style={styles.scroll} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <HomeWelcome compact introductionPending={introductionPending} onIntroductionPresented={onIntroductionPresented} scopeKey={homeAgentScope(model) ?? model.caregiverName} />
    <View style={styles.content}>
      <HomeTodayHeading />
      <HomeGuideCallout status={model.guideStatus} onOpenGuide={() => actions.open("guide")} onOpenSettings={() => actions.open("settings")} />
      {knownNoChildren && model.guideStatus === "complete" ? <SectionCard testID="mobile-child-setup">
        <Text style={styles.title}>先建立第一位孩子的檔案</Text>
        <Text style={styles.body}>只填已知資料；未知及約數都可以如實保留。</Text>
        <AppButton label="查看子女檔案" onPress={() => actions.open("profile")} />
      </SectionCard> : null}
      <HomeAgentImportant model={model} actions={actions} />
      <HomeOngoing model={model} actions={actions} />
      <HomeActionSummary model={model} actions={actions} />
    </View>
  </ScrollView></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, backgroundColor: colors.canvas },
  scroll: { flex: 1, minHeight: 0, backgroundColor: colors.canvas },
  page: { padding: mobileLayout.pageInset, paddingBottom: 88, width: "100%", maxWidth: mobileLayout.breakpoint, alignSelf: "center" },
  content: { gap: mobileLayout.sectionGap },
  title: { fontFamily: chineseFont, color: colors.ink, ...mobileType.itemTitle, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.muted, ...mobileType.body },
});
