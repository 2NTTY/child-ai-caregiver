import { Pressable, StyleSheet, View } from "react-native";
import { Divider, Text } from "react-native-paper";
import type { PreviewChecklistItem } from "../preview/fixture";
import { chineseFont, colors, spacing, typeScale } from "../theme";
import { SectionCard, SectionHeader } from "./ui";
import { AppCheckbox } from "./AppCheckbox";

export function PreviewTodoCard({ items, checked, onToggle, onOpen }: {
  items: PreviewChecklistItem[];
  checked: Record<string, boolean>;
  onToggle: (id: string) => void;
  onOpen: (destination: PreviewChecklistItem["destination"]) => void;
}) {
  const remaining = items.filter(item => !checked[item.id]).length;
  return <SectionCard>
    <SectionHeader title="待辦事項" subtitle="合成清單 · 尚未建立正式任務" />
    {items.length === 0 ? <Text style={styles.meta}>目前沒有可顯示的預覽事項。</Text> : items.map((item, index) => <View key={item.id}>
      {index > 0 ? <Divider style={styles.divider} /> : null}
      <View style={styles.row}>
        <View style={styles.checkAction}><AppCheckbox label={item.title} accessibilityLabel={`在預覽中標記${item.title}`} description={checked[item.id] ? "已在此預覽標記" : item.detail} checked={!!checked[item.id]} strikeThrough onChange={() => onToggle(item.id)} /></View>
        <Pressable accessibilityRole="button" accessibilityLabel={`查看${item.title}相關頁面`}
          onPress={() => onOpen(item.destination)} style={({ pressed }) => [styles.open, pressed && styles.pressed]}>
          <Text style={styles.openText}>›</Text>
        </Pressable>
      </View>
    </View>)}
    {items.length > 0 ? <Text style={styles.footer}>{remaining} 項未標記 · 勾選只在此預覽有效，沒有保存或發送提醒。</Text> : null}
  </SectionCard>;
}

const styles = StyleSheet.create({
  row: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  checkAction: { flex: 1, minWidth: 0 },
  meta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 18 },
  footer: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: typeScale.caption, lineHeight: 18 },
  divider: { backgroundColor: colors.softLine },
  open: { width: 32, minHeight: 40, alignItems: "center", justifyContent: "center" },
  openText: { color: colors.deepTeal, fontSize: 26 },
  pressed: { opacity: 0.65 },
});
