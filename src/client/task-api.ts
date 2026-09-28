import { z } from "zod";
import type { OnlineReceipt } from "../shared/online.ts";
import { taskDueAtSchema, taskTimeZoneSchema, taskValuesSchema, type CareTask, type TaskChange, type TaskCreate, type TaskHistory, type TaskPage } from "../shared/tasks.ts";
import { createOnlineTransport, OnlineTransportError } from "./online-transport.ts";

export class TaskApiError extends Error {
  readonly status: number;
  readonly onlineCode: string | null;
  readonly confirmed: boolean;
  constructor(status = 0, onlineCode: string | null = null, confirmed = false) {
    super("Task request could not be confirmed");
    this.name = "TaskApiError";
    this.status = status;
    this.onlineCode = onlineCode;
    this.confirmed = confirmed;
  }
}

export interface TaskApi {
  getSession(signal: AbortSignal): Promise<string | null>;
  tasks(childId: string, afterId: string | null, signal: AbortSignal): Promise<TaskPage>;
  task(childId: string, taskId: string, signal: AbortSignal): Promise<CareTask>;
  history(childId: string, taskId: string, beforeVersion: number | null, signal: AbortSignal): Promise<TaskHistory>;
  createTask(childId: string, input: TaskCreate, signal: AbortSignal, userId: string): Promise<CareTask>;
  changeTask(childId: string, taskId: string, input: TaskChange, signal: AbortSignal, userId: string): Promise<CareTask>;
  reconcilePending(signal: AbortSignal, userId: string): Promise<OnlineReceipt | { state: "unconfirmed" } | null>;
  resetOnline(): void;
  hasPendingOnline(): boolean;
}

const version = z.number().int().positive().max(2147483647);
const dateTime = z.iso.datetime({ offset: true });
const taskSchema = taskValuesSchema.omit({ dueAt: true, timeZone: true }).extend({
  id: z.uuid(), childId: z.uuid(), version, createdBy: z.string().min(1).max(128), createdAt: dateTime, updatedAt: dateTime,
  occurrence: z.object({ id: z.uuid(), dueAt: taskDueAtSchema, timeZone: taskTimeZoneSchema,
    state: z.enum(["scheduled", "completed", "cancelled", "needs_review"]), terminalBasisVersion: version.nullable() }),
});
const taskResultSchema = z.object({ task: taskSchema });
const pageSchema = z.object({ items: z.array(taskSchema),
  eligibleAssignees: z.array(z.object({ userId: z.string().min(1).max(128), name: z.string() })), nextAfterId: z.uuid().nullable() });
const historySchema = z.object({ revisions: z.array(z.object({ task: taskSchema,
  action: z.enum(["create", "reschedule", "complete", "cancel", "resolve"]), actorUserId: z.string().min(1).max(128),
  basisVersion: z.number().int().min(0).max(2147483646), note: z.string().max(1000), at: dateTime })), nextBeforeVersion: version.nullable() });
type Target = { childId: string; taskId?: string; expectedVersion?: number };

function checkedTask(value: unknown, target: Target, confirmed = false): CareTask {
  const parsed = taskResultSchema.safeParse(value);
  if (!parsed.success || parsed.data.task.childId !== target.childId || (target.taskId !== undefined && parsed.data.task.id !== target.taskId)
    || (target.expectedVersion !== undefined && parsed.data.task.version <= target.expectedVersion)) throw new TaskApiError(0, null, confirmed);
  return parsed.data.task;
}

