import { Pressable, StyleSheet, View } from "react-native";
import { AppIcon, type AppIconName } from "../AppIcon";
import { PhotoFilePicker, type PhotoFilePickerProps } from "../photos/PhotoFilePicker";
import { chatColors, chatLayout } from "../chat/chat-presentation";

export function AgentInputToolbar({ disabled, compact, onFiles, onVoice, onPickPhoto, onPhotoError, captureOriginal }: {
  disabled: boolean; compact: boolean; onFiles(): void; onVoice(): void;
  onPickPhoto: PhotoFilePickerProps["onPick"]; onPhotoError: PhotoFilePickerProps["onError"]; captureOriginal?: PhotoFilePickerProps["captureOriginal"];
}) {
  return <View testID="agent-input-toolbar" style={styles.controls}>
    <PhotoFilePicker disabled={disabled} capturePreferred captureOriginal={captureOriginal} onPick={onPickPhoto} onError={onPhotoError}
      renderTrigger={trigger => <InputControl label={trigger.reading ? "正在讀取原照片" : "拍照"} icon="camera-outline" compact={compact}
        disabled={trigger.disabled} busy={trigger.reading} hint={trigger.unavailableReason} onPress={trigger.onPress} />} />
    <InputControl label="加入文件" icon="plus" compact={compact} disabled={disabled} onPress={onFiles} />
    <InputControl label="語音輸入" icon="microphone-outline" compact={compact} disabled={disabled} onPress={onVoice} />
  </View>;
}
function InputControl({ label, icon, onPress, compact, disabled, busy = false, hint }: {
  label: string; icon: AppIconName; onPress(): void; compact: boolean; disabled: boolean; busy?: boolean; hint?: string;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityHint={hint}
    accessibilityState={{ disabled, busy }} aria-disabled={disabled} aria-busy={busy}
    disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.control, compact && styles.compactControl, disabled && styles.disabled, pressed && styles.pressed]}>
    <AppIcon name={icon} size={20} color={chatColors.secondary} />
  </Pressable>;
}
const styles = StyleSheet.create({
  controls: { flexDirection: "row", alignItems: "center" },
  control: { width: chatLayout.controlSize, height: chatLayout.controlSize, alignItems: "center", justifyContent: "center", borderRadius: chatLayout.controlSize / 2 },
  compactControl: { width: chatLayout.compactControlSize, height: chatLayout.compactControlSize, borderRadius: chatLayout.compactControlSize / 2 },
  disabled: { opacity: .5 }, pressed: { backgroundColor: chatColors.hover },
});
