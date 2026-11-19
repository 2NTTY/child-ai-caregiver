import { useRef } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { AppIcon, type AppIconName } from "../AppIcon";
import { chatColors, chatFont, chatType } from "./chat-presentation";

/** Secondary chat controls share a touch target without the weight of a form button. */
export function ChatAction({ label, accessibilityLabel = label, accessibilityHint, expanded, onPress, disabled = false,
  compact = false, subtle = false, icon, iconOnly = false, disclosure = false, testID }: {
  label: string; accessibilityLabel?: string; accessibilityHint?: string; expanded?: boolean; disabled?: boolean;
  compact?: boolean; subtle?: boolean; icon?: AppIconName; iconOnly?: boolean; disclosure?: boolean; testID?: string;
  onPress(target: View | null): void;
}) {
  const target = useRef<View | null>(null);
  return <Pressable ref={target} testID={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel}
    accessibilityHint={accessibilityHint} accessibilityState={{ disabled, expanded }} aria-disabled={disabled} aria-expanded={expanded}
    disabled={disabled} onPress={() => onPress(target.current)}
    {...(Platform.OS === "web" ? { dataSet: { chatAction: "true" } } : {})}
    style={({ pressed }) => [styles.action, compact && styles.touch, subtle && styles.subtle, iconOnly && styles.iconOnly, disabled && styles.disabled, pressed && styles.pressed]}>
    {icon ? <AppIcon name={icon} size={iconOnly ? 19 : 16} color={chatColors.secondary} /> : null}
    {!iconOnly && <Text style={[styles.label, subtle && styles.caption]}>{label}</Text>}
    {disclosure && <AppIcon name={expanded ? "chevron-down" : "chevron-right"} size={14} color={chatColors.secondary} />}
  </Pressable>;
}

const styles = StyleSheet.create({
  action: { alignSelf: "flex-start", minHeight: 44, maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 4 },
  touch: { minHeight: 48 }, subtle: { minHeight: 36, paddingHorizontal: 6 }, iconOnly: { minWidth: 44, justifyContent: "center" },
  label: { fontFamily: chatFont, color: chatColors.secondary, ...chatType.tool, flexShrink: 1 },
  caption: { ...chatType.meta }, pressed: { opacity: 0.72 }, disabled: { opacity: 0.45 },
});
