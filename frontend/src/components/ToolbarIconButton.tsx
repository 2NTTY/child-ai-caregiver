import { Platform, StyleSheet, useWindowDimensions } from "react-native";
import { IconButton } from "react-native-paper";
import type { ComponentProps } from "react";
import type { AppIcon } from "./AppIcon";
import { colors, mobileIcons, mobileLayout, radius } from "../theme";

export function ToolbarIconButton({ icon, label, onPress, expanded }: {
  icon: ComponentProps<typeof AppIcon>["name"];
  label: string;
  onPress: () => void;
  expanded?: boolean;
}) {
  const { width } = useWindowDimensions();
  const compact = Platform.OS !== "web" || width < mobileLayout.breakpoint;
  return <IconButton icon={icon} size={mobileIcons.navigation} mode="outlined"
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
