import { createHash } from "node:crypto";

export const SNAPSHOT_DOMAINS = [
  "care_records",
  "tasks",
  "growth",
  "concerns",
  "messages",
] as const;

export type SnapshotDomain = (typeof SNAPSHOT_DOMAINS)[number];

export interface CrossDomainWatermark {
  readonly childId: string;
  readonly snapshotAtMs: number;
  readonly authorityVersion: string;
  readonly maxPerDomain: number;
}

export interface CrossDomainSnapshotEntry {
  readonly id: string;
  readonly domain: SnapshotDomain;
  readonly createdAtMs: number;
  readonly updatedAtMs: number;
  readonly version: number;
  readonly summary: string;
}

export type CrossDomainSnapshotEvaluation =
  | {
      status: "consistent";
      reason: null;
      watermark: CrossDomainWatermark;
      entriesByDomain: Record<SnapshotDomain, CrossDomainSnapshotEntry[]>;
      counts: Record<SnapshotDomain, number>;
      excludedPostWatermarkCount: number;
      truncatedDomains: SnapshotDomain[];
    }
  | {
      status: "stale";
      reason: "authority_changed" | "concurrent_mutation_in_window";
      watermark: CrossDomainWatermark;
      entriesByDomain: null;
      counts: null;
      excludedPostWatermarkCount: number;
      truncatedDomains: [];
    };

/**
 * Captures an immutable cross-domain read barrier at a single timestamp and authority epoch.
 */
export function createCrossDomainWatermark(input: {
  childId: string;
  snapshotAtMs: number;
  authorityVersion: string;
  maxPerDomain?: number;
}): CrossDomainWatermark {
  if (!input.childId || !input.authorityVersion || !Number.isFinite(input.snapshotAtMs)) {
    throw new RangeError("invalid_cross_domain_watermark");
  }
  return Object.freeze({
    childId: input.childId,
    snapshotAtMs: input.snapshotAtMs,
    authorityVersion: input.authorityVersion,
    maxPerDomain: Math.max(1, Math.min(500, input.maxPerDomain ?? 50)),
  });
}

/**
 * Evaluates scanned entries against a cross-domain barrier so concurrent in-window writes
 * or authority changes fail closed rather than mixing pre-barrier and post-barrier state.
 */
export function evaluateCrossDomainSnapshot(
  watermark: CrossDomainWatermark,
  currentAuthorityVersion: string,
  entries: readonly CrossDomainSnapshotEntry[],
): CrossDomainSnapshotEvaluation {
  if (!watermark.authorityVersion || typeof currentAuthorityVersion !== "string") {
    return {
      status: "stale",
      reason: "authority_changed",
      watermark,
      entriesByDomain: null,
      counts: null,
      excludedPostWatermarkCount: 0,
      truncatedDomains: [],
    };
  }
  if (currentAuthorityVersion !== watermark.authorityVersion) {
    return {
      status: "stale",
      reason: "authority_changed",
      watermark,
      entriesByDomain: null,
      counts: null,
      excludedPostWatermarkCount: 0,
      truncatedDomains: [],
    };
  }
  if (!Number.isFinite(watermark.snapshotAtMs) || watermark.snapshotAtMs < 0) {
    return {
      status: "stale",
      reason: "concurrent_mutation_in_window",
      watermark,
      entriesByDomain: null,
      counts: null,
      excludedPostWatermarkCount: 0,
      truncatedDomains: [],
    };
  }

  const seenByDomain: Record<SnapshotDomain, Map<string, CrossDomainSnapshotEntry>> = {
    care_records: new Map(),
    tasks: new Map(),
    growth: new Map(),
    concerns: new Map(),
    messages: new Map(),
  };
  let excludedPostWatermarkCount = 0;

  for (const entry of entries) {
    if (
      !Number.isFinite(entry.createdAtMs) ||
      entry.createdAtMs < 0 ||
      !Number.isFinite(entry.updatedAtMs) ||
      entry.updatedAtMs < 0 ||
      entry.updatedAtMs < entry.createdAtMs
    ) {
      return {
        status: "stale",
        reason: "concurrent_mutation_in_window",
        watermark,
        entriesByDomain: null,
        counts: null,
        excludedPostWatermarkCount,
        truncatedDomains: [],
      };
    }
    if (entry.createdAtMs > watermark.snapshotAtMs) {
      excludedPostWatermarkCount += 1;
      continue;
    }
    if (entry.updatedAtMs > watermark.snapshotAtMs) {
      return {
        status: "stale",
        reason: "concurrent_mutation_in_window",
        watermark,
        entriesByDomain: null,
        counts: null,
        excludedPostWatermarkCount,
        truncatedDomains: [],
      };
    }
    if (!seenByDomain[entry.domain].has(entry.id)) {
      seenByDomain[entry.domain].set(entry.id, entry);
    }
  }

  const counts = {} as Record<SnapshotDomain, number>;
  const entriesByDomain = {} as Record<SnapshotDomain, CrossDomainSnapshotEntry[]>;
  const truncatedDomains: SnapshotDomain[] = [];

  for (const domain of SNAPSHOT_DOMAINS) {
    const all = Array.from(seenByDomain[domain].values());
    counts[domain] = all.length;
    if (all.length > watermark.maxPerDomain) {
      truncatedDomains.push(domain);
    }
    entriesByDomain[domain] = all.slice(0, watermark.maxPerDomain);
  }

  return {
    status: "consistent",
    reason: null,
    watermark,
    entriesByDomain,
    counts,
    excludedPostWatermarkCount,
    truncatedDomains,
  };
}

