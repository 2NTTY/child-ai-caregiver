import type { GrowthConcern, GrowthConcernEvent, GrowthViewModel } from "./growth-view-model";
import type { SummaryRecord, SummaryViewModel } from "./summary-view-model";

export type OverviewReadState = "loading" | "ready" | "stale" | "error" | "unavailable" | "lost";
export type OverviewConcernItem = { concern: GrowthConcern; observation: GrowthConcernEvent | null };
export type OverviewConcerns = { state: OverviewReadState; items: OverviewConcernItem[]; pending: boolean };
export type OverviewRecords = { state: OverviewReadState; records: SummaryRecord[]; periodLabel: string | null; omitted: boolean; pending: boolean };

// These are read-only references to the existing owners, not another store or fetch.
export function overviewConcerns(model: GrowthViewModel | null, scopeKey: string, childId: string, now: number): OverviewConcerns {
  const empty = (state: OverviewReadState): OverviewConcerns => ({ state, items: [], pending: !!model?.pending && model.access !== "lost" && model.scopeKey === scopeKey && model.childId === childId });
  if (!model) return empty("loading");
  if (model.access === "lost") return empty("lost");
  if (!scopeKey || model.scopeKey !== scopeKey || model.childId !== childId) return empty("unavailable");
  if (!model.page) return empty(model.load === "error" ? "error" : "loading");
  const source = model.page.concerns;
  if (!source || source.state !== "ready") return empty(source?.state === "error" ? "error" : source?.state === "loading" ? "loading" : "unavailable");
  const items = source.items.filter(item => item.childId === childId && item.status === "following" && !item.archivedAt).map(concern => {
    const observation = concern.events.filter(event => event.kind === "observation" && Number.isFinite(Date.parse(event.at)) && Date.parse(event.at) <= now)
      .slice().sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id))[0] ?? null;
    return { concern, observation };
  }).sort((a, b) => (b.observation ? Date.parse(b.observation.at) : -Infinity) - (a.observation ? Date.parse(a.observation.at) : -Infinity)
    || a.concern.id.localeCompare(b.concern.id)).slice(0, 2);
  return { state: !model.online || model.load === "error" || model.refreshPending ? "stale" : "ready", items, pending: !!model.pending };
}

export function overviewRecordTime(record: SummaryRecord, timeZone: string): { day: string; time: string; full: string } {
  const date = new Date(record.eventTime.at!);
  const day = new Intl.DateTimeFormat("zh-HK", { timeZone, month: "2-digit", day: "2-digit" }).format(date);
  const time = new Intl.DateTimeFormat("zh-HK", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  const full = new Intl.DateTimeFormat("zh-HK", { timeZone, year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
  const approximate = record.eventTime.precision === "approximate" ? "約 " : "";
  return { day: `${approximate}${day}`, time, full: `${approximate}${full}` };
}

export function overviewRecords(model: SummaryViewModel | null, scopeKey: string, childId: string, now: number): OverviewRecords {
  const empty = (state: OverviewReadState): OverviewRecords => ({ state, records: [], periodLabel: null, omitted: false, pending: false });
  if (!model) return empty("loading");
  if (model.access === "lost") return empty("lost");
  if (!scopeKey || model.scopeKey !== scopeKey) return empty("unavailable");
  const page = model.page;
  if (!page) return empty(model.readFailed ? "error" : "loading");
  if (page.childId !== childId) return empty("unavailable");
  const start = new Date(`${page.period.startDay}T00:00:00Z`), end = new Date(`${page.endDayExclusive}T00:00:00Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return empty("unavailable");
  let formatter: Intl.DateTimeFormat;
  try { formatter = new Intl.DateTimeFormat("en-CA", { timeZone: page.period.timeZone, calendar: "gregory", numberingSystem: "latn", year: "numeric", month: "2-digit", day: "2-digit" }); }
  catch { return empty("unavailable"); }
  const readable = page.records.filter(record => {
    const at = record.eventTime.at ? Date.parse(record.eventTime.at) : NaN;
    if (record.eventTime.precision === "unknown" || !Number.isFinite(at) || at > now) return false;
    const parts = formatter.formatToParts(new Date(at));
    const part = (type: string) => parts.find(item => item.type === type)?.value ?? "";
    const day = `${part("year")}-${part("month")}-${part("day")}`;
    return day >= page.period.startDay && day < page.endDayExclusive;
  }).slice().sort((a, b) => Date.parse(b.eventTime.at!) - Date.parse(a.eventTime.at!) || a.id.localeCompare(b.id));
  const last = new Date(end.getTime() - 86400000).toISOString().slice(0, 10);
  return { state: !model.online || model.readFailed ? "stale" : "ready", records: readable.slice(0, 3),
    periodLabel: page.period.startDay === last ? page.period.startDay : `${page.period.startDay} – ${last}`,
    omitted: readable.length !== page.records.length, pending: !!model.pending };
}
