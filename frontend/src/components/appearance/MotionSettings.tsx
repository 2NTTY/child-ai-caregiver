import { useId } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { Switch } from "../AppSwitch";
import { useMotionPreferences } from "../../motion";
import { chineseFont, colors, readingType, spacing } from "../../theme";
import { StatusAnnouncement } from "../StatusAnnouncement";
import { SectionCard, SectionHeader } from "../ui";

export function MotionSettings() {
  const { reducedMotion, systemReducedMotion, manualReducedMotion, preferenceReady, preferenceStorage, setManualReducedMotion } = useMotionPreferences();
  const hintId = useId();
  const systemWins = systemReducedMotion !== false;
  const status = !preferenceReady ? "正在讀取系統及裝置的動畫偏好…" : systemReducedMotion === true ? "系統已啟用減少動畫；系統設定優先，這裏不能將它關閉。"
    : systemReducedMotion === null ? "暫時未能確認系統設定，先以減少動畫方式顯示。"
    : manualReducedMotion ? "已減少工作區動畫；內容更新及焦點操作照常。" : "目前跟隨系統設定，工作區動畫正常顯示。";
  const storage = preferenceStorage === "loading" ? "正在讀取這個裝置的動畫偏好…"
    : preferenceStorage === "browser" ? "選擇只儲存在這個瀏覽器，不會同步至帳戶或其他裝置。關閉開關即恢復跟隨系統。"
    : Platform.OS === "web" ? "瀏覽器儲存暫時不可用，偏好只在本次開啟期間套用；重新載入後可能回復先前設定。"
    : "這個原生預覽只保留本次開啟期間的選擇；重新啟動後跟隨系統。";
  return <SectionCard testID="motion-settings">
    <SectionHeader density="compact" title="動畫與操作" subtitle="減少非必要移動，不影響功能或未保存草稿。" />
    <View style={styles.row}>
      <View style={styles.copy}><Text style={styles.title}>減少動畫</Text><Text nativeID={hintId} style={styles.body}>{status}</Text></View>
      <Switch testID="reduce-motion-switch" accessibilityLabel="減少動畫" accessibilityHint={status} aria-describedby={hintId}
        value={reducedMotion} disabled={systemWins || !preferenceReady} onValueChange={setManualReducedMotion}
        accessibilityState={{ checked: reducedMotion, disabled: systemWins || !preferenceReady }} />
    </View>
    <Text style={styles.note}>{storage}</Text>
    <StatusAnnouncement eventKey={`${manualReducedMotion}:${systemReducedMotion}`} message={status} />
  </SectionCard>;
}
const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 58 },
  copy: { flex: 1, minWidth: 0, gap: spacing.xs },
  title: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.muted, ...readingType.tool },
  note: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta },
});
