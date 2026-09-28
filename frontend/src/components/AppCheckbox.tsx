import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { chineseFont, colors, spacing, typeScale } from "../theme";

export function AppCheckbox({ label, accessibilityLabel = label, description, checked, disabled = false, onChange, strikeThrough = false }: {
  label: string; accessibilityLabel?: string; description?: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void; strikeThrough?: boolean;
}) {
  function toggle() { if (!disabled) onChange(!checked); }
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={accessibilityLabel} accessibilityState={{ checked, disabled }} aria-checked={checked} aria-disabled={disabled}
    disabled={disabled} onPress={toggle} style={({ pressed }) => [styles.row, disabled && styles.disabled, pressed && styles.pressed]}
    {...(Platform.OS === "web" ? { onKeyDown: (event: { key?: string; nativeEvent?: { key?: string }; preventDefault: () => void }) => {
      if ((event.nativeEvent?.key ?? event.key) === " ") { event.preventDefault(); toggle(); }
    } } : {})}>
    <View aria-hidden importantForAccessibility="no-hide-descendants"><MaterialCommunityIcons name={checked ? "checkbox-marked" : "checkbox-blank-outline"} size={24} color={disabled ? colors.muted : colors.teal} /></View>
    <View style={styles.copy}><Text style={[styles.label, checked && strikeThrough && styles.completed]}>{label}</Text>{description ? <Text style={styles.description}>{description}</Text> : null}</View>
  </Pressable>;
}
const styles = StyleSheet.create({ row: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.sm }, copy: { flex: 1, minWidth: 0, gap: spacing.xs },
  label: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, lineHeight: 23 }, description: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 },
  completed: { textDecorationLine: "line-through", color: colors.muted }, pressed: { opacity: 0.68 }, disabled: { opacity: 0.5 } });
