import { useState } from "react";
import { usePathname } from "expo-router";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { HomeActions, HomeChild } from "../view-model";
import { chineseFont, colors, mobileIcons, mobileLayout, readingType, radius, spacing } from "../theme";
import { PreviewLink } from "../preview/PreviewNavigationGuard";
import { AppIcon } from "./AppIcon";
import { RouteTextLink } from "./RouteTextLink";
import { PhotoFilePicker, type PhotoFilePickerProps } from "./photos/PhotoFilePicker";

export type HomeQuickActionsProps = {
  child: HomeChild | undefined; scopeKey: string | null; available: boolean; onPhoto: HomeActions["openAgentPhoto"];
  captureOriginal?: PhotoFilePickerProps["captureOriginal"];
};
export function HomeQuickActions(props: HomeQuickActionsProps) {
  const active = usePathname() === "/";
  // The picker is scoped: replacing a child stops capture and rejects late file reads.
  return <HomeAgentCapture key={JSON.stringify([props.scopeKey, active])} {...props} active={active} />;
}
function HomeAgentCapture({ child, available: admitted, onPhoto, captureOriginal, active }: HomeQuickActionsProps & { active: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(false);
  const available = !!child && active && admitted;
  if (!child) return null;
  const ask = <Pressable testID="home-ask-question" accessibilityRole={available ? "link" : "button"} accessibilityLabel="問照顧問題"
    disabled={!available} accessibilityState={{ disabled: !available }} aria-disabled={!available}
    onHoverIn={() => setHighlighted(true)} onHoverOut={() => setHighlighted(false)} onPressIn={() => setHighlighted(true)} onPressOut={() => setHighlighted(false)}
    style={StyleSheet.flatten([styles.ask, highlighted && styles.askActive, (!available) && styles.disabled])}>
    <AppIcon name="message-text-outline" size={22} color={colors.onAccent} /><Text style={styles.askLabel}>問照顧問題</Text><AppIcon name="arrow-right" size={18} color={colors.onAccent} />
  </Pressable>;
  return <View testID="home-quick-actions" style={styles.section}>
    <View style={styles.actions}>
      {available ? <PreviewLink href="/chat">{ask}</PreviewLink> : ask}
    </View>
    <View testID="mobile-quick-actions" style={styles.directTools}>
      {available ? <><RouteTextLink href="/care" label={child.accessRole === "viewer" ? "照顧記錄" : "記低一件事"} /><RouteTextLink href="/tasks" label="待辦事項" /></> : null}
      <PhotoFilePicker disabled={!available} capturePreferred captureOriginal={captureOriginal}
        onPick={original => { setError(null); onPhoto(original); }} onError={setError}
        renderTrigger={trigger => <Pressable testID="home-agent-camera" accessibilityRole="button" accessibilityLabel="拍照給助手"
          accessibilityHint={trigger.unavailableReason ?? "拍攝後在目前孩子的對話中檢視；不會自動上傳或保存"}
          accessibilityState={{ disabled: trigger.disabled, busy: trigger.reading }} aria-disabled={trigger.disabled} aria-busy={trigger.reading}
          disabled={trigger.disabled} onPress={() => { setError(null); trigger.onPress(); }}
          style={({ pressed }) => [styles.camera, trigger.disabled && styles.disabled, pressed && !trigger.disabled && styles.pressed]}>
          <AppIcon name="camera-outline" size={mobileIcons.content} /><Text style={styles.cameraLabel}>{trigger.reading ? "正在讀取照片…" : "拍照給助手"}</Text>
        </Pressable>} />
    </View>
    {Platform.OS !== "web" && !captureOriginal ? <Text style={styles.note}>相機暫不可用，可先用文字輸入。</Text> : null}
    {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
  </View>;
}
const styles = StyleSheet.create({
  section: { gap: spacing.xs, minWidth: 0 },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: spacing.xl, rowGap: spacing.xs },
  ask: { minHeight: 52, minWidth: 0, maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, backgroundColor: colors.accent, borderRadius: radius.small },
  askActive: { backgroundColor: colors.accentPressed }, askLabel: { fontFamily: chineseFont, color: colors.onAccent, ...readingType.body, fontWeight: "700", flexShrink: 1 },
  directTools: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: spacing.md, minWidth: 0 },
  note: { fontFamily: chineseFont, color: colors.muted, ...readingType.meta, flexShrink: 1 },
  camera: { minHeight: mobileLayout.touchTarget, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.xs, borderRadius: radius.small },
  cameraLabel: { fontFamily: chineseFont, color: colors.ink, ...readingType.tool },
  error: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.tool }, pressed: { backgroundColor: colors.pressedOverlay }, disabled: { opacity: 0.5 },
});
