import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { AppSelect } from "../ui";
import { isKeyboardTabPress, unmodifiedTabKey, type TabKeyboardEvent } from "../tab-keyboard";
import { chineseFont, colors, readingType, spacing } from "../../theme";

/** One chapter selector on small screens; a quiet, keyboard-operable index alongside desktop controls. */
export function SettingsNavigation<T extends string>({ id, items, value, onChange, compact }: {
  id: string; items: { key: T; label: string; description?: string }[]; value: T; onChange: (value: T) => void; compact: boolean;
}) {
  const controls = useRef(new Map<T, View>()), [hovered, setHovered] = useState<T | null>(null), [focused, setFocused] = useState(value);
  useEffect(() => { setFocused(value); }, [value]);
  function move(event: TabKeyboardEvent, index: number) {
    const input = unmodifiedTabKey(event);
    if (!input) return;
    const { key, repeat } = input;
    if (key === "Enter" || key === " " || key === "Spacebar") { event.preventDefault(); if (!repeat) onChange(items[index].key); return; }
    const next = key === "ArrowDown" ? (index + 1) % items.length : key === "ArrowUp" ? (index - 1 + items.length) % items.length
      : key === "Home" ? 0 : key === "End" ? items.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    (controls.current.get(items[next].key) as unknown as HTMLElement | undefined)?.focus({ preventScroll: true });
  }
  if (compact) return <AppSelect id={`${id}-chapter-choice`} label="設定章節" value={value} options={items.map(item => ({ value: item.key, label: item.label }))} onChange={() => {}} onSelectionClosed={onChange} />;
  return <View accessibilityRole="tablist" accessibilityLabel="設定章節" aria-orientation="vertical" style={styles.directory}>
    {items.map((item, index) => <Pressable key={item.key} nativeID={`${id}-tab-${encodeURIComponent(item.key)}`}
      ref={node => { if (node) controls.current.set(item.key, node); else controls.current.delete(item.key); }}
      accessibilityRole="tab" accessibilityLabel={item.label} accessibilityState={{ selected: value === item.key }} aria-selected={value === item.key}
      aria-controls={`${id}-panel-${encodeURIComponent(item.key)}`} tabIndex={focused === item.key ? 0 : -1} onFocus={() => setFocused(item.key)} onPress={event => { if (Platform.OS !== "web" || !isKeyboardTabPress(event)) onChange(item.key); }}
      onHoverIn={() => setHovered(item.key)} onHoverOut={() => setHovered(null)}
      {...(Platform.OS === "web" ? { onKeyDown: (event: TabKeyboardEvent) => move(event, index) } : {})}
      style={({ pressed }) => [styles.item, value === item.key && styles.selected, (pressed || hovered === item.key) && styles.hovered]}>
      <Text style={[styles.label, value === item.key && styles.selectedLabel]}>{item.label}</Text>
    </Pressable>)}
  </View>;
}
const styles = StyleSheet.create({
  directory: { width: "100%", minWidth: 0, gap: spacing.xs },
  item: { minHeight: 44, justifyContent: "center", paddingVertical: spacing.sm, paddingHorizontal: spacing.md, borderLeftWidth: 3, borderLeftColor: "transparent" },
  selected: { backgroundColor: colors.paleTeal, borderLeftColor: colors.deepTeal }, hovered: { backgroundColor: colors.selectedNav },
  label: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "600" }, selectedLabel: { color: colors.deepTeal, fontWeight: "700" },
});
