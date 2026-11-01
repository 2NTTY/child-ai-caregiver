import { useState } from "react";
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { Text } from "react-native-paper";
import type { Href } from "expo-router";
import { PreviewLink } from "../preview/PreviewNavigationGuard";
import { chineseFont, colors, readingType, spacing } from "../theme";

type RouteLinkProps = { href: Href; label: string; accessibilityLabel?: string; style?: StyleProp<ViewStyle>; intent?: "workspace" | "navigation"; disabled?: boolean };
function RouteControl({ href, label, accessibilityLabel, style, emphasis, intent, disabled = false }: RouteLinkProps & { emphasis: "text" | "primary" }) {
  const [hovered, setHovered] = useState(false), [pressed, setPressed] = useState(false);
  return <PreviewLink href={href} intent={intent} disabled={disabled}><Pressable accessibilityRole="link" accessibilityLabel={accessibilityLabel ?? label} accessibilityState={{ disabled }} aria-disabled={disabled}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)} onBlur={() => setPressed(false)} style={StyleSheet.flatten([styles.link, emphasis === "primary" && styles.primary, !disabled && (hovered || pressed) && (emphasis === "primary" ? styles.primaryActive : styles.active), style])}>
    <Text style={[styles.label, emphasis === "primary" && styles.primaryLabel, disabled && styles.disabledLabel]}>{label}</Text>
  </Pressable></PreviewLink>;
}
/** Destinations, never commands or draft prefills. Named variants keep intent explicit. */
export function RouteTextLink(props: RouteLinkProps) { return <RouteControl {...props} emphasis="text" />; }
export function RouteActionLink(props: RouteLinkProps) { return <RouteControl {...props} emphasis="primary" />; }
const styles = StyleSheet.create({
  link: { minHeight: 44, paddingVertical: spacing.sm, paddingHorizontal: spacing.xs, alignSelf: "flex-start", justifyContent: "center", minWidth: 0, maxWidth: "100%" },
  label: { fontFamily: chineseFont, color: colors.deepTeal, ...readingType.tool, textDecorationLine: "underline", fontWeight: "600", flexShrink: 1 },
  disabledLabel: { color: colors.muted },
  active: { backgroundColor: colors.paleTeal },
  primary: { backgroundColor: colors.ink, paddingHorizontal: spacing.lg, minHeight: 48, borderRadius: 8 },
  primaryActive: { backgroundColor: colors.inkPressed }, primaryLabel: { color: colors.white, fontSize: 16, lineHeight: 24, textDecorationLine: "none", fontWeight: "700" },
});
