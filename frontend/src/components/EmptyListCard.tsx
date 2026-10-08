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
      {icon ? <AppIcon name={icon} size={22} color={colors.muted} /> : null}
      <Text style={styles.title}>{title}</Text>
    </View>
    {detail && detail !== title ? <Text style={styles.detail}>{detail}</Text> : null}
    {children}
  </View>;
}

const styles = StyleSheet.create({
  card: { minWidth: 0, alignSelf: "stretch", gap: spacing.sm, padding: spacing.lg,
    backgroundColor: colors.neutralSurface, borderColor: colors.softLine, borderWidth: 1, borderRadius: radius.medium },
  heading: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  title: { flex: 1, minWidth: 0, fontFamily: chineseFont, color: colors.ink, ...readingType.body, fontWeight: "600" },
  detail: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool },
});
