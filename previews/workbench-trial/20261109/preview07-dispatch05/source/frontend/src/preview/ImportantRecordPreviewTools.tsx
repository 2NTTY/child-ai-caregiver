import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import { AppButton, AppSelect } from "../components/ui";
import { ImportantRecordConfirmation } from "../components/care/ImportantRecordConfirmation";
import { useCarePreviewWorkspace } from "./CareWorkspaceProvider";
import { chineseFont, colors, readingType, spacing } from "../theme";

// Only rendered inside the existing Agent preview tools, not among normal chat actions.
export function ImportantRecordPreviewTools({ onEdit }: { onEdit: (recordId: string) => void }) {
  const workspace = useCarePreviewWorkspace();
  const [itemId, setItemId] = useState<string | null>(null);
  useEffect(() => { setItemId(null); }, [workspace?.scopeKey]);
  if (!workspace) return null;
  const item = workspace.model.review?.items.find(candidate => candidate.id === `preview-capture:${workspace.model.child.id}:important-appointment`);
  const busy = ["saving", "unknown"].includes(workspace.model.operation.state);
  return <View style={styles.content}><Text style={styles.label}>重要記錄確認示例</Text><Text style={styles.meta}>正式對話／來源關聯、自動彈窗及跨重載確認狀態尚未接通。此工具只測試聊天與核對頁共用的合成狀態。</Text>
    <AppSelect label="模擬重要確認結果" value={workspace.outcome} options={[{ value: "success", label: "成功" }, { value: "unknown", label: "結果未知" }, { value: "failed", label: "失敗" }, { value: "conflict", label: "版本改變" }]} onChange={workspace.setOutcome} disabled={busy} />
    <AppSelect label="模擬重要確認查核" value={workspace.lookupOutcome} options={[{ value: "unknown", label: "仍未查明" }, { value: "saved", label: "已確認" }, { value: "not_applied", label: "未取得確認收據" }]} onChange={workspace.setLookupOutcome} />
    <AppButton label="開啟重要記錄確認（合成示例）" variant="secondary" disabled={!item} onPress={() => setItemId(item?.id ?? null)} />
    <ImportantRecordConfirmation model={workspace.model} actions={workspace.actions} visible={!!itemId} demoItemId={itemId ?? undefined} onDismiss={() => setItemId(null)} onEdit={id => { setItemId(null); onEdit(id); }} />
  </View>;
}
const styles = StyleSheet.create({ content: { gap: spacing.md, paddingVertical: spacing.md }, label: { fontFamily: chineseFont, ...readingType.tool, fontWeight: "700", color: colors.ink }, meta: { fontFamily: chineseFont, ...readingType.meta, color: colors.muted } });
