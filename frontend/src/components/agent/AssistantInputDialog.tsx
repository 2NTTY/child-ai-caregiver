import { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import { Portal, Text } from "react-native-paper";
import type { AssistantAttachment } from "../../assistant-draft";
import { chineseFont, colors, spacing } from "../../theme";
import { AppDialog } from "../AppDialog";
import { AppButton } from "../ui";
import { AppScrollView } from "../AppScrollView";
import { AssistantAttachmentPicker, type AssistantAttachmentPickerProps } from "./AssistantAttachmentPicker";

export function AssistantInputDialog({ kind, enabled, onPick, onDismiss, onSources, selectAttachment }: {
  kind: "file" | null; enabled: boolean; onPick(attachment: AssistantAttachment): void; onDismiss(): void;
  onSources?(): void; selectAttachment?: AssistantAttachmentPickerProps["selectAttachment"];
}) {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setError(null); }, [kind]);
  return <Portal><AppDialog visible={!!kind && enabled} onDismiss={onDismiss} testID="assistant-input-dialog">
    <AppDialog.Title>加入文件</AppDialog.Title>
    <AppDialog.Content><AppScrollView style={{ flexGrow: 0 }} contentContainerStyle={styles.content}>
      <Text style={styles.body}>選取文件並加入草稿，可補充想請助手處理的事情，再送出。</Text>
      <Text style={styles.note}>各類檔案均可傳送，每則一份、最多 20 MiB。不支援預覽。</Text>
      {kind ? <AssistantAttachmentPicker key={kind} kind={kind} disabled={!enabled} selectAttachment={selectAttachment} onError={setError}
        onPick={attachment => { setError(null); onPick(attachment); }} /> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {kind === "file" && onSources ? <AppButton label="管理私人來源" variant="quiet" onPress={onSources} /> : null}
    </AppScrollView></AppDialog.Content>
    <AppDialog.Actions><AppButton label="取消" variant="quiet" onPress={onDismiss} /></AppDialog.Actions>
  </AppDialog></Portal>;
}
const styles = StyleSheet.create({ content: { gap: spacing.md }, body: { fontFamily: chineseFont, color: colors.ink, fontSize: 14, lineHeight: 22 },
  note: { fontFamily: chineseFont, color: colors.muted, fontSize: 12, lineHeight: 18 }, error: { fontFamily: chineseFont, color: colors.warningInk, fontSize: 14, lineHeight: 22 } });
