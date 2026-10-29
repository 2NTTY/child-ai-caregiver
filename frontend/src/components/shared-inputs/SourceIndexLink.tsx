import { useState, type Ref } from "react";
import { Platform, Pressable, StyleSheet, type View } from "react-native";
import { Text } from "react-native-paper";
import { Link, type Href } from "expo-router";
import { chineseFont, colors, readingType, spacing } from "../../theme";

/** Source navigation commits only after its original owner accepts the read. */
export function SourceIndexLink({ href, label, detail, status, selected, disabled, onOpen, ref }: { href: Href; label: string; detail: string; status: string; selected: boolean; disabled: boolean; onOpen(): void; ref?: Ref<View> }) {
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false);
  return <Link href={href} asChild onPress={event => {
    type Click = { defaultPrevented?: boolean; button?: number; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean };
    const click = event as unknown as Click & { nativeEvent?: Click };
    if (Platform.OS === "web" && [click, click.nativeEvent].some(value => value && (value.defaultPrevented || value.metaKey || value.ctrlKey || value.shiftKey || value.altKey || value.button !== undefined && value.button !== 0))) return;
    event.preventDefault(); if (!disabled) onOpen();
  }}><Pressable ref={ref} accessibilityRole="link" accessibilityLabel={`查看私人來源：${label}`} accessibilityState={{ disabled, selected }}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={StyleSheet.flatten([styles.row, selected && styles.selected, hovered && !disabled && styles.hovered, focused && styles.focused])}>
    <Text style={styles.title}>{label}</Text><Text style={styles.meta}>{detail}</Text><Text style={styles.status}>{status}</Text>
  </Pressable></Link>;
}
const styles = StyleSheet.create({
  row: { minHeight: 96, minWidth: 0, gap: spacing.xs, padding: spacing.md, borderWidth: 1, borderColor: "transparent", borderBottomColor: colors.softLine, borderLeftWidth: 3 },
  selected: { borderLeftColor: colors.ink, backgroundColor: colors.paleTeal }, hovered: { backgroundColor: colors.paleTeal }, focused: { borderColor: colors.deepTeal },
  title: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700", textDecorationLine: "underline" },
  meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta }, status: { fontFamily: chineseFont, color: colors.deepTeal, ...readingType.meta },
});
