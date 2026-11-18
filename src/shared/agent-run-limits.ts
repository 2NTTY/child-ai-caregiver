/** Shared legal ranges and bootstrap defaults; the saved admin policy selects actual run limits. */
export const AGENT_RUN_LIMITS = Object.freeze({
  modelCalls: { min: 1, max: 64, default: 8 },
  toolCalls: { min: 1, max: 256, default: 16 },
  queryEmbeddings: { min: 1, max: 32, default: 4 },
  deadlineSeconds: { min: 15, max: 900, default: 300 },
  modelRequestSeconds: { min: 5, max: 300, default: 90 },
  modelRetries: { min: 0, max: 3, default: 3 },
} as const);

/**
 * REQ-005 §4 & §7 Output token ceiling constants.
 * Interactive ceiling supports up to 16,384 tokens; background worker up to 32,768 tokens.
 * Unclamps the legacy 1,024 clamp to support 4,096 and 16,384 tokens.
 */
export const AGENT_OUTPUT_LIMITS = Object.freeze({
  legacyClamp: 1024,
  default: 4096,
  min: 1,
  maxInteractive: 16384,
  maxBackground: 32768,
} as const);

/**
 * REQ-005 §3.1 Centralized soft budget ratio default (0.25 = 1/4).
 * Serves as advisory planning guidance derived against hard limits.
 */
export const DEFAULT_SOFT_BUDGET_RATIO = 0.25;

/** Legal range and default for configurable soft budget ratio */
export const SOFT_BUDGET_RATIO_RANGE = Object.freeze({
  min: 0.05,
  max: 1.0,
  default: DEFAULT_SOFT_BUDGET_RATIO,
} as const);

export type AgentSoftBudgetProfileRole =
  | "interactive"
  | "background"
  | "coordinator"
  | "planner"
  | "retriever"
  | "reviewer"
  | "verifier"
  | "summarizer";

/** Default role/work-type soft budget ratios when no explicit policy/run override is supplied. */
export const ROLE_SOFT_BUDGET_PROFILES: Readonly<Record<AgentSoftBudgetProfileRole, number>> = Object.freeze({
  interactive: 0.25,
  background: 0.25,
  coordinator: 0.25,
  planner: 0.25,
  retriever: 0.30,
  reviewer: 0.20,
  verifier: 0.20,
  summarizer: 0.20,
});

export const AGENT_HIGH_WATERMARK_DEFAULTS = Object.freeze({
  windowSize: 20,
  thresholdRatio: 0.80,
  minHighRuns: 5,
  consecutiveHighStreak: 3,
  repeatedSignatureStreak: 3,
} as const);

/** Downward rounding contract for allowances and soft targets (never grants more than the fraction, bounded below by minAllowance). */
export function roundBudgetAllowance(rawValue: number, minAllowance = 1): number {
  if (!Number.isFinite(rawValue)) return minAllowance;
  return Math.max(minAllowance, Math.floor(rawValue));
}

/** Upward rounding contract for consumption, safety reserves, and high-watermark thresholds (never underestimates cost). */
export function roundConsumptionReserve(rawValue: number, minReserve = 0): number {
  if (!Number.isFinite(rawValue)) return minReserve;
  return Math.max(minReserve, Math.ceil(rawValue));
}

export function clampSoftBudgetRatio(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SOFT_BUDGET_RATIO;
  return Math.max(SOFT_BUDGET_RATIO_RANGE.min, Math.min(SOFT_BUDGET_RATIO_RANGE.max, value));
}

export function resolveRoleSoftBudgetRatio(input?: {
  role?: AgentSoftBudgetProfileRole;
  policyRatio?: number;
  profileOverrides?: Partial<Record<AgentSoftBudgetProfileRole, number>>;
  runOverride?: number;
}): number {
  if (typeof input?.runOverride === "number" && Number.isFinite(input.runOverride)) {
    return clampSoftBudgetRatio(input.runOverride);
  }
  const role = input?.role;
  const override = role ? input?.profileOverrides?.[role] : undefined;
  if (typeof override === "number" && Number.isFinite(override)) {
    return clampSoftBudgetRatio(override);
  }
  if (typeof input?.policyRatio === "number" && Number.isFinite(input.policyRatio)) {
    return clampSoftBudgetRatio(input.policyRatio);
  }
  if (role && role in ROLE_SOFT_BUDGET_PROFILES) {
    return clampSoftBudgetRatio(ROLE_SOFT_BUDGET_PROFILES[role]);
  }
  return DEFAULT_SOFT_BUDGET_RATIO;
}

export interface SoftBudgetTargets {
  softBudgetRatio: number;
  modelCalls: number;
  toolCalls: number;
  queryEmbeddings: number;
}

/** Deterministically derive rounded-down soft planning targets from hard limits without altering hard caps. */
export function deriveSoftBudgetTargets(
  hardLimits: { modelCalls: number; toolCalls: number; queryEmbeddings: number },
  softBudgetRatio = DEFAULT_SOFT_BUDGET_RATIO,
): SoftBudgetTargets {
  const ratio = clampSoftBudgetRatio(softBudgetRatio);
  return {
    softBudgetRatio: ratio,
    modelCalls: roundBudgetAllowance(hardLimits.modelCalls * ratio, 1),
    toolCalls: roundBudgetAllowance(hardLimits.toolCalls * ratio, 1),
    queryEmbeddings: roundBudgetAllowance(hardLimits.queryEmbeddings * ratio, 1),
  };
}
