import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { PickBackgroundImage } from "../../background-view-model";
import { useBackground } from "../../preview/BackgroundContext";
import { chineseFont, colors, radius, spacing, typeScale } from "../../theme";
import { AppButton, SectionCard, SectionHeader } from "../ui";
import { BackgroundImagePicker } from "./BackgroundImagePicker";
import { HomeBackground } from "./HomeBackground";

export function BackgroundSettings({ pickImage }: { pickImage?: PickBackgroundImage }) {
  const background = useBackground();
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return <SectionCard testID="background-settings">
    <SectionHeader title="首頁背景" subtitle="換成你喜歡的圖片，桌面及手機首頁會一起套用。" />
    <View style={styles.preview} testID="background-preview">
      <HomeBackground surface={colors.canvas} fadeBottom />
      <View style={styles.copy}><Text style={styles.heading}>你好，歡迎回來！</Text><Text style={styles.body}>每個小日常，都值得好好記下。</Text></View>
    </View>
    <Text style={styles.body}>{background.selected ? `本次背景：${background.selected.filename}` : "目前使用育伴港海旁家庭插畫。"}</Text>
    <View style={styles.actions}>
      <BackgroundImagePicker pickImage={pickImage} onReadingChange={setReading} onError={setError} onSelected={image => { background.select(image); setError(null); }} />
      <AppButton label="恢復育伴港原圖" variant="quiet" disabled={!background.selected || reading} onPress={() => { background.restore(); setError(null); }} />
    </View>
    {error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
    <Text style={styles.note}>JPG／PNG／WebP · 最多 4 MiB。圖片只留在本次介面預覽，沒有上傳；重新整理或退出預覽會恢復原圖。正式保存及手機選圖待接線。</Text>
  </SectionCard>;
}
const styles = StyleSheet.create({
  preview: { minHeight: 144, justifyContent: "center", borderRadius: radius.medium, overflow: "hidden", backgroundColor: colors.canvas },
  copy: { width: "60%", padding: spacing.md, gap: spacing.sm },
  heading: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, lineHeight: 22, fontWeight: "800" },
  body: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 22 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  note: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 },
  error: { fontFamily: chineseFont, color: colors.errorInk, fontSize: typeScale.small, lineHeight: 22 },
});
