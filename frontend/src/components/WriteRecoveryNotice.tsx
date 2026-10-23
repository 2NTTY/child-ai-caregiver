import type { WriteOperationView, WriteRecoveryActions } from "../view-model";
import { AppButton } from "./ui";
import { OperationNotice } from "./OperationNotice";

// Only presents controller-supplied state and allowed recovery actions; never creates an operation.
export function WriteRecoveryNotice({ operation: op, recovery, online = true, showReference = true, plainLanguage = false }: {
  operation: WriteOperationView; recovery?: WriteRecoveryActions; online?: boolean; showReference?: boolean; plainLanguage?: boolean;
}) {
  const title = plainLanguage && op.state === "unknown" ? "儲存結果未確認" : plainLanguage && op.state === "failed" ? "未能儲存" : plainLanguage && op.state === "conflict" ? "內容需要確認" : op.resultUnavailable ? "已提交，結果暫時無法顯示" : (op.state === "saved" || op.state === "unknown") && op.recovery === "reload" ? "已提交，待更新結果"
    : ({ none: "操作狀態", needs_confirmation: "待確認", saving: "處理中", saved: "已保存", failed: "未能保存", unknown: "尚未確認操作結果", conflict: "版本衝突 · 尚未保存" } as const)[op.state];
  return <OperationNotice state={op.state} title={title} message={op.message} referenceLabel={showReference ? op.referenceLabel ?? (op.reference ? `原操作參考：${op.reference}` : undefined) : undefined}>
    {(op.state === "failed" || op.state === "conflict") && op.recovery === "check" && recovery?.reloadCurrent ? <AppButton label="重新載入" onPress={recovery.reloadCurrent} disabled={!online} /> : null}
    {op.state === "unknown" && op.recovery !== "reload" && recovery?.checkOriginalOperation ? <AppButton label={plainLanguage ? "查看儲存結果" : "查核原操作"} onPress={recovery.checkOriginalOperation} disabled={!online} /> : null}
    {op.state === "unknown" && op.recovery === "retry" && recovery?.retryOriginalOperation ? <AppButton label={plainLanguage ? "再試一次" : "重試同一原操作"} onPress={recovery.retryOriginalOperation} disabled={!online} /> : null}
    {op.state === "unknown" && op.recovery === "reload" && recovery?.reloadCurrent ? <AppButton label={plainLanguage ? "重新載入" : "重新讀取目前資料"} onPress={recovery.reloadCurrent} disabled={!online} /> : null}
  </OperationNotice>;
}
