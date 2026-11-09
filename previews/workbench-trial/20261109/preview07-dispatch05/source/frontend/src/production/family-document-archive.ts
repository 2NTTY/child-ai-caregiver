import type { DocumentPage, DocumentSnapshot, FamilyDocument } from "../../../src/shared/family-documents";
import type { GrowthArchiveProjection, GrowthArchiveSnapshot } from "../growth-view-model";

const snapshotKey = (snapshot: DocumentSnapshot) => snapshot.id + ":" + snapshot.version;
const reportSnapshot = (snapshot: DocumentSnapshot): GrowthArchiveSnapshot => ({
  id: snapshot.id, version: snapshot.version, title: snapshot.title, ageLabel: snapshot.ageLabel,
  periodLabel: snapshot.period.from + " 至 " + snapshot.period.to, generatedAt: snapshot.generatedAt,
  sourceBasisVersion: snapshot.sourceBasis, coverageNote: snapshot.coverageNote,
  revisionChanges: snapshot.changes.map((text, index) => ({ id: snapshot.id + ":change:" + index, text, sourceIds: snapshot.sources.map(source => source.id) })),
  sections: [{ id: "overview", title: "共享來源整理", entries: snapshot.sections.flatMap(section => section.items.map(item => ({
    id: section.id + ":" + item.id, title: section.title, text: item.text, status: "source_summary" as const,
    sourceIds: item.sourceIds, ...(section.domain ? { reportDomain: section.domain } : {}) }))) }],
  sources: snapshot.sources.map(source => ({ id: source.id, label: source.label, version: source.version, state: "available",
    kind: source.kind, ...(source.kind === "record" ? { recordId: source.resourceId } : {}), excerpt: source.text,
    timeLabel: source.at ?? "事件時間未提供" })),
});

/** Project authoritative document reads without generating or retaining another report store. */
export function projectFamilyDocumentArchive(input: {
  page: DocumentPage | null; load: "loading" | "ready" | "error"; lost: boolean; scopeKey: string; childId: string;
}): { standard: FamilyDocument | null; reportDocumentIds: string[]; archive: Omit<GrowthArchiveProjection, "reading"> } {
  const { page, load, lost, scopeKey, childId } = input;
  const visible = lost ? null : page;
  const reports = visible?.items.filter(item => item.kind === "growth_report") ?? [];
  const standard = reports.find(item => item.purpose === "family" && item.status === "active" && item.report?.mode === "living")
    ?? reports.find(item => item.purpose === "family" && item.status === "active") ?? null;
  const readableReports = reports.filter(item => item.readState !== "invalidated");
  const snapshots = Array.from(new Map(readableReports.flatMap(item => [...(item.current ? [item.current] : []), ...item.history]).map(snapshot => [snapshotKey(snapshot), snapshot])).values());
  const projectedSnapshots = snapshots.map(reportSnapshot), currentSnapshot = standard?.readState !== "invalidated" && standard?.current ? reportSnapshot(standard.current) : null;
  const archive: Omit<GrowthArchiveProjection, "reading"> = { scopeKey, childId, authorityVersion: visible?.authorityVersion ?? "",
    state: lost ? "invalidated" : !visible ? load === "error" ? "error" : "loading" : standard?.report?.phase === "building" ? "generating" : standard?.readState === "invalidated" && !projectedSnapshots.length ? "invalidated"
      : standard?.readState === "stale" ? "needs_update" : currentSnapshot || projectedSnapshots.length ? "ready" : "not_generated",
    label: "Server 依家庭共享來源整理，並非模型生成或發展評估。", snapshot: currentSnapshot,
    history: projectedSnapshots.filter(snapshot => snapshot.id !== currentSnapshot?.id || snapshot.version !== currentSnapshot.version),
    periods: snapshots.map(snapshot => ({ id: snapshotKey(snapshot), kind: snapshot.reportCoverage?.periodKind === "annual" ? "year" : snapshot.reportCoverage?.periodKind === "quarter" ? "quarter" : "range",
      year: Number(snapshot.period.from.slice(0, 4)), ...(snapshot.reportCoverage?.periodKind === "quarter" ? { quarter: (Math.floor((Number(snapshot.period.from.slice(5, 7)) - 1) / 3) + 1) as 1 | 2 | 3 | 4 } : {}),
      from: snapshot.period.from, to: snapshot.period.to, label: snapshot.title + " · " + snapshot.period.from + " 至 " + snapshot.period.to,
      snapshotId: snapshot.id, snapshotVersion: snapshot.version, currentAnnual: snapshot.reportCoverage?.mode === "living" && standard?.current?.id === snapshot.id,
      coverage: snapshot.reportCoverage?.status === "complete" ? "complete" : "partial", coverageLabel: snapshot.coverageNote })) };
  return { standard, reportDocumentIds: reports.map(item => item.id), archive };
}
