import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writePersonalHandoverPackage } from "../server/handover-export.ts";
import { createFirestoreVoiceTranscripts } from "../server/firestore-voice-transcripts.ts";
import { createFirestoreAuthority } from "../server/firestore-authority.ts";
import { createFirestoreVoiceStore } from "../server/firestore-voice.ts";
import { createFirestoreChatStore } from "../server/firestore-chat.ts";
import { createFirestoreOnlineStore } from "../server/firestore-online.ts";
import { createFirestoreCareStore } from "../server/firestore-care.ts";
import { createFirestoreMemoryStore } from "../server/firestore-memory.ts";
import { createFirestoreProductAgent } from "../server/firestore-product-agent.ts";
import { createFirestoreBackgroundQueue, type FirestoreBackgroundDelivery } from "../server/firestore-background-work.ts";
import { createVoiceObjects } from "../server/firebase-voice-objects.ts";
import { createFirebaseErasureJournal } from "../server/firebase-erasure-journal.ts";
import { createStorageCipher } from "../server/storage-crypto.ts";
import { readAiConfig } from "../server/ai-config.ts";
import { SERVICE_POLICY_VERSION } from "../src/shared/account-service.ts";
import { avatarMemoryBucket } from "./helpers/avatar-memory.ts";
import { serialFirestoreFixture } from "./helpers/firestore-session-memory.ts";
import { FinishReason } from "@google/genai";
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

