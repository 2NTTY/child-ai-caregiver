import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createFamilyDocumentsApi } from "../src/client/family-documents-api.ts";
import { handleFamilyDocumentRequest } from "../server/family-document-api.ts";
import type { FamilyDocumentStore } from "../server/family-document-store.ts";
import type { FamilyDocument, DocumentRequest } from "../src/shared/family-documents.ts";

test("report creation and completed coverage cross the real route and strict client", async () => {
  const childId = randomUUID(), id = randomUUID(), userId = "synthetic-a05-client";
  const period = { from: "2025-01-01", to: "2025-12-31" }, at = "2026-10-08T00:00:00Z";
  let calls = 0;
  let item: FamilyDocument = { id, childId, kind: "growth_report", purpose: "family", version: 1,
    status: "active", archivedAt: null, current: null, history: [], readState: "invalidated", autoRefresh: true,
    report: { mode: "fixed", phase: "building", processedSources: 50, sourceRevision: "11111111-1111-4111-a111-111111111111:1:0", periodKind: "annual", period, title: "年度整理" } };
  const request: DocumentRequest = { kind: "growth_report", purpose: "family", title: "年度整理", period, eventDate: null, reportMode: "fixed" };
  const store = { async create(actor: string, child: string, value: DocumentRequest, opId: string) {
    assert.equal(actor, userId); assert.equal(child, childId); assert.deepEqual(value, request); assert.match(opId, /^[a-f0-9-]{36}$/u);
    calls++; return item;
  }, async get(actor: string, child: string, document: string) {
    assert.deepEqual([actor, child, document], [userId, childId, id]); calls++; return item;
  } } as unknown as FamilyDocumentStore;
  const api = createFamilyDocumentsApi("http://127.0.0.1:3099", (async (url, init) =>
    handleFamilyDocumentRequest(new Request(url as string, init), userId, store, async actor => actor === userId)) as typeof fetch);
  const signal = new AbortController().signal;
  const saved = await api.create(childId, request, signal, userId);
  assert.equal(saved.report?.phase, "building"); assert.equal(saved.current, null); assert.equal(api.hasUnknownOriginal(), false);
  item = { ...item, version: 2, readState: "ready", report: { ...item.report!, phase: "complete", processedSources: 121 }, current: {
    id: randomUUID(), version: 2, generatedAt: at, sourceBasis: "synthetic-revision-0", title: request.title, summary: "已保存資料統計", ageLabel: "年齡未確認",
    period, eventDate: null, coverageNote: "完整掃描 121 項來源；正文選錄。", sections: [], sources: [], changes: [],
    reportCoverage: { status: "complete", mode: "fixed", periodKind: "annual", sourceRevision: "11111111-1111-4111-a111-111111111111:1:0", completedAt: at, validUntil: null, scanned: 121,
      counts: { recordsInPeriod: 120, recordsUnknownTime: 0, tasksInPeriod: 0, observationsInPeriod: 0, confirmedFacts: 0, recordKinds: { note: 120 } } } } };
  const read = await api.getItem(childId, id, signal, userId);
  assert.equal(read.current?.reportCoverage?.counts.recordsInPeriod, 120); assert.equal(read.report?.phase, "complete"); assert.equal(calls, 2);
});
