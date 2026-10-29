import type { Href } from "expo-router";
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { Text } from "react-native-paper";
import { useState, type ReactNode } from "react";
import { useProductionOwner } from "../production/ProductionProvider";
import { PreviewLink } from "../preview/PreviewNavigationGuard";
import { chineseFont, colors, spacing } from "../theme";

/** Navigation-only. It cannot mutate, prefill or accept an action callback. */
export function RouteTextLink({ href, label, scopeKey, children, testID, current, style, emphasis = "plain" }: {
  href: Href; label: string; scopeKey: string | null; children?: ReactNode; testID?: string; current?: boolean; style?: StyleProp<ViewStyle>; emphasis?: "plain" | "primary";
}) {
  const owner = useProductionOwner(), identityKey = owner.getSnapshot().identityKey;
  const [pressed, setPressed] = useState(false), [focused, setFocused] = useState(false), [hovered, setHovered] = useState(false);
  const isCurrent = () => { const snapshot = owner.getSnapshot(); return snapshot.scopeKey === scopeKey && snapshot.identityKey === identityKey; };
  return <PreviewLink href={href} scopeKey={scopeKey} isCurrent={isCurrent}><Pressable accessibilityRole="link" accessibilityLabel={label}
    aria-current={current ? "page" : undefined} testID={testID} onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    style={StyleSheet.flatten([styles.link, style, (pressed || hovered) && (emphasis === "primary" ? styles.primaryPressed : styles.pressed), focused && styles.focused])}>
    {children ?? <Text style={[styles.label, emphasis === "primary" && styles.primaryLabel]}>{label}</Text>}
  </Pressable></PreviewLink>;
}
const styles = StyleSheet.create({
  link: { minHeight: 44, minWidth: 44, paddingVertical: spacing.sm, justifyContent: "center", maxWidth: "100%" },
  label: { fontFamily: chineseFont, fontSize: 16, lineHeight: 26, color: colors.teal, textDecorationLine: "underline" },
  primaryLabel: { color: colors.white, textDecorationLine: "none", fontWeight: "600" },
  pressed: { backgroundColor: colors.pressedOverlay },
  primaryPressed: { backgroundColor: colors.inkPressed },
  focused: { outlineWidth: 2, outlineStyle: "solid", outlineColor: colors.ink, outlineOffset: 2 },
});
