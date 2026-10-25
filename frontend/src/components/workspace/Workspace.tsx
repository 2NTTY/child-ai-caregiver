import { createContext, use, useMemo, type ReactNode } from "react";
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Text } from "react-native-paper";
import { chineseFont, colors, spacing } from "../../theme";
import { useContainerWidth } from "../useContainerWidth";

// Presentation context only. Domain state and commands remain with the production owners.
type WorkspaceContextValue = { state: { compact: boolean }; meta: { title: string } };
const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
function useWorkspace() {
  const value = use(WorkspaceContext);
  if (!value) throw new Error("Workspace parts require Workspace.Root");
  return value;
}
function Root({ title, children, style }: { title: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const layout = useContainerWidth();
  const compact = layout.width < 650;
  const value = useMemo(() => ({ state: { compact }, meta: { title } }), [compact, title]);
  return <WorkspaceContext value={value}><View ref={layout.ref} onLayout={layout.onLayout} style={[styles.root, style]}>{children}</View></WorkspaceContext>;
}
function Header({ children }: { children: ReactNode }) {
  const { state } = useWorkspace();
  return <View testID="workspace-header" style={[styles.header, state.compact && styles.headerCompact]}>{children}</View>;
}
function Heading({ eyebrow, description }: { eyebrow?: string; description?: string }) {
  const { state, meta } = useWorkspace();
  return <View style={styles.heading}>
    {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
    <Text accessibilityRole="header" {...(Platform.OS === "web" ? { "aria-level": 1 } : {})} style={[styles.title, state.compact && styles.compactTitle]}>{meta.title}</Text>
    {description ? <Text style={styles.description}>{description}</Text> : null}
  </View>;
}
function Actions({ children }: { children: ReactNode }) { return <View style={styles.actions}>{children}</View>; }
function Body({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) { return <View style={[styles.body, style]}>{children}</View>; }
function Section({ title, detail, children }: { title: string; detail?: string; children: ReactNode }) {
  return <View style={styles.section}><View style={styles.sectionHeading}><Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>{detail ? <Text style={styles.description}>{detail}</Text> : null}</View>{children}</View>;
}
export const Workspace = { Root, Header, Heading, Actions, Body, Section };
const styles = StyleSheet.create({
  root: { minWidth: 0, gap: spacing.xl },
  header: { minWidth: 0, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: spacing.lg, paddingBottom: spacing.xl, borderBottomWidth: 1, borderBottomColor: colors.line },
  headerCompact: { gap: spacing.md, paddingBottom: spacing.lg },
  heading: { flex: 1, flexBasis: 240, minWidth: 0, gap: spacing.sm },
  eyebrow: { color: colors.teal, fontFamily: chineseFont, fontSize: 12, lineHeight: 18, fontWeight: "700", letterSpacing: 1.4 },
  title: { color: colors.ink, fontFamily: chineseFont, fontSize: 30, lineHeight: 40, fontWeight: "700", letterSpacing: -.5 },
  compactTitle: { fontSize: 25, lineHeight: 34 },
  description: { color: colors.muted, fontFamily: chineseFont, fontSize: 14, lineHeight: 23, maxWidth: 680 },
  actions: { minWidth: 0, maxWidth: "100%", flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  body: { minWidth: 0, gap: spacing.xl }, section: { gap: spacing.lg, minWidth: 0 }, sectionHeading: { gap: spacing.xs },
  sectionTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: 18, lineHeight: 27, fontWeight: "700" },
});
