import { SettingsSection as SectionCard } from "../settings/SettingsSection";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { PickBackgroundImage } from "../../background-view-model";
import { useBackground } from "../../preview/BackgroundContext";
import { chineseFont, colors, radius, readingType, spacing } from "../../theme";
import { AppButton, SectionHeader } from "../ui";
import { StatusAnnouncement } from "../StatusAnnouncement";
import { BackgroundImagePicker } from "./BackgroundImagePicker";
import { AppBackdrop } from "./AppBackdrop";
import { BackgroundSurface } from "./BackgroundSurface";

export function BackgroundSettings({ pickImage }: { pickImage?: PickBackgroundImage }) {
  const background = useBackground();
  const [reading, setReading] = useState(false), [error, setError] = useState<string | null>(null);
  const busy = reading || background.busy;
  const message = error ?? background.notice;
  return <SectionCard testID="background-settings">
    <SectionHeader density="compact" title="應用背景" subtitle="只保存在此裝置，不會同步或傳給助手。" />
    <StatusAnnouncement eventKey={`${busy}:${message}`} message={busy ? "正在處理本機背景…" : message} urgent={!busy && !!error} />
    <View style={styles.preview} testID="background-preview"><AppBackdrop preview>
      <View style={styles.previewInset}><BackgroundSurface frosted padded style={styles.readingSurface}>
        <Text style={styles.heading}>今日</Text><Text style={styles.body}>霧化面板承托內容，原有卡片保留底色。</Text>
        <View style={styles.previewLine} /><View style={styles.previewLine} />
      </BackgroundSurface></View>
    </AppBackdrop></View>
    <Text style={styles.body}>{background.selected ? "目前使用自選圖片" : "目前使用預設背景"}</Text>
    <View style={styles.actions}>
      <BackgroundImagePicker disabled={background.busy} pickImage={pickImage} onReadingChange={setReading} onError={setError} onSelected={async image => { setError(null); await background.select(image); }} />
      <AppButton label="恢復預設背景" variant="quiet" disabled={busy || !background.selected && !background.notice} onPress={() => { setError(null); void background.restore(); }} />
    </View>
    {message ? <Text style={error ? styles.error : styles.note}>{message}</Text> : null}
    <Text style={styles.note}>JPG／PNG／WebP · 最多 4 MiB、1,600 萬像素。套用登入後的首頁、聊天及其他頁面；重新開啟仍保留，網頁與手機各自設定。登出後不顯示個人圖片。</Text>
  </SectionCard>;
}
const styles = StyleSheet.create({
  preview: { height: 176, borderRadius: radius.medium, overflow: "hidden", backgroundColor: colors.canvas },
  previewInset: { flex: 1, padding: spacing.lg, justifyContent: "center" },
  readingSurface: { backgroundColor: colors.canvas, padding: spacing.md, borderRadius: radius.small, gap: spacing.sm },
  previewLine: { height: 4, width: "65%", backgroundColor: colors.softLine, borderRadius: 2 },
  heading: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "800" },
  body: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  note: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
  error: { fontFamily: chineseFont, color: colors.errorInk, ...readingType.tool },
});
