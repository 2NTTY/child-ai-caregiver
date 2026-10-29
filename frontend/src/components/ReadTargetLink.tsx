import { useQuietReadFocus } from "./useQuietReadFocus";
import { Link, type Href } from "expo-router";
import { useState, type ReactNode, type Ref } from "react";
import { Platform, Pressable, StyleSheet, type StyleProp, type View, type ViewStyle } from "react-native";
import { colors } from "../theme";

/** A real read destination; ordinary activation still asks the original owner. */
export function ReadTargetLink({ href, label, availability = "ready", preserveFocusWhenDisabled = availability === "refreshing", onOpen, ref, style, children, testID, current, routeFocusKey }: {
  /** Opt-in for a retained, same-scope read host; disabled activation remains blocked. */
  href: Href; label: string; testID?: string; current?: "page"; routeFocusKey?: string; availability?: "ready" | "refreshing" | "unavailable"; onOpen(): void; preserveFocusWhenDisabled?: boolean; ref?: Ref<View>; style: StyleProp<ViewStyle>; children: ReactNode;
}) {
  const [pressed, setPressed] = useState(false), [focused, setFocused] = useState(false), [hovered, setHovered] = useState(false);
  const disabled = availability !== "ready";
  const readFocus = useQuietReadFocus(disabled, preserveFocusWhenDisabled);
  const rowRef = (node: View | null) => { readFocus.host.current = node; if (typeof ref === "function") return ref(node); else if (ref) ref.current = node; };
  const control = <Pressable ref={rowRef} testID={testID} accessibilityRole="link" accessibilityLabel={label} accessibilityState={{ disabled }} aria-disabled={disabled} aria-current={current}
    {...(Platform.OS === "web" && routeFocusKey ? { dataSet: { routeFocusKey } } : {})}
    disabled={readFocus.nativeDisabled} onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={StyleSheet.flatten([style, (pressed || hovered) && !disabled && { backgroundColor: colors.paleTeal }, focused && { outlineWidth: 2, outlineStyle: "solid", outlineColor: colors.ink }])}>{children}</Pressable>;
  if (disabled && !readFocus.preserveWebFocus) return control;
  return <Link href={href} asChild onPress={event => {
    if (disabled) { event.preventDefault(); return; }
    if (Platform.OS === "web") {
      const click = event as unknown as React.MouseEvent<HTMLElement>, input = click.nativeEvent ?? click;
      if (click.defaultPrevented || input.defaultPrevented || input.metaKey || input.ctrlKey || input.shiftKey || input.altKey || input.button !== undefined && input.button !== 0) return;
    }
    event.preventDefault(); onOpen();
  }}>{control}</Link>;
}
