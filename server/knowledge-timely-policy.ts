import type { KnowledgeClass } from "../src/shared/knowledge.ts";
import { isPersistentTimelyKind, type TimelyEventLifecycle } from "../src/shared/knowledge-timely.ts";

export const TIMELY_KNOWLEDGE_POLICY_DEFAULTS = Object.freeze({
  recentNewsWindowDays: 7,
  checkFreshnessHours: 24,
  observationLookbackDays: 180,
});

export interface TimelyEligibilityPolicy {
  recentNewsWindowDays: number;
  checkFreshnessHours: number;
  observationLookbackDays: number;
}

export interface TimelyEligibilityInput {
  classification: KnowledgeClass;
  sourcePublishedAt: string | null;
  validUntil?: string | null;
  lastSuccessfulCheckAt: string | null;
  timelyEvent?: TimelyEventLifecycle | null;
}

export type TimelyEligibilityReason =
  | "durable_guidance"
  | "active_safety_or_recall"
  | "active_until_deadline"
  | "within_recent_window"
  | "publication_date_missing_or_future"
  | "check_stale"
  | "event_lifted"
  | "event_superseded"
  | "event_expired"
  | "valid_until_expired"
  | "recent_window_elapsed";

export interface TimelyEligibilityDecision {
  eligible: boolean;
  reason: TimelyEligibilityReason;
  retentionClass:
    | "durable"
    | "persistent_until_resolved"
    | "bounded_by_valid_until"
    | "rolling_recent_window";
  retainProvenanceOnly: boolean;
}

function resolvePositiveInt(value: number | undefined, fallback: number, min: number, max: number, name: string): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < min || resolved > max) {
    throw new Error(`Invalid timely policy ${name}`);
  }
  return resolved;
}

function resolveTimelyPolicy(overrides: Partial<TimelyEligibilityPolicy> = {}): TimelyEligibilityPolicy {
  return {
    recentNewsWindowDays: resolvePositiveInt(
      overrides.recentNewsWindowDays,
      TIMELY_KNOWLEDGE_POLICY_DEFAULTS.recentNewsWindowDays,
      1,
      365,
      "recentNewsWindowDays",
    ),
    checkFreshnessHours: resolvePositiveInt(
      overrides.checkFreshnessHours,
      TIMELY_KNOWLEDGE_POLICY_DEFAULTS.checkFreshnessHours,
      1,
      168,
      "checkFreshnessHours",
    ),
    observationLookbackDays: resolvePositiveInt(
      overrides.observationLookbackDays,
      TIMELY_KNOWLEDGE_POLICY_DEFAULTS.observationLookbackDays,
      1,
      3650,
      "observationLookbackDays",
    ),
  };
}

/** Retrieval and bounded Firestore discovery use the same classification; a hint never establishes eligibility. */
export function timelyRetentionClass(input: Pick<TimelyEligibilityInput, "classification" | "timelyEvent" | "validUntil">): TimelyEligibilityDecision["retentionClass"] {
  if (input.classification !== "recent_information") return "durable";
  const kind = input.timelyEvent?.kind ?? "news";
  if (isPersistentTimelyKind(kind)) return "persistent_until_resolved";
  return (kind === "policy_change" || kind === "deadline") && input.validUntil ? "bounded_by_valid_until" : "rolling_recent_window";
}

