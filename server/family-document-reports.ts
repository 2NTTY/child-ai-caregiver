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

export * from './family-document-report-core.ts';
import { accumulateReportInputs, type ReportAccumulator, type ReportInput } from './family-document-report-core.ts';

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
    const finishConcern = () => {
      const pending = state.pendingConcern;
      if (pending?.header && !pending.sawObservation) inputs.push({ source: pending.header, domain: "concerns", activeConcern: true });
      delete state.pendingConcern;
    };
    for (const { concern, event } of page.items) {
      if (state.pendingConcern?.id !== concern.id) finishConcern();
      state.pendingConcern ??= { id: concern.id, header: null, sawObservation: false };
      if (!event) state.pendingConcern.header = concern.status === "following" ? concernDocumentSource(concern) : null;
      else if (event.kind === "observation") {
        state.pendingConcern.sawObservation = true;
        inputs.push({ source: concernDocumentSource(concern, event), domain: "concerns" });
      }
    }
    if (page.next) state.concernAfter = page.next;
    else { finishConcern(); delete state.concernAfter; state.stage = "done"; }
    // Deferred headers were already scanned on an earlier page and must not increment coverage twice.
    accumulateReportInputs(state, inputs, page.items.length);
  }
}
