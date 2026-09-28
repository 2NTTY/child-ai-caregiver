import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { HomeChild } from "../view-model";
import { usePreviewOperation } from "../preview/usePreviewOperation";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";
import { AppCheckbox } from "./AppCheckbox";
import { AppButton } from "./ui";
import { PreviewWriteControls, PreviewWriteNotice } from "./PreviewWritePanel";

export function DeleteChildPreview({ child, online, enabled, onDeleted, onActiveChange }: { child: HomeChild; online: boolean; enabled: boolean; onDeleted: (id: string) => void; onActiveChange: (active: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const op = usePreviewOperation();
  useEffect(() => { onActiveChange(open); return () => onActiveChange(false); }, [open, onActiveChange]);
  if (child.accessRole !== "owner") return null;
  return <View style={styles.root}><Text style={styles.heading}>擁有人操作</Text><Text style={styles.body}>刪除整位孩子與刪除檔案是不同範圍。只有擁有人可啟動此操作。</Text>
    {!open ? <AppButton label="刪除整位孩子（預覽）" variant="quiet" disabled={!enabled || !online} onPress={() => { setOpen(true); setChecked(false); op.review(); }} /> : <View style={styles.review}>
      <Text style={styles.heading}>再次確認刪除「{child.displayName}」</Text><Text style={styles.body}>會永久刪除孩子及全部已保存照顧記錄、私人聊天和關聯資料，無法從歷史恢復。這個預覽只移除合成孩子；不呼叫 Server。</Text>
      <PreviewWriteNotice controller={op} online={online && enabled} />
      <AppCheckbox label={`我明白會永久刪除${child.displayName}及全部關聯資料`} checked={checked} disabled={op.locked || !enabled} onChange={setChecked} />
      <AppButton label="確認並模擬刪除整位孩子" disabled={!online || !enabled || !checked || op.locked || op.operation.state !== "needs_confirmation"} onPress={() => op.submit(() => onDeleted(child.id))} />
      {op.operation.state === "failed" ? <AppButton label="重新核對刪除範圍" variant="secondary" disabled={!online || !enabled} onPress={() => { setChecked(false); op.review(); }} /> : null}
      <AppButton label="取消刪除孩子" variant="quiet" disabled={op.locked} onPress={() => { op.reset(); setChecked(false); setOpen(false); }} />
      <PreviewWriteControls controller={op} conflict={false} />
    </View>}
  </View>;
}
const styles = StyleSheet.create({ root: { gap: spacing.md }, review: { gap: spacing.md, backgroundColor: colors.paleCoral, padding: spacing.md, borderRadius: radius.small },
  heading: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, fontWeight: "700", lineHeight: 23 }, body: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.small, lineHeight: 23 } });
