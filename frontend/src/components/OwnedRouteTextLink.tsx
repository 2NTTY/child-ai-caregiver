import { useLayoutEffect, useRef, useState } from "react";
import { Link, type Href } from "expo-router";
import { Platform, Pressable, StyleSheet, type View } from "react-native";
import { Text } from "react-native-paper";
import { chineseFont, colors, readingType, spacing } from "../theme";

type OwnedRouteProps = { href: Href; label: string; accessibilityLabel?: string; onOpen(): void; disabled?: boolean };
function OwnedRouteControl({ href, label, accessibilityLabel, onOpen, disabled = false, emphasis }: OwnedRouteProps & { emphasis: "text" | "primary" }) {
  const [focused, setFocused] = useState(false), [hovered, setHovered] = useState(false), [pressed, setPressed] = useState(false);
  const host = useRef<View>(null), unavailable = useRef(disabled); unavailable.current = disabled;
  useLayoutEffect(() => {
    if (Platform.OS !== "web") return;
    const element = host.current as unknown as HTMLElement | null;
    // Keep the anchor host and its focus. RNW otherwise overwrites aria-disabled
    // and skips onPress for Alt-click/auxclick, which still need default prevention.
    if (!disabled) { element?.removeAttribute("aria-disabled"); return; }
    element?.setAttribute("aria-disabled", "true");
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
  }}><Pressable ref={host} accessibilityRole="link" accessibilityLabel={accessibilityLabel ?? label}
    accessibilityState={{ disabled }} aria-disabled={disabled} disabled={Platform.OS !== "web" && disabled}
    onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setPressed(false); }}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
    style={StyleSheet.flatten([styles.link, emphasis === "primary" && styles.primary, !disabled && (hovered || pressed) && (emphasis === "primary" ? styles.primaryActive : styles.active), focused && styles.focused])}>
    <Text style={[styles.label, emphasis === "primary" && styles.primaryLabel, disabled && styles.disabledLabel]}>{label}</Text>
  </Pressable></Link>;
}

/** Destinations whose ordinary activation belongs to an existing guarded owner adapter. */
export function OwnedRouteTextLink(props: OwnedRouteProps) { return <OwnedRouteControl {...props} emphasis="text" />; }
export function OwnedRouteActionLink(props: OwnedRouteProps) { return <OwnedRouteControl {...props} emphasis="primary" />; }

const styles = StyleSheet.create({
  link: { minHeight: 44, minWidth: 0, maxWidth: "100%", alignSelf: "flex-start", justifyContent: "center", paddingVertical: spacing.xs, paddingHorizontal: spacing.xs, borderWidth: 2, borderColor: "transparent", borderRadius: 4 },
  label: { fontFamily: chineseFont, color: colors.deepTeal, ...readingType.tool, textDecorationLine: "underline", fontWeight: "600", flexShrink: 1 },
  active: { backgroundColor: colors.paleTeal }, focused: { borderColor: colors.deepTeal },
  primary: { backgroundColor: colors.ink, paddingHorizontal: spacing.lg, minHeight: 48, borderRadius: 8 },
  primaryActive: { backgroundColor: colors.inkPressed }, primaryLabel: { color: colors.white, fontSize: 16, lineHeight: 24, textDecorationLine: "none", fontWeight: "700" },
  disabledLabel: { color: colors.muted },
});
