import { Platform, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { AppScrollView as ScrollView } from "./AppScrollView";
import { chineseFont, colors, readingType, spacing } from "../theme";
import type { HomeActions, HomeViewModel } from "../view-model";
import { HomeAgentImportant } from "./HomeAgentImportant";
import { HomeOngoing } from "./HomeOngoing";
import { HomeQuickActions } from "./HomeQuickActions";
import { HomeActionSummary } from "./HomeFocus";
import { BackgroundSurface } from "./appearance/BackgroundSurface";
import { selectHomeAgentImportant, selectHomeOverview } from "../home-overview";
import { homeAgentScope } from "../home-agent-entry";
import { JournalAside, JournalColumns, JournalMain, JournalSection } from "./journal/JournalLayout";
import { RouteActionLink, RouteTextLink } from "./RouteTextLink";
import { useContainerWidth } from "./useContainerWidth";
import { ReadStateNotice } from "./ReadStateNotice";
import { AppButton } from "./ui";

export function HomeDashboard({ model, actions }: { model: HomeViewModel; actions: HomeActions }) {
  const layout = useContainerWidth(), compact = layout.width < 760;
  const child = model.children.find(item => item.id === model.selectedChildId);
  const important = selectHomeAgentImportant(model), overview = selectHomeOverview(model);
  const showImportant = (important !== null && important.state !== "unavailable" && important.state !== "unsupported") || model.operation.state !== "none";
  const knownNoChildren = model.profileLoad === "ready" && model.children.length === 0;
  const childReadFailed = !child && model.profileLoad === "error";
  const date = new Intl.DateTimeFormat("zh-HK", { timeZone: "Asia/Hong_Kong", month: "long", day: "numeric", weekday: "long" }).format(new Date());
  return <View ref={layout.ref} onLayout={layout.onLayout} style={styles.root}><ScrollView testID={compact ? "mobile-home-scroll" : "journal-home-scroll"} style={styles.scroll} contentContainerStyle={[styles.page, compact && styles.mobilePage]} keyboardShouldPersistTaps="handled">
    <BackgroundSurface frosted testID="home-reading-panel" style={[styles.content, compact && styles.compactContent]} role="region" accessibilityLabel="現在照顧" tabIndex={-1}
      {...(Platform.OS === "web" ? { dataSet: { pageSurface: "true" } } : {})}>
      <View style={styles.pageIndex}><Text style={styles.date}>{date}</Text></View>
      <View testID="home-question-entry" style={styles.opening}>
        <Text accessibilityRole="header" aria-level={1} style={[styles.title, compact && styles.mobileTitle]}>{knownNoChildren ? "先認識你正在照顧的孩子" : childReadFailed ? "先讀回孩子資料" : child ? `關於${child.displayName}，想問甚麼？` : "今天，先照顧哪一件事？"}</Text>
        {knownNoChildren || childReadFailed ? <Text style={styles.intro}>{knownNoChildren ? "一個稱呼便可以開始；未知的資料，不必急着補齊。" : "讀取失敗，不代表沒有孩子；你的原操作結果會保留。"}</Text> : null}
        {child ? <HomeQuickActions childId={child.id} scopeKey={homeAgentScope(model)} available={!!model.scopeKey || model.scopeKey === undefined && model.profileLoad === "ready"} onPhoto={actions.openAgentPhoto} />
          : knownNoChildren ? <View testID="mobile-child-setup" style={styles.setup}><RouteActionLink href="/profile" label="建立孩子檔案" /><RouteTextLink href="/guide" label="先看看如何開始" /></View>
            : childReadFailed ? <ReadStateNotice state="error" message={model.connection === "offline" ? "目前離線，未能核對可查看的孩子。恢復連線後可重新讀取。" : "暫時未能核對可查看的孩子，請重新讀取。"}>
              <AppButton label="重新讀取孩子" variant="secondary" disabled={model.connection !== "online"} onPress={actions.refresh} />
            </ReadStateNotice> : <Text accessibilityLiveRegion="polite" style={styles.meta}>正在核對可查看的孩子；你的操作結果會保留。</Text>}
      </View>
      <JournalColumns style={styles.bodyColumns}>
        <JournalMain style={styles.main}>
          {showImportant ? <JournalSection title={model.operation.state !== "none" ? "接續原來的操作" : "需要留意"}>
            <HomeAgentImportant section={important} operation={model.operation} online={model.connection === "online"} onRefresh={actions.refresh} onReviewOperation={actions.reviewOperation} onOpen={actions.open} />
          </JournalSection> : null}
          {child && overview ? <JournalSection title="接下來的安排" action={<RouteTextLink href="/tasks" label="全部待辦與預約" />}>
            <HomeActionSummary section={overview.attention} online={model.connection === "online"} onRefresh={actions.refresh} />
          </JournalSection> : null}
        </JournalMain>
        {child && overview ? <JournalAside style={styles.aside}>
          <HomeOngoing section={overview.ongoing} online={model.connection === "online"} onRefresh={actions.refresh} />
          <View style={styles.reference}><Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>孩子的手冊</Text>
            <Text style={styles.body}>先看目前概況，再按需要找回原始記錄。</Text>
            <RouteTextLink href="/summary" label="查看孩子概況" /><RouteTextLink href="/care" label="核對照顧記錄" />
          </View>
        </JournalAside> : null}
      </JournalColumns>
    </BackgroundSurface>
  </ScrollView></View>;
}
const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 0, minWidth: 0 }, scroll: { flex: 1, minHeight: 0 },
  page: { width: "100%", maxWidth: 1280, alignSelf: "center", padding: spacing.xl }, mobilePage: { padding: spacing.sm, paddingBottom: spacing.xl },
  content: { backgroundColor: colors.paper, paddingHorizontal: 36, paddingTop: spacing.lg, paddingBottom: spacing.xxl, minWidth: 0 },
  compactContent: { paddingHorizontal: spacing.lg },
  pageIndex: { flexDirection: "row", flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center", gap: spacing.sm, paddingBottom: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.line },
  date: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta, fontVariant: ["tabular-nums"] },
  opening: { paddingTop: spacing.xl, paddingBottom: spacing.xl, gap: spacing.md, minWidth: 0 },
  title: { fontFamily: chineseFont, fontSize: 34, lineHeight: 46, letterSpacing: -0.5, color: colors.ink, fontWeight: "700", maxWidth: 780 },
  mobileTitle: { fontSize: 26, lineHeight: 38 }, intro: { fontFamily: chineseFont, fontSize: 16, lineHeight: 26, color: colors.muted, maxWidth: 680 },
  setup: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, alignItems: "center" },
  bodyColumns: { borderTopWidth: 1, borderTopColor: colors.line }, main: { minWidth: 0 },
  aside: { paddingTop: spacing.lg }, reference: { gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: spacing.lg },
  sectionTitle: { fontFamily: chineseFont, fontSize: 20, lineHeight: 30, fontWeight: "700", color: colors.ink },
  body: { fontFamily: chineseFont, fontSize: 16, lineHeight: 26, color: colors.muted }, meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
});
