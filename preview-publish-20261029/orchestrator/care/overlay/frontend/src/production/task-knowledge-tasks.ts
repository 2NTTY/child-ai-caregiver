import { usePathname } from "expo-router";
import { readLoadedIdWindow } from "./task-knowledge-read-window";
import { projectConfirmedTask } from "./task-projection.ts";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { createTaskApi, TaskApiError } from "../../../src/client/task-api";
import { taskChangeSchema, taskValuesSchema, type CareTask, type TaskChange, type TaskCreate, type TaskPage } from "../../../src/shared/tasks";
import { emptyTaskForm, taskChangeFromForm, taskFormFromBasis, taskFormSchema, taskValuesFromForm } from "../components/tasks/task-form";
import { taskChangeAllowed, taskWithCompletionRevision, type TaskDraft, type TaskSelectionIntent, type TaskRevisionView, type TaskView, type TasksViewModel } from "../task-view-model";
import type { TasksWorkspaceValue } from "../workspaces/TasksWorkspace";
import type { WriteOperationView } from "../view-model";
import { useDomainWriteGuard } from "./useDomainEnvironment";
import { domainFailure, mergeById, useTaskKnowledgeRefresh, useTaskKnowledgeRuntime, type TaskKnowledgeEnvironment } from "./task-knowledge-runtime";

