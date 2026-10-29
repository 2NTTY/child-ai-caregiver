import { useLayoutEffect, useRef } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { useIsFocused } from "expo-router/react-navigation";
import { chineseFont, colors, readingType, spacing } from "../../theme";

/** Compact chapter selection enters the work, not another page of introduction. */
export function SettingsChapterHeading({ section, title, description, compact, active }: {
  section: string; title: string; description: string; compact: boolean; active: boolean;
}) {
  const heading = useRef<View>(null), revealed = useRef<string | null>(null);
  const focused = useIsFocused();
  useLayoutEffect(() => {
    if (!active || !focused) return;
    if (!compact) { revealed.current = section; return; }
    if (revealed.current === section || !heading.current) return;
    if (Platform.OS === "web") {
      const node = heading.current as unknown as HTMLElement;
      if (!node.isConnected || node.closest('[inert], [aria-hidden="true"]')) return;
      node.focus();
      // Focus alone need not scroll an already-visible heading; align the work
      // explicitly so its first controls are not left behind fixed navigation.
      node.scrollIntoView({ block: "start", inline: "nearest", behavior: "auto" });
    } else heading.current.focus();
    revealed.current = section;
  }, [active, focused, compact, section]);
  return <View ref={heading} testID="settings-current-chapter" tabIndex={-1} role="region" accessibilityLabel={`${title}設定章節`} style={styles.heading}>
    <Text accessibilityRole="header" aria-level={2} style={styles.title}>{title}</Text><Text style={styles.description}>{description}</Text>
  </View>;
}
const styles = StyleSheet.create({
  heading: { gap: spacing.xs, minWidth: 0 },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: 24, lineHeight: 34, fontWeight: "700" },
  description: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
});