export interface SealedStatisticEnvelope {
  readonly recordId: string;
  readonly domain: SnapshotDomain;
  readonly ciphertext: string | null;
  readonly ciphertextSha256: string | null;
  readonly plaintextLeak?: unknown;
}

export interface DecryptedMetric {
  readonly kind: string;
  readonly value: number;
}

export type EncryptedStatisticsResult =
  | {
      status: "complete";
      reason: null;
      partialCountsSuppressed: false;
      totalsByKind: Record<string, number>;
      scannedCount: number;
      unreadableRecordIds: [];
    }
  | {
      status: "invalidated";
      reason: "plaintext_leak_detected" | "missing_ciphertext" | "integrity_mismatch" | "decrypt_failed";
      partialCountsSuppressed: true;
      totalsByKind: null;
      scannedCount: number;
      unreadableRecordIds: string[];
    };

/**
 * Aggregates statistics exclusively from verified ciphertext envelopes and fails closed
 * whenever any record cannot be verified/decrypted or contains plaintext leakage.
 */
export function accumulateEncryptedStatisticsFailClosed(
  envelopes: readonly SealedStatisticEnvelope[],
  decrypt: (envelope: SealedStatisticEnvelope) => DecryptedMetric | null,
): EncryptedStatisticsResult {
  const totalsByKind: Record<string, number> = {};
  let scannedCount = 0;

  const seenRecords = new Map<string, string>();
  for (const envelope of envelopes) {
    scannedCount += 1;
    if (envelope.plaintextLeak !== undefined) {
      return {
        status: "invalidated",
        reason: "plaintext_leak_detected",
        partialCountsSuppressed: true,
        totalsByKind: null,
        scannedCount,
        unreadableRecordIds: [envelope.recordId],
      };
    }
    const recordKey = `${envelope.domain}:${envelope.recordId}`;
    if (!envelope.ciphertext || !envelope.ciphertextSha256) {
      return {
        status: "invalidated",
        reason: "missing_ciphertext",
        partialCountsSuppressed: true,
        totalsByKind: null,
        scannedCount,
        unreadableRecordIds: [envelope.recordId],
      };
    }
    const digest = createHash("sha256").update(envelope.ciphertext, "utf8").digest("hex");
    if (digest !== envelope.ciphertextSha256) {
      return {
        status: "invalidated",
        reason: "integrity_mismatch",
        partialCountsSuppressed: true,
        totalsByKind: null,
        scannedCount,
        unreadableRecordIds: [envelope.recordId],
      };
    }
    const priorDigest = seenRecords.get(recordKey);
    if (priorDigest !== undefined) {
      if (priorDigest !== envelope.ciphertextSha256) {
        return {
          status: "invalidated",
          reason: "integrity_mismatch",
          partialCountsSuppressed: true,
          totalsByKind: null,
          scannedCount,
          unreadableRecordIds: [envelope.recordId],
        };
      }
      scannedCount -= 1;
      continue;
    }
    seenRecords.set(recordKey, envelope.ciphertextSha256);
    let metric: DecryptedMetric | null = null;
    try {
      metric = decrypt(envelope);
    } catch {
      metric = null;
    }
    if (
      !metric ||
      typeof metric.kind !== "string" ||
      metric.kind.length === 0 ||
      !Number.isSafeInteger(metric.value) ||
      metric.value < 0
    ) {
      return {
        status: "invalidated",
        reason: "decrypt_failed",
        partialCountsSuppressed: true,
        totalsByKind: null,
        scannedCount,
        unreadableRecordIds: [envelope.recordId],
      };
    }
    const nextTotal = (totalsByKind[metric.kind] ?? 0) + metric.value;
    if (!Number.isSafeInteger(nextTotal)) {
      return {
        status: "invalidated",
        reason: "decrypt_failed",
        partialCountsSuppressed: true,
        totalsByKind: null,
        scannedCount,
        unreadableRecordIds: [envelope.recordId],
      };
    }
    totalsByKind[metric.kind] = nextTotal;
  }

  return {
    status: "complete",
    reason: null,
    partialCountsSuppressed: false,
    totalsByKind,
    scannedCount,
    unreadableRecordIds: [],
  };
}