type Attempt = { kind: "create"; input: TaskCreate } | { kind: "change"; input: TaskChange; basis: TaskView };
const none: WriteOperationView = { state: "none", message: "", reference: null };
export function useTaskKnowledgeTasks(env: TaskKnowledgeEnvironment): TasksWorkspaceValue {
  const api = useMemo(() => createTaskApi(env.apiBaseUrl, env.owner.fetcher), [env.apiBaseUrl, env.owner.fetcher]);
  const runtime = useTaskKnowledgeRuntime(env, "tasks");
  const [page, setPage] = useState<TaskPage | null>(null), [reading, setReading] = useState(false);
  const [readState, setReadState] = useState<NonNullable<TasksViewModel["readState"]>>("loading");
  const [linkedTask, setLinkedTask] = useState<TaskView | null>(null);
  const [detailRead, setDetailRead] = useState<TasksViewModel["detailRead"]>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null), [draft, setDraft] = useState<TaskDraft | null>(null);
  const [pristineCreateKey, setPristineCreateKey] = useState<string | null>(null);
  const [latest, setLatest] = useState<TaskView | null>(null), [operation, setOperation] = useState(none);
  const [histories, setHistories] = useState<Record<string, { taskVersion: number; items: TaskRevisionView[]; cursor: number | null }>>({});
  const [historyOpen, setHistoryOpen] = useState(false), [loadingMore, setLoadingMore] = useState(false);
  const busy = useRef(false), attempt = useRef<Attempt | null>(null), committed = useRef(false), checked = useRef(false);
  const confirmedTask = useRef<Pick<CareTask, "id" | "version"> | null>(null);
  const confirmedReference = useRef<string | null>(null);
  const readThrough = useRef<string | null>(null);
  const clock = useRef(new Date().toISOString());
  const queuedSelection = useRef<{ id: string; intent: TaskSelectionIntent } | null>(null), selectLatest = useRef<(id: string, intent: TaskSelectionIntent) => void>(() => {});
  const canManage = env.role === "owner" || env.role === "caregiver";
  const pending = operation.state === "saving" || operation.state === "unknown";
  const pathname = usePathname(), previousPath = useRef(pathname);
  function closePanel() {
    if (!runtime.live() || pending || attempt.current) return false;
    setSelectedId(null); setLinkedTask(null); setDraft(null); setLatest(null); setHistoryOpen(false); setOperation(none);
    return true;
  }
  useEffect(() => {
    const leftTasks = previousPath.current === "/tasks" && pathname !== "/tasks";
    previousPath.current = pathname;
    if (leftTasks && !["saving", "unknown"].includes(operation.state)) closePanel();
  }, [pathname]);
  const pristineCreate = draft?.mode === "create" && draft.key === pristineCreateKey && !draft.reviewedValues
    && operation.state === "none" && !attempt.current;
  useDomainWriteGuard(!runtime.lost && !!draft && !pristineCreate, !runtime.lost && pending);
  useEffect(() => () => { busy.current = false; api.resetOnline(); }, [api]);
  const verified = async <T,>(action: (signal: AbortSignal) => Promise<T>, signal: AbortSignal, write = false) => {
    if (await api.getSession(signal) !== env.userId) throw new TaskApiError(401);
    const result = await action(signal);
    if (write) committed.current = true;
    if (await api.getSession(signal) !== env.userId) throw new TaskApiError(401);
    return result;
  };
  const load = async (signal: AbortSignal, current: () => boolean, after: string | null = null, preserveReading = false) => {
    const readPage = (cursor: string | null) => runtime.read(["page", cursor], next => verified(inner => api.tasks(env.childId!, cursor, inner), next), signal);
    const pages = after === null ? await readLoadedIdWindow(preserveReading ? readThrough.current : null, current, readPage) : [await readPage(after)];
    const value: TaskPage = pages.length === 1 ? pages[0]! : { ...pages.at(-1)!, items: pages.flatMap(page => page.items),
      reminders: pages.flatMap(page => page.reminders ?? []), work: pages.flatMap(page => page.work ?? []) };
    if (!current()) return;
    let loadedSelection: CareTask | null = null;
    if (after === null) {
      const outsidePage = selectedId && !value.items.some(item => item.id === selectedId);
      const selectedValue = outsidePage
        ? await runtime.read(["task", selectedId], next => verified(inner => api.task(env.childId!, selectedId!, inner), next), signal)
        : null;
      if (!current()) return;
      loadedSelection = selectedValue;
      setLinkedTask(selectedValue);
      const versions = new Map([...value.items, ...(selectedValue ? [selectedValue] : [])].map(item => [item.id, item.version]));
      setHistories(previous => Object.fromEntries(Object.entries(previous).filter(([id, history]) => versions.get(id) === history.taskVersion)));
    }
    readThrough.current = value.items.at(-1)?.id ?? (after === null ? null : readThrough.current);
    setReadState("ready");
    clock.current = new Date().toISOString();
    setPage(before => after && before ? { ...value, items: mergeById(before.items, value.items),
      reminders: [...(before.reminders ?? []).filter(item => !value.items.some(task => task.id === item.taskId)), ...(value.reminders ?? [])],
      work: [...(before.work ?? []).filter(item => !value.items.some(task => task.id === item.taskId)), ...(value.work ?? [])] } : value);
    return { page: value, selected: loadedSelection };
  };
  const resultUnavailable = () => {
    const affectedId = confirmedTask.current?.id ?? (attempt.current?.kind === "change" ? attempt.current.basis.id : null);
    attempt.current = null; checked.current = false; confirmedTask.current = null;
    setDraft(null); setLatest(null); setSelectedId(null); setLinkedTask(null); setDetailRead(null); setHistoryOpen(false);
    if (affectedId) {
      setPage(before => before ? { ...before, items: before.items.filter(item => item.id !== affectedId),
        work: before.work?.filter(item => item.taskId !== affectedId), reminders: before.reminders?.filter(item => item.taskId !== affectedId) } : before);
      setHistories(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => id !== affectedId)));
    }
    setReadState(page ? "stale" : "error");
    setOperation({ state: "saved", resultUnavailable: true, reference: confirmedReference.current,
      message: "原操作已確認，但結果暫時無法顯示；不會再次提交。" });
    env.invalidate();
  };
  const refresh = (preserveReading = false) => {
    if (busy.current || !env.online || !runtime.live()) return;
    busy.current = true; setReading(true); setReadState(previous => page ? previous : "loading");
    void runtime.request(async (signal, current) => {
      try {
        if (attempt.current && operation.state === "unknown") {
          if (await api.getSession(signal) !== env.userId) throw new TaskApiError(401);
          const receipt = committed.current ? null : await api.reconcilePending(signal, env.userId!);
          if (receipt?.state === "confirmed") {
            committed.current = true; confirmedReference.current = receipt.operation.opId;
            // Keep the validated identity before the fallible post-receipt session read.
            // TaskApi validates a non-null result against the original child/task/version.
            if (receipt.result !== null) {
              const value = (receipt.result as { task: CareTask }).task;
              confirmedTask.current = { id: value.id, version: value.version };
            }
          }
          if (await api.getSession(signal) !== env.userId) throw new TaskApiError(401);
          if (!current()) return;
          if (committed.current) {
            const target = confirmedTask.current;
            if (!target) { resultUnavailable(); return; }
            const detail = await runtime.read(["task", target.id], next => verified(inner => api.task(env.childId!, target.id, inner), next), signal);
            if (!current()) return;
            if (detail.version < target.version) throw new TaskApiError();
            const loaded = await load(signal, current, null, preserveReading);
            if (!current() || !loaded) return;
            const listed = loaded.selected?.id === target.id ? loaded.selected : loaded.page.items.find(item => item.id === target.id);
            const value = listed && listed.version > detail.version ? listed : detail;
            attempt.current = null; checked.current = false; confirmedTask.current = null;
            setDraft(null); setLatest(null); setHistories({}); setLinkedTask(null); setSelectedId(value.id);
            setDetailRead({ id: value.id, state: "ready" });
            setPage(before => before ? { ...before, items: [value, ...before.items.filter(item => item.id !== value.id)],
              work: before.work?.filter(item => item.taskId !== value.id), reminders: before.reminders?.filter(item => item.taskId !== value.id) } : before);
            setOperation({ state: "saved", message: value.occurrence.state === "needs_review" ? "相反終態出現衝突；待覆核並已停催。" : "原操作及事項已核對，毋須再次提交。",
              reference: confirmedReference.current });
            env.invalidate();
            return;
          } else {
            checked.current = true;
            setOperation({ state: "unknown", message: api.hasPendingOnline() ? "原操作尚未確認。可明確沿同一請求重試。" : "沒有待核對操作識別；可明確解除提交並保留草稿。", reference: operation.reference, recovery: "retry" });
          }
        }
        await load(signal, current, null, preserveReading);
        if (current() && operation.state === "conflict" && draft?.basis) {
          const value = await runtime.read(["task", draft.basis.id], next => verified(inner => api.task(env.childId!, draft.basis!.id, inner), next), signal);
          if (current()) setLatest(value);
        }
      } catch (error) {
        if (!current()) return;
        if (runtime.accessError(error)) { api.resetOnline(); attempt.current = null; setDraft(null); setPage(null); setHistories({}); return; }
        setReadState(page ? "stale" : "error");
        checked.current = false;
        if (domainFailure(error).confirmed) {
          committed.current = true;
          if (!confirmedTask.current) { resultUnavailable(); return; }
        }
        if (attempt.current || committed.current || operation.state === "unknown") {
          setOperation(previous => ({ ...previous, reference: confirmedReference.current ?? previous.reference, message: committed.current ? "已提交，清單暫時無法更新；請重新讀取。" : "暫時無法查核，原操作及草稿已保留。", recovery: previous.state === "unknown" ? "check" : "reload" }));
        }
      } finally { if (current()) { busy.current = false; setReading(false); if (queuedSelection.current) { const { id, intent } = queuedSelection.current; queuedSelection.current = null; selectLatest.current(id, intent); } } }
    });
  };
  useTaskKnowledgeRefresh(() => refresh(true), env.online && !!env.childId && !runtime.lost, reading || operation.state === "saving");
  const write = (original: Attempt, retry = false) => {
    if (busy.current || !env.online || !runtime.live() || !canManage || !retry && !env.canStartWrite()) return;
    busy.current = true; committed.current = false; checked.current = false; confirmedTask.current = null; confirmedReference.current = null; attempt.current = original;
    setOperation({ state: "saving", message: "正在提交已核對的家庭共享事項。", reference: null });
    void runtime.request(async (signal, current) => {
      try {
        const value = await verified(async next => {
          const result = original.kind === "create" ? await api.createTask(env.childId!, original.input, next, env.userId!)
            : await api.changeTask(env.childId!, original.basis.id, original.input, next, env.userId!);
          confirmedTask.current = { id: result.id, version: result.version };
          return result;
        }, signal, true);
        if (!current()) return;
        attempt.current = null; setDraft(null); setLatest(null); setHistories({}); setSelectedId(value.id);
        setPage(before => before ? { ...before, items: [value, ...before.items.filter(item => item.id !== value.id)],
          work: before.work?.filter(item => item.taskId !== value.id), reminders: before.reminders?.filter(item => item.taskId !== value.id) } : before);
        setOperation({ state: "saved", message: value.occurrence.state === "needs_review" ? "相反終態出現衝突；待覆核並已停催。" : "事項已獲 Server 確認。", reference: null, recovery: "reload" });
        env.invalidate();
      } catch (error) {
        if (!current()) return;
        if (runtime.accessError(error)) { api.resetOnline(); attempt.current = null; setDraft(null); setPage(null); setHistories({}); return; }
        const failure = domainFailure(error); committed.current ||= failure.confirmed;
        if (committed.current && !confirmedTask.current) { resultUnavailable(); return; }
        if (!committed.current && failure.status === 409 && failure.code === "version_conflict" && original.kind === "change") {
          attempt.current = null; setLatest(null); setOperation({ state: "conflict", message: "版本已改變；保留草稿。請重新讀取並明確使用最新版本。", reference: null, recovery: "reload" });
        } else if (committed.current || api.hasPendingOnline() || failure.status === 0 || failure.status >= 500 || failure.status === 409) {
          setOperation({ state: "unknown", message: committed.current ? "原操作已確認，結果尚待核對；請查收據，毋須再次提交。" : "結果未知；保留原內容及操作識別。請先查收據。", reference: null, recovery: "check" });
        } else { attempt.current = null; setOperation({ state: "failed", message: "輸入未獲接納；請核對原草稿。", reference: null }); }
      } finally { if (current()) busy.current = false; }
    });
  };
  const rawItems = runtime.lost ? [] : [...(page?.items ?? []), ...(linkedTask && !page?.items.some(item => item.id === linkedTask.id) ? [linkedTask] : [])];
  const items = rawItems.map(item => taskWithCompletionRevision(projectConfirmedTask(item), histories[item.id]?.items ?? []));
  const selected = items.find(item => item.id === selectedId) ?? null;
  const locked = busy.current || pending || operation.state === "conflict" || runtime.lost;
  const readHistory = (before: number | null = null) => {
    if (!selected || busy.current || !env.online || !runtime.live()) return;
    const basis = selected; busy.current = true; setReading(true); setHistoryOpen(true);
    void runtime.request(async (signal, current) => {
      try {
        const value = await runtime.read(["history", basis.id, before], next => verified(inner => api.history(env.childId!, basis.id, before, inner), next), signal);
        if (current()) setHistories(previous => ({ ...previous, [basis.id]: {
          taskVersion: basis.version, items: before === null ? value.revisions : [...(previous[basis.id]?.items ?? []), ...value.revisions.filter(item => !previous[basis.id]?.items.some(old => old.task.version === item.task.version))], cursor: value.nextBeforeVersion,
        } }));
      } catch (error) { if (current() && !runtime.accessError(error)) setOperation(previous => ({ ...previous, message: "任務歷史尚未讀取；完成時間不會以安排時間代替。" })); }
      finally { if (current()) { busy.current = false; setReading(false); if (queuedSelection.current) { const { id, intent } = queuedSelection.current; queuedSelection.current = null; selectLatest.current(id, intent); } } }
    });
  };
  const selectTask = (id: string, intent: TaskSelectionIntent = "open") => {
      if (pending || draft || operation.state === "conflict" || !runtime.live()) return;
      if (id.length > 36 || !z.uuid().safeParse(id).success) {
        setDetailRead({ id, state: "error" });
        queuedSelection.current = null; setSelectedId(null); setLinkedTask(null); setHistoryOpen(false);
        setOperation({ state: "failed", message: "事項連結識別無效，沒有套用其他事項或孩子資料。", reference: null });
        return;
      }
      if (busy.current) { setDetailRead({ id, state: "loading" }); queuedSelection.current = { id, intent }; return; }
      if (items.some(item => item.id === id)) { setDetailRead({ id, state: "ready" }); setSelectedId(previous => intent === "toggle" && previous === id ? null : id); setHistoryOpen(false); return; }
      if (!env.online) { setDetailRead({ id, state: "error" }); return; }
      setDetailRead({ id, state: "loading" });
      busy.current = true; setReading(true);
      void runtime.request(async (signal, current) => {
        try {
          const value = await runtime.read(["task", id], next => verified(inner => api.task(env.childId!, id, inner), next), signal);
          if (current()) { setDetailRead({ id, state: "ready" }); setLinkedTask(value); setSelectedId(value.id); setHistoryOpen(false); }
        } catch (error) {
          if (!current()) return;
          setDetailRead({ id, state: "error" });
          if (domainFailure(error).status === 404) {
            setSelectedId(null); setLinkedTask(null); setPage(null); setReadState("error"); setHistories({});
            env.queryClient.removeQueries({ queryKey: ["production", env.scopeKey, "tasks"] });
            setOperation({ state: "failed", message: "找不到此孩子的事項，或目前已無權查看；沒有套用舊資料。", reference: null, recovery: "reload" });
          } else if (!runtime.accessError(error)) setOperation(previous => ({ ...previous, message: "連結事項未能讀取，沒有按標題替代或顯示其他孩子資料。" }));
        }
        finally { if (current()) { busy.current = false; setReading(false); if (queuedSelection.current) { const { id, intent } = queuedSelection.current; queuedSelection.current = null; selectLatest.current(id, intent); } } }
      });
    };
  selectLatest.current = selectTask;
  return { scopeKey: env.scopeKey, model: {
    child: { id: env.childId!, name: env.childName }, access: runtime.lost ? "lost" : canManage ? "editable" : "read_only",
    online: env.online, reading, readState: runtime.lost || !env.online && !page ? "error" : !env.online && page ? "stale" : readState, dataLabel: "家庭共享事項",
    scheduleContext: { asOf: clock.current, timeZone: "Asia/Hong_Kong" }, items,
    eligibleAssignees: runtime.lost ? [] : page?.eligibleAssignees ?? [], selected, detailRead,
    hasMoreTasks: !!page?.nextAfterId && !runtime.lost, loadingMoreTasks: loadingMore,
    workerEnabled: page?.workerEnabled, work: runtime.lost ? [] : page?.work ?? [], reminders: runtime.lost ? [] : page?.reminders ?? [],
    history: runtime.lost || !selected ? [] : histories[selected.id]?.items ?? [], historyOpen,
    hasMoreHistory: !!selected && !!histories[selected.id]?.cursor, draft: runtime.lost ? null : draft,
    latest: runtime.lost ? null : latest, operation: runtime.lost ? none : operation,
  }, actions: {
    selectTask,
    closePanel,
    startCreate() {
      if (locked || !canManage || !env.online || !page) return;
      const key = crypto.randomUUID(); setPristineCreateKey(key);
      setDraft({ key, mode: "create", basis: null, initialValues: emptyTaskForm(), reviewedValues: null }); setLatest(null); setOperation(none);
    },
    startChange(id, mode) {
      const basis = items.find(item => item.id === id);
      if (locked || !canManage || !env.online || !basis || !taskChangeAllowed(basis, mode)) return;
      setSelectedId(id); setDraft({ key: crypto.randomUUID(), mode, basis: structuredClone(basis), initialValues: taskFormFromBasis(basis), reviewedValues: null }); setLatest(null); setOperation(none);
    },
    reviewDraft(values) {
      if (locked || !draft || !taskFormSchema(draft.mode, page?.eligibleAssignees ?? []).safeParse(values).success) return;
      setPristineCreateKey(null);
      setDraft({ ...draft, reviewedValues: structuredClone(values) }); setOperation({ state: "needs_confirmation", message: "已核對草稿；請明確確認家庭共享安排。", reference: null });
    },
    editDraft() { if (!locked && draft) { setPristineCreateKey(null); setDraft({ ...draft, reviewedValues: null }); setOperation(none); } },
    submitReviewed() {
      if (locked || !canManage || !draft?.reviewedValues || !taskFormSchema(draft.mode, page?.eligibleAssignees ?? []).safeParse(draft.reviewedValues).success) return;
      if (draft.mode === "create") {
        const parsed = taskValuesSchema.safeParse(taskValuesFromForm(draft.reviewedValues));
        if (parsed.success) write({ kind: "create", input: { values: parsed.data, confirm: true } });
      } else if (draft.basis && taskChangeAllowed(draft.basis, draft.mode)) {
        const parsed = taskChangeSchema.safeParse(taskChangeFromForm(draft.mode, draft.reviewedValues, draft.basis.version));
        if (parsed.success) write({ kind: "change", basis: draft.basis, input: parsed.data });
      }
    },
    useLatestVersion() {
      if (!draft || draft.mode === "create" || !latest || !taskChangeAllowed(latest, draft.mode) || busy.current || pending) return;
      setDraft({ ...draft, key: crypto.randomUUID(), basis: structuredClone(latest), initialValues: draft.reviewedValues ?? draft.initialValues, reviewedValues: null }); setLatest(null); setOperation(none);
    },
    showHistory() {
      if (locked || draft) return;
      if (historyOpen) setHistoryOpen(false); else readHistory();
    }, loadOlderHistory() { if (selected && histories[selected.id]?.cursor) readHistory(histories[selected.id]!.cursor); },
    loadMoreTasks() {
      const after = page?.nextAfterId;
      if (!after || busy.current || !env.online || !runtime.live() || pending) return;
      busy.current = true; setReading(true); setLoadingMore(true);
      void runtime.request(async (signal, current) => {
        try { await load(signal, current, after); }
        catch (error) { if (current() && !runtime.accessError(error)) setReadState("stale"); }
        finally { if (current()) { busy.current = false; setReading(false); setLoadingMore(false); } }
      });
    },
  }, recovery: {
    checkOriginalOperation: () => refresh(), reloadCurrent: () => refresh(),
    retryOriginalOperation() {
      if (!checked.current || committed.current || operation.state !== "unknown" || !attempt.current || busy.current) return;
      if (api.hasPendingOnline()) write(attempt.current, true);
      else { attempt.current = null; setOperation(none); setDraft(previous => previous ? { ...previous, reviewedValues: null } : null); }
    },
  } };
}
