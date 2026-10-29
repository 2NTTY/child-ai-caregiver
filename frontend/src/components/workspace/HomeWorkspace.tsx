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
import { RouteTextLink } from "../RouteTextLink";
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
      <Text accessibilityRole="header" {...(Platform.OS === "web" ? { "aria-level": 1 } : {})} style={styles.title}>今天</Text>
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
      <Text accessibilityRole="header" aria-level={2} style={styles.sectionTitle}>先加一位孩子</Text>
      <Text style={styles.body}>只需基本身份；生日或其他資料未知也可以開始。</Text>
      <View style={styles.action}><RouteTextLink href="/profile" scopeKey={state.scopeKey ?? null} label="建立孩子檔案" emphasis="primary" style={styles.primaryLink}><Text style={styles.primaryLabel}>建立孩子檔案</Text></RouteTextLink><RouteTextLink href="/guide" scopeKey={state.scopeKey ?? null} label="查看使用說明" /></View>
    </View> : null}
  </View>;
}

function Start() {
  const { state } = useHome();
  if (!state.children.some(child => child.id === state.selectedChildId)) return null;
  return <View testID="home-workspace-start" style={styles.assistant}>
    <View style={styles.actionRow}>
      <RouteTextLink href="/chat" scopeKey={state.scopeKey ?? null} label="問助手" emphasis="primary" style={styles.primaryLink}><Text style={styles.primaryLabel}>問助手</Text><AppIcon name="arrow-right" size={18} color={colors.white} importantForAccessibility="no" /></RouteTextLink>
      <RouteTextLink href="/care?compose=note" scopeKey={state.scopeKey ?? null} label="直接記低" style={styles.secondaryLink}><Text style={styles.secondaryLabel}>直接記低</Text></RouteTextLink>
    </View>
  </View>;
}
function Signals() { const { state, actions } = useHome(); return <HomeAgentImportant model={state} actions={actions} />; }
function Ongoing() { const { state, actions } = useHome(); return <HomeOngoing model={state} actions={actions} />; }
function Agenda() { const { state, actions } = useHome(); return <HomeActionSummary model={state} actions={actions} />; }
export const HomeWorkspace = { Provider, Brief, Setup, Start, Signals, Ongoing, Agenda };
const styles = StyleSheet.create({
  brief: { width: "100%", minWidth: 0, flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.lg },
  briefCopy: { flexGrow: 1, flexShrink: 1, flexBasis: 260, minWidth: 0, gap: spacing.sm },
  eyebrow: { fontFamily: chineseFont, color: colors.teal, fontSize: 14, lineHeight: 22, fontWeight: "700" },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: 24, lineHeight: 32, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.muted, ...readingType.body },
  meta: { fontFamily: chineseFont, color: colors.muted, fontSize: 14, lineHeight: 22 },
  readStatus: { maxWidth: "100%", gap: spacing.xs, alignItems: "flex-start" },
  setup: { gap: spacing.lg }, childSetup: { backgroundColor: colors.white, padding: spacing.lg, gap: spacing.sm },
  assistant: { minWidth: 0 },
  sectionHeading: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  sectionTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: 18, lineHeight: 28, fontWeight: "700" },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  primaryLink: { minHeight: 48, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 8, backgroundColor: colors.deepTeal },
  primaryLabel: { fontFamily: chineseFont, color: colors.white, fontSize: 16, lineHeight: 26, fontWeight: "700" },
  secondaryLink: { minHeight: 48, paddingHorizontal: 16, borderRadius: 8, borderWidth: 1, borderColor: colors.controlOutline },
  secondaryLabel: { fontFamily: chineseFont, color: colors.ink, fontSize: 16, lineHeight: 26, fontWeight: "600" },
  action: { alignSelf: "flex-start", maxWidth: "100%" },
});
