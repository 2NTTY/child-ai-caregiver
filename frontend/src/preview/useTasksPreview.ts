import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { HomeChild } from "../view-model";
import { taskChangeAllowed, taskWithCompletionRevision, type TaskDraft, type TaskRevisionView, type TasksActions, type TasksViewModel, type TaskView } from "../task-view-model";
import { emptyTaskForm, taskChangeFromForm, taskFormFromBasis, taskFormSchema, taskValuesFromForm } from "../components/tasks/task-form";
import { createTaskFixture, taskPreviewClock, taskConflictFixture, taskFixturePage, type TaskPreviewCondition } from "./task-fixture";
import { mergeTaskPages, replaceTaskInPage } from "./task-pagination";
import { usePreviewOperation } from "./usePreviewOperation";

export function useTasksPreview(child: HomeChild, online: boolean, reading: boolean, scopeKey = child.id, workspaceEntry = "tasks") {
  const [controllerScope, setControllerScope] = useState(scopeKey);
  const currentScope = useRef(scopeKey); currentScope.current = scopeKey;
  const generation = useRef(0);
  const activeEntry = useRef(workspaceEntry);
  const [condition, setCondition] = useState<TaskPreviewCondition>("normal");
  const [fixture, setFixture] = useState(() => createTaskFixture(child.id, "normal"));
  const [list, setList] = useState(() => taskFixturePage(fixture, null));
  const [loadingMoreTasks, setLoadingMoreTasks] = useState(false);
  const pageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [historyLimit, setHistoryLimit] = useState(0);
  const [draft, setDraft] = useState<TaskDraft | null>(null);
  const [latest, setLatest] = useState<TaskView | null>(null);
  const serial = useRef(0);
  useEffect(() => () => { if (pageTimer.current) clearTimeout(pageTimer.current); }, []);
  const controller = usePreviewOperation();
  const access = condition === "access_lost" ? "lost" : condition === "viewer" || child.accessRole === "viewer" ? "read_only" : "editable";
  const blocked = controller.locked || controller.operation.state === "conflict";
  const selected = list.items.find(item => item.id === selectedId && item.childId === child.id) ?? null;
  const live = useRef({ scopeKey, access, reading, online, blocked, draft, locked: controller.locked });
  live.current = { scopeKey, access, reading, online, blocked, draft, locked: controller.locked };
  const currentRead = () => controllerScope === scopeKey && currentScope.current === scopeKey && live.current.access !== "lost" && !live.current.reading;
  const currentEdit = () => currentRead() && live.current.access === "editable";

  function applyConfirmed(attempt: TaskDraft) {
    const values = attempt.reviewedValues!;
    const basis = attempt.basis;
    const at = taskPreviewClock.asOf;
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
    result = taskWithCompletionRevision(result, [revision]);
    setFixture(previous => ({ ...previous, items: [result, ...previous.items.filter(item => item.id !== result.id)],
      histories: { ...previous.histories, [result.id]: [revision, ...(previous.histories[result.id] ?? [])] },
      work: previous.work.filter(item => item.taskId !== result.id), reminders: previous.reminders.filter(item => item.taskId !== result.id) }));
    setList(previous => replaceTaskInPage(previous, result, true));
    setSelectedId(result.id); setHistoryLimit(0); setDraft(null); setLatest(null);
  }

  function changeCondition(next: TaskPreviewCondition, scopeReset = false) {
    if (!scopeReset && (currentScope.current !== scopeKey || live.current.locked && next !== "access_lost")) return;
    generation.current++;
    if (pageTimer.current) clearTimeout(pageTimer.current);
    pageTimer.current = null; setLoadingMoreTasks(false);
    const nextFixture = createTaskFixture(child.id, next);
    controller.reset(); setCondition(next); setFixture(nextFixture); setList(taskFixturePage(nextFixture, null));
    setSelectedId(next === "needs_review" ? `${child.id}-task-review` : next === "assignee_revoked" || next === "worker_failed" || next === "worker_unknown" ? `${child.id}-task-ordinary` : null);
    setHistoryLimit(0); setDraft(null); setLatest(null);
  }

  useLayoutEffect(() => {
    if (controllerScope === scopeKey) return;
    changeCondition("normal", true); setControllerScope(scopeKey);
  }, [scopeKey, controllerScope]);
  useEffect(() => {
    if (activeEntry.current === workspaceEntry) return;
    activeEntry.current = workspaceEntry;
    // Approved route departure drops transient editing state, never the shared collection.
    if (controller.locked) return;
    controller.reset(); setDraft(null); setLatest(null); setSelectedId(null); setHistoryLimit(0);
  }, [workspaceEntry]);
  useEffect(() => () => { generation.current++; }, []);
  const scopeReady = controllerScope === scopeKey;
  const actions: TasksActions = {
    selectTask(id) {
      if (!currentRead() || live.current.blocked || live.current.draft) return;
      setSelectedId(previous => previous === id ? null : id); setHistoryLimit(0);
    },
    closePanel() {
      if (currentScope.current !== scopeKey || live.current.locked) return;
      controller.reset(); setDraft(null); setLatest(null); setHistoryLimit(0); setSelectedId(null);
    },
    startCreate() {
      if (!currentEdit() || live.current.blocked || live.current.draft) return;
      controller.reset(); setLatest(null); setHistoryLimit(0); setSelectedId(null);
      if (controller.outcome === "conflict") controller.setOutcome("success");
      setDraft({ key: `create-${++serial.current}`, mode: "create", basis: null,
        initialValues: emptyTaskForm(), reviewedValues: null });
    },
    startChange(id, action) {
      const basis = list.items.find(item => item.id === id);
      if (!basis || !currentEdit() || live.current.blocked || live.current.draft || !taskChangeAllowed(basis, action)) return;
      controller.reset(); setLatest(null); setHistoryLimit(0); setSelectedId(id);
      setDraft({ key: `change-${++serial.current}`, mode: action, basis, initialValues: taskFormFromBasis(basis), reviewedValues: null });
    },
    reviewDraft(values) {
      if (!draft || !currentEdit() || live.current.blocked || live.current.draft?.key !== draft.key || !taskFormSchema(draft.mode, fixture.eligibleAssignees).safeParse(values).success) return;
      setDraft({ ...draft, reviewedValues: { ...values } }); controller.review();
    },
    editDraft() {
      if (!draft || !currentEdit() || live.current.blocked || live.current.draft?.key !== draft.key) return;
      setDraft({ ...draft, reviewedValues: null }); controller.edit();
    },
    submitReviewed() {
      if (!draft?.reviewedValues || !currentEdit() || !live.current.online || live.current.blocked || live.current.draft?.key !== draft.key || controller.operation.state !== "needs_confirmation") return;
      if (draft.basis && !taskChangeAllowed(draft.basis, draft.mode as Exclude<TaskDraft["mode"], "create">)) return;
      if (!taskFormSchema(draft.mode, fixture.eligibleAssignees).safeParse(draft.reviewedValues).success) return;
      const attempt = draft, started = generation.current, startedScope = scopeKey;
      const current = () => generation.current === started && currentScope.current === startedScope;
      controller.submit(() => { if (current()) applyConfirmed(attempt); }, draft.basis ? () => {
        if (!current()) return;
        const basis = attempt.basis!;
        let competing = taskConflictFixture(basis, condition === "latest_terminal" || basis.occurrence.state === "needs_review");
        setDraft(previous => previous ? { ...previous, reviewedValues: null } : null);
        const revision: TaskRevisionView = { task: competing,
          action: competing.occurrence.state === "completed" ? basis.occurrence.state === "needs_review" ? "resolve" : "complete" : "reschedule",
          actorUserId: "preview-caregiver", basisVersion: basis.version, note: "另一位家人的版本（固定合成情境）", at: competing.updatedAt };
        competing = taskWithCompletionRevision(competing, [revision]);
        setLatest(competing);
        setFixture(previous => ({ ...previous, items: previous.items.map(item => item.id === basis.id ? competing : item),
          histories: { ...previous.histories, [basis.id]: [revision, ...(previous.histories[basis.id] ?? [])] },
          work: previous.work.filter(item => item.taskId !== basis.id), reminders: previous.reminders.filter(item => item.taskId !== basis.id) }));
        setList(previous => replaceTaskInPage(previous, competing));
      } : undefined);
    },
    useLatestVersion() {
      if (!draft || !latest || !currentEdit() || !live.current.online || controller.operation.state !== "conflict" || draft.mode === "create" || !taskChangeAllowed(latest, draft.mode)) return;
      setDraft({ ...draft, basis: latest, reviewedValues: null }); setLatest(null); controller.useLatest();
    },
    showHistory() { if (selected && currentRead() && !live.current.blocked && !live.current.draft) setHistoryLimit(previous => previous > 0 ? 0 : 1); },
    loadOlderHistory() { if (selected && currentRead() && live.current.online && !live.current.blocked && !live.current.draft) setHistoryLimit(previous => previous + 2); },
    loadMoreTasks() {
      if (!currentRead() || !list.nextAfterId || pageTimer.current || loadingMoreTasks || !live.current.online || live.current.blocked) return;
      const cursor = list.nextAfterId, started = generation.current, startedScope = scopeKey;
      setLoadingMoreTasks(true);
      pageTimer.current = setTimeout(() => {
        pageTimer.current = null;
        if (generation.current !== started || currentScope.current !== startedScope) return;
        setList(previous => mergeTaskPages(previous, taskFixturePage(fixture, cursor)));
        setLoadingMoreTasks(false);
      }, 250);
    },
  };
  const hidden = !scopeReady || access === "lost" || reading;
  const history = selected ? fixture.histories[selected.id] ?? [] : [];
  const model: TasksViewModel = {
    child: { id: child.id, name: child.displayName }, access, online, reading,
    dataLabel: "合成示例 · 未接駁 Server · 待辦與事項歷史共用本次資料",
    scheduleContext: taskPreviewClock,
    items: hidden ? [] : list.items.filter(item => item.childId === child.id), eligibleAssignees: hidden ? [] : list.eligibleAssignees,
    hasMoreTasks: !hidden && list.nextAfterId !== null, loadingMoreTasks: !hidden && loadingMoreTasks,
    selected: hidden ? null : selected, workerEnabled: hidden ? undefined : list.workerEnabled,
    work: hidden ? [] : list.work, reminders: hidden ? [] : list.reminders,
    history: hidden ? [] : history.slice(0, historyLimit), historyOpen: !hidden && historyLimit > 0,
    hasMoreHistory: !hidden && history.length > historyLimit, draft: !scopeReady || access === "lost" ? null : draft,
    latest: !scopeReady || access === "lost" ? null : latest, operation: controller.operation,
  };
  return { scopeReady, model, actions, controller, condition, changeCondition };
}
