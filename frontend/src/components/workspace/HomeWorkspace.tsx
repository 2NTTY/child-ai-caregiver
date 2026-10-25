import { createContext, use, useEffect, useMemo, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { HomeActions, HomeViewModel } from "../../view-model";
import { useFirstScreenReady } from "../../startup/FirstScreenGate";
import { AppButton } from "../ui";
import { AppIcon } from "../AppIcon";
import { HomeAgentImportant } from "../HomeAgentImportant";
import { HomeOngoing } from "../HomeOngoing";
import { HomeActionSummary } from "../HomeFocus";
import { HomeQuickActions } from "../HomeQuickActions";
import { chineseFont, colors, spacing } from "../../theme";

type HomeContextValue = { state: HomeViewModel; actions: HomeActions };
const HomeContext = createContext<HomeContextValue | null>(null);
function useHome() { const value = use(HomeContext); if (!value) throw new Error("Home workspace requires a Provider"); return value; }
function Provider({ model, actions, children, introductionPending, onIntroductionPresented }: {
  model: HomeViewModel; actions: HomeActions; children: ReactNode; introductionPending?: boolean; onIntroductionPresented?: () => void;
}) {
  const ready = useFirstScreenReady();
  // The workbench stays stable: consume the existing session intro without a collapsing banner.
  useEffect(() => { if (ready && introductionPending) onIntroductionPresented?.(); }, [ready, introductionPending, onIntroductionPresented]);
  const value = useMemo(() => ({ state: model, actions }), [model, actions]);
  return <HomeContext value={value}>{children}</HomeContext>;
}
function Start() {
  const { state, actions } = useHome();
  const selected = state.children.find(child => child.id === state.selectedChildId);
  return <View testID="home-workspace-start" style={styles.start}>
    <View style={styles.startCopy}><View style={styles.kicker}><AppIcon name="message-text-outline" color={colors.white} size={20} importantForAccessibility="no" /><Text style={styles.kickerText}>育兒助手</Text></View>
      <Text accessibilityRole="header" style={styles.startTitle}>從一個問題，走到清楚的下一步。</Text>
      <Text style={styles.startDetail}>討論照顧問題、整理資料、準備安排。需要採取行動時，先由你確認。</Text>
    </View>
    <View style={styles.startAction}><AppButton label="打開育兒助手" variant="accent" disabled={!selected} onPress={() => actions.open("chat")} />
      {!selected ? <Text style={styles.startDetail}>選擇孩子後開始</Text> : null}
    </View>
  </View>;
}
function Signals() { const { state, actions } = useHome(); return <HomeAgentImportant model={state} actions={actions} />; }
function Ongoing() { const { state, actions } = useHome(); return <HomeOngoing model={state} actions={actions} />; }
function Agenda() { const { state, actions } = useHome(); return <HomeActionSummary model={state} actions={actions} />; }
function Capture() { const { state, actions } = useHome(); return <HomeQuickActions model={state} actions={actions} />; }
export const HomeWorkspace = { Provider, Start, Signals, Ongoing, Agenda, Capture };
const styles = StyleSheet.create({
  start: { backgroundColor: colors.ink, borderRadius: 16, padding: 28, flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.xl },
  startCopy: { flex: 1, flexBasis: 280, minWidth: 0, gap: spacing.md },
  kicker: { flexDirection: "row", alignItems: "center", gap: spacing.sm }, kickerText: { fontFamily: chineseFont, fontSize: 13, lineHeight: 20, fontWeight: "700", color: colors.white },
  startTitle: { fontFamily: chineseFont, fontSize: 24, lineHeight: 36, fontWeight: "700", color: colors.white },
  startDetail: { fontFamily: chineseFont, fontSize: 14, lineHeight: 23, color: colors.white, opacity: .85, maxWidth: 580 },
  startAction: { maxWidth: "100%", gap: spacing.sm, alignItems: "flex-start" },
});
