import { useState } from "react";
import { usePathname } from "expo-router";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { HomeActions, HomeViewModel } from "../view-model";
import { homeAgentScope } from "../home-agent-entry";
import { chineseFont, colors, mobileIcons, mobileLayout, mobileType, radius, spacing } from "../theme";
import { AppIcon } from "./AppIcon";
import { PhotoFilePicker, type PhotoFilePickerProps } from "./photos/PhotoFilePicker";

type HomeQuickActionsProps = {
  model: HomeViewModel; actions: HomeActions; docked?: boolean;
  captureOriginal?: PhotoFilePickerProps["captureOriginal"];
};

export function HomeQuickActions(props: HomeQuickActionsProps) {
  const active = usePathname() === "/";
  // Replacing the scope unmounts the picker, stops capture and discards late file reads.
  return <HomeAgentCapture key={JSON.stringify([homeAgentScope(props.model), active])} {...props} active={active} />;
}

function HomeAgentCapture({ model, actions, docked = false, captureOriginal, active }: HomeQuickActionsProps & { active: boolean }) {
  const child = model.children.find(item => item.id === model.selectedChildId);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const available = !!child && model.profileLoad === "ready" && active;
  return <View testID="home-quick-actions" style={[styles.section, docked && styles.docked]}>
    <Text accessibilityRole="header" style={styles.heading}>{child ? `記下${child.displayName}的日常` : "隨手記下，交給助手"}</Text>
    <View style={styles.captureRow}><PhotoFilePicker disabled={!available || opening} capturePreferred captureOriginal={captureOriginal}
      onPick={original => { setError(null); setOpening(true); actions.openAgentPhoto(original); }} onError={setError}
      renderTrigger={trigger => <Pressable testID="home-agent-camera" accessibilityRole="button" accessibilityLabel="拍照給助手"
        accessibilityHint={trigger.unavailableReason ?? "開啟相機，拍攝後在目前孩子的對話中檢視；不會自動上傳或保存"}
        accessibilityState={{ disabled: trigger.disabled, busy: trigger.reading || opening }} aria-disabled={trigger.disabled} aria-busy={trigger.reading || opening}
        disabled={trigger.disabled} onPress={() => { setError(null); trigger.onPress(); }}
        style={({ pressed }) => [styles.capture, trigger.disabled && styles.disabled, pressed && styles.pressed]}>
        <AppIcon name="camera-outline" size={mobileIcons.primary} color={colors.onAccent} />
        <View style={styles.captureCopy}><Text style={styles.captureTitle}>{trigger.reading ? "正在讀取照片" : opening ? "正在開啟對話" : "拍照給助手"}</Text>
          <Text style={styles.captureDetail}>先拍下來，再於對話中檢視</Text></View>
        <AppIcon name="arrow-right" size={mobileIcons.content} color={colors.onAccent} />
      </Pressable>} />
    <View testID="mobile-quick-actions" style={styles.secondaryActions}>
      <Pressable accessibilityRole="button" accessibilityLabel="用文字告訴助手" accessibilityState={{ disabled: !available || opening }} aria-disabled={!available || opening}
        disabled={!available || opening} onPress={() => actions.open("chat")} style={({ pressed }) => [styles.secondary, (!available || opening) && styles.disabled, pressed && styles.pressed]}>
        <AppIcon name="message-text-outline" size={mobileIcons.content} /><Text style={styles.label}>用文字說</Text>
      </Pressable>
      <View accessibilityRole="button" accessibilityLabel="語音未接通" accessibilityState={{ disabled: true }} aria-disabled style={[styles.secondary, styles.disabled]}>
        <AppIcon name="microphone-outline" size={mobileIcons.content} /><Text style={styles.label}>語音未接通</Text>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="查看記錄及補改資料" accessibilityState={{ disabled: !available || opening }} aria-disabled={!available || opening}
        disabled={!available || opening} onPress={() => actions.open("care")} style={({ pressed }) => [styles.secondary, (!available || opening) && styles.disabled, pressed && styles.pressed]}>
        <AppIcon name="notebook-outline" size={mobileIcons.content} /><Text style={styles.label}>補改資料</Text>
      </Pressable>
    </View></View>
    <Text style={styles.note}>{Platform.OS !== "web" && !captureOriginal ? "原生相機未接通；可先用文字輸入。" : "照片只作本地預覽；Agent 整理及保存尚未接通。"}</Text>
    {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm, padding: spacing.md, backgroundColor: colors.quietSurface, borderColor: colors.softLine, borderWidth: 1, borderRadius: radius.medium },
  docked: { flexShrink: 0, borderRadius: 0, borderWidth: 0, borderTopWidth: 1, paddingVertical: spacing.sm },
  heading: { fontFamily: chineseFont, color: colors.ink, ...mobileType.itemTitle, fontWeight: "700" },
  captureRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.md },
  capture: { flexGrow: 1, flexBasis: 260, minWidth: 0, minHeight: 56, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.paleAmber, borderRadius: radius.small },
  captureCopy: { flex: 1, minWidth: 0, gap: spacing.xs },
  captureTitle: { fontFamily: chineseFont, color: colors.onAccent, ...mobileType.bodyLarge, fontWeight: "700" },
  captureDetail: { fontFamily: chineseFont, color: colors.onAccent, ...mobileType.caption },
  secondaryActions: { flexGrow: 1, flexBasis: 240, flexDirection: "row", gap: spacing.xs },
  secondary: { flex: 1, minWidth: mobileLayout.touchTarget, minHeight: mobileLayout.touchTarget, alignItems: "center", justifyContent: "center", gap: spacing.xs, paddingHorizontal: spacing.xs },
  label: { fontFamily: chineseFont, color: colors.ink, ...mobileType.label, textAlign: "center" },
  note: { fontFamily: chineseFont, color: colors.muted, ...mobileType.caption },
  error: { fontFamily: chineseFont, color: colors.warningInk, ...mobileType.body },
  pressed: { opacity: 0.68 }, disabled: { opacity: 0.5 },
});
