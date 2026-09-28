import { z } from "zod";
import type { OnlineReceipt } from "../shared/online.ts";
import {
  contactAcknowledgeInput, contactBindingSchema, contactChannelSchema, contactConsentInput, contactGrantInput,
  type ContactConsent, type ContactConsentInput, type ContactGrant, type ContactGrantInput, type ContactPage,
} from "../shared/contact.ts";
import { taskDueAtSchema, taskTimeZoneSchema, taskValuesSchema } from "../shared/tasks.ts";
import { createOnlineTransport, OnlineTransportError } from "./online-transport.ts";

export class ContactApiError extends Error {
  readonly status: number;
  readonly onlineCode: string | null;
  readonly confirmed: boolean;
  constructor(status = 0, onlineCode: string | null = null, confirmed = false) {
    super("Contact request could not be confirmed");
    this.name = "ContactApiError";
    this.status = status;
    this.onlineCode = onlineCode;
    this.confirmed = confirmed;
  }
}

export interface ContactApi {
  page(childId: string, signal: AbortSignal, userId: string): Promise<ContactPage>;
  consent(childId: string, input: ContactConsentInput, signal: AbortSignal, userId: string): Promise<ContactConsent>;
  authorization(childId: string, taskId: string, input: ContactGrantInput, signal: AbortSignal, userId: string): Promise<ContactGrant>;
  acknowledge(childId: string, attemptId: string, input: { confirmReceived: true }, signal: AbortSignal, userId: string): Promise<void>;
  reconcilePending(signal: AbortSignal, userId: string): Promise<OnlineReceipt | { state: "unconfirmed" } | null>;
  hasPendingOnline(): boolean;
  resetOnline(): void;
}

const user = z.string().min(1).max(128);
const version = z.number().int().positive().max(2147483647);
const dateTime = z.iso.datetime({ offset: true });
const consentSchema = z.object({
  userId: user, version: z.number().int().min(0).max(2147483647), enabled: z.boolean(), allowBackup: z.boolean(),
  bindings: z.array(contactBindingSchema).max(2).refine(values => new Set(values.map(value => value.channel)).size === values.length),
}).strict();
const grantSchema = z.object({
  taskId: z.uuid(), version, taskVersion: version, enabled: z.boolean(), primaryUserId: user, backupUserId: user.nullable(),
  allowFollowUp: z.boolean(), allowFallback: z.boolean(), validUntil: dateTime, authorizedBy: user,
  content: z.literal("generic_notice"), trigger: z.literal("task_due"), updatedAt: dateTime,
}).strict();
const taskSchema = taskValuesSchema.omit({ dueAt: true, timeZone: true }).extend({
  id: z.uuid(), childId: z.uuid(), version, createdBy: user, createdAt: dateTime, updatedAt: dateTime,
  occurrence: z.object({
    id: z.uuid(), dueAt: taskDueAtSchema, timeZone: taskTimeZoneSchema,
    state: z.enum(["scheduled", "completed", "cancelled", "needs_review"]), terminalBasisVersion: version.nullable(),
  }).strict(),
});
const attemptSchema = z.object({
  id: z.uuid(), recipientUserId: user, channel: contactChannelSchema, grantVersion: version, taskVersion: version,
  status: z.enum(["sending", "accepted", "rejected", "unknown", "stopped"]), reason: z.string().nullable(),
  providerStatus: z.number().int().nullable(), messageId: z.number().int().nullable(), attemptedAt: dateTime,
  finishedAt: dateTime.nullable(), acknowledgedAt: dateTime.nullable(),
}).strict();
const pageSchema = z.object({
  canManage: z.boolean(), workerEnabled: z.boolean(), consent: consentSchema,
  availableBindings: z.array(contactBindingSchema.extend({ label: z.string() })),
  recipients: z.array(z.object({
    userId: user, name: z.string(), enabled: z.boolean(), allowBackup: z.boolean(), channels: z.array(contactChannelSchema).max(2),
  }).strict()),
  tasks: z.array(taskSchema).max(50), tasksHaveMore: z.boolean(), grants: z.array(grantSchema),
  requests: z.array(z.object({
    id: z.uuid(), taskId: z.uuid(), taskVersion: version, occurrenceId: z.uuid(), phase: z.enum(["initial", "follow_up"]),
    state: z.enum(["pending", "accepted", "rejected", "unknown", "stopped", "coalesced"]), reason: z.string().nullable(),
    nextAt: dateTime, groupedTo: z.uuid().nullable(), createdAt: dateTime, attempts: z.array(attemptSchema),
  }).strict()).max(50),
  historyLimited: z.boolean(),
}).strict();
const consentResult = z.object({ consent: consentSchema }).strict();
const grantResult = z.object({ grant: grantSchema }).strict();
const acknowledgedResult = z.object({ acknowledged: z.literal(true) }).strict();

