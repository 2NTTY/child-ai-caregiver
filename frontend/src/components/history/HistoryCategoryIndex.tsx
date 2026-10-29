import { useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { Link, type Href } from "expo-router";
import { chineseFont, colors, spacing } from "../../theme";
import { AppIcon } from "../AppIcon";
import { historyCategories, type HistoryCategory } from "./history-filters";

function CategoryEntry({ item, selected, href, onSelect }: {
  item: typeof historyCategories[number]; selected: boolean; href: Href; onSelect(category: HistoryCategory): void;
}) {
  const [focused, setFocused] = useState(false), [hovered, setHovered] = useState(false);
  return <Link href={href} asChild onPress={event => {
    type Click = { defaultPrevented?: boolean; button?: number; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean };
    const click = event as unknown as Click & { nativeEvent?: Click };
    if (Platform.OS === "web" && [click, click.nativeEvent].some(value => value && (value.defaultPrevented || value.metaKey || value.ctrlKey || value.shiftKey || value.altKey || value.button !== undefined && value.button !== 0))) return;
    event.preventDefault(); onSelect(item.key);
  }}><Pressable accessibilityRole="link" accessibilityLabel={`查看${item.label}歷史`} accessibilityState={{ selected }} aria-current={selected ? "true" : undefined}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={StyleSheet.flatten([styles.entry, (selected || hovered) && styles.selected, focused && styles.focused])}>
    <View style={styles.copy}><Text style={[styles.label, selected && styles.selectedLabel]}>{item.label}</Text><Text style={styles.description}>{item.description}</Text></View>
    <AppIcon name="chevron-right" size={16} color={selected ? colors.teal : colors.muted} />
  </Pressable></Link>;
}

/** Navigation only; the selected domain retains its own reader and recovery state. */
export function HistoryCategoryIndex({ value, href, onChange }: { value: HistoryCategory; href(category: HistoryCategory): Href; onChange(category: HistoryCategory): void }) {
  return <View testID="history-category-index" style={styles.index} accessibilityLabel="歷史分類">
    <Text accessibilityRole="header" aria-level={2} style={styles.heading}>查閱分類</Text>
    {historyCategories.map(item => <CategoryEntry key={item.key} item={item} selected={value === item.key} href={href(item.key)} onSelect={onChange} />)}
  </View>;
}

const styles = StyleSheet.create({
  index: { minWidth: 0 }, heading: { fontFamily: chineseFont, color: colors.ink, fontSize: 18, lineHeight: 28, fontWeight: "700", paddingBottom: spacing.md },
  entry: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 76, paddingVertical: spacing.md, paddingHorizontal: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.line, borderLeftWidth: 3, borderLeftColor: "transparent" },
  copy: { flex: 1, minWidth: 0, gap: spacing.xs }, label: { fontFamily: chineseFont, color: colors.ink, fontSize: 15, lineHeight: 24, fontWeight: "600" },
  description: { fontFamily: chineseFont, color: colors.muted, fontSize: 12, lineHeight: 19 },
  selected: { backgroundColor: colors.paleTeal }, selectedLabel: { color: colors.teal, fontWeight: "700" }, focused: { borderLeftColor: colors.teal },
});
