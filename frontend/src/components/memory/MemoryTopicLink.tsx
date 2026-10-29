import { useState } from "react";
import { Platform, Pressable, StyleSheet } from "react-native";
import { Text } from "react-native-paper";
import { Link, type Href } from "expo-router";
import { chineseFont, colors, readingType, spacing } from "../../theme";

export function MemoryTopicLink({ href, title, detail, selected, onOpen }: { href: Href; title: string; detail: string; selected: boolean; onOpen(): void }) {
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false);
  return <Link href={href} asChild onPress={event => {
    type Click = { defaultPrevented?: boolean; button?: number; metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; altKey?: boolean };
    const click = event as unknown as Click & { nativeEvent?: Click };
    if (Platform.OS === "web" && [click, click.nativeEvent].some(value => value && (value.defaultPrevented || value.metaKey || value.ctrlKey || value.shiftKey || value.altKey || value.button !== undefined && value.button !== 0))) return;
    event.preventDefault(); onOpen();
  }}><Pressable accessibilityRole="link" accessibilityLabel={`閱讀記憶：${title}`} aria-current={selected ? "true" : undefined}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={StyleSheet.flatten([styles.topic, selected && styles.selected, hovered && styles.hovered, focused && styles.focused])}>
    <Text style={styles.title}>{title}</Text><Text numberOfLines={2} style={styles.detail}>{detail}</Text>
  </Pressable></Link>;
}
const styles = StyleSheet.create({
  topic: { minHeight: 64, minWidth: 0, gap: spacing.xs, paddingVertical: spacing.md, paddingHorizontal: spacing.sm, borderWidth: 1, borderColor: "transparent", borderBottomColor: colors.line, borderLeftWidth: 3 },
  selected: { borderLeftColor: colors.ink, backgroundColor: colors.paleTeal }, hovered: { backgroundColor: colors.paleTeal }, focused: { borderColor: colors.deepTeal },
  title: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700", textDecorationLine: "underline" },
  detail: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
});
