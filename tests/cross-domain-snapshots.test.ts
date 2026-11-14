import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import {
  advanceResumableExportBatch,
  accumulateEncryptedStatisticsFailClosed,
  computeVoiceRevisionBasis,
  createCrossDomainWatermark,
  evaluateCrossDomainSnapshot,
  reconcileVoiceTranscriptRevision,
  type CrossDomainSnapshotEntry,
  type ResumableExportState,
  type SealedStatisticEnvelope,
} from "../server/cross-domain-snapshot.ts";
import {
  accumulateReportInputs,
  completeReportSnapshot,
  newReportAccumulator,
} from "../server/family-document-reports.ts";

function sealed(recordId: string, domain: SealedStatisticEnvelope["domain"], payload: string): SealedStatisticEnvelope {
  const ciphertext = Buffer.from(payload, "utf8").toString("base64");
  return {
    recordId,
    domain,
    ciphertext,
    ciphertextSha256: createHash("sha256").update(ciphertext, "utf8").digest("hex"),
  };
}

test("Scenario #14: cross-domain snapshot barrier excludes post-watermark writes, catches concurrent mutations, and preserves true full counts across bounded pages", () => {
  const snapshotAtMs = Date.parse("2026-10-01T12:00:00.000Z");
  const watermark = createCrossDomainWatermark({
    childId: randomUUID(),
    snapshotAtMs,
    authorityVersion: "epoch:5",
    maxPerDomain: 2,
  });

  const baseEntries: CrossDomainSnapshotEntry[] = [
    { id: "c-1", domain: "care_records", createdAtMs: snapshotAtMs - 10_000, updatedAtMs: snapshotAtMs - 10_000, version: 1, summary: "Feed 1" },
    { id: "c-2", domain: "care_records", createdAtMs: snapshotAtMs - 5_000, updatedAtMs: snapshotAtMs - 5_000, version: 1, summary: "Feed 2" },
    { id: "c-3", domain: "care_records", createdAtMs: snapshotAtMs - 2_000, updatedAtMs: snapshotAtMs - 2_000, version: 1, summary: "Feed 3" },
    { id: "t-1", domain: "tasks", createdAtMs: snapshotAtMs - 1_000, updatedAtMs: snapshotAtMs - 1_000, version: 1, summary: "Task 1" },
    { id: "g-1", domain: "growth", createdAtMs: snapshotAtMs - 1_000, updatedAtMs: snapshotAtMs - 1_000, version: 1, summary: "Growth 1" },
    { id: "con-1", domain: "concerns", createdAtMs: snapshotAtMs - 1_000, updatedAtMs: snapshotAtMs - 1_000, version: 1, summary: "Concern 1" },
    { id: "m-1", domain: "messages", createdAtMs: snapshotAtMs - 1_000, updatedAtMs: snapshotAtMs - 1_000, version: 1, summary: "Message 1" },
    // Created after snapshot barrier: must be excluded cleanly without corrupting snapshot.
    { id: "c-post", domain: "care_records", createdAtMs: snapshotAtMs + 500, updatedAtMs: snapshotAtMs + 500, version: 1, summary: "Post barrier write" },
  ];

  const consistent = evaluateCrossDomainSnapshot(watermark, "epoch:5", baseEntries);
  assert.equal(consistent.status, "consistent");
  assert.equal(consistent.excludedPostWatermarkCount, 1);
  assert.equal(consistent.counts.care_records, 3);
  assert.equal(consistent.entriesByDomain.care_records.length, 2, "Per-domain excerpt list is bounded");
  assert.deepEqual(consistent.truncatedDomains, ["care_records"]);

  // Concurrent mutation inside the captured barrier window must fail closed.
  const mutatedDuringScan = baseEntries.map(entry =>
    entry.id === "t-1" ? { ...entry, updatedAtMs: snapshotAtMs + 100 } : entry,
  );
  const staleMutation = evaluateCrossDomainSnapshot(watermark, "epoch:5", mutatedDuringScan);
  assert.equal(staleMutation.status, "stale");
  assert.equal(staleMutation.reason, "concurrent_mutation_in_window");
  assert.equal(staleMutation.counts, null);
  assert.equal(staleMutation.entriesByDomain, null);

  // Authority drift must also fail closed.
  const staleAuthority = evaluateCrossDomainSnapshot(watermark, "epoch:6", baseEntries);
  assert.equal(staleAuthority.status, "stale");
  assert.equal(staleAuthority.reason, "authority_changed");
  assert.equal(staleAuthority.counts, null);
});

