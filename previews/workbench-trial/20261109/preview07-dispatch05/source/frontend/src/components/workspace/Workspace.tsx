import { createContext, useContext, type ReactNode } from "react";
import { Platform, StyleSheet, View, type ViewProps } from "react-native";
import { Text } from "react-native-paper";
import { chineseFont, colors, mobileType, spacing } from "../../theme";

// Presentation metadata only. Domain state, permission checks and mutations stay
// in the existing owners; consumers compose headers, actions and content explicitly.
type WorkspaceMeta = { title: string; compact: boolean };
const WorkspaceContext = createContext<WorkspaceMeta | null>(null);
function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("Workspace parts require Workspace.Provider");
  return value;
}
function Provider({ title, compact, children }: WorkspaceMeta & { children: ReactNode }) {
  return <WorkspaceContext.Provider value={{ title, compact }}>{children}</WorkspaceContext.Provider>;
}
function Header({ children }: { children?: ReactNode }) {
  const { compact } = useWorkspace();
  return <View testID="workspace-heading" style={[styles.header, compact && styles.compactHeader]}>{children}</View>;
}
function Heading({ description, eyebrow }: { description?: string; eyebrow?: string }) {
  const { title, compact } = useWorkspace();
  return <View style={styles.copy}>
    {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
    <Text accessibilityRole="header" {...(Platform.OS === "web" ? { "aria-level": 1 } : {})}
      style={[styles.title, compact && styles.compactTitle]}>{title}</Text>
    {description ? <Text style={[styles.description, compact && mobileType.body]}>{description}</Text> : null}
  </View>;
}
function Actions({ children }: { children: ReactNode }) {
  return <View style={styles.actions}>{children}</View>;
}
function Content({ children, style, ...props }: ViewProps) {
  return <View {...props} style={[styles.content, style]}>{children}</View>;
}
function Split({ children, style, ...props }: ViewProps) {
  const { compact } = useWorkspace();
  return <View {...props} style={[styles.split, compact && styles.stacked, style]}>{children}</View>;
}
function Main({ children, style, ...props }: ViewProps) {
  const { compact } = useWorkspace();
  return <View {...props} style={[styles.main, compact && styles.mainStacked, style]}>{children}</View>;
}
function Aside({ children, style, ...props }: ViewProps) {
  const { compact } = useWorkspace();
  return <View {...props} style={[styles.aside, compact && styles.asideStacked, style]}>{children}</View>;
}
export const Workspace = { Provider, Header, Heading, Actions, Content, Split, Main, Aside };

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", columnGap: spacing.xl, rowGap: spacing.md, paddingBottom: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.line },
  compactHeader: { paddingBottom: spacing.lg, alignItems: "flex-start" },
  copy: { flex: 1, minWidth: 180, gap: spacing.sm },
  title: { fontFamily: chineseFont, fontSize: 30, lineHeight: 40, fontWeight: "700", color: colors.ink, letterSpacing: -0.5 },
  compactTitle: { fontSize: 24, lineHeight: 32 },
  description: { maxWidth: 660, fontFamily: chineseFont, fontSize: 14, lineHeight: 23, color: colors.muted },
  eyebrow: { fontFamily: chineseFont, fontSize: 12, lineHeight: 18, color: colors.muted },
  actions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm, maxWidth: "100%" },
  content: { minWidth: 0, gap: spacing.xl },
  split: { flexDirection: "row", alignItems: "flex-start", gap: spacing.xl, minWidth: 0 },
  stacked: { flexDirection: "column", alignItems: "stretch" },
  main: { flex: 1, minWidth: 0, width: "100%", gap: spacing.xl },
  mainStacked: { flex: undefined, flexGrow: 0, flexShrink: 0, flexBasis: "auto" },
  aside: { width: 300, flexShrink: 0, gap: spacing.lg },
  asideStacked: { width: "100%", flexShrink: 1 },
});
