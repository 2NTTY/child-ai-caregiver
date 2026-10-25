import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { PageFrame } from "../components/PageFrame";
import { AppButton } from "../components/ui";
import { AppStatusBadge } from "../components/AppStatusBadge";
import { AppIcon } from "../components/AppIcon";
import { useProduction } from "../production/ProductionProvider";
import { chineseFont, colors, radius, spacing } from "../theme";

export default function FamilyPage() {
  const { actions } = useProduction();
  // The production route intentionally has no family invitation capability yet.
  // Do not mount the experimental FamilyView or infer authority from a profile.
  return <PageFrame density="compact" title="家庭" description="協作功能的開放狀態，以及你現在可以管理的本人設定。">
    <View style={styles.availability}>
      <View style={styles.icon}><AppIcon name="account-group-outline" size={30} color={colors.deepTeal} /></View>
      <View style={styles.copy}><AppStatusBadge label="家庭協作尚未開放" />
        <Text accessibilityRole="header" style={styles.title}>先把自己的照顧安排理順</Text>
        <Text style={styles.body}>目前可使用助手、孩子檔案與本人聯絡設定。邀請家庭成員及協作管理尚不可用。</Text>
      </View>
    </View>
    <View style={styles.cards}>
      <View style={styles.card}><Text accessibilityRole="header" style={styles.cardTitle}>本人聯絡與提醒</Text><Text style={styles.body}>核對接收同意、渠道及事項授權；不需先建立家庭。</Text><AppButton label="聯絡" onPress={() => actions.open("contact")} /></View>
      <View style={styles.card}><Text accessibilityRole="header" style={styles.cardTitle}>帳戶與通知設定</Text><Text style={styles.body}>管理自己的通知、外觀與資料控制。</Text><AppButton label="前往設定" variant="secondary" onPress={() => actions.open("settings")} /></View>
    </View>
  </PageFrame>;
}
const styles = StyleSheet.create({
  availability: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xl, padding: spacing.xl, borderWidth: 1, borderColor: colors.line, borderRadius: radius.medium, backgroundColor: colors.white },
  icon: { width: 64, height: 64, backgroundColor: colors.paleTeal, alignItems: "center", justifyContent: "center", borderRadius: radius.medium },
  copy: { flex: 1, flexBasis: 240, minWidth: 0, gap: spacing.md, alignItems: "flex-start" },
  title: { fontFamily: chineseFont, fontSize: 24, lineHeight: 34, fontWeight: "700", color: colors.ink },
  cards: { flexDirection: "row", flexWrap: "wrap", gap: spacing.lg }, card: { flex: 1, flexBasis: 280, minWidth: 0, padding: spacing.xl, gap: spacing.lg, backgroundColor: colors.white, borderWidth: 1, borderColor: colors.line, borderRadius: radius.medium, alignItems: "flex-start" },
  cardTitle: { fontFamily: chineseFont, fontSize: 18, lineHeight: 27, fontWeight: "700", color: colors.ink }, body: { fontFamily: chineseFont, fontSize: 16, lineHeight: 26, color: colors.muted },
});