test("Scenario #18: resumable export batches enforce strict stage order, hash integrity, scope stability, and voice reconciliation", async () => {
  let state: ResumableExportState = {
    scopeVersion: "scope-epoch:1",
    stage: "profile",
    afterId: null,
    done: false,
    items: [],
  };

  // Skipping stages (profile -> voice) or emitting done early while stages remain must fail closed.
  const skippedStage = advanceResumableExportBatch(state, {
    scopeVersion: "scope-epoch:1",
    stage: "profile",
    items: [{ id: "prof-1", stage: "profile", payloadHash: "h1" }],
    nextAfterId: null,
    nextStage: "voice",
    hasMore: false,
  });
  assert.equal(skippedStage.status, "invalidated");
  assert.equal(skippedStage.reason, "stage_skipped");

  const prematureDone = advanceResumableExportBatch(state, {
    scopeVersion: "scope-epoch:1",
    stage: "profile",
    items: [{ id: "prof-1", stage: "profile", payloadHash: "h1" }],
    nextAfterId: null,
    nextStage: null,
    hasMore: false,
  });
  assert.equal(prematureDone.status, "invalidated");
  assert.equal(prematureDone.reason, "incomplete_export_stages");

  const step1 = advanceResumableExportBatch(state, {
    scopeVersion: "scope-epoch:1",
    stage: "profile",
    items: [{ id: "prof-1", stage: "profile", payloadHash: "h1" }],
    nextAfterId: "prof-1",
    nextStage: null,
    hasMore: true,
  });
  assert.equal(step1.status, "ready");
  state = step1.state;

  // Duplicate id with conflicting payloadHash across resumed pages must invalidate rather than splicing.
  const conflictingHash = advanceResumableExportBatch(state, {
    scopeVersion: "scope-epoch:1",
    stage: "profile",
    items: [{ id: "prof-1", stage: "profile", payloadHash: "h1-mutated" }],
    nextAfterId: null,
    nextStage: "care_records",
    hasMore: false,
  });
  assert.equal(conflictingHash.status, "invalidated");
  assert.equal(conflictingHash.reason, "item_hash_conflict");

  // Scope mutation between batches must invalidate without splicing new-epoch items.
  const scopeChanged = advanceResumableExportBatch(state, {
    scopeVersion: "scope-epoch:2",
    stage: "profile",
    items: [{ id: "prof-2", stage: "profile", payloadHash: "h2" }],
    nextAfterId: null,
    nextStage: "care_records",
    hasMore: false,
  });
  assert.equal(scopeChanged.status, "invalidated");
  assert.equal(scopeChanged.reason, "export_scope_changed");
  assert.equal(scopeChanged.state.items.length, 1);

  // Full sequential progression through every export stage completes only at final stage.
  const step1End = advanceResumableExportBatch(state, {
    scopeVersion: "scope-epoch:1",
    stage: "profile",
    items: [{ id: "prof-1", stage: "profile", payloadHash: "h1" }],
    nextAfterId: null,
    nextStage: "care_records",
    hasMore: false,
  });
  assert.equal(step1End.status, "ready");
  assert.equal(step1End.state.stage, "care_records");
  assert.equal(step1End.state.done, false);

  const stage2 = advanceResumableExportBatch(step1End.state, {
    scopeVersion: "scope-epoch:1",
    stage: "care_records",
    items: [{ id: "rec-1", stage: "care_records", payloadHash: "h-rec" }],
    nextAfterId: null,
    nextStage: "tasks",
    hasMore: false,
  });
  assert.equal(stage2.status, "ready");

  // Stage regression must be rejected.
  const regression = advanceResumableExportBatch(stage2.state, {
    scopeVersion: "scope-epoch:1",
    stage: "profile",
    items: [],
    nextAfterId: null,
    nextStage: "care_records",
    hasMore: false,
  });
  assert.equal(regression.status, "invalidated");
  assert.equal(regression.reason, "stage_regression");

  const stage3 = advanceResumableExportBatch(stage2.state, {
    scopeVersion: "scope-epoch:1",
    stage: "tasks",
    items: [],
    nextAfterId: null,
    nextStage: "growth",
    hasMore: false,
  });
  assert.equal(stage3.status, "ready");
  const stage4 = advanceResumableExportBatch(stage3.state, {
    scopeVersion: "scope-epoch:1",
    stage: "growth",
    items: [],
    nextAfterId: null,
    nextStage: "concerns",
    hasMore: false,
  });
  assert.equal(stage4.status, "ready");
  const stage5 = advanceResumableExportBatch(stage4.state, {
    scopeVersion: "scope-epoch:1",
    stage: "concerns",
    items: [],
    nextAfterId: null,
    nextStage: "voice",
    hasMore: false,
  });
  assert.equal(stage5.status, "ready");
  const finalStep = advanceResumableExportBatch(stage5.state, {
    scopeVersion: "scope-epoch:1",
    stage: "voice",
    items: [{ id: "v-1", stage: "voice", payloadHash: "h2" }],
    nextAfterId: null,
    nextStage: null,
    hasMore: false,
  });
  assert.equal(finalStep.status, "done");
  assert.equal(finalStep.state.done, true);
  assert.equal(finalStep.state.items.length, 3);

  // Scoped manifests allow explicit ordered stage subsets without skipping declared stages.
  const scopedDone = advanceResumableExportBatch(
    { scopeVersion: "s1", stage: "profile", afterId: null, done: false, items: [], expectedStages: ["profile", "voice"] },
    { scopeVersion: "s1", stage: "profile", items: [{ id: "p1", stage: "profile", payloadHash: "hp1" }], nextAfterId: null, nextStage: "voice", hasMore: false },
  );
  assert.equal(scopedDone.status, "ready");
  const scopedEnd = advanceResumableExportBatch(scopedDone.state, {
    scopeVersion: "s1", stage: "voice", items: [{ id: "v1", stage: "voice", payloadHash: "hv1" }], nextAfterId: null, nextStage: null, hasMore: false,
  });
  assert.equal(scopedEnd.status, "done");

  // Voice revision change and NaN/non-finite timestamps invalidate fail-closed.
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
  const nanTimestamps = reconcileVoiceTranscriptRevision(replacedVoice, {
    voiceId,
    basis: currentBasis,
    text: "Corrupt timings",
    segments: [{ startMs: 0, endMs: Number.NaN, text: "Corrupt timings" }],
  });
  assert.equal(nanTimestamps.accepted, false);
  assert.equal(nanTimestamps.reason, "invalid_voice_timestamps");

  const matched = reconcileVoiceTranscriptRevision(replacedVoice, {
    voiceId,
    basis: currentBasis,
    text: "Updated audio words",
    segments: [{ startMs: 0, endMs: 2_000, text: "Updated audio words" }],
  });
  assert.equal(matched.accepted, true);
  assert.equal(matched.text, "Updated audio words");

  // Also cross-verify family-document report accumulator deduplicates and rejects authority drift at completion.
  const acc = newReportAccumulator({
    kind: "growth_report",
    purpose: "family",
    title: "Cross-domain quarterly",
    eventDate: null,
    period: { from: "2026-07-01", to: "2026-09-30" },
  }, "epoch:5:1");
  acc.profile = { childId: "synthetic-child", version: 1, data: null, confirmedBy: null, confirmedAt: null, reason: null };
  const recInput = {
    source: { id: "rec-1", resourceId: "rec-1", kind: "record" as const, version: 1, label: "Synthetic", text: "Feed", at: "2026-08-10T00:00:00Z" },
    domain: "body_life" as const,
    recordKind: "feeding",
  };
  accumulateReportInputs(acc, [recInput, recInput]);
  assert.equal(acc.counts.recordsInPeriod, 1);
  acc.stage = "done";
  const snap = completeReportSnapshot(acc, 2, null, {
    sourceRevision: "epoch:5:1",
    profile: acc.profile,
    entries: [recInput.source],
    domains: new Map([["rec-1", "body_life"]]),
    questions: new Set(),
    activeConcernIds: new Set(),
    limited: false,
  });
  assert.equal(snap.reportCoverage?.counts.recordsInPeriod, 1);
  assert.throws(
    () =>
      completeReportSnapshot(acc, 2, null, {
        sourceRevision: "epoch:6:1",
        profile: acc.profile!,
        entries: [recInput.source],
        domains: new Map([["rec-1", "body_life"]]),
        questions: new Set(),
        activeConcernIds: new Set(),
        limited: false,
      }),
    (err: { code?: string }) => err.code === "source_changed",
  );
});

