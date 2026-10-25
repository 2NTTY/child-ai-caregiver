import { useRef } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { chineseFont, colors, radius, spacing } from "../../theme";

// A task-oriented alternative to a dense tab strip. The caller owns selection,
// navigation guards and panels; this component owns only keyboard presentation.
export function WorkspaceSwitch<T extends string>({ id, label, items, value, onChange }: {
  id: string; label: string; items: ReadonlyArray<{ key: T; label: string; description?: string; count?: number | string }>;
  value: T; onChange(value: T): void;
}) {
  const controls = useRef(new Map<T, View>());
  const spaceKey = useRef<T | null>(null);
  return <View accessibilityRole="tablist" accessibilityLabel={label} aria-orientation="horizontal" style={styles.choices}>
    {items.map((item, index) => <Pressable key={item.key} nativeID={`${id}-tab-${encodeURIComponent(item.key)}`}
      ref={node => { if (node) controls.current.set(item.key, node); else controls.current.delete(item.key); }}
      accessibilityRole="tab" accessibilityLabel={item.count === undefined ? item.label : `${item.label} ${item.count}`}
      accessibilityState={{ selected: value === item.key }} aria-selected={value === item.key}
      aria-controls={`${id}-panel-${encodeURIComponent(item.key)}`} tabIndex={value === item.key ? 0 : -1}
      onPress={() => { spaceKey.current = null; onChange(item.key); }}
      onBlur={() => { if (spaceKey.current === item.key) spaceKey.current = null; }}
      {...(Platform.OS === "web" ? { onKeyDown: (event: { key: string; preventDefault(): void }) => {
        // RN Web renders role=tab as a div. Its PressResponder handles Enter,
        // but Space only activates button roles, so supply Space semantics here.
        if (event.key === " " || event.key === "Spacebar") { event.preventDefault(); spaceKey.current = item.key; return; }
        const target = event.key === "ArrowRight" ? (index + 1) % items.length : event.key === "ArrowLeft" ? (index + items.length - 1) % items.length
          : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
        if (target === null) return;
        event.preventDefault();
        // Manual activation: arrows focus; only an activation reaches the caller.
        // A deferred domain guard must never visually select an unaccepted tab.
        (controls.current.get(items[target].key) as unknown as HTMLElement | undefined)?.focus({ preventScroll: true });
      }, onKeyUp: (event: { key: string; preventDefault(): void }) => {
        if (event.key !== " " && event.key !== "Spacebar") return;
        event.preventDefault();
        const armed = spaceKey.current === item.key; spaceKey.current = null;
        if (armed) onChange(item.key);
      } } : {})}
      style={({ pressed }) => [styles.choice, value === item.key && styles.selected, pressed && styles.pressed]}>
      <View style={styles.titleRow}><Text style={[styles.title, value === item.key && styles.selectedTitle]}>{item.label}</Text>
        {item.count !== undefined ? <Text style={styles.count}>{item.count}</Text> : null}</View>
      {item.description ? <Text style={styles.description}>{item.description}</Text> : null}
    </Pressable>)}
  </View>;
}
const styles = StyleSheet.create({
  choices: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, minWidth: 0 },
  choice: { flexGrow: 1, flexBasis: 180, minWidth: 0, minHeight: 64, padding: spacing.lg, gap: spacing.xs, borderRadius: radius.small, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.white },
  selected: { borderColor: colors.teal, borderTopWidth: 3, paddingTop: spacing.lg - 2, backgroundColor: colors.paleTeal },
  pressed: { backgroundColor: colors.paleTeal }, titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minWidth: 0 },
  title: { flex: 1, minWidth: 0, fontFamily: chineseFont, fontSize: 16, lineHeight: 24, fontWeight: "700", color: colors.ink },
  selectedTitle: { color: colors.deepTeal }, count: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: 14, fontWeight: "700" },
  description: { fontFamily: chineseFont, fontSize: 14, lineHeight: 22, color: colors.muted },
});