/** Deterministic retention & retrieval eligibility for official guidance and B-class timely events. */
export function evaluateTimelyEligibility(
  input: TimelyEligibilityInput,
  nowMs = Date.now(),
  policyOverrides: Partial<TimelyEligibilityPolicy> = {},
): TimelyEligibilityDecision {
  const policy = resolveTimelyPolicy(policyOverrides);
  const validUntilMs = input.validUntil ? Date.parse(input.validUntil) : null;
  const validUntilExpired = validUntilMs !== null && (!Number.isFinite(validUntilMs) || validUntilMs <= nowMs);

  if (input.classification !== "recent_information") {
    if (validUntilExpired) {
      return {
        eligible: false,
        reason: "valid_until_expired",
        retentionClass: "durable",
        retainProvenanceOnly: true,
      };
    }
    return {
      eligible: true,
      reason: "durable_guidance",
      retentionClass: "durable",
      retainProvenanceOnly: false,
    };
  }

  const status = input.timelyEvent?.status ?? "active";
  const retentionClass = timelyRetentionClass(input);

  if (status === "lifted") {
    return { eligible: false, reason: "event_lifted", retentionClass, retainProvenanceOnly: true };
  }
  if (status === "superseded") {
    return { eligible: false, reason: "event_superseded", retentionClass, retainProvenanceOnly: true };
  }
  if (status === "expired") {
    return { eligible: false, reason: "event_expired", retentionClass, retainProvenanceOnly: true };
  }

  if (validUntilExpired) {
    return { eligible: false, reason: "valid_until_expired", retentionClass, retainProvenanceOnly: true };
  }

  const publishedMs = input.sourcePublishedAt ? Date.parse(input.sourcePublishedAt) : NaN;
  if (!Number.isFinite(publishedMs) || publishedMs > nowMs) {
    return {
      eligible: false,
      reason: "publication_date_missing_or_future",
      retentionClass,
      retainProvenanceOnly: false,
    };
  }

  const checkedMs = input.lastSuccessfulCheckAt ? Date.parse(input.lastSuccessfulCheckAt) : NaN;
  if (!Number.isFinite(checkedMs) || checkedMs < nowMs - policy.checkFreshnessHours * 3_600_000) {
    return { eligible: false, reason: "check_stale", retentionClass, retainProvenanceOnly: false };
  }

  if (retentionClass === "persistent_until_resolved") {
    return { eligible: true, reason: "active_safety_or_recall", retentionClass, retainProvenanceOnly: false };
  }
  if (retentionClass === "bounded_by_valid_until") {
    return { eligible: true, reason: "active_until_deadline", retentionClass, retainProvenanceOnly: false };
  }
  if (publishedMs >= nowMs - policy.recentNewsWindowDays * 86_400_000) {
    return { eligible: true, reason: "within_recent_window", retentionClass, retainProvenanceOnly: false };
  }
  return { eligible: false, reason: "recent_window_elapsed", retentionClass, retainProvenanceOnly: true };
}

export function shouldAutoNotifyTimelyEvent(
  classification: KnowledgeClass,
  timelyEvent?: TimelyEventLifecycle | null,
): boolean {
  // Legacy timely editions lack kind metadata; retrieval already treats them as ordinary news.
  return classification !== "recent_information" || (timelyEvent?.kind ?? "news") !== "news";
}

export function proactiveKindForTimelyEvent(
  classification: KnowledgeClass,
  timelyEvent?: TimelyEventLifecycle | null,
): "guidance" | "announcement" | "deadline" | "recall" {
  if (classification !== "recent_information") return "guidance";
  if (timelyEvent?.kind === "recall") return "recall";
  if (timelyEvent?.kind === "deadline") return "deadline";
  return "announcement";
}

export function sqlTimelyEligibilityClause(policyOverrides: Partial<TimelyEligibilityPolicy> = {}): string {
  const policy = resolveTimelyPolicy(policyOverrides);
  return `(v.document->>'validUntil' IS NULL OR (v.document->>'validUntil')::timestamptz > now())
  AND (v.document->>'classification' <> 'recent_information' OR (
    v.document->>'sourcePublishedAt' IS NOT NULL
    AND (v.document->>'sourcePublishedAt')::timestamptz <= now()
    AND o.last_successful_check_at >= now() - interval '${policy.checkFreshnessHours} hours'
    AND COALESCE(v.document->'timelyEvent'->>'status', 'active') IN ('active', 'corrected')
    AND (
      v.document->'timelyEvent'->>'kind' IN ('recall', 'safety_alert')
      OR (v.document->'timelyEvent'->>'kind' IN ('policy_change', 'deadline') AND v.document->>'validUntil' IS NOT NULL AND (v.document->>'validUntil')::timestamptz > now())
      OR (v.document->>'sourcePublishedAt')::timestamptz >= now() - interval '${policy.recentNewsWindowDays} days'
    )
  ))`;
}