export const EXPORT_STAGE_ORDER = [
  "profile",
  "care_records",
  "tasks",
  "growth",
  "concerns",
  "voice",
] as const;

export type ExportBatchStage = (typeof EXPORT_STAGE_ORDER)[number];

export interface ExportBatchItem {
  readonly id: string;
  readonly stage: ExportBatchStage;
  readonly payloadHash: string;
}

export interface ResumableExportState {
  readonly scopeVersion: string;
  readonly stage: ExportBatchStage;
  readonly afterId: string | null;
  readonly done: boolean;
  readonly items: readonly ExportBatchItem[];
  readonly expectedStages?: readonly ExportBatchStage[];
}

export interface ResumableExportPage {
  readonly scopeVersion: string;
  readonly stage: ExportBatchStage;
  readonly items: readonly ExportBatchItem[];
  readonly nextAfterId: string | null;
  readonly nextStage: ExportBatchStage | null;
  readonly hasMore: boolean;
}

export type ResumableExportAdvance =
  | {
      status: "ready" | "done";
      reason: null;
      state: ResumableExportState;
    }
  | {
      status: "invalidated";
      reason:
        | "export_scope_changed"
        | "stage_regression"
        | "stage_skipped"
        | "item_hash_conflict"
        | "incomplete_export_stages";
      state: ResumableExportState;
    };

/**
 * Advances a multi-stage resumable export cursor while preventing cross-epoch splicing or duplicate items.
 */
export function advanceResumableExportBatch(
  state: ResumableExportState,
  page: ResumableExportPage,
): ResumableExportAdvance {
  const stageOrder = state.expectedStages ?? EXPORT_STAGE_ORDER;
  if (
    stageOrder.length === 0 ||
    !stageOrder.every((stage, idx) => {
      const orderIdx = EXPORT_STAGE_ORDER.indexOf(stage);
      return orderIdx >= 0 && (idx === 0 || orderIdx > EXPORT_STAGE_ORDER.indexOf(stageOrder[idx - 1]!));
    })
  ) {
    return { status: "invalidated", reason: "stage_regression", state };
  }
  if (state.done) {
    return { status: "invalidated", reason: "incomplete_export_stages", state };
  }
  if (page.scopeVersion !== state.scopeVersion) {
    return { status: "invalidated", reason: "export_scope_changed", state };
  }
  const currentIdx = stageOrder.indexOf(state.stage);
  const incomingIdx = stageOrder.indexOf(page.stage);
  if (currentIdx < 0 || incomingIdx < 0 || incomingIdx < currentIdx) {
    return { status: "invalidated", reason: "stage_regression", state };
  }
  if (incomingIdx > currentIdx) {
    return { status: "invalidated", reason: "stage_skipped", state };
  }
  if (
    (page.hasMore && (page.nextAfterId === null || (page.nextStage !== null && page.nextStage !== page.stage))) ||
    (!page.hasMore && page.nextAfterId !== null)
  ) {
    return { status: "invalidated", reason: "incomplete_export_stages", state };
  }

  const seenHashes = new Map(state.items.map(item => [`${item.stage}:${item.id}`, item.payloadHash]));
  const merged = [...state.items];
  for (const item of page.items) {
    if (item.stage !== page.stage) {
      const itemIdx = stageOrder.indexOf(item.stage);
      return {
        status: "invalidated",
        reason: itemIdx >= 0 && itemIdx > currentIdx ? "stage_skipped" : "stage_regression",
        state,
      };
    }
    if (!item.id || typeof item.payloadHash !== "string" || item.payloadHash.trim().length === 0) {
      return { status: "invalidated", reason: "item_hash_conflict", state };
    }
    const key = `${item.stage}:${item.id}`;
    const existingHash = seenHashes.get(key);
    if (existingHash !== undefined) {
      if (existingHash !== item.payloadHash) {
        return { status: "invalidated", reason: "item_hash_conflict", state };
      }
      continue;
    }
    seenHashes.set(key, item.payloadHash);
    merged.push(item);
  }

  let nextStage: ExportBatchStage;
  let done = false;
  if (page.hasMore) {
    nextStage = page.stage;
  } else {
    const expectedNextStage = currentIdx + 1 < stageOrder.length ? stageOrder[currentIdx + 1]! : null;
    if (expectedNextStage !== null) {
      if (page.nextStage === null) {
        return { status: "invalidated", reason: "incomplete_export_stages", state };
      }
      if (page.nextStage !== expectedNextStage) {
        const nextIdx = stageOrder.indexOf(page.nextStage);
        return {
          status: "invalidated",
          reason: nextIdx >= 0 && nextIdx < currentIdx ? "stage_regression" : "stage_skipped",
          state,
        };
      }
      nextStage = expectedNextStage;
      done = false;
    } else {
      if (page.nextStage !== null) {
        return { status: "invalidated", reason: "stage_regression", state };
      }
      nextStage = page.stage;
      done = true;
    }
  }

  const nextState: ResumableExportState = {
    scopeVersion: state.scopeVersion,
    stage: nextStage,
    afterId: page.nextAfterId,
    done,
    items: merged,
    ...(state.expectedStages ? { expectedStages: state.expectedStages } : {}),
  };
  return { status: done ? "done" : "ready", reason: null, state: nextState };
}

