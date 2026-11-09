import { createContext, use, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { HomeActions, HomeViewModel } from "../../view-model";
import { chineseFont, colors, radius, spacing } from "../../theme";
import { HomeAgentImportant, type HomeAgentImportantProps } from "../HomeAgentImportant";
import { HomeOngoing } from "../HomeOngoing";
import { HomeActionSummary, type HomeActionSummaryProps } from "../HomeFocus";
import { HomeQuickActions, type HomeQuickActionsProps } from "../HomeQuickActions";
import { selectHomeOverview, selectHomeAgentImportant } from "../../home-overview";
import { homeAgentScope } from "../../home-agent-entry";
import type { HomeSectionProps } from "../HomeOverviewItems";
import { AppButton } from "../ui";
import { AppIcon } from "../AppIcon";
import { PreviewLink } from "../../preview/PreviewNavigationGuard";
import { navigationItems } from "../navigation/app-navigation";

type HomeContext = {
  setup: { profileLoad: HomeViewModel["profileLoad"]; hasChildren: boolean; onOpenProfile(): void; onRefresh(): void };
  agenda: HomeActionSummaryProps; ongoing: HomeSectionProps; signals: HomeAgentImportantProps; capture: HomeQuickActionsProps;
  onOpen: HomeActions["open"];
};
const Context = createContext<HomeContext | null>(null);
function useHome() { const value = use(Context); if (!value) throw new Error("HomeWorkspace requires its provider"); return value; }
function Provider({ state, actions, children }: { state: HomeViewModel; actions: HomeActions; children: ReactNode }) {
  const overview = selectHomeOverview(state), child = state.children.find(item => item.id === state.selectedChildId);
  const sectionCommands = { connection: state.connection, onOpen: actions.open, onRefresh: actions.refresh };
  const value: HomeContext = {
    setup: { profileLoad: state.profileLoad, hasChildren: state.children.length > 0, onOpenProfile: () => actions.open("profile"), onRefresh: actions.refresh },
    agenda: { ...sectionCommands, section: overview?.attention ?? null, readOnly: child?.accessRole === "viewer" },
    ongoing: { ...sectionCommands, section: overview?.ongoing ?? null },
    signals: { ...sectionCommands, section: selectHomeAgentImportant(state), operation: state.operation, onReviewOperation: actions.reviewOperation },
    capture: { child, scopeKey: homeAgentScope(state), available: state.scopeKey !== undefined ? !!state.scopeKey : state.profileLoad === "ready", onPhoto: actions.openAgentPhoto },
    onOpen: actions.open,
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
function Setup() {
  const { setup } = useHome();
  if (setup.profileLoad === "ready" && !setup.hasChildren) return <View testID="home-child-setup" style={styles.setup}>
    <Text accessibilityRole="header" aria-level={2} style={styles.title}>先認識你要照顧的孩子</Text><Text style={styles.detail}>填一個稱呼就可開始；生日及其他資料可稍後補充。</Text>
    <AppButton label="建立孩子檔案" onPress={setup.onOpenProfile} />
  </View>;
  if (setup.profileLoad === "error") return <View style={styles.setup}><Text style={styles.detail}>暫時未能更新孩子資料，已取得的內容保留。</Text><AppButton label="重新讀取孩子資料" variant="quiet" onPress={setup.onRefresh} /></View>;
  return null;
}
function Important() { return <HomeAgentImportant {...useHome().signals} />; }
function Ongoing() { return <HomeOngoing {...useHome().ongoing} />; }
function Tasks() { return <HomeActionSummary {...useHome().agenda} />; }
function Capture() { return <HomeQuickActions {...useHome().capture} />; }
function Shortcuts() {
  const { onOpen } = useHome();
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  return <View style={styles.shortcuts} testID="home-workspace-shortcuts">
    <Text accessibilityRole="header" aria-level={2} style={styles.title}>常用資料</Text>
    {(["summary", "photos", "profile"] as const).map(key => {
      const link = <Pressable accessibilityRole={Platform.OS === "web" ? "link" : "button"}
      accessibilityLabel={navigationItems[key].label} onPress={Platform.OS === "web" ? undefined : () => onOpen(key)} onPressIn={() => setPressedKey(key)} onPressOut={() => setPressedKey(null)} style={StyleSheet.flatten([styles.shortcut, pressedKey === key && styles.pressed])}>
      <View style={styles.icon}><AppIcon name={navigationItems[key].icon} size={20} importantForAccessibility="no" /></View>
      <Text style={styles.label}>{navigationItems[key].label}</Text><AppIcon name="chevron-right" size={16} importantForAccessibility="no" />
    </Pressable>;
      return Platform.OS === "web" ? <PreviewLink key={key} href={navigationItems[key].href}>{link}</PreviewLink> : <View key={key}>{link}</View>;
    })}
  </View>;
}
export const HomeWorkspace = { Provider, Setup, Important, Ongoing, Tasks, Capture, Shortcuts };
const styles = StyleSheet.create({
  setup: { gap: spacing.sm, alignItems: "flex-start", paddingVertical: spacing.md },
  shortcuts: { borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.lg, gap: spacing.sm, minWidth: 0 },
  shortcut: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: spacing.md, borderRadius: radius.small },
  icon: { width: 36, height: 36, borderRadius: radius.small, backgroundColor: colors.quietSurface, justifyContent: "center", alignItems: "center" },
  label: { flex: 1, minWidth: 0, fontFamily: chineseFont, fontSize: 14, lineHeight: 22, color: colors.ink, fontWeight: "600" },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: 16, lineHeight: 24, fontWeight: "700" },
  detail: { fontFamily: chineseFont, color: colors.muted, fontSize: 14, lineHeight: 23 }, pressed: { backgroundColor: colors.quietSurface },
});
