import type { WriteOperationView, WriteRecoveryActions } from "../view-model";
import { AppButton } from "./ui";
import { OperationNotice } from "./OperationNotice";

// Only presents controller-supplied state and allowed recovery actions; never creates an operation.
export function WriteRecoveryNotice({ operation: op, recovery, online = true }: {
  operation: WriteOperationView; recovery?: WriteRecoveryActions; online?: boolean;
}) {
  const title = op.resultUnavailable ? "原操作已確認 · 結果不可讀" : op.recovery === "reload" ? "原操作已確認 · 待重讀結果"
    : ({ none: "操作狀態", needs_confirmation: "待確認", saving: "處理中", saved: "已保存", failed: "未能保存", unknown: "尚未確認操作結果", conflict: "版本衝突 · 尚未保存" } as const)[op.state];
  return <OperationNotice state={op.state} title={title} message={op.message} referenceLabel={op.referenceLabel ?? (op.reference ? `原操作參考：${op.reference}` : undefined)}>
    {op.state === "unknown" && op.recovery !== "reload" && recovery?.checkOriginalOperation ? <AppButton label="查核原操作" onPress={recovery.checkOriginalOperation} disabled={!online} /> : null}
    {op.state === "unknown" && op.recovery === "retry" && recovery?.retryOriginalOperation ? <AppButton label="重試同一原操作" onPress={recovery.retryOriginalOperation} disabled={!online} /> : null}
    {op.state === "unknown" && op.recovery === "reload" && recovery?.reloadCurrent ? <AppButton label="重新讀取目前資料" onPress={recovery.reloadCurrent} disabled={!online} /> : null}
  </OperationNotice>;
}