test("Adversarial fail-closed edge cases: NaN timestamps, duplicate stats, and MAX_SAFE_INTEGER overflow", () => {
  const wm = {
    childId: "child-nan",
    snapshotAtMs: 1_000,
    authorityVersion: "epoch:1",
    maxPerDomain: 10,
  };
  const nanEntry = evaluateCrossDomainSnapshot(wm, "epoch:1", [
    { id: "e-nan", domain: "care_records", version: 1, createdAtMs: 500, updatedAtMs: Number.NaN, summary: "nan" },
  ]);
  assert.equal(nanEntry.status, "stale");
  assert.equal(nanEntry.reason, "concurrent_mutation_in_window");

  const nanWm = evaluateCrossDomainSnapshot({ ...wm, snapshotAtMs: Number.NaN }, "epoch:1", []);
  assert.equal(nanWm.status, "stale");

  const cipherA = JSON.stringify({ kind: "records", value: 3 });
  const digestA = createHash("sha256").update(cipherA, "utf8").digest("hex");
  const deduped = accumulateEncryptedStatisticsFailClosed(
    [
      { recordId: "r1", domain: "care_records", ciphertext: cipherA, ciphertextSha256: digestA },
      { recordId: "r1", domain: "care_records", ciphertext: cipherA, ciphertextSha256: digestA },
    ],
    e => (e.ciphertext ? JSON.parse(e.ciphertext) : null),
  );
  assert.equal(deduped.status, "complete");
  assert.equal(deduped.totalsByKind.records, 3);
  assert.equal(deduped.scannedCount, 1);

  const cipherB = JSON.stringify({ kind: "records", value: 4 });
  const digestB = createHash("sha256").update(cipherB, "utf8").digest("hex");
  const conflictingDup = accumulateEncryptedStatisticsFailClosed(
    [
      { recordId: "r1", domain: "care_records", ciphertext: cipherA, ciphertextSha256: digestA },
      { recordId: "r1", domain: "care_records", ciphertext: cipherB, ciphertextSha256: digestB },
    ],
    e => (e.ciphertext ? JSON.parse(e.ciphertext) : null),
  );
  assert.equal(conflictingDup.status, "invalidated");
  assert.equal(conflictingDup.reason, "integrity_mismatch");
  assert.equal(conflictingDup.totalsByKind, null);

  const cipherMax = JSON.stringify({ kind: "records", value: Number.MAX_SAFE_INTEGER });
  const cipherOne = JSON.stringify({ kind: "records", value: 1 });
  const overflow = accumulateEncryptedStatisticsFailClosed(
    [
      { recordId: "r-max", domain: "care_records", ciphertext: cipherMax, ciphertextSha256: createHash("sha256").update(cipherMax, "utf8").digest("hex") },
      { recordId: "r-one", domain: "care_records", ciphertext: cipherOne, ciphertextSha256: createHash("sha256").update(cipherOne, "utf8").digest("hex") },
    ],
    e => (e.ciphertext ? JSON.parse(e.ciphertext) : null),
  );
  assert.equal(overflow.status, "invalidated");
  assert.equal(overflow.reason, "decrypt_failed");
  assert.equal(overflow.partialCountsSuppressed, true);
});

