import { createContext, useContext, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { HomeActions, HomeViewModel } from "../../view-model";
import { chineseFont, colors, radius, spacing } from "../../theme";
import { HomeAgentImportant } from "../HomeAgentImportant";
import { HomeOngoing } from "../HomeOngoing";
import { HomeActionSummary } from "../HomeFocus";
import { HomeQuickActions } from "../HomeQuickActions";
import { HomeGuideCallout } from "../HomeGuideCallout";
import { AppButton, SectionCard } from "../ui";
import { AppIcon } from "../AppIcon";
import { PreviewLink } from "../../preview/PreviewNavigationGuard";
import { navigationItems } from "../navigation/app-navigation";

type HomeContext = { state: HomeViewModel; actions: HomeActions };
const Context = createContext<HomeContext | null>(null);
function useHome() { const value = useContext(Context); if (!value) throw new Error("HomeWorkspace requires its provider"); return value; }
function Provider({ state, actions, children }: HomeContext & { children: ReactNode }) {
  return <Context.Provider value={{ state, actions }}>{children}</Context.Provider>;
}
function Setup() {
  const { state, actions } = useHome();
  return <>
    <HomeGuideCallout status={state.guideStatus} onOpenGuide={() => actions.open("guide")} onOpenSettings={() => actions.open("settings")} />
    {state.profileLoad === "ready" && state.children.length === 0 && state.guideStatus === "complete" ? <SectionCard testID="home-child-setup">
      <Text style={styles.title}>建立第一位孩子的檔案</Text><Text style={styles.detail}>先填一個稱呼，其他資料可以稍後補充。</Text>
      <AppButton label="建立孩子檔案" onPress={() => actions.open("profile")} />
    </SectionCard> : null}
  </>;
}
function Important() { const { state, actions } = useHome(); return <HomeAgentImportant model={state} actions={actions} />; }
function Ongoing() { const { state, actions } = useHome(); return <HomeOngoing model={state} actions={actions} />; }
function Tasks() { const { state, actions } = useHome(); return <HomeActionSummary model={state} actions={actions} />; }
function Capture() { const { state, actions } = useHome(); return <HomeQuickActions model={state} actions={actions} />; }
function Shortcuts() {
  const { actions } = useHome();
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  return <View style={styles.shortcuts} testID="home-workspace-shortcuts">
    <Text accessibilityRole="header" aria-level={2} style={styles.title}>常用資料</Text>
    {(["summary", "photos", "profile"] as const).map(key => {
      const link = <Pressable accessibilityRole={Platform.OS === "web" ? "link" : "button"}
      accessibilityLabel={navigationItems[key].label} onPress={Platform.OS === "web" ? undefined : () => actions.open(key)} onPressIn={() => setPressedKey(key)} onPressOut={() => setPressedKey(null)} style={StyleSheet.flatten([styles.shortcut, pressedKey === key && styles.pressed])}>
      <View style={styles.icon}><AppIcon name={navigationItems[key].icon} size={20} importantForAccessibility="no" /></View>
      <Text style={styles.label}>{navigationItems[key].label}</Text><AppIcon name="chevron-right" size={16} importantForAccessibility="no" />
    </Pressable>;
      return Platform.OS === "web" ? <PreviewLink key={key} href={navigationItems[key].href}>{link}</PreviewLink> : <View key={key}>{link}</View>;
    })}
  </View>;
}
export const HomeWorkspace = { Provider, Setup, Important, Ongoing, Tasks, Capture, Shortcuts };
const styles = StyleSheet.create({
  shortcuts: { backgroundColor: colors.white, borderWidth: 1, borderColor: colors.softLine, borderRadius: radius.medium, padding: spacing.lg, gap: spacing.sm },
  shortcut: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: spacing.md, borderRadius: radius.small },
  icon: { width: 36, height: 36, borderRadius: radius.small, backgroundColor: colors.quietSurface, justifyContent: "center", alignItems: "center" },
  label: { flex: 1, minWidth: 0, fontFamily: chineseFont, fontSize: 14, lineHeight: 22, color: colors.ink, fontWeight: "600" },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: 16, lineHeight: 24, fontWeight: "700" },
  detail: { fontFamily: chineseFont, color: colors.muted, fontSize: 14, lineHeight: 23 }, pressed: { backgroundColor: colors.quietSurface },
});
