import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { GuideStatus } from "../view-model";
import { chineseFont, colors, radius, readingType, spacing, workspaceType } from "../theme";
import { AppButton, TextLink } from "./ui";

export function HomeGuideCallout({ status, onOpenGuide, onOpenSettings }: {
  status: GuideStatus; onOpenGuide: () => void; onOpenSettings: () => void;
}) {
  if (status === "complete") return null;
  const needsGuide = status === "first_login" || status === "incomplete";
  if (!needsGuide) return <View testID="home-guide-unknown" style={styles.unknown}>
    <Text style={styles.unknownTitle}>初始設定狀態待確認</Text>
    <Text style={styles.detail}>尚未取得初始化狀態，暫時不能確認基本資料是否齊全。使用引導可在設定內開啟。</Text>
    <TextLink label="前往設定" onPress={onOpenSettings} />
  </View>;
  return <View testID="home-guide-callout" style={styles.callout}>
    <View style={styles.copy}>
      <Text accessibilityRole="header" style={styles.title}>{status === "first_login" ? "開始設定你的照顧空間" : "繼續完成基本資料設定"}</Text>
      <Text style={styles.body}>沿使用引導核對孩子的基本資料；只填已知內容，未知資料可以如實保留。</Text>
    </View>
    <AppButton label={status === "first_login" ? "開始使用引導" : "繼續使用引導"} onPress={onOpenGuide} />
  </View>;
}

const styles = StyleSheet.create({
  callout: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.lg, padding: spacing.lg, borderLeftWidth: 4, borderLeftColor: colors.accent, borderRadius: radius.small, backgroundColor: colors.paleAmber },
  copy: { flexGrow: 1, flexShrink: 1, flexBasis: 280, minWidth: 0, gap: spacing.xs },
  title: { fontFamily: chineseFont, color: colors.ink, ...workspaceType.section },
  body: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool },
  unknown: { gap: spacing.xs, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.softLine, alignItems: "flex-start" },
  unknownTitle: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "600" },
  detail: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
});
