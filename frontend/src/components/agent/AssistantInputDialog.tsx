import { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import { Portal, Text } from "react-native-paper";
import type { AssistantAttachment } from "../../assistant-draft";
import { chineseFont, colors, spacing } from "../../theme";
import { AppDialog } from "../AppDialog";
import { AppButton } from "../ui";
import { VoiceCapture } from "./VoiceCapture";
import { AppScrollView } from "../AppScrollView";
import { AssistantAttachmentPicker, type AssistantAttachmentPickerProps } from "./AssistantAttachmentPicker";

export function AssistantInputDialog({ kind, enabled, onPick, onDismiss, onUseText, onSources, selectAttachment }: {
  kind: "file" | "voice" | null; enabled: boolean; onPick(attachment: AssistantAttachment): void; onDismiss(): void;
  onUseText(): void; onSources?(): void; selectAttachment?: AssistantAttachmentPickerProps["selectAttachment"];
}) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setError(null); }, [kind]);
  return <Portal><AppDialog visible={!!kind && enabled} onDismiss={onDismiss} testID="assistant-input-dialog">
    <AppDialog.Title>{kind === "voice" ? "語音輸入" : "加入文件"}</AppDialog.Title>
    <AppDialog.Content><AppScrollView style={{ flexGrow: 0 }} contentContainerStyle={styles.content}>
      <Text style={styles.body}>{kind === "voice" ? "錄音或選取音訊後，先試聽，再加入同一份未送出草稿。語音轉文字及正式發送尚未接通。" : "選取文件後，先與照片及文字放在同一份未送出草稿。此處不會讀取或整理文件內容。"}</Text>
      <Text style={styles.note}>{kind === "voice" ? "亦可選取音訊原檔；前端本地預覽上限 20 MiB，不會轉錄或上傳。" : "本地預覽接受 PDF、TXT、Word 或 CSV，最多 20 MiB。這是預覽限制，並非正式服務已支援的檔案契約。"}</Text>
      {kind === "voice" && enabled ? <VoiceCapture onPick={onPick} /> : null}
      {kind ? <AssistantAttachmentPicker key={kind} kind={kind} disabled={!enabled} selectAttachment={selectAttachment} onError={setError}
        onPick={attachment => { setError(null); onPick(attachment); }} /> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {kind === "file" && onSources ? <AppButton label="管理私人來源" variant="quiet" onPress={onSources} /> : null}
    </AppScrollView></AppDialog.Content>
    <AppDialog.Actions><AppButton label="改用文字" variant="quiet" onPress={onUseText} /><AppButton label="取消" variant="quiet" onPress={onDismiss} /></AppDialog.Actions>
  </AppDialog></Portal>;
}
const styles = StyleSheet.create({ content: { gap: spacing.md }, body: { fontFamily: chineseFont, color: colors.ink, fontSize: 14, lineHeight: 22 },
  note: { fontFamily: chineseFont, color: colors.muted, fontSize: 12, lineHeight: 18 }, error: { fontFamily: chineseFont, color: colors.warningInk, fontSize: 14, lineHeight: 22 } });
