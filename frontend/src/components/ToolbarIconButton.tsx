import { Platform, StyleSheet, useWindowDimensions } from "react-native";
import { IconButton } from "react-native-paper";
import type { ComponentProps, Ref } from "react";
import type { View } from "react-native";
import { useInteractionDensity } from "./useInteractionDensity";
import type { AppIcon } from "./AppIcon";
import { colors, mobileIcons, mobileLayout, radius } from "../theme";

export function ToolbarIconButton({ icon, label, onPress, expanded, ref }: {
  icon: ComponentProps<typeof AppIcon>["name"];
  label: string;
  onPress: () => void;
  expanded?: boolean;
  ref?: Ref<View>;
}) {
  const { width } = useWindowDimensions();
  const touch = useInteractionDensity();
  const compact = Platform.OS !== "web" || touch || width < mobileLayout.breakpoint;
  return <IconButton ref={instance => {
    // Paper's ref targets the Surface. Expose the actual labelled control for Web focus restoration.
    const control = Platform.OS === "web" && instance
      ? ((instance as unknown as HTMLElement).querySelector('[role="button"]') ?? instance) as unknown as View : instance;
    if (typeof ref === "function") ref(control); else if (ref) ref.current = control;
  }} icon={icon} size={mobileIcons.navigation} mode="outlined"
    containerColor={colors.controlSurface} iconColor={colors.ink}
    accessibilityLabel={label} accessibilityState={{ expanded }} aria-expanded={expanded}
    onPress={onPress} contentStyle={styles.touchable} style={[styles.button, compact && styles.mobile]} />;
}

const styles = StyleSheet.create({
  button: { width: 44, height: 44, margin: 0, borderWidth: 0, borderRadius: radius.small },
  // The outline must not reduce the actual touch target by two pixels.
  touchable: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.small },
  mobile: { width: mobileLayout.touchTarget, height: mobileLayout.touchTarget },
});
