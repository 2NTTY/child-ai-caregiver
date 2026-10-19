import { createHash } from "node:crypto";
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

export interface BackgroundKnowledgeMaintenanceConfig {
  enabled: boolean;
  /** Live HTTPS fetch against reviewed hosts. Default false for this slice. */
  liveFetch: boolean;
  /** Atomic publish into the formal knowledge pointer. Default false (dry-run only). */
  livePublish: boolean;
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

/**
 * Future M01-style read-only model review port.
 * The stub never sets reviewKind to model_review or modelReviewCompleted true.
 */
export interface KnowledgeSemanticReviewPort {
  review(candidate: BackgroundKnowledgeCandidate): Promise<BackgroundKnowledgeReviewBinding>;
}

export interface BackgroundKnowledgeMaintenancePorts {
  /** Injected fetcher. Production live fetch stays gated by config.liveFetch. */
  fetch: SourceFetcher;
  /** Optional prior observation for compare / idempotent redelivery. */
  readObservation?(watchId: string): Promise<BackgroundKnowledgeObservationState | null>;
  /** Optional durable budget ledger. In-memory ledger is used when omitted (tests). */
  loadBudget?(operationFingerprint: string): Promise<BackgroundKnowledgeWorkBudget | null>;
  saveBudget?(operationFingerprint: string, budget: BackgroundKnowledgeWorkBudget): Promise<void>;
  /** Recorded fingerprints so the same operation does not double-publish. */
  loadResult?(operationFingerprint: string): Promise<BackgroundKnowledgeRunResult | null>;
  saveResult?(operationFingerprint: string, result: BackgroundKnowledgeRunResult): Promise<void>;
  /**
   * Formal publish hook. Only called when livePublish is true and stub review approves.
   * Must not modify medical/growth execution rules.
   */
  publish?(candidate: BackgroundKnowledgeCandidate, review: BackgroundKnowledgeReviewBinding): Promise<{ published: boolean; code?: string }>;
  review?: KnowledgeSemanticReviewPort;
}

function isInitialWatchId(value: string): value is M03InitialWatchId {
  return (M03_INITIAL_WATCH_IDS as readonly string[]).includes(value);
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

/**
 * Programmatic stub review: hash / scope / completeness checks only.
 * Does not claim model semantic review or clinical validity.
 */
export function createProgrammaticKnowledgeReviewStub(): KnowledgeSemanticReviewPort {
  return {
    async review(candidate) {
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
      if (candidate.definition.kind === "pdf") {
        const pages = candidate.observed.pages ?? [];
        const window = candidate.definition.pdfPages;
        if (!window || !candidate.observed.extraction) {
          decision = "hold_candidate";
          notes.push("pdf extraction or page window missing");
        } else if (pages.some(page => page.status === "unreadable")) {
          decision = "hold_candidate";
          notes.push("pdf page unreadable; keep as candidate");
        } else if (pages.some(page => page.page < window.startPage || page.page > window.endPage)) {
          decision = "reject_out_of_scope";
          notes.push("pdf page outside reviewed window");
        }
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
}

function cloneBudget(budget: BackgroundKnowledgeWorkBudget): BackgroundKnowledgeWorkBudget {
  return backgroundKnowledgeWorkBudgetSchema.parse({ ...budget });
}

function spend(budget: BackgroundKnowledgeWorkBudget, units: number): BackgroundKnowledgeWorkBudget | null {
  if (budget.usedUnits + units > budget.maxUnits) return null;
  return cloneBudget({ ...budget, usedUnits: budget.usedUnits + units });
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
  const reviewPort = ports.review ?? createProgrammaticKnowledgeReviewStub();
  const loadBudget = ports.loadBudget ?? (async fingerprint => memory.budgets.get(fingerprint) ?? null);
  const saveBudget = ports.saveBudget ?? (async (fingerprint, budget) => { memory.budgets.set(fingerprint, cloneBudget(budget)); });
  const loadResult = ports.loadResult ?? (async fingerprint => memory.results.get(fingerprint) ?? null);
  const saveResult = ports.saveResult ?? (async (fingerprint, result) => { memory.results.set(fingerprint, result); });

  async function run(raw: BackgroundKnowledgeRunRequest, signal: AbortSignal): Promise<BackgroundKnowledgeRunResult> {
    const request = backgroundKnowledgeRunRequestSchema.parse(raw);
    if (!config.enabled) {
      return backgroundKnowledgeRunResultSchema.parse({ status: "not_enabled", code: "background_knowledge_disabled", published: false });
    }
    const prior = await loadResult(request.operationFingerprint);
    if (prior) {
      return backgroundKnowledgeRunResultSchema.parse({
        ...prior,
        status: "already_recorded",
        code: prior.code ?? prior.status,
      });
    }

    let budget = cloneBudget((await loadBudget(request.operationFingerprint)) ?? BACKGROUND_KNOWLEDGE_DEFAULT_BUDGET);
    const finish = async (result: BackgroundKnowledgeRunResult, nextBudget = budget) => {
      const sealed = backgroundKnowledgeRunResultSchema.parse({ ...result, budget: nextBudget });
      await saveBudget(request.operationFingerprint, nextBudget);
      await saveResult(request.operationFingerprint, sealed);
      return sealed;
    };

    if (!isInitialWatchId(request.watchId)) {
      return finish({ status: "rejected", code: "watch_out_of_scope", watchId: request.watchId, published: false, publishMode: request.publishMode });
    }
    const definition = resolveM03Watch(request.watchId);
    if (!definition) {
      return finish({ status: "rejected", code: "watch_not_in_catalog", watchId: request.watchId, published: false, publishMode: request.publishMode });
    }
    // This runner never constructs a live network fetcher itself. Production may
    // wire createKnowledgeSourceFetcher only when config.liveFetch is true.
    if (!config.liveFetch && config.livePublish && request.publishMode === "live") {
      return finish({ status: "rejected", code: "live_fetch_required_for_live_publish", watchId: request.watchId, published: false, publishMode: request.publishMode });
    }

    const nextBudget = spend(budget, 1);
    if (!nextBudget) {
      return finish({ status: "budget_exhausted", code: "maintenance_budget_exhausted", watchId: request.watchId, published: false, publishMode: request.publishMode }, budget);
    }
    budget = nextBudget;
    if (signal.aborted) {
      return finish({ status: "rejected", code: "cancelled", watchId: request.watchId, published: false, publishMode: request.publishMode });
    }

    const previous = await ports.readObservation?.(request.watchId) ?? null;
    let fetched: SourceFetchResult;
    try {
      fetched = await ports.fetch(definition, signal);
    } catch {
      return finish({ status: "fetch_failed", code: "fetch_threw", watchId: request.watchId, observationHash: previous?.contentHash ?? null, published: false, publishMode: request.publishMode });
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
    if (previous && !previous.unavailable && previous.contentHash === hash) {
      const review = backgroundKnowledgeReviewBindingSchema.parse({
        watchId: request.watchId, observationHash: hash, previousObservationHash: previous.contentHash,
        decision: "unchanged", reviewKind: "programmatic_stub", policyVersion: BACKGROUND_KNOWLEDGE_POLICY_VERSION,
        modelReviewCompleted: false, growthRuleImpact: "none", notes: ["content hash unchanged; no model organize"],
      });
      return finish({ status: "unchanged", watchId: request.watchId, observationHash: hash, review, published: false, publishMode: request.publishMode });
    }

    const organizeBudget = spend(budget, 1);
    if (!organizeBudget) {
      return finish({ status: "budget_exhausted", code: "maintenance_budget_exhausted", watchId: request.watchId, observationHash: hash, published: false, publishMode: request.publishMode }, budget);
    }
    budget = organizeBudget;

    const candidate: BackgroundKnowledgeCandidate = {
      watchId: request.watchId, definition, observed, observationHash: hash,
      previousObservationHash: previous?.contentHash ?? null,
    };
    const review = await reviewPort.review(candidate);
    if (review.reviewKind === "model_review" || review.modelReviewCompleted) {
      return finish({ status: "rejected", code: "model_review_not_wired", watchId: request.watchId, observationHash: hash, review: null, published: false, publishMode: request.publishMode });
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
    if (!ports.publish) {
      return finish({ status: "candidate_held", code: "publish_port_missing", watchId: request.watchId, observationHash: hash, review, published: false, publishMode: "live" });
    }
    const published = await ports.publish(candidate, review);
    if (!published.published) {
      return finish({ status: "candidate_held", code: published.code ?? "publish_pending", watchId: request.watchId, observationHash: hash, review, published: false, publishMode: "live" });
    }
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
  return createHash("sha256").update(JSON.stringify([
    BACKGROUND_KNOWLEDGE_ROLE_ID, parts.watchId, parts.revision, parts.workerGeneration, parts.slot,
  ])).digest("hex");
}
