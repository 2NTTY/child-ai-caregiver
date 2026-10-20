import { createHash, randomUUID } from "node:crypto";
import {
  BACKGROUND_KNOWLEDGE_POLICY_VERSION, BACKGROUND_KNOWLEDGE_ROLE_ID, M03_INITIAL_WATCH_IDS,
  backgroundKnowledgeReviewBindingSchema, backgroundKnowledgeRunRequestSchema,
  backgroundKnowledgeRunResultSchema, backgroundKnowledgeWorkBudgetSchema,
  type BackgroundKnowledgePublishMode, type BackgroundKnowledgeReviewBinding,
  type BackgroundKnowledgeRunRequest, type BackgroundKnowledgeRunResult,
  type BackgroundKnowledgeWorkBudget, type M03InitialWatchId,
} from "../src/shared/background-knowledge-maintenance.ts";
import { SOURCE_WATCHES } from "./knowledge-source-catalog.ts";
import { observationHash } from "./knowledge-observation.ts";
import type { ObservedContent, SourceFetchResult, SourceFetcher, SourceWatchDefinition } from "./knowledge-refresh-types.ts";

export {
  BACKGROUND_KNOWLEDGE_POLICY_VERSION, BACKGROUND_KNOWLEDGE_ROLE_ID, M03_INITIAL_WATCH_IDS,
} from "../src/shared/background-knowledge-maintenance.ts";

/** Default platform batch budget for one durable maintenance identity. Not a family chat root run. */
export const BACKGROUND_KNOWLEDGE_DEFAULT_BUDGET = Object.freeze({
  usedUnits: 0, maxUnits: 8, modelCalls: 0, maxModelCalls: 0,
}) satisfies BackgroundKnowledgeWorkBudget;

/** Fetch + organize units reserved up front so a crash window cannot skip budget. */
export const BACKGROUND_KNOWLEDGE_RESERVED_UNITS = 2;

/** Exclusive lease TTL for one operation fingerprint (ms). */
export const BACKGROUND_KNOWLEDGE_CLAIM_TTL_MS = 120_000;

export interface BackgroundKnowledgeMaintenanceConfig {
  enabled: boolean;
  /** Live HTTPS fetch against reviewed hosts. Default false for this slice. */
  liveFetch: boolean;
  /** Atomic publish into the formal knowledge pointer. Default false (dry-run only). */
  livePublish: boolean;
  /** Only the guarded demo/emulator composition may publish explicit source fixtures. */
  isolatedFixturePublish?: boolean;
}

export interface BackgroundKnowledgeObservationState {
  contentHash: string | null;
  unavailable: boolean;
}

export interface BackgroundKnowledgeCandidate {
  watchId: M03InitialWatchId;
  definition: SourceWatchDefinition;
  observed: ObservedContent;
  observationHash: string;
  previousObservationHash: string | null;
}

export type BackgroundKnowledgeClaimOutcome =
  | { status: "claimed"; leaseToken: string }
  | { status: "busy" }
  | { status: "completed"; result: BackgroundKnowledgeRunResult };

export interface BackgroundKnowledgePublishReceipt {
  observationHash: string;
  state: "committed";
}

/**
 * Future M01-style read-only model review port.
 * The stub never sets reviewKind to model_review or modelReviewCompleted true.
 */
export interface KnowledgeSemanticReviewPort {
  review(candidate: BackgroundKnowledgeCandidate, signal?: AbortSignal): Promise<BackgroundKnowledgeReviewBinding>;
}

