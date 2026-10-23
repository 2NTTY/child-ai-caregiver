import { Children, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, radius, spacing } from "../../theme";
import { useContainerWidth } from "../useContainerWidth";

/** Layout only: each domain keeps its own card content and read owner. */
export function HistoryCardGrid({ children, testID }: { children: ReactNode; testID?: string }) {
  const layout = useContainerWidth();
  return <View ref={layout.ref} onLayout={layout.onLayout} style={styles.container} testID={testID}>
    <View style={styles.grid}>{Children.toArray(children).map(child => <View key={(child as { key?: string }).key} style={[styles.cell, layout.width >= 720 ? styles.half : styles.full]}>{child}</View>)}</View>
  </View>;
}

/** A read-only entry, not a second data store or a container around another card. */
export function HistoryEntryCard({ children, onPress, accessibilityLabel, disabled = false, selected = false, preserveFocusWhenDisabled = false, cardRef, testID, style }: {
  children: ReactNode; onPress(): void; accessibilityLabel: string; disabled?: boolean; selected?: boolean;
  /** Web-only, opt-in for an existing snapshot during a quiet read; activation stays blocked. */
  preserveFocusWhenDisabled?: boolean;
  cardRef?: Ref<View>; testID?: string; style?: StyleProp<ViewStyle>;
}) {
  const [focused, setFocused] = useState(false), [hovered, setHovered] = useState(false);
  const host = useRef<View | null>(null), preserved = useRef(false);
  const preserveWebFocus = preserveFocusWhenDisabled && Platform.OS === "web";
  useLayoutEffect(() => {
    // RN Web Pressable overwrites aria-disabled from its native disabled prop.
    // Its DOM mapper also turns boolean aria-disabled into native disabled, which
    // blurs a focused button. Only this opt-in read state needs a separate bridge.
    if (preserveWebFocus || preserved.current) {
      const target = host.current as unknown as HTMLElement | null;
      if (disabled) target?.setAttribute("aria-disabled", "true");
      else target?.removeAttribute("aria-disabled");
    }
    preserved.current = preserveWebFocus;
  });
  return <Pressable ref={node => { host.current = node; if (typeof cardRef === "function") return cardRef(node); else if (cardRef) cardRef.current = node; }} testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel}
    accessibilityState={{ disabled, selected }} aria-disabled={disabled} disabled={disabled && !preserveWebFocus} tabIndex={disabled && preserveWebFocus ? -1 : undefined} onPress={() => { if (!disabled) onPress(); }}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={({ pressed }) => [styles.card, style, (selected || hovered) && styles.highlight, focused && styles.focused, pressed && !disabled && styles.pressed]}>
    {children}
  </Pressable>;
}

const styles = StyleSheet.create({
  container: { minWidth: 0 },
  grid: { flexDirection: "row", flexWrap: "wrap", alignItems: "stretch", marginHorizontal: -spacing.sm },
  cell: { minWidth: 0, flexGrow: 0, flexShrink: 0, paddingHorizontal: spacing.sm, paddingBottom: spacing.md },
  half: { width: "50%" }, full: { width: "100%" },
  card: { flexGrow: 1, minWidth: 0, gap: spacing.sm, padding: spacing.lg, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.medium, backgroundColor: colors.controlSurface },
  highlight: { backgroundColor: colors.quietSurface }, focused: { borderColor: colors.ink }, pressed: { backgroundColor: colors.paleTeal },
});
