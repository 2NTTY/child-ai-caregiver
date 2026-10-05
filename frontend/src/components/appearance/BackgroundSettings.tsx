import { SettingsSection as SectionCard } from "../settings/SettingsSection";
import { brand } from "../../branding";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { PickBackgroundImage } from "../../background-view-model";
import { useBackground } from "../../preview/BackgroundContext";
import { chineseFont, colors, radius, readingType, spacing } from "../../theme";
import { AppButton, SectionHeader } from "../ui";
import { StatusAnnouncement } from "../StatusAnnouncement";
import { BackgroundImagePicker } from "./BackgroundImagePicker";
import { HomeBackground } from "./HomeBackground";

export function BackgroundSettings({ pickImage }: { pickImage?: PickBackgroundImage }) {
  const background = useBackground();
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <SectionCard testID="background-settings">
    <SectionHeader density="compact" title="首頁背景" subtitle="換成你喜歡的圖片，桌面及手機首頁會一起套用。" />
    <StatusAnnouncement eventKey={`${reading}:${error ?? ""}:${background.selected?.filename ?? "default"}`}
      message={reading ? "正在讀取首頁背景圖片…" : error ?? (background.selected ? "本次首頁背景已更新，尚未保存。" : "已恢復育有方首頁背景。")} urgent={!reading && !!error} />
    <View style={styles.preview} testID="background-preview">
      <HomeBackground surface={colors.canvas} fadeBottom />
      <View style={styles.copy}><Text style={styles.heading}>你好，歡迎回來！</Text><Text style={styles.body}>每個小日常，都值得好好記下。</Text></View>
    </View>
    <Text style={styles.body}>{background.selected ? `本次背景：${background.selected.filename}` : `目前使用${brand.name}海旁家庭插畫。`}</Text>
    <View style={styles.actions}>
      <BackgroundImagePicker pickImage={pickImage} onReadingChange={setReading} onError={setError} onSelected={image => { background.select(image); setError(null); }} />
      <AppButton label={brand.restoreBackgroundLabel} variant="quiet" disabled={!background.selected || reading} onPress={() => { background.restore(); setError(null); }} />
    </View>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    <Text style={styles.note}>JPG／PNG／WebP · 最多 4 MiB。圖片只留在本次介面預覽，沒有上傳；重新整理或退出預覽會恢復原圖。正式保存及手機選圖待接線。</Text>
  </SectionCard>;
}
const styles = StyleSheet.create({
  preview: { minHeight: 144, justifyContent: "center", borderRadius: radius.medium, overflow: "hidden", backgroundColor: colors.canvas },
  copy: { width: "60%", padding: spacing.md, gap: spacing.sm },
  heading: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "800" },
  body: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  note: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta, borderTopWidth: 1, borderTopColor: colors.softLine, paddingTop: spacing.md },
  error: { fontFamily: chineseFont, color: colors.errorInk, ...readingType.tool },
});