export interface BackgroundKnowledgeMaintenancePorts {
  /** Injected fetcher. Production live fetch stays gated by config.liveFetch. */
  fetch: SourceFetcher;
  /** Explicit offline fixtures. Never alias a network fetcher at production assembly. */
  fixtureFetch?: SourceFetcher;
  /** Optional prior observation for compare / idempotent redelivery. */
  readObservation?(watchId: string): Promise<BackgroundKnowledgeObservationState | null>;
  /** Optional durable budget ledger. In-memory ledger is used when omitted (tests). */
  loadBudget?(operationFingerprint: string): Promise<BackgroundKnowledgeWorkBudget | null>;
  saveBudget?(operationFingerprint: string, budget: BackgroundKnowledgeWorkBudget): Promise<void>;
  /** Recorded fingerprints so the same operation does not double-publish. */
  loadResult?(operationFingerprint: string): Promise<BackgroundKnowledgeRunResult | null>;
  saveResult?(operationFingerprint: string, result: BackgroundKnowledgeRunResult): Promise<void>;
  /** Candidate-work lease. This alone does not fence an asynchronous publication transaction. */
  claimOperation?(operationFingerprint: string, leaseToken: string, leaseUntilMs: number): Promise<BackgroundKnowledgeClaimOutcome>;
  releaseOperation?(operationFingerprint: string, leaseToken: string): Promise<void>;
  /** Crash-safe publish receipt keyed by operation fingerprint. */
  loadPublishReceipt?(operationFingerprint: string): Promise<BackgroundKnowledgePublishReceipt | null>;
  savePublishReceipt?(operationFingerprint: string, receipt: BackgroundKnowledgePublishReceipt): Promise<void>;
  /**
   * Reserved integration hook. Live publication is blocked until its transaction
   * atomically fences the lease, budget, publication pointer and durable receipt.
   */
  publish?(candidate: BackgroundKnowledgeCandidate, review: BackgroundKnowledgeReviewBinding): Promise<{ published: boolean; code?: string }>;
  review?: KnowledgeSemanticReviewPort;
  /** Bound by the trusted runtime to one durable operation and holder. No memory fallback. */
  durable?: {
    bind(request: BackgroundKnowledgeRunRequest, leaseToken: string): Promise<BackgroundKnowledgeDurableOperation>;
  };
}

export type BackgroundKnowledgeDurableOperation = Required<Pick<BackgroundKnowledgeMaintenancePorts,
  "loadBudget" | "saveBudget" | "loadResult" | "saveResult" | "claimOperation" | "releaseOperation"
  | "loadPublishReceipt" | "savePublishReceipt" | "publish" | "review">>;

function isInitialWatchId(value: string): value is M03InitialWatchId {
  return (M03_INITIAL_WATCH_IDS as readonly string[]).includes(value);
}

/** Independently enforce extraction coverage; a model pass cannot expand it. */
export function backgroundKnowledgePdfCoverageIssue(candidate: BackgroundKnowledgeCandidate): string | null {
  if (candidate.definition.kind !== "pdf") return null;
  const window = candidate.definition.pdfPages;
  const extraction = candidate.observed.extraction;
  const pages = candidate.observed.pages;
  if (!window || !extraction || !pages?.length) return "pdf_coverage_missing";
  if (extraction.pageStart !== window.startPage || extraction.pageEnd !== window.endPage
    || pages.some(page => page.page < window.startPage || page.page > window.endPage)) return "pdf_scope_invalid";
  const expected = window.endPage - window.startPage + 1;
  if (pages.length !== expected || new Set(pages.map(page => page.page)).size !== expected
    || pages.some(page => page.status === "unreadable")) return "pdf_coverage_incomplete";
  return null;
}

/** Resolve only the first-round M03 pair from the reviewed catalog. */
export function m03InitialWatchDefinitions(
  catalog: readonly SourceWatchDefinition[] = SOURCE_WATCHES,
): SourceWatchDefinition[] {
  const selected = catalog.filter(definition => isInitialWatchId(definition.id));
  if (selected.length !== M03_INITIAL_WATCH_IDS.length) throw new Error("m03_initial_watch_catalog_invalid");
  for (const id of M03_INITIAL_WATCH_IDS) {
    if (!selected.some(definition => definition.id === id)) throw new Error("m03_initial_watch_catalog_invalid");
  }
  return selected;
}

export function resolveM03Watch(watchId: string, catalog: readonly SourceWatchDefinition[] = SOURCE_WATCHES): SourceWatchDefinition | null {
  if (!isInitialWatchId(watchId)) return null;
  return catalog.find(definition => definition.id === watchId) ?? null;
}

