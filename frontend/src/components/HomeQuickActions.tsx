import { useState } from "react";
import { usePathname } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { PhotoOriginal } from "../photo-view-model";
import { chineseFont, colors, readingType, spacing } from "../theme";
import { AppIcon } from "./AppIcon";
import { PhotoFilePicker, type PhotoFilePickerProps } from "./photos/PhotoFilePicker";
import { RouteActionLink } from "./RouteTextLink";

type HomeQuickActionsProps = {
  childId: string; scopeKey: string | null; available: boolean; onPhoto(original: PhotoOriginal): void;
  captureOriginal?: PhotoFilePickerProps["captureOriginal"];
};
export function HomeQuickActions(props: HomeQuickActionsProps) {
  const active = usePathname() === "/";
  // Replace the picker on route or authority change; late local reads are discarded by its owner.
  return <HomeAgentCapture key={JSON.stringify([props.scopeKey, props.childId, active])} {...props} active={active} />;
}
function HomeAgentCapture({ onPhoto, available, active, captureOriginal }: HomeQuickActionsProps & { active: boolean }) {
  const [error, setError] = useState<string | null>(null), [hovered, setHovered] = useState(false);
  const enabled = available && active;
  return <View testID="home-quick-actions" style={styles.section}>
    <View testID="mobile-quick-actions" style={styles.actions}>
      {enabled ? <RouteActionLink href="/chat" label="與助手聊一聊" accessibilityLabel="在目前孩子的私人對話中提問" /> : <Text style={styles.note}>核對孩子後即可開始對話。</Text>}
      <PhotoFilePicker disabled={!enabled} capturePreferred captureOriginal={captureOriginal}
        onPick={original => { setError(null); onPhoto(original); }} onError={setError}
        renderTrigger={trigger => <Pressable testID="home-agent-camera" accessibilityRole="button" accessibilityLabel="拍照加入對話"
          accessibilityHint={trigger.unavailableReason ?? "拍攝後先檢視，不會自動上傳或保存"}
          accessibilityState={{ disabled: trigger.disabled, busy: trigger.reading }} aria-disabled={trigger.disabled} aria-busy={trigger.reading}
          disabled={trigger.disabled} onPress={() => { setError(null); trigger.onPress(); }} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)}
          style={({ pressed }) => [styles.capture, trigger.disabled && styles.disabled, (hovered || pressed) && !trigger.disabled && styles.pressed]}>
          <AppIcon name="camera-outline" size={20} color={colors.deepTeal} /><Text style={styles.captureLabel}>{trigger.reading ? "正在讀取照片…" : "也可以拍照"}</Text>
        </Pressable>} />
    </View>
    <Text style={styles.note}>先在對話核對，再自行送出。</Text>
    {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({
  section: { gap: spacing.sm, minWidth: 0 }, actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.md },
  capture: { minWidth: 44, minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, backgroundColor: "transparent", borderRadius: 8 },
  captureLabel: { fontFamily: chineseFont, color: colors.deepTeal, fontSize: 16, lineHeight: 24, fontWeight: "600" },
  note: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta }, error: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.body },
  pressed: { backgroundColor: colors.paleTeal }, disabled: { opacity: 0.5 },
});
