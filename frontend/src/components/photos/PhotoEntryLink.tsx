import { useState, type ReactNode, type Ref } from "react";
import { Platform, Pressable, StyleSheet, type View } from "react-native";
import { Link, type Href } from "expo-router";
import { colors, spacing } from "../../theme";

/** The URL is usable as a link; current-window activation waits for the photo owner. */
export function PhotoEntryLink({ href, label, selected, disabled, testID, onOpen, children, ref }: { href: Href; label: string; selected: boolean; disabled: boolean; testID: string; onOpen(): void; children: ReactNode; ref?: Ref<View> }) {
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false);
  return <Link href={href} asChild onPress={event => {
    type Click = { defaultPrevented?: boolean; button?: number; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean };
    const click = event as unknown as Click & { nativeEvent?: Click };
    if (Platform.OS === "web" && [click, click.nativeEvent].some(value => value && (value.defaultPrevented || value.metaKey || value.ctrlKey || value.shiftKey || value.altKey || value.button !== undefined && value.button !== 0))) return;
    event.preventDefault(); if (!disabled) onOpen();
  }}><Pressable ref={ref} testID={testID} accessibilityRole="link" accessibilityLabel={label} accessibilityState={{ disabled, selected }}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={StyleSheet.flatten([styles.entry, selected && styles.selected, hovered && !disabled && styles.hovered, focused && styles.focused])}>{children}</Pressable></Link>;
}
const styles = StyleSheet.create({
  entry: { minHeight: 104, minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.sm, borderWidth: 1, borderColor: "transparent", borderBottomColor: colors.line, borderLeftWidth: 3 },
  selected: { borderLeftColor: colors.ink, backgroundColor: colors.paleTeal }, hovered: { backgroundColor: colors.paleTeal }, focused: { borderColor: colors.deepTeal },
});