/** In-process streaming cursor. The hash index is retained once (O(unique items));
 * unlike the serializable immutable checkpoint API above, advancing never copies
 * all preceding items. This is not a durable cross-process checkpoint.
 */
export function createStreamingExportSession(initial: Omit<ResumableExportState, "items">) {
  let state: ResumableExportState = { ...initial, items: [] };
  const seenHashes = new Map<string, string>();
  return {
    advance(page: ResumableExportPage): ResumableExportAdvance & { acceptedIndices: number[] } {
      // Reuse all stage, authority, cursor and page-local conflict validation.
      const advanced = advanceResumableExportBatch(state, page);
      if (advanced.status === "invalidated") return { ...advanced, acceptedIndices: [] };
      const pending = new Map<string, string>();
      const acceptedIndices: number[] = [];
      for (let i = 0; i < page.items.length; i++) {
        const item = page.items[i]!;
        const key = `${item.stage}:${item.id}`;
        const existingHash = pending.get(key) ?? seenHashes.get(key);
        if (existingHash !== undefined) {
          if (existingHash !== item.payloadHash) {
            return { status: "invalidated", reason: "item_hash_conflict", state, acceptedIndices: [] };
          }
          continue;
        }
        pending.set(key, item.payloadHash);
        acceptedIndices.push(i);
      }
      // Do not poison the dedup index if any item or cursor validation failed.
      for (const [key, hash] of pending) seenHashes.set(key, hash);
      state = { ...advanced.state, items: [] };
      return { ...advanced, state, acceptedIndices };
    },
  };
}

export interface VoiceRevisionRef {
  readonly voiceId: string;
  readonly version: number;
  readonly sha256: string;
  readonly durationMs: number;
}

export interface VoiceTranscriptJobResult {
  readonly voiceId: string;
  readonly basis: string;
  readonly text: string;
  readonly segments: readonly { startMs: number; endMs: number; text: string }[];
}

export type VoiceRevisionReconciliation =
  | {
      accepted: true;
      reason: null;
      basis: string;
      text: string;
    }
  | {
      accepted: false;
      reason: "voice_revision_superseded" | "invalid_voice_timestamps";
      basis: string;
      text: null;
    };

/** Computes the immutable binding key tying a transcript job to a specific audio revision and digest. */
export function computeVoiceRevisionBasis(ref: Pick<VoiceRevisionRef, "version" | "sha256">): string {
  return `${ref.version}:${ref.sha256}`;
}

/**
 * Reconciles a completed transcript job against the current voice attachment revision,
 * rejecting any stale transcript whose voice version or SHA-256 digest was superseded.
 */
export function reconcileVoiceTranscriptRevision(
  currentVoice: VoiceRevisionRef,
  completedJob: VoiceTranscriptJobResult,
): VoiceRevisionReconciliation {
  const currentBasis = computeVoiceRevisionBasis(currentVoice);
  if (!currentVoice.voiceId || !currentVoice.sha256 || !Number.isInteger(currentVoice.version) || currentVoice.version < 0) {
    return {
      accepted: false,
      reason: "voice_revision_superseded",
      basis: currentBasis,
      text: null,
    };
  }
  if (completedJob.voiceId !== currentVoice.voiceId || completedJob.basis !== currentBasis) {
    return {
      accepted: false,
      reason: "voice_revision_superseded",
      basis: currentBasis,
      text: null,
    };
  }
  if (!Number.isFinite(currentVoice.durationMs) || currentVoice.durationMs < 0) {
    return {
      accepted: false,
      reason: "invalid_voice_timestamps",
      basis: currentBasis,
      text: null,
    };
  }
  let prevEnd = 0;
  for (const seg of completedJob.segments) {
    if (
      !Number.isFinite(seg.startMs) ||
      !Number.isFinite(seg.endMs) ||
      seg.startMs < prevEnd ||
      seg.endMs < seg.startMs ||
      seg.endMs > currentVoice.durationMs
    ) {
      return {
        accepted: false,
        reason: "invalid_voice_timestamps",
        basis: currentBasis,
        text: null,
      };
    }
    prevEnd = seg.endMs;
  }
  return {
    accepted: true,
    reason: null,
    basis: currentBasis,
    text: completedJob.text,
  };
}
