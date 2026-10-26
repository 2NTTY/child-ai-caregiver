import { Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import { Text } from "react-native-paper";
import { AppScrollView as ScrollView } from "./AppScrollView";
import { AppButton, SectionCard, TextLink } from "./ui";
import { chineseFont, colors, spacing } from "../theme";
import type { HomeActions, HomeViewModel } from "../view-model";
import { HomeAgentImportant } from "./HomeAgentImportant";
import { HomeOngoing } from "./HomeOngoing";
import { HomeQuickActions } from "./HomeQuickActions";
import { HomeActionSummary } from "./HomeFocus";
import { BackgroundSurface } from "./appearance/BackgroundSurface";
import { selectHomeAgentImportant } from "../home-overview";
import { AppIcon } from "./AppIcon";
import { JournalAside, JournalColumns, JournalMain, JournalSection } from "./journal/JournalLayout";

export function HomeDashboard({ model, actions }: { model: HomeViewModel; actions: HomeActions }) {
  const compact = useWindowDimensions().width < 900;
  const child = model.children.find(item => item.id === model.selectedChildId);
  const important = selectHomeAgentImportant(model);
  const showImportant = (important !== null && important.state !== "unavailable") || model.operation.state !== "none";
  const knownNoChildren = model.profileLoad === "ready" && model.children.length === 0;
  const date = new Intl.DateTimeFormat("zh-HK", { timeZone: "Asia/Hong_Kong", month: "long", day: "numeric", weekday: "long" }).format(new Date());
  return <ScrollView testID={compact ? "mobile-home-scroll" : "journal-home-scroll"} style={styles.scroll} contentContainerStyle={[styles.page, compact && styles.mobilePage]} keyboardShouldPersistTaps="handled">

    <BackgroundSurface padded frosted testID="home-reading-panel" style={styles.content} role="region" accessibilityLabel="今日" tabIndex={-1}
      {...(Platform.OS === "web" ? { dataSet: { pageSurface: "true" } } : {})}>
      <View testID="journal-home-cover" style={styles.cover}>
        <View style={styles.coverBinding}><AppIcon name="notebook-outline" size={28} color={colors.white} /></View>
        <View style={styles.coverCopy}>
          <Text style={styles.date}>{date}</Text>
          <Text accessibilityRole="header" aria-level={1} style={[styles.title, compact && styles.mobileTitle]}>{child ? `${child.displayName}的照顧筆記` : "今天的照顧筆記"}</Text>
          <Text style={styles.intro}>記低新情況，接續未完成的事。</Text>
          <HomeQuickActions model={model} actions={actions} />
        </View>
      </View>
      {knownNoChildren ? <SectionCard testID="mobile-child-setup"><Text style={styles.sectionTitle}>建立第一位孩子的檔案</Text><Text style={styles.body}>先填一個稱呼；未知資料可以稍後補充。</Text><AppButton label="建立孩子檔案" onPress={() => actions.open("profile")} /><TextLink label="先看看使用說明" onPress={() => actions.open("guide")} /></SectionCard> : null}
      <JournalColumns>
        <JournalMain style={styles.main}>
          <JournalSection title="接下來要做的事" action={<TextLink label="待辦與預約" onPress={() => actions.open("tasks")} />}>
            <HomeActionSummary model={model} actions={actions} />
          </JournalSection>
          {showImportant ? <JournalSection title="值得留意" description="助手的提醒與需要你核對的內容。">
            <HomeAgentImportant model={model} actions={actions} />
          </JournalSection> : null}
        </JournalMain>
        <JournalAside style={styles.aside}>
          <HomeOngoing model={model} actions={actions} />
          <View style={styles.reference}>
            <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>翻開照顧手冊</Text>
            <Text style={styles.body}>看清孩子的概況，或找回之前的記錄。</Text>
            <AppButton label="查看孩子概況" variant="secondary" disabled={!child} onPress={() => actions.open("summary")} />
            <TextLink label="核對照顧記錄" onPress={() => actions.open("care")} />
          </View>
        </JournalAside>
      </JournalColumns>
    </BackgroundSurface>
  </ScrollView>;
}
const styles = StyleSheet.create({
  scroll: { flex: 1, minHeight: 0 }, page: { width: "100%", maxWidth: 1280, alignSelf: "center", padding: spacing.xxl },
  mobilePage: { padding: spacing.lg, paddingBottom: spacing.xl }, content: { gap: spacing.xl },
  cover: { flexDirection: "row", backgroundColor: colors.white, borderRadius: 18, overflow: "hidden", borderWidth: 1, borderColor: colors.line, minWidth: 0 },
  coverBinding: { width: 56, backgroundColor: colors.ink, paddingTop: 28, alignItems: "center", flexShrink: 0 },
  coverCopy: { flex: 1, minWidth: 0, padding: spacing.xl, gap: spacing.sm },
  date: { fontFamily: chineseFont, fontSize: 13, lineHeight: 22, color: colors.muted },
  title: { fontFamily: chineseFont, fontSize: 38, lineHeight: 50, letterSpacing: -0.8, color: colors.ink, fontWeight: "700" },
  mobileTitle: { fontSize: 26, lineHeight: 36 },
  intro: { fontFamily: chineseFont, fontSize: 16, lineHeight: 26, color: colors.muted },
  main: { backgroundColor: colors.white, paddingHorizontal: spacing.xl, borderRadius: 12 },
  aside: { paddingTop: spacing.sm }, reference: { gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.xl },
  sectionTitle: { fontFamily: chineseFont, fontSize: 18, lineHeight: 28, fontWeight: "700", color: colors.ink },
  body: { fontFamily: chineseFont, fontSize: 14, lineHeight: 23, color: colors.muted },
});
