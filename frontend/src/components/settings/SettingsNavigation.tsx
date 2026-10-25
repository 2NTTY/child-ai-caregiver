import { BackgroundSurface } from "../appearance/BackgroundSurface";
import { useRef } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { UnderlineTabs } from "../ui";
import { chineseFont, colors, radius, readingType, spacing } from "../../theme";

export function SettingsNavigation<T extends string>({ id, items, value, onChange, compact }: {
  id: string; items: { key: T; label: string }[]; value: T; onChange: (value: T) => void; compact: boolean;
}) {
  const controls = useRef(new Map<T, View>());
  if (compact) return <View style={styles.compact}><UnderlineTabs id={id} label="設定分類" items={items} value={value} onChange={onChange} /></View>;
  function move(event: { key?: string; nativeEvent?: { key?: string }; preventDefault(): void }, index: number) {
    const key = event.nativeEvent?.key ?? event.key;
    const next = key === "ArrowDown" ? (index + 1) % items.length : key === "ArrowUp" ? (index - 1 + items.length) % items.length : key === "Home" ? 0 : key === "End" ? items.length - 1 : null;
    if (next === null) return;
    event.preventDefault(); onChange(items[next].key);
    (controls.current.get(items[next].key) as unknown as HTMLElement | undefined)?.focus({ preventScroll: true });
  }
  return <BackgroundSurface frosted activeStyle={{ paddingVertical: spacing.md }} style={styles.navigation}>
    <Text style={styles.eyebrow}>設定分類</Text>
    <View accessibilityRole="tablist" accessibilityLabel="設定分類" aria-orientation="vertical" style={styles.items}>
      {items.map((item, index) => <Pressable key={item.key} nativeID={`${id}-tab-${encodeURIComponent(item.key)}`}
        ref={node => { if (node) controls.current.set(item.key, node); else controls.current.delete(item.key); }}
        accessibilityRole="tab" accessibilityLabel={item.label} accessibilityState={{ selected: value === item.key }} aria-selected={value === item.key}
        aria-controls={`${id}-panel-${encodeURIComponent(item.key)}`} tabIndex={value === item.key ? 0 : -1} onPress={() => onChange(item.key)}
        {...(Platform.OS === "web" ? { onKeyDown: (event: { key?: string; nativeEvent?: { key?: string }; preventDefault(): void }) => move(event, index) } : {})}
        style={({ pressed }) => [styles.item, value === item.key && styles.selected, pressed && (value === item.key ? styles.selectedPressed : styles.pressed)]}>
        <Text style={[styles.label, value === item.key && styles.selectedLabel]}>{item.label}</Text>
      </Pressable>)}
    </View>
    <Text style={styles.note}>孩子與家庭的共享權限，仍以目前身份核定</Text>
  </BackgroundSurface>;
}

const styles = StyleSheet.create({
  navigation: { width: 192, flexShrink: 0, gap: spacing.md, paddingVertical: spacing.md, borderRadius: radius.medium, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.softLine }, compact: { width: "100%", minWidth: 0 },
  eyebrow: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta, paddingHorizontal: spacing.md },
  items: { gap: spacing.xs }, item: { minHeight: 48, justifyContent: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.small, borderLeftWidth: 2, borderLeftColor: "transparent" },
  selected: { backgroundColor: colors.paleTeal, borderLeftColor: colors.ink }, label: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool },
  selectedLabel: { color: colors.ink, fontWeight: "700" }, note: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta, borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.md, marginHorizontal: spacing.md },
  pressed: { backgroundColor: colors.paleTeal }, selectedPressed: { backgroundColor: colors.selectedNav },
});
