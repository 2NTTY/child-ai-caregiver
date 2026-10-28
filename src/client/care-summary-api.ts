import { z } from "zod";
import { importProvenanceSchema } from '../shared/import-provenance.ts';
import { CARE_KINDS } from "../shared/care.ts";
import {
  preparationInput, summaryQuery, type CareSummary, type PreparationInput, type SummaryQuery, type VisitPreparation,
} from "../shared/care-summary.ts";
import type { OnlineReceipt } from "../shared/online.ts";
import { taskDueAtSchema, taskTimeZoneSchema, taskValuesSchema } from "../shared/tasks.ts";
import { createOnlineTransport, OnlineTransportError } from "./online-transport.ts";

export class CareSummaryApiError extends Error {
  readonly status: number;
  readonly onlineCode: string | null;
  readonly confirmed: boolean;
  constructor(status = 0, onlineCode: string | null = null, confirmed = false) {
    super("Care summary request could not be confirmed");
    this.name = "CareSummaryApiError";
    this.status = status;
    this.onlineCode = onlineCode;
    this.confirmed = confirmed;
  }
}

export interface CareSummaryApi {
  summary(childId: string, query: SummaryQuery, signal: AbortSignal, userId: string): Promise<CareSummary>;
  savePreparation(childId: string, input: PreparationInput, signal: AbortSignal, userId: string): Promise<VisitPreparation>;
  reconcilePending(signal: AbortSignal, userId: string): Promise<OnlineReceipt | { state: "unconfirmed" } | null>;
  hasPendingOnline(): boolean;
  resetOnline(): void;
}

const user = z.string().min(1).max(128);
const version = z.number().int().nonnegative().max(2147483647);
const positiveVersion = version.refine(value => value > 0);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const dateTime = z.iso.datetime({ offset: true });
const day = summaryQuery.shape.startDay;
const basis = preparationInput.shape.basisVersion;
const careKind = z.enum(CARE_KINDS);
const age = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unknown") }).strict(),
  z.object({ kind: z.literal("birth_date"), date: day }).strict(),
  z.object({ kind: z.literal("approximate"), rawValue: z.string(), unit: z.enum(["days", "weeks", "months", "years"]), asOf: day }).strict(),
]);
const profile = z.object({
  confirmationBasis: z.enum(['explicit', 'imported_source']).optional(), importedFrom: importProvenanceSchema.optional(),
  childId: z.uuid(), version,
  data: z.object({
    age, dueDate: day.nullable(), gestationalWeeksRaw: z.string().nullable(), region: z.string().nullable(),
    language: z.string().nullable(), allergies: z.string().nullable(), specialNeeds: z.string().nullable(),
    preferences: z.string().nullable(), source: z.string(), validUntil: day.nullable(),
  }).strict().nullable(),
  confirmedBy: user.nullable(), confirmedAt: dateTime.nullable(), reason: z.string().nullable(),
}).strict();
const record = z.object({
  id: z.uuid(), childId: z.uuid(), authorUserId: user, createdAt: dateTime, version: positiveVersion,
  text: z.string(), source: z.string(), confirmedBy: user, confirmedAt: dateTime, reason: z.string(),
  confirmationBasis: z.enum(["explicit", "preauthorized_user_statement", 'imported_source']).optional(), importedFrom: importProvenanceSchema.optional(),
  details: z.object({
    kind: careKind,
    quantity: z.object({ rawValue: z.string(), unit: z.string(), precision: z.enum(["exact", "approximate"]) }).strict().nullable(),
    eventTime: z.object({
      rawText: z.string(), at: dateTime.nullable(), timeZone: z.string(), precision: z.enum(["exact", "approximate", "unknown"]),
    }).strict(),
  }).strict(),
}).strict();
const task = taskValuesSchema.omit({ dueAt: true, timeZone: true }).extend({
  importedFrom: importProvenanceSchema.optional(),
  id: z.uuid(), childId: z.uuid(), version: positiveVersion, createdBy: user, createdAt: dateTime, updatedAt: dateTime,
  occurrence: z.object({
    id: z.uuid(), dueAt: taskDueAtSchema, timeZone: taskTimeZoneSchema,
    state: z.enum(["scheduled", "completed", "cancelled", "needs_review"]), terminalBasisVersion: positiveVersion.nullable(),
  }).strict(),
}).strict();
const preparation = z.object({
  version, appointmentTaskId: z.uuid().nullable(), questions: z.array(z.string().min(1).max(500)).max(12),
  checklist: z.array(z.object({ text: z.string().min(1).max(300), done: z.boolean() }).strict()).max(16),
  reviewed: z.boolean(), reviewedBasis: basis.nullable(), period: summaryQuery.nullable(),
  updatedBy: user.nullable(), updatedAt: dateTime.nullable(),
}).strict();
const summary = z.object({
  childId: z.uuid(), childName: z.string(), profile, canManage: z.boolean(), period: summaryQuery,
  endDayExclusive: day, generatedAt: dateTime, basisVersion: basis,
  counts: z.object({ note: count, feeding: count, sleep: count, diaper: count, temperature: count, measurement: count, appointment: count }).strict(),
  metrics: z.array(z.object({
    kind: careKind, unit: z.string(), samples: count, approximate: count, total: z.string().nullable(),
    min: z.string(), max: z.string(), recordIds: z.array(z.uuid()),
  }).strict()),
  records: z.array(record), missing: z.object({ unknownEventTime: count, invalidQuantities: count, emptyKinds: z.array(careKind) }).strict(),
  appointments: z.array(task), conflicts: z.array(task), preparation, reviewCurrent: z.boolean(),
}).strict();
const preparationResult = z.object({ preparation }).strict();
const samePeriod = (left: SummaryQuery, right: SummaryQuery) => left.startDay === right.startDay
  && left.period === right.period && left.timeZone === right.timeZone;

