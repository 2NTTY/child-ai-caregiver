import { useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { Platform, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, spacing } from "../../theme";

/** A continuous archive list; each domain retains its own entry content and owner. */
export function HistoryCardGrid({ children, testID }: { children: ReactNode; testID?: string }) {
  return <View style={styles.container} testID={testID}>{children}</View>;
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
  container: { minWidth: 0, borderTopWidth: 1, borderTopColor: colors.line },
  card: { minWidth: 0, gap: spacing.sm, paddingVertical: spacing.lg, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.line,
    borderLeftWidth: 3, borderLeftColor: "transparent", backgroundColor: colors.paper },
  highlight: { backgroundColor: colors.paleTeal }, focused: { borderLeftColor: colors.teal }, pressed: { backgroundColor: colors.paleTeal },
});
