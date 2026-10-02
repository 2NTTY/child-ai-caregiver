import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Portal, Text } from "react-native-paper";
import { AppDialog } from "../AppDialog";
import { AppIcon, type AppIconName } from "../AppIcon";
import { AppMenuList } from "../AppMenuList";
import { PhotoFilePicker, type PhotoFilePickerProps } from "../photos/PhotoFilePicker";
import { AppButton } from "../ui";
import { chineseFont, colors, mobileIcons, mobileLayout, radius, spacing, typeScale } from "../../theme";

// Capture stays in the composer; the other callbacks open existing photo/source workflows.
export function AgentInputToolbar({ disabled, compact, onPhotos, onSources, onUseText, onPickPhoto, onPhotoError, captureOriginal }: {
  disabled: boolean; compact: boolean; onPhotos: () => void; onSources: () => void; onUseText: () => void;
  onPickPhoto: PhotoFilePickerProps["onPick"]; onPhotoError: PhotoFilePickerProps["onError"]; captureOriginal?: PhotoFilePickerProps["captureOriginal"];
}) {
  const [dialog, setDialog] = useState<"files" | "voice" | null>(null);
  const returnToText = useRef(false);
  useEffect(() => { if (disabled) setDialog(null); }, [disabled]);
  const controls: { key: string; label: string; icon: AppIconName; onPress: () => void }[] = [
    { key: "files", label: "檔案與來源", icon: "paperclip", onPress: () => setDialog("files") },
    { key: "voice", label: "語音輸入", icon: "microphone-outline", onPress: () => setDialog("voice") },
  ];
  function openPhotos() { setDialog(null); onPhotos(); }
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
    <PhotoFilePicker disabled={disabled} capturePreferred captureOriginal={captureOriginal} onPick={onPickPhoto} onError={onPhotoError}
      renderTrigger={trigger => <InputControl label={trigger.reading ? "正在讀取原照片" : "拍照"} icon="camera-outline" compact={compact}
        disabled={trigger.disabled} busy={trigger.reading} hint={trigger.unavailableReason} onPress={trigger.onPress} />} />
    {controls.map(({ key, ...control }) => <InputControl key={key} {...control} compact={compact} disabled={disabled} expanded={key === dialog} />)}
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

function InputControl({ label, icon, onPress, compact, disabled, expanded, busy = false, hint }: {
  label: string; icon: AppIconName; onPress: () => void; compact: boolean; disabled: boolean; expanded?: boolean; busy?: boolean; hint?: string;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint}
    accessibilityState={{ disabled, busy, ...(expanded === undefined ? {} : { expanded }) }} aria-disabled={disabled} aria-expanded={expanded} aria-busy={busy}
    disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.control, disabled && styles.disabled, pressed && styles.pressed]}>
    <AppIcon name={icon} size={mobileIcons.content} color={colors.ink} />{!compact ? <Text style={styles.label}>{label}</Text> : null}
  </Pressable>;
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
