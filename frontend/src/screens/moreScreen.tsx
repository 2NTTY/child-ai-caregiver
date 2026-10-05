import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { AppMenuList } from "../components/AppMenuList";
import { PageFrame } from "../components/PageFrame";
import { AppButton } from "../components/ui";
import { usePreview } from "../preview/PreviewContext";
import { usePreviewNavigation } from "../preview/PreviewNavigationGuard";
import { chineseFont, colors, spacing } from "../theme";

const groups = [
  { title: "照顧資料", detail: "核對原始資料、回看變化與準備到診", items: [
    { key: "summary", label: "回顧與到診準備", icon: "clipboard-check-outline" },
    { key: "photos", label: "含照片記錄", icon: "image-outline" },
    { key: "profile", label: "子女檔案", icon: "account-child-outline" },
  ] },
  { title: "助手與家庭", detail: "話題背景、家庭協作與聯絡安排", items: [
    { key: "memory", label: "記憶與話題", icon: "book-open-variant" },
    { key: "family", label: "家庭協調與成員", icon: "account-group-outline" },
    { key: "contact", label: "聯絡授權", icon: "bell-outline" },
  ] },
  { title: "設定與協助", detail: "本人偏好、私人來源及使用說明", items: [
    { key: "settings", label: "設定", icon: "cog-outline" },
    { key: "guide", label: "說明與引導", icon: "compass-outline" },
  ] },
] as const;

export default function MoreScreen() {
  const { actions } = usePreview(), router = useRouter(), leave = usePreviewNavigation();
  return <PageFrame density="compact" title="更多功能" description="按用途找資料與管理入口；私人來源可在設定內開啟。">
    <AppButton label="返回記錄" variant="quiet" onPress={() => actions.open("care")} />
    <View style={styles.groups}>{groups.map(group => <View key={group.title} style={styles.group}>
      <View style={styles.heading}><Text accessibilityRole="header" style={styles.title}>{group.title}</Text><Text style={styles.detail}>{group.detail}</Text></View>
      <AppMenuList items={group.items.map(item => ({ ...item, onPress: () => item.key === "photos" ? leave(() => router.push({ pathname: "/care", params: { view: "photos" } })) : actions.open(item.key) }))} />
    </View>)}</View>
  </PageFrame>;
}
const styles = StyleSheet.create({
  groups: { gap: spacing.xl, maxWidth: 780, width: "100%" }, group: { gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.lg },
  heading: { gap: spacing.xs }, title: { fontFamily: chineseFont, color: colors.ink, fontSize: 16, lineHeight: 24, fontWeight: "700" },
  detail: { fontFamily: chineseFont, color: colors.muted, fontSize: 14, lineHeight: 22 },
});
