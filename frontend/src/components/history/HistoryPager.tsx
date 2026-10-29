import { View, StyleSheet } from "react-native";
import { Text } from "react-native-paper";
import { AppButton } from "../ui";
import { chineseFont, colors, readingType, spacing } from "../../theme";

export function HistoryPager({ page, total, pageSize = 20, disabled = false, onChange }: { page: number; total: number; pageSize?: number; disabled?: boolean; onChange?: (page: number) => void }) {
  if (!onChange || total <= pageSize) return null;
  return <View role="navigation" style={styles.row} accessibilityLabel="已載入清單分頁">
    <AppButton label="上一頁" variant="quiet" disabled={disabled || page === 0} onPress={() => onChange(page - 1)} />
    <Text style={styles.meta}>已載入清單 · 第 {page + 1}／{Math.ceil(total / pageSize)} 頁</Text>
    <AppButton label="下一頁" variant="quiet" disabled={disabled || (page + 1) * pageSize >= total} onPress={() => onChange(page + 1)} />
  </View>;
}
const styles = StyleSheet.create({ row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm }, meta: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta } });
