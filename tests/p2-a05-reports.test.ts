import assert from "node:assert/strict";
import test from "node:test";
import { accumulateReportInputs, completeReportSnapshot, newReportAccumulator, reportPeriodKind } from "../server/family-document-reports.ts";
import { documentSnapshotValid, type FamilyDocumentSources } from "../server/family-document-sources.ts";
import type { DocumentSource } from "../src/shared/family-documents.ts";

test("complete report counts survive checkpoints and exceed the bounded selected wording", () => {
  const request = { kind: "growth_report" as const, purpose: "family" as const, title: "Synthetic quarter", eventDate: null,
    period: { from: "2026-07-01", to: "2026-09-30" } };
  let state = newReportAccumulator(request, "epoch:1:7");
  state.profile = { childId: "synthetic-child", version: 1, data: null, confirmedBy: null, confirmedAt: null, reason: null };
  const source = (id: string, kind: DocumentSource["kind"], at: string | null): DocumentSource => ({ id, resourceId: id, kind, version: 1, label: "Synthetic source", text: "Saved wording " + id, at });
  const records = Array.from({ length: 105 }, (_, i) => ({ source: source("record:" + i, "record", "2026-07-01T01:00:00Z"), domain: "body_life" as const, recordKind: "feeding" }));
  accumulateReportInputs(state, records.slice(0, 50));
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
  const loaded: FamilyDocumentSources = { sourceRevision: "epoch:1:7", profile: state.profile!, entries: [], domains: new Map(), questions: new Set(), activeConcernIds: new Set(), limited: false };
  assert.equal(documentSnapshotValid(snapshot, loaded), true);
  assert.equal(documentSnapshotValid(snapshot, { ...loaded, sourceRevision: "epoch:1:8" }), false);
  assert.equal(documentSnapshotValid({ ...snapshot, reportCoverage: { ...coverage, validUntil: "2020-01-01T00:00:00Z" } }, loaded), false);
  assert.equal(reportPeriodKind({ from: "2026-01-01", to: "2026-12-31" }), "annual");
  assert.equal(reportPeriodKind({ from: "2026-07-01", to: "2026-09-29" }), "range");
});
