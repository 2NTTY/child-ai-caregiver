import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Text } from "react-native-paper";
import { chineseFont, colors, spacing } from "../../theme";

/** Presentation-only slots; domain providers retain all state and actions. */
export function JournalHeading({ title, description, actions, compact = false }: { title: string; description?: string; actions?: ReactNode; compact?: boolean }) {
  return <View style={styles.heading}>
    <View style={styles.headingCopy}><Text accessibilityRole="header" aria-level={1} style={[styles.title, compact && styles.compactTitle]}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}</View>
    {actions ? <View style={styles.actions}>{actions}</View> : null}
  </View>;
}

export function JournalSection({ title, description, children, action, style, testID, level = 2 }: {
  title: string; description?: string; children: ReactNode; action?: ReactNode; level?: 2 | 3 | 4; style?: StyleProp<ViewStyle>; testID?: string;
}) {
  return <View style={[styles.section, style]} testID={testID}>
    <View style={styles.sectionHeading}><View style={styles.headingCopy}><Text accessibilityRole="header" aria-level={level} style={styles.sectionTitle}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}</View>{action}</View>
    {children}
  </View>;
}

export function JournalColumns({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.columns, style]}>{children}</View>;
}

export function JournalMain({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.main, style]}>{children}</View>;
}

export function JournalAside({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.aside, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  heading: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: spacing.lg, paddingBottom: spacing.xl },
  headingCopy: { minWidth: 0, flexShrink: 1, gap: spacing.sm },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: 34, lineHeight: 44, fontWeight: "700", letterSpacing: -0.6 },
  compactTitle: { fontSize: 26, lineHeight: 36 },
  description: { fontFamily: chineseFont, color: colors.muted, fontSize: 16, lineHeight: 26, maxWidth: 720 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, alignItems: "center", maxWidth: "100%" },
  section: { minWidth: 0, gap: spacing.lg, paddingVertical: spacing.lg },
  sectionHeading: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: 20, lineHeight: 30, fontWeight: "700" },
  columns: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xxl, alignItems: "flex-start", minWidth: 0 },
  main: { flexGrow: 2, flexBasis: 520, minWidth: 0, maxWidth: "100%", gap: spacing.lg },
  aside: { flexGrow: 1, flexBasis: 280, minWidth: 0, maxWidth: "100%", gap: spacing.lg },
});
