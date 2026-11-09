import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { AppSelect } from "../ui";
import { historyCategories, type HistoryCategory } from "./history-filters";
import { chineseFont, colors, radius, readingType, spacing } from "../../theme";

/** Presentation only. The history screen owns the guarded URL/category transition. */
export function HistoryCategoryNavigation({ value, compact, onChange }: { value: HistoryCategory; compact: boolean; onChange(value: HistoryCategory): void }) {
  return compact ? <AppSelect<HistoryCategory> label="歷史分類" value={value} options={historyCategories.map(item => ({ value: item.key, label: item.label }))} onChange={onChange} />
    : <View accessibilityLabel="歷史分類" style={styles.rail} testID="history-category-rail">
      <Text style={styles.caption}>查閱分類</Text>
      {historyCategories.map(item => <Pressable key={item.key} accessibilityRole="button" accessibilityLabel={`查閱${item.label}`}
        aria-pressed={value === item.key} onPress={() => onChange(item.key)} style={({ pressed }) => [styles.option, value === item.key && styles.selected, pressed && styles.pressed]}>
        <Text style={[styles.label, value === item.key && styles.selectedLabel]}>{item.label}</Text>
      </Pressable>)}
    </View>;
}
const styles = StyleSheet.create({
  rail: { minWidth: 0, gap: spacing.xs, padding: spacing.sm, borderWidth: 1, borderColor: colors.line, borderRadius: radius.medium, backgroundColor: colors.paper },
  caption: { fontFamily: chineseFont, ...readingType.meta, color: colors.muted, padding: spacing.sm },
  option: { minHeight: 48, justifyContent: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.small },
  selected: { backgroundColor: colors.paleTeal }, pressed: { backgroundColor: colors.quietSurface },
  label: { fontFamily: chineseFont, ...readingType.tool, color: colors.muted }, selectedLabel: { color: colors.deepTeal, fontWeight: "700" },
});
