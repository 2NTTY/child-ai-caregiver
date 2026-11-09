import { StyleSheet, View, type StyleProp, type ViewStyle, type TextStyle } from "react-native";
import { Text } from "react-native-paper";
import { chineseFont, colors, radius } from "../theme";
import { AppIcon, type AppIconName } from "./AppIcon";

export type AppStatusTone = "neutral" | "info" | "success" | "warning" | "error";

export interface AppStatusBadgeAppearance {
  readonly style: StyleProp<ViewStyle>; readonly labelStyle: StyleProp<TextStyle>;
  readonly tones: Readonly<Partial<Record<AppStatusTone, Readonly<{background: string; border: string; ink: string; icon: AppIconName}>>>>;
}
const tones = {
  neutral: { background: colors.neutralSurface, border: colors.line, ink: colors.muted, icon: "radiobox-blank" },
  info: { background: colors.paleTeal, border: colors.sage, ink: colors.ink, icon: "information-outline" },
  success: { background: "#E5F4EB", border: "#82B59A", ink: "#216E4E", icon: "check-circle" },
  warning: { background: colors.paleAmber, border: colors.statusWarmLine, ink: colors.warningInk, icon: "clock-outline" },
  error: { background: colors.paleCoral, border: colors.coral, ink: colors.errorInk, icon: "close" },
} as const;

// Callers map domain states explicitly; an accepted request is not proof of delivery.
export function AppStatusBadge({ label, tone = "neutral", testID, appearance }: { label: string; tone?: AppStatusTone; testID?: string; appearance?: AppStatusBadgeAppearance }) {
  const palette = appearance?.tones[tone] ?? tones[tone];
  return <View testID={testID} style={[appearance ? appearance.style : styles.badge, { backgroundColor: palette.background, borderColor: palette.border }]}>
    <AppIcon name={palette.icon} size={13} color={palette.ink} importantForAccessibility="no" />
    <Text style={[appearance ? appearance.labelStyle : styles.label, { color: palette.ink }]}>{label}</Text>
  </View>;
}

const styles = StyleSheet.create({
  badge: { alignSelf: "flex-start", maxWidth: "100%", minWidth: 0, flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderRadius: radius.small },
  label: { fontFamily: chineseFont, fontSize: 12, lineHeight: 18, fontWeight: "700", flexShrink: 1 },
});
