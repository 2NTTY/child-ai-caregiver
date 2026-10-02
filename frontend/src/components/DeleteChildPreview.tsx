import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { AppScrollView as ScrollView } from "./AppScrollView";
import { Text } from "react-native-paper";
import type { HomeChild } from "../view-model";
import { usePreviewOperation } from "../preview/usePreviewOperation";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";
import { AppCheckbox } from "./AppCheckbox";
import { AppButton, AppTextField } from "./ui";
import { AppDialog } from "./AppDialog";
import { PreviewWriteControls, PreviewWriteNotice } from "./PreviewWritePanel";

export function DeleteChildPreview({ child, online, enabled, onDeleted, onActiveChange }: { child: HomeChild; online: boolean; enabled: boolean; onDeleted: (id: string) => void; onActiveChange: (active: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const [confirmationName, setConfirmationName] = useState("");
  const op = usePreviewOperation();
  useEffect(() => { onActiveChange(open); return () => onActiveChange(false); }, [open, onActiveChange]);
  const canSubmit = online && enabled && checked && confirmationName === child.displayName && !op.locked && op.operation.state === "needs_confirmation";
  function close() {
    if (op.locked) return;
    op.reset(); setChecked(false); setConfirmationName(""); setOpen(false);
  }
  if (child.accessRole !== "owner") return null;
  return <View style={styles.root}><Text style={styles.heading}>擁有人操作</Text><Text style={styles.body}>刪除整位孩子與刪除檔案是不同範圍。只有擁有人可啟動此操作。</Text>
    <AppButton label="刪除整位孩子（預覽）" variant="quiet" disabled={!enabled || !online || open} onPress={() => { setOpen(true); setChecked(false); setConfirmationName(""); op.review(); }} />
    <AppDialog danger visible={open} onDismiss={close}>
      <AppDialog.Title danger>永久刪除整位孩子</AppDialog.Title>
      <AppDialog.ScrollArea><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.review}>
      <Text style={styles.heading}>再次確認刪除「{child.displayName}」</Text><Text style={styles.body}>會永久刪除孩子及全部已保存照顧記錄、私人聊天和關聯資料，無法從歷史恢復。這個預覽只移除合成孩子；不呼叫 Server。</Text>
      <AppTextField label="輸入孩子稱呼以確認" accessibilityLabel="核對刪除孩子稱呼" value={confirmationName} onChangeText={setConfirmationName}
        disabled={op.locked || !enabled} autoCapitalize="none" autoCorrect={false} autoComplete="off" maxLength={80} />
      <Text style={styles.body}>請完整輸入「{child.displayName}」，並核對以下刪除範圍。</Text>
      <PreviewWriteNotice controller={op} online={online && enabled} />
      <AppCheckbox label={`我明白會永久刪除${child.displayName}及全部關聯資料`} checked={checked} disabled={op.locked || !enabled} onChange={setChecked} />
      {op.operation.state === "failed" ? <AppButton label="重新核對刪除範圍" variant="secondary" disabled={!online || !enabled} onPress={() => { setChecked(false); setConfirmationName(""); op.review(); }} /> : null}
      <PreviewWriteControls controller={op} conflict={false} />
      </ScrollView></AppDialog.ScrollArea>
      <AppDialog.Actions>
        <AppButton label="取消刪除孩子" variant="quiet" disabled={op.locked} onPress={close} />
        <AppButton label="確認並模擬刪除整位孩子" variant="danger" disabled={!canSubmit} onPress={() => { if (canSubmit) op.submit(() => onDeleted(child.id)); }} />
      </AppDialog.Actions>
    </AppDialog>
  </View>;
}
const styles = StyleSheet.create({ root: { gap: spacing.md }, review: { gap: spacing.md, backgroundColor: colors.paleCoral, padding: spacing.md, borderRadius: radius.small },
  heading: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "700", lineHeight: 23 }, body: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 23 } });
