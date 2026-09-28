import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Button, Checkbox, HelperText, PaperProvider, RadioButton, Text, TextInput } from "react-native-paper";
import { Controller, useForm, type Control, type FieldValues, type Path } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { Child } from "../shared/records.ts";
import { taskChangeSchema, taskValuesSchema, type CareTask, type TaskAssignee, type TaskChange, type TaskCreate, type TaskReminder, type TaskRevision, type TaskState, type TaskValues, type TaskWorkState } from "../shared/tasks.ts";
import { TaskApiError, type TaskApi } from "./task-api.ts";
import { ONLINE_REFRESH_EVENT } from "./use-online-updates.ts";

interface Props { userId: string; childId: string; role: Child["accessRole"]; api: TaskApi; active?: boolean; onSessionChanged: () => void }
type Attempt = { kind: "create"; input: TaskCreate; label: string } | { kind: "change"; input: TaskChange; basis: CareTask; label: string };
type Conflict = { attempt: Extract<Attempt, { kind: "change" }>; latest: CareTask | null };
type Current = () => boolean;
const stateText: Record<TaskState, string> = { scheduled: "待處理", completed: "已完成", cancelled: "已取消", needs_review: "待覆核，已停催" };
const workStateText: Record<TaskWorkState["status"], string> = { pending: "待處理", processed: "已處理", stopped: "已停止", failed: "失敗", unknown: "結果未知" };
const actionText: Record<TaskChange["action"] | "create", string> = { create: "建立", reschedule: "改期／轉派", complete: "完成", cancel: "取消", resolve: "覆核" };
const emptyValues = (): TaskValues => ({ title: "", details: "", kind: "ordinary", assigneeUserId: "", dueAt: "", timeZone: "Asia/Hong_Kong" });
const emptyChange = (): TaskChange => ({ action: "complete", expectedVersion: 1, confirm: true, note: "" });
const changeAllowed = (task: CareTask, action: TaskChange["action"]) => action === "resolve" ? task.occurrence.state === "needs_review" : task.occurrence.state === "scheduled";

function TaskText({ task, assignees }: { task: CareTask; assignees: TaskAssignee[] }) {
  const assignee = assignees.find(item => item.userId === task.assigneeUserId);
  return <View style={styles.stack}>
    <Text variant="titleMedium">{task.title}</Text>
    <Text>{task.details || "沒有詳細內容"}</Text>
    <Text>{task.kind === "ordinary" ? "普通任務" : "預約"}；負責人：{assignee?.name ?? task.assigneeUserId}</Text>
    {!assignee && <Text>負責人已不具備執行資格{task.occurrence.state === "scheduled" ? "，請重新指派。" : "；此歷史指派不代表現時授權。"}</Text>}
    <Text>時間：{task.occurrence.dueAt}；時區：{task.occurrence.timeZone}</Text>
    <Text>狀態：{stateText[task.occurrence.state]}；版本 {task.version}</Text>
    {task.occurrence.state === "needs_review" && <Text>完成與取消出現衝突，尚未確認終態。請明確覆核為完成或取消；覆核前停止催辦。</Text>}
  </View>;
}

function Confirmation({ label, checked, onToggle, disabled }: { label: string; checked: boolean; onToggle: () => void; disabled: boolean }) {
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked, disabled }}
    disabled={disabled} onPress={onToggle} style={styles.confirmation}
    {...(Platform.OS === "web" ? {
      "aria-checked": checked,
      onKeyDown: (event: { key?: string; nativeEvent?: { key?: string }; preventDefault: () => void }) => {
        if ((event.nativeEvent?.key ?? event.key) === " ") {
          event.preventDefault();
          if (!disabled) onToggle();
        }
      },
    } : {})}>
    <View pointerEvents="none" importantForAccessibility="no-hide-descendants"><Checkbox status={checked ? "checked" : "unchecked"} disabled={disabled} /></View>
    <Text style={styles.confirmationLabel}>{label}</Text>
  </Pressable>;
}

