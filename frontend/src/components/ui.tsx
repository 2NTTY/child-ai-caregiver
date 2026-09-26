import type { ReactNode } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Button, Text } from "react-native-paper";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";
import type { ConnectionState, OperationState } from "../view-model";

export function AppButton({ label, onPress, variant = "primary", disabled = false }: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "quiet";
  disabled?: boolean;
}) {
  return (
    <Button
      mode={variant === "primary" ? "contained" : variant === "secondary" ? "outlined" : "text"}
      onPress={onPress}
      disabled={disabled}
      contentStyle={styles.buttonContent}
      labelStyle={styles.buttonLabel}
      style={variant === "secondary" ? styles.outlineButton : undefined}
      accessibilityLabel={label}
    >
      {label}
    </Button>
  );
}

export function SectionCard({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <View style={styles.headerText}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>{title}</Text>
        {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
      </View>
      {action}
    </View>
  );
}

const operationLabels: Record<OperationState, string> = {
  none: "沒有待處理操作",
  needs_confirmation: "待確認",
  saving: "處理中",
  saved: "已保存",
  failed: "失敗",
  unknown: "結果未知",
};

export function OperationPill({ state }: { state: OperationState }) {
  const tone = state === "none" ? styles.neutralPill
    : state === "needs_confirmation" || state === "unknown" ? styles.amberPill
    : state === "failed" ? styles.coralPill : styles.tealPill;
  return (
    <View accessibilityRole="text" accessibilityLabel={`操作狀態：${operationLabels[state]}`} style={[styles.pill, tone]}>
      <Text style={styles.pillText}>{operationLabels[state]}</Text>
    </View>
  );
}

export function ConnectionPill({ state }: { state: ConnectionState }) {
  const label = state === "online" ? "網絡可用" : state === "offline" ? "目前離線" : "正在檢查連線";
  return (
    <View accessibilityRole="text" accessibilityLabel={label} style={[styles.pill, state === "online" ? styles.tealPill : state === "offline" ? styles.amberPill : styles.neutralPill]}>
      <View style={[styles.dot, state === "online" ? styles.tealDot : state === "offline" ? styles.amberDot : styles.neutralDot]} />
      <Text style={styles.pillText}>{label}</Text>
    </View>
  );
}

export function TextLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.link}>
      <Text style={styles.linkText}>{label}  →</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  buttonContent: { minHeight: 42, paddingHorizontal: 4 },
  buttonLabel: { fontFamily: chineseFont, fontSize: typeScale.small, fontWeight: "700" },
  outlineButton: { borderColor: colors.line },
  card: { backgroundColor: colors.white, borderColor: colors.softLine, borderWidth: 1, borderRadius: radius.large, padding: spacing.lg, gap: spacing.md },
  sectionHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md, flexWrap: "wrap" },
  headerText: { flexGrow: 1, flexShrink: 1, gap: spacing.xs },
  sectionTitle: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.title, lineHeight: 29, fontWeight: "700" },
  sectionSubtitle: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 21 },
  pill: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 6, borderRadius: radius.pill, paddingHorizontal: 11, paddingVertical: 6 },
  pillText: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.caption, lineHeight: 18, fontWeight: "700" },
  neutralPill: { backgroundColor: "#F0F3F1" },
  tealPill: { backgroundColor: colors.paleTeal },
  amberPill: { backgroundColor: colors.paleAmber },
  coralPill: { backgroundColor: colors.paleCoral },
  dot: { width: 7, height: 7, borderRadius: 4 },
  tealDot: { backgroundColor: colors.teal },
  amberDot: { backgroundColor: colors.amber },
  neutralDot: { backgroundColor: colors.muted },
  link: { minHeight: 32, justifyContent: "center" },
  linkText: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.small, lineHeight: 21, fontWeight: "700" },
});
