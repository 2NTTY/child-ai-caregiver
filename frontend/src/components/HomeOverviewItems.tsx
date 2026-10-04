import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { HomeOverviewItem } from "../home-overview";
import type { HomeActions } from "../view-model";
import { chineseFont, colors, readingType, spacing, workspaceType } from "../theme";
import { AppButton } from "./ui";

export function HomeOverviewItems({ items, actions }: { items: HomeOverviewItem[]; actions: HomeActions }) {
  return <View style={styles.list}>{items.map((item, index) => <View key={item.id} testID={`home-overview-item-${item.id}`} style={[styles.item, index > 0 && styles.divider]}>
    <Text style={styles.status}>{item.statusLabel}</Text>
    <Text accessibilityRole="header" style={styles.title}>{item.title}</Text>
    <Text style={styles.body}>{item.detail}</Text>
    {item.sourceLabel ? <Text style={styles.meta}>依據：{item.sourceLabel}</Text> : null}
    <AppButton label={item.action.label} density="compact" variant="secondary" onPress={() => actions.open(item.action.destination)} />
  </View>)}</View>;
}
const styles = StyleSheet.create({
  list: { gap: spacing.md }, item: { gap: spacing.sm }, divider: { borderTopColor: colors.softLine, borderTopWidth: 1, paddingTop: spacing.md },
  status: { fontFamily: chineseFont, color: colors.teal, ...readingType.meta, fontWeight: "700" },
  title: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool }, meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
});