test("Scenario #15: encrypted statistics fail closed on missing/corrupted ciphertext or plaintext leak and never emit understated partial counts", () => {
  const validEnvelopes = [
    sealed("r1", "care_records", JSON.stringify({ kind: "feeding", value: 2 })),
    sealed("r2", "care_records", JSON.stringify({ kind: "feeding", value: 3 })),
    sealed("r3", "tasks", JSON.stringify({ kind: "completed_task", value: 1 })),
  ];
  const decode = (env: SealedStatisticEnvelope) => JSON.parse(Buffer.from(env.ciphertext!, "base64").toString("utf8"));

  const ok = accumulateEncryptedStatisticsFailClosed(validEnvelopes, decode);
  assert.equal(ok.status, "complete");
  assert.equal(ok.partialCountsSuppressed, false);
  assert.deepEqual(ok.totalsByKind, { feeding: 5, completed_task: 1 });

  const missingCipher = accumulateEncryptedStatisticsFailClosed(
    [validEnvelopes[0], { recordId: "r-missing", domain: "care_records", ciphertext: null, ciphertextSha256: null }],
    decode,
  );
  assert.equal(missingCipher.status, "invalidated");
  assert.equal(missingCipher.reason, "missing_ciphertext");
  assert.equal(missingCipher.partialCountsSuppressed, true);
  assert.equal(missingCipher.totalsByKind, null);

  const tamperedCipher = accumulateEncryptedStatisticsFailClosed(
    [validEnvelopes[0], { ...validEnvelopes[1], ciphertext: Buffer.from("{\"kind\":\"feeding\",\"value\":999}", "utf8").toString("base64") }],
    decode,
  );
  assert.equal(tamperedCipher.status, "invalidated");
  assert.equal(tamperedCipher.reason, "integrity_mismatch");
  assert.equal(tamperedCipher.totalsByKind, null);

  const leakEnvelope = accumulateEncryptedStatisticsFailClosed(
    [{ ...validEnvelopes[0], plaintextLeak: { unencryptedNote: "should never exist in index" } }],
    decode,
  );
  assert.equal(leakEnvelope.status, "invalidated");
  assert.equal(leakEnvelope.reason, "plaintext_leak_detected");
  assert.equal(leakEnvelope.totalsByKind, null);
});

test("Scenario #18: resumable export batches enforce scope stability and voice transcript reconciliation rejects superseded revisions", () => {
  let state: ResumableExportState = {
    scopeVersion: "scope-epoch:1",
    stage: "profile",
    afterId: null,
    done: false,
    items: [],
  };

  const step1 = advanceResumableExportBatch(state, {
    scopeVersion: "scope-epoch:1",
    stage: "profile",
    items: [{ id: "prof-1", stage: "profile", payloadHash: "h1" }],
    nextAfterId: null,
    nextStage: "voice",
    hasMore: true,
  });
  assert.equal(step1.status, "ready");
  state = step1.state;

  // Scope mutation between batches must invalidate without splicing new-epoch items.
  const scopeChanged = advanceResumableExportBatch(state, {
    scopeVersion: "scope-epoch:2",
    stage: "voice",
    items: [{ id: "v-1", stage: "voice", payloadHash: "h2" }],
    nextAfterId: null,
    nextStage: null,
    hasMore: false,
  });
  assert.equal(scopeChanged.status, "invalidated");
  assert.equal(scopeChanged.reason, "export_scope_changed");
  assert.equal(scopeChanged.state.items.length, 1);

  const step2 = advanceResumableExportBatch(state, {
    scopeVersion: "scope-epoch:1",
    stage: "voice",
    items: [
      { id: "prof-1", stage: "profile", payloadHash: "h1" }, // dedupe safety check
      { id: "v-1", stage: "voice", payloadHash: "h2" },
    ],
    nextAfterId: null,
    nextStage: null,
    hasMore: false,
  });
  assert.equal(step2.status, "done");
  assert.equal(step2.state.items.length, 2);

  // Voice revision change invalidates pending transcript from prior audio digest.
  const voiceId = randomUUID();
  const originalBasis = computeVoiceRevisionBasis({ version: 1, sha256: "a".repeat(64) });
  const replacedVoice = { voiceId, version: 2, sha256: "b".repeat(64), durationMs: 4_000 };
  const superseded = reconcileVoiceTranscriptRevision(replacedVoice, {
    voiceId,
    basis: originalBasis,
    text: "Old audio words",
    segments: [{ startMs: 0, endMs: 1_500, text: "Old audio words" }],
  });
  assert.equal(superseded.accepted, false);
  assert.equal(superseded.reason, "voice_revision_superseded");
  assert.equal(superseded.text, null);

  const currentBasis = computeVoiceRevisionBasis(replacedVoice);
  const matched = reconcileVoiceTranscriptRevision(replacedVoice, {
    voiceId,
    basis: currentBasis,
    text: "Updated audio words",
    segments: [{ startMs: 0, endMs: 2_000, text: "Updated audio words" }],
  });
  assert.equal(matched.accepted, true);
  assert.equal(matched.text, "Updated audio words");

  // Also cross-verify family-document report accumulator suppresses incomplete bucket trends on resume.
  const acc = newReportAccumulator({
    kind: "growth_report",
    purpose: "family",
    title: "Cross-domain quarterly",
    eventDate: null,
    period: { from: "2026-07-01", to: "2026-09-30" },
  }, "epoch:5:1");
  acc.profile = { childId: "synthetic-child", version: 1, data: null, confirmedBy: null, confirmedAt: null, reason: null };
  accumulateReportInputs(acc, [{
    source: { id: "rec-1", resourceId: "rec-1", kind: "record", version: 1, label: "Synthetic", text: "Feed", at: "2026-08-10T00:00:00Z" },
    domain: "body_life",
    recordKind: "feeding",
  }]);
  acc.stage = "done";
  const snap = completeReportSnapshot(acc, 2, null);
  assert.equal(snap.reportCoverage?.counts.recordsInPeriod, 1);
});