export function createContactApi(baseUrl = "", fetcher: typeof fetch = fetch): ContactApi {
  const base = baseUrl.replace(/\/$/u, "");
  const apiUrl = base.endsWith("/api") ? base : base + "/api";
  const online = createOnlineTransport(apiUrl, fetcher);
  let generation = 0;
  const child = (childId: string) => "/children/" + encodeURIComponent(childId) + "/contact";

  async function call<T>(signal: AbortSignal, action: (innerSignal: AbortSignal) => Promise<T>): Promise<T> {
    const started = generation;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) controller.abort();
    const timeout = setTimeout(abort, 20_000);
    try {
      if (controller.signal.aborted) throw new ContactApiError();
      const value = await action(controller.signal);
      if (controller.signal.aborted || started !== generation) throw new ContactApiError();
      return value;
    } catch (error) {
      if (error instanceof ContactApiError) throw error;
      if (error instanceof OnlineTransportError) throw new ContactApiError(error.status, error.code, error.confirmed);
      throw new ContactApiError();
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  }

  async function mutate(path: string, payload: unknown, signal: AbortSignal, userId: string): Promise<unknown> {
    let confirmed = false;
    try {
      return await call(signal, async innerSignal => {
        const value = await online.submit({ path: "/api" + path, payload }, innerSignal, userId);
        confirmed = true;
        return value;
      });
    } catch (error) {
      if (confirmed && error instanceof ContactApiError) throw new ContactApiError(error.status, error.onlineCode, true);
      throw error;
    }
  }

  return {
    hasPendingOnline: () => online.hasPending(),
    resetOnline() { generation++; online.reset(); },
    async reconcilePending(signal, userId) {
      let confirmed = false;
      try {
        return await call(signal, async innerSignal => {
          const receipt = await online.checkPending(innerSignal, userId);
          confirmed = receipt?.state === "confirmed";
          return receipt;
        });
      } catch (error) {
        if (confirmed && error instanceof ContactApiError) throw new ContactApiError(error.status, error.onlineCode, true);
        throw error;
      }
    },
    async page(childId, signal, userId) {
      const value = await call(signal, async innerSignal => {
        const response = await fetcher(apiUrl + child(childId), {
          method: "GET", credentials: "include", cache: "no-store", signal: innerSignal,
          headers: { Accept: "application/json", "x-expected-user-id": userId },
        });
        if (!response.ok) throw new ContactApiError(response.status);
        return await response.json() as unknown;
      });
      const parsed = pageSchema.safeParse(value);
      if (!parsed.success || parsed.data.consent.userId !== userId || parsed.data.tasks.some(task => task.childId !== childId)) {
        throw new ContactApiError();
      }
      return parsed.data;
    },
    async consent(childId, input, signal, userId) {
      const payload = contactConsentInput.safeParse(input);
      if (!payload.success) throw new ContactApiError(400, "invalid_input");
      const parsed = consentResult.safeParse(await mutate(child(childId) + "/consent", payload.data, signal, userId));
      if (!parsed.success || parsed.data.consent.userId !== userId || parsed.data.consent.version <= input.expectedVersion
        || parsed.data.consent.enabled !== input.enabled) throw new ContactApiError(0, null, true);
      return parsed.data.consent;
    },
    async authorization(childId, taskId, input, signal, userId) {
      const payload = contactGrantInput.safeParse(input);
      if (!payload.success) throw new ContactApiError(400, "invalid_input");
      const parsed = grantResult.safeParse(await mutate(child(childId) + "/tasks/" + encodeURIComponent(taskId) + "/authorization",
        payload.data, signal, userId));
      if (!parsed.success || parsed.data.grant.taskId !== taskId || parsed.data.grant.version <= input.expectedVersion
        || parsed.data.grant.taskVersion !== input.expectedTaskVersion || parsed.data.grant.enabled !== input.enabled) {
        throw new ContactApiError(0, null, true);
      }
      return parsed.data.grant;
    },
    async acknowledge(childId, attemptId, input, signal, userId) {
      const payload = contactAcknowledgeInput.safeParse(input);
      if (!payload.success) throw new ContactApiError(400, "invalid_input");
      const parsed = acknowledgedResult.safeParse(await mutate(child(childId) + "/attempts/" + encodeURIComponent(attemptId) + "/acknowledge",
        payload.data, signal, userId));
      if (!parsed.success) throw new ContactApiError(0, null, true);
    },
  };
}
