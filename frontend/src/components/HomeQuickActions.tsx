import { useState } from "react";
import { usePathname } from "expo-router";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { HomeActions, HomeViewModel } from "../view-model";
import { homeAgentScope } from "../home-agent-entry";
import { chineseFont, colors, radius, readingType, spacing } from "../theme";
import { AppIcon } from "./AppIcon";
import { AppButton } from "./ui";
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
  const available = !!child && active && (model.scopeKey !== undefined ? !!model.scopeKey : model.profileLoad === "ready");
  return <View testID="home-quick-actions" style={[styles.section, docked && styles.docked]}>
    <View style={styles.introduction}>
      <View style={styles.heading}><AppIcon name="message-text-outline" color={colors.teal} size={20} importantForAccessibility="no" /><Text accessibilityRole="header" aria-level={2} style={styles.title}>育兒助手</Text></View>
      <Text style={styles.body}>{child ? "有新情況或照顧問題？用文字或照片一起整理。" : "選擇孩子後，便可開始對話或補充資料。"}</Text>
    </View>
    <View testID="mobile-quick-actions" style={styles.actions}>
      <AppButton label="用文字說" accessibilityLabel="用文字告訴助手" variant="secondary" disabled={!available || opening} onPress={() => actions.open("chat")} />
      <PhotoFilePicker disabled={!available || opening} capturePreferred captureOriginal={captureOriginal}
        onPick={original => { setError(null); setOpening(true); actions.openAgentPhoto(original); }} onError={setError}
        renderTrigger={trigger => <Pressable testID="home-agent-camera" accessibilityRole="button" accessibilityLabel="拍照給助手"
          accessibilityHint={trigger.unavailableReason ?? "開啟相機，拍攝後在目前孩子的對話中檢視；不會自動上傳或保存"}
          accessibilityState={{ disabled: trigger.disabled, busy: trigger.reading || opening }} aria-disabled={trigger.disabled} aria-busy={trigger.reading || opening}
          disabled={trigger.disabled} onPress={() => { setError(null); trigger.onPress(); }}
          style={({ pressed }) => [styles.capture, trigger.disabled && styles.disabled, pressed && !trigger.disabled && styles.pressed]}>
          <AppIcon name="camera-outline" size={20} color={colors.ink} importantForAccessibility="no" />
          <Text style={styles.captureTitle}>{trigger.reading ? "正在讀取照片…" : opening ? "正在開啟對話…" : "拍照給助手"}</Text>
        </Pressable>} />
      <AppButton label="補改資料" accessibilityLabel="查看記錄及補改資料" variant="quiet" disabled={!available || opening} onPress={() => actions.open("care")} />
    </View>
    {Platform.OS !== "web" && !captureOriginal ? <Text style={styles.note}>相機暫不可用，可先用文字輸入。</Text> : null}
    {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: spacing.lg, borderTopColor: colors.line, borderTopWidth: 1, paddingTop: spacing.xl },
  docked: { flexShrink: 0, paddingVertical: spacing.sm },
  introduction: { minWidth: 0, gap: spacing.sm },
  heading: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { fontFamily: chineseFont, color: colors.ink, fontSize: 18, lineHeight: 28, fontWeight: "700" },
  body: { fontFamily: chineseFont, color: colors.muted, ...readingType.body },
  actions: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.sm },
  capture: { maxWidth: "100%", minWidth: 0, minHeight: 48, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, backgroundColor: colors.white, borderColor: colors.controlOutline, borderWidth: 1, borderRadius: radius.small },
  captureTitle: { fontFamily: chineseFont, color: colors.ink, ...readingType.body, fontWeight: "600", flexShrink: 1 },
  note: { fontFamily: chineseFont, color: colors.muted, fontSize: 14, lineHeight: 22 },
  error: { fontFamily: chineseFont, color: colors.warningInk, ...readingType.body },
  pressed: { backgroundColor: colors.pressedOverlay }, disabled: { opacity: 0.5 },
});