test("Production wiring: handover export rejects mutated item hash across pages and voice transcription rejects NaN timings", async t => {
  const dir = mkdtempSync(join(tmpdir(), "xdomain-prod-"));
  try {
    const childId = randomUUID();
    const recordId = randomUUID();
    const scopeVersion = "a".repeat(64);
    let pageCalls = 0;
    await assert.rejects(
      writePersonalHandoverPackage({
        directory: dir,
        packageId: randomUUID(),
        ownerUserId: "owner",
        serverId: "https://example.test",
        createdAt: "2026-11-15T00:00:00Z",
        purpose: "handover",
        selection: { childIds: [childId], modules: ["care"], period: null },
        exporter: {
          async page(_owner, query) {
            if (query.section === "children") {
              return { section: "children", scopeVersion, complete: true, nextCursor: null, notices: [], items: [{ id: childId, displayName: "Child" }] };
            }
            if (query.section === "care") {
              pageCalls += 1;
              if (pageCalls === 1) {
                return {
                  section: "care",
                  scopeVersion,
                  complete: false,
                  nextCursor: "c1",
                  notices: [],
                  items: [{ id: recordId, childId, version: 1, text: "original" }],
                };
              }
              return {
                section: "care",
                scopeVersion,
                complete: true,
                nextCursor: null,
                notices: [],
                items: [{ id: recordId, childId, version: 2, text: "mutated-concurrently" }],
              };
            }
            return { section: query.section, scopeVersion, complete: true, nextCursor: null, notices: [], items: [] };
          },
        },
      }),
      (err: { code?: string }) => err.code === "export_scope_changed",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  // Real createFirestoreVoiceTranscripts + createFirestoreProductAgent failing closed on NaN segment timing.
  const f = serialFirestoreFixture();
  const cipher = createStorageCipher(Buffer.alloc(32, 9));
  const options = { projectId: "xdomain-voice", namespace: "unit_xdomain_voice", database: f.database, cipher };
  const authority = createFirestoreAuthority(options);
  await authority.initializeControl({ enabled: true, generation: randomUUID() });
  await authority.issueInvitation({ email: "parent@example.test", operationId: randomUUID(), expiresAt: new Date(Date.now() + 60000).toISOString() });
  await authority.admitIdentity({ userId: "parent", email: "parent@example.test", emailVerified: true });
  await authority.acknowledge({ userId: "parent", operationId: randomUUID(), policyVersion: SERVICE_POLICY_VERSION });
  const childId = (await authority.createChild({ userId: "parent", operationId: randomUUID(), displayName: "Voice Child" })).child.id;
  const pcmData = Buffer.alloc(32000, 0);
  const bytes = Buffer.alloc(44 + pcmData.length);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(36 + pcmData.length, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(16000, 24);
  bytes.writeUInt32LE(32000, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(pcmData.length, 40);
  pcmData.copy(bytes, 44);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const voiceBucket = avatarMemoryBucket("xdomain-voice-bucket");
  const journalBucket = avatarMemoryBucket("xdomain-journal-bucket");
  const objects = createVoiceObjects({
    config: { projectId: options.projectId, namespace: options.namespace, bucketName: "xdomain-voice-bucket" },
    cipher,
    bucket: voiceBucket.port,
  });
  const journal = createFirebaseErasureJournal({
    config: { projectId: options.projectId, namespace: options.namespace, bucketName: "xdomain-journal-bucket" },
    cipher,
    bucket: journalBucket.port,
  });
  const voice = createFirestoreVoiceStore({ ...options, objects, journal });
  const chat = createFirestoreChatStore({ ...options, voice });
  const online = createFirestoreOnlineStore({ ...options, mutations: [chat.mutation] });
  const care = createFirestoreCareStore(options);
  const memory = createFirestoreMemoryStore({ ...options, chat, care });
  const transcripts = createFirestoreVoiceTranscripts({ ...options, voices: voice });
  const voiceId = randomUUID();
  const reserved = await voice.reserve("parent", childId, { opId: voiceId, fileName: "r.wav", bytes: bytes.length, sha256, mimeType: "audio/wav" });
  const ready = await voice.upload("parent", childId, voiceId, reserved.version, bytes.toString("base64"));
  const msgPath = `/api/children/${childId}/messages`;
  const msgPayload = { text: "", voice: { id: voiceId, expectedVersion: ready.version } };
  const sent = await online.submit("parent", {
    path: msgPath,
    payload: msgPayload,
    operation: { ...(await online.context("parent", { path: msgPath, payload: msgPayload })), opId: randomUUID(), deviceId: randomUUID() },
  });
  const msg = (sent.result as { message: { id: string } }).message;
  const deliveries: FirestoreBackgroundDelivery[] = [];
  const product = await createFirestoreProductAgent({
    ...options,
    chat,
    care,
    memory,
    online,
    voices: voice,
    config: readAiConfig({ AI_ENABLED: "true", GCP_PROJECT_ID: options.projectId }),
    platformProvider: {
      async generate(request) {
        const declarations = request.config?.tools?.flatMap(tool => ("functionDeclarations" in tool ? tool.functionDeclarations ?? [] : [])) ?? [];
        if (declarations.some(d => d.name === "stage_voice_transcript")) {
          return {
            content: {
              role: "model",
              parts: [{
                functionCall: {
                  id: "bad-nan-seg",
                  name: "stage_voice_transcript",
                  args: { complete: true, segments: [{ text: "exceeds audio", startMs: 0, endMs: 9000, unclear: false }] },
                },
              }],
            },
            finishReason: FinishReason.STOP,
          };
        }
        return { content: { role: "model", parts: [{ functionCall: { id: "p", name: "present_answer", args: { kind: "operation", paragraphs: [{ text: "ok", citationIds: [] }] } } }] }, finishReason: FinishReason.STOP };
      },
    },
  });
  await product.actions.savePolicy("parent", childId, {
    operationId: randomUUID(), expectedVersion: 0, recordKinds: [], allowPrivateNotes: true,
    allowSelfTasks: false, allowRecordCorrections: false, reminderConsentVersion: null, reminderBindings: [], confirm: true, confirmShared: false,
  });
  await product.agent.reply("parent", childId, msg.id, async () => true);
  const queue = createFirestoreBackgroundQueue({
    ...options,
    enabled: true,
    readControl: tx => authority.readControl(tx),
    transport: { async enqueue(job) { deliveries.push(job); return { state: "confirmed" }; }, async probe() { return { state: "confirmed" }; } },
    execute: (job, abort) => job.kind === "voice-transcription" ? product.transcribeVoice!(job, async () => true, abort) : Promise.resolve({ state: "stopped" }),
  });
  await queue.dispatch();
  const scheduled = deliveries.find(j => Date.parse(j.scheduledAt) > Date.now())!;
  t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
  try {
    t.mock.timers.tick(120001);
    const processed = await queue.process(scheduled);
    assert.notEqual(processed.state, "completed");
    assert.notEqual((await transcripts.get("parent", childId, voiceId)).state, "available");
  } finally {
    t.mock.timers.reset();
  }
});
