import type { TasksViewModel } from "../../task-view-model";
import type { WriteRecoveryActions } from "../../view-model";
import { ReadStateNotice } from "../ReadStateNotice";
import { WriteRecoveryNotice } from "../WriteRecoveryNotice";

// The task owner also reports invalid / missing linked reads through operation.failed.
// Present only that disposable read failure as a read, without changing owner state.
export function TaskOperationNotice({ model, recovery, online }: {
  model: Pick<TasksViewModel, "detailRead" | "draft" | "selected" | "operation" | "readState" | "reading" | "historyRead">;
  recovery?: WriteRecoveryActions;
  online: boolean;
}) {
  const op = model.operation;
  // Read feedback is derived from its own lifecycle, never written into a mutation receipt.
  const historyMessage = model.historyRead?.state === "error" ? model.historyRead.message : "";
  const presentedOperation = historyMessage ? { ...op, message: [op.message, historyMessage].filter(Boolean).join("\n") } : op;
  const readFailure = model.detailRead?.state === "error" && op.state === "failed"
    && !model.draft && !model.selected && op.reference === null && !op.referenceLabel && !op.resultUnavailable
    && (op.recovery === undefined || op.recovery === "reload");
  // This owner retains reload as a capability after a validated result is loaded.
  // It is not itself a pending-result state; unknown/unavailable/stale stay below.
  const loadedSaved = op.state === "saved" && op.recovery === "reload" && !op.resultUnavailable
    && !model.draft && model.readState === "ready" && model.reading === false
    && (!model.detailRead || model.detailRead.state === "ready");
  // Collapse only the owner's two plain acknowledgements, never a later read
  // warning or needs-review explanation carried by the same saved receipt.
  const plainAcknowledgement = op.message === "事項已獲 Server 確認。"
    || op.message === "原操作已獲 Server 確認；重新讀取清單，毋須再次提交。";
  return readFailure
    ? <ReadStateNotice state="error" title="未能讀取事項" message={op.message} />
    : <WriteRecoveryNotice operation={presentedOperation} recovery={recovery} online={online}
      savedPresentation={loadedSaved ? { title: "已保存", message: [plainAcknowledgement ? "" : op.message, historyMessage].filter(Boolean).join("\n") || "已保存" } : undefined} />;
}