function Field<T extends FieldValues>({ control, name, label, disabled, edited, multiline = false, placeholder, help }: {
  control: Control<T>; name: Path<T>; label: string; disabled: boolean; edited: () => void; multiline?: boolean; placeholder?: string; help?: string;
}) {
  return <Controller control={control} name={name} render={({ field, fieldState }) => <View>
    <TextInput mode="outlined" label={label} accessibilityLabel={label} value={String(field.value ?? "")} onBlur={field.onBlur}
      onChangeText={value => { field.onChange(value); edited(); }} editable={!disabled} multiline={multiline} placeholder={placeholder} error={!!fieldState.error} />
    {(fieldState.error || help) && <HelperText type={fieldState.error ? "error" : "info"}>{fieldState.error ? `請核對${label}。` : help}</HelperText>}
  </View>} />;
}

function AssigneeField<T extends FieldValues>({ control, name, assignees, disabled, edited }: {
  control: Control<T>; name: Path<T>; assignees: TaskAssignee[]; disabled: boolean; edited: () => void;
}) {
  return <Controller control={control} name={name} render={({ field, fieldState }) => <View>
    <Text>負責人</Text>
    <RadioButton.Group value={String(field.value ?? "")} onValueChange={value => { field.onChange(value); edited(); }}>
      {assignees.map(item => <RadioButton.Item key={item.userId} label={item.name} value={item.userId} disabled={disabled} />)}
    </RadioButton.Group>
    {(fieldState.error || !assignees.some(item => item.userId === field.value)) && <HelperText type="error">請從目前可負責任務的家庭成員中選擇。</HelperText>}
  </View>} />;
}

export function TaskPanel(props: Props) {
  const scope = `${props.userId}\n${props.childId}\n${props.role}`;
  return <PaperProvider><TaskWorkspace key={scope} {...props} /></PaperProvider>;
}

