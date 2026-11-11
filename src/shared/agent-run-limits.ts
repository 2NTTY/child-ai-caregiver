/** Shared legal ranges and bootstrap defaults; the saved admin policy selects actual run limits. */
export const AGENT_RUN_LIMITS = Object.freeze({
  modelCalls: { min: 1, max: 12, default: 8 },
  toolCalls: { min: 1, max: 16, default: 16 },
  queryEmbeddings: { min: 1, max: 6, default: 4 },
  deadlineSeconds: { min: 15, max: 300, default: 300 },
  modelRequestSeconds: { min: 5, max: 180, default: 90 },
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
