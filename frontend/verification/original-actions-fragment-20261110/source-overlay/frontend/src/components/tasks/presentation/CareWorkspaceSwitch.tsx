// Extracted from pinned Care WorkspaceSwitch; only its local source appearance differs.
import { useCareManualTabControls } from "./useCareManualTabControls";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { spacing } from "../../../theme";
import { careColors as colors, careFont as chineseFont } from "./taskFilterThemes";

// A task-oriented alternative to a dense tab strip. The caller owns selection,
// navigation guards and panels; this component owns only keyboard presentation.
export function CareWorkspaceSwitch<T extends string>({ id, label, items, value, onChange }: {
  id: string; label: string; items: ReadonlyArray<{ key: T; label: string; description?: string; count?: number | string }>;
  value: T; onChange(value: T): void;
}) {
  const tabs = useCareManualTabControls(items, onChange);
  return <View accessibilityRole="tablist" accessibilityLabel={label} aria-orientation="horizontal" style={styles.choices}>
    {items.map((item, index) => <Pressable key={item.key} nativeID={`${id}-tab-${encodeURIComponent(item.key)}`}
      {...tabs.props(item.key, index)}
      accessibilityRole="tab" accessibilityLabel={item.count === undefined ? item.label : `${item.label} ${item.count}`}
      accessibilityState={{ selected: value === item.key }} aria-selected={value === item.key}
      aria-controls={`${id}-panel-${encodeURIComponent(item.key)}`} tabIndex={value === item.key ? 0 : -1}
      style={({ pressed }) => [styles.choice, value === item.key && styles.selected, pressed && styles.pressed]}>
      <View style={styles.titleRow}><Text style={[styles.title, value === item.key && styles.selectedTitle]}>{item.label}</Text>
        {item.count !== undefined ? <Text style={styles.count}>{item.count}</Text> : null}</View>
    </Pressable>)}
  </View>;
}
const styles = StyleSheet.create({
  choices: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, minWidth: 0 },
  choice: { minWidth: 44, minHeight: 44, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 0, backgroundColor: "transparent" },
  selected: { backgroundColor: colors.selectedNav },
  pressed: { backgroundColor: colors.paleTeal }, titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minWidth: 0 },
  title: { flexShrink: 1, minWidth: 0, fontFamily: chineseFont, fontSize: 16, lineHeight: 26, fontWeight: "700", color: colors.ink },
  selectedTitle: { color: colors.deepTeal }, count: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: 14, fontWeight: "700" },
  description: { fontFamily: chineseFont, fontSize: 14, lineHeight: 22, color: colors.muted },
});
