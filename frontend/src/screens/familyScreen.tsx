import { useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { PageFrame } from "../components/PageFrame";
import { SectionCard, SectionHeader } from "../components/ui";
import { AppStatusBadge } from "../components/AppStatusBadge";
import { AppIcon } from "../components/AppIcon";
import { PreviewLink } from "../preview/PreviewNavigationGuard";
import { useProduction } from "../production/ProductionProvider";
import { chineseFont, colors, radius, readingType, spacing } from "../theme";

export default function FamilyPage() {
  const { actions } = useProduction();
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  return <PageFrame density="compact" title="家庭協調" description="家庭成員與協作權限集中在這裏；本人提醒設定保持獨立。">
    <View style={styles.availability} testID="family-availability">
      <View style={styles.icon} accessible={false}><AppIcon name="account-group-outline" size={28} color={colors.teal} /></View>
      <View style={styles.copy}><AppStatusBadge label="尚未開放" /><Text accessibilityRole="header" aria-level={2} style={styles.title}>家庭協作尚未開放</Text>
        <Text style={styles.body}>目前不能邀請成員或更改家庭角色。這不影響你管理孩子資料、待辦和本人的通知。</Text></View>
    </View>
    <SectionCard><SectionHeader density="compact" title="目前可以使用" subtitle="先管理自己的提醒與資料，不會替他人開啟授權。" />
      <View style={styles.actions}>{([
        { key: "contact", href: "/contact", label: "管理本人聯絡授權" },
        { key: "settings", href: "/settings", label: "通知與帳戶設定" },
      ] as const).map(item => {
        const link = <Pressable accessibilityRole={Platform.OS === "web" ? "link" : "button"} accessibilityLabel={item.label}
          onPress={Platform.OS === "web" ? undefined : () => actions.open(item.key)} onPressIn={() => setPressedKey(item.key)} onPressOut={() => setPressedKey(null)} style={StyleSheet.flatten([styles.routeLink, pressedKey === item.key && styles.routePressed])}><Text style={styles.routeLabel}>{item.label}</Text><AppIcon name="chevron-right" size={16} importantForAccessibility="no" /></Pressable>;
        return Platform.OS === "web" ? <PreviewLink key={item.key} href={item.href}>{link}</PreviewLink> : <View key={item.key}>{link}</View>;
      })}</View>
    </SectionCard>
  </PageFrame>;
}
const styles = StyleSheet.create({
  routeLink: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.line, borderRadius: radius.small },
  routeLabel: { fontFamily: chineseFont, ...readingType.tool, color: colors.deepTeal, fontWeight: "600", flexShrink: 1 }, routePressed: { backgroundColor: colors.paleTeal },
  availability: { flexDirection: "row", flexWrap: "wrap", gap: spacing.lg, padding: spacing.xl, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, borderRadius: radius.medium },
  icon: { width: 60, height: 60, borderRadius: radius.medium, backgroundColor: colors.paleTeal, justifyContent: "center", alignItems: "center" },
  copy: { flexGrow: 1, flexShrink: 1, flexBasis: 260, minWidth: 0, gap: spacing.md, alignItems: "flex-start" },
  title: { fontFamily: chineseFont, fontSize: 22, lineHeight: 32, fontWeight: "700", color: colors.ink },
  body: { fontFamily: chineseFont, ...readingType.body, color: colors.muted }, actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
