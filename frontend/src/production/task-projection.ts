import type { CareTask } from "../../../src/shared/tasks.ts";
import type { TaskView } from "../task-view-model.ts";

/** Server changeTask forbids edits in terminal states. Its updatedAt equals the
 * current complete/cancel/resolve revision's at, not the scheduled occurrence time. */
export function projectConfirmedTask(task: CareTask): TaskView {
  const terminal = task.occurrence.state === "completed" || task.occurrence.state === "cancelled";
  const terminalAt = terminal && Number.isFinite(Date.parse(task.updatedAt)) ? task.updatedAt : undefined;
  return { ...task, terminalAt, completedAt: task.occurrence.state === "completed" ? terminalAt : undefined };
}
