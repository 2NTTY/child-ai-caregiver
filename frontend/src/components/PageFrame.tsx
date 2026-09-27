import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { chineseFont, colors, spacing, typeScale } from "../theme";

export function PageFrame({ title, description, children, eyebrow }: { title: string; description: string; children: ReactNode; eyebrow?: string }) {
  return <ScrollView style={styles.scroll} contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
    <View style={styles.heading}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
    </View>
    {children}
  </ScrollView>;
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.canvas },
  page: { width: "100%", maxWidth: 1260, alignSelf: "center", paddingHorizontal: spacing.xl, paddingVertical: spacing.xl, gap: spacing.lg },
  heading: { gap: spacing.xs },
  eyebrow: { fontFamily: chineseFont, color: colors.teal, fontSize: typeScale.caption, fontWeight: "800" },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.heading, fontWeight: "800", lineHeight: 38 },
  description: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 23 },
});
