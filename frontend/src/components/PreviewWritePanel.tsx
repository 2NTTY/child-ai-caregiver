import { StyleSheet, View } from "react-native";
import { Text } from "react-native-paper";
import type { PreviewOperationController, PreviewWriteOperation, PreviewWriteOutcome } from "../preview/usePreviewOperation";
import { chineseFont, colors, spacing, typeScale } from "../theme";
import { AppButton, AppSelect } from "./ui";
import { OperationNotice } from "./OperationNotice";

export function PreviewWriteNotice({ controller, operation, onCheckOriginal, onRetryOriginal, onReloadCurrent, online = true }: {
  controller?: PreviewOperationController; operation?: PreviewWriteOperation; online?: boolean;
  onCheckOriginal?: () => void; onRetryOriginal?: () => void; onReloadCurrent?: () => void;
}) {
  const op = operation ?? controller?.operation;
  if (!op) return null;
  const title = op.resultUnavailable ? "原操作已確認 · 結果不可讀" : op.recovery === "reload" ? "原操作已確認 · 待重讀結果"
    : ({ none: "操作狀態", needs_confirmation: "待確認", saving: "處理中", saved: "已保存", failed: "未能保存", unknown: "尚未確認操作結果", conflict: "版本衝突 · 尚未保存" } as const)[op.state];
  return <OperationNotice state={op.state} title={title} message={op.message}
    referenceLabel={op.reference ? `合成操作參考：${op.reference}；不是 Server opId。` : undefined}>
    {op.state === "unknown" && op.recovery !== "reload" && (onCheckOriginal || controller) ? <AppButton label="查核原操作" onPress={onCheckOriginal ?? controller!.check} disabled={!online} /> : null}
    {op.state === "unknown" && op.recovery === "retry" && (onRetryOriginal || controller) ? <AppButton label="重試同一原操作" onPress={onRetryOriginal ?? controller!.retryOriginal} disabled={!online} /> : null}
    {op.state === "unknown" && op.recovery === "reload" && (onReloadCurrent || controller) ? <AppButton label="重新讀取目前資料" onPress={onReloadCurrent ?? controller!.reloadCurrent} disabled={!online} /> : null}
  </OperationNotice>;
}

export function PreviewWriteControls({ controller, conflict = true }: { controller: PreviewOperationController; conflict?: boolean }) {
  const options: { value: PreviewWriteOutcome; label: string }[] = [{ value: "success", label: "成功" }, { value: "failed", label: "失敗" }, { value: "unknown", label: "結果未知" }, ...(conflict ? [{ value: "conflict" as const, label: "版本衝突" }] : [])];
  return <View style={styles.controls}><Text style={styles.meta}>合成情境工具 · 沒有連接 Server</Text>
    <AppSelect label="模擬提交結果" value={controller.outcome} options={options} onChange={controller.setOutcome} disabled={controller.locked && controller.operation.recovery !== "retry"} />
    <AppSelect label="模擬查核結果" value={controller.checkOutcome} options={[{ value: "unknown", label: "仍未查明" }, { value: "saved", label: "已確認並讀回" }, { value: "not_applied", label: "尚無確認收據" }, { value: "confirmed_unavailable", label: "已確認但結果不可讀" }, { value: "reload_failed", label: "已確認但讀取失敗" }]} onChange={controller.setCheckOutcome} />
    {controller.operation.recovery === "reload" ? <AppSelect label="模擬重讀結果" value={controller.readOutcome} options={[{ value: "success", label: "讀回目前資料" }, { value: "failed", label: "讀取失敗" }, { value: "unavailable", label: "已刪除或不可讀" }]} onChange={controller.setReadOutcome} /> : null}
  </View>;
}
const styles = StyleSheet.create({ meta: { fontFamily: chineseFont, color: colors.muted, fontSize: typeScale.caption, lineHeight: 20 }, controls: { gap: spacing.sm } });
