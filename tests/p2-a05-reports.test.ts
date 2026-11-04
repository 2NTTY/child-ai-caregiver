import assert from "node:assert/strict";
import test from "node:test";
import { accumulateReportInputs, completeReportSnapshot, newReportAccumulator, reportPeriodKind, reportToday } from "../server/family-document-reports.ts";
import { documentSnapshotValid, type FamilyDocumentSources } from "../server/family-document-sources.ts";
import type { DocumentSource } from "../src/shared/family-documents.ts";
import { firestoreDocumentReportSchema } from "../server/firestore-document-report-schema.ts";

test("complete report counts survive checkpoints and exceed the bounded selected wording", () => {
  const request = { kind: "growth_report" as const, purpose: "family" as const, title: "Synthetic quarter", eventDate: null,
    period: { from: "2026-07-01", to: "2026-09-30" } };
  let state = newReportAccumulator(request, "epoch:1:7");
  assert.equal(firestoreDocumentReportSchema.safeParse(state).success, true);
  state.profile = { childId: "synthetic-child", version: 1, data: null, confirmedBy: null, confirmedAt: null, reason: null };
  const source = (id: string, kind: DocumentSource["kind"], at: string | null): DocumentSource => ({ id, resourceId: id, kind, version: 1, label: "Synthetic source", text: "Saved wording " + id, at });
  const records = Array.from({ length: 105 }, (_, i) => ({ source: source("record:" + i, "record", i < 50
    ? "2026-07-31T15:59:59.999Z" : i < 100 ? "2026-07-31T16:00:00Z" : "2026-08-31T16:00:00Z"), domain: "body_life" as const, recordKind: "feeding" }));
  accumulateReportInputs(state, records.slice(0, 50));
  const legacy = JSON.parse(JSON.stringify(state)); delete legacy.buckets;
  state = JSON.parse(JSON.stringify(state));
  accumulateReportInputs(state, records.slice(50, 100)); accumulateReportInputs(state, records.slice(100));
  state.validUntil = "2030-01-01T00:00:00.000Z";
  accumulateReportInputs(state, [
    { source: source("record:unknown", "record", null), domain: null },
    { source: source("record:outside", "record", "2026-09-30T16:00:00Z"), domain: "body_life", recordKind: "feeding" },
    { source: source("task:1", "task", "2026-06-30T16:00:00Z"), domain: "changes_support" },
    { source: source("concern:1:observation:1", "concern", "2026-09-30T15:59:59Z"), domain: "concerns" },
    { source: source("fact:1", "fact", null), domain: "profile", validUntil: "2030-01-01T00:00:00+08:00" },
  ]);
  state.stage = "done";
  const snapshot = completeReportSnapshot(state, 9, null), coverage = snapshot.reportCoverage!;
  assert.deepEqual(coverage.counts, { recordsInPeriod: 105, recordsUnknownTime: 1, tasksInPeriod: 1, observationsInPeriod: 1, confirmedFacts: 1, recordKinds: { feeding: 105 } });
  assert.equal(coverage.validUntil, "2029-12-31T16:00:00.000Z");
  assert.equal(coverage.scanned, 110); assert.equal(coverage.periodKind, "quarter");
  assert.ok(snapshot.sources.filter(value => value.at !== null).length <= 80);
  assert.ok(snapshot.coverageNote.includes("期間內記錄105筆")); assert.ok(snapshot.coverageNote.includes("選錄數並非統計總數"));
  assert.match(snapshot.coverageNote, /分段保存筆數/);
  assert.match(snapshot.coverageNote, /2026-07-01 至 2026-07-31：照護記錄50筆、待辦1項、關注觀察0項/);
  assert.match(snapshot.coverageNote, /2026-08-01 至 2026-08-31：照護記錄50筆、待辦0項、關注觀察0項/);
  assert.match(snapshot.coverageNote, /2026-09-01 至 2026-09-30：照護記錄5筆、待辦0項、關注觀察1項/);
  assert.match(snapshot.coverageNote, /2026-09-01 至 2026-09-30 與 2026-08-01 至 2026-08-31 相比，已保存的照護記錄少45筆、待辦持平、關注觀察多1項/);
  accumulateReportInputs(legacy, records.slice(50)); legacy.stage = "done";
  const oldCheckpointSnapshot = completeReportSnapshot(legacy, 10, null);
  assert.equal(oldCheckpointSnapshot.reportCoverage!.counts.recordsInPeriod, 105);
  assert.equal(legacy.buckets, undefined); assert.doesNotMatch(oldCheckpointSnapshot.coverageNote, /分段保存筆數|相比/,
    "Old partially processed checkpoints cannot invent trends from their remaining pages");
  const loaded: FamilyDocumentSources = { sourceRevision: "epoch:1:7", profile: state.profile!, entries: [], domains: new Map(), questions: new Set(), activeConcernIds: new Set(), limited: false };
  assert.equal(documentSnapshotValid(snapshot, loaded), true);
  assert.equal(documentSnapshotValid(snapshot, { ...loaded, sourceRevision: "epoch:1:8" }), false);
  assert.equal(documentSnapshotValid({ ...snapshot, reportCoverage: { ...coverage, validUntil: "2020-01-01T00:00:00Z" } }, loaded), false);
  assert.equal(reportPeriodKind({ from: "2026-01-01", to: "2026-12-31" }), "annual");
  assert.equal(reportPeriodKind({ from: "2026-07-01", to: "2026-09-29" }), "range");
  assert.equal(reportPeriodKind({ from: "0099-07-01", to: "0099-09-30" }), "quarter");
  assert.equal(reportPeriodKind({ from: "0000-01-01", to: "0000-12-31" }), "annual");
  const dates = (from: string, to: string) => newReportAccumulator({ ...request, period: { from, to } }, "epoch:1:7").buckets!
    .map(bucket => [bucket.from, bucket.to]);
  assert.deepEqual(dates("0000-01-01", "0000-12-31"), [["0000-01-01", "0000-03-31"], ["0000-04-01", "0000-06-30"],
    ["0000-07-01", "0000-09-30"], ["0000-10-01", "0000-12-31"]]);
  assert.deepEqual(dates("0099-07-01", "0099-09-30"), [["0099-07-01", "0099-07-31"], ["0099-08-01", "0099-08-31"], ["0099-09-01", "0099-09-30"]]);
  assert.deepEqual(dates("2024-02-28", "2024-03-01"), [["2024-02-28", "2024-02-29"], ["2024-03-01", "2024-03-01"]]);
  assert.deepEqual(dates("2026-11-05", "2026-11-05"), [["2026-11-05", "2026-11-05"]]);
  const today = reportToday(), living = newReportAccumulator({ ...request, reportMode: "living", period: { from: today, to: "9999-12-31" } }, "epoch:1:7");
  assert.deepEqual(living.buckets, [{ from: today, to: today, records: 0, tasks: 0, observations: 0 }]);
  const oldEmptyCheckpoint = { ...living }; delete oldEmptyCheckpoint.buckets;
  assert.equal(firestoreDocumentReportSchema.safeParse(oldEmptyCheckpoint).success, true);
  assert.equal(firestoreDocumentReportSchema.safeParse({ ...living, buckets: [{ ...living.buckets![0], records: -1 }] }).success, false);
  assert.equal(firestoreDocumentReportSchema.safeParse({ ...living, buckets: Array(5).fill(living.buckets![0]) }).success, false);
});