function TaskWorkspace({ userId, childId, role, api, active = true, onSessionChanged }: Props) {
  const createForm = useForm<TaskValues>({ resolver: zodResolver(taskValuesSchema), defaultValues: emptyValues() });
  const changeForm = useForm<TaskChange>({ resolver: zodResolver(taskChangeSchema), defaultValues: emptyChange() });
  const createReset = createForm.reset, changeReset = changeForm.reset;
  const [items, setItems] = useState<CareTask[]>([]);
  const [reminders, setReminders] = useState<TaskReminder[]>([]);
  const [work, setWork] = useState<TaskWorkState[]>([]);
  const [workerEnabled, setWorkerEnabled] = useState<boolean | undefined>(undefined);
  const [assignees, setAssignees] = useState<TaskAssignee[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [authorized, setAuthorized] = useState(true);
  const [visibleApi, setVisibleApi] = useState(api);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [createConfirmed, setCreateConfirmed] = useState(false);
  const [changeConfirmed, setChangeConfirmed] = useState(false);
  const [basis, setBasis] = useState<CareTask | null>(null);
  const [unknown, setUnknown] = useState<{ attempt: Attempt; reviewed: boolean } | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [history, setHistory] = useState<{ task: CareTask; items: TaskRevision[]; cursor: number | null } | null>(null);
  const activeRef = useRef(active); activeRef.current = active;
  const mounted = useRef(true);
  const generation = useRef(0);
  const requests = useRef(new Set<AbortController>());
  const inFlight = useRef(false);
  const attemptRef = useRef<Attempt | null>(null);
  const activeAttempt = useRef<Attempt | null>(null);
  const confirmedWrite = useRef(false);
  const refreshRef = useRef<() => void>(() => {});
  const sessionChanged = useRef(onSessionChanged); sessionChanged.current = onSessionChanged;
  const canManage = role === "owner" || role === "caregiver";
  const locked = !active || !authorized || !!busy || !!unknown || !!conflict;
  const action = changeForm.watch("action");

  const clear = useCallback(() => {
    createReset(emptyValues()); changeReset(emptyChange());
    setItems([]); setAssignees([]); setCursor(null); setLoaded(false); setBasis(null); setHistory(null);
    setReminders([]); setWork([]); setWorkerEnabled(undefined);
    setCreateConfirmed(false); setChangeConfirmed(false); setUnknown(null); setConflict(null);
  }, [createReset, changeReset]);
  const resetAttemptDraft = (attempt: Attempt) => {
    if (attempt.kind === "create") { createReset(emptyValues()); setCreateConfirmed(false); }
    else { changeReset(emptyChange()); setBasis(null); setChangeConfirmed(false); }
  };
  const revoke = useCallback(() => {
    generation.current++;
    for (const request of requests.current) request.abort();
    requests.current.clear(); inFlight.current = false;
    api.resetOnline(); attemptRef.current = null; activeAttempt.current = null; confirmedWrite.current = false;
    clear(); setAuthorized(false); setBusy("");
    setNotice("登入帳號或孩子權限已改變，任務資料、草稿及待核對操作已清除。請重新選擇孩子。");
    sessionChanged.current();
  }, [api, clear]);
  const verified = useCallback(async <T,>(operation: (signal: AbortSignal) => Promise<T>, signal: AbortSignal, write = false) => {
    if (await api.getSession(signal) !== userId) throw new TaskApiError(401);
    const result = await operation(signal);
    if (write) confirmedWrite.current = true;
    if (await api.getSession(signal) !== userId) throw new TaskApiError(401);
    return result;
  }, [api, userId]);

  const run = useCallback(async (label: string, operation: (signal: AbortSignal, current: Current) => Promise<void>, attempt?: Attempt, retry = false) => {
    if (!activeRef.current || !authorized || inFlight.current || (attempt && (!canManage || conflict || (unknown && !retry)))) return;
    inFlight.current = true;
    const started = generation.current;
    const controller = new AbortController(); requests.current.add(controller);
    const current = () => mounted.current && activeRef.current && !controller.signal.aborted && generation.current === started;
    if (attempt) {
      attemptRef.current = attempt; activeAttempt.current = attempt; confirmedWrite.current = false;
      if (retry) setUnknown(null);
    }
    setBusy(label); setNotice("");
    try {
      await operation(controller.signal, current);
      if (attempt && current()) { attemptRef.current = null; confirmedWrite.current = false; setUnknown(null); }
    } catch (error) {
      if ((attempt || unknown) && error instanceof TaskApiError && error.confirmed) confirmedWrite.current = true;
      if (!current()) return;
      const status = error instanceof TaskApiError ? error.status : 0;
      const code = error instanceof TaskApiError ? error.onlineCode : null;
      if ([401, 403, 404].includes(status) || code === "session_changed") revoke();
      else if (attempt && confirmedWrite.current) {
        setUnknown({ attempt, reviewed: false });
        setNotice("Server 已確認原操作，但結果或登入狀態尚待讀取。請查收據並重新讀取；毋須再次提交。");
      } else if (attempt?.kind === "change" && status === 409 && code === "version_conflict") {
        let sameUser: boolean | null = null;
        try { sameUser = await api.getSession(controller.signal) === userId; } catch { /* Keep the draft blocked until identity can be checked. */ }
        if (!current()) return;
        if (sameUser === false) revoke();
        else if (sameUser) {
          attemptRef.current = null; setConflict({ attempt, latest: null }); setChangeConfirmed(false);
          setNotice("版本已改變，修改草稿仍保留。請讀取最新版本，比較後明確使用新版本重新確認。");
        } else {
          setUnknown({ attempt, reviewed: false }); setNotice("暫未能核對登入帳號。草稿保留；請先查收據。");
        }
      } else if (attempt && (status === 0 || status >= 500 || status === 409)) {
        setUnknown({ attempt, reviewed: false });
        setNotice("提交結果未知。原內容及操作識別保留；請先查收據，系統不會自動重送。");
      } else {
        if (attempt) attemptRef.current = null;
        setNotice(attempt ? "輸入未被接納，請核對內容後再試。" : "讀取失敗，未能確認最新任務；現有草稿仍保留。");
      }
    } finally {
      requests.current.delete(controller);
      if (activeAttempt.current === attempt) activeAttempt.current = null;
      if (current()) { inFlight.current = false; setBusy(""); }
    }
  }, [authorized, canManage, conflict, unknown, api, userId, revoke]);

  const loadPage = useCallback(async (signal: AbortSignal, current: Current) => {
    const page = await verified(next => api.tasks(childId, null, next), signal);
    if (!current()) return;
    setItems(page.items); setAssignees(page.eligibleAssignees); setCursor(page.nextAfterId); setLoaded(true);
    setReminders(page.reminders ?? []); setWork(page.work ?? []); setWorkerEnabled(page.workerEnabled);
  }, [api, childId, verified]);
  useEffect(() => {
    mounted.current = true; generation.current++;
    api.resetOnline(); clear(); setAuthorized(true); setBusy(""); setNotice("");
    setVisibleApi(api);
    attemptRef.current = null; activeAttempt.current = null; confirmedWrite.current = false;
    return () => {
      mounted.current = false; generation.current++;
      for (const request of requests.current) request.abort();
      requests.current.clear(); inFlight.current = false;
      attemptRef.current = null; activeAttempt.current = null; confirmedWrite.current = false; api.resetOnline();
    };
  }, [api, clear]);
  useEffect(() => {
    if (active) return;
    if (activeAttempt.current) setUnknown({ attempt: activeAttempt.current, reviewed: false });
    generation.current++;
    for (const request of requests.current) request.abort();
    requests.current.clear(); inFlight.current = false; activeAttempt.current = null; setBusy("");
  }, [active]);

  const refresh = () => { void run("查核及重新讀取", async (signal, current) => {
    if (unknown) {
      if (await api.getSession(signal) !== userId) throw new TaskApiError(401);
      const receipt = confirmedWrite.current ? null : await api.reconcilePending(signal, userId);
      if (receipt?.state === "confirmed") confirmedWrite.current = true;
      if (await api.getSession(signal) !== userId) throw new TaskApiError(401);
      if (!current()) return;
      if (confirmedWrite.current) {
        resetAttemptDraft(unknown.attempt); attemptRef.current = null; setUnknown(null); confirmedWrite.current = false;
        try { await loadPage(signal, current); }
        catch (error) {
          if (error instanceof TaskApiError && [401, 403, 404].includes(error.status)) throw error;
          if (current()) setNotice("原操作已獲 Server 確認。清單讀取失敗，請稍後重新讀取；毋須再次提交。");
          return;
        }
        if (current()) setNotice("原操作已獲 Server 確認，請核對清單顯示的終態；毋須再次提交。");
        return;
      }
      await loadPage(signal, current);
      if (current()) {
        setUnknown({ ...unknown, reviewed: true });
        setNotice(receipt?.state === "unconfirmed" ? "原操作尚未確認。如要重試，請明確沿原操作識別提交。" : "沒有待核對的操作識別。請明確解除這次提交並保留草稿。");
      }
      return;
    }
    await loadPage(signal, current);
    if (conflict) {
      const latest = await verified(next => api.task(childId, conflict.attempt.basis.id, next), signal);
      if (current()) { setConflict({ ...conflict, latest }); setNotice("已讀取最新版本。請比較原版本、最新版本及修改草稿，再明確使用最新版本。"); }
    } else if (current()) setNotice("任務已更新；未提交草稿仍保留。");
  }); };
  refreshRef.current = refresh;
  useEffect(() => {
    if (active) refreshRef.current();
    // Only activation or API replacement starts the initial read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, api]);
  useEffect(() => {
    if (!active || typeof window === "undefined") return;
    const update = () => refreshRef.current();
    window.addEventListener(ONLINE_REFRESH_EVENT, update);
    return () => window.removeEventListener(ONLINE_REFRESH_EVENT, update);
  }, [active]);

  const performWrite = (attempt: Attempt, retry = false) => { void run(attempt.label, async (signal, current) => {
    const task = await verified(next => attempt.kind === "create" ? api.createTask(childId, attempt.input, next, userId)
      : api.changeTask(childId, attempt.basis.id, attempt.input, next, userId), signal, true);
    if (!current()) return;
    setItems(previous => [task, ...previous.filter(item => item.id !== task.id)]); resetAttemptDraft(attempt);
    setReminders(previous => previous.filter(item => item.taskId !== task.id));
    setWork(previous => previous.filter(item => item.taskId !== task.id));
    setHistory(null);
    setNotice(task.occurrence.state === "needs_review" ? "完成與取消出現衝突，任務待覆核並已停催。請明確覆核終態。" : `已確認${attempt.label}；狀態：${stateText[task.occurrence.state]}。`);
  }, attempt, retry); };
  const createTask = createForm.handleSubmit(values => {
    if (!createConfirmed || locked || !assignees.some(item => item.userId === values.assigneeUserId)) return;
    performWrite({ kind: "create", input: { values: structuredClone(values), confirm: true }, label: "建立任務" });
  });
  const saveChange = changeForm.handleSubmit(input => {
    if (!basis || !changeConfirmed || locked || !changeAllowed(basis, input.action)
      || (input.action === "reschedule" && !assignees.some(item => item.userId === input.assigneeUserId))) return;
    performWrite({ kind: "change", input: structuredClone(input), basis, label: actionText[input.action] });
  });
  const beginChange = (task: CareTask, nextAction: TaskChange["action"]) => {
    if (locked || !canManage || !changeAllowed(task, nextAction)) return;
    const next: TaskChange = nextAction === "reschedule" ? { action: nextAction, expectedVersion: task.version, confirm: true, note: "",
      dueAt: task.occurrence.dueAt, timeZone: task.occurrence.timeZone, assigneeUserId: task.assigneeUserId }
      : nextAction === "resolve" ? { action: nextAction, expectedVersion: task.version, confirm: true, note: "", outcome: "completed" }
        : { action: nextAction, expectedVersion: task.version, confirm: true, note: "" };
    setBasis(task); changeReset(next); setChangeConfirmed(false);
  };
  const nextPage = () => { if (!cursor) return; void run("載入更多任務", async (signal, current) => {
    const page = await verified(next => api.tasks(childId, cursor, next), signal);
    if (!current()) return;
    setItems(previous => [...previous, ...page.items.filter(item => !previous.some(old => old.id === item.id))]);
    const pageIds = new Set(page.items.map(item => item.id));
    setReminders(previous => [...previous.filter(item => !pageIds.has(item.taskId)), ...(page.reminders ?? [])]);
    setWork(previous => [...previous.filter(item => !pageIds.has(item.taskId)), ...(page.work ?? [])]);
    setWorkerEnabled(page.workerEnabled);
    setAssignees(page.eligibleAssignees); setCursor(page.nextAfterId);
  }); };
  const showHistory = (task: CareTask, before: number | null = null) => { void run("讀取任務歷史", async (signal, current) => {
    const page = await verified(next => api.history(childId, task.id, before, next), signal);
    if (!current()) return;
    setHistory(previous => ({ task, items: before !== null && previous?.task.id === task.id
      ? [...previous.items, ...page.revisions.filter(item => !previous.items.some(old => old.task.version === item.task.version))] : page.revisions,
    cursor: page.nextBeforeVersion }));
  }); };
  const retryUnknown = () => {
    if (!unknown?.reviewed || confirmedWrite.current || !api.hasPendingOnline() || !attemptRef.current) return;
    performWrite(attemptRef.current, true);
  };
  const releaseUnsent = () => {
    if (!unknown?.reviewed || confirmedWrite.current || api.hasPendingOnline()) return;
    attemptRef.current = null; setUnknown(null); setCreateConfirmed(false); setChangeConfirmed(false);
    setNotice("草稿已保留。請重新核對內容並明確確認，才會提交。");
  };
  const rebase = () => {
    if (!conflict?.latest || !changeAllowed(conflict.latest, conflict.attempt.input.action)) return;
    setBasis(conflict.latest); changeForm.setValue("expectedVersion", conflict.latest.version); setConflict(null); setChangeConfirmed(false);
    setNotice("已使用最新版本作比較基準，修改草稿仍保留。請重新核對並明確確認提交。");
  };
  const discardChange = () => { changeReset(emptyChange()); setBasis(null); setConflict(null); setChangeConfirmed(false); };
  const hasUnsavedWork = createForm.formState.isDirty || changeForm.formState.isDirty || !!basis || !!unknown || !!conflict || api.hasPendingOnline();
  useEffect(() => {
    if (!hasUnsavedWork || typeof window === "undefined") return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsavedWork]);

  if (visibleApi !== api) return null;
  if (!authorized) return <View style={styles.panel}><Text accessibilityRole="alert">{notice}</Text></View>;
  return <View style={styles.panel}>
    <Text variant="titleLarge">任務台帳</Text>
    <Text>本頁顯示站內任務、提醒及歷史。外部通知尚未接通；站內可見不代表已推送、已讀或任務完成。</Text>
    {loaded && <Text>{workerEnabled === true ? "已接上站內背景處理；實際處理狀態請核對下方 Server 台帳。"
      : workerEnabled === false ? "站內背景處理未啟用或還原後暫停；請查核 Server 設定。"
        : "Server 未提供背景處理啟用狀態；請查核是否尚未啟用或還原後暫停。"}</Text>}
    {!active && <Text>目前未在線核對，草稿已保留；重新啟用後先讀取最新資料。</Text>}
    {role === "viewer" && <Text>目前為唯讀權限。</Text>}
    {!!notice && <Text accessibilityRole="alert">{notice}</Text>}
    {!!busy && <Text>{busy}中…</Text>}
    <Button mode="outlined" onPress={refresh} disabled={!active || !!busy}>查收據及重新讀取</Button>
    {unknown && <View style={styles.box}>
      <Text variant="titleMedium">原操作待核對：{unknown.attempt.label}</Text>
      <Text>這次提交的內容已鎖定。請先查收據；重試會保留原內容及 opId。</Text>
      <Button onPress={retryUnknown} disabled={!active || !!busy || !unknown.reviewed || confirmedWrite.current || !api.hasPendingOnline()}>明確重試原操作識別</Button>
      <Button onPress={releaseUnsent} disabled={!active || !!busy || !unknown.reviewed || confirmedWrite.current || api.hasPendingOnline()}>沒有待核對操作，解除提交並保留草稿</Button>
    </View>}
    {conflict && <View style={styles.box}>
      <Text variant="titleMedium">版本衝突：請比較及重新確認</Text>
      <Text>原版本</Text><TaskText task={conflict.attempt.basis} assignees={assignees} />
      {conflict.latest ? <><Text>最新版本</Text><TaskText task={conflict.latest} assignees={assignees} /></> : <Text>請先重新讀取最新版本。</Text>}
      <Text>修改草稿保留於下方表單；重新讀取不會覆蓋。</Text>
      <Button onPress={rebase} disabled={!active || !!busy || !conflict.latest || !changeAllowed(conflict.latest, conflict.attempt.input.action)}>明確使用最新版本並保留修改草稿</Button>
      {conflict.latest && !changeAllowed(conflict.latest, conflict.attempt.input.action) && <Text>最新狀態已不接受這項操作。請先放棄這次修改，再按最新狀態選擇適用操作。</Text>}
      <Button onPress={discardChange} disabled={!active || !!busy}>放棄這次修改</Button>
    </View>}
    {canManage && <View style={styles.box}>
      <Text variant="titleMedium">建立任務</Text>
      <Field control={createForm.control} name="title" label="任務標題" disabled={locked} edited={() => setCreateConfirmed(false)} />
      <Field control={createForm.control} name="details" label="詳細內容" multiline disabled={locked} edited={() => setCreateConfirmed(false)} />
      <Controller control={createForm.control} name="kind" render={({ field }) => <RadioButton.Group value={field.value} onValueChange={value => { field.onChange(value); setCreateConfirmed(false); }}>
        <RadioButton.Item label="普通任務" value="ordinary" disabled={locked} /><RadioButton.Item label="預約" value="appointment" disabled={locked} />
      </RadioButton.Group>} />
      <AssigneeField control={createForm.control} name="assigneeUserId" assignees={assignees} disabled={locked} edited={() => setCreateConfirmed(false)} />
      <Field control={createForm.control} name="dueAt" label="任務時間（ISO，附時差）" placeholder="2026-10-01T09:00:00+08:00" help="請輸入明確時差或 Z；不會猜測裝置時區。" disabled={locked} edited={() => setCreateConfirmed(false)} />
      <Field control={createForm.control} name="timeZone" label="時區" disabled={locked} edited={() => setCreateConfirmed(false)} />
      <Confirmation label="我已核對內容、負責人及時間，確認建立" checked={createConfirmed} onToggle={() => setCreateConfirmed(value => !value)} disabled={locked} />
      <Button mode="contained" onPress={() => { void createTask(); }} disabled={locked || !loaded || !createConfirmed}>確認建立任務</Button>
    </View>}
    {canManage && basis && <View style={styles.box}>
      <Text variant="titleMedium">{actionText[action]}：版本 {basis.version}</Text>
      <TaskText task={basis} assignees={assignees} />
      {action === "reschedule" && <>
        <Field control={changeForm.control} name="dueAt" label="新時間（ISO，附時差）" placeholder="2026-10-01T09:00:00+08:00" disabled={locked} edited={() => setChangeConfirmed(false)} />
        <Field control={changeForm.control} name="timeZone" label="新時區" disabled={locked} edited={() => setChangeConfirmed(false)} />
        <AssigneeField control={changeForm.control} name="assigneeUserId" assignees={assignees} disabled={locked} edited={() => setChangeConfirmed(false)} />
      </>}
      {action === "resolve" && <Controller control={changeForm.control} name="outcome" render={({ field }) => <RadioButton.Group value={String(field.value)} onValueChange={value => { field.onChange(value); setChangeConfirmed(false); }}>
        <RadioButton.Item label="覆核為已完成" value="completed" disabled={locked} /><RadioButton.Item label="覆核為已取消" value="cancelled" disabled={locked} />
      </RadioButton.Group>} />}
      <Field control={changeForm.control} name="note" label={action === "complete" ? "完成備註（可選）" : "原因（必填）"} multiline disabled={locked} edited={() => setChangeConfirmed(false)} />
      <Confirmation label={`我已核對版本及內容，確認${actionText[action]}`} checked={changeConfirmed} onToggle={() => setChangeConfirmed(value => !value)} disabled={locked} />
      <Button mode="contained" onPress={() => { void saveChange(); }} disabled={locked || !changeConfirmed}>確認{actionText[action]}</Button>
      <Button onPress={discardChange} disabled={locked}>放棄修改草稿</Button>
    </View>}
    {!loaded && <Text>尚未成功讀取任務清單。</Text>}
    {loaded && items.length === 0 && <Text>目前沒有任務。</Text>}
    {items.map(task => {
      const currentWork = work.find(item => item.taskId === task.id && item.taskVersion === task.version);
      const currentReminders = task.occurrence.state === "scheduled" ? reminders.filter(item => item.taskId === task.id
        && item.taskVersion === task.version && item.occurrenceId === task.occurrence.id) : [];
      return <View key={task.id} style={styles.box}>
      <TaskText task={task} assignees={assignees} />
      {currentWork ? <View style={styles.stack}>
        <Text>Server 背景處理台帳：{workStateText[currentWork.status]}；版本 {currentWork.taskVersion}</Text>
        <Text>台帳記錄的排定檢查時間：{currentWork.nextAt}；失敗次數：{currentWork.failures}</Text>
      </View> : <Text>此版本尚未有 Server 背景處理紀錄。</Text>}
      {currentReminders.map(reminder => <Text key={reminder.id}>站內提醒（{reminder.phase === "initial" ? "初次" : "一次跟進"}）；記錄時間：{reminder.createdAt}</Text>)}
      <View style={styles.row}>
        <Button onPress={() => showHistory(task)} disabled={!active || !!busy}>歷史</Button>
        {canManage && task.occurrence.state === "scheduled" && <>
          <Button onPress={() => beginChange(task, "reschedule")} disabled={locked}>改期／轉派</Button>
          <Button onPress={() => beginChange(task, "complete")} disabled={locked}>完成</Button>
          <Button onPress={() => beginChange(task, "cancel")} disabled={locked}>取消</Button>
        </>}
        {canManage && task.occurrence.state === "needs_review" && <Button onPress={() => beginChange(task, "resolve")} disabled={locked}>明確覆核終態</Button>}
      </View>
    </View>;
    })}
    {cursor && <Button onPress={nextPage} disabled={!active || !!busy}>載入更多任務</Button>}
    {history && <View style={styles.box}>
      <Text variant="titleMedium">{history.task.title}：修改歷史</Text>
      {history.items.map(revision => <View key={revision.task.version} style={styles.stack}>
        <Text>{revision.at}；{actionText[revision.action]}；操作者：{revision.actorUserId}；基準版本 {revision.basisVersion}</Text>
        <TaskText task={revision.task} assignees={assignees} /><Text>原因／備註：{revision.note || "沒有備註"}</Text>
      </View>)}
      {history.cursor !== null && <Button onPress={() => showHistory(history.task, history.cursor)} disabled={!active || !!busy}>載入較早歷史</Button>}
    </View>}
  </View>;
}

const styles = StyleSheet.create({
  panel: { gap: 12, paddingVertical: 12 }, box: { gap: 10, padding: 12, borderWidth: 1, borderColor: "#d2d2d2", borderRadius: 6 },
  stack: { gap: 4 }, row: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  confirmation: { flexDirection: "row", alignItems: "center", gap: 6 }, confirmationLabel: { flex: 1 },
});
