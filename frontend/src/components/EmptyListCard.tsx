import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Text } from "react-native-paper";
import { chineseFont, colors, radius, readingType, spacing } from "../theme";
import { AppIcon, type AppIconName } from "./AppIcon";

// Successful empty results only; the owner supplies context and any existing actions.
export function EmptyListCard({ title, detail, icon, children, testID, style }: {
  title: string; detail?: string; icon?: AppIconName; children?: ReactNode; testID?: string; style?: StyleProp<ViewStyle>;
}) {
  return <View testID={testID ?? "empty-list-card"} style={[styles.card, style]}>
    <View style={styles.heading}>
      <View style={styles.icon}><AppIcon name={icon ?? "notebook-outline"} size={22} color={colors.teal} importantForAccessibility="no" /></View>
      <View style={styles.copy}><Text style={styles.title}>{title}</Text>
      {detail && detail !== title ? <Text style={styles.detail}>{detail}</Text> : null}</View>
    </View>
    {children ? <View style={styles.actions}>{children}</View> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { minWidth: 0, alignSelf: "stretch", gap: spacing.sm, padding: spacing.xl,
    backgroundColor: colors.neutralSurface, borderColor: colors.softLine, borderWidth: 1, borderRadius: radius.medium },
  heading: { flexDirection: "row", alignItems: "flex-start", gap: spacing.lg },
  icon: { width: 44, height: 44, flexShrink: 0, backgroundColor: colors.white, borderRadius: radius.small, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, minWidth: 0, gap: spacing.xs },
  actions: { alignItems: "flex-start", gap: spacing.sm },
  title: { minWidth: 0, fontFamily: chineseFont, color: colors.ink, ...readingType.body, fontWeight: "600" },
  detail: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool },
});