/** Reject private / family scopes that must never enter the public maintenance runner. */
export function rejectPrivateMaintenanceScope(input: {
  familyUserId?: string | null;
  childId?: string | null;
  personalKey?: string | null;
  privateSourceId?: string | null;
}): string | null {
  if (input.familyUserId || input.childId || input.personalKey || input.privateSourceId) {
    return "knowledge_maintenance_private_scope_forbidden";
  }
  return null;
}

/** 216D: review must bind to this candidate watch / hashes / current policy. */
export function backgroundKnowledgeReviewMatchesCandidate(
  review: BackgroundKnowledgeReviewBinding,
  candidate: Pick<BackgroundKnowledgeCandidate, "watchId" | "observationHash" | "previousObservationHash">,
): boolean {
  return review.watchId === candidate.watchId
    && review.observationHash === candidate.observationHash
    && review.previousObservationHash === candidate.previousObservationHash
    && review.policyVersion === BACKGROUND_KNOWLEDGE_POLICY_VERSION;
}

/**
 * 216B + 216D: live publish requires a matching model semantic review binding.
 * Programmatic stub / modelReviewCompleted=false never authorizes live publish.
 */
export function allowLiveBackgroundKnowledgePublish(
  review: BackgroundKnowledgeReviewBinding,
  candidate: Pick<BackgroundKnowledgeCandidate, "watchId" | "observationHash" | "previousObservationHash">,
): boolean {
  if (!backgroundKnowledgeReviewMatchesCandidate(review, candidate)) return false;
  if (review.decision !== "approve_candidate") return false;
  if (review.growthRuleImpact === "requires_review") return false;
  if (review.reviewKind !== "model_review" || !review.modelReviewCompleted) return false;
  return true;
}

/**
 * Programmatic stub review: hash / scope / completeness checks only.
 * Does not claim model semantic review or clinical validity.
 */
export function createProgrammaticKnowledgeReviewStub(): KnowledgeSemanticReviewPort {
  return {
    async review(candidate, signal) {
      if (signal?.aborted) {
        return backgroundKnowledgeReviewBindingSchema.parse({
          watchId: candidate.watchId,
          observationHash: candidate.observationHash,
          previousObservationHash: candidate.previousObservationHash,
          decision: "hold_candidate",
          reviewKind: "programmatic_stub",
          policyVersion: BACKGROUND_KNOWLEDGE_POLICY_VERSION,
          modelReviewCompleted: false,
          growthRuleImpact: "none",
          notes: ["cancelled before stub review"],
        });
      }
      const notes: string[] = [];
      let decision: BackgroundKnowledgeReviewBinding["decision"] = "approve_candidate";
      let growthRuleImpact: BackgroundKnowledgeReviewBinding["growthRuleImpact"] = "none";
      if (!isInitialWatchId(candidate.watchId)) {
        decision = "reject_out_of_scope";
        notes.push("watch outside M03 first-round allowlist");
      }
      if (candidate.definition.audience !== "public_noncommercial") {
        decision = "reject_out_of_scope";
        notes.push("audience is not public_noncommercial");
      }
      if (!candidate.observed.text.trim()) {
        decision = "hold_candidate";
        notes.push("observed text empty");
      }
      const coverageIssue = backgroundKnowledgePdfCoverageIssue(candidate);
      if (coverageIssue) {
        decision = coverageIssue === "pdf_scope_invalid" ? "reject_out_of_scope" : "hold_candidate";
        notes.push(coverageIssue);
      }
      // Stub never invents growth-rule changes; uncertain medical impact stays held.
      if (/\b(dose|dosage|mg|ml|vaccine|臨床|劑量)\b/iu.test(candidate.observed.text)
        && candidate.previousObservationHash
        && candidate.previousObservationHash !== candidate.observationHash) {
        growthRuleImpact = "requires_review";
        decision = "hold_candidate";
        notes.push("possible growth/medical rule impact; keep candidate until model review");
      }
      if (!notes.length) notes.push("programmatic stub checks passed; model review not completed");
      return backgroundKnowledgeReviewBindingSchema.parse({
        watchId: candidate.watchId,
        observationHash: candidate.observationHash,
        previousObservationHash: candidate.previousObservationHash,
        decision,
        reviewKind: "programmatic_stub",
        policyVersion: BACKGROUND_KNOWLEDGE_POLICY_VERSION,
        modelReviewCompleted: false,
        growthRuleImpact,
        notes,
      });
    },
  };
}

