import { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import { Portal, Text } from "react-native-paper";
import { PhotoFilePicker, type PhotoFilePickerProps } from "../photos/PhotoFilePicker";
import { photoAttachment, type AssistantAttachment } from "../../assistant-draft";
import { chineseFont, colors, spacing } from "../../theme";
import { AppDialog } from "../AppDialog";
import { AppButton } from "../ui";
import { AppScrollView } from "../AppScrollView";
import { AssistantAttachmentPicker, type AssistantAttachmentPickerProps } from "./AssistantAttachmentPicker";

export function AssistantInputDialog({ kind, enabled, onPick, onDismiss, selectAttachment, captureOriginal }: {
  kind: "file" | null; enabled: boolean; onPick(attachment: AssistantAttachment): void; onDismiss(): void;
  captureOriginal?: PhotoFilePickerProps['captureOriginal']; selectAttachment?: AssistantAttachmentPickerProps["selectAttachment"];
}) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setError(null); }, [kind]);
  return <Portal><AppDialog visible={!!kind && enabled} onDismiss={onDismiss} testID="assistant-input-dialog">
    <AppDialog.Title>加入附件</AppDialog.Title>
    <AppDialog.Content><AppScrollView style={{ flexGrow: 0 }} contentContainerStyle={styles.content}>
      {kind ? <PhotoFilePicker disabled={!enabled} capturePreferred captureOriginal={captureOriginal} onPick={original => onPick(photoAttachment(original))} onError={setError}
        renderTrigger={trigger => <AppButton label="拍照" variant="secondary" disabled={trigger.disabled} loading={trigger.reading} onPress={trigger.onPress} />} /> : null}
      {kind ? <PhotoFilePicker disabled={!enabled} onPick={original => onPick(photoAttachment(original))} onError={setError}
        renderTrigger={trigger => <AppButton label="從相簿選取" variant="secondary" disabled={trigger.disabled} loading={trigger.reading} onPress={trigger.onPress} />} /> : null}
      {kind ? <AssistantAttachmentPicker key={kind} kind={kind} disabled={!enabled} selectAttachment={selectAttachment} onError={setError}
        onPick={attachment => { setError(null); onPick(attachment); }} /> : null}
      {kind ? <AssistantAttachmentPicker kind="voice" disabled={!enabled} selectAttachment={selectAttachment} onPick={onPick} onError={setError} /> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </AppScrollView></AppDialog.Content>
    <AppDialog.Actions><AppButton label="取消" variant="quiet" onPress={onDismiss} /></AppDialog.Actions>
  </AppDialog></Portal>;
}
const styles = StyleSheet.create({ content: { gap: spacing.sm }, error: { fontFamily: chineseFont, color: colors.warningInk, fontSize: 14, lineHeight: 22 } });
