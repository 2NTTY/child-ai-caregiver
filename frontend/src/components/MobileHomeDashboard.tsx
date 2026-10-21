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
import { HomeBackdrop } from "./appearance/HomeBackdrop";
import { useBackground } from "../preview/BackgroundContext";
import { HomeGuideCallout } from "./HomeGuideCallout";

export function MobileHomeDashboard({ model, actions, introductionPending = false, onIntroductionPresented }: {
  model: HomeViewModel; actions: HomeActions; introductionPending?: boolean; onIntroductionPresented?: () => void;
}) {
  const customBackground = !!useBackground().selected;
  const knownNoChildren = model.profileLoad === "ready" && model.children.length === 0;
  return <HomeBackdrop><ScrollView testID="mobile-home-scroll" style={[styles.scroll, customBackground && styles.transparent]} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <HomeWelcome compact introductionPending={introductionPending} onIntroductionPresented={onIntroductionPresented} scopeKey={homeAgentScope(model) ?? model.caregiverName} />
    <View style={[styles.content, customBackground && styles.readingSurface]}>
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
  </ScrollView></HomeBackdrop>;
}

const styles = StyleSheet.create({
  transparent: { backgroundColor: "transparent" },
  readingSurface: { backgroundColor: colors.canvas, padding: 12 },
  scroll: { flex: 1, minHeight: 0, backgroundColor: colors.canvas },
  page: { padding: mobileLayout.pageInset, paddingBottom: 88, width: "100%", maxWidth: mobileLayout.breakpoint, alignSelf: "center" },
  content: { gap: mobileLayout.sectionGap },
  title: { fontFamily: chineseFont, color: colors.ink, ...mobileType.itemTitle, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.muted, ...mobileType.body },
});
