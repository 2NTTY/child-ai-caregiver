import { useLayoutEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { Link, type Href } from "expo-router";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { colors, spacing } from "../../theme";

/** A routed archive entry; loaded content and authorization stay with the reader. */
export function HistoryEntryLink({ href, onOpen, label, selected, disabled = false, cardRef, testID, children }: {
  href: Href; onOpen(): void; label: string; selected: boolean; disabled?: boolean; cardRef?: Ref<View>; testID?: string; children: ReactNode;
}) {
  const [focused, setFocused] = useState(false), [hovered, setHovered] = useState(false);
  const unavailable = useRef(disabled); unavailable.current = disabled;
  const host = useRef<View | null>(null);
  useLayoutEffect(() => {
    // RNW Pressable overwrites aria-disabled; keep its click handler alive to block href defaults.
    if (Platform.OS !== "web") return;
    const element = host.current as unknown as HTMLElement | null;
    if (disabled) element?.setAttribute("aria-disabled", "true"); else element?.removeAttribute("aria-disabled");
    // RNW skips onPress for Alt-click and auxclick; prevent those anchor defaults too.
    const preventUnavailable = (event: Event) => { if (unavailable.current) event.preventDefault(); };
    element?.addEventListener("click", preventUnavailable, true);
    element?.addEventListener("auxclick", preventUnavailable, true);
    return () => {
      element?.removeEventListener("click", preventUnavailable, true);
      element?.removeEventListener("auxclick", preventUnavailable, true);
    };
  }, [disabled]);
  return <Link href={href} asChild onPress={event => {
    if (unavailable.current) { event.preventDefault(); return; }
    type Click = { defaultPrevented?: boolean; button?: number; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean };
    const click = event as unknown as Click & { nativeEvent?: Click };
    if (Platform.OS === "web" && [click, click.nativeEvent].some(value => value && (value.defaultPrevented || value.metaKey || value.ctrlKey || value.shiftKey || value.altKey || value.button !== undefined && value.button !== 0))) return;
    event.preventDefault(); onOpen();
  }}><Pressable ref={node => { host.current = node; if (typeof cardRef === "function") return cardRef(node); else if (cardRef) cardRef.current = node; }} testID={testID} accessibilityRole="link" accessibilityLabel={label} aria-current={selected ? "true" : undefined}
    aria-disabled={disabled} accessibilityState={{ disabled }}
    disabled={Platform.OS !== "web" && disabled}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={StyleSheet.flatten([styles.entry, (selected || hovered) && styles.highlight, focused && styles.focused])}>{children}</Pressable></Link>;
}
const styles = StyleSheet.create({
  entry: { minHeight: 80, minWidth: 0, gap: spacing.sm, paddingVertical: spacing.lg, paddingHorizontal: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.line, borderLeftWidth: 3, borderLeftColor: "transparent", backgroundColor: colors.paper },
  highlight: { backgroundColor: colors.paleTeal }, focused: { borderLeftColor: colors.teal },
});
