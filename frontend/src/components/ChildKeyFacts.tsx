import { ScrollView, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";
import type { HomeChild, RecordsLoadState } from "../view-model";

export function ChildKeyFacts({ child, load }: { child: HomeChild | undefined; load: RecordsLoadState }) {
  if (load === "loading") return <Text accessibilityLiveRegion="polite" style={styles.placeholder}>正在讀取孩子資料…</Text>;
  if (load === "error") return <Text accessibilityLiveRegion="polite" style={styles.placeholder}>暫時讀不到孩子資料</Text>;
  if (!child) return <Text style={styles.placeholder}>尚未選擇孩子</Text>;
  const facts = [
    { label: "地區", value: child.regionLabel },
    { label: "檔案", value: child.profileConfirmed ? "已確認" : "待核對" },
    { label: "過敏", value: child.allergiesLabel ?? "未提供" },
  ];
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.facts} accessibilityLabel={`${child.displayName}的關鍵資料`}>
    {facts.map(fact => <View key={fact.label} style={styles.fact}><Text style={styles.label}>{fact.label}</Text><Text numberOfLines={1} style={styles.value}>{fact.value}</Text></View>)}
  </ScrollView>;
}

const styles = StyleSheet.create({
  scroll: { flex: 1, minWidth: 0, flexGrow: 1 },
  facts: { alignItems: "center", gap: spacing.sm, paddingRight: spacing.sm },
  fact: { flexDirection: "row", alignItems: "center", gap: spacing.xs, borderRadius: radius.pill, backgroundColor: colors.quietSurface, paddingHorizontal: spacing.sm, minHeight: 31 },
  label: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption },
  value: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.caption, fontWeight: "700", maxWidth: 120 },
  placeholder: { flex: 1, minWidth: 0, fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption },
});
