import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { CareCursor } from "../src/shared/care.ts";
import type { DocumentRequest, DocumentSource, DocumentSnapshot, DocumentSection, ReportCoverage } from "../src/shared/family-documents.ts";
import type { StorageCipher } from "./storage-crypto.ts";
import { createCareStore } from "./care.ts";
import { createMemoryStore } from "./memory.ts";
import { createTaskStore } from "./tasks.ts";
import { createConcernStore } from "./concern-store.ts";
import { transactionPool } from "./transaction-pool.ts";
import { FamilyError } from "./family-access.ts";
import { profileIsApplicable } from "./memory-policy.ts";
import { buildFamilyDocumentSnapshot, concernDocumentSource, factDocumentSource, hkDay, labels, profileText,
  recordDocumentSource, taskDocumentSource, type FamilyDocumentSources } from "./family-document-sources.ts";

export interface ReportAccumulator {
  request: DocumentRequest; sourceRevision: string; stage: "profile" | "records" | "facts" | "tasks" | "concerns" | "done";
  processedSources: number; counts: ReportCoverage["counts"]; validUntil: string | null;
  careCursor?: CareCursor; factAfterId?: string; taskAfterId?: string; concernAfter?: { id: string; sequence: number };
  profile: FamilyDocumentSources["profile"] | null; selected: ReportInput[]; blocked?: boolean;
}
export interface ReportInput { source: DocumentSource; domain: DocumentSection["domain"]; recordKind?: string; validUntil?: string | null; activeConcern?: boolean }
export const reportToday = () => hkDay(new Date().toISOString());
export function reportPeriodKind(period: DocumentRequest["period"]): ReportCoverage["periodKind"] {
  const [year, month, date] = period.from.split("-").map(Number);
  if (month === 1 && date === 1 && period.to === `${year}-12-31`) return "annual";
  if (date === 1 && [1, 4, 7, 10].includes(month)) {
    const end = new Date(Date.UTC(year, month + 2, 0)).toISOString().slice(0, 10);
    if (end === period.to) return "quarter";
  }
  return "range";
}
export function effectiveReportRequest(request: DocumentRequest): DocumentRequest {
  const effective = structuredClone(request);
  if (request.reportMode === "living") {
    if (request.period.from > reportToday()) throw new FamilyError(400, "invalid_input");
    effective.period.to = reportToday();
  }
  return effective;
}
export function newReportAccumulator(request: DocumentRequest, sourceRevision: string): ReportAccumulator {
  return { request: effectiveReportRequest(request), sourceRevision, stage: "profile", processedSources: 0, profile: null, selected: [], validUntil: null,
    counts: { recordsInPeriod: 0, recordsUnknownTime: 0, tasksInPeriod: 0, observationsInPeriod: 0, confirmedFacts: 0, recordKinds: {} } };
}
/** Counts cover every scanned page; only the selected wording remains in the encrypted accumulator. */
export function accumulateReportInputs(state: ReportAccumulator, inputs: ReportInput[], scanned = inputs.length): void {
  state.processedSources += scanned;
  for (const input of inputs) {
    const { source } = input, inPeriod = source.at !== null && hkDay(source.at) >= state.request.period.from && hkDay(source.at) <= state.request.period.to;
    if (input.validUntil && (state.validUntil === null || Date.parse(input.validUntil) < Date.parse(state.validUntil)))
      state.validUntil = new Date(input.validUntil).toISOString();
    if (source.kind === "record") {
      if (source.at === null) state.counts.recordsUnknownTime++;
      else if (inPeriod) { state.counts.recordsInPeriod++; const kind = input.recordKind ?? "note"; state.counts.recordKinds[kind] = (state.counts.recordKinds[kind] ?? 0) + 1; }
    } else if (source.kind === "task" && inPeriod) state.counts.tasksInPeriod++;
    else if (source.kind === "concern" && source.at !== null && inPeriod) state.counts.observationsInPeriod++;
    else if (source.kind === "fact") state.counts.confirmedFacts++;
    if (inPeriod || source.at === null && (source.kind !== "concern" || input.activeConcern)) state.selected.push(input);
  }
  const dated = state.selected.filter(input => input.source.at !== null).sort((a, b) => Date.parse(b.source.at!) - Date.parse(a.source.at!) || a.source.id.localeCompare(b.source.id)).slice(0, 80);
  const timeless = state.selected.filter(input => input.source.at === null && input.source.kind !== "record").sort((a, b) => a.source.id.localeCompare(b.source.id)).slice(0, 40);
  const unknown = state.selected.filter(input => input.source.at === null && input.source.kind === "record").slice(0, 20);
  // Leave room for duplicated source/item wording and protected parent edits in the existing document capacity.
  let characters = 0;
  state.selected = [...timeless, ...dated, ...unknown].filter(input => { const size = JSON.stringify(input).length; if (characters + size > 60000) return false; characters += size; return true; });
}
/** One source page per short authorized transaction. There is no network or model work. */
export async function advanceReportBatch(client: PoolClient, cipher: StorageCipher, userId: string, childId: string, state: ReportAccumulator): Promise<void> {
  const borrowed = transactionPool(client);
  if (state.stage === "profile") {
    const profile = await createCareStore(borrowed.pool, cipher).profile(userId, childId); borrowed.assertReleased();
    if (!profile) throw new FamilyError(404, "not_found");
    state.profile = { ...profile, data: profileIsApplicable(profile.data) ? profile.data : null };
    const expiry = state.profile.data?.validUntil ? new Date(Date.parse(state.profile.data.validUntil + "T16:00:00Z")).toISOString() : null;
    accumulateReportInputs(state, [{ source: { id: "profile:" + childId, resourceId: childId, kind: "profile", version: profile.version,
      label: "已確認孩子資料", text: profileText(state.profile), at: null }, domain: "profile", validUntil: expiry }]);
    state.stage = "records";
  } else if (state.stage === "records") {
    const page = await createCareStore(borrowed.pool, cipher).search(userId, childId, { cursor: state.careCursor }); borrowed.assertReleased();
    if (!page) throw new FamilyError(404, "not_found");
    accumulateReportInputs(state, page.records.map(record => ({ source: recordDocumentSource(record), recordKind: record.details.kind,
      domain: ["feeding", "sleep", "diaper", "temperature", "measurement"].includes(record.details.kind) ? "body_life" : "changes_support" })), page.scanned);
    if (page.nextCursor) state.careCursor = page.nextCursor; else state.stage = "facts";
  } else if (state.stage === "facts") {
    const page = await createMemoryStore(borrowed.pool, cipher).reportFacts(userId, childId, state.factAfterId); borrowed.assertReleased();
    if (!page) throw new FamilyError(404, "not_found");
    accumulateReportInputs(state, page.items.filter(fact => fact.visibility === "family" && fact.status === "confirmed" && fact.applicable && fact.sourceState === "current")
      .map(fact => ({ source: factDocumentSource(fact), domain: "profile", validUntil: fact.validUntil })), page.items.length);
    if (page.nextAfterId) state.factAfterId = page.nextAfterId; else state.stage = "tasks";
  } else if (state.stage === "tasks") {
    const page = await createTaskStore(borrowed.pool, cipher).list(userId, childId, state.taskAfterId); borrowed.assertReleased();
    if (!page) throw new FamilyError(404, "not_found");
    accumulateReportInputs(state, page.items.map(task => ({ source: taskDocumentSource(task), domain: "changes_support" })), page.items.length);
    if (page.nextAfterId) state.taskAfterId = page.nextAfterId; else state.stage = "concerns";
  } else if (state.stage === "concerns") {
    const page = await createConcernStore(borrowed.pool, cipher).reportPage(userId, childId, state.concernAfter); borrowed.assertReleased();
    if (!page) throw new FamilyError(404, "not_found");
    const inputs: ReportInput[] = [];
    for (const { concern, event } of page.items) {
      if (event?.kind === "observation") inputs.push({ source: concernDocumentSource(concern, event), domain: "concerns" });
      else if (!event && concern.status === "following") inputs.push({ source: concernDocumentSource(concern), domain: "concerns", activeConcern: true });
    }
    accumulateReportInputs(state, inputs, page.items.length);
    if (page.next) state.concernAfter = page.next; else state.stage = "done";
  }
}
export function completeReportSnapshot(state: ReportAccumulator, version: number, previous: DocumentSnapshot | null, referenceSources?: FamilyDocumentSources): DocumentSnapshot {
  if (state.stage !== "done" || !state.profile) throw new FamilyError(409, "report_incomplete");
  const loaded: FamilyDocumentSources = { profile: state.profile, sourceRevision: state.sourceRevision, limited: false,
    entries: state.selected.map(input => input.source), domains: new Map(state.selected.map(input => [input.source.id, input.domain])), questions: new Set(),
    activeConcernIds: new Set(state.selected.filter(input => input.activeConcern).map(input => input.source.id)),
    referencedSources: referenceSources?.referencedSources };
  // The full current prefix is relevant only to explicit protected edits, never to report counts.
  for (const source of referenceSources?.entries ?? []) if (!loaded.entries.some(item => item.id === source.id)) {
    loaded.referencedSources ??= new Map(); loaded.referencedSources.set(source.id, source);
  }
  const snapshot = buildFamilyDocumentSnapshot(loaded, state.request, version, previous), counts = state.counts;
  snapshot.reportCoverage = { status: "complete", mode: state.request.reportMode ?? "fixed", periodKind: reportPeriodKind(state.request.period),
    sourceRevision: state.sourceRevision, completedAt: snapshot.generatedAt, validUntil: state.validUntil, scanned: state.processedSources, counts: structuredClone(counts) };
  snapshot.sourceBasis = createHash("sha256").update(JSON.stringify({ request: state.request, coverage: snapshot.reportCoverage })).digest("hex");
  if (!previous?.editProtection?.metadataFields.includes("summary")) snapshot.summary = "已逐頁整理目前已保存的家庭共享資料；統計只計保存筆數，不推斷診斷、能力、發展評分或實際事件總量。";
  const kinds = Object.entries(counts.recordKinds).map(([kind, count]) => `${labels[kind as keyof typeof labels] ?? kind}${count}筆`).join("、") || "沒有已保存的期間記錄";
  snapshot.coverageNote = `完整掃描目前已保存的共享來源${state.processedSources}項。期間內記錄${counts.recordsInPeriod}筆（${kinds}）；未知發生時間${counts.recordsUnknownTime}筆另列、不計入期間；照護任務${counts.tasksInPeriod}項；共享關注觀察${counts.observationsInPeriod}項；目前有效確認事實${counts.confirmedFacts}項。這是已保存資料的筆數，並不代表生活中全部發生過的事；無記錄不等於未發生。日期採香港事件日期，約數保留原精度。正文最多選錄80項期間來源、40項無事件日期資料及20項未知日期記錄，長正文亦受容量限制；選錄數並非統計總數。`;
  return snapshot;
}