export function createCareSummaryApi(baseUrl = "", fetcher: typeof fetch = fetch): CareSummaryApi {
  const base = baseUrl.replace(/\/$/u, "");
  const apiUrl = base.endsWith("/api") ? base : base + "/api";
  const online = createOnlineTransport(apiUrl, fetcher);
  let generation = 0;
  const childPath = (childId: string) => "/children/" + encodeURIComponent(childId);
  const validateIdentity = (childId: string, userId: string) => {
    if (!z.uuid().safeParse(childId).success || !user.safeParse(userId).success) throw new CareSummaryApiError(400, "invalid_input");
  };

  async function call<T>(signal: AbortSignal, action: (innerSignal: AbortSignal) => Promise<T>): Promise<T> {
    const started = generation;
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) controller.abort();
    const timeout = setTimeout(abort, 20_000);
    try {
      if (controller.signal.aborted) throw new CareSummaryApiError();
      const value = await action(controller.signal);
      if (controller.signal.aborted || started !== generation) throw new CareSummaryApiError();
      return value;
    } catch (error) {
      if (error instanceof CareSummaryApiError) throw error;
      if (error instanceof OnlineTransportError) throw new CareSummaryApiError(error.status, error.code, error.confirmed);
      throw new CareSummaryApiError();
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
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
        if (confirmed && error instanceof CareSummaryApiError) throw new CareSummaryApiError(error.status, error.onlineCode, true);
        throw error;
      }
    },
    async summary(childId, query, signal, userId) {
      validateIdentity(childId, userId);
      const input = summaryQuery.safeParse(query);
      if (!input.success) throw new CareSummaryApiError(400, "invalid_input");
      const search = new URLSearchParams(input.data).toString();
      const value = await call(signal, async innerSignal => {
        const response = await fetcher(apiUrl + childPath(childId) + "/summary?" + search, {
          method: "GET", credentials: "include", cache: "no-store", signal: innerSignal,
          headers: { Accept: "application/json", "x-expected-user-id": userId },
        });
        if (!response.ok) {
          let code: string | null = null;
          try {
            const body: unknown = await response.json();
            if (typeof body === "object" && body !== null && "error" in body
              && typeof body.error === "object" && body.error !== null && "code" in body.error
              && typeof body.error.code === "string" && ["session_changed", "summary_range_too_large", "summary_scope_too_large"].includes(body.error.code)) code = body.error.code;
          } catch { /* A response body is never an error message. */ }
          throw new CareSummaryApiError(response.status, code);
        }
        return await response.json() as unknown;
      });
      const parsed = summary.safeParse(value);
      if (!parsed.success || parsed.data.childId !== childId || parsed.data.profile.childId !== childId
        || !samePeriod(parsed.data.period, input.data)
        || parsed.data.records.some(item => item.childId !== childId)
        || parsed.data.appointments.some(item => item.childId !== childId || item.kind !== "appointment" || item.occurrence.state !== "scheduled")
        || parsed.data.conflicts.some(item => item.childId !== childId || item.occurrence.state !== "needs_review")) {
        throw new CareSummaryApiError();
      }
      return parsed.data;
    },
    async savePreparation(childId, input, signal, userId) {
      validateIdentity(childId, userId);
      const payload = preparationInput.safeParse(input);
      if (!payload.success) throw new CareSummaryApiError(400, "invalid_input");
      let confirmed = false;
      try {
        const value = await call(signal, async innerSignal => {
          const result = await online.submit({ path: "/api" + childPath(childId) + "/visit-preparation", payload: payload.data }, innerSignal, userId);
          confirmed = true;
          return result;
        });
        const parsed = preparationResult.safeParse(value);
        if (!parsed.success || parsed.data.preparation.version <= payload.data.expectedVersion
          || parsed.data.preparation.appointmentTaskId !== payload.data.appointmentTaskId
          || parsed.data.preparation.reviewed !== payload.data.reviewed || parsed.data.preparation.updatedBy !== userId
          || (payload.data.reviewed ? parsed.data.preparation.reviewedBasis === null : parsed.data.preparation.reviewedBasis !== null)
          || parsed.data.preparation.period === null || !samePeriod(parsed.data.preparation.period, payload.data.period)
          || JSON.stringify(parsed.data.preparation.questions) !== JSON.stringify(payload.data.questions)
          || JSON.stringify(parsed.data.preparation.checklist) !== JSON.stringify(payload.data.checklist)) {
          throw new CareSummaryApiError(0, null, true);
        }
        return parsed.data.preparation;
      } catch (error) {
        if (confirmed && error instanceof CareSummaryApiError) throw new CareSummaryApiError(error.status, error.onlineCode, true);
        throw error;
      }
    },
  };
}
