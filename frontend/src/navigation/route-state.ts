import { careKindOptions } from "../care-view-model";
import { calendarDate } from "../components/date-time";
import { historyCategories, historyDateRange, normalizeHistoryCategory, normalizeReviewHistoryStatus } from "../components/history/history-filters";

export type RouteParams = Readonly<Record<string, string | string[] | undefined>>;
function scalar(value: string | string[] | undefined) { return typeof value === "string" ? value : undefined; }
function id(value: string | string[] | undefined) { return scalar(value) || null; }
function choice<T extends string>(value: string | string[] | undefined, options: readonly T[], fallback: T): T { const candidate = scalar(value); return options.find(item => item === candidate) ?? fallback; }
function page(value: string | string[] | undefined) { const candidate = scalar(value); if (!candidate || !/^\d+$/.test(candidate)) return 0; const result = Number(candidate); return Number.isSafeInteger(result) ? result : 0; }
function day(value: string | string[] | undefined) { const candidate = scalar(value); return candidate && calendarDate(candidate) ? candidate : null; }
function month(value: string | string[] | undefined) { const candidate = scalar(value); return candidate && /^\d{4}-\d{2}$/.test(candidate) && calendarDate(`${candidate}-01`) ? candidate : null; }
const optional = (value: string | null) => value || undefined;

export function parseTaskRoute(params: RouteParams) {
  return { tab: choice(params.tab, ["pending", "completed"], "pending"), filter: choice(params.filter, ["near", "earlier", "later", "all", "review", "unconfirmed"], "near"), page: page(params.page), day: day(params.day), month: month(params.month), taskId: id(params.taskId) };
}
export type TaskRouteState = ReturnType<typeof parseTaskRoute>;
export function serializeTaskRoute(state: TaskRouteState) { return { tab: state.tab === "pending" ? undefined : state.tab, filter: state.filter === "near" ? undefined : state.filter, page: state.page ? String(state.page) : undefined, day: optional(state.day), month: optional(state.month), taskId: optional(state.taskId) }; }
export function parseGrowthRoute(params: RouteParams) { return { tab: choice(params.tab, ["concerns", "preparation"], "concerns"), concernId: id(params.concernId), documentId: id(params.documentId) }; }
export function serializeGrowthRoute(state: ReturnType<typeof parseGrowthRoute>) { return { tab: state.tab === "concerns" ? undefined : state.tab, concernId: optional(state.concernId), documentId: optional(state.documentId) }; }
export function parseSettingsRoute(params: RouteParams) { return { section: choice(params.section, ["account", "children", "family", "preferences", "notifications", "model", "assistant", "privacy"], "account") }; }
export function serializeSettingsRoute(state: ReturnType<typeof parseSettingsRoute>) { return { section: state.section === "account" ? undefined : state.section }; }
export function parseSourceRoute(params: RouteParams) { return { sourceId: id(params.sourceId) }; }
export function serializeSourceRoute(state: ReturnType<typeof parseSourceRoute>) { return { sourceId: optional(state.sourceId) }; }
export function parsePhotoRoute(params: RouteParams) { return { tab: choice(params.tab, ["photos", "voices", "files"], "photos"), photoId: id(params.photoId) }; }
export function serializePhotoRoute(state: ReturnType<typeof parsePhotoRoute>) { return { tab: state.tab === "photos" ? undefined : state.tab, photoId: optional(state.photoId) }; }
export function parseMemoryRoute(params: RouteParams) { return { tab: choice(params.tab, ["short", "long", "references"], "long"), factId: id(params.factId) }; }
export function serializeMemoryRoute(state: ReturnType<typeof parseMemoryRoute>) { return { tab: state.tab === "long" ? undefined : state.tab, factId: optional(state.factId) }; }
export function parseHistoryRoute(params: RouteParams) {
  const from = day(params.from) ?? "", to = day(params.to) ?? "";
  const range = (!scalar(params.from) || from) && (!scalar(params.to) || to) && historyDateRange(from, to);
  return { category: normalizeHistoryCategory(scalar(params.category)), status: normalizeReviewHistoryStatus(scalar(params.status)), older: scalar(params.older) === "1", from: range ? from : "", to: range ? to : "", page: page(params.page), profileVersion: id(params.profileVersion), taskId: id(params.taskId), recordId: id(params.recordId), documentId: id(params.documentId), notificationId: id(params.notificationId), messageId: id(params.messageId) };
}
export function serializeHistoryRoute(state: ReturnType<typeof parseHistoryRoute>) { return { category: state.category === historyCategories[0].key ? undefined : state.category, status: state.status === "all" ? undefined : state.status, older: state.older ? "1" : undefined, from: optional(state.from), to: optional(state.to), page: state.page ? String(state.page) : undefined, profileVersion: optional(state.profileVersion), taskId: optional(state.taskId), recordId: optional(state.recordId), documentId: optional(state.documentId), notificationId: optional(state.notificationId), messageId: optional(state.messageId) }; }
export function parseSummaryRoute(params: RouteParams) { return { tab: choice(params.tab, ["overview", "archive", "preparation", "legacy-preparation"], "overview"), periodId: id(params.periodId), archiveFilter: choice(params.archiveFilter, ["all", "year", "quarter", "range"], "all") }; }
export function serializeSummaryRoute(state: ReturnType<typeof parseSummaryRoute>) { return { tab: state.tab === "overview" ? undefined : state.tab, periodId: optional(state.periodId), archiveFilter: state.archiveFilter === "all" ? undefined : state.archiveFilter }; }

export function parseCareRoute(params: RouteParams) { const recordId = id(params.recordId) ?? id(params.record); const compose = careKindOptions.find(item => item.value === scalar(params.compose))?.value ?? null; return { tab: recordId ? "recorded" as const : choice(params.tab, ["pending", "recorded"], "pending"), recordId, compose }; }
export function serializeCareRoute(state: ReturnType<typeof parseCareRoute>) { return { tab: state.tab === "pending" ? undefined : state.tab, recordId: optional(state.recordId), record: undefined, compose: state.compose ?? undefined }; }
