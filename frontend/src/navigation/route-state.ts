/** Allowlisted presentation state. Never serialize queries, drafts, original content or credentials. */
export type RouteParams = Readonly<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) => Array.isArray(value) ? undefined : value;
const id = (value: string | string[] | undefined) => first(value) || null;
const choice = <T extends string>(value: string | string[] | undefined, values: readonly T[], fallback: T): T => values.find(item => item === first(value)) ?? fallback;
const page = (value: string | string[] | undefined) => { const raw = first(value); const result = raw && /^\d+$/.test(raw) ? Number(raw) : 0; return Number.isSafeInteger(result) ? result : 0; };
function date(value: string | string[] | undefined) {
  const raw = first(value); if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const time = Date.parse(`${raw}T00:00:00Z`); return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === raw ? raw : null;
}
const month = (value: string | string[] | undefined) => { const raw = first(value); return raw && date(`${raw}-01`) ? raw : null; };
const present = (values: Record<string, string | number | null | undefined>) => Object.fromEntries(Object.entries(values).filter(([, value]) => value !== null && value !== undefined).map(([key, value]) => [key, String(value)]));

export function parseTaskRoute(params: RouteParams) {
  return { taskId: id(params.taskId), tab: choice(params.tab, ["pending", "completed"], "pending"),
    filter: choice(params.filter, ["near", "earlier", "later", "all", "review", "unconfirmed"], "near"), page: page(params.page), day: date(params.day), month: month(params.month) };
}
export type TaskRouteState = ReturnType<typeof parseTaskRoute>;
export const serializeTaskRoute = (state: TaskRouteState) => present({ taskId: state.taskId, tab: state.tab, filter: state.filter, page: state.page, day: state.day, month: state.month });
export function parseGrowthRoute(params: RouteParams) { return { tab: choice(params.tab, ["concerns", "preparation"], "concerns"), concernId: id(params.concernId), documentId: id(params.documentId) }; }
export type GrowthRouteState = ReturnType<typeof parseGrowthRoute>;
export const serializeGrowthRoute = (state: GrowthRouteState) => present({ tab: state.tab, concernId: state.concernId, documentId: state.documentId });
export function parseSourceRoute(params: RouteParams) { return { sourceId: id(params.sourceId) }; }
export const serializeSourceRoute = (state: ReturnType<typeof parseSourceRoute>) => present({ sourceId: state.sourceId });
export function parseMemoryRoute(params: RouteParams) { return { tab: choice(params.tab, ["short", "long", "references"], "long"), factId: id(params.factId), topicId: id(params.topicId) }; }
export type MemoryRouteState = ReturnType<typeof parseMemoryRoute>;
export const serializeMemoryRoute = (state: MemoryRouteState) => present({ tab: state.tab, factId: state.factId, topicId: state.topicId });
export function parsePhotoRoute(params: RouteParams) { return { tab: choice(params.tab, ["photos", "voices", "files"], "photos"), photoId: id(params.photoId) }; }
export type PhotoRouteState = ReturnType<typeof parsePhotoRoute>;
export const serializePhotoRoute = (state: PhotoRouteState) => present({ tab: state.tab, photoId: state.photoId });
export function parseSettingsRoute(params: RouteParams) { return { section: choice(params.section, ["account", "children", "family", "preferences", "notifications", "assistant", "model", "privacy"], "account") }; }
export type SettingsRouteState = ReturnType<typeof parseSettingsRoute>;
export const serializeSettingsRoute = (state: SettingsRouteState) => ({ section: state.section });
export function parseHistoryRoute(params: RouteParams) {
  const from = date(params.from), to = date(params.to), validRange = !from || !to || from <= to;
  return { category: choice(params.category, ["tasks", "preparations", "review", "care", "profile", "conversations", "growth", "notifications"], "tasks"),
    status: choice(params.status, ["all", "important_pending", "pending", "written", "confirmed", "skipped"], "all"), older: first(params.older) === "1",
    from: validRange ? from : null, to: validRange ? to : null, page: page(params.page), selectedId: id(params.selectedId) };
}
export type HistoryRouteState = ReturnType<typeof parseHistoryRoute>;
export const serializeHistoryRoute = (state: HistoryRouteState) => present({ category: state.category, status: state.status, older: state.older ? "1" : null, from: state.from, to: state.to, page: state.page, selectedId: state.selectedId });
export function parseSummaryRoute(params: RouteParams) {
  const version = page(params.snapshotVersion);
  return { tab: choice(params.tab, ["overview", "archive", "preparation", "legacy-preparation"], "overview"),
    periodId: id(params.periodId), documentId: id(params.documentId), snapshotId: id(params.snapshotId), snapshotVersion: version > 0 ? version : null };
}
export type SummaryRouteState = ReturnType<typeof parseSummaryRoute>;
export type SummarySelection = Omit<SummaryRouteState, "tab">;
export const serializeSummaryRoute = (state: SummaryRouteState) => present({ tab: state.tab, periodId: state.periodId, documentId: state.documentId, snapshotId: state.snapshotId, snapshotVersion: state.snapshotVersion });
export function parseCareRoute(params: RouteParams) {
  const recordId = id(params.recordId) ?? id(params.record);
  // An explicitly supplied canonical key wins, including an invalid/array value.
  // A legacy record-only URL opens that exact record, never the review chapter.
  const tab = params.tab !== undefined ? choice(params.tab, ["review", "records", "photos"], "review")
    : params.view !== undefined ? choice(params.view, ["review", "records", "photos"], "review") : recordId ? "records" : "review";
  return { tab, recordId };
}
export type CareRouteState = ReturnType<typeof parseCareRoute>;
export const serializeCareRoute = (state: ReturnType<typeof parseCareRoute>) => present({ tab: state.tab, recordId: state.recordId });
