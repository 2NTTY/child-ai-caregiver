import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { chineseFont, colors, readingType, spacing } from "../theme";

/** Page orientation only. Domain state and actions remain owned by the caller. */
export function PageHeading({ title, description, eyebrow, actions, compact = false }: {
  title: string; description?: string; eyebrow?: string; actions?: ReactNode; compact?: boolean;
}) {
  return <View style={styles.row}>
    <View style={styles.copy}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <Text accessibilityRole="header" aria-level={1} style={[styles.title, compact && styles.compactTitle]}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
    </View>
    {actions ? <View style={styles.actions}>{actions}</View> : null}
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", columnGap: spacing.xl, rowGap: spacing.md, minWidth: 0, paddingBottom: spacing.sm },
  copy: { flexGrow: 1, flexShrink: 1, minWidth: 0, gap: spacing.xs },
  title: { fontFamily: chineseFont, fontSize: 28, lineHeight: 38, fontWeight: "700", color: colors.ink },
  compactTitle: { fontSize: 26, lineHeight: 36 },
  eyebrow: { fontFamily: chineseFont, color: colors.teal, fontSize: 13, lineHeight: 20, fontWeight: "700" },
  description: { fontFamily: chineseFont, color: colors.muted, ...readingType.body, maxWidth: 760 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm, minWidth: 0, maxWidth: "100%" },
});
