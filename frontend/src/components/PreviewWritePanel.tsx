import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { PreviewOperationController, PreviewWriteOutcome } from "../preview/usePreviewOperation";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";
import { AppButton, AppSelect, OperationPill } from "./ui";

export function PreviewWriteNotice({ controller, online = true }: { controller: PreviewOperationController; online?: boolean }) {
  const op = controller.operation;
  if (op.state === "none" && !op.message) return null;
  return <View accessibilityRole="alert" style={styles.notice}>
    {op.state === "conflict" ? <Text style={styles.title}>版本衝突 · 尚未保存</Text> : <OperationPill state={op.state} />}
    <Text style={styles.body}>{op.message}</Text>{op.reference ? <Text style={styles.meta}>合成操作參考：{op.reference}；不是 Server opId。</Text> : null}
    {op.state === "unknown" ? <AppButton label="模擬查核原操作" onPress={controller.check} disabled={!online} /> : null}
  </View>;
}

export function PreviewWriteControls({ controller, conflict = true }: { controller: PreviewOperationController; conflict?: boolean }) {
  const options: { value: PreviewWriteOutcome; label: string }[] = [{ value: "success", label: "成功" }, { value: "failed", label: "失敗" }, { value: "unknown", label: "結果未知" }, ...(conflict ? [{ value: "conflict" as const, label: "版本衝突" }] : [])];
  return <View style={styles.controls}><Text style={styles.meta}>合成情境工具 · 沒有連接 Server</Text>
    <AppSelect label="模擬提交結果" value={controller.outcome} options={options} onChange={controller.setOutcome} disabled={controller.locked} />
    <AppSelect label="模擬查核結果" value={controller.checkOutcome} options={[{ value: "unknown", label: "仍未查明" }, { value: "saved", label: "已保存" }, { value: "not_applied", label: "確認未保存" }]} onChange={controller.setCheckOutcome} />
  </View>;
}
const styles = StyleSheet.create({ notice: { backgroundColor: colors.paleAmber, padding: spacing.md, gap: spacing.sm, borderRadius: radius.small }, title: { fontFamily: chineseFont, color: colors.warningInk, fontSize: typeScale.small, fontWeight: "700" }, body: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, lineHeight: 23 }, meta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 }, controls: { gap: spacing.sm } });
