import { useRef, useState } from "react";
import type { HomeChild } from "../view-model";
import { taskChangeAllowed, type TaskDraft, type TaskRevisionView, type TasksActions, type TasksViewModel, type TaskView } from "../task-view-model";
import { emptyTaskForm, taskChangeFromForm, taskFormFromBasis, taskFormSchema, taskValuesFromForm } from "../components/tasks/task-form";
import { createTaskFixture, taskConflictFixture, type TaskPreviewCondition } from "./task-fixture";
import { usePreviewOperation } from "./usePreviewOperation";

export function useTasksPreview(child: HomeChild, online: boolean, reading: boolean) {
  const [condition, setCondition] = useState<TaskPreviewCondition>("normal");
  const [fixture, setFixture] = useState(() => createTaskFixture(child.id, "normal"));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [historyLimit, setHistoryLimit] = useState(0);
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [latest, setLatest] = useState<TaskView | null>(null);
  const serial = useRef(0);
  const controller = usePreviewOperation();
  const access = condition === "access_lost" ? "lost" : condition === "viewer" ? "read_only" : "editable";
  const blocked = controller.locked || controller.operation.state === "conflict";
  const selected = fixture.items.find(item => item.id === selectedId) ?? null;

  function applyConfirmed(attempt: TaskDraft) {
    const values = attempt.reviewedValues!;
    const basis = attempt.basis;
    const at = "2026-09-29T10:00:00+08:00";
    let result: TaskView;
    if (!basis) {
      const input = taskValuesFromForm(values);
      const id = `${child.id}-preview-new-${++serial.current}`;
      result = { id, childId: child.id, version: 1, title: input.title, details: input.details, kind: input.kind,
        assigneeUserId: input.assigneeUserId, createdBy: "preview-owner", createdAt: at, updatedAt: at,
        occurrence: { id: `${id}-occurrence`, dueAt: input.dueAt, timeZone: input.timeZone, state: "scheduled", terminalBasisVersion: null } };
    } else {
      const input = taskChangeFromForm(attempt.mode as Exclude<TaskDraft["mode"], "create">, values, basis.version);
      result = { ...basis, version: basis.version + 1, updatedAt: at, occurrence: { ...basis.occurrence } };
      if (input.action === "reschedule") {
        result.assigneeUserId = input.assigneeUserId;
        result.occurrence.dueAt = input.dueAt; result.occurrence.timeZone = input.timeZone;
      } else {
        result.occurrence.state = input.action === "resolve" ? input.outcome : input.action === "complete" ? "completed" : "cancelled";
        result.occurrence.terminalBasisVersion = basis.version;
      }
    }
    const revision: TaskRevisionView = { task: result, action: attempt.mode, actorUserId: "preview-owner",
      basisVersion: basis?.version ?? 0, note: values.note, at };
    setFixture(previous => ({ ...previous, items: [result, ...previous.items.filter(item => item.id !== result.id)],
      histories: { ...previous.histories, [result.id]: [revision, ...(previous.histories[result.id] ?? [])] },
      work: previous.work.filter(item => item.taskId !== result.id), reminders: previous.reminders.filter(item => item.taskId !== result.id) }));
    setSelectedId(result.id); setHistoryLimit(0); setDraft(null); setLatest(null);
  }

  function changeCondition(next: TaskPreviewCondition) {
    controller.reset(); setCondition(next); setFixture(createTaskFixture(child.id, next));
    setSelectedId(next === "needs_review" ? `${child.id}-task-review` : next === "assignee_revoked" || next === "worker_failed" || next === "worker_unknown" ? `${child.id}-task-ordinary` : null);
    setHistoryLimit(0); setDraft(null); setLatest(null);
  }

  const actions: TasksActions = {
    selectTask(id) {
      if (access === "lost" || reading || blocked || draft) return;
      setSelectedId(id); setHistoryLimit(0);
    },
    closePanel() {
      if (controller.locked) return;
      controller.reset(); setDraft(null); setLatest(null); setHistoryLimit(0); setSelectedId(null);
    },
    startCreate() {
      if (access !== "editable" || reading || blocked || draft) return;
      controller.reset(); setLatest(null); setHistoryLimit(0); setSelectedId(null);
      if (controller.outcome === "conflict") controller.setOutcome("success");
      setDraft({ key: `create-${++serial.current}`, mode: "create", basis: null,
        initialValues: emptyTaskForm(), reviewedValues: null });
    },
    startChange(id, action) {
      const basis = fixture.items.find(item => item.id === id);
      if (!basis || access !== "editable" || reading || blocked || draft || !taskChangeAllowed(basis, action)) return;
      controller.reset(); setLatest(null); setHistoryLimit(0); setSelectedId(id);
      setDraft({ key: `change-${++serial.current}`, mode: action, basis, initialValues: taskFormFromBasis(basis), reviewedValues: null });
    },
    reviewDraft(values) {
      if (!draft || access !== "editable" || reading || blocked || !taskFormSchema(draft.mode, fixture.eligibleAssignees).safeParse(values).success) return;
      setDraft({ ...draft, reviewedValues: { ...values } }); controller.review();
    },
    editDraft() {
      if (!draft || blocked) return;
      setDraft({ ...draft, reviewedValues: null }); controller.edit();
    },
    submitReviewed() {
      if (!draft?.reviewedValues || access !== "editable" || !online || reading || blocked || controller.operation.state !== "needs_confirmation") return;
      if (draft.basis && !taskChangeAllowed(draft.basis, draft.mode as Exclude<TaskDraft["mode"], "create">)) return;
      if (!taskFormSchema(draft.mode, fixture.eligibleAssignees).safeParse(draft.reviewedValues).success) return;
      const attempt = draft;
      controller.submit(() => applyConfirmed(attempt), draft.basis ? () => {
        const basis = attempt.basis!;
        const competing = taskConflictFixture(basis, condition === "latest_terminal" || basis.occurrence.state === "needs_review");
        setLatest(competing); setDraft(previous => previous ? { ...previous, reviewedValues: null } : null);
        const revision: TaskRevisionView = { task: competing,
          action: competing.occurrence.state === "completed" ? basis.occurrence.state === "needs_review" ? "resolve" : "complete" : "reschedule",
          actorUserId: "preview-caregiver", basisVersion: basis.version, note: "另一位家人的版本（固定合成情境）", at: competing.updatedAt };
        setFixture(previous => ({ ...previous, items: previous.items.map(item => item.id === basis.id ? competing : item),
          histories: { ...previous.histories, [basis.id]: [revision, ...(previous.histories[basis.id] ?? [])] },
          work: previous.work.filter(item => item.taskId !== basis.id), reminders: previous.reminders.filter(item => item.taskId !== basis.id) }));
      } : undefined);
    },
    useLatestVersion() {
      if (!draft || !latest || !online || reading || controller.operation.state !== "conflict" || draft.mode === "create" || !taskChangeAllowed(latest, draft.mode)) return;
      setDraft({ ...draft, basis: latest, reviewedValues: null }); setLatest(null); controller.useLatest();
    },
    showHistory() { if (selected && !reading && access !== "lost" && !draft) setHistoryLimit(1); },
    loadOlderHistory() { if (selected && online && !reading && access !== "lost" && !draft) setHistoryLimit(previous => previous + 2); },
  };
  const hidden = access === "lost" || reading;
  const history = selected ? fixture.histories[selected.id] ?? [] : [];
  const model: TasksViewModel = {
    child: { id: child.id, name: child.displayName }, access, online, reading,
    dataLabel: "合成示例 · 未接駁 Server · 重新載入、切換孩子或情境後重置",
    items: hidden ? [] : fixture.items, eligibleAssignees: hidden ? [] : fixture.eligibleAssignees,
    selected: hidden ? null : selected, workerEnabled: hidden ? undefined : fixture.workerEnabled,
    work: hidden ? [] : fixture.work, reminders: hidden ? [] : fixture.reminders,
    history: hidden ? [] : history.slice(0, historyLimit), historyOpen: !hidden && historyLimit > 0,
    hasMoreHistory: !hidden && history.length > historyLimit, draft: access === "lost" ? null : draft,
    latest: access === "lost" ? null : latest, operation: controller.operation,
  };
  return { model, actions, controller, condition, changeCondition };
}