export function createTaskApi(baseUrl = "", fetcher: typeof fetch = fetch): TaskApi {
  const base = baseUrl.replace(/\/$/u, "");
  const apiUrl = base.endsWith("/api") ? base : `${base}/api`;
  const online = createOnlineTransport(apiUrl, fetcher);
  let generation = 0;
  let pendingTarget: Target | null = null;
  let pendingUser: string | null = null;

  async function call<T>(signal: AbortSignal, action: (innerSignal: AbortSignal) => Promise<T>): Promise<T> {
    const started = generation;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) controller.abort();
    const timeout = setTimeout(abort, 20_000);
    try {
      if (controller.signal.aborted) throw new TaskApiError();
      const result = await action(controller.signal);
      if (controller.signal.aborted || started !== generation) throw new TaskApiError();
      return result;
    } catch (error) {
      if (error instanceof TaskApiError) throw error;
      if (error instanceof OnlineTransportError) throw new TaskApiError(error.status, error.code, error.confirmed);
      throw new TaskApiError();
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  }
  const request = (path: string, signal: AbortSignal): Promise<unknown> => call(signal, async innerSignal => {
    const response = await fetcher(`${apiUrl}${path}`, { method: "GET", credentials: "include", cache: "no-store",
      headers: { Accept: "application/json" }, signal: innerSignal });
    if (!response.ok) throw new TaskApiError(response.status);
    return await response.json();
  });
  const child = (childId: string) => `/children/${encodeURIComponent(childId)}/tasks`;
  const entity = (childId: string, taskId: string) => `${child(childId)}/${encodeURIComponent(taskId)}`;
  const cursor = (key: string, value: string | number | null) => value === null ? "" : `?${key}=${encodeURIComponent(value)}`;
  async function mutate(path: string, payload: unknown, target: Target, signal: AbortSignal, userId: string): Promise<CareTask> {
    if (pendingUser !== null && pendingUser !== userId) { online.reset(); pendingTarget = null; pendingUser = null; }
    if (!online.hasPending()) { pendingTarget = target; pendingUser = userId; }
    let confirmed = false;
    try {
      const result = await call(signal, async innerSignal => {
        const value = await online.submit({ path: `/api${path}`, payload }, innerSignal, userId);
        confirmed = true;
        return value;
      });
      return checkedTask(result, target, true);
    } catch (error) {
      if (confirmed && error instanceof TaskApiError) throw new TaskApiError(error.status, error.onlineCode, true);
      throw error;
    } finally {
      if (!online.hasPending()) { pendingTarget = null; pendingUser = null; }
    }
  }
  return {
    resetOnline() { generation++; pendingTarget = null; pendingUser = null; online.reset(); },
    hasPendingOnline: () => online.hasPending(),
    async reconcilePending(signal, userId) {
      const target = pendingTarget;
      let confirmed = false;
      let receipt: OnlineReceipt | { state: "unconfirmed" } | null;
      try {
        receipt = await call(signal, async innerSignal => {
          const value = await online.checkPending(innerSignal, userId);
          confirmed = value?.state === "confirmed";
          return value;
        });
      } catch (error) {
        if (!online.hasPending()) { pendingTarget = null; pendingUser = null; }
        if (confirmed && error instanceof TaskApiError) throw new TaskApiError(error.status, error.onlineCode, true);
        throw error;
      }
      if (receipt?.state === "confirmed") {
        pendingTarget = null; pendingUser = null;
        if (receipt.result !== null) {
          if (!target) throw new TaskApiError(0, null, true);
          checkedTask(receipt.result, target, true);
        }
      } else if (!online.hasPending()) { pendingTarget = null; pendingUser = null; }
      return receipt;
    },
    async getSession(signal) {
      const value = await request("/auth/get-session", signal);
      if (value === null) return null;
      const parsed = z.object({ user: z.object({ id: z.string().min(1) }) }).safeParse(value);
      if (!parsed.success) throw new TaskApiError();
      return parsed.data.user.id;
    },
    async tasks(childId, afterId, signal) {
      const parsed = pageSchema.safeParse(await request(`${child(childId)}${cursor("afterId", afterId)}`, signal));
      if (!parsed.success || parsed.data.items.some(item => item.childId !== childId)) throw new TaskApiError();
      return parsed.data;
    },
    async task(childId, taskId, signal) { return checkedTask(await request(entity(childId, taskId), signal), { childId, taskId }); },
    async history(childId, taskId, beforeVersion, signal) {
      const parsed = historySchema.safeParse(await request(`${entity(childId, taskId)}/history${cursor("beforeVersion", beforeVersion)}`, signal));
      if (!parsed.success || parsed.data.revisions.some(revision => revision.task.childId !== childId || revision.task.id !== taskId)) throw new TaskApiError();
      return parsed.data;
    },
    createTask: (childId, input, signal, userId) => mutate(child(childId), input, { childId }, signal, userId),
    changeTask: (childId, taskId, input, signal, userId) => mutate(`${entity(childId, taskId)}/change`, input,
      { childId, taskId, expectedVersion: input.expectedVersion }, signal, userId),
  };
}
