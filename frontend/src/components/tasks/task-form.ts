import { z } from "zod";
import type { TaskAssigneeView, TaskChangeInput, TaskDraftMode, TaskFormValues, TaskValues, TaskView } from "../../task-view-model";

// Local form validation follows the delivered task fields; the Server remains authoritative.
const dueAtSchema = z.iso.datetime({ offset: true }).refine(value => {
  const time = Date.parse(value);
  return time >= Date.UTC(2000, 0, 1) && time < Date.UTC(2101, 0, 1);
}, "請選擇 2000 至 2100 年的有效日期與時間。");
const timeZoneSchema = z.string().max(100).refine(value => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return true; } catch { return false; }
}, "請選擇有效時區。");
const formSchema = z.object({
  title: z.string(), details: z.string(), kind: z.enum(["ordinary", "appointment"]),
  assigneeUserId: z.string(), dueAt: z.string(), timeZone: z.string(),
  note: z.string().max(1000, "原因／備註最多 1,000 字。"), outcome: z.enum(["", "completed", "cancelled"]),
});
export function taskFormSchema(mode: TaskDraftMode, assignees: TaskAssigneeView[]) {
  return formSchema.superRefine((values, context) => {
    function issue(path: keyof TaskFormValues, message: string) { context.addIssue({ code: "custom", path: [path], message }); }
    if (mode === "create") {
      if (!values.title.trim() || values.title.length > 160) issue("title", "請填寫標題，最多 160 字。");
      if (values.details.length > 2000) issue("details", "詳細內容最多 2,000 字。");
    }
    if (mode === "create" || mode === "reschedule") {
      if (!assignees.some(item => item.userId === values.assigneeUserId)) issue("assigneeUserId", "請選擇目前合資格的家庭成員。");
      if (!dueAtSchema.safeParse(values.dueAt).success) issue("dueAt", "請選擇 2000 至 2100 年的有效日期與時間。");
      if (!timeZoneSchema.safeParse(values.timeZone).success) issue("timeZone", "請選擇有效時區。");
    }
    if (["reschedule", "cancel", "resolve"].includes(mode) && !values.note.trim()) issue("note", "請填寫原因。");
    if (mode === "resolve" && values.outcome === "") issue("outcome", "請明確選擇已完成或已取消。");
  });
}
export function emptyTaskForm(assigneeUserId = ""): TaskFormValues {
  return { title: "", details: "", kind: "ordinary", assigneeUserId, dueAt: "", timeZone: "Asia/Hong_Kong", note: "", outcome: "" };
}
export function taskFormFromBasis(task: TaskView): TaskFormValues {
  return { title: task.title, details: task.details, kind: task.kind, assigneeUserId: task.assigneeUserId,
    dueAt: task.occurrence.dueAt, timeZone: task.occurrence.timeZone, note: "", outcome: "" };
}
export function taskValuesFromForm(values: TaskFormValues): TaskValues {
  return { title: values.title, details: values.details, kind: values.kind, assigneeUserId: values.assigneeUserId, dueAt: values.dueAt, timeZone: values.timeZone };
}
export function taskChangeFromForm(action: Exclude<TaskDraftMode, "create">, values: TaskFormValues, expectedVersion: number): TaskChangeInput {
  if (action === "reschedule") return { action, expectedVersion, confirm: true, dueAt: values.dueAt, timeZone: values.timeZone, assigneeUserId: values.assigneeUserId, note: values.note };
  if (action === "resolve") {
    if (values.outcome === "") throw new Error("A terminal outcome is required");
    return { action, expectedVersion, confirm: true, outcome: values.outcome, note: values.note };
  }
  return { action, expectedVersion, confirm: true, note: values.note };
}
