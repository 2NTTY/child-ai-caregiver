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

  const seenByDomain: Record<SnapshotDomain, Map<string, CrossDomainSnapshotEntry>> = {
    care_records: new Map(),
    tasks: new Map(),
    growth: new Map(),
    concerns: new Map(),
    messages: new Map(),
  };
  let excludedPostWatermarkCount = 0;

  for (const entry of entries) {
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
    let metric: DecryptedMetric | null = null;
    try {
      metric = decrypt(envelope);
    } catch {
      metric = null;
    }
    if (!metric || !Number.isFinite(metric.value) || metric.value < 0) {
      return {
        status: "invalidated",
        reason: "decrypt_failed",
        partialCountsSuppressed: true,
        totalsByKind: null,
        scannedCount,
        unreadableRecordIds: [envelope.recordId],
      };
    }
    totalsByKind[metric.kind] = (totalsByKind[metric.kind] ?? 0) + metric.value;
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
      reason: "export_scope_changed" | "stage_regression";
      state: ResumableExportState;
    };

/**
 * Advances a multi-stage resumable export cursor while preventing cross-epoch splicing or duplicate items.
 */
export function advanceResumableExportBatch(
  state: ResumableExportState,
  page: ResumableExportPage,
): ResumableExportAdvance {
  if (page.scopeVersion !== state.scopeVersion) {
    return { status: "invalidated", reason: "export_scope_changed", state };
  }
  const currentIdx = EXPORT_STAGE_ORDER.indexOf(state.stage);
  const incomingIdx = EXPORT_STAGE_ORDER.indexOf(page.stage);
  if (incomingIdx < currentIdx) {
    return { status: "invalidated", reason: "stage_regression", state };
  }

  const seen = new Set(state.items.map(item => `${item.stage}:${item.id}`));
  const merged = [...state.items];
  for (const item of page.items) {
    const key = `${item.stage}:${item.id}`;
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(item);
    }
  }

  const nextStage = page.nextStage ?? page.stage;
  const done = !page.hasMore && page.nextAfterId === null;
  const nextState: ResumableExportState = {
    scopeVersion: state.scopeVersion,
    stage: nextStage,
    afterId: page.nextAfterId,
    done,
    items: merged,
  };
  return { status: done ? "done" : "ready", reason: null, state: nextState };
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
  if (completedJob.voiceId !== currentVoice.voiceId || completedJob.basis !== currentBasis) {
    return {
      accepted: false,
      reason: "voice_revision_superseded",
      basis: currentBasis,
      text: null,
    };
  }
  let prevEnd = 0;
  for (const seg of completedJob.segments) {
    if (seg.startMs < prevEnd || seg.endMs < seg.startMs || seg.endMs > currentVoice.durationMs) {
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
