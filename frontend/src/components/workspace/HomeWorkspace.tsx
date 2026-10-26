import { createContext, use, useEffect, useMemo, type ReactNode } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { HomeActions, HomeViewModel } from "../../view-model";
import { useFirstScreenReady } from "../../startup/FirstScreenGate";
import { AppButton } from "../ui";
import { AppIcon } from "../AppIcon";
import { HomeAgentImportant } from "../HomeAgentImportant";
import { HomeOngoing } from "../HomeOngoing";
import { HomeActionSummary } from "../HomeFocus";
import { HomeQuickActions } from "../HomeQuickActions";
import { ReadStateNotice } from "../ReadStateNotice";
import { chineseFont, colors, readingType, spacing } from "../../theme";

type HomeContextValue = { state: HomeViewModel; actions: HomeActions };
const HomeContext = createContext<HomeContextValue | null>(null);
function useHome() { const value = use(HomeContext); if (!value) throw new Error("Home workspace requires a Provider"); return value; }
function Provider({ model, actions, children, introductionPending, onIntroductionPresented }: {
  model: HomeViewModel; actions: HomeActions; children: ReactNode; introductionPending?: boolean; onIntroductionPresented?: () => void;
}) {
  const ready = useFirstScreenReady();
  // Consume the existing session introduction without moving the reading surface.
  useEffect(() => { if (ready && introductionPending) onIntroductionPresented?.(); }, [ready, introductionPending, onIntroductionPresented]);
  const value = useMemo(() => ({ state: model, actions }), [model, actions]);
  return <HomeContext value={value}>{children}</HomeContext>;
}

function Brief() {
  const { state } = useHome();
  const child = state.children.find(item => item.id === state.selectedChildId);
  const readLabel = state.connection === "offline" ? "目前離線，已讀取的資料可能較早"
    : state.connection === "checking" ? "正在檢查連線…"
      : null;
  return <View testID="home-daily-brief" style={styles.brief}>
    <View style={styles.briefCopy}>
      <Text style={styles.eyebrow}>照顧簡報</Text>
      <Text accessibilityRole="header" {...(Platform.OS === "web" ? { "aria-level": 1 } : {})} style={styles.title}>今天的照顧</Text>
      <Text style={styles.body}>{child ? `${child.displayName} · ${child.ageSummaryLabel ?? child.ageLabel}` : "先選擇孩子，再查看對應的照顧事項。"}</Text>
      {child?.accessRole === "viewer" ? <Text style={styles.meta}>唯讀檢視 · 目前不可修改照顧資料</Text> : null}
    </View>
    {readLabel ? <View style={styles.readStatus}><Text accessibilityLiveRegion="polite" style={styles.meta}>{readLabel}</Text></View> : null}
  </View>;
}

function Setup() {
  const { state, actions } = useHome();
  const knownNoChildren = state.profileLoad === "ready" && state.children.length === 0;
  const selected = state.children.some(child => child.id === state.selectedChildId);
  if (selected) return null;
  return <View style={styles.setup}>
    {!selected && state.profileLoad !== "ready" ? <ReadStateNotice state={state.profileLoad} message={state.profileLoad === "loading" ? "正在讀取孩子檔案…" : "暫時無法讀取孩子檔案"}>
      {state.profileLoad === "error" ? <AppButton label="重新讀取孩子檔案" variant="quiet" disabled={state.connection !== "online"} onPress={actions.refresh} /> : null}
    </ReadStateNotice> : null}
    {knownNoChildren ? <View testID="mobile-child-setup" style={styles.childSetup}>
      <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>先建立第一位孩子的檔案</Text>
      <Text style={styles.body}>只填已知資料；未知及約數都可以如實保留。</Text>
      <View style={styles.action}><AppButton label="建立孩子檔案" onPress={() => actions.open("profile")} /><AppButton label="查看使用說明" variant="quiet" onPress={() => actions.open("guide")} /></View>
    </View> : null}
  </View>;
}

// Narrow layouts already have the shell's photo/voice dock; do not mount a second picker.
function Start() {
  const { state, actions } = useHome();
  const selected = state.children.some(child => child.id === state.selectedChildId);
  return <View testID="home-workspace-start" style={styles.assistant}>
    <View style={styles.assistantCopy}>
      <View style={styles.sectionHeading}><AppIcon name="message-text-outline" color={colors.teal} size={20} importantForAccessibility="no" /><Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>育兒助手</Text></View>
      <Text style={styles.body}>{selected ? "有新情況或照顧問題？接續對話一起整理。" : "選擇孩子後，便可開始對話。"}</Text>
    </View>
    <View style={styles.action}><AppButton label="開啟育兒助手" variant="secondary" disabled={!selected} onPress={() => actions.open("chat")} /></View>
  </View>;
}
function Signals() { const { state, actions } = useHome(); return <HomeAgentImportant model={state} actions={actions} />; }
function Ongoing() { const { state, actions } = useHome(); return <HomeOngoing model={state} actions={actions} />; }
function Agenda() { const { state, actions } = useHome(); return <HomeActionSummary model={state} actions={actions} />; }
function Capture() { const { state, actions } = useHome(); return <HomeQuickActions model={state} actions={actions} />; }
export const HomeWorkspace = { Provider, Brief, Setup, Start, Signals, Ongoing, Agenda, Capture };
const styles = StyleSheet.create({
  brief: { width: "100%", minWidth: 0, flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.lg },
  briefCopy: { flexGrow: 1, flexShrink: 1, flexBasis: 260, minWidth: 0, gap: spacing.sm },
  eyebrow: { fontFamily: chineseFont, color: colors.teal, fontSize: 14, lineHeight: 22, fontWeight: "700" },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: 28, lineHeight: 38, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.muted, ...readingType.body },
  meta: { fontFamily: chineseFont, color: colors.muted, fontSize: 14, lineHeight: 22 },
  readStatus: { maxWidth: "100%", gap: spacing.xs, alignItems: "flex-start" },
  setup: { gap: spacing.lg }, childSetup: { borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white, padding: spacing.lg, gap: spacing.sm },
  assistant: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.lg, paddingTop: spacing.xl, borderTopWidth: 1, borderTopColor: colors.line },
  assistantCopy: { flexGrow: 1, flexShrink: 1, flexBasis: 280, minWidth: 0, gap: spacing.sm },
  sectionHeading: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sectionTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: 18, lineHeight: 28, fontWeight: "700" },
  action: { alignSelf: "flex-start", maxWidth: "100%" },
});
