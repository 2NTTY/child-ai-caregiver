import type { CareTask, TaskChange, TaskState } from "../src/shared/tasks.ts";
import type { NotificationPreferences } from "../src/shared/family.ts";
import { FamilyError } from "./family-access.ts";

/** Stable occurrence identity; a terminal state is never reopened by an old write. */
export function changeTask(task: CareTask, input: TaskChange, at: string): CareTask {
  if (task.version >= 2147483647) throw new FamilyError(409, "version_conflict");
  let state: TaskState = task.occurrence.state;
  let terminalBasisVersion = task.occurrence.terminalBasisVersion;
  if (task.version !== input.expectedVersion) {
    const opposite = state === "completed" && input.action === "cancel" || state === "cancelled" && input.action === "complete";
    if (!opposite || task.version !== input.expectedVersion + 1 || terminalBasisVersion !== input.expectedVersion) {
      throw new FamilyError(409, "version_conflict");
    }
    state = "needs_review"; terminalBasisVersion = null;
  } else if (input.action === "resolve") {
    if (state !== "needs_review") throw new FamilyError(409, "version_conflict");
    state = input.outcome; terminalBasisVersion = null;
  } else {
    if (state !== "scheduled") throw new FamilyError(409, "version_conflict");
    if (input.action === "complete" || input.action === "cancel") {
      state = input.action === "complete" ? "completed" : "cancelled";
      terminalBasisVersion = input.expectedVersion;
    }
  }
  return { ...task, version: task.version + 1, updatedAt: at,
    ...(input.action === "reschedule" ? { assigneeUserId: input.assigneeUserId } : {}),
    occurrence: { ...task.occurrence, state, terminalBasisVersion,
      ...(input.action === "reschedule" ? { dueAt: input.dueAt, timeZone: input.timeZone } : {}) } };
}

export interface ReminderEvidence {
  authorized: boolean; assigneeEligible: boolean; initialAt: string | null; followUpAt: string | null;
  lastOrdinaryBatchAt: string | null; deliveryUnknown: boolean;
}
export type ReminderDecision = "not_due" | "stopped" | "not_authorized" | "unknown" | "quiet" | "daily_limit" | "follow_up_limit" | "initial" | "follow_up";
const calendarFormatters = new Map<string, Intl.DateTimeFormat>();
export function reminderLocalTime(at: string, timeZone: string) {
  let formatter = calendarFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    calendarFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(new Date(at));
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return { day: `${part("year")}-${part("month")}-${part("day")}`, minutes: Number(part("hour")) * 60 + Number(part("minute")) };
}
/** Pure eligibility only. The worker must lock/recheck and persist a batch before delivery. */
export function reminderDecision(task: CareTask, preferences: NotificationPreferences, evidence: ReminderEvidence, now: string): ReminderDecision {
  if (task.occurrence.state !== "scheduled") return "stopped";
  if (!evidence.authorized || !evidence.assigneeEligible) return "not_authorized";
  if (evidence.deliveryUnknown) return "unknown";
  if (Date.parse(task.occurrence.dueAt) > Date.parse(now)) return "not_due";
  const local = reminderLocalTime(now, preferences.timeZone);
  const minutes = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  const start = minutes(preferences.quietStart), end = minutes(preferences.quietEnd);
  const quiet = start !== end && (start < end ? local.minutes >= start && local.minutes < end : local.minutes >= start || local.minutes < end);
  if (quiet && !(task.kind === "appointment" && preferences.allowAppointmentDuringQuiet)) return "quiet";
  if (task.kind === "ordinary" && evidence.lastOrdinaryBatchAt && reminderLocalTime(evidence.lastOrdinaryBatchAt, preferences.timeZone).day === local.day) return "daily_limit";
  if (!evidence.initialAt) return "initial";
  if (task.kind === "appointment" || evidence.followUpAt) return "follow_up_limit";
  // Do not turn two due checks in one day into an immediate follow-up.
  if (reminderLocalTime(evidence.initialAt, preferences.timeZone).day === local.day) return "daily_limit";
  return "follow_up";
}

/** Find a real UTC instant, including DST changes; do not guess an IANA offset. */
export function nextReminderCheck(task: CareTask, preferences: NotificationPreferences, evidence: ReminderEvidence, now: string): string | null {
  const decision = reminderDecision(task, preferences, evidence, now);
  if (decision === "not_due") return task.occurrence.dueAt;
  if (decision === "initial" || decision === "follow_up") return now;
  if (decision !== "quiet" && decision !== "daily_limit") return null;
  const start = (Math.floor(Date.parse(now) / 60000) + 1) * 60000;
  // Minute precision matches preferences; a DST day can exceed 24 hours.
  for (let offset = 0; offset < 48 * 60; offset++) {
    const candidate = new Date(start + offset * 60000).toISOString();
    const next = reminderDecision(task, preferences, evidence, candidate);
    if (next === "initial" || next === "follow_up") return candidate;
  }
  return null;
}
