import { useState } from "react";
import { Platform, Pressable, StyleSheet } from "react-native";
import { Text } from "react-native-paper";
import { usePathname, useRouter } from "expo-router";
import { PreviewLink, usePreviewNavigation } from "../../preview/PreviewNavigationGuard";
import { chineseFont, colors, mobileIcons, mobileLayout, mobileType } from "../../theme";
import { AppIcon } from "../AppIcon";
import { MobileNavSelection } from "./MobileNavSelection";
import { navigationItems } from "./app-navigation";

export function MoreNavButton({ active }: { active: boolean }) {
  const router = useRouter(), pathname = usePathname(), leave = usePreviewNavigation();
  const [pressed, setPressed] = useState(false);
  const item = navigationItems.more;
  const control = <Pressable testID="more-navigation" accessibilityRole={Platform.OS === "web" ? "link" : "button"}
    accessibilityLabel={item.label} accessibilityState={{ selected: active }} aria-current={active ? pathname === item.href ? "page" : true : undefined}
    onPress={Platform.OS === "web" ? undefined : () => { if (pathname !== item.href) leave(() => router.push(item.href), "workspace"); }}
    onPressIn={() => setPressed(true)} onPressOut={() => setPressed(false)}
    style={StyleSheet.flatten([styles.button, pressed && styles.pressed])}>
    {active ? <MobileNavSelection /> : null}
    <AppIcon name={item.icon} size={mobileIcons.navigation} color={active ? colors.deepTeal : colors.muted} importantForAccessibility="no" />
    <Text style={[styles.label, active && styles.active]}>{item.short}</Text>
  </Pressable>;
  return Platform.OS === "web" ? <PreviewLink href={item.href}>{control}</PreviewLink> : control;
}
const styles = StyleSheet.create({
  button: { flex: 1, minWidth: mobileLayout.touchTarget, minHeight: mobileLayout.tabMinHeight, paddingVertical: 8, alignItems: "center", justifyContent: "center", gap: 4 },
  pressed: { backgroundColor: colors.paleTeal },
  label: { fontFamily: chineseFont, color: colors.muted, ...mobileType.caption, fontWeight: "700" },
  active: { color: colors.deepTeal, fontWeight: "800" },
});
