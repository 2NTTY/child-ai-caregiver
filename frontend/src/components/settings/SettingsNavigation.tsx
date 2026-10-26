import { useRef } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { chineseFont, colors, readingType, spacing } from "../../theme";

/** The directory and chapter share the caller's tab state; no second settings owner. */
export function SettingsNavigation<T extends string>({ id, items, value, onChange, compact }: {
  id: string; items: { key: T; label: string; description?: string }[]; value: T; onChange: (value: T) => void; compact: boolean;
}) {
  const controls = useRef(new Map<T, View>());
  function move(event: { key?: string; nativeEvent?: { key?: string }; preventDefault(): void }, index: number) {
    const key = event.nativeEvent?.key ?? event.key;
    const next = key === "ArrowRight" || key === "ArrowDown" ? (index + 1) % items.length
      : key === "ArrowLeft" || key === "ArrowUp" ? (index - 1 + items.length) % items.length
        : key === "Home" ? 0 : key === "End" ? items.length - 1 : null;
    if (next === null) return;
    event.preventDefault(); onChange(items[next].key);
    (controls.current.get(items[next].key) as unknown as HTMLElement | undefined)?.focus({ preventScroll: true });
  }
  return <View accessibilityRole="tablist" accessibilityLabel="設定分類" aria-orientation="horizontal" style={styles.directory}>
    {items.map((item, index) => <Pressable key={item.key} nativeID={`${id}-tab-${encodeURIComponent(item.key)}`}
      ref={node => { if (node) controls.current.set(item.key, node); else controls.current.delete(item.key); }}
      accessibilityRole="tab" accessibilityLabel={item.label} accessibilityState={{ selected: value === item.key }} aria-selected={value === item.key}
      aria-controls={`${id}-panel-${encodeURIComponent(item.key)}`} tabIndex={value === item.key ? 0 : -1} onPress={() => onChange(item.key)}
      {...(Platform.OS === "web" ? { onKeyDown: (event: { key?: string; nativeEvent?: { key?: string }; preventDefault(): void }) => move(event, index) } : {})}
      style={({ pressed }) => [styles.item, compact && styles.compactItem, value === item.key && styles.selected, pressed && styles.pressed]}>
      <Text style={[styles.label, value === item.key && styles.selectedLabel]}>{item.label}</Text>
      {item.description ? <Text style={styles.description}>{item.description}</Text> : null}
    </Pressable>)}
  </View>;
}

const styles = StyleSheet.create({
  directory: { width: "100%", minWidth: 0, flexDirection: "row", flexWrap: "wrap", columnGap: spacing.lg, borderTopWidth: 1, borderTopColor: colors.line },
  item: { flexBasis: "21%", flexGrow: 1, minWidth: 120, minHeight: 76, gap: spacing.xs, paddingVertical: spacing.md, paddingHorizontal: spacing.sm, borderBottomWidth: 2, borderBottomColor: colors.softLine },
  compactItem: { flexBasis: "42%", minWidth: 0 },
  selected: { backgroundColor: colors.paleTeal, borderBottomColor: colors.deepTeal },
  label: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "600" },
  selectedLabel: { color: colors.deepTeal, fontWeight: "700" },
  description: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta, flexShrink: 1 },
  pressed: { backgroundColor: colors.selectedNav },
});
