import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { Text } from "react-native-paper";
import { AppIcon, type AppIconName } from "./AppIcon";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";

export function AppMenuList({ items }: { items: readonly {
  key: string; label: string; icon: AppIconName; onPress: () => void;
}[] }) {
  const { height } = useWindowDimensions();
  return <ScrollView style={{ maxHeight: Math.min(420, height * 0.54) }} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.list}>
    {items.map(item => <Pressable key={item.key} accessibilityRole="button" accessibilityLabel={item.label}
      onPress={item.onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <View style={styles.icon}><AppIcon name={item.icon} size={21} /></View>
      <Text style={styles.label}>{item.label}</Text><AppIcon name="chevron-right" size={18} color={colors.muted} />
    </Pressable>)}
  </ScrollView>;
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: { minHeight: 50, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.small, backgroundColor: colors.quietSurface },
  icon: { width: 30, alignItems: "center" },
  label: { flex: 1, minWidth: 0, color: colors.ink, fontFamily: chineseFont, fontSize: typeScale.small, fontWeight: "600", lineHeight: 22 },
  pressed: { backgroundColor: colors.selectedNav },
});
