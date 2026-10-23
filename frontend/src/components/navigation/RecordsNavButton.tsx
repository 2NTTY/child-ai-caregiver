import { useState } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Text } from "react-native-paper";
import { usePathname, useRouter } from "expo-router";
import { usePreviewNavigation } from "../../preview/PreviewNavigationGuard";
import { chineseFont, colors, mobileIcons, mobileLayout, mobileType } from "../../theme";
import { AppIcon } from "../AppIcon";
import { DirectionalPressable } from "./DirectionalPressable";
import { MobileNavSelection } from "./MobileNavSelection";
import { recordsMoreDirection } from "./quick-input-gesture";
import { navigationItems } from "./app-navigation";

export function RecordsNavButton({ active, scopeKey, style }: { active: boolean; scopeKey: string; style?: StyleProp<ViewStyle> }) {
  const router = useRouter(), pathname = usePathname(), leave = usePreviewNavigation();
  const [selected, setSelected] = useState(false);
  const openMore = () => { setSelected(false); if (pathname !== navigationItems.more.href) leave(() => router.push(navigationItems.more.href), "workspace"); };
  return <DirectionalPressable label={`${navigationItems.care.short}，向上拖曳開啟${navigationItems.more.short}`} hint={`點按開啟${navigationItems.care.short}；按方向鍵上亦可開啟${navigationItems.more.short}`}
    selected={active} current={active}
    scopeKey={`${scopeKey}:${pathname}`} testID="records-navigation" style={[styles.button, selected && styles.selected, style]}
    onPress={() => { if (pathname !== navigationItems.care.href) leave(() => router.push(navigationItems.care.href), "workspace"); }} onExpand={openMore}
    onGestureStart={() => setSelected(false)} onGestureMove={(dx, dy) => setSelected(recordsMoreDirection(dx, dy))}
    onGestureCancel={() => setSelected(false)} onGestureEnd={(dx, dy, dragged) => { setSelected(false); if (dragged && recordsMoreDirection(dx, dy)) openMore(); }}>
    {active ? <MobileNavSelection /> : null}
    <AppIcon name={selected ? "chevron-up" : navigationItems.care.icon} size={mobileIcons.navigation} color={active || selected ? colors.deepTeal : colors.muted} />
    <View style={styles.copy}><Text style={[styles.label, active && styles.active]}>{navigationItems.care.short}</Text><Text style={styles.hint}>{selected ? "放手開更多" : "上拉更多"}</Text></View>
  </DirectionalPressable>;
}
const styles = StyleSheet.create({
  button: { flex: 1, minWidth: mobileLayout.touchTarget, minHeight: mobileLayout.tabMinHeight, paddingVertical: 5, alignItems: "center", justifyContent: "center", gap: 2 },
  selected: { backgroundColor: colors.paleTeal }, copy: { alignItems: "center" },
  label: { fontFamily: chineseFont, color: colors.muted, ...mobileType.caption, fontWeight: "700" }, active: { color: colors.deepTeal, fontWeight: "800" },
  hint: { fontFamily: chineseFont, color: colors.muted, fontSize: 10, lineHeight: 12 },
});
