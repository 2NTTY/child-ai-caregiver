import type { ReactNode, Ref } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { chineseFont, colors, spacing } from "../../theme";

// Layout slots only: forms and task owners keep their existing state and commands.
export function TaskSection({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <View style={styles.section}><View style={styles.heading}><Text accessibilityRole="header" aria-level={3} style={styles.title}>{title}</Text>{description ? <Text style={styles.description}>{description}</Text> : null}</View>{children}</View>;
}
export function TaskEditorSection({ step, title, description, children }: { step: string; title: string; description?: string; children: ReactNode }) {
  return <View style={styles.editorSection}><View style={styles.editorHeading}><Text style={styles.step}>{step}</Text><View style={styles.heading}><Text accessibilityRole="header" aria-level={3} style={styles.title}>{title}</Text>{description ? <Text style={styles.description}>{description}</Text> : null}</View></View><View style={styles.fields}>{children}</View></View>;
}
export function TaskReviewPanel({ children, ref }: { children: ReactNode; ref?: Ref<View> }) { return <View ref={ref} tabIndex={-1} accessibilityLabel="核對家庭共享安排" testID="task-review-panel" style={styles.review}>{children}</View>; }
const styles = StyleSheet.create({
  section: { minWidth: 0, gap: spacing.lg, paddingTop: spacing.xl, borderTopWidth: 1, borderTopColor: colors.line },
  heading: { minWidth: 0, flexShrink: 1, gap: spacing.xs },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: 18, lineHeight: 27, fontWeight: "700" },
  description: { fontFamily: chineseFont, color: colors.muted, fontSize: 14, lineHeight: 22 },
  editorSection: { minWidth: 0, gap: spacing.lg, paddingTop: spacing.xl, borderTopWidth: 1, borderTopColor: colors.line },
  editorHeading: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, minWidth: 0 },
  step: { fontFamily: chineseFont, color: colors.teal, fontSize: 14, lineHeight: 27, fontWeight: "700", minWidth: 24 },
  fields: { minWidth: 0, gap: spacing.lg },
  review: { minWidth: 0, gap: spacing.lg, padding: spacing.lg, backgroundColor: colors.paleTeal, borderLeftWidth: 3, borderLeftColor: colors.teal },
});