class MemoryLedger {
  budgets = new Map<string, BackgroundKnowledgeWorkBudget>();
  results = new Map<string, BackgroundKnowledgeRunResult>();
  claims = new Map<string, { leaseToken: string; untilMs: number }>();
  receipts = new Map<string, BackgroundKnowledgePublishReceipt>();
}

function cloneBudget(budget: BackgroundKnowledgeWorkBudget): BackgroundKnowledgeWorkBudget {
  return backgroundKnowledgeWorkBudgetSchema.parse({ ...budget });
}

function spend(budget: BackgroundKnowledgeWorkBudget, units: number): BackgroundKnowledgeWorkBudget | null {
  if (budget.usedUnits + units > budget.maxUnits) return null;
  return cloneBudget({ ...budget, usedUnits: budget.usedUnits + units });
}

/** Prefer the higher usedUnits so a stale runner cannot regress a durable budget. */
function monotonicBudget(
  previous: BackgroundKnowledgeWorkBudget | null,
  next: BackgroundKnowledgeWorkBudget,
): BackgroundKnowledgeWorkBudget {
  if (!previous) return cloneBudget(next);
  return cloneBudget({
    ...next,
    usedUnits: Math.max(previous.usedUnits, next.usedUnits),
    modelCalls: Math.max(previous.modelCalls, next.modelCalls),
    maxUnits: Math.max(previous.maxUnits, next.maxUnits),
    maxModelCalls: Math.max(previous.maxModelCalls, next.maxModelCalls),
  });
}

/**
 * Independent Runner factory. Disabled config returns not_enabled and must not be
 * treated as a successful maintenance pass. Never reads family private data.
 */
