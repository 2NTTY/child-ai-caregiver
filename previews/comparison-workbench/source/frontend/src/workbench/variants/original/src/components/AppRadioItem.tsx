import { Platform, StyleSheet, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { RadioButton, Text, TouchableRipple, useTheme } from "react-native-paper";

export function AppRadioItem({ label, value, checked, accessibilityLabel = label, disabled = false, onPress, labelStyle, style }: {
  label: string; value: string; checked: boolean; accessibilityLabel?: string; disabled?: boolean;
  onPress: () => void; labelStyle?: StyleProp<TextStyle>; style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  if (Platform.OS !== "web") return <RadioButton.Item label={label} value={value} status={checked ? "checked" : "unchecked"}
    accessibilityLabel={accessibilityLabel} disabled={disabled} onPress={onPress} labelStyle={labelStyle} style={style} />;

  // Paper 5.15 Item drops ARIA props and nests a second focusable radio on RN Web.
  // Keep its row layout and ripple, with one control and a decorative indicator.
  const indicatorColor = disabled ? theme.colors.onSurfaceDisabled : checked ? theme.colors.primary : theme.colors.onSurfaceVariant;
  return <TouchableRipple accessibilityRole="radio" accessibilityLabel={accessibilityLabel}
    accessibilityState={{ checked, disabled }} aria-checked={checked} aria-disabled={disabled}
    disabled={disabled} onPress={onPress}
    {...{ onKeyDown: (event: { key?: string; nativeEvent?: { key?: string; repeat?: boolean }; repeat?: boolean; preventDefault(): void }) => {
      const key = event.nativeEvent?.key ?? event.key;
      if (key !== " " && key !== "Spacebar") return;
      event.preventDefault();
      // RN Web handles Enter for radio roles, but only handles Space for buttons.
      if (!disabled && !(event.nativeEvent?.repeat ?? event.repeat)) onPress();
    } }}>
    <View style={[styles.row, style]} pointerEvents="none">
      <Text variant="bodyLarge" style={[styles.label, { color: disabled ? theme.colors.onSurfaceDisabled : theme.colors.onSurface }, labelStyle]}>{label}</Text>
      <View aria-hidden accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
        style={[styles.indicator, { borderColor: indicatorColor }]}>
        {checked ? <View style={[styles.dot, { backgroundColor: indicatorColor }]} /> : null}
      </View>
    </View>
  </TouchableRipple>;
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8, paddingHorizontal: 16 },
  label: { flexShrink: 1, flexGrow: 1, textAlign: "left" },
  indicator: { width: 20, height: 20, margin: 8, borderWidth: 2, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
