import type { GrowthArchiveEntry, GrowthArchivePeriod, GrowthArchiveProjection, GrowthArchiveSnapshot, GrowthReportDomain, GrowthViewModel } from "../../growth-view-model";

// Reading-only references into the authorized projection, never a second archive store.
export type ArchiveReadingItem = { key: string; period: GrowthArchivePeriod | null; snapshot: GrowthArchiveSnapshot };
export type ArchiveFilter = "all" | "year" | "quarter" | "range";

export function archiveReadingView(model: GrowthViewModel) {
  const provided = model.page?.archive;
  const authorized = !!provided && provided.scopeKey === model.scopeKey && provided.childId === model.childId
    && provided.authorityVersion === model.page?.authorityVersion && model.access !== "lost";
  const state: GrowthArchiveProjection["state"] = model.access === "lost" || provided && !authorized ? "invalidated"
    : provided?.state ?? (model.load === "loading" ? "loading" : model.load === "error" ? "error" : "unavailable");
  const readable = authorized && !["invalidated", "unavailable", "not_generated"].includes(state);
  const snapshots = readable && provided ? [...(provided.snapshot ? [provided.snapshot] : []), ...(provided.history ?? [])] : [];
  const items: ArchiveReadingItem[] = provided?.periods !== undefined
    ? provided.periods.flatMap(period => {
      const snapshot = snapshots.find(item => item.id === period.snapshotId && item.version === period.snapshotVersion);
      return snapshot ? [{ key: period.id, period, snapshot }] : [];
    })
    : snapshots.slice(0, 1).map(snapshot => ({ key: snapshot.id, period: null, snapshot }));
  const current = items.find(item => item.period?.currentAnnual)
    ?? items.find(item => item.snapshot === provided?.snapshot) ?? items[0] ?? null;
  return { authorized, state, items, current };
}

export function archiveReadableSource(model: GrowthViewModel, archive: GrowthArchiveSnapshot, sourceId: string) {
  const current = archiveReadingView(model).items.find(item => item.snapshot.id === archive.id && item.snapshot.version === archive.version)?.snapshot;
  const source = current?.sources.find(item => item.id === sourceId);
  if (!source || source.state !== "available") return undefined;
  if (source.kind === "attention" && !model.page?.items.some(item => item.id === source.attentionId && item.version === source.version
    && item.childId === model.childId && item.sourceAvailable)) return undefined;
  return source;
}

export function archiveEntryReadable(model: GrowthViewModel, archive: GrowthArchiveSnapshot, entry: GrowthArchiveEntry) {
  return entry.sourceIds.length > 0 && entry.sourceIds.every(id => !!archiveReadableSource(model, archive, id));
}

export function filterArchiveItems(items: ArchiveReadingItem[], filter: ArchiveFilter) {
  return items.filter(item => filter === "all" || item.period?.kind === filter);
}

export const standardReportDomains = [
  {id: "profile", title: "孩子概況"},
  {id: "body_life", title: "身體與生活"},
  {id: "abilities_interests", title: "能力與興趣"},
  {id: "concerns", title: "持續關注"},
  {id: "changes_support", title: "近期變化與支持"},
  {id: "recorded", title: "已記錄的情況"},
] as const;
export type StandardReportDomain = GrowthReportDomain | "recorded";
export type StandardReportSection = {id: StandardReportDomain; title: string; entries: GrowthArchiveEntry[]};

// Classification is supplied by the authorized report adapter, never guessed from words or IDs.
// Older unclassified entries remain visible in a neutral fallback section.
export function standardGrowthReportSections(model: GrowthViewModel, archive: GrowthArchiveSnapshot): StandardReportSection[] {
  const current = archiveReadingView(model).items.find(item => item.snapshot.id === archive.id && item.snapshot.version === archive.version)?.snapshot;
  if (!current) return [];
  const entries = current.sections.flatMap(section => section.entries);
  return standardReportDomains.flatMap(domain => {
    const included = entries.filter(entry => {
      const classified = entry.reportDomain;
      const validDomain = standardReportDomains.some(item => item.id === classified) ? classified : "recorded";
      return validDomain === domain.id;
    });
    return domain.id === "profile" || included.length ? [{...domain, entries: included}] : [];
  });
}

export const growthReportPurposes = [
  { id: "family", label: "家庭成長版", detail: "回看成長脈絡、生活片段與值得記住的變化" },
  { id: "appointment", label: "就診溝通版", detail: "整理關注經過、相關記錄與想討論的問題" },
  { id: "care_handoff", label: "照護交接版", detail: "整理日常習慣、有效支持與需要留意的事" },
  { id: "school", label: "入園認識版", detail: "整理表達、自理、相處與興趣的具體觀察" },
] as const;
export type GrowthReportPurpose = typeof growthReportPurposes[number]["id"];
// UI intent only. A real adapter must validate access and provide generation/download state.
export type GrowthReportExportRequest = {
  scopeKey: string; childId: string; authorityVersion: string;
  snapshotId: string; snapshotVersion: number; periodId: string | null;
  purpose: GrowthReportPurpose; includeSources: boolean; includeRevision: boolean;
};
export type GrowthReportExportResult = { state: "ready" | "error"; message: string };
// The reader owns this intent's lifetime; the adapter checks it before delivery.
export type GrowthReportExportHandler = (request: GrowthReportExportRequest, isCurrent: () => boolean) => Promise<GrowthReportExportResult | undefined> | void;
export function growthReportExportRequest(model: GrowthViewModel, item: ArchiveReadingItem, purpose: GrowthReportPurpose,
  includeSources: boolean, includeRevision: boolean): GrowthReportExportRequest | null {
  const current = archiveReadingView(model).items.find(value => value.key === item.key && value.snapshot.id === item.snapshot.id && value.snapshot.version === item.snapshot.version);
  if (!current || !model.page || !growthReportPurposes.some(value => value.id === purpose)) return null;
  return { scopeKey: model.scopeKey, childId: model.childId, authorityVersion: model.page.authorityVersion,
    snapshotId: current.snapshot.id, snapshotVersion: current.snapshot.version, periodId: current.period?.id ?? null,
    purpose, includeSources, includeRevision };
}
