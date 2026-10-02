import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { PreviewOperationController, PreviewWriteOperation, PreviewWriteOutcome } from "../preview/usePreviewOperation";
import { chineseFont, colors, radius, spacing, typeScale } from "../theme";
import { AppButton, AppSelect, OperationPill } from "./ui";

export function PreviewWriteNotice({ controller, operation, onCheckOriginal, onRetryOriginal, onReloadCurrent, online = true }: {
  controller?: PreviewOperationController; operation?: PreviewWriteOperation; online?: boolean;
  onCheckOriginal?: () => void; onRetryOriginal?: () => void; onReloadCurrent?: () => void;
}) {
  const op = operation ?? controller?.operation;
  if (!op) return null;
  if (op.state === "none" && !op.message) return null;
  return <View accessibilityRole="alert" style={[styles.notice, op.state === "saved" && styles.saved, op.state === "failed" && styles.failed,
    (op.state === "needs_confirmation" || op.state === "unknown" || op.state === "conflict") && styles.attention]}>
    {op.resultUnavailable ? <Text style={styles.title}>原操作已確認 · 結果不可讀</Text> : op.recovery === "reload" ? <Text style={styles.title}>原操作已確認 · 待重讀結果</Text> : op.state === "conflict" ? <Text style={styles.title}>版本衝突 · 尚未保存</Text> : <OperationPill state={op.state} />}
    <Text style={styles.body}>{op.message}</Text>{op.reference ? <Text style={styles.meta}>合成操作參考：{op.reference}；不是 Server opId。</Text> : null}
    {op.state === "unknown" && op.recovery !== "reload" && (onCheckOriginal || controller) ? <AppButton label="查核原操作" onPress={onCheckOriginal ?? controller!.check} disabled={!online} /> : null}
    {op.state === "unknown" && op.recovery === "retry" && (onRetryOriginal || controller) ? <AppButton label="重試同一原操作" onPress={onRetryOriginal ?? controller!.retryOriginal} disabled={!online} /> : null}
    {op.state === "unknown" && op.recovery === "reload" && (onReloadCurrent || controller) ? <AppButton label="重新讀取目前資料" onPress={onReloadCurrent ?? controller!.reloadCurrent} disabled={!online} /> : null}
  </View>;
}

export function PreviewWriteControls({ controller, conflict = true }: { controller: PreviewOperationController; conflict?: boolean }) {
  const options: { value: PreviewWriteOutcome; label: string }[] = [{ value: "success", label: "成功" }, { value: "failed", label: "失敗" }, { value: "unknown", label: "結果未知" }, ...(conflict ? [{ value: "conflict" as const, label: "版本衝突" }] : [])];
  return <View style={styles.controls}><Text style={styles.meta}>合成情境工具 · 沒有連接 Server</Text>
    <AppSelect label="模擬提交結果" value={controller.outcome} options={options} onChange={controller.setOutcome} disabled={controller.locked && controller.operation.recovery !== "retry"} />
    <AppSelect label="模擬查核結果" value={controller.checkOutcome} options={[{ value: "unknown", label: "仍未查明" }, { value: "saved", label: "已確認並讀回" }, { value: "not_applied", label: "尚無確認收據" }, { value: "confirmed_unavailable", label: "已確認但結果不可讀" }, { value: "reload_failed", label: "已確認但讀取失敗" }]} onChange={controller.setCheckOutcome} />
    {controller.operation.recovery === "reload" ? <AppSelect label="模擬重讀結果" value={controller.readOutcome} options={[{ value: "success", label: "讀回目前資料" }, { value: "failed", label: "讀取失敗" }, { value: "unavailable", label: "已刪除或不可讀" }]} onChange={controller.setReadOutcome} /> : null}
  </View>;
}
const styles = StyleSheet.create({ notice: { backgroundColor: colors.quietSurface, padding: spacing.md, gap: spacing.sm, borderRadius: radius.small }, saved: { backgroundColor: colors.paleTeal }, failed: { backgroundColor: colors.paleCoral }, attention: { backgroundColor: colors.paleAmber }, title: { fontFamily: chineseFont, color: colors.warningInk, fontSize: typeScale.small, fontWeight: "700" }, body: { fontFamily: chineseFont, color: colors.ink, fontSize: typeScale.small, lineHeight: 23 }, meta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 }, controls: { gap: spacing.sm } });