export function createBackgroundKnowledgeMaintenanceRunner(
  config: BackgroundKnowledgeMaintenanceConfig,
  ports: BackgroundKnowledgeMaintenancePorts,
) {
  const roleId = BACKGROUND_KNOWLEDGE_ROLE_ID;
  const memory = new MemoryLedger();
  const defaultClaimOperation = ports.claimOperation ?? (async (fingerprint, leaseToken, leaseUntilMs) => {
    const prior = memory.results.get(fingerprint);
    if (prior) return { status: "completed" as const, result: prior };
    const current = memory.claims.get(fingerprint);
    const now = Date.now();
    if (current && current.untilMs > now && current.leaseToken !== leaseToken) return { status: "busy" as const };
    memory.claims.set(fingerprint, { leaseToken, untilMs: leaseUntilMs });
    return { status: "claimed" as const, leaseToken };
  });
  const defaultReleaseOperation = ports.releaseOperation ?? (async (fingerprint, leaseToken) => {
    const current = memory.claims.get(fingerprint);
    if (current?.leaseToken === leaseToken) memory.claims.delete(fingerprint);
  });

  async function run(raw: BackgroundKnowledgeRunRequest, signal: AbortSignal): Promise<BackgroundKnowledgeRunResult> {
    const request = backgroundKnowledgeRunRequestSchema.parse(raw);
    if (!config.enabled) {
      return backgroundKnowledgeRunResultSchema.parse({ status: "not_enabled", code: "background_knowledge_disabled", published: false });
    }
    // A model-review label and unrelated async hooks cannot authorize publication.
    if (config.livePublish && request.publishMode === "live" && !ports.durable) {
      return backgroundKnowledgeRunResultSchema.parse({
        status: "not_enabled", code: "background_knowledge_live_not_connected", published: false,
      });
    }
    const fetchSource = config.liveFetch ? ports.fetch : ports.fixtureFetch;
    if (!fetchSource) {
      return backgroundKnowledgeRunResultSchema.parse({
        status: "not_enabled", code: "background_knowledge_fetch_disabled", published: false,
      });
    }
    const leaseToken = randomUUID();
    const durable = await ports.durable?.bind(request, leaseToken);
    const bound = durable ?? ports;
    const reviewPort = bound.review ?? createProgrammaticKnowledgeReviewStub();
    const loadBudget = bound.loadBudget ?? (async fingerprint => memory.budgets.get(fingerprint) ?? null);
    const saveBudgetRaw = bound.saveBudget ?? (async (fingerprint, budget) => { memory.budgets.set(fingerprint, cloneBudget(budget)); });
    const loadResult = bound.loadResult ?? (async fingerprint => memory.results.get(fingerprint) ?? null);
    const saveResult = bound.saveResult ?? (async (fingerprint, result) => { memory.results.set(fingerprint, result); });
    const loadPublishReceipt = bound.loadPublishReceipt ?? (async fingerprint => memory.receipts.get(fingerprint) ?? null);
    const savePublishReceipt = bound.savePublishReceipt ?? (async (fingerprint, receipt) => { memory.receipts.set(fingerprint, receipt); });
    const claimOperation = bound.claimOperation ?? defaultClaimOperation;
    const releaseOperation = bound.releaseOperation ?? defaultReleaseOperation;
    const prior = await loadResult(request.operationFingerprint);
    if (prior) {
      return backgroundKnowledgeRunResultSchema.parse({
        ...prior,
        status: "already_recorded",
        code: prior.code ?? prior.status,
      });
    }

    let leaseUntilMs = Date.now() + BACKGROUND_KNOWLEDGE_CLAIM_TTL_MS;
    const claimed = await claimOperation(
      request.operationFingerprint, leaseToken, leaseUntilMs,
    );
    if (claimed.status === "completed") {
      return backgroundKnowledgeRunResultSchema.parse({
        ...claimed.result,
        status: "already_recorded",
        code: claimed.result.code ?? claimed.result.status,
      });
    }
    if (claimed.status === "busy") {
      const busyReceipt = await loadPublishReceipt(request.operationFingerprint);
      if (busyReceipt?.state === "committed") {
        return backgroundKnowledgeRunResultSchema.parse({
          status: "published",
          code: "publish_receipt_restored",
          watchId: request.watchId,
          observationHash: busyReceipt.observationHash,
          published: true,
          publishMode: config.livePublish && request.publishMode === "live" ? "live" : request.publishMode,
        });
      }
      return backgroundKnowledgeRunResultSchema.parse({
        status: "rejected",
        code: "operation_claim_busy",
        watchId: request.watchId,
        published: false,
        publishMode: request.publishMode,
      });
    }

    let budget = cloneBudget((await loadBudget(request.operationFingerprint)) ?? BACKGROUND_KNOWLEDGE_DEFAULT_BUDGET);

    /** F1: renew while still inside local TTL; overdue or stolen lease stops durable writes. */
    const holdLease = async (): Promise<"ok" | "lost" | "completed"> => {
      if (!durable && Date.now() > leaseUntilMs) return "lost";
      const nextUntil = Date.now() + BACKGROUND_KNOWLEDGE_CLAIM_TTL_MS;
      const outcome = await claimOperation(request.operationFingerprint, leaseToken, nextUntil);
      if (outcome.status === "busy") return "lost";
      if (outcome.status === "completed") return "completed";
      leaseUntilMs = nextUntil;
      return "ok";
    };

    const persistBudget = async (next: BackgroundKnowledgeWorkBudget): Promise<"ok" | "lost" | "completed"> => {
      const held = await holdLease();
      if (held !== "ok") return held;
      const existing = await loadBudget(request.operationFingerprint);
      const merged = monotonicBudget(existing, next);
      await saveBudgetRaw(request.operationFingerprint, merged);
      budget = merged;
      return "ok";
    };

    const finish = async (result: BackgroundKnowledgeRunResult, nextBudget = budget) => {
      const held = await holdLease();
      if (held === "completed") {
        const done = await loadResult(request.operationFingerprint);
        if (done) {
          await releaseOperation(request.operationFingerprint, leaseToken);
          return backgroundKnowledgeRunResultSchema.parse({
            ...done,
            status: "already_recorded",
            code: done.code ?? done.status,
          });
        }
      }
      if (held !== "ok") {
        // Stale / overdue runner must not write budget or result.
        await releaseOperation(request.operationFingerprint, leaseToken);
        return backgroundKnowledgeRunResultSchema.parse({
          status: "rejected",
          code: "operation_lease_lost",
          watchId: result.watchId ?? request.watchId,
          observationHash: result.observationHash ?? null,
          review: result.review,
          published: false,
          publishMode: result.publishMode ?? request.publishMode,
          budget: nextBudget,
        });
      }
      try {
        const existingBudget = await loadBudget(request.operationFingerprint);
        const sealedBudget = monotonicBudget(existingBudget, nextBudget);
        const sealed = backgroundKnowledgeRunResultSchema.parse({ ...result, budget: sealedBudget });
        await saveBudgetRaw(request.operationFingerprint, sealedBudget);
        await saveResult(request.operationFingerprint, sealed);
        return sealed;
      } finally {
        // Always drop our lease so a saveResult crash can retry via receipt restore (F2).
        await releaseOperation(request.operationFingerprint, leaseToken);
      }
    };

    // Reserve fetch+organize units before side effects so a crash cannot skip budget.
    const reserved = spend(budget, BACKGROUND_KNOWLEDGE_RESERVED_UNITS);
    if (!reserved) {
      return finish({
        status: "budget_exhausted", code: "maintenance_budget_exhausted",
        watchId: request.watchId, published: false, publishMode: request.publishMode,
      }, budget);
    }
    const reservedSave = await persistBudget(reserved);
    if (reservedSave === "completed") {
      const done = await loadResult(request.operationFingerprint);
      if (done) {
        return backgroundKnowledgeRunResultSchema.parse({
          ...done, status: "already_recorded", code: done.code ?? done.status,
        });
      }
    }
    if (reservedSave !== "ok") {
      return finish({
        status: "rejected", code: "operation_lease_lost",
        watchId: request.watchId, published: false, publishMode: request.publishMode,
      }, budget);
    }

    if (!isInitialWatchId(request.watchId)) {
      return finish({ status: "rejected", code: "watch_out_of_scope", watchId: request.watchId, published: false, publishMode: request.publishMode });
    }
    const definition = resolveM03Watch(request.watchId);
    if (!definition) {
      return finish({ status: "rejected", code: "watch_not_in_catalog", watchId: request.watchId, published: false, publishMode: request.publishMode });
    }
    // This runner never constructs a live network fetcher itself. Production may
    // wire createKnowledgeSourceFetcher only when config.liveFetch is true.
    if (!config.liveFetch && config.livePublish && request.publishMode === "live"
      && !(durable && config.isolatedFixturePublish)) {
      return finish({ status: "rejected", code: "live_fetch_required_for_live_publish", watchId: request.watchId, published: false, publishMode: request.publishMode });
    }
    if (signal.aborted) {
      return finish({ status: "rejected", code: "cancelled", watchId: request.watchId, published: false, publishMode: request.publishMode });
    }

    // F2: if a prior publish already committed a receipt but saveResult crashed,
    // restore that outcome before re-fetch / re-review / re-publish.
    const priorReceipt = await loadPublishReceipt(request.operationFingerprint);
    if (priorReceipt?.state === "committed") {
      const restoreMode: BackgroundKnowledgePublishMode =
        config.livePublish && request.publishMode === "live" ? "live" : "dry_run";
      return finish({
        status: "published",
        code: "publish_receipt_restored",
        watchId: request.watchId,
        observationHash: priorReceipt.observationHash,
        published: true,
        publishMode: restoreMode,
      });
    }

    const previous = await ports.readObservation?.(request.watchId) ?? null;
    if (signal.aborted) {
      return finish({ status: "rejected", code: "cancelled", watchId: request.watchId, published: false, publishMode: request.publishMode });
    }
    let fetched: SourceFetchResult;
    try {
      fetched = await fetchSource(definition, signal);
    } catch {
      return finish({ status: "fetch_failed", code: "fetch_threw", watchId: request.watchId, observationHash: previous?.contentHash ?? null, published: false, publishMode: request.publishMode });
    }
    // F1: after a long stall, refuse to continue with an overdue lease.
    const afterFetchLease = await holdLease();
    if (afterFetchLease === "completed") {
      const done = await loadResult(request.operationFingerprint);
      if (done) {
        return backgroundKnowledgeRunResultSchema.parse({
          ...done, status: "already_recorded", code: done.code ?? done.status,
        });
      }
    }
    if (afterFetchLease !== "ok") {
      return finish({
        status: "rejected", code: "operation_lease_lost",
        watchId: request.watchId, observationHash: previous?.contentHash ?? null,
        published: false, publishMode: request.publishMode,
      });
    }
    if (signal.aborted) {
      return finish({ status: "rejected", code: "cancelled", watchId: request.watchId, observationHash: previous?.contentHash ?? null, published: false, publishMode: request.publishMode });
    }

    if (fetched.status === "failed") {
      return finish({ status: "fetch_failed", code: fetched.reason, watchId: request.watchId, observationHash: previous?.contentHash ?? null, published: false, publishMode: request.publishMode });
    }
    if (fetched.status === "unavailable") {
      return finish({ status: "unavailable", code: `http_${fetched.httpStatus}`, watchId: request.watchId, observationHash: previous?.contentHash ?? null, published: false, publishMode: request.publishMode });
    }
    if (fetched.items.length !== 1) {
      return finish({ status: "rejected", code: "fetch_items_invalid", watchId: request.watchId, published: false, publishMode: request.publishMode });
    }
    const observed = fetched.items[0]!;
    if (observed.url !== definition.url) {
      return finish({ status: "rejected", code: "fetch_url_mismatch", watchId: request.watchId, published: false, publishMode: request.publishMode });
    }
    const hash = observationHash(observed);
    const candidate: BackgroundKnowledgeCandidate = {
      watchId: request.watchId, definition, observed, observationHash: hash,
      previousObservationHash: previous?.contentHash ?? null,
    };
    const coverageIssue = backgroundKnowledgePdfCoverageIssue(candidate);
    if (coverageIssue) {
      return finish({
        status: coverageIssue === "pdf_scope_invalid" ? "rejected" : "candidate_held",
        code: coverageIssue, watchId: request.watchId, observationHash: hash,
        published: false, publishMode: request.publishMode,
      });
    }
    if (previous && !previous.unavailable && previous.contentHash === hash) {
      const review = backgroundKnowledgeReviewBindingSchema.parse({
        watchId: request.watchId, observationHash: hash, previousObservationHash: previous.contentHash,
        decision: "unchanged", reviewKind: "programmatic_stub", policyVersion: BACKGROUND_KNOWLEDGE_POLICY_VERSION,
        modelReviewCompleted: false, growthRuleImpact: "none", notes: ["content hash unchanged; no model organize"],
      });
      return finish({ status: "unchanged", watchId: request.watchId, observationHash: hash, review, published: false, publishMode: request.publishMode });
    }

    if (signal.aborted) {
      return finish({ status: "rejected", code: "cancelled", watchId: request.watchId, observationHash: hash, published: false, publishMode: request.publishMode });
    }

    let review: BackgroundKnowledgeReviewBinding;
    try { review = await reviewPort.review(candidate, signal); }
    catch (error) {
      const code = (error as { code?: unknown; reason?: unknown })?.code ?? (error as { reason?: unknown })?.reason;
      return finish({ status: "candidate_held",
        code: typeof code === "string" && /^[a-z_]{1,80}$/u.test(code) ? code : "knowledge_review_failed",
        watchId: request.watchId, observationHash: hash, published: false, publishMode: request.publishMode });
    }
    if (signal.aborted) {
      return finish({ status: "rejected", code: "cancelled", watchId: request.watchId, observationHash: hash, review, published: false, publishMode: request.publishMode });
    }
    if (!backgroundKnowledgeReviewMatchesCandidate(review, candidate)) {
      return finish({ status: "rejected", code: "review_binding_mismatch", watchId: request.watchId, observationHash: hash, review, published: false, publishMode: request.publishMode });
    }
    if (review.decision === "reject_out_of_scope") {
      return finish({ status: "rejected", code: "review_out_of_scope", watchId: request.watchId, observationHash: hash, review, published: false, publishMode: request.publishMode });
    }
    if (review.decision !== "approve_candidate" || review.growthRuleImpact === "requires_review") {
      return finish({ status: "candidate_held", code: "review_hold", watchId: request.watchId, observationHash: hash, review, published: false, publishMode: request.publishMode });
    }

    const publishMode: BackgroundKnowledgePublishMode = config.livePublish && request.publishMode === "live" ? "live" : "dry_run";
    if (publishMode === "dry_run" || !config.livePublish) {
      return finish({ status: "dry_run_ready", code: "publish_dry_run", watchId: request.watchId, observationHash: hash, review, published: false, publishMode: "dry_run" });
    }

    // 216B: live path rejects programmatic stub / incomplete model review.
    if (!allowLiveBackgroundKnowledgePublish(review, candidate)) {
      return finish({
        status: "rejected", code: "live_requires_model_review",
        watchId: request.watchId, observationHash: hash, review, published: false, publishMode: "live",
      });
    }
    if (!bound.publish) {
      return finish({ status: "candidate_held", code: "publish_port_missing", watchId: request.watchId, observationHash: hash, review, published: false, publishMode: "live" });
    }
    if (signal.aborted) {
      return finish({ status: "rejected", code: "cancelled", watchId: request.watchId, observationHash: hash, review, published: false, publishMode: "live" });
    }

    const receipt = await loadPublishReceipt(request.operationFingerprint);
    // F3: re-check cancel after deferred receipt load, before any publish side effect.
    if (signal.aborted) {
      return finish({ status: "rejected", code: "cancelled", watchId: request.watchId, observationHash: hash, review, published: false, publishMode: "live" });
    }
    // F2: any committed receipt for this operation pins the published hash (do not publish a newer fetch).
    if (receipt?.state === "committed") {
      return finish({
        status: "published",
        code: receipt.observationHash === hash ? undefined : "publish_receipt_restored",
        watchId: request.watchId,
        observationHash: receipt.observationHash,
        review,
        published: true,
        publishMode: "live",
      });
    }

    const publishLease = await holdLease();
    if (publishLease === "completed") {
      const done = await loadResult(request.operationFingerprint);
      if (done) {
        return backgroundKnowledgeRunResultSchema.parse({
          ...done, status: "already_recorded", code: done.code ?? done.status,
        });
      }
    }
    if (publishLease !== "ok") {
      return finish({
        status: "rejected", code: "operation_lease_lost",
        watchId: request.watchId, observationHash: hash, review, published: false, publishMode: "live",
      });
    }
    if (signal.aborted) {
      return finish({ status: "rejected", code: "cancelled", watchId: request.watchId, observationHash: hash, review, published: false, publishMode: "live" });
    }

    const published = await bound.publish(candidate, review);
    if (!published.published) {
      return finish({ status: "candidate_held", code: published.code ?? "publish_pending", watchId: request.watchId, observationHash: hash, review, published: false, publishMode: "live" });
    }
    // F2: persist receipt immediately after a fenced publish so saveResult crashes can restore.
    await savePublishReceipt(request.operationFingerprint, { observationHash: hash, state: "committed" });
    return finish({ status: "published", watchId: request.watchId, observationHash: hash, review, published: true, publishMode: "live" });
  }

  return {
    roleId,
    enabled: config.enabled,
    /** Factory must not pretend success when disabled. */
    async start(request: BackgroundKnowledgeRunRequest, signal: AbortSignal = new AbortController().signal) {
      return run(request, signal);
    },
  };
}

export type BackgroundKnowledgeMaintenanceRunner = ReturnType<typeof createBackgroundKnowledgeMaintenanceRunner>;

export function backgroundKnowledgeOperationFingerprint(parts: {
  watchId: string; revision: string; workerGeneration: string; slot: string;
}): string {
  // Slot is the durable scheduled occurrence, never a retry timestamp.
  // Worker replacement must not create fresh budget for the same logical work.
  return createHash("sha256").update(JSON.stringify([
    BACKGROUND_KNOWLEDGE_ROLE_ID, parts.watchId, parts.revision, parts.slot,
  ])).digest("hex");
}
