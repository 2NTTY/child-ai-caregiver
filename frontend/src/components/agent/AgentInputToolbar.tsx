import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Portal, Text } from "react-native-paper";
import { AppDialog } from "../AppDialog";
import { AppIcon, type AppIconName } from "../AppIcon";
import { AppMenuList } from "../AppMenuList";
import { AppButton } from "../ui";
import { chineseFont, colors, mobileIcons, mobileLayout, radius, spacing, typeScale } from "../../theme";

// Navigation callbacks reuse the photo/source workflows; they do not attach files to chat.
export function AgentInputToolbar({ disabled, compact, onPhotos, onSources, onUseText }: {
  disabled: boolean; compact: boolean; onPhotos: (camera: boolean) => void; onSources: () => void; onUseText: () => void;
}) {
  const [dialog, setDialog] = useState<"files" | "voice" | null>(null);
  const returnToText = useRef(false);
  useEffect(() => { if (disabled) setDialog(null); }, [disabled]);
  const controls: { key: string; label: string; icon: AppIconName; onPress: () => void }[] = [
    { key: "camera", label: "拍照", icon: "camera-outline", onPress: () => onPhotos(true) },
    { key: "files", label: "檔案與來源", icon: "paperclip", onPress: () => setDialog("files") },
    { key: "voice", label: "語音輸入", icon: "microphone-outline", onPress: () => setDialog("voice") },
  ];
  function openPhotos() { setDialog(null); onPhotos(false); }
  function openSources() { setDialog(null); onSources(); }
  function focusTextAfterClose() {
    if (!returnToText.current) return;
    returnToText.current = false;
    requestAnimationFrame(onUseText);
  }
  function useText() {
    returnToText.current = true;
    setDialog(null);
    // Android does not emit Modal.onDismiss; Web/iOS wait for the focus trap to close.
    if (Platform.OS === "android") focusTextAfterClose();
  }
  return <><View testID="agent-input-toolbar" style={styles.controls}>
    {controls.map(control => <Pressable key={control.key} accessibilityRole="button" accessibilityLabel={control.label}
      accessibilityState={control.key === "camera" ? { disabled } : { disabled, expanded: control.key === dialog }} aria-disabled={disabled}
      aria-expanded={control.key === "camera" ? undefined : control.key === dialog} disabled={disabled}
      onPress={control.onPress} style={({ pressed }) => [styles.control, disabled && styles.disabled, pressed && styles.pressed]}>
      <AppIcon name={control.icon} size={mobileIcons.content} color={colors.ink} />{!compact ? <Text style={styles.label}>{control.label}</Text> : null}
    </Pressable>)}
  </View><Portal><AppDialog visible={dialog === "files" && !disabled} onDismiss={() => setDialog(null)}>
    <AppDialog.Title>檔案與來源</AppDialog.Title>
    <AppDialog.Content><View style={styles.content}>
      <Text style={styles.body}>選擇原照片，或貼上文字／網址；先在原有流程核對，再決定是否保存或共享。</Text>
      <AppMenuList items={[
        { key: "photos", label: "選擇照片檔案", icon: "image-outline", onPress: openPhotos },
        { key: "sources", label: "貼上文字或網址", icon: "link-variant", onPress: openSources },
      ]} />
      <Text style={styles.note}>照片支援 JPEG／PNG，每張最多 4 MiB。PDF／Word 尚未支援；照片會在照片頁核對，此預覽不會上傳檔案。</Text>
    </View></AppDialog.Content>
    <AppDialog.Actions><AppButton label="返回問題" variant="quiet" onPress={() => setDialog(null)} /></AppDialog.Actions>
  </AppDialog><AppDialog visible={dialog === "voice" && !disabled} onDismiss={() => setDialog(null)} onClosed={focusTextAfterClose}>
    <AppDialog.Title>語音輸入</AppDialog.Title>
    <AppDialog.Content><View style={styles.content}><Text style={styles.body}>語音錄入及轉文字尚未接通。目前可先用文字輸入，原有問題草稿會保留。</Text>
      <Text style={styles.note}>此預覽不會開啟咪高峰或錄音。正式接線後才處理裝置權限及錄音確認。</Text>
    </View></AppDialog.Content>
    <AppDialog.Actions><AppButton label="繼續輸入文字" onPress={useText} /></AppDialog.Actions>
  </AppDialog></Portal></>;
}

const styles = StyleSheet.create({
  controls: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.xs },
  control: { minHeight: mobileLayout.touchTarget, minWidth: mobileLayout.touchTarget, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.xs,
    paddingHorizontal: spacing.sm, borderRadius: radius.small, backgroundColor: colors.controlSurface, borderWidth: 1, borderColor: colors.line },
  label: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.caption, lineHeight: 18, fontWeight: "600" },
  disabled: { opacity: .5 }, pressed: { backgroundColor: colors.selectedNav },
  content: { gap: spacing.md }, body: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, lineHeight: 22 },
  note: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 },
});
