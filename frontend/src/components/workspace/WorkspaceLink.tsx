import { useState, type ReactNode } from "react";
import type { Href } from "expo-router";
import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { PreviewLink } from "../../preview/PreviewNavigationGuard";

type WorkspaceLinkProps = {
  href: Href;
  scopeKey?: string | null;
  isCurrent?: () => boolean;
  label: string;
  current?: "page" | "true";
  style: StyleProp<ViewStyle>;
  feedbackStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
};

// Expo's asChild Slot merges styles as objects. A callback on its direct child
// loses every style; resolve local interaction state before crossing that slot.
export function WorkspaceLink({ href, label, current, style, feedbackStyle, children, scopeKey, isCurrent }: WorkspaceLinkProps) {
  const [pressed, setPressed] = useState(false), [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false);
  return <PreviewLink href={href} scopeKey={scopeKey} isCurrent={isCurrent}><Pressable accessibilityRole="link" accessibilityLabel={label}
    aria-current={current} accessibilityState={{ selected: !!current }}
    onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
    style={StyleSheet.flatten([style, (pressed || hovered) && feedbackStyle, focused && { outlineStyle: "solid", outlineWidth: 2, outlineOffset: 2 }])}>
    {children}
  </Pressable></PreviewLink>;
}
