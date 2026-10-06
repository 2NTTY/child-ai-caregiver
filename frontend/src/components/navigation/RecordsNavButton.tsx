import { useState } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Text } from "react-native-paper";
import { usePathname, useRouter } from "expo-router";
import { usePreviewNavigation } from "../../preview/PreviewNavigationGuard";
import { chineseFont, colors, mobileIcons, mobileLayout, mobileType } from "../../theme";
import { AppIcon } from "../AppIcon";
import { DirectionalPressable } from "./DirectionalPressable";
import { recordsMoreDirection } from "./quick-input-gesture";

export function RecordsNavButton({ active, scopeKey, style }: { active: boolean; scopeKey: string; style?: StyleProp<ViewStyle> }) {
  const router = useRouter(), pathname = usePathname(), leave = usePreviewNavigation();
  const [selected, setSelected] = useState(false);
  const openMore = () => { setSelected(false); if (pathname !== "/more") leave(() => router.push("/more")); };
  return <DirectionalPressable label="記錄，向上拖曳開啟更多頁面" hint="點按查看記錄；亦可按方向鍵上，或使用記錄頁的更多按鈕"
    scopeKey={`${scopeKey}:${pathname}`} testID="records-navigation" style={[styles.button, selected && styles.selected, style]}
    onPress={() => { if (pathname !== "/care") leave(() => router.push("/care")); }} onExpand={openMore}
    onGestureStart={() => setSelected(false)} onGestureMove={(dx, dy) => setSelected(recordsMoreDirection(dx, dy))}
    onGestureCancel={() => setSelected(false)} onGestureEnd={(dx, dy, dragged) => { setSelected(false); if (dragged && recordsMoreDirection(dx, dy)) openMore(); }}>
    <AppIcon name={selected ? "chevron-up" : "notebook-outline"} size={mobileIcons.navigation} color={active || selected ? colors.deepTeal : colors.muted} />
    <View style={styles.copy}><Text style={[styles.label, active && styles.active]}>記錄</Text><Text style={styles.hint}>{selected ? "放手開更多" : "上拉更多"}</Text></View>
  </DirectionalPressable>;
}
const styles = StyleSheet.create({
  button: { flex: 1, minWidth: mobileLayout.touchTarget, minHeight: mobileLayout.tabMinHeight, paddingVertical: 5, alignItems: "center", justifyContent: "center", gap: 2 },
  selected: { backgroundColor: colors.paleTeal }, copy: { alignItems: "center" },
  label: { fontFamily: chineseFont, color: colors.muted, ...mobileType.caption, fontWeight: "700" }, active: { color: colors.deepTeal, fontWeight: "800" },
  hint: { fontFamily: chineseFont, color: colors.muted, fontSize: 10, lineHeight: 12 },
});
