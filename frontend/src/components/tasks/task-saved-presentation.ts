import type { TasksViewModel } from "../../task-view-model";

const savedCopy = { title: "已保存", message: "" };

// The Task owner retains reload capability after confirmation. Only collapse its
// two positive messages once the current read is ready; saved can also carry
// conflict/history-read warnings, which must remain visible verbatim.
export function taskSavedPresentation(model: TasksViewModel) {
  const op = model.operation;
  const confirmedMessage = op.message === "事項已獲 Server 確認。"
    || op.message === "原操作已獲 Server 確認；重新讀取清單，毋須再次提交。";
  return op.state === "saved" && op.recovery === "reload" && !op.resultUnavailable && confirmedMessage
    && model.readState === "ready" && !model.reading && model.online && model.access !== "lost" && !model.draft
    && model.selected?.occurrence.state !== "needs_review"
    && (!model.detailRead || model.detailRead.state === "ready") ? savedCopy : undefined;
}
