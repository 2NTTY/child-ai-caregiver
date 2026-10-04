import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { HomeActions, HomeViewModel } from "../view-model";
import { chineseFont, colors, mobileIcons, mobileLayout, mobileType, radius, spacing } from "../theme";
import { AppIcon } from "./AppIcon";

const quickActions = [
  { kind: "note", label: "記錄情況", icon: "notebook-outline" },
  { kind: "photos", label: "照片記錄", icon: "image-outline" },
  { kind: "measurement", label: "身高體重", icon: "chart-bar" },
  { kind: "sleep", label: "記錄睡眠", icon: "weather-night" },
] as const;

export function HomeQuickActions({ model, actions, docked = false }: { model: HomeViewModel; actions: HomeActions; docked?: boolean }) {
  const selected = model.children.some(child => child.id === model.selectedChildId);
  return <View testID="home-quick-actions" style={[styles.section, docked && styles.docked]}>
    <Text accessibilityRole="header" style={styles.heading}>快速記錄</Text>
    <View testID="mobile-quick-actions" style={styles.grid}>{quickActions.map(item => <Pressable key={item.kind}
      accessibilityRole="button" accessibilityLabel={`快速${item.label}`} accessibilityState={{ disabled: !selected }} disabled={!selected}
      onPress={() => item.kind === "photos" ? actions.open("photos") : actions.composeCare(item.kind)}
      style={({ pressed }) => [styles.action, !selected && styles.disabled, pressed && styles.pressed]}>
      <AppIcon name={item.icon} size={mobileIcons.content} color={colors.teal} /><Text style={styles.label}>{item.label}</Text>
    </Pressable>)}</View>
  </View>;
}
const styles = StyleSheet.create({
  section: { gap: spacing.sm, padding: spacing.md, backgroundColor: colors.white, borderColor: colors.softLine, borderWidth: 1, borderRadius: radius.medium },
  docked: { flexShrink: 0, borderRadius: 0, borderWidth: 0, borderTopWidth: 1, paddingVertical: spacing.sm },
  heading: { fontFamily: chineseFont, color: colors.ink, ...mobileType.itemTitle, fontWeight: "700" },
  grid: { flexDirection: "row", gap: spacing.xs }, action: { flex: 1, minWidth: mobileLayout.touchTarget, minHeight: 64, alignItems: "center", justifyContent: "center", gap: spacing.xs,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.xs, backgroundColor: colors.quietSurface, borderRadius: radius.small },
  label: { fontFamily: chineseFont, color: colors.ink, ...mobileType.label, fontWeight: "700", textAlign: "center" },
  pressed: { opacity: 0.68 }, disabled: { opacity: 0.5 },
});
