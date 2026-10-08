import { z } from "zod";
import type { AgentHistoryMessage, AgentWork, HistoryMatch, WorkResource } from "../../src/shared/agent-work.ts";
import type { MemoryReadProjection } from "./memory-reference-view-model";

export type HistoryDateRange = { from: string | null; to: string | null };
export interface PersonalHistorySearch {
  query: string; matches: readonly HistoryMatch[]; scanned: number; complete: boolean; nextCursor: string | null;
}
export interface HistoryMessageRead extends Omit<AgentHistoryMessage, "offset"> { offset: 0 }
export interface NotificationHistoryItem {
  id: string; channel: "push" | "telegram" | "web_push" | "mail"; contact: boolean;
  status: "queued" | "sending" | "accepted" | "rejected" | "unknown" | "stopped" | "failed" | "expired";
  createdAt: string | null; attemptedAt: string | null; finishedAt: string | null; acknowledgedAt: string | null; updatedAt: string | null;
}
export interface NotificationHistoryPage {
  items: readonly NotificationHistoryItem[]; scopeVersion: string; nextCursor: string | null; complete: boolean;
}
const time = z.iso.datetime({ offset: true });
const notificationExportSchema = z.object({
  id: z.uuid(), channel: z.enum(["push", "telegram", "web_push", "mail"]),
  request_id: z.uuid().optional(), status: z.enum(["queued", "sending", "accepted", "rejected", "unknown", "stopped"]).optional(),
  state: z.enum(["queued", "sending", "accepted", "failed", "unknown", "expired"]).optional(),
  created_at: time.optional(), attempted_at: time.nullable().optional(), finished_at: time.nullable().optional(),
  acknowledged_at: time.nullable().optional(), updated_at: time.optional(),
}).passthrough().refine(value => value.channel === "mail" ? value.state !== undefined : value.status !== undefined);

/** Project only known metadata. Raw exports, binding IDs, request IDs and reason strings stay outside the view. */
export function notificationHistoryItem(raw: unknown): NotificationHistoryItem {
  const value = notificationExportSchema.parse(raw);
  return { id: value.id, channel: value.channel, contact: value.request_id !== undefined,
    status: (value.channel === "mail" ? value.state : value.status)!,
    createdAt: value.created_at ?? null, attemptedAt: value.attempted_at ?? null,
    finishedAt: value.finished_at ?? null, acknowledgedAt: value.acknowledged_at ?? null, updatedAt: value.updated_at ?? null };
}
export const notificationStatusLabels: Record<NotificationHistoryItem["status"], string> = {
  queued: "排隊中", sending: "投遞中", accepted: "渠道已接受", rejected: "渠道拒絕", unknown: "結果未知",
  stopped: "已停止", failed: "投遞失敗", expired: "已過期",
};
export function notificationChannelLabel(item: NotificationHistoryItem) {
  return item.channel === "mail" ? "帳戶電郵" : (item.contact ? "授權聯絡 · " : "")
    + (item.channel === "telegram" ? "Telegram" : "瀏覽器通知");
}
export function personalHistoryScopeMatches(scopeKey: string, value: { scopeKey: string; childId: string; access: string } | null) {
  return !!scopeKey && value?.scopeKey === scopeKey && !!value.childId && value.access === "active";
}
function hongKongDate(value: string) {
  if (!Number.isFinite(Date.parse(value))) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Hong_Kong", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  return ["year", "month", "day"].map(key => parts.find(part => part.type === key)?.value).join("-");
}
export function personalHistoryDateMatches(value: string | null, range: HistoryDateRange) {
  if (!range.from && !range.to) return true;
  const date = value ? hongKongDate(value) : null;
  return !!date && (!range.from || date >= range.from) && (!range.to || date <= range.to);
}
export function visiblePersonalHistory(read: MemoryReadProjection<PersonalHistorySearch>, range: HistoryDateRange) {
  return read.data?.matches.filter(item => personalHistoryDateMatches(item.createdAt, range)) ?? [];
}
export function visiblePersonalNotifications(items: readonly NotificationHistoryItem[], query: string, range: HistoryDateRange) {
  const search = query.trim().toLocaleLowerCase();
  return items.filter(item => personalHistoryDateMatches(item.createdAt ?? item.attemptedAt, range)
    && (!search || [notificationChannelLabel(item), notificationStatusLabels[item.status]].some(value => value.toLocaleLowerCase().includes(search))));
}
export function appendHistoryMessage(previous: HistoryMessageRead | null, next: AgentHistoryMessage): HistoryMessageRead {
  const offset = previous?.text.length ?? 0;
  if (next.offset !== offset || next.text.length + offset > next.totalCharacters || next.nextOffset !== null && next.text.length === 0
    || (next.nextOffset === null ? next.text.length + offset !== next.totalCharacters : next.nextOffset !== next.text.length + offset || next.nextOffset >= next.totalCharacters)
    || previous && (previous.id !== next.id || previous.childId !== next.childId || previous.role !== next.role
      || previous.createdAt !== next.createdAt || previous.totalCharacters !== next.totalCharacters))
    throw new Error("History message coverage changed");
  return { ...next, text: (previous?.text ?? "") + next.text, offset: 0 };
}
export const personalWorkStatusLabels: Record<AgentWork["status"], string> = {
  active: "進行中", waiting: "等待跟進", completed: "Agent 已結束工作", cancelled: "已取消",
};
export const followUpStatusLabels = { queued: "排隊中", completed: "接續運行已完結", stopped: "接續已停止", unknown: "接續結果未知", cancelled: "接續已取消" };
export function personalWorkQuestion(childName: string, work: AgentWork) {
  return `我想繼續${childName}的工作「${work.goal}」。${work.focus ? "\n目前焦點：" + work.focus : ""}${work.questions.length ? "\n待答問題：\n" + work.questions.join("\n") : ""}\n請先跟我核對目前情況，再決定下一步。`;
}
export function historyMessageQuestion(childName: string, message: HistoryMessageRead) {
  const excerpt = message.text.slice(0, 4000), partial = message.nextOffset !== null || excerpt.length < message.text.length;
  return `我想接續${childName}在${message.createdAt}的${message.role === "user" ? "訊息" : "助手回覆"}：\n${excerpt}\n${!partial ? "" : "以上只是已讀取的部分，請先查閱原訊息再接續。\n"}請先跟我核對目前情況。`;
}
export function workResourceDestination(resource: WorkResource): { label: string; path: string | null } {
  const paths: Record<WorkResource["kind"], { label: string; path: string | null }> = {
    task: { label: "待辦", path: `/tasks?taskId=${encodeURIComponent(resource.id)}` },
    care_record: { label: "照顧記錄", path: `/care?record=${encodeURIComponent(resource.id)}` },
    memory_fact: { label: "記憶", path: "/memory" }, private_note: { label: "私人指示", path: "/settings?section=assistant" },
    private_source: { label: "私人來源", path: "/sources" }, concern: { label: "成長關注", path: "/growth" },
    family_document: { label: "準備單", path: "/summary?tab=preparation" }, receipt: { label: "操作結果", path: "/history?category=review" },
  };
  return paths[resource.kind];
}
