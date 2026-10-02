import { useState, type ReactNode } from "react";
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { Text } from "react-native-paper";
import { chineseFont, colors, mobileLayout, mobileType, spacing, typeScale } from "../theme";

export function PageFrame({ title, description, children, eyebrow }: { title: string; description: string; children: ReactNode; eyebrow?: string }) {
  const viewportWidth = useWindowDimensions().width;
  const [contentWidth, setContentWidth] = useState(0);
  const compact = (contentWidth || viewportWidth) < mobileLayout.breakpoint;
  return <ScrollView onLayout={event => setContentWidth(event.nativeEvent.layout.width)} style={styles.scroll} contentContainerStyle={[styles.page, compact && styles.mobilePage]} keyboardShouldPersistTaps="handled">
    <View style={styles.heading}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <Text accessibilityRole="header" style={[styles.title, compact && mobileType.heading]}>{title}</Text>
      <Text style={[styles.description, compact && mobileType.body]}>{description}</Text>
    </View>
    {children}
  </ScrollView>;
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.canvas },
  page: { width: "100%", maxWidth: 1260, alignSelf: "center", paddingHorizontal: spacing.xl, paddingVertical: spacing.xl, gap: spacing.lg },
  mobilePage: { paddingHorizontal: mobileLayout.pageInset, paddingVertical: mobileLayout.pageInset },
  heading: { gap: spacing.xs },
  eyebrow: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, fontWeight: "800" },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.heading, fontWeight: "800", lineHeight: 38 },
  description: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 23 },
});
