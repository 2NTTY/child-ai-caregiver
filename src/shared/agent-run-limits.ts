/** Shared legal ranges and bootstrap defaults; the saved admin policy selects actual run limits. */
export const AGENT_RUN_LIMITS = Object.freeze({
  modelCalls: { min: 1, max: 12, default: 8 },
  toolCalls: { min: 1, max: 16, default: 16 },
  queryEmbeddings: { min: 1, max: 6, default: 4 },
  deadlineSeconds: { min: 15, max: 300, default: 300 },
  modelRequestSeconds: { min: 5, max: 180, default: 90 },
  modelRetries: { min: 0, max: 3, default: 3 },
} as const);
